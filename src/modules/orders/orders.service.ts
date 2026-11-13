import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateOrderDto, UpdateOrderStatusDto } from './dto/orders.dto';
import { OrderStatus, PaymentStatus, DeliveryType } from '@prisma/client';
import { randomUUID } from 'crypto';

/** Upper bound for a single line item, guards against absurd quantities. */
const MAX_ITEM_QUANTITY = 1000;

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async createOrder(customerId: string, dto: CreateOrderDto) {
    const orderNumber = `ORD-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    if (!Array.isArray(dto.items) || dto.items.length === 0) {
      throw new BadRequestException('Order must contain at least one item');
    }

    // Wrap order creation + stock updates in a single transaction so a failed
    // stock check rolls back the whole order.
    const order = await this.prisma.$transaction(async (tx) => {
      const shop = await tx.shop.findUnique({
        where: { id: dto.shopId },
        select: { id: true },
      });
      if (!shop) throw new NotFoundException('Shop not found');

      // Prices and quantities are never trusted from the client: every line is
      // re-priced from the database and totals are recomputed server-side.
      const pricedItems: any[] = [];
      let subtotal = 0;

      for (const item of dto.items) {
        const quantity = Number(item?.quantity);
        if (
          !item?.productId ||
          !Number.isInteger(quantity) ||
          quantity < 1 ||
          quantity > MAX_ITEM_QUANTITY
        ) {
          throw new BadRequestException(
            'Each item needs a valid productId and a positive integer quantity',
          );
        }

        const product = await tx.product.findFirst({
          where: { id: item.productId, shopId: dto.shopId, isActive: true },
          select: { id: true, name: true, sellingPrice: true },
        });
        if (!product) {
          throw new BadRequestException(
            `Product ${item.productId} is not available in this shop`,
          );
        }

        // Atomic conditional decrement: stock can never go negative, even
        // under concurrent orders.
        const decremented = await tx.product.updateMany({
          where: { id: product.id, stockQuantity: { gte: quantity } },
          data: { stockQuantity: { decrement: quantity } },
        });
        if (decremented.count === 0) {
          throw new BadRequestException(
            `Insufficient stock for ${product.name}`,
          );
        }

        const unitPrice = Number(product.sellingPrice);
        subtotal += unitPrice * quantity;
        pricedItems.push({
          productId: product.id,
          name: product.name,
          quantity,
          price: unitPrice,
        });

        await tx.stockHistory.create({
          data: {
            productId: product.id,
            quantity: -quantity,
            reason: 'SALE',
            note: `Order ${orderNumber}`,
          },
        });
      }

      subtotal = Math.round(subtotal * 100) / 100;
      const deliveryCharge = Math.max(0, Number(dto.deliveryCharge) || 0);
      const discount = Math.min(
        subtotal,
        Math.max(0, Number(dto.discount) || 0),
      );
      const total =
        Math.round((subtotal + deliveryCharge - discount) * 100) / 100;

      return tx.order.create({
        data: {
          orderNumber,
          customerId,
          shopId: dto.shopId,
          items: pricedItems,
          subtotal,
          deliveryCharge,
          discount,
          total,
          deliveryAddress: dto.deliveryAddress,
          deliveryType: dto.deliveryType || DeliveryType.STANDARD,
          status: OrderStatus.PENDING,
          paymentStatus: PaymentStatus.PENDING,
          idempotencyKey: randomUUID(),
        },
      });
    });

    return order;
  }

  async getMyOrders(userId: string) {
    return this.prisma.order.findMany({
      where: { customerId: userId },
      orderBy: { createdAt: 'desc' },
      include: { shop: { select: { name: true, logoUrl: true } } },
    });
  }

  async getShopOrders(shopkeeperId: string) {
    const shop = await this.prisma.shop.findUnique({
      where: { ownerId: shopkeeperId },
    });
    if (!shop) throw new NotFoundException('Shop not found');

    const orders = await this.prisma.order.findMany({
      where: { shopId: shop.id },
      orderBy: { createdAt: 'desc' },
      include: {
        customer: { select: { name: true, email: true, mobile: true } },
      },
    });

    const productIds = [
      ...new Set(
        orders.flatMap((order) => {
          const items = Array.isArray(order.items) ? (order.items as any[]) : [];
          return items
            .map((item) => item?.productId)
            .filter((id): id is string => typeof id === 'string' && id.length > 0);
        }),
      ),
    ];
    const products = productIds.length
      ? await this.prisma.product.findMany({
          where: { id: { in: productIds } },
          select: { id: true, name: true },
        })
      : [];
    const names = new Map(products.map((product) => [product.id, product.name]));

    return orders.map((order) => ({
      ...order,
      items: (Array.isArray(order.items) ? (order.items as any[]) : []).map(
        (item) => ({
          ...item,
          name: item?.name || names.get(item?.productId) || 'Item',
        }),
      ),
    }));
  }

  async updateOrderStatus(
    shopkeeperId: string,
    orderId: string,
    dto: UpdateOrderStatusDto,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { shop: true },
    });

    if (!order) throw new NotFoundException('Order not found');
    if (order.shop.ownerId !== shopkeeperId)
      throw new ForbiddenException('Not your order');

    if (
      order.status === OrderStatus.CANCELLED ||
      order.status === OrderStatus.DELIVERED
    ) {
      if (order.status === dto.status) return order;
      throw new BadRequestException(
        `Order is already ${order.status} and can no longer be changed`,
      );
    }

    const items = Array.isArray(order.items) ? (order.items as any[]) : [];
    const cancelling = dto.status === OrderStatus.CANCELLED;

    // Status change + stock restore happen atomically so a cancel can never
    // restore stock twice or leave the order in a half-updated state.
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.order.updateMany({
        where: { id: orderId, status: order.status },
        data: { status: dto.status },
      });
      if (result.count === 0) {
        throw new BadRequestException(
          'Order was modified concurrently, please retry',
        );
      }

      if (cancelling) {
        for (const item of items) {
          if (item.productId && item.quantity) {
            await tx.product.update({
              where: { id: item.productId },
              data: { stockQuantity: { increment: item.quantity } },
            });
            await tx.stockHistory.create({
              data: {
                productId: item.productId,
                quantity: item.quantity,
                reason: 'RETURN',
                note: `Order ${order.orderNumber} cancelled`,
              },
            });
          }
        }
      }

      return tx.order.findUniqueOrThrow({ where: { id: orderId } });
    });

    return updated;
  }
}

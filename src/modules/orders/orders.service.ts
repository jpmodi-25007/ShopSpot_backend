import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateOrderDto, UpdateOrderStatusDto } from './dto/orders.dto';
import { OrderStatus, PaymentStatus, DeliveryType } from '@prisma/client';
import { randomUUID } from 'crypto';

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async createOrder(customerId: string, dto: CreateOrderDto) {
    const orderNumber = `ORD-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    // Wrap order creation + stock updates in a single transaction to prevent
    // race conditions that would allow stock to go negative under concurrent orders.
    const order = await this.prisma.$transaction(async (tx) => {
      const newOrder = await tx.order.create({
        data: {
          orderNumber,
          customerId,
          shopId: dto.shopId,
          items: dto.items,
          subtotal: dto.subtotal,
          deliveryCharge: dto.deliveryCharge || 0,
          discount: dto.discount || 0,
          total: dto.total,
          deliveryAddress: dto.deliveryAddress,
          deliveryType: dto.deliveryType || DeliveryType.STANDARD,
          status: OrderStatus.PENDING,
          paymentStatus: PaymentStatus.PENDING,
          idempotencyKey: randomUUID(),
        },
      });

      for (const item of dto.items) {
        if (item.productId && item.quantity) {
          // Fetch current stock to guard against going negative
          const product = await tx.product.findUnique({
            where: { id: item.productId },
            select: { stockQuantity: true },
          });
          if (!product) continue;
          const newQty = Math.max(0, product.stockQuantity - item.quantity);
          await tx.product.update({
            where: { id: item.productId },
            data: { stockQuantity: newQty },
          });
        }
      }

      return newOrder;
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

    return this.prisma.order.findMany({
      where: { shopId: shop.id },
      orderBy: { createdAt: 'desc' },
      include: { customer: { select: { name: true, email: true, mobile: true } } },
    });
  }

  async updateOrderStatus(shopkeeperId: string, orderId: string, dto: UpdateOrderStatusDto) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { shop: true },
    });
    
    if (!order) throw new NotFoundException('Order not found');
    if (order.shop.ownerId !== shopkeeperId) throw new ForbiddenException('Not your order');

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { status: dto.status },
    });

    if (dto.status === OrderStatus.CANCELLED && order.status !== OrderStatus.CANCELLED) {
      const items = order.items as any[];
      if (items && Array.isArray(items)) {
        for (const item of items) {
          if (item.productId && item.quantity) {
            await this.prisma.product.update({
              where: { id: item.productId },
              data: { stockQuantity: { increment: item.quantity } },
            });
          }
        }
      }
    }

    return updated;
  }
}

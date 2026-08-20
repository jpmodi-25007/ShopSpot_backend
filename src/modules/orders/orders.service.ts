import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateOrderDto, UpdateOrderStatusDto } from './dto/orders.dto';
import { OrderStatus, PaymentStatus, DeliveryType } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async createOrder(customerId: string, dto: CreateOrderDto) {
    const orderNumber = `ORD-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    return this.prisma.order.create({
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
        idempotencyKey: uuidv4(),
      },
    });
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

    return this.prisma.order.update({
      where: { id: orderId },
      data: { status: dto.status },
    });
  }
}

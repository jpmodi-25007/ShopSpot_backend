import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class RetailerInventoryService {
  constructor(private prisma: PrismaService) {}

  async getSuppliers(userId: string) {
    const shop = await this.prisma.shop.findUnique({
      where: { ownerId: userId },
    });
    if (!shop) throw new NotFoundException('Shop not found');

    const suppliers = await this.prisma.supplier.findMany({
      where: { shopId: shop.id },
      include: {
        purchaseOrders: {
          orderBy: { createdAt: 'desc' },
          take: 2,
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return suppliers;
  }

  async createSupplier(userId: string, data: any) {
    const shop = await this.prisma.shop.findUnique({
      where: { ownerId: userId },
    });
    if (!shop) throw new NotFoundException('Shop not found');

    return this.prisma.supplier.create({
      data: {
        ...data,
        shopId: shop.id,
      },
    });
  }

  async getPurchaseOrders(userId: string) {
    const shop = await this.prisma.shop.findUnique({
      where: { ownerId: userId },
    });
    if (!shop) throw new NotFoundException('Shop not found');

    return this.prisma.purchaseOrder.findMany({
      where: { shopId: shop.id },
      include: {
        supplier: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createPurchaseOrder(userId: string, data: any) {
    const shop = await this.prisma.shop.findUnique({
      where: { ownerId: userId },
    });
    if (!shop) throw new NotFoundException('Shop not found');

    return this.prisma.purchaseOrder.create({
      data: {
        ...data,
        shopId: shop.id,
      },
    });
  }

  async updatePurchaseOrder(
    userId: string,
    id: string,
    data: {
      status?: string;
      isDelivered?: boolean;
      details?: string;
      expectedDate?: Date;
      productId?: string;
      quantity?: number;
    },
  ) {
    const shop = await this.prisma.shop.findUnique({
      where: { ownerId: userId },
    });
    if (!shop) throw new NotFoundException('Shop not found');

    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id, shopId: shop.id },
    });
    if (!po) throw new NotFoundException('Purchase order not found');

    const wasDelivered =
      po.isDelivered || po.status.toLowerCase() === 'delivered';
    const isNowDelivered =
      data.isDelivered === true ||
      (data.status != null && data.status.toLowerCase() === 'delivered');

    const { productId, quantity, ...updateFields } = data;

    const updated = await this.prisma.purchaseOrder.update({
      where: { id },
      data: updateFields,
    });

    if (
      !wasDelivered &&
      isNowDelivered &&
      productId &&
      quantity &&
      quantity > 0
    ) {
      await this.prisma.product.update({
        where: { id: productId },
        data: { stockQuantity: { increment: quantity } },
      });
      await this.prisma.stockHistory.create({
        data: {
          productId,
          quantity,
          reason: 'RESTOCK',
          note: `Purchase Order ${po.poNumber} received`,
        },
      });
    }

    return updated;
  }

  async getStockHistory(userId: string) {
    const shop = await this.prisma.shop.findUnique({
      where: { ownerId: userId },
    });
    if (!shop) throw new NotFoundException('Shop not found');

    return this.prisma.stockHistory.findMany({
      where: {
        product: {
          shopId: shop.id,
        },
      },
      include: {
        product: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}

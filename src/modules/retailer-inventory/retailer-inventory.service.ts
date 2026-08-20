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

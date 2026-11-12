import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/** Copies only the listed keys (when present) so request bodies can never
 * smuggle in ids, foreign keys or other columns. */
function pick(data: any, keys: string[]): Record<string, any> {
  const out: Record<string, any> = {};
  if (!data || typeof data !== 'object') return out;
  for (const key of keys) {
    if (data[key] !== undefined) out[key] = data[key];
  }
  return out;
}

const SUPPLIER_FIELDS = [
  'name',
  'location',
  'rating',
  'ratingLabel',
  'deliveryTime',
  'qualityMatch',
  'email',
  'phone',
  'isActive',
];
const PURCHASE_ORDER_CREATE_FIELDS = [
  'supplierId',
  'poNumber',
  'details',
  'status',
  'isDelivered',
  'expectedDate',
];
const PURCHASE_ORDER_UPDATE_FIELDS = [
  'status',
  'isDelivered',
  'details',
  'expectedDate',
];

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
        ...(pick(data, SUPPLIER_FIELDS) as any),
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

    const fields = pick(data, PURCHASE_ORDER_CREATE_FIELDS);

    // The supplier must belong to the caller's own shop.
    const supplier = await this.prisma.supplier.findFirst({
      where: { id: fields.supplierId, shopId: shop.id },
      select: { id: true },
    });
    if (!supplier) throw new NotFoundException('Supplier not found');

    return this.prisma.purchaseOrder.create({
      data: {
        ...(fields as any),
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

    const { productId, quantity } = data;
    const updateFields = pick(data, PURCHASE_ORDER_UPDATE_FIELDS);

    const shouldRestock =
      !wasDelivered &&
      isNowDelivered &&
      !!productId &&
      typeof quantity === 'number' &&
      Number.isInteger(quantity) &&
      quantity > 0;

    if (shouldRestock) {
      // Stock can only be added to a product that belongs to this shop.
      const product = await this.prisma.product.findFirst({
        where: { id: productId, shopId: shop.id },
        select: { id: true },
      });
      if (!product) {
        throw new BadRequestException('Product does not belong to your shop');
      }
    }

    // PO update and restock succeed or fail together.
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.purchaseOrder.update({
        where: { id },
        data: updateFields as any,
      });

      if (shouldRestock) {
        await tx.product.update({
          where: { id: productId },
          data: { stockQuantity: { increment: quantity } },
        });
        await tx.stockHistory.create({
          data: {
            productId: productId,
            quantity: quantity,
            reason: 'RESTOCK',
            note: `Purchase Order ${po.poNumber} received`,
          },
        });
      }
      return result;
    });

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

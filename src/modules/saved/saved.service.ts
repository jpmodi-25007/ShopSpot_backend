import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  omitPrivateShopFields,
  scrubNestedShops,
} from '../../common/helpers/sanitize.helper';

@Injectable()
export class SavedService {
  constructor(private prisma: PrismaService) {}

  async saveProduct(userId: string, productId: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });
    if (!product) throw new NotFoundException('Product not found');

    const existing = await this.prisma.savedProduct.findUnique({
      where: { userId_productId: { userId, productId } },
    });
    if (existing) throw new ConflictException('Product already saved');

    return this.prisma.savedProduct.create({
      data: { userId, productId },
      include: {
        product: {
          include: {
            mediaAssets: true,
            shop: { select: { id: true, name: true, slug: true } },
          },
        },
      },
    });
  }

  async removeSavedProduct(userId: string, productId: string) {
    try {
      await this.prisma.savedProduct.delete({
        where: { userId_productId: { userId, productId } },
      });
      return { success: true };
    } catch (e) {
      throw new NotFoundException('Saved product not found');
    }
  }

  async getSavedProducts(userId: string) {
    const saved = await this.prisma.savedProduct.findMany({
      where: { userId },
      include: {
        product: {
          include: {
            mediaAssets: true,
            shop: {
              select: {
                id: true,
                name: true,
                slug: true,
                city: true,
                rating: true,
                logoUrl: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return saved.map((s: any) => ({
      ...s.product,
      images:
        (s.product.mediaAssets as any[] | undefined)?.map(
          (m: any) => m.secureUrl ?? m.url,
        ) || [],
    }));
  }

  async saveShop(userId: string, shopId: string) {
    const shop = await this.prisma.shop.findUnique({ where: { id: shopId } });
    if (!shop) throw new NotFoundException('Shop not found');

    const existing = await this.prisma.savedShop.findUnique({
      where: { userId_shopId: { userId, shopId } },
    });
    if (existing) throw new ConflictException('Shop already saved');

    const created = await this.prisma.savedShop.create({
      data: { userId, shopId },
      include: { shop: true },
    });
    return scrubNestedShops(created);
  }

  async removeSavedShop(userId: string, shopId: string) {
    try {
      await this.prisma.savedShop.delete({
        where: { userId_shopId: { userId, shopId } },
      });
      return { success: true };
    } catch (e) {
      throw new NotFoundException('Saved shop not found');
    }
  }

  async getSavedShops(userId: string) {
    const saved = await this.prisma.savedShop.findMany({
      where: { userId },
      include: { shop: true },
      orderBy: { createdAt: 'desc' },
    });
    return saved.map((s: any) => omitPrivateShopFields(s.shop));
  }
}

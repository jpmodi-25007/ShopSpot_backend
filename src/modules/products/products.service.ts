import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StockStatus } from '@prisma/client';
import {
  CreateProductDto,
  UpdateProductDto,
  UpdateStockDto,
  ProductQueryDto,
  SearchProductsDto,
} from './dto/product.dto';
import { slugify } from '../../common/helpers/slugify.helper';

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── SHOPKEEPER OPS ───────────────────────────────────────────────────────

  async createProduct(ownerId: string, dto: CreateProductDto) {
    const shop = await this.getOrCreateShop(ownerId);

    if (dto.mrp !== undefined && dto.mrp !== null && Number(dto.sellingPrice) > Number(dto.mrp)) {
      throw new ForbiddenException('Selling price cannot be greater than MRP');
    }

    const slug = `${slugify(dto.name)}-${Date.now()}`;
    const stockStatus = this.deriveStockStatus(
      dto.stockQuantity ?? 0,
      dto.lowStockThreshold ?? 5,
    );

    return this.prisma.product.create({
      data: {
        shopId: shop.id,
        name: dto.name.trim(),
        slug,
        description: dto.description,
        categoryId: dto.categoryId,
        brand: dto.brand,
        mrp: dto.mrp,
        sellingPrice: dto.sellingPrice,
        stockQuantity: dto.stockQuantity ?? 0,
        stockStatus,
        lowStockThreshold: dto.lowStockThreshold ?? 5,
        sku: dto.sku,
        barcode: dto.barcode,
        attributes: dto.attributes as any,
        variants: dto.variants as any,
        tags: dto.tags ?? [],
        mediaAssets: {
          create: dto.mediaAssets?.map((asset, index) => ({
            publicId: asset.publicId,
            secureUrl: asset.secureUrl,
            width: asset.width,
            height: asset.height,
            format: asset.format,
            bytes: asset.bytes,
            resourceType: asset.resourceType || 'image',
            folder: asset.folder,
            entityType: 'PRODUCT',
            isPrimary: index === 0,
            position: index,
          })) || [],
        },
      },
      include: {
        category: true,
        mediaAssets: true,
        shop: { select: { id: true, name: true, slug: true } },
      },
    });
  }

  async getMyProducts(ownerId: string, query: ProductQueryDto) {
    const shop = await this.getOrCreateShop(ownerId);

    const { q, categoryId, stockStatus, page = 1, limit = 20 } = query;

    const where: any = { shopId: shop.id };
    if (q) where.name = { contains: q, mode: 'insensitive' };
    if (categoryId) where.categoryId = categoryId;
    if (stockStatus) where.stockStatus = stockStatus;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        include: { category: true, mediaAssets: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: +limit,
      }),
      this.prisma.product.count({ where }),
    ]);

    return { data, page, limit, total };
  }

  async updateProduct(
    ownerId: string,
    productId: string,
    dto: UpdateProductDto,
  ) {
    await this.assertOwnership(ownerId, productId);

    const existingProduct = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!existingProduct) throw new NotFoundException('Product not found');

    if (dto.mrp !== undefined && dto.mrp !== null && dto.sellingPrice !== undefined) {
      if (Number(dto.sellingPrice) > Number(dto.mrp)) {
        throw new ForbiddenException('Selling price cannot be greater than MRP');
      }
    } else if (dto.sellingPrice !== undefined) {
      if (existingProduct.mrp !== null && Number(dto.sellingPrice) > Number(existingProduct.mrp)) {
        throw new ForbiddenException('Selling price cannot be greater than existing MRP');
      }
    } else if (dto.mrp !== undefined && dto.mrp !== null) {
      if (Number(existingProduct.sellingPrice) > Number(dto.mrp)) {
        throw new ForbiddenException('Existing selling price cannot be greater than new MRP');
      }
    }

    const stockStatus = this.deriveStockStatus(
      dto.stockQuantity ?? existingProduct.stockQuantity,
      dto.lowStockThreshold ?? existingProduct.lowStockThreshold,
    );

    return this.prisma.product.update({
      where: { id: productId },
      data: {
        name: dto.name?.trim(),
        description: dto.description,
        categoryId: dto.categoryId,
        brand: dto.brand,
        mrp: dto.mrp,
        sellingPrice: dto.sellingPrice,
        stockQuantity: dto.stockQuantity,
        stockStatus,
        lowStockThreshold: dto.lowStockThreshold,
        sku: dto.sku,
        barcode: dto.barcode,
        attributes: dto.attributes as any,
        variants: dto.variants as any,
        tags: dto.tags,
      },
    });
  }

  async deleteProduct(ownerId: string, productId: string) {
    await this.assertOwnership(ownerId, productId);
    await this.prisma.product.update({
      where: { id: productId },
      data: { isActive: false },
    });
    return { message: 'Product deleted successfully' };
  }

  async updateStock(ownerId: string, productId: string, dto: UpdateStockDto) {
    await this.assertOwnership(ownerId, productId);
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });
    const stockStatus = this.deriveStockStatus(
      dto.quantity,
      product!.lowStockThreshold,
    );

    return this.prisma.product.update({
      where: { id: productId },
      data: { stockQuantity: dto.quantity, stockStatus },
    });
  }

  // ─── PUBLIC OPS ───────────────────────────────────────────────────────────

  async getProductDetail(productId: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, isActive: true },
      include: {
        category: true,
        mediaAssets: true,
        shop: {
          select: {
            id: true,
            name: true,
            slug: true,
            rating: true,
            city: true,
            latitude: true,
            longitude: true,
            phone: true,
            isGstVerified: true,
            logoUrl: true,
          },
        },
      },
    });
    if (!product) throw new NotFoundException('Product not found');

    // Increment view count async
    this.prisma.product
      .update({
        where: { id: productId },
        data: { viewCount: { increment: 1 } },
      })
      .catch(() => {});

    return product;
  }

  async getPriceComparison(productId: string, lat?: number, lng?: number) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: { shop: true, mediaAssets: true },
    });
    if (!product) throw new NotFoundException('Product not found');

    // Find similar products (same name + category in nearby shops)
    const similar = await this.prisma.product.findMany({
      where: {
        id: { not: productId },
        isActive: true,
        name: {
          contains: product.name.split(' ').slice(0, 3).join(' '),
          mode: 'insensitive',
        },
        categoryId: product.categoryId,
      },
      include: {
        mediaAssets: true,
        shop: {
          select: {
            id: true,
            name: true,
            rating: true,
            latitude: true,
            longitude: true,
            city: true,
            isGstVerified: true,
            logoUrl: true,
          },
        },
      },
      take: 5,
    });

    const results = [product, ...similar]
      .map((p) => ({
        ...p,
        isBestDeal: false,
        distanceKm:
          lat && lng && p.shop
            ? this.haversine(
                lat,
                lng,
                (p.shop as any).latitude,
                (p.shop as any).longitude,
              )
            : null,
      }))
      .sort((a, b) => Number(a.sellingPrice) - Number(b.sellingPrice));

    if (results.length > 0) results[0].isBestDeal = true;
    return results;
  }

  async searchProducts(query: SearchProductsDto) {
    const {
      q,
      categoryId,
      minPrice,
      maxPrice,
      inStock,
      lat,
      lng,
      radiusKm = 10,
      sort = 'relevance',
      page = 1,
      limit = 20,
    } = query;

    const where: any = { isActive: true };
    if (q) where.name = { contains: q, mode: 'insensitive' };
    if (categoryId) where.categoryId = categoryId;
    if (minPrice !== undefined)
      where.sellingPrice = { ...where.sellingPrice, gte: minPrice };
    if (maxPrice !== undefined)
      where.sellingPrice = { ...where.sellingPrice, lte: maxPrice };
    if (inStock) where.stockStatus = { not: 'OUT_OF_STOCK' };

    const orderBy: any =
      sort === 'price_asc'
        ? { sellingPrice: 'asc' }
        : sort === 'price_desc'
          ? { sellingPrice: 'desc' }
          : sort === 'rating'
            ? { shop: { rating: 'desc' } }
            : { viewCount: 'desc' };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        include: {
          category: true,
          shop: {
            select: {
              id: true,
              name: true,
              rating: true,
              city: true,
              latitude: true,
              longitude: true,
            },
          },
        },
        orderBy,
        skip: (page - 1) * limit,
        take: +limit,
      }),
      this.prisma.product.count({ where }),
    ]);

    return { data, page, limit, total };
  }

  async getTrending(limit = 10) {
    return this.prisma.product.findMany({
      where: { isActive: true },
      orderBy: { viewCount: 'desc' },
      take: limit,
      include: {
        category: true,
        shop: { select: { id: true, name: true, rating: true, city: true } },
      },
    });
  }

  // ─── HELPERS ──────────────────────────────────────────────────────────────

  private async getOrCreateShop(ownerId: string) {
    let shop = await this.prisma.shop.findUnique({ where: { ownerId } });
    if (!shop) {
      const user = await this.prisma.user.findUnique({ where: { id: ownerId } });
      shop = await this.prisma.shop.create({
        data: {
          ownerId,
          name: `${user?.name || 'Retailer'}'s Shop`,
          slug: `shop-${ownerId.substring(0, 8)}-${Date.now()}`,
          address: 'Please update your shop address',
          latitude: 0,
          longitude: 0,
          status: 'ACTIVE',
        },
      });
    }
    return shop;
  }

  private async assertOwnership(ownerId: string, productId: string) {
    const shop = await this.getOrCreateShop(ownerId);
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });
    if (!product) throw new NotFoundException('Product not found');
    if (product.shopId !== shop.id)
      throw new ForbiddenException('Not your product');
  }

  private deriveStockStatus(quantity: number, threshold: number): StockStatus {
    if (quantity === 0) return StockStatus.OUT_OF_STOCK;
    if (quantity <= threshold) return StockStatus.LOW_STOCK;
    return StockStatus.IN_STOCK;
  }

  private haversine(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
}

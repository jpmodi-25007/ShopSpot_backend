import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateShopDto, UpdateShopDto, NearbyQueryDto } from './dto/shop.dto';
import { ShopStatus } from '@prisma/client';
import { slugify } from '../../common/helpers/slugify.helper';

@Injectable()
export class ShopsService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── SHOPKEEPER OPS ───────────────────────────────────────────────────────

  async createShop(ownerId: string, dto: CreateShopDto) {
    const existing = await this.prisma.shop.findUnique({ where: { ownerId } });
    if (existing)
      throw new ConflictException('Shopkeeper already has a registered shop');

    const slug = await this.uniqueSlug(dto.name);

    return this.prisma.shop.create({
      data: {
        ownerId,
        slug,
        name: dto.name.trim(),
        description: dto.description,
        categoryId: dto.categoryId,
        address: dto.address,
        latitude: dto.latitude,
        longitude: dto.longitude,
        city: dto.city,
        state: dto.state,
        pincode: dto.pincode,
        phone: dto.phone,
        whatsapp: dto.whatsapp,
        email: dto.email,
        gstNumber: dto.gstNumber,
        businessHours: dto.businessHours as any,
      },
      include: {
        category: true,
        owner: { select: { id: true, name: true, email: true } },
      },
    });
  }

  async getMyShop(ownerId: string) {
    const shop = await this.prisma.shop.findUnique({
      where: { ownerId },
      include: {
        category: true,
        subscriptions: {
          where: { isActive: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });
    if (!shop) throw new NotFoundException('Shop not found');
    return shop;
  }

  async updateShop(ownerId: string, dto: UpdateShopDto) {
    const shop = await this.prisma.shop.findUnique({ where: { ownerId } });
    if (!shop) throw new NotFoundException('Shop not found');

    return this.prisma.shop.update({
      where: { id: shop.id },
      data: {
        name: dto.name?.trim(),
        description: dto.description,
        categoryId: dto.categoryId,
        address: dto.address,
        latitude: dto.latitude,
        longitude: dto.longitude,
        city: dto.city,
        state: dto.state,
        pincode: dto.pincode,
        phone: dto.phone,
        whatsapp: dto.whatsapp,
        email: dto.email,
        gstNumber: dto.gstNumber,
        businessHours: dto.businessHours as any,
      },
    });
  }

  async updateLogo(ownerId: string, logoUrl: string) {
    const shop = await this.prisma.shop.findUnique({ where: { ownerId } });
    if (!shop) throw new NotFoundException('Shop not found');
    return this.prisma.shop.update({
      where: { id: shop.id },
      data: { logoUrl },
    });
  }

  async updateCover(ownerId: string, coverImageUrl: string) {
    const shop = await this.prisma.shop.findUnique({ where: { ownerId } });
    if (!shop) throw new NotFoundException('Shop not found');
    return this.prisma.shop.update({
      where: { id: shop.id },
      data: { coverImageUrl },
    });
  }

  // ─── PUBLIC OPS ───────────────────────────────────────────────────────────

  async getPublicShop(shopId: string) {
    const shop = await this.prisma.shop.findFirst({
      where: { id: shopId, status: ShopStatus.ACTIVE },
      include: {
        category: true,
        offers: { where: { isActive: true, expiresAt: { gt: new Date() } } },
        _count: {
          select: { products: { where: { isActive: true } }, reviews: true },
        },
      },
    });
    if (!shop) throw new NotFoundException('Shop not found');
    return shop;
  }

  async getShopProducts(shopId: string, page = 1, limit = 20) {
    const [data, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where: { shopId, isActive: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { category: true },
      }),
      this.prisma.product.count({ where: { shopId, isActive: true } }),
    ]);
    return { data, page, limit, total };
  }

  async getShopReviews(shopId: string, page = 1, limit = 20) {
    const [data, total] = await this.prisma.$transaction([
      this.prisma.review.findMany({
        where: { shopId, isPublic: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          customer: { select: { id: true, name: true, avatarUrl: true } },
        },
      }),
      this.prisma.review.count({ where: { shopId, isPublic: true } }),
    ]);
    return { data, page, limit, total };
  }

  async getShopOffers(shopId: string) {
    return this.prisma.offer.findMany({
      where: { shopId, isActive: true, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getNearbyShops(query: NearbyQueryDto) {
    const { lat, lng, radiusKm = 5, categoryId, page = 1, limit = 20 } = query;
    const radiusDeg = radiusKm / 111; // ~111 km per degree

    const where: any = {
      status: ShopStatus.ACTIVE,
      latitude: { gte: lat - radiusDeg, lte: lat + radiusDeg },
      longitude: { gte: lng - radiusDeg, lte: lng + radiusDeg },
    };
    if (categoryId) where.categoryId = categoryId;

    const shops = await this.prisma.shop.findMany({
      where,
      include: { category: true, _count: { select: { products: true } } },
      orderBy: { rating: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    });

    // Calculate accurate distance & filter
    const withDistance = shops
      .map((s) => ({
        ...s,
        distanceKm: this.haversine(lat, lng, s.latitude, s.longitude),
      }))
      .filter((s) => s.distanceKm <= radiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm);

    return { data: withDistance, page, limit, total: withDistance.length };
  }

  async findShopByOwnerId(ownerId: string) {
    return this.prisma.shop.findUnique({ where: { ownerId } });
  }

  // ─── HELPERS ──────────────────────────────────────────────────────────────

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

  private async uniqueSlug(name: string): Promise<string> {
    let slug = slugify(name);
    let count = 0;
    while (await this.prisma.shop.findUnique({ where: { slug } })) {
      count++;
      slug = `${slugify(name)}-${count}`;
    }
    return slug;
  }
}

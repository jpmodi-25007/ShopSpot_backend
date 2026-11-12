import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { omitPrivateShopFields } from '../../common/helpers/sanitize.helper';
import { CreateShopDto, UpdateShopDto, NearbyQueryDto } from './dto/shop.dto';
import { ShopStatus } from '@prisma/client';
import { slugify } from '../../common/helpers/slugify.helper';

/** Upper bound for list endpoints so one request cannot pull a whole table. */
const MAX_PAGE_SIZE = 100;
/** Max shops inspected for one nearby query (bounding-box candidates). */
const NEARBY_CANDIDATE_LIMIT = 500;

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
        logoUrl: dto.logoUrl,
        coverImageUrl: dto.coverImageUrl,
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
    return omitPrivateShopFields(shop);
  }

  async getShopProducts(shopId: string, page = 1, limit = 20) {
    const [data, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where: { shopId, isActive: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: Math.min(Math.max(+limit || 20, 1), MAX_PAGE_SIZE),
        include: {
          category: true,
          mediaAssets: { orderBy: { isPrimary: 'desc' } },
        },
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
        take: Math.min(Math.max(+limit || 20, 1), MAX_PAGE_SIZE),
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
    const pageSize = Math.min(Math.max(+limit || 20, 1), MAX_PAGE_SIZE);
    const currentPage = Math.max(+page || 1, 1);

    // Bounding box pre-filter. A degree of longitude shrinks with cos(latitude),
    // so the longitude delta must be widened accordingly or nearby shops east /
    // west of the user are missed at higher latitudes.
    const latDelta = radiusKm / 111; // ~111 km per degree of latitude
    const cosLat = Math.max(Math.cos((lat * Math.PI) / 180), 0.01);
    const lngDelta = radiusKm / (111 * cosLat);

    const where: any = {
      status: ShopStatus.ACTIVE,
      latitude: { gte: lat - latDelta, lte: lat + latDelta },
      longitude: { gte: lng - lngDelta, lte: lng + lngDelta },
    };
    if (categoryId) where.categoryId = categoryId;

    const candidates = await this.prisma.shop.findMany({
      where,
      include: { category: true, _count: { select: { products: true } } },
      orderBy: { rating: 'desc' },
      take: NEARBY_CANDIDATE_LIMIT,
    });

    // Exact distance filter happens BEFORE pagination so pages are complete
    // and `total` reflects every shop inside the radius.
    const inRadius = candidates
      .map((s) => ({
        ...omitPrivateShopFields(s),
        distanceKm: this.haversine(lat, lng, s.latitude, s.longitude),
      }))
      .filter((s) => s.distanceKm <= radiusKm);

    // Nearest first across ALL pages (sorting after slicing only ordered each
    // page in isolation).
    const pageItems = inRadius
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice((currentPage - 1) * pageSize, currentPage * pageSize);

    return {
      data: pageItems,
      page: currentPage,
      limit: pageSize,
      total: inRadius.length,
    };
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

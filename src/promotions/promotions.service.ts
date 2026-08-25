import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PromotionsService {
  constructor(private prisma: PrismaService) {}

  // Fetch all active banners currently within valid dates
  async getActivePromotions() {
    const now = new Date();
    return this.prisma.promotionBanner.findMany({
      where: {
        isActive: true,
        OR: [
          { startDate: null, endDate: null },
          { startDate: { lte: now }, endDate: null },
          { startDate: null, endDate: { gte: now } },
          { startDate: { lte: now }, endDate: { gte: now } },
        ],
      },
      orderBy: { displayOrder: 'asc' },
      take: 5, // Up to 5 banners
    });
  }

  // Fetch all banners (for admin)
  async getAllPromotions() {
    return this.prisma.promotionBanner.findMany({
      orderBy: [
        { isActive: 'desc' },
        { displayOrder: 'asc' },
        { createdAt: 'desc' },
      ],
    });
  }

  // Create a new banner
  async createPromotion(data: any) {
    if (data.isActive !== false) {
      const activeCount = await this.prisma.promotionBanner.count({ where: { isActive: true } });
      if (activeCount >= 5) {
        throw new BadRequestException('Maximum of 5 active promotional banners is allowed.');
      }
    }

    return this.prisma.promotionBanner.create({
      data: {
        imageUrl: data.imageUrl,
        title: data.title,
        shopId: data.shopId || null,
        productId: data.productId || null,
        startDate: data.startDate ? new Date(data.startDate) : null,
        endDate: data.endDate ? new Date(data.endDate) : null,
        isActive: data.isActive ?? true,
        displayOrder: data.displayOrder || 0,
      },
    });
  }

  // Update a banner
  async updatePromotion(id: string, data: any) {
    const banner = await this.prisma.promotionBanner.findUnique({ where: { id } });
    if (!banner) throw new NotFoundException('Promotion not found');

    if (data.isActive === true && !banner.isActive) {
      const activeCount = await this.prisma.promotionBanner.count({ where: { isActive: true } });
      if (activeCount >= 5) {
        throw new BadRequestException('Maximum of 5 active promotional banners is allowed.');
      }
    }

    return this.prisma.promotionBanner.update({
      where: { id },
      data: {
        imageUrl: data.imageUrl,
        title: data.title,
        shopId: data.shopId || null,
        productId: data.productId || null,
        startDate: data.startDate !== undefined ? (data.startDate ? new Date(data.startDate) : null) : undefined,
        endDate: data.endDate !== undefined ? (data.endDate ? new Date(data.endDate) : null) : undefined,
        isActive: data.isActive,
        displayOrder: data.displayOrder,
      },
    });
  }

  // Delete a banner
  async deletePromotion(id: string) {
    const banner = await this.prisma.promotionBanner.findUnique({ where: { id } });
    if (!banner) throw new NotFoundException('Promotion not found');

    return this.prisma.promotionBanner.delete({ where: { id } });
  }
}

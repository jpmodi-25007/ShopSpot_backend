import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

import { CreateReviewDto } from './dto/review.dto';

/** Upper bound for list endpoints so one request cannot pull a whole table. */
const MAX_PAGE_SIZE = 100;

@Injectable()
export class ReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  async createReview(customerId: string, dto: CreateReviewDto) {
    if (dto.shopId) {
      const shop = await this.prisma.shop.findUnique({
        where: { id: dto.shopId },
        select: { id: true },
      });
      if (!shop) throw new NotFoundException('Shop not found');
    }
    if (dto.productId) {
      const product = await this.prisma.product.findUnique({
        where: { id: dto.productId },
        select: { id: true },
      });
      if (!product) throw new NotFoundException('Product not found');
    }

    return this.prisma.$transaction(async (tx) => {
      // 1. Guard: one review per customer per shop
      if (dto.shopId) {
        const existing = await tx.review.findFirst({
          where: { customerId, shopId: dto.shopId },
        });
        if (existing) {
          // Update the existing review instead of creating a duplicate
          const updated = await tx.review.update({
            where: { id: existing.id },
            data: { rating: dto.rating, comment: dto.comment },
          });
          // Recalculate shop rating
          const agg = await tx.review.aggregate({
            where: { shopId: dto.shopId, isPublic: true },
            _avg: { rating: true },
            _count: { id: true },
          });
          await tx.shop.update({
            where: { id: dto.shopId },
            data: {
              rating: agg._avg.rating || 0,
              reviewCount: agg._count.id || 0,
            },
          });
          return updated;
        }
      }

      // 2. Create the review
      // `mediaUrls` is the API name for the Review.images column.
      const { mediaUrls, ...reviewFields } = dto;
      const review = await tx.review.create({
        data: {
          ...reviewFields,
          images: mediaUrls ?? [],
          customerId,
          isPublic: true,
        },
      });

      // 3. If it's a shop review, recalculate the shop's rating
      if (dto.shopId) {
        const agg = await tx.review.aggregate({
          where: { shopId: dto.shopId, isPublic: true },
          _avg: { rating: true },
          _count: { id: true },
        });
        await tx.shop.update({
          where: { id: dto.shopId },
          data: {
            rating: agg._avg.rating || 0,
            reviewCount: agg._count.id || 0,
          },
        });
      }

      return review;
    });
  }

  async getMyReviews(customerId: string, page = 1, limit = 20) {
    const [data, total] = await this.prisma.$transaction([
      this.prisma.review.findMany({
        where: { customerId },
        skip: (page - 1) * limit,
        take: Math.min(Math.max(+limit || 20, 1), MAX_PAGE_SIZE),
      }),
      this.prisma.review.count({ where: { customerId } }),
    ]);
    return { data, page, limit, total };
  }
}

import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

import { CreateReviewDto } from './dto/review.dto';

@Injectable()
export class ReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  async createReview(customerId: string, dto: CreateReviewDto) {
    return this.prisma.$transaction(async (tx) => {
      // 1. Create the review
      const review = await tx.review.create({
        data: {
          ...dto,
          customerId,
          isPublic: true,
        },
      });

      // 2. If it's a shop review, recalculate the shop's rating
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
            reviewCount: agg._count.id || 0
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
        take: +limit,
      }),
      this.prisma.review.count({ where: { customerId } }),
    ]);
    return { data, page, limit, total };
  }
}

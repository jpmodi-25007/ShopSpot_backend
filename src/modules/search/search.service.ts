import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { GlobalSearchDto } from './dto/search.dto';

@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  async globalSearch(query: GlobalSearchDto) {
    const q = query.q || '';
    if (!q.trim()) {
      return { shops: [], products: [], categories: [] };
    }

    const [shops, products, categories] = await Promise.all([
      this.prisma.shop.findMany({
        where: { name: { contains: q, mode: 'insensitive' } },
        take: 5,
        select: { id: true, name: true, logoUrl: true, rating: true, city: true },
      }),
      this.prisma.product.findMany({
        where: { name: { contains: q, mode: 'insensitive' } },
        take: 10,
        select: { id: true, name: true, sellingPrice: true, mediaAssets: true, shopId: true },
      }),
      this.prisma.category.findMany({
        where: { name: { contains: q, mode: 'insensitive' } },
        take: 5,
        select: { id: true, name: true, slug: true, iconUrl: true },
      }),
    ]);

    return {
      shops,
      products,
      categories,
    };
  }
}

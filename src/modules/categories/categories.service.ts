import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}
  async findAll() {
    return this.prisma.category.findMany({
      where: { isActive: true },
      orderBy: { displayOrder: 'asc' },
    });
  }
  async findTree() {
    const all = await this.prisma.category.findMany({
      where: { isActive: true },
      orderBy: { displayOrder: 'asc' },
    });
    return all
      .filter((c) => !c.parentId)
      .map((cat) => ({
        ...cat,
        children: all.filter((c) => c.parentId === cat.id),
      }));
  }
}

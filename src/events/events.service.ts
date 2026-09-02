import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class EventsService {
  constructor(private prisma: PrismaService) {}

  async create(ownerId: string, data: any) {
    const shop = await this.prisma.shop.findUnique({
      where: { ownerId }
    });
    if (!shop) throw new NotFoundException('Shop not found');

    return this.prisma.event.create({
      data: {
        ...data,
        shopId: shop.id,
      },
    });
  }

  async findAll() {
    return this.prisma.event.findMany({
      where: {
        isActive: true,
        endDate: {
          gte: new Date(),
        }
      },
      orderBy: { createdAt: 'desc' },
      include: {
        shop: true,
      },
    });
  }

  async findShopEvents(shopId: string) {
    return this.prisma.event.findMany({
      where: {
        shop: {
          ownerId: shopId
        }
      },
      orderBy: { createdAt: 'desc' },
      include: {
        shop: true,
      },
    });
  }

  async findOne(id: string) {
    const event = await this.prisma.event.findUnique({
      where: { id },
      include: {
        shop: true,
      },
    });
    if (!event) {
      throw new NotFoundException(`Event with ID ${id} not found`);
    }
    return event;
  }

  async update(id: string, data: any) {
    // Check if exists
    await this.findOne(id);
    return this.prisma.event.update({
      where: { id },
      data,
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.event.delete({
      where: { id },
    });
  }
}

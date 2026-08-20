import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NegotiationStatus } from '@prisma/client';

@Injectable()
export class NegotiationsService {
  constructor(private readonly prisma: PrismaService) {}

  async startNegotiation(
    customerId: string,
    dto: { productId: string; offeredPrice: number; message?: string },
  ) {
    const product = await this.prisma.product.findUnique({
      where: { id: dto.productId },
      include: { shop: true },
    });
    if (!product || !product.isActive)
      throw new NotFoundException('Product not found');
    const neg = await this.prisma.negotiation.create({
      data: {
        productId: dto.productId,
        shopId: product.shopId,
        customerId,
        initialPrice: product.sellingPrice,
        offeredPrice: dto.offeredPrice,
        customerMessage: dto.message,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        status: NegotiationStatus.PENDING,
      },
      include: {
        product: {
          select: { id: true, name: true, images: true, sellingPrice: true },
        },
        shop: { select: { id: true, name: true } },
      },
    });
    await this.prisma.product.update({
      where: { id: dto.productId },
      data: { inquiryCount: { increment: 1 } },
    });
    return neg;
  }

  async getMyNegotiations(customerId: string, page = 1, limit = 20) {
    const [data, total] = await this.prisma.$transaction([
      this.prisma.negotiation.findMany({
        where: { customerId },
        include: {
          product: { select: { id: true, name: true, images: true } },
          shop: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: +limit,
      }),
      this.prisma.negotiation.count({ where: { customerId } }),
    ]);
    return { data, page, limit, total };
  }

  async getNegotiationDetail(id: string, userId: string) {
    const neg = await this.prisma.negotiation.findUnique({
      where: { id },
      include: {
        product: true,
        shop: true,
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!neg) throw new NotFoundException('Negotiation not found');
    if (neg.customerId !== userId)
      throw new ForbiddenException('Not your negotiation');
    return neg;
  }

  async counterOffer(id: string, customerId: string, counterPrice: number) {
    const neg = await this.prisma.negotiation.findUnique({ where: { id } });
    if (!neg) throw new NotFoundException();
    if (neg.customerId !== customerId) throw new ForbiddenException();
    if (neg.status !== NegotiationStatus.COUNTERED)
      throw new BadRequestException('No counter to respond to');
    return this.prisma.negotiation.update({
      where: { id },
      data: {
        offeredPrice: counterPrice,
        status: NegotiationStatus.PENDING,
        counterRound: { increment: 1 },
      },
    });
  }

  async acceptDeal(id: string, customerId: string) {
    const neg = await this.prisma.negotiation.findUnique({ where: { id } });
    if (!neg) throw new NotFoundException();
    if (neg.customerId !== customerId) throw new ForbiddenException();
    if (
      neg.status !== NegotiationStatus.COUNTERED &&
      neg.status !== NegotiationStatus.PENDING
    )
      throw new BadRequestException('Cannot accept in current state');
    return this.prisma.negotiation.update({
      where: { id },
      data: {
        status: NegotiationStatus.ACCEPTED,
        acceptedAt: new Date(),
        finalPrice: neg.counterPrice ?? neg.offeredPrice,
      },
    });
  }

  async rejectDeal(id: string, customerId: string) {
    const neg = await this.prisma.negotiation.findUnique({ where: { id } });
    if (!neg || neg.customerId !== customerId) throw new ForbiddenException();
    return this.prisma.negotiation.update({
      where: { id },
      data: { status: NegotiationStatus.REJECTED },
    });
  }

  // Shopkeeper side
  async getShopNegotiations(
    ownerId: string,
    status?: string,
    page = 1,
    limit = 20,
  ) {
    const shop = await this.prisma.shop.findUnique({ where: { ownerId } });
    if (!shop) throw new ForbiddenException();
    const where: any = { shopId: shop.id };
    if (status) where.status = status;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.negotiation.findMany({
        where,
        include: {
          product: { select: { id: true, name: true, images: true } },
          messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: +limit,
      }),
      this.prisma.negotiation.count({ where }),
    ]);
    return { data, page, limit, total };
  }

  async shopkeeperCounter(
    negId: string,
    ownerId: string,
    counterPrice: number,
    message?: string,
  ) {
    const shop = await this.prisma.shop.findUnique({ where: { ownerId } });
    const neg = await this.prisma.negotiation.findUnique({
      where: { id: negId },
    });
    if (!neg || neg.shopId !== shop?.id) throw new ForbiddenException();
    if (neg.counterRound >= 3)
      throw new BadRequestException('Maximum counter rounds reached');
    return this.prisma.negotiation.update({
      where: { id: negId },
      data: {
        counterPrice,
        shopkeeperMessage: message,
        status: NegotiationStatus.COUNTERED,
        counterRound: { increment: 1 },
      },
    });
  }

  async shopkeeperAccept(negId: string, ownerId: string) {
    const shop = await this.prisma.shop.findUnique({ where: { ownerId } });
    const neg = await this.prisma.negotiation.findUnique({
      where: { id: negId },
    });
    if (!neg || neg.shopId !== shop?.id) throw new ForbiddenException();
    return this.prisma.negotiation.update({
      where: { id: negId },
      data: {
        status: NegotiationStatus.ACCEPTED,
        acceptedAt: new Date(),
        finalPrice: neg.offeredPrice,
      },
    });
  }

  async shopkeeperReject(negId: string, ownerId: string) {
    const shop = await this.prisma.shop.findUnique({ where: { ownerId } });
    const neg = await this.prisma.negotiation.findUnique({
      where: { id: negId },
    });
    if (!neg || neg.shopId !== shop?.id) throw new ForbiddenException();
    return this.prisma.negotiation.update({
      where: { id: negId },
      data: { status: NegotiationStatus.REJECTED },
    });
  }
}

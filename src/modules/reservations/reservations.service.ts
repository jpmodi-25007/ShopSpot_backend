import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { ReservationStatus, NotificationType } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class ReservationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async createReservation(
    customerId: string,
    dto: {
      productId: string;
      reservedPrice: number;
      quantity?: number;
      negotiationId?: string;
    },
  ) {
    const product = await this.prisma.product.findUnique({
      where: { id: dto.productId },
    });
    if (!product || !product.isActive)
      throw new NotFoundException('Product not found');
    if (product.stockQuantity < (dto.quantity ?? 1))
      throw new BadRequestException('Insufficient stock');

    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2 hours
    const qrPayload = {
      productId: dto.productId,
      customerId,
      expiresAt: expiresAt.toISOString(),
    };
    const qrToken = this.jwtService.sign(qrPayload, {
      secret: this.config.get('QR_SIGNING_SECRET'),
      expiresIn: '2h',
    });

    const reservation = await this.prisma.reservation.create({
      data: {
        productId: dto.productId,
        shopId: product.shopId,
        customerId,
        reservedPrice: dto.reservedPrice,
        quantity: dto.quantity ?? 1,
        negotiationId: dto.negotiationId,
        qrToken,
        expiresAt,
        status: ReservationStatus.ACTIVE,
      },
      include: {
        product: { select: { id: true, name: true, images: true } },
        shop: { select: { id: true, name: true, address: true, phone: true, ownerId: true } },
      },
    });

    await this.prisma.product.update({
      where: { id: dto.productId },
      data: { reservationCount: { increment: 1 } },
    });

    // Notify shop owner
    this.notificationsService.sendNotification(
      reservation.shop.ownerId,
      NotificationType.RESERVATION_CREATED,
      'New Product Reservation',
      `A customer reserved ${dto.quantity ?? 1}x ${product.name}`,
      { reservationId: reservation.id, productId: dto.productId }
    );

    return { ...reservation, qrToken };
  }

  async getMyReservations(customerId: string, page = 1, limit = 20) {
    const [data, total] = await this.prisma.$transaction([
      this.prisma.reservation.findMany({
        where: { customerId },
        include: {
          product: { select: { id: true, name: true, images: true } },
          shop: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: +limit,
      }),
      this.prisma.reservation.count({ where: { customerId } }),
    ]);
    return { data, page, limit, total };
  }

  async cancelReservation(id: string, customerId: string) {
    const res = await this.prisma.reservation.findUnique({ where: { id } });
    if (!res || res.customerId !== customerId) throw new ForbiddenException();
    if (res.status !== ReservationStatus.ACTIVE)
      throw new BadRequestException('Cannot cancel');
    return this.prisma.reservation.update({
      where: { id },
      data: { status: ReservationStatus.CANCELLED },
    });
  }

  async verifyQr(ownerId: string, qrToken: string) {
    try {
      this.jwtService.verify(qrToken, {
        secret: this.config.get('QR_SIGNING_SECRET'),
      });
    } catch {
      throw new BadRequestException('Invalid or expired QR code');
    }
    const res = await this.prisma.reservation.findUnique({
      where: { qrToken },
      include: {
        product: { select: { id: true, name: true } },
        customer: { select: { id: true, name: true } },
      },
    });
    if (!res) throw new NotFoundException('Reservation not found');
    const shop = await this.prisma.shop.findUnique({ where: { ownerId } });
    if (res.shopId !== shop?.id)
      throw new ForbiddenException('Not your reservation');
    if (res.status !== ReservationStatus.ACTIVE || res.expiresAt < new Date())
      throw new BadRequestException('Reservation expired or not active');
    return res;
  }

  async completeReservation(id: string, ownerId: string) {
    const shop = await this.prisma.shop.findUnique({ where: { ownerId } });
    const res = await this.prisma.reservation.findUnique({ where: { id } });
    if (!res || res.shopId !== shop?.id) throw new ForbiddenException();
    return this.prisma.reservation.update({
      where: { id },
      data: { status: ReservationStatus.COMPLETED, visitedAt: new Date() },
    });
  }

  async getShopReservations(ownerId: string, page = 1, limit = 20) {
    const shop = await this.prisma.shop.findUnique({ where: { ownerId } });
    if (!shop) throw new ForbiddenException();
    const [data, total] = await this.prisma.$transaction([
      this.prisma.reservation.findMany({
        where: { shopId: shop.id },
        include: {
          product: { select: { id: true, name: true } },
          customer: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: +limit,
      }),
      this.prisma.reservation.count({ where: { shopId: shop.id } }),
    ]);
    return { data, page, limit, total };
  }
}

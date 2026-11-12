import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import {
  NegotiationStatus,
  NotificationType,
  ReservationStatus,
} from '@prisma/client';
import { NotificationFactory } from '../notifications/notification.factory';
import { JwtService } from '@nestjs/jwt';
import { NotificationsService } from '../notifications/notifications.service';

/** Upper bound for list endpoints so one request cannot pull a whole table. */
const MAX_PAGE_SIZE = 100;
/** Tolerated clock skew when a customer picks a new pickup time. */
const RESCHEDULE_PAST_GRACE_MS = 5 * 60 * 1000;
/** Max reservations released per cron tick. */
const EXPIRY_BATCH_SIZE = 200;

@Injectable()
export class ReservationsService {
  private readonly logger = new Logger(ReservationsService.name);
  private expiryRunning = false;

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
      reservedPrice?: number;
      quantity?: number;
      negotiationId?: string;
    },
  ) {
    const quantity = dto.quantity ?? 1;
    const product = await this.prisma.product.findUnique({
      where: { id: dto.productId },
    });
    if (!product || !product.isActive)
      throw new NotFoundException('Product not found');
    if (product.stockQuantity < quantity)
      throw new BadRequestException('Insufficient stock');

    // The reserved price is never taken from the client. It is the product's
    // current selling price, or the agreed price of an accepted negotiation
    // that belongs to this customer and product.
    let reservedPrice = Number(product.sellingPrice);
    if (dto.negotiationId) {
      const negotiation = await this.prisma.negotiation.findFirst({
        where: {
          id: dto.negotiationId,
          customerId,
          productId: dto.productId,
          status: NegotiationStatus.ACCEPTED,
          finalPrice: { not: null },
          reservations: {
            none: {
              status: {
                in: [ReservationStatus.ACTIVE, ReservationStatus.COMPLETED],
              },
            },
          },
        },
      });
      if (!negotiation) {
        throw new BadRequestException(
          'Negotiation is not accepted or has already been used',
        );
      }
      reservedPrice = Number(negotiation.finalPrice);
    }

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

    // Use a transaction so the stock decrement and reservation are atomic.
    const [reservation] = await this.prisma.$transaction(async (tx) => {
      // Atomic conditional decrement: succeeds only if enough stock remains,
      // so concurrent reservations can never push stock below zero.
      const decremented = await tx.product.updateMany({
        where: {
          id: dto.productId,
          isActive: true,
          stockQuantity: { gte: quantity },
        },
        data: {
          reservationCount: { increment: 1 },
          stockQuantity: { decrement: quantity },
        },
      });
      if (decremented.count === 0) {
        throw new BadRequestException('Insufficient stock');
      }

      const res = await tx.reservation.create({
        data: {
          productId: dto.productId,
          shopId: product.shopId,
          customerId,
          reservedPrice,
          quantity,
          negotiationId: dto.negotiationId,
          qrToken,
          expiresAt,
          status: ReservationStatus.ACTIVE,
        },
        include: {
          product: { select: { id: true, name: true, mediaAssets: true } },
          shop: {
            select: {
              id: true,
              name: true,
              address: true,
              phone: true,
              ownerId: true,
            },
          },
        },
      });

      await tx.stockHistory.create({
        data: {
          productId: dto.productId,
          quantity: -quantity,
          reason: 'SALE',
          note: `Reserved by customer`,
        },
      });

      return [res];
    });

    // Notify shop owner
    const payload = NotificationFactory.reservationCreated(
      reservation.id,
      dto.productId,
    );

    this.notificationsService.sendNotification(
      reservation.shop.ownerId,
      NotificationType.RESERVATION_CREATED,
      'New Product Reservation',
      `A customer reserved ${quantity}x ${product.name}`,
      payload,
    );

    return { ...reservation, qrToken };
  }

  async getMyReservations(customerId: string, page = 1, limit = 20) {
    const [data, total] = await this.prisma.$transaction([
      this.prisma.reservation.findMany({
        where: { customerId },
        include: {
          product: { select: { id: true, name: true, mediaAssets: true } },
          shop: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: Math.min(Math.max(+limit || 20, 1), MAX_PAGE_SIZE),
      }),
      this.prisma.reservation.count({ where: { customerId } }),
    ]);
    return { data, page, limit, total };
  }

  async cancelReservation(id: string, customerId: string) {
    return this.prisma.$transaction(async (tx) => {
      const res = await tx.reservation.findUnique({ where: { id } });
      if (!res || res.customerId !== customerId) throw new ForbiddenException();
      if (res.status !== ReservationStatus.ACTIVE)
        throw new BadRequestException('Cannot cancel');

      // Conditional update: two concurrent cancels must not both restore stock.
      const claimed = await tx.reservation.updateMany({
        where: { id, status: ReservationStatus.ACTIVE },
        data: { status: ReservationStatus.CANCELLED },
      });
      if (claimed.count === 0) throw new BadRequestException('Cannot cancel');

      await tx.product.update({
        where: { id: res.productId },
        data: { stockQuantity: { increment: res.quantity } },
      });

      await tx.stockHistory.create({
        data: {
          productId: res.productId,
          quantity: res.quantity,
          reason: 'RETURN',
          note: `Reservation cancelled by customer`,
        },
      });

      return tx.reservation.findUniqueOrThrow({ where: { id } });
    });
  }

  async shopkeeperCancelReservation(id: string, ownerId: string) {
    return this.prisma.$transaction(async (tx) => {
      const res = await tx.reservation.findUnique({ where: { id } });
      if (!res) throw new NotFoundException();
      const shop = await tx.shop.findUnique({ where: { ownerId } });
      if (res.shopId !== shop?.id)
        throw new ForbiddenException('Not your reservation');
      if (res.status !== ReservationStatus.ACTIVE)
        throw new BadRequestException('Cannot cancel');

      // Conditional update: two concurrent cancels must not both restore stock.
      const claimed = await tx.reservation.updateMany({
        where: { id, status: ReservationStatus.ACTIVE },
        data: { status: ReservationStatus.CANCELLED },
      });
      if (claimed.count === 0) throw new BadRequestException('Cannot cancel');

      await tx.product.update({
        where: { id: res.productId },
        data: { stockQuantity: { increment: res.quantity } },
      });

      await tx.stockHistory.create({
        data: {
          productId: res.productId,
          quantity: res.quantity,
          reason: 'RETURN',
          note: `Reservation cancelled by shopkeeper`,
        },
      });

      return tx.reservation.findUniqueOrThrow({ where: { id } });
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
    if (res.status !== ReservationStatus.ACTIVE)
      throw new BadRequestException(
        'Only active reservations can be completed',
      );
    const result = await this.prisma.reservation.updateMany({
      where: { id, status: ReservationStatus.ACTIVE },
      data: { status: ReservationStatus.COMPLETED, visitedAt: new Date() },
    });
    if (result.count === 0)
      throw new BadRequestException(
        'Only active reservations can be completed',
      );
    return this.prisma.reservation.findUniqueOrThrow({ where: { id } });
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
        take: Math.min(Math.max(+limit || 20, 1), MAX_PAGE_SIZE),
      }),
      this.prisma.reservation.count({ where: { shopId: shop.id } }),
    ]);
    return { data, page, limit, total };
  }

  async rescheduleReservation(
    id: string,
    customerId: string,
    newDateTime: Date,
  ) {
    const res = await this.prisma.reservation.findUnique({ where: { id } });
    if (!res || res.customerId !== customerId) throw new ForbiddenException();
    if (res.status !== ReservationStatus.ACTIVE)
      throw new BadRequestException(
        'Only active reservations can be rescheduled',
      );

    if (Number.isNaN(newDateTime.getTime()))
      throw new BadRequestException('Invalid date');
    // A pickup time in the past would create an already-expired reservation
    // that the expiry job immediately cancels. Allow a small clock-skew grace.
    if (newDateTime.getTime() < Date.now() - RESCHEDULE_PAST_GRACE_MS)
      throw new BadRequestException('New pickup time cannot be in the past');
    const newExpiresAt = new Date(newDateTime.getTime() + 2 * 60 * 60 * 1000);
    // Keep the JWT lifetime aligned with the reservation (min 60s: a past date
    // yields an already-expired reservation, which verifyQr rejects anyway).
    const secondsUntilExpiry = Math.max(
      60,
      Math.floor((newExpiresAt.getTime() - Date.now()) / 1000),
    );
    const qrPayload = {
      productId: res.productId,
      customerId,
      expiresAt: newExpiresAt.toISOString(),
    };
    // The QR token must stay valid for as long as the reservation does.
    const qrToken = this.jwtService.sign(qrPayload, {
      secret: this.config.get('QR_SIGNING_SECRET'),
      expiresIn: secondsUntilExpiry,
    });

    return this.prisma.reservation.update({
      where: { id },
      data: { expiresAt: newExpiresAt, qrToken },
    });
  }

  /**
   * Releases reservations whose pickup window has passed so the reserved stock
   * becomes available again. Each reservation is claimed with a conditional
   * update, so a concurrent cancel/complete can never double-restore stock.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async expireOverdueReservations(): Promise<number> {
    if (this.expiryRunning) return 0;
    this.expiryRunning = true;
    let released = 0;
    try {
      const overdue = await this.prisma.reservation.findMany({
        where: {
          status: ReservationStatus.ACTIVE,
          expiresAt: { lt: new Date() },
        },
        select: { id: true },
        take: EXPIRY_BATCH_SIZE,
      });

      for (const { id } of overdue) {
        try {
          const done = await this.prisma.$transaction(async (tx) => {
            const claimed = await tx.reservation.updateMany({
              where: {
                id,
                status: ReservationStatus.ACTIVE,
                expiresAt: { lt: new Date() },
              },
              data: { status: ReservationStatus.EXPIRED },
            });
            if (claimed.count === 0) return false;

            const res = await tx.reservation.findUniqueOrThrow({
              where: { id },
              select: { productId: true, quantity: true },
            });
            await tx.product.update({
              where: { id: res.productId },
              data: { stockQuantity: { increment: res.quantity } },
            });
            await tx.stockHistory.create({
              data: {
                productId: res.productId,
                quantity: res.quantity,
                reason: 'RETURN',
                note: 'Reservation expired',
              },
            });
            return true;
          });
          if (done) released++;
        } catch (error) {
          this.logger.error(
            `Failed to expire reservation ${id}`,
            error as Error,
          );
        }
      }
      if (released > 0) {
        this.logger.log(`Released ${released} expired reservation(s)`);
      }
    } catch (error) {
      this.logger.error('Reservation expiry run failed', error as Error);
    } finally {
      this.expiryRunning = false;
    }
    return released;
  }
}

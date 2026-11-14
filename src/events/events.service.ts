import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { scrubNestedShops } from '../common/helpers/sanitize.helper';

export interface EventActor {
  id: string;
  role: UserRole;
}

@Injectable()
export class EventsService {
  constructor(private prisma: PrismaService) {}

  /** Only these fields can ever be written from a request body. */
  /** An event cannot end before it starts. */
  private assertValidDateRange(start: unknown, end: unknown) {
    if (
      start instanceof Date &&
      end instanceof Date &&
      end.getTime() < start.getTime()
    ) {
      throw new BadRequestException('endDate cannot be before startDate');
    }
  }

  private pickEventFields(data: any, partial = false) {
    const out: Record<string, unknown> = {};
    const assign = (key: string, value: unknown) => {
      if (value !== undefined) out[key] = value;
    };

    const rawTitle: unknown = data?.title;
    if (rawTitle !== undefined) {
      if (typeof rawTitle !== 'string' || !rawTitle.trim()) {
        throw new BadRequestException('title must be a non-empty string');
      }
      assign('title', rawTitle.trim());
    } else if (!partial) {
      throw new BadRequestException('title is required');
    }

    assign('description', data?.description ?? undefined);
    assign('imageUrl', data?.imageUrl ?? undefined);
    assign('location', data?.location ?? undefined);
    if (data?.isActive !== undefined) assign('isActive', !!data.isActive);

    for (const key of ['startDate', 'endDate'] as const) {
      if (data?.[key] !== undefined) {
        const date = new Date(data[key]);
        if (Number.isNaN(date.getTime())) {
          throw new BadRequestException(`${key} is not a valid date`);
        }
        assign(key, date);
      } else if (!partial) {
        throw new BadRequestException(`${key} is required`);
      }
    }
    return out;
  }

  async create(actor: EventActor, data: any) {
    const fields = this.pickEventFields(data);
    this.assertValidDateRange(fields.startDate, fields.endDate);

    let shopId: string | null = null;
    if (actor.role === UserRole.ADMIN) {
      // Admins may publish platform-wide events or attach one to a shop.
      shopId = data?.shopId || null;
    } else {
      const shop = await this.prisma.shop.findUnique({
        where: { ownerId: actor.id },
      });
      if (!shop) throw new NotFoundException('Shop not found');

      // Enforce subscription plan event limit for shopkeeper
      const plan = await this.prisma.subscriptionPlan.findUnique({
        where: { tier: shop.subscriptionTier },
      });
      const eventLimit = plan
        ? plan.eventLimit
        : shop.subscriptionTier === 'PREMIUM'
          ? 3
          : shop.subscriptionTier === 'PRO'
            ? 1
            : 0;
      const planName = plan ? plan.name : shop.subscriptionTier;

      if ((shop.eventsUsedThisMonth ?? 0) >= eventLimit) {
        throw new ForbiddenException(
          `Monthly event limit reached. Your ${planName} plan allows ${eventLimit} event(s) per month on the home screen. Please upgrade your subscription.`,
        );
      }
      shopId = shop.id;
    }

    const event = await this.prisma.event.create({
      data: { ...(fields as any), shopId },
    });

    if (shopId) {
      // Increment event usage count for this month after successful creation
      await this.prisma.shop.update({
        where: { id: shopId },
        data: { eventsUsedThisMonth: { increment: 1 } },
      });
    }

    return event;
  }

  async findAll() {
    const events = await this.prisma.event.findMany({
      where: {
        isActive: true,
        endDate: {
          gte: new Date(),
        },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        shop: true,
      },
    });
    return scrubNestedShops(events);
  }

  async findShopEvents(ownerId: string) {
    const events = await this.prisma.event.findMany({
      where: {
        shop: {
          ownerId,
        },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        shop: true,
      },
    });
    return scrubNestedShops(events);
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
    return scrubNestedShops(event);
  }

  /** Shopkeepers may only touch their own events; admins may touch any. */
  private async assertCanModify(id: string, actor: EventActor) {
    const event = await this.prisma.event.findUnique({
      where: { id },
      include: { shop: { select: { ownerId: true } } },
    });
    if (!event) {
      throw new NotFoundException(`Event with ID ${id} not found`);
    }
    if (actor.role !== UserRole.ADMIN && event.shop?.ownerId !== actor.id) {
      throw new ForbiddenException('You can only modify your own events');
    }
  }

  async update(id: string, actor: EventActor, data: any) {
    await this.assertCanModify(id, actor);
    const fields = this.pickEventFields(data, true);
    const existing = await this.prisma.event.findUnique({
      where: { id },
      select: { startDate: true, endDate: true },
    });
    this.assertValidDateRange(
      fields.startDate ?? existing?.startDate,
      fields.endDate ?? existing?.endDate,
    );
    return this.prisma.event.update({
      where: { id },
      data: fields as any,
    });
  }

  async remove(id: string, actor: EventActor) {
    await this.assertCanModify(id, actor);
    return this.prisma.event.delete({
      where: { id },
    });
  }
}

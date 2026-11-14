import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SubscriptionTier, Prisma } from '@prisma/client';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SubscribeDto } from './dto/subscriptions.dto';

@Injectable()
export class SubscriptionsService {
  constructor(private readonly prisma: PrismaService) {}

  async seedDefaultPlans() {
    const defaultPlans = [
      {
        tier: SubscriptionTier.FREE,
        name: 'Free',
        tagline: 'Get your shop online in minutes — zero cost, zero risk',
        price: 0,
        yearlyPrice: null,
        productLimit: 50,
        eventLimit: 0,
        features: [
          'Up to 50 products',
          'Basic shop profile',
          'WhatsApp & call inquiries',
          'Order & reservation management',
          'Basic analytics',
          'Standard search listing',
        ],
        isActive: true,
        isHighlighted: false,
        sortOrder: 0,
      },
      {
        tier: SubscriptionTier.PRO,
        name: 'Pro',
        tagline: 'Grow your reach — promote events, attract more customers',
        price: 499,
        yearlyPrice: 4788,
        productLimit: 200,
        eventLimit: 1,
        features: [
          'Up to 200 products',
          '1 promoted event/month on home screen',
          'Advanced analytics',
          '🔵 Pro badge on shop listing',
          '20% higher search ranking',
          'Customer chat enabled',
          'Promotional banner in nearby feed',
          'Auto GST invoice',
        ],
        isActive: true,
        isHighlighted: true,
        sortOrder: 1,
      },
      {
        tier: SubscriptionTier.PREMIUM,
        name: 'Premium',
        tagline: 'Dominate your locality — maximum visibility, maximum sales',
        price: 1199,
        yearlyPrice: 11508,
        productLimit: 500,
        eventLimit: 3,
        features: [
          'Up to 500 products',
          'Up to 3 events/promotions on home carousel',
          'Full analytics suite',
          '👑 Premium gold badge',
          '50% search boost + category top-3',
          'Influencer campaigns (2/month)',
          'Full-width home screen banner',
          'Price negotiation feature',
          'Bulk CSV inventory upload',
          'Stock alerts',
          'Auto GST invoice',
          'Early access to new features',
        ],
        isActive: true,
        isHighlighted: false,
        sortOrder: 2,
      },
    ];

    for (const plan of defaultPlans) {
      await this.prisma.subscriptionPlan.upsert({
        where: { tier: plan.tier },
        update: plan as any,
        create: plan as any,
      });
    }

    return {
      success: true,
      message: 'Default plans seeded successfully',
    };
  }

  async getPlans() {
    let plans = await this.prisma.subscriptionPlan.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
    if (plans.length === 0) {
      await this.seedDefaultPlans();
      plans = await this.prisma.subscriptionPlan.findMany({
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
      });
    }
    return plans;
  }

  async updatePlan(planId: string, data: any) {
    if (data.isHighlighted) {
      await this.prisma.subscriptionPlan.updateMany({
        where: { isHighlighted: true },
        data: { isHighlighted: false },
      });
    }
    return this.prisma.subscriptionPlan.update({
      where: { id: planId },
      data: {
        name: data.name,
        tagline: data.tagline,
        price: data.price !== undefined ? data.price : undefined,
        yearlyPrice:
          data.yearlyPrice !== undefined ? data.yearlyPrice : undefined,
        productLimit:
          data.productLimit !== undefined ? data.productLimit : undefined,
        eventLimit: data.eventLimit !== undefined ? data.eventLimit : undefined,
        features: data.features !== undefined ? data.features : undefined,
        isHighlighted:
          data.isHighlighted !== undefined ? data.isHighlighted : undefined,
        isActive: data.isActive !== undefined ? data.isActive : undefined,
      },
    });
  }

  async getMySubscription(shopkeeperId: string) {
    const shop = await this.prisma.shop.findUnique({
      where: { ownerId: shopkeeperId },
      include: {
        subscriptions: {
          where: { isActive: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: { plan: true },
        },
      },
    });
    if (!shop) throw new NotFoundException('Shop not found');

    const activeSub = shop.subscriptions[0] || null;
    const plan = await this.prisma.subscriptionPlan.findUnique({
      where: { tier: shop.subscriptionTier },
    });

    const productsCount = await this.prisma.product.count({
      where: { shopId: shop.id },
    });

    return {
      subscription: activeSub,
      currentTier: shop.subscriptionTier,
      expiresAt: shop.subscriptionExpiresAt,
      plan,
      usage: {
        productsCount,
        productLimit: plan?.productLimit ?? 50,
        eventsUsedThisMonth: shop.eventsUsedThisMonth,
        eventLimit: plan?.eventLimit ?? 0,
      },
    };
  }

  async activateSubscription(
    shopId: string,
    planId: string,
    razorpayOrderId: string | null,
  ) {
    const plan = await this.prisma.subscriptionPlan.findUnique({
      where: { id: planId },
    });
    if (!plan) throw new NotFoundException('Plan not found');

    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + 1);

    // Deactivate old active subscriptions
    await this.prisma.subscription.updateMany({
      where: { shopId, isActive: true },
      data: { isActive: false },
    });

    // Update shop tier and monthly limits
    await this.prisma.shop.update({
      where: { id: shopId },
      data: {
        subscriptionTier: plan.tier,
        subscriptionExpiresAt: expiresAt,
        eventsUsedThisMonth: 0,
        eventsResetAt: expiresAt,
      },
    });

    // Create new subscription record
    return this.prisma.subscription.create({
      data: {
        shopId,
        planId,
        planName: plan.name,
        planTier: plan.tier,
        price: plan.price,
        billingCycle: 'monthly',
        features: (plan.features as Prisma.InputJsonValue) ?? [],
        productLimit: plan.productLimit,
        razorpaySubId: razorpayOrderId,
        startedAt: new Date(),
        expiresAt,
        isActive: true,
      },
      include: { plan: true },
    });
  }

  async subscribe(shopkeeperId: string, dto: SubscribeDto) {
    const shop = await this.prisma.shop.findUnique({
      where: { ownerId: shopkeeperId },
    });
    if (!shop) throw new NotFoundException('Shop not found');

    const plan = await this.prisma.subscriptionPlan.findUnique({
      where: { tier: dto.tier },
    });
    if (!plan) throw new NotFoundException('Plan not found');

    return this.activateSubscription(shop.id, plan.id, null);
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async checkAndEnforceExpiry() {
    const now = new Date();

    // Downgrade expired shops
    const expiredShops = await this.prisma.shop.findMany({
      where: {
        subscriptionExpiresAt: { lt: now },
        subscriptionTier: { not: SubscriptionTier.FREE },
      },
    });

    for (const shop of expiredShops) {
      await this.prisma.shop.update({
        where: { id: shop.id },
        data: {
          subscriptionTier: SubscriptionTier.FREE,
          subscriptionExpiresAt: null,
        },
      });

      await this.prisma.subscription.updateMany({
        where: { shopId: shop.id, isActive: true },
        data: { isActive: false },
      });
    }

    // Monthly event usage reset
    const shopsToReset = await this.prisma.shop.findMany({
      where: {
        eventsResetAt: { lt: now },
        eventsUsedThisMonth: { gt: 0 },
      },
    });

    for (const shop of shopsToReset) {
      const nextReset = new Date();
      nextReset.setMonth(nextReset.getMonth() + 1);
      await this.prisma.shop.update({
        where: { id: shop.id },
        data: {
          eventsUsedThisMonth: 0,
          eventsResetAt: nextReset,
        },
      });
    }
  }
}

import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SubscribeDto } from './dto/subscriptions.dto';
import { SubscriptionTier } from '@prisma/client';

@Injectable()
export class SubscriptionsService {
  constructor(private readonly prisma: PrismaService) {}

  getPlans() {
    return [
      { tier: SubscriptionTier.FREE, price: 0, features: ['Basic Analytics', '50 Products'] },
      { tier: SubscriptionTier.BASIC, price: 499, features: ['Advanced Analytics', '500 Products'] },
      { tier: SubscriptionTier.PREMIUM, price: 1499, features: ['Unlimited Products', 'Priority Support'] },
      { tier: SubscriptionTier.ELITE, price: 2999, features: ['Dedicated Account Manager', 'Custom App Banner'] },
    ];
  }

  async subscribe(shopkeeperId: string, dto: SubscribeDto) {
    const shop = await this.prisma.shop.findUnique({
      where: { ownerId: shopkeeperId },
    });
    if (!shop) throw new NotFoundException('Shop not found');

    // In a real application, you would integrate a payment gateway (Razorpay/Stripe) here.
    // For now, we simulate a successful payment and upgrade the shop's tier directly.

    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + 1); // 1 month validity

    // Update shop tier
    await this.prisma.shop.update({
      where: { id: shop.id },
      data: {
        subscriptionTier: dto.tier,
        subscriptionExpiresAt: expiresAt,
      },
    });

    // Create subscription record
    return this.prisma.subscription.create({
      data: {
        shopId: shop.id,
        planName: dto.planName,
        planTier: dto.tier,
        price: dto.price,
        billingCycle: 'monthly',
        features: this.getPlans().find((p) => p.tier === dto.tier)?.features || [],
        startedAt: new Date(),
        expiresAt,
        isActive: true,
      },
    });
  }

  async getMySubscription(shopkeeperId: string) {
    const shop = await this.prisma.shop.findUnique({
      where: { ownerId: shopkeeperId },
    });
    if (!shop) throw new NotFoundException('Shop not found');

    return this.prisma.subscription.findFirst({
      where: { shopId: shop.id, isActive: true },
      orderBy: { createdAt: 'desc' },
    });
  }
}

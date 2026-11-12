import {
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SubscribeDto } from './dto/subscriptions.dto';
import { SubscriptionTier } from '@prisma/client';

@Injectable()
export class SubscriptionsService {
  constructor(private readonly prisma: PrismaService) {}

  getPlans() {
    return [
      {
        tier: SubscriptionTier.FREE,
        price: 0,
        features: ['Basic Analytics', '50 Products'],
      },
      {
        tier: SubscriptionTier.BASIC,
        price: 499,
        features: ['Advanced Analytics', '500 Products'],
      },
      {
        tier: SubscriptionTier.PREMIUM,
        price: 1499,
        features: ['Unlimited Products', 'Priority Support'],
      },
      {
        tier: SubscriptionTier.ELITE,
        price: 2999,
        features: ['Dedicated Account Manager', 'Custom App Banner'],
      },
    ];
  }

  async subscribe(shopkeeperId: string, dto: SubscribeDto) {
    const shop = await this.prisma.shop.findUnique({
      where: { ownerId: shopkeeperId },
    });
    if (!shop) throw new NotFoundException('Shop not found');

    // Plan name and price always come from the server-side catalogue, never
    // from the request body.
    const plan = this.getPlans().find((p) => p.tier === dto.tier);
    if (!plan) throw new NotFoundException('Plan not found');

    // No payment gateway is integrated yet, so a paid tier must not be granted
    // for free. Set ALLOW_SIMULATED_SUBSCRIPTIONS=true (development only) to
    // keep the simulated-payment behaviour.
    if (
      plan.price > 0 &&
      process.env.ALLOW_SIMULATED_SUBSCRIPTIONS !== 'true'
    ) {
      throw new HttpException(
        'Payment is required to activate a paid plan',
        HttpStatus.PAYMENT_REQUIRED,
      );
    }

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
        planName: dto.planName || `${plan.tier} Plan`,
        planTier: dto.tier,
        price: plan.price,
        billingCycle: 'monthly',
        features: plan.features,
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

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';

export const REQUIRED_TIER = 'required_tier';
export const RequiredTier = (...tiers: string[]) =>
  Reflect.metadata(REQUIRED_TIER, tiers);

@Injectable()
export class SubscriptionGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredTiers = this.reflector.get<string[]>(
      REQUIRED_TIER,
      context.getHandler(),
    );
    if (!requiredTiers || requiredTiers.length === 0) return true;

    const request = context.switchToHttp().getRequest();
    const userId = request.user?.id;
    if (!userId) throw new ForbiddenException('Not authenticated');

    const shop = await this.prisma.shop.findUnique({
      where: { ownerId: userId },
      select: { subscriptionTier: true, subscriptionExpiresAt: true },
    });

    if (!shop) throw new ForbiddenException('Shop not found');

    const now = new Date();
    if (shop.subscriptionExpiresAt && shop.subscriptionExpiresAt < now) {
      throw new ForbiddenException(
        'Subscription expired. Please renew your plan.',
      );
    }

    if (!requiredTiers.includes(shop.subscriptionTier)) {
      throw new ForbiddenException(
        `This feature requires one of: ${requiredTiers.join(', ')} plan`,
      );
    }

    return true;
  }
}

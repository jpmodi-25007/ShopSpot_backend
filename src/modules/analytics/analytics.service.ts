import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TrackEventDto } from './dto/analytics.dto';

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async trackEvent(userId: string | null, dto: TrackEventDto) {
    return this.prisma.analyticsEvent.create({
      data: {
        eventType: dto.eventType,
        shopId: dto.shopId,
        productId: dto.productId,
        userId: userId,
        sessionId: dto.sessionId,
        metadata: dto.metadata,
      },
    });
  }

  async getShopAnalytics(shopkeeperId: string) {
    const shop = await this.prisma.shop.findUnique({
      where: { ownerId: shopkeeperId },
    });
    if (!shop) throw new NotFoundException('Shop not found');

    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

    // Aggregate current period (last 7 days) and previous period (8-14 days ago)
    const [totalViews, prevViews, activeOrders, prevOrders, totalRevenueData] = await Promise.all([
      this.prisma.analyticsEvent.count({
        where: { shopId: shop.id, eventType: 'shop_view', createdAt: { gte: sevenDaysAgo } },
      }),
      this.prisma.analyticsEvent.count({
        where: { shopId: shop.id, eventType: 'shop_view', createdAt: { gte: fourteenDaysAgo, lt: sevenDaysAgo } },
      }),
      this.prisma.order.count({
        where: { shopId: shop.id, status: { notIn: ['DELIVERED', 'CANCELLED'] } },
      }),
      this.prisma.order.count({
        where: { shopId: shop.id, createdAt: { gte: fourteenDaysAgo, lt: sevenDaysAgo } },
      }),
      this.prisma.order.aggregate({
        where: { shopId: shop.id, status: 'DELIVERED' },
        _sum: { total: true },
      }),
    ]);

    // Calculate trend percentages
    const viewsTrend = prevViews === 0 ? 0 : Math.round(((totalViews - prevViews) / prevViews) * 100);
    const ordersTrend = prevOrders === 0 ? 0 : Math.round(((activeOrders - prevOrders) / prevOrders) * 100);

    return {
      totalViews,
      activeOrders,
      totalRevenue: totalRevenueData._sum.total || 0,
      viewsTrend,
      ordersTrend,
    };
  }

  async getAdminAnalytics() {
    const [totalUsers, totalShops, totalOrders, totalRevenueData, negotiations, topShops] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.shop.count(),
      this.prisma.order.count(),
      this.prisma.order.aggregate({
        where: { status: 'DELIVERED' },
        _sum: { total: true },
      }),
      this.prisma.negotiation.findMany({
        take: 500,
        orderBy: { createdAt: 'desc' }
      }),
      this.prisma.shop.findMany({
        take: 3,
        orderBy: { rating: 'desc' }
      })
    ]);

    // Group negotiations by day of week (Mon, Tue, etc.)
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const trendMap = new Map();
    days.forEach(d => trendMap.set(d, { name: d, initiated: 0, completed: 0 }));

    negotiations.forEach(n => {
      const dayName = days[n.createdAt.getDay()];
      const entry = trendMap.get(dayName);
      entry.initiated += 1;
      if (n.status === 'ACCEPTED') {
        entry.completed += 1;
      }
    });

    // Sort top shops for response
    const topShopsData = topShops.map((s, idx) => ({
      rank: `#${idx + 1}`,
      name: s.name,
      location: s.city || 'India',
      revenue: s.rating ? `${s.rating} Stars` : 'No Rating',
      views: `${s.reviewCount} Reviews`
    }));

    return {
      totalUsers,
      totalShops,
      totalOrders,
      totalRevenue: totalRevenueData._sum.total || 0,
      revenueBreakdown: [
        { name: 'Subscription Fees', value: 65, color: '#0F766E' },
        { name: 'Ad Credits', value: 25, color: '#14B8A6' },
        { name: 'Transaction Fees', value: 10, color: '#F59E0B' }
      ],
      negotiationTrends: Array.from(trendMap.values()),
      topShops: topShopsData
    };
  }

  async getInfluencerAnalytics(userId: string) {
    const profile = await this.prisma.influencerProfile.findUnique({
      where: { userId },
    });
    if (!profile) throw new NotFoundException('Influencer profile not found');

    const assignments = await this.prisma.campaignAssignment.findMany({
      where: { influencerId: profile.id },
      include: { campaign: { include: { shop: true } } },
      orderBy: { createdAt: 'desc' },
    });

    const totalEarnings = assignments.reduce((sum, a) => sum + Number(a.agreedAmount || 0), 0);
    const completedCampaigns = assignments.filter(a => a.contentStatus === 'APPROVED' || a.status === 'completed').length;
    
    // Group earnings by month for payouts mock
    const payoutsMap = new Map();
    assignments.forEach(a => {
      const monthYear = a.createdAt.toLocaleString('default', { month: 'short', year: 'numeric' });
      if (!payoutsMap.has(monthYear)) {
        payoutsMap.set(monthYear, { month: monthYear, amount: 0, status: a.paymentStatus === 'FULLY_PAID' ? 'Paid' : 'Pending' });
      }
      payoutsMap.get(monthYear).amount += Number(a.agreedAmount || 0);
    });

    return {
      totalEarnings,
      completedCampaigns,
      activeBids: assignments.filter(a => a.status !== 'completed').length,
      payouts: Array.from(payoutsMap.values()),
      portfolio: assignments.map(a => ({
        id: a.id,
        campaignName: a.campaign.title,
        shopName: a.campaign.shop.name,
        amount: Number(a.agreedAmount),
        imageUrl: a.proofImageUrl || a.campaign.shop.logoUrl || 'https://via.placeholder.com/150',
      }))
    };
  }
}

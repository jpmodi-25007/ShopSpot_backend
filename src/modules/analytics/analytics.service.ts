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
    const [
      totalViews,
      prevViews,
      activeOrders,
      prevOrders,
      totalRevenueData,
      totalProducts,
      totalInquiries,
      ratingData,
      reviewCount,
    ] = await Promise.all([
      this.prisma.analyticsEvent.count({
        where: {
          shopId: shop.id,
          eventType: 'shop_view',
          createdAt: { gte: sevenDaysAgo },
        },
      }),
      this.prisma.analyticsEvent.count({
        where: {
          shopId: shop.id,
          eventType: 'shop_view',
          createdAt: { gte: fourteenDaysAgo, lt: sevenDaysAgo },
        },
      }),
      this.prisma.order.count({
        where: {
          shopId: shop.id,
          status: { notIn: ['DELIVERED', 'CANCELLED'] },
        },
      }),
      this.prisma.order.count({
        where: {
          shopId: shop.id,
          createdAt: { gte: fourteenDaysAgo, lt: sevenDaysAgo },
        },
      }),
      this.prisma.order.aggregate({
        where: { shopId: shop.id, status: 'DELIVERED' },
        _sum: { total: true },
      }),
      // Profile stats
      this.prisma.product.count({ where: { shopId: shop.id } }),
      this.prisma.negotiation.count({ where: { shopId: shop.id } }),
      this.prisma.review.aggregate({
        where: { shopId: shop.id },
        _avg: { rating: true },
      }),
      this.prisma.review.count({ where: { shopId: shop.id } }),
      // 7-day event timestamps for chart breakdown
      this.prisma.analyticsEvent.findMany({
        where: {
          shopId: shop.id,
          eventType: 'shop_view',
          createdAt: { gte: sevenDaysAgo },
        },
        select: { createdAt: true },
      }),
      this.prisma.order.findMany({
        where: {
          shopId: shop.id,
          createdAt: { gte: sevenDaysAgo },
        },
        select: { createdAt: true },
      }),
    ]);

    // Calculate trend percentages
    const viewsTrend =
      prevViews === 0
        ? 0
        : Math.round(((totalViews - prevViews) / prevViews) * 100);
    const ordersTrend =
      prevOrders === 0
        ? 0
        : Math.round(((activeOrders - prevOrders) / prevOrders) * 100);
    const avgRating = ratingData._avg.rating
      ? Math.round(ratingData._avg.rating * 10) / 10
      : 0;

    // Daily breakdown for the last 7 days (index 0 = 6 days ago, index 6 = today)
    const dailyViews = Array(7).fill(0);
    const dailyOrders = Array(7).fill(0);
    const dayLabels: string[] = [];

    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    for (let i = 6; i >= 0; i--) {
      const d = new Date(startOfToday.getTime() - i * 24 * 60 * 60 * 1000);
      dayLabels.push(d.toLocaleDateString('en-US', { weekday: 'short' }));
    }

    recentViews.forEach((ev) => {
      const diffDays = Math.floor((startOfToday.getTime() + 24 * 60 * 60 * 1000 - 1 - ev.createdAt.getTime()) / (24 * 60 * 60 * 1000));
      const idx = 6 - diffDays;
      if (idx >= 0 && idx < 7) {
        dailyViews[idx]++;
      }
    });

    recentOrders.forEach((ord) => {
      const diffDays = Math.floor((startOfToday.getTime() + 24 * 60 * 60 * 1000 - 1 - ord.createdAt.getTime()) / (24 * 60 * 60 * 1000));
      const idx = 6 - diffDays;
      if (idx >= 0 && idx < 7) {
        dailyOrders[idx]++;
      }
    });

    return {
      totalViews,
      activeOrders,
      totalRevenue: totalRevenueData._sum.total || 0,
      viewsTrend,
      ordersTrend,
      dailyViews,
      dailyOrders,
      dayLabels,
      // Profile stats
      totalProducts,
      totalInquiries,
      avgRating,
      reviewCount,
    };
  }

  async getAdminAnalytics(period: string = 'month') {
    const range = this.resolvePeriod(period);
    const prev = this.previousPeriod(range);

    const [
      totalUsers,
      totalShops,
      periodOrders,
      prevOrders,
      periodUsers,
      prevUsers,
      periodShops,
      prevShops,
      deliveredRevenue,
      prevDeliveredRevenue,
      confirmedRevenue,
      subscriptionRevenue,
      negotiations,
      orderRevenueByShop,
      cityGroups,
      mapShops,
      periodViews,
      prevViews,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.shop.count({ where: { status: 'ACTIVE' } }),
      this.prisma.order.count({
        where: { createdAt: { gte: range.from, lte: range.to } },
      }),
      this.prisma.order.count({
        where: { createdAt: { gte: prev.from, lte: prev.to } },
      }),
      this.prisma.user.count({
        where: { createdAt: { gte: range.from, lte: range.to } },
      }),
      this.prisma.user.count({
        where: { createdAt: { gte: prev.from, lte: prev.to } },
      }),
      this.prisma.shop.count({
        where: { createdAt: { gte: range.from, lte: range.to } },
      }),
      this.prisma.shop.count({
        where: { createdAt: { gte: prev.from, lte: prev.to } },
      }),
      this.prisma.order.aggregate({
        where: {
          status: 'DELIVERED',
          createdAt: { gte: range.from, lte: range.to },
        },
        _sum: { total: true },
      }),
      this.prisma.order.aggregate({
        where: {
          status: 'DELIVERED',
          createdAt: { gte: prev.from, lte: prev.to },
        },
        _sum: { total: true },
      }),
      this.prisma.order.aggregate({
        where: {
          status: 'CONFIRMED',
          createdAt: { gte: range.from, lte: range.to },
        },
        _sum: { total: true },
      }),
      this.prisma.subscription.aggregate({
        where: {
          isActive: true,
          createdAt: { gte: range.from, lte: range.to },
        },
        _sum: { price: true },
      }),
      this.prisma.negotiation.findMany({
        where: { createdAt: { gte: range.from, lte: range.to } },
        select: { createdAt: true, status: true },
        take: 5000,
      }),
      this.prisma.order.groupBy({
        by: ['shopId'],
        where: {
          status: { in: ['DELIVERED', 'CONFIRMED'] },
          createdAt: { gte: range.from, lte: range.to },
        },
        _sum: { total: true },
        _count: { _all: true },
        orderBy: { _sum: { total: 'desc' } },
        take: 5,
      }),
      this.prisma.shop.groupBy({
        by: ['city'],
        where: { status: 'ACTIVE' },
        _count: { _all: true },
        orderBy: { _count: { city: 'desc' } },
        take: 12,
      }),
      this.prisma.shop.findMany({
        where: {
          status: 'ACTIVE',
          NOT: { AND: [{ latitude: 0 }, { longitude: 0 }] },
        },
        select: {
          id: true,
          name: true,
          city: true,
          latitude: true,
          longitude: true,
        },
        take: 250,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.analyticsEvent.count({
        where: {
          eventType: { in: ['shop_view', 'product_view'] },
          createdAt: { gte: range.from, lte: range.to },
        },
      }),
      this.prisma.analyticsEvent.count({
        where: {
          eventType: { in: ['shop_view', 'product_view'] },
          createdAt: { gte: prev.from, lte: prev.to },
        },
      }),
    ]);

    const delivered = Number(deliveredRevenue._sum.total || 0);
    const confirmed = Number(confirmedRevenue._sum.total || 0);
    const subscriptions = Number(subscriptionRevenue._sum.price || 0);
    const moneyTotal = delivered + confirmed + subscriptions;

    const pct = (amount: number) =>
      moneyTotal > 0 ? Math.round((amount / moneyTotal) * 1000) / 10 : 0;

    const revenueBreakdown = [
      {
        name: 'Delivered orders',
        value: pct(delivered),
        amount: delivered,
        color: '#0F766E',
      },
      {
        name: 'Confirmed (in progress)',
        value: pct(confirmed),
        amount: confirmed,
        color: '#14B8A6',
      },
      {
        name: 'Subscriptions',
        value: pct(subscriptions),
        amount: subscriptions,
        color: '#F59E0B',
      },
    ].filter((row) => row.amount > 0 || moneyTotal === 0);

    // If everything is zero, keep the three slices at 0 so the UI still labels them.
    if (revenueBreakdown.length === 0) {
      revenueBreakdown.push(
        { name: 'Delivered orders', value: 0, amount: 0, color: '#0F766E' },
        {
          name: 'Confirmed (in progress)',
          value: 0,
          amount: 0,
          color: '#14B8A6',
        },
        { name: 'Subscriptions', value: 0, amount: 0, color: '#F59E0B' },
      );
    }

    const negotiationTrends = this.bucketNegotiations(negotiations, range);

    const shopIds = orderRevenueByShop.map((r) => r.shopId);
    const shops = shopIds.length
      ? await this.prisma.shop.findMany({
          where: { id: { in: shopIds } },
          select: { id: true, name: true, city: true, logoUrl: true },
        })
      : [];
    const shopById = new Map(shops.map((s) => [s.id, s]));
    const topShops = orderRevenueByShop.map((row, idx) => {
      const shop = shopById.get(row.shopId);
      return {
        id: row.shopId,
        rank: `#${idx + 1}`,
        name: shop?.name || 'Unknown shop',
        location: shop?.city || 'India',
        revenue: Number(row._sum.total || 0),
        orders: row._count._all,
        logoUrl: shop?.logoUrl || null,
      };
    });

    const cityTotal =
      cityGroups.reduce((sum, c) => sum + c._count._all, 0) || 1;
    const cityDistribution = cityGroups
      .map((c) => ({
        city: c.city || 'Unspecified',
        count: c._count._all,
        pct: Math.round((c._count._all / cityTotal) * 1000) / 10,
      }))
      .sort((a, b) => b.count - a.count);

    // India bounding box used by the admin SVG map (no external map tiles / API keys).
    const INDIA = { minLat: 6.5, maxLat: 37.5, minLng: 68.0, maxLng: 97.5 };
    const project = (lat: number, lng: number) => ({
      x: ((lng - INDIA.minLng) / (INDIA.maxLng - INDIA.minLng)) * 100,
      y: ((INDIA.maxLat - lat) / (INDIA.maxLat - INDIA.minLat)) * 100,
    });

    // Aggregate identical/near-identical seed coordinates into city bubbles so
    // the map stays readable when hundreds of shops share the same lat/lng.
    const clusterMap = new Map<
      string,
      { city: string; count: number; latSum: number; lngSum: number }
    >();
    for (const shop of mapShops) {
      if (
        shop.latitude < INDIA.minLat ||
        shop.latitude > INDIA.maxLat ||
        shop.longitude < INDIA.minLng ||
        shop.longitude > INDIA.maxLng
      ) {
        continue;
      }
      const city = shop.city || 'Unspecified';
      const key = `${city}|${shop.latitude.toFixed(3)}|${shop.longitude.toFixed(3)}`;
      const row = clusterMap.get(key) || {
        city,
        count: 0,
        latSum: 0,
        lngSum: 0,
      };
      row.count += 1;
      row.latSum += shop.latitude;
      row.lngSum += shop.longitude;
      clusterMap.set(key, row);
    }
    const mapPoints = [...clusterMap.entries()]
      .map(([key, row]) => {
        const lat = row.latSum / row.count;
        const lng = row.lngSum / row.count;
        const { x, y } = project(lat, lng);
        return {
          id: key,
          name: row.city,
          city: row.city,
          count: row.count,
          lat,
          lng,
          x,
          y,
        };
      })
      .sort((a, b) => b.count - a.count);

    return {
      period: range.key,
      periodLabel: range.label,
      totalUsers,
      totalShops,
      totalOrders: periodOrders,
      totalRevenue: delivered,
      views: periodViews,
      trends: {
        revenue: this.trendPct(
          delivered,
          Number(prevDeliveredRevenue._sum.total || 0),
        ),
        shops: this.trendPct(periodShops, prevShops),
        orders: this.trendPct(periodOrders, prevOrders),
        users: this.trendPct(periodUsers, prevUsers),
        views: this.trendPct(periodViews, prevViews),
      },
      revenueBreakdown,
      negotiationTrends,
      topShops,
      cityDistribution,
      mapPoints,
      mapBounds: INDIA,
    };
  }

  /** Parses today/week/month/all into an inclusive [from, to] window (local server time). */
  private resolvePeriod(period?: string) {
    const key = (period || 'month').toLowerCase();
    const to = new Date();
    const from = new Date(to);
    if (key === 'today') {
      from.setHours(0, 0, 0, 0);
      return { key: 'today', label: 'Today', from, to };
    }
    if (key === 'week') {
      from.setDate(from.getDate() - 6);
      from.setHours(0, 0, 0, 0);
      return { key: 'week', label: 'Last 7 days', from, to };
    }
    if (key === 'all') {
      return {
        key: 'all',
        label: 'All time',
        from: new Date(0),
        to,
      };
    }
    // month (default)
    from.setDate(from.getDate() - 29);
    from.setHours(0, 0, 0, 0);
    return { key: 'month', label: 'Last 30 days', from, to };
  }

  /** Same-length window immediately before `range` (for % change). */
  private previousPeriod(range: { from: Date; to: Date; key: string }) {
    if (range.key === 'all') {
      return { from: new Date(0), to: new Date(0) }; // forces prev totals to 0
    }
    const ms = range.to.getTime() - range.from.getTime();
    const to = new Date(range.from.getTime() - 1);
    const from = new Date(to.getTime() - ms);
    return { from, to };
  }

  private trendPct(current: number, previous: number): number {
    if (previous <= 0) return current > 0 ? 100 : 0;
    return Math.round(((current - previous) / previous) * 1000) / 10;
  }

  /** Buckets negotiations into day labels for the selected window. */
  private bucketNegotiations(
    negotiations: { createdAt: Date; status: string }[],
    range: { from: Date; to: Date; key: string },
  ) {
    if (range.key === 'today') {
      const hours = Array.from({ length: 8 }, (_, i) => {
        const h = i * 3;
        return {
          name: `${String(h).padStart(2, '0')}:00`,
          initiated: 0,
          completed: 0,
          hour: h,
        };
      });
      for (const n of negotiations) {
        const h = n.createdAt.getHours();
        const bucket =
          hours.find((b) => h >= b.hour && h < b.hour + 3) ||
          hours[hours.length - 1];
        bucket.initiated += 1;
        if (n.status === 'ACCEPTED') bucket.completed += 1;
      }
      return hours.map(({ name, initiated, completed }) => ({
        name,
        initiated,
        completed,
      }));
    }

    if (range.key === 'week' || range.key === 'month') {
      const dayMs = 24 * 60 * 60 * 1000;
      const days: {
        name: string;
        initiated: number;
        completed: number;
        key: string;
      }[] = [];
      const cursor = new Date(range.from);
      cursor.setHours(0, 0, 0, 0);
      const end = new Date(range.to);
      end.setHours(0, 0, 0, 0);
      // Cap chart bars so Month stays readable (≈10 buckets of ~3 days).
      const totalDays = Math.max(
        1,
        Math.round((end.getTime() - cursor.getTime()) / dayMs) + 1,
      );
      const step =
        range.key === 'month' ? Math.max(1, Math.ceil(totalDays / 10)) : 1;
      for (let t = cursor.getTime(); t <= end.getTime(); t += step * dayMs) {
        const d = new Date(t);
        const label =
          range.key === 'week'
            ? d.toLocaleDateString('en-IN', { weekday: 'short' })
            : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
        days.push({
          name: label,
          initiated: 0,
          completed: 0,
          key: d.toISOString().slice(0, 10),
        });
      }
      for (const n of negotiations) {
        const idx = Math.min(
          days.length - 1,
          Math.floor(
            (n.createdAt.getTime() - cursor.getTime()) / (step * dayMs),
          ),
        );
        if (idx < 0) continue;
        days[idx].initiated += 1;
        if (n.status === 'ACCEPTED') days[idx].completed += 1;
      }
      return days.map(({ name, initiated, completed }) => ({
        name,
        initiated,
        completed,
      }));
    }

    // all time — by month of the last 12 calendar months
    const months: {
      name: string;
      initiated: number;
      completed: number;
      key: string;
    }[] = [];
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({
        name: d.toLocaleDateString('en-IN', { month: 'short' }),
        initiated: 0,
        completed: 0,
        key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      });
    }
    for (const n of negotiations) {
      const key = `${n.createdAt.getFullYear()}-${String(n.createdAt.getMonth() + 1).padStart(2, '0')}`;
      const bucket = months.find((m) => m.key === key);
      if (!bucket) continue;
      bucket.initiated += 1;
      if (n.status === 'ACCEPTED') bucket.completed += 1;
    }
    return months.map(({ name, initiated, completed }) => ({
      name,
      initiated,
      completed,
    }));
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

    const totalEarnings = assignments.reduce(
      (sum, a) => sum + Number(a.agreedAmount || 0),
      0,
    );
    const completedCampaigns = assignments.filter(
      (a) => a.contentStatus === 'APPROVED' || a.status === 'completed',
    ).length;

    // Group earnings by month for payouts mock
    const payoutsMap = new Map();
    assignments.forEach((a) => {
      const monthYear = a.createdAt.toLocaleString('default', {
        month: 'short',
        year: 'numeric',
      });
      if (!payoutsMap.has(monthYear)) {
        payoutsMap.set(monthYear, {
          month: monthYear,
          amount: 0,
          status: a.paymentStatus === 'FULLY_PAID' ? 'Paid' : 'Pending',
        });
      }
      payoutsMap.get(monthYear).amount += Number(a.agreedAmount || 0);
    });

    return {
      totalEarnings,
      completedCampaigns,
      activeBids: assignments.filter((a) => a.status !== 'completed').length,
      payouts: Array.from(payoutsMap.values()),
      portfolio: assignments.map((a) => ({
        id: a.id,
        campaignName: a.campaign.title,
        shopName: a.campaign.shop.name,
        amount: Number(a.agreedAmount),
        imageUrl:
          a.proofImageUrl ||
          a.campaign.shop.logoUrl ||
          'https://via.placeholder.com/150',
      })),
    };
  }
}

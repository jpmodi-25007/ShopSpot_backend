import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  VerifyShopDto,
  VerifyInfluencerDto,
  SuspendUserDto,
  PaginationDto,
  ResolveReportDto,
  CreateShopDto,
  CreateProductDto,
} from './dto/admin.dto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async getUsers(query: PaginationDto) {
    const page = parseInt(query.page || '1', 10);
    const limit = parseInt(query.limit || '20', 10);
    const skip = (page - 1) * limit;

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.count(),
    ]);

    return {
      data: users,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getShops(query: PaginationDto) {
    const page = parseInt(query.page || '1', 10);
    const limit = parseInt(query.limit || '20', 10);
    const skip = (page - 1) * limit;

    const [shops, total] = await Promise.all([
      this.prisma.shop.findMany({
        skip,
        take: limit,
        include: { owner: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.shop.count(),
    ]);

    return {
      data: shops,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async createShop(dto: CreateShopDto) {
    let owner = await this.prisma.user.findUnique({
      where: { email: dto.ownerEmail },
    });

    if (!owner) {
      const defaultPassword = await bcrypt.hash('password123', 10);
      owner = await this.prisma.user.create({
        data: {
          email: dto.ownerEmail,
          name: dto.ownerName || 'Shop Owner',
          password: defaultPassword,
          role: 'SHOPKEEPER',
        },
      });
    } else {
      const existingShop = await this.prisma.shop.findUnique({
        where: { ownerId: owner.id },
      });
      if (existingShop) {
        throw new ConflictException(
          `User ${dto.ownerEmail} already owns a shop.`,
        );
      }
    }

    const baseSlug = dto.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
    let slug = baseSlug;
    let slugCounter = 1;
    while (await this.prisma.shop.findUnique({ where: { slug } })) {
      slug = `${baseSlug}-${slugCounter}`;
      slugCounter++;
    }

    const shop = await this.prisma.shop.create({
      data: {
        name: dto.name,
        slug,
        ownerId: owner.id,
        categoryId: dto.categoryId,
        city: dto.city,
        address: dto.address || dto.city || 'Address Pending',
        state: dto.state,
        pincode: dto.pincode,
        phone: dto.phone,
        whatsapp: dto.whatsapp,
        gstNumber: dto.gstNumber,
        latitude: 0,
        longitude: 0,
        logoUrl: dto.logoUrl,
      },
    });

    return shop;
  }

  async createProduct(shopId: string, dto: CreateProductDto) {
    const shop = await this.prisma.shop.findUnique({ where: { id: shopId } });
    if (!shop) throw new NotFoundException('Shop not found');

    let categoryId = null;
    if (dto.categoryName) {
      const category = await this.prisma.category.findUnique({
        where: { slug: dto.categoryName.toLowerCase().replace(/\s+/g, '-') },
      });
      if (category) {
        categoryId = category.id;
      }
    }

    const baseSlug = dto.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
    let slug = baseSlug;
    let slugCounter = 1;
    while (await this.prisma.product.findFirst({ where: { slug } })) {
      slug = `${baseSlug}-${slugCounter}`;
      slugCounter++;
    }

    const product = await this.prisma.product.create({
      data: {
        shopId,
        name: dto.name,
        slug,
        categoryId,
        sellingPrice: dto.sellingPrice,
        mrp: dto.sellingPrice,
      },
    });

    return product;
  }

  async createUser(dto: any) {
    const defaultPassword = await bcrypt.hash('password123', 10);
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        name: dto.name,
        mobile: dto.mobile,
        password: defaultPassword,
        role: dto.role,
        avatarUrl: dto.avatarUrl,
      },
    });

    if (user.role === 'SHOPKEEPER') {
      await this.prisma.shop.create({
        data: {
          ownerId: user.id,
          name: `${user.name || 'Retailer'}'s Shop`,
          slug: `shop-${user.id.substring(0, 8)}-${Date.now()}`,
          address: 'Please update your shop address',
          latitude: 0,
          longitude: 0,
          status: 'ACTIVE',
        },
      });
    } else if (user.role === 'INFLUENCER') {
      await this.prisma.influencerProfile.create({
        data: {
          userId: user.id,
          displayName: user.name || 'New Influencer',
          username: `user_${user.id.substring(0, 8)}_${Date.now()}`,
          verificationStatus: 'PENDING',
        },
      });
    }

    return user;
  }

  async createInfluencer(dto: any) {
    let user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (!user) {
      const defaultPassword = await bcrypt.hash('password123', 10);
      user = await this.prisma.user.create({
        data: {
          email: dto.email,
          name: dto.name,
          password: defaultPassword,
          role: 'INFLUENCER',
        },
      });
    }

    const nameStr = String(dto.name || 'influencer');
    const baseSlug = nameStr
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');

    return this.prisma.influencerProfile.create({
      data: {
        userId: user.id,
        displayName: dto.name,
        username: baseSlug,
        bio: dto.bio,
        city: dto.city,
        categories: dto.categoryId ? [dto.categoryId] : [],
        instagramUrl: dto.instagramUrl,
        youtubeUrl: dto.youtubeUrl,
        facebookUrl: dto.facebookUrl,
        verificationStatus: 'PENDING',
        followers: 0,
        avgViews: 0,
        engagementRate: 0,
        creatorScore: 0,
        completedCampaigns: 0,
      },
    });
  }

  async getInfluencers(query: PaginationDto) {
    const page = parseInt(query.page || '1', 10);
    const limit = parseInt(query.limit || '20', 10);
    const skip = (page - 1) * limit;

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        skip,
        take: limit,
        where: { role: 'INFLUENCER' },
        include: { influencerProfile: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.count({ where: { role: 'INFLUENCER' } }),
    ]);

    const influencers = users.map((u) => {
      if (u.influencerProfile) {
        return {
          ...u.influencerProfile,
          user: u,
        };
      } else {
        return {
          id: `temp_${u.id}`,
          userId: u.id,
          displayName: u.name || 'New Influencer',
          username: `user_${u.id.substring(0, 8)}`,
          verificationStatus: 'PENDING',
          followers: 0,
          socialPlatform: null,
          createdAt: u.createdAt,
          user: u,
        };
      }
    });

    return {
      data: influencers,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async suspendUser(userId: string, dto: SuspendUserDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    return this.prisma.user.update({
      where: { id: userId },
      data: { isActive: dto.isActive },
    });
  }

  async verifyShop(shopId: string, dto: VerifyShopDto) {
    const shop = await this.prisma.shop.findUnique({ where: { id: shopId } });
    if (!shop) throw new NotFoundException('Shop not found');

    return this.prisma.shop.update({
      where: { id: shopId },
      data: {
        isGstVerified: dto.isGstVerified,
        isKycVerified: dto.isKycVerified,
      },
    });
  }

  async verifyInfluencer(influencerId: string, dto: VerifyInfluencerDto) {
    let userId: string;
    let result: any;

    if (influencerId.startsWith('temp_')) {
      userId = influencerId.replace('temp_', '');
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      if (!user) throw new NotFoundException('User not found');

      result = await this.prisma.influencerProfile.create({
        data: {
          userId: user.id,
          displayName: user.name || 'New Influencer',
          username: `user_${user.id.substring(0, 8)}_${Date.now()}`,
          verificationStatus: dto.status as any,
        },
      });
    } else {
      const profile = await this.prisma.influencerProfile.findUnique({
        where: { id: influencerId },
      });
      if (!profile) throw new NotFoundException('Influencer profile not found');
      userId = profile.userId;

      result = await this.prisma.influencerProfile.update({
        where: { id: influencerId },
        data: {
          verificationStatus: dto.status as any,
        },
      });
    }

    // Notify influencer of verification status or requested information
    try {
      const title =
        dto.status === 'VERIFIED'
          ? 'Profile Verified!'
          : dto.status === 'REJECTED'
            ? 'Verification Rejected'
            : 'Verification: Additional Info Requested';
      const body =
        dto.note ||
        (dto.status === 'VERIFIED'
          ? 'Your influencer profile has been verified successfully.'
          : dto.status === 'REJECTED'
            ? 'Your verification request was rejected. Please review profile details.'
            : 'Admin has requested additional verification documents.');

      await this.prisma.notification.create({
        data: {
          userId,
          type: 'SYSTEM',
          title,
          body,
          data: { status: dto.status, note: dto.note },
        },
      });
    } catch {
      // Non-blocking notification failure
    }

    return result;
  }

  async getReports(query: PaginationDto) {
    const page = parseInt(query.page || '1', 10);
    const limit = parseInt(query.limit || '20', 10);
    const skip = (page - 1) * limit;

    const [reports, total] = await Promise.all([
      this.prisma.contentReport.findMany({
        skip,
        take: limit,
        include: { product: true, shop: true, reporter: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.contentReport.count(),
    ]);

    return {
      data: reports,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async resolveReport(reportId: string, dto: ResolveReportDto) {
    const report = await this.prisma.contentReport.findUnique({
      where: { id: reportId },
    });
    if (!report) throw new NotFoundException('Report not found');

    return this.prisma.contentReport.update({
      where: { id: reportId },
      data: { status: dto.status },
    });
  }

  async getUserDetail(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        customerOrders: { take: 10, orderBy: { createdAt: 'desc' } },
        sentMessages: { take: 5, orderBy: { createdAt: 'desc' } },
        reviews: { take: 5, orderBy: { createdAt: 'desc' } },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async getShopDetail(shopId: string) {
    const shop = await this.prisma.shop.findUnique({
      where: { id: shopId },
      include: {
        owner: true,
        products: { take: 10, orderBy: { createdAt: 'desc' } },
        orders: {
          take: 10,
          orderBy: { createdAt: 'desc' },
          include: { customer: true },
        },
      },
    });
    if (!shop) throw new NotFoundException('Shop not found');
    return shop;
  }

  async getInfluencerDetail(influencerId: string) {
    const influencer = await this.prisma.influencerProfile.findUnique({
      where: { id: influencerId },
      include: {
        user: true,
        assignments: {
          include: { campaign: { include: { product: true } } },
          take: 10,
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!influencer)
      throw new NotFoundException('Influencer profile not found');
    return influencer;
  }

  async getReportStats() {
    const [totalFlagged, underReview, resolved] = await Promise.all([
      this.prisma.contentReport.count(),
      this.prisma.contentReport.count({ where: { status: 'UNDER_REVIEW' } }),
      this.prisma.contentReport.count({ where: { status: 'RESOLVED' } }),
    ]);

    return {
      totalFlagged,
      underReview,
      resolved,
    };
  }

  async getDashboardStats() {
    const [
      totalShops,
      totalUsers,
      totalRevenueData,
      activeNegotiations,
      verificationQueue,
      verifiedShops,
      dealsClosed,
      analyticsEvents,
    ] = await Promise.all([
      this.prisma.shop.count(),
      this.prisma.user.count(),
      this.prisma.order.aggregate({
        where: { status: 'DELIVERED' },
        _sum: { total: true },
      }),
      this.prisma.negotiation.count({
        where: { status: { in: ['PENDING', 'COUNTERED'] } },
      }),
      this.prisma.shop.findMany({
        where: { OR: [{ isKycVerified: false }, { isGstVerified: false }] },
        include: { owner: true },
        take: 5,
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.shop.count({
        where: { isKycVerified: true, isGstVerified: true },
      }),
      this.prisma.negotiation.count({
        where: { status: 'ACCEPTED' },
      }),
      this.prisma.analyticsEvent.findMany({
        where: {
          eventType: { in: ['shop_view', 'product_view'] },
          createdAt: {
            gte: new Date(Date.now() - 8 * 7 * 24 * 60 * 60 * 1000),
          }, // Last 8 weeks
        },
        select: { eventType: true, createdAt: true },
      }),
    ]);

    // Group actual analytics events by week
    const weekMap = new Map<string, { views: number; inquiries: number }>();
    const now = Date.now();
    for (let i = 7; i >= 0; i--) {
      const weekLabel = `W${8 - i}`;
      weekMap.set(weekLabel, { views: 0, inquiries: 0 });
    }

    analyticsEvents.forEach((event) => {
      const ageMs = now - event.createdAt.getTime();
      const weekNum = Math.floor(ageMs / (7 * 24 * 60 * 60 * 1000));
      if (weekNum >= 0 && weekNum < 8) {
        const label = `W${8 - weekNum}`;
        const entry = weekMap.get(label);
        if (entry) {
          if (event.eventType === 'shop_view') entry.views += 1;
          else if (event.eventType === 'product_view') entry.inquiries += 1;
        }
      }
    });

    const chartData = Array.from(weekMap.entries()).map(([name, data]) => ({
      name,
      ...data,
    }));

    // Calculate real avg discount from accepted negotiations
    const discountData = await this.prisma.negotiation.findMany({
      where: { status: 'ACCEPTED', finalPrice: { not: null } },
      select: { initialPrice: true, finalPrice: true },
      take: 500,
    });
    let avgDiscount = 0;
    if (discountData.length > 0) {
      const totalDiscount = discountData.reduce((sum, n) => {
        const initial = Number(n.initialPrice);
        const final = Number(n.finalPrice);
        if (initial > 0) return sum + ((initial - final) / initial) * 100;
        return sum;
      }, 0);
      avgDiscount = Math.round((totalDiscount / discountData.length) * 10) / 10;
    }

    return {
      totalShops,
      monthlyActiveUsers: totalUsers,
      platformRevenue: totalRevenueData._sum.total || 0,
      activeNegotiations,
      chartData,
      verificationQueue: verificationQueue.map((shop) => ({
        name: shop.name,
        location: shop.city || 'India',
        type: 'Retail',
      })),
      verifiedShops,
      dealsClosed,
      avgDiscount,
    };
  }

  async getAdminNotifications() {
    const notifications = await this.prisma.notification.findMany({
      take: 20,
      orderBy: { createdAt: 'desc' },
    });
    return notifications;
  }

  async markNotificationsRead() {
    // Only mark SYSTEM-type notifications as read (admin panel notifications)
    await this.prisma.notification.updateMany({
      where: { type: 'SYSTEM' },
      data: { isRead: true },
    });
    return { success: true };
  }

  async getSettings() {
    // Use a fixed, absolute path — no inline require, no path traversal risk
    const fs = await import('fs');
    const path = await import('path');
    const settingsPath = path.resolve(process.cwd(), 'data', 'settings.json');
    try {
      if (fs.existsSync(settingsPath)) {
        return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      }
    } catch (e) {
      console.error('Failed to read settings', e);
    }
    // Default settings
    return {
      subscriptionFee: 0,
      transactionFee: 5.0,
      require2FA: true,
      sessionTimeout: 120,
      paymentGateway: 'stripe_live',
      payoutSchedule: 'weekly',
    };
  }

  async updateSettings(dto: any) {
    const fs = await import('fs');
    const path = await import('path');
    // Use a fixed, absolute resolved path to prevent any path-traversal
    const dataDir = path.resolve(process.cwd(), 'data');
    const settingsPath = path.resolve(dataDir, 'settings.json');
    // Ensure resolved path is still within the data directory
    if (!settingsPath.startsWith(dataDir)) {
      throw new Error('Invalid settings path');
    }
    try {
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      fs.writeFileSync(settingsPath, JSON.stringify(dto, null, 2), 'utf8');
      return { success: true, settings: dto };
    } catch (e) {
      console.error('Failed to save settings', e);
      throw new Error('Failed to save settings');
    }
  }
}

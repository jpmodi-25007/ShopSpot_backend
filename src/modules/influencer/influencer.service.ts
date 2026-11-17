import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  UpdateInfluencerProfileDto,
  CreateCampaignDto,
  UpdateCampaignDto,
  SubmitBidDto,
} from './dto/influencer.dto';
import {
  CampaignStatus,
  BidStatus,
  UserRole,
  NotificationType,
  ContentStatus,
  CampaignPaymentStatus,
  Prisma,
} from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { scrubNestedShops } from '../../common/helpers/sanitize.helper';

@Injectable()
export class InfluencerService {
  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
  ) {}

  // ─── INFLUENCER PROFILE ──────────────────────────────────────────────────

  async getProfile(userId: string) {
    const profile = await this.prisma.influencerProfile.findUnique({
      where: { userId },
    });
    if (!profile) throw new NotFoundException('Influencer profile not found');
    return profile;
  }

  async updateProfile(userId: string, dto: UpdateInfluencerProfileDto) {
    // Upsert profile
    return this.prisma.influencerProfile.upsert({
      where: { userId },
      update: dto,
      create: {
        ...dto,
        userId,
        displayName: dto.displayName || 'Creator',
        username: dto.username || `creator_${Date.now()}`,
      },
    });
  }

  // ─── CAMPAIGNS FOR INFLUENCER ────────────────────────────────────────────

  async getEligibleCampaigns(
    userId: string,
    industry?: string,
    search?: string,
  ) {
    const whereClause: any = { status: CampaignStatus.PUBLISHED };
    const AND: any[] = [
      {
        OR: [
          { applicationDeadline: null },
          { applicationDeadline: { gt: new Date() } },
        ],
      },
    ];

    if (industry && industry !== 'All Campaigns') {
      AND.push({
        OR: [
          { targetCategories: { has: industry } },
          { shop: { category: { name: industry } } },
          { product: { category: { name: industry } } },
        ],
      });
    }

    if (search && search.trim().length > 0) {
      AND.push({
        OR: [
          { title: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
          { shop: { name: { contains: search, mode: 'insensitive' } } },
        ],
      });
    }

    if (AND.length > 0) {
      whereClause.AND = AND;
    }

    // Determine the high budget threshold (top 10% of all published campaigns)
    const totalPublished = await this.prisma.influencerCampaign.count({
      where: { status: CampaignStatus.PUBLISHED },
    });
    let highBudgetThreshold = Number.MAX_SAFE_INTEGER;

    if (totalPublished > 0) {
      // e.g. for 20 campaigns, 10% is 2. The 2nd item (index 1) sets the threshold.
      const top10PercentIndex = Math.max(
        0,
        Math.ceil(totalPublished * 0.1) - 1,
      );
      const thresholdCampaign = await this.prisma.influencerCampaign.findFirst({
        where: { status: CampaignStatus.PUBLISHED },
        orderBy: { budgetMax: 'desc' },
        skip: top10PercentIndex,
        select: { budgetMax: true },
      });
      if (thresholdCampaign) {
        highBudgetThreshold = Number(thresholdCampaign.budgetMax);
      }
    }

    const campaigns = await this.prisma.influencerCampaign.findMany({
      where: whereClause,
      include: {
        shop: true,
        product: {
          include: {
            mediaAssets: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return scrubNestedShops(
      campaigns.map((c) => ({
        ...c,
        isHighBudget: Number(c.budgetMax) >= highBudgetThreshold,
      })),
    );
  }

  async submitBid(userId: string, campaignId: string, dto: SubmitBidDto) {
    const profile = await this.getProfile(userId);

    // The mobile app already blocks unverified creators; enforce it on the
    // server too so the API cannot be called directly to bypass moderation.
    if (profile.verificationStatus !== 'VERIFIED') {
      throw new ForbiddenException(
        'Your influencer profile must be verified before you can bid',
      );
    }

    // Check if campaign is accepting bids
    const campaign = await this.prisma.influencerCampaign.findUnique({
      where: { id: campaignId },
    });
    if (
      !campaign ||
      (campaign.status !== CampaignStatus.PUBLISHED &&
        campaign.status !== CampaignStatus.BIDDING_OPEN)
    ) {
      throw new BadRequestException('Campaign is not accepting bids');
    }

    if (
      campaign.applicationDeadline &&
      campaign.applicationDeadline < new Date()
    ) {
      throw new BadRequestException(
        'The application deadline for this campaign has passed',
      );
    }

    // Ensure no duplicate active bid
    const existingBid = await this.prisma.influencerBid.findFirst({
      where: {
        campaignId,
        influencerId: profile.id,
        status: {
          notIn: [BidStatus.WITHDRAWN, BidStatus.REJECTED],
        },
      },
    });
    if (existingBid) {
      throw new BadRequestException(
        'You already have an active bid for this campaign',
      );
    }

    const bid = await this.prisma.influencerBid.create({
      data: {
        campaignId,
        influencerId: profile.id,
        proposedAmount: dto.proposedAmount,
        availableDate: new Date(dto.availableDate),
        deliveryDate: new Date(dto.deliveryDate),
        proposal: dto.proposal,
      },
    });

    // Notify shop owner
    this.notificationsService.sendNotification(
      campaign.shopkeeperId,
      NotificationType.BID_RECEIVED,
      'New Campaign Bid',
      `${profile.displayName} submitted a bid of ₹${dto.proposedAmount} for your campaign`,
      { campaignId, bidId: bid.id },
    );

    return bid;
  }

  async getMyBids(userId: string) {
    const profile = await this.getProfile(userId);
    const bids = await this.prisma.influencerBid.findMany({
      where: { influencerId: profile.id },
      include: {
        campaign: {
          include: {
            shop: true,
            product: { include: { mediaAssets: true } },
          },
        },
        counterOffers: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { createdAt: 'desc' },
    });
    return scrubNestedShops(bids);
  }

  async getAnalytics(userId: string) {
    const profile = await this.getProfile(userId);

    // Fetch campaign assignments for this influencer
    const assignments = await this.prisma.campaignAssignment.findMany({
      where: { influencerId: profile.id },
      include: { campaign: true },
      orderBy: { scheduledDate: 'desc' },
    });

    let totalEarnings = 0;
    const payouts = [];

    for (const assignment of assignments) {
      const amount = Number(assignment.agreedAmount) || 0;
      const isPaid = assignment.paymentStatus === 'FULLY_PAID';

      // If payment is completed or assignment is complete, it contributes to total earnings (or at least we show it)
      if (isPaid || assignment.paymentStatus === 'ADVANCE_PAID') {
        totalEarnings += amount;
      }

      // Format month string, e.g., "Aug 2026"
      const date = assignment.scheduledDate;
      const monthStr =
        date.toLocaleString('default', { month: 'short' }) +
        ' ' +
        date.getFullYear();

      payouts.push({
        month: monthStr,
        amount: amount,
        status: isPaid ? 'Paid' : 'Pending',
      });
    }

    return {
      totalEarnings,
      payouts,
    };
  }

  // ─── SHOPKEEPER CAMPAIGN MANAGEMENT ──────────────────────────────────────

  async createCampaign(shopkeeperId: string, dto: CreateCampaignDto) {
    const shop = await this.prisma.shop.findUnique({
      where: { ownerId: shopkeeperId },
    });
    if (!shop) throw new NotFoundException('Shop not found');

    return this.prisma.influencerCampaign.create({
      data: {
        shopkeeperId,
        shopId: shop.id,
        title: dto.title,
        description: dto.description,
        productId: dto.productId,
        platforms: dto.platforms,
        contentTypes: dto.contentTypes,
        creatorCount: dto.creatorCount || 1,
        budgetType: dto.budgetType,
        budgetMin: dto.budgetMin,
        budgetMax: dto.budgetMax,
        city: dto.city,
        targetCategories: dto.targetCategories || [],
        applicationDeadline: dto.applicationDeadline
          ? new Date(dto.applicationDeadline)
          : null,
        publishByDate: dto.publishByDate ? new Date(dto.publishByDate) : null,
        status: CampaignStatus.PUBLISHED,
      },
    });
  }

  async getMyCampaigns(shopkeeperId: string) {
    return this.prisma.influencerCampaign.findMany({
      where: { shopkeeperId },
      orderBy: { createdAt: 'desc' },
      include: {
        shop: true,
        product: {
          include: {
            mediaAssets: true,
          },
        },
        _count: {
          select: { bids: true },
        },
      },
    });
  }

  async updateCampaign(
    shopkeeperId: string,
    campaignId: string,
    dto: UpdateCampaignDto,
  ) {
    const campaign = await this.prisma.influencerCampaign.findFirst({
      where: { id: campaignId, shopkeeperId },
    });
    if (!campaign) throw new NotFoundException('Campaign not found');

    const data: Prisma.InfluencerCampaignUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.platforms !== undefined) data.platforms = dto.platforms;
    if (dto.contentTypes !== undefined) data.contentTypes = dto.contentTypes;
    if (dto.creatorCount !== undefined) data.creatorCount = dto.creatorCount;
    if (dto.budgetType !== undefined) data.budgetType = dto.budgetType;
    if (dto.budgetMin !== undefined) data.budgetMin = dto.budgetMin;
    if (dto.budgetMax !== undefined) data.budgetMax = dto.budgetMax;
    if (dto.city !== undefined) data.city = dto.city;
    if (dto.targetCategories !== undefined) {
      data.targetCategories = dto.targetCategories;
    }
    if (dto.productId) {
      data.product = { connect: { id: dto.productId } };
    } else if (dto.productId === null && campaign.productId) {
      data.product = { disconnect: true };
    }
    if (dto.applicationDeadline !== undefined) {
      data.applicationDeadline = dto.applicationDeadline
        ? new Date(dto.applicationDeadline)
        : null;
    }
    if (dto.publishByDate !== undefined) {
      data.publishByDate = dto.publishByDate
        ? new Date(dto.publishByDate)
        : null;
    }

    return this.prisma.influencerCampaign.update({
      where: { id: campaignId },
      data,
    });
  }

  async deleteCampaign(shopkeeperId: string, campaignId: string) {
    const campaign = await this.prisma.influencerCampaign.findFirst({
      where: { id: campaignId, shopkeeperId },
    });
    if (!campaign) throw new NotFoundException('Campaign not found');

    return this.prisma.influencerCampaign.delete({
      where: { id: campaignId },
    });
  }

  async getCampaignBids(shopkeeperId: string, campaignId: string) {
    const campaign = await this.prisma.influencerCampaign.findFirst({
      where: { id: campaignId, shopkeeperId },
    });
    if (!campaign) throw new NotFoundException('Campaign not found');

    return this.prisma.influencerBid.findMany({
      where: { campaignId, status: { not: BidStatus.WITHDRAWN } },
      include: {
        influencer: {
          include: {
            user: {
              select: { id: true, name: true, avatarUrl: true, mobile: true },
            },
          },
        },
      },
      orderBy: { proposedAmount: 'asc' },
    });
  }

  async acceptBid(shopkeeperId: string, bidId: string) {
    const bid = await this.prisma.influencerBid.findUnique({
      where: { id: bidId },
      include: { campaign: true, influencer: true },
    });
    if (!bid || bid.campaign.shopkeeperId !== shopkeeperId) {
      throw new NotFoundException('Bid not found');
    }

    if (
      bid.status !== BidStatus.SUBMITTED &&
      bid.status !== BidStatus.SHORTLISTED &&
      bid.status !== BidStatus.COUNTERED
    ) {
      throw new BadRequestException(
        'Bid is not in a valid state to be accepted',
      );
    }

    if (
      bid.campaign.status !== CampaignStatus.PUBLISHED &&
      bid.campaign.status !== CampaignStatus.BIDDING_OPEN
    ) {
      throw new BadRequestException('Campaign is no longer accepting bids');
    }

    // Bid, campaign and assignment change together or not at all.
    const updatedCampaign = await this.prisma.$transaction(async (tx) => {
      const accepted = await tx.influencerBid.updateMany({
        where: { id: bidId, status: bid.status },
        data: { status: BidStatus.ACCEPTED },
      });
      if (accepted.count === 0) {
        throw new BadRequestException(
          'Bid is not in a valid state to be accepted',
        );
      }

      const campaignUpdate = await tx.influencerCampaign.update({
        where: { id: bid.campaignId },
        data: { status: CampaignStatus.CREATOR_SELECTED },
      });

      await tx.campaignAssignment.create({
        data: {
          campaignId: bid.campaignId,
          bidId: bid.id,
          shopkeeperId: bid.campaign.shopkeeperId,
          influencerId: bid.influencerId,
          agreedAmount: bid.proposedAmount,
          scheduledDate: bid.availableDate ?? new Date(),
          deliveryDate: bid.deliveryDate ?? new Date(),
        },
      });

      return campaignUpdate;
    });

    // Notify influencer
    this.notificationsService.sendNotification(
      bid.influencer.userId,
      NotificationType.BID_ACCEPTED,
      'Bid Accepted!',
      `Your bid for campaign '${updatedCampaign.title}' was accepted!`,
      { campaignId: bid.campaignId, bidId },
    );

    return updatedCampaign;
  }

  async counterBid(
    shopkeeperId: string,
    bidId: string,
    counterAmount: number,
    message?: string,
  ) {
    const bid = await this.prisma.influencerBid.findUnique({
      where: { id: bidId },
      include: { campaign: true, influencer: true },
    });
    if (!bid || bid.campaign.shopkeeperId !== shopkeeperId) {
      throw new NotFoundException('Bid not found');
    }
    if (
      bid.status === BidStatus.ACCEPTED ||
      bid.status === BidStatus.REJECTED ||
      bid.status === BidStatus.WITHDRAWN ||
      bid.status === BidStatus.EXPIRED
    ) {
      throw new BadRequestException(
        'Bid is not in a valid state to receive a counter offer',
      );
    }

    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hours

    // Create counter offer record
    const counterOffer = await this.prisma.campaignCounterOffer.create({
      data: {
        bidId,
        senderId: shopkeeperId,
        amount: counterAmount,
        message: message ?? null,
        expiresAt,
      },
    });

    // Update bid status to COUNTERED
    await this.prisma.influencerBid.update({
      where: { id: bidId },
      data: { status: BidStatus.COUNTERED },
    });

    // Notify influencer
    this.notificationsService.sendNotification(
      bid.influencer.userId,
      NotificationType.BID_COUNTERED,
      'Counter Offer Received',
      `The retailer made a counter offer of ₹${counterAmount} for your bid.`,
      { campaignId: bid.campaignId, bidId },
    );

    return counterOffer;
  }

  // ─── INFLUENCER COUNTER BID RESPONSE ─────────────────────────────────────

  async withdrawBid(userId: string, bidId: string) {
    const profile = await this.getProfile(userId);
    const bid = await this.prisma.influencerBid.findFirst({
      where: { id: bidId, influencerId: profile.id },
    });
    if (!bid) throw new NotFoundException('Bid not found');

    if (
      bid.status !== BidStatus.SUBMITTED &&
      bid.status !== BidStatus.VIEWED &&
      bid.status !== BidStatus.SHORTLISTED &&
      bid.status !== BidStatus.COUNTERED
    ) {
      throw new BadRequestException(
        `A ${bid.status.toLowerCase()} bid cannot be withdrawn`,
      );
    }

    return this.prisma.influencerBid.update({
      where: { id: bidId },
      data: { status: BidStatus.WITHDRAWN },
    });
  }

  async acceptCounterBid(userId: string, bidId: string) {
    const profile = await this.getProfile(userId);
    const bid = await this.prisma.influencerBid.findUnique({
      where: { id: bidId, influencerId: profile.id },
      include: {
        campaign: true,
        counterOffers: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });

    if (!bid || bid.status !== BidStatus.COUNTERED) {
      throw new BadRequestException(
        'Bid is not awaiting counter offer response',
      );
    }

    const latestCounter = bid.counterOffers[0];
    if (!latestCounter) {
      throw new BadRequestException('No counter offer found');
    }

    // Accept bid
    await this.prisma.influencerBid.update({
      where: { id: bidId },
      data: {
        status: BidStatus.ACCEPTED,
        proposedAmount: latestCounter.amount,
      },
    });

    // Update campaign
    const updatedCampaign = await this.prisma.influencerCampaign.update({
      where: { id: bid.campaignId },
      data: { status: CampaignStatus.CREATOR_SELECTED },
    });

    // Create Campaign Assignment
    await this.prisma.campaignAssignment.create({
      data: {
        campaignId: bid.campaignId,
        bidId: bid.id,
        shopkeeperId: bid.campaign.shopkeeperId,
        influencerId: bid.influencerId,
        agreedAmount: latestCounter.amount,
        scheduledDate: bid.availableDate ?? new Date(),
        deliveryDate: bid.deliveryDate ?? new Date(),
      },
    });

    // Notify retailer
    this.notificationsService.sendNotification(
      bid.campaign.shopkeeperId,
      NotificationType.BID_ACCEPTED,
      'Counter Offer Accepted!',
      `The influencer accepted your counter offer for '${updatedCampaign.title}'.`,
      { campaignId: bid.campaignId, bidId },
    );

    return updatedCampaign;
  }

  async rejectCounterBid(userId: string, bidId: string) {
    const profile = await this.getProfile(userId);
    const bid = await this.prisma.influencerBid.findUnique({
      where: { id: bidId, influencerId: profile.id },
      include: { campaign: true },
    });

    if (!bid || bid.status !== BidStatus.COUNTERED) {
      throw new BadRequestException(
        'Bid is not awaiting counter offer response',
      );
    }

    await this.prisma.influencerBid.update({
      where: { id: bidId },
      data: { status: BidStatus.REJECTED },
    });

    this.notificationsService.sendNotification(
      bid.campaign.shopkeeperId,
      NotificationType.BID_REJECTED,
      'Counter Offer Rejected',
      `The influencer rejected your counter offer.`,
      { campaignId: bid.campaignId, bidId },
    );

    return { success: true };
  }

  // ─── FULFILLMENT & ASSIGNMENTS ──────────────────────────────────────────

  async getMyAssignments(userId: string) {
    const profile = await this.getProfile(userId);
    return this.prisma.campaignAssignment.findMany({
      where: { influencerId: profile.id },
      include: { campaign: { include: { shop: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async submitDeliverable(
    userId: string,
    assignmentId: string,
    contentUrl: string,
  ) {
    const profile = await this.getProfile(userId);
    const assignment = await this.prisma.campaignAssignment.findUnique({
      where: { id: assignmentId, influencerId: profile.id },
      include: { campaign: true },
    });

    if (!assignment) throw new NotFoundException('Assignment not found');

    const updated = await this.prisma.campaignAssignment.update({
      where: { id: assignmentId },
      data: {
        submittedContentUrl: contentUrl,
        contentStatus: ContentStatus.SUBMITTED,
      },
    });

    this.notificationsService.sendNotification(
      assignment.shopkeeperId,
      NotificationType.SYSTEM, // Using SYSTEM type or a suitable one
      'Deliverables Submitted',
      `Influencer submitted their deliverables for '${assignment.campaign.title}'.`,
      { assignmentId },
    );

    return updated;
  }

  async getShopkeeperAssignments(shopkeeperId: string) {
    return this.prisma.campaignAssignment.findMany({
      where: { shopkeeperId },
      include: {
        influencer: { include: { user: { select: { avatarUrl: true } } } },
        campaign: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async releasePayment(shopkeeperId: string, assignmentId: string) {
    const assignment = await this.prisma.campaignAssignment.findUnique({
      where: { id: assignmentId, shopkeeperId },
      include: { campaign: true, influencer: true },
    });

    if (!assignment) throw new NotFoundException('Assignment not found');
    if (
      assignment.contentStatus !== ContentStatus.SUBMITTED &&
      assignment.contentStatus !== ContentStatus.APPROVED &&
      assignment.contentStatus !== ContentStatus.POSTED
    ) {
      throw new BadRequestException('Content must be submitted before payment');
    }

    const updated = await this.prisma.campaignAssignment.update({
      where: { id: assignmentId },
      data: {
        paymentStatus: 'FULLY_PAID',
        status: 'completed',
      },
    });

    this.notificationsService.sendNotification(
      assignment.influencer.userId,
      NotificationType.SYSTEM,
      'Payment Released!',
      `Your payment of ₹${String(assignment.agreedAmount)} for '${assignment.campaign.title}' has been released.`,
      { assignmentId },
    );

    return updated;
  }
}

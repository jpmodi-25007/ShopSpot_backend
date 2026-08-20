import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateInfluencerProfileDto, CreateCampaignDto, SubmitBidDto } from './dto/influencer.dto';
import { CampaignStatus, BidStatus, UserRole } from '@prisma/client';

@Injectable()
export class InfluencerService {
  constructor(private prisma: PrismaService) {}

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
        userId,
        displayName: dto.displayName || 'Creator',
        username: dto.username || `creator_${Date.now()}`,
        ...dto,
      },
    });
  }

  // ─── CAMPAIGNS FOR INFLUENCER ────────────────────────────────────────────

  async getEligibleCampaigns(userId: string) {
    // Simplified: return published campaigns
    return this.prisma.influencerCampaign.findMany({
      where: { status: CampaignStatus.PUBLISHED },
      include: { shop: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async submitBid(userId: string, campaignId: string, dto: SubmitBidDto) {
    const profile = await this.getProfile(userId);
    
    // Check if campaign is accepting bids
    const campaign = await this.prisma.influencerCampaign.findUnique({
      where: { id: campaignId },
    });
    if (!campaign || (campaign.status !== CampaignStatus.PUBLISHED && campaign.status !== CampaignStatus.BIDDING_OPEN)) {
      throw new BadRequestException('Campaign is not accepting bids');
    }

    // Ensure no duplicate active bid
    const existingBid = await this.prisma.influencerBid.findFirst({
      where: {
        campaignId,
        influencerId: profile.id,
        status: {
          notIn: [BidStatus.WITHDRAWN, BidStatus.REJECTED]
        }
      }
    });
    if (existingBid) {
      throw new BadRequestException('You already have an active bid for this campaign');
    }

    return this.prisma.influencerBid.create({
      data: {
        campaignId,
        influencerId: profile.id,
        proposedAmount: dto.proposedAmount,
        availableDate: new Date(dto.availableDate),
        deliveryDate: new Date(dto.deliveryDate),
        proposal: dto.proposal,
      },
    });
  }

  async getMyBids(userId: string) {
    const profile = await this.getProfile(userId);
    return this.prisma.influencerBid.findMany({
      where: { influencerId: profile.id },
      include: { campaign: true },
      orderBy: { createdAt: 'desc' },
    });
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
      const monthStr = date.toLocaleString('default', { month: 'short' }) + ' ' + date.getFullYear();

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
        applicationDeadline: dto.applicationDeadline ? new Date(dto.applicationDeadline) : null,
        status: CampaignStatus.PUBLISHED,
      },
    });
  }

  async getMyCampaigns(shopkeeperId: string) {
    return this.prisma.influencerCampaign.findMany({
      where: { shopkeeperId },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { bids: true }
        }
      }
    });
  }

  async getCampaignBids(shopkeeperId: string, campaignId: string) {
    const campaign = await this.prisma.influencerCampaign.findFirst({
      where: { id: campaignId, shopkeeperId },
    });
    if (!campaign) throw new NotFoundException('Campaign not found');

    return this.prisma.influencerBid.findMany({
      where: { campaignId },
      include: { influencer: { include: { user: { select: { avatarUrl: true } } } } },
      orderBy: { proposedAmount: 'asc' },
    });
  }

  async acceptBid(shopkeeperId: string, bidId: string) {
    const bid = await this.prisma.influencerBid.findUnique({
      where: { id: bidId },
      include: { campaign: true },
    });
    if (!bid || bid.campaign.shopkeeperId !== shopkeeperId) {
      throw new NotFoundException('Bid not found');
    }

    if (bid.status !== BidStatus.SUBMITTED && bid.status !== BidStatus.SHORTLISTED && bid.status !== BidStatus.COUNTERED) {
      throw new BadRequestException('Bid is not in a valid state to be accepted');
    }

    if (bid.campaign.status !== CampaignStatus.PUBLISHED && bid.campaign.status !== CampaignStatus.BIDDING_OPEN) {
      throw new BadRequestException('Campaign is no longer accepting bids');
    }

    // Accept bid
    await this.prisma.influencerBid.update({
      where: { id: bidId },
      data: { status: BidStatus.ACCEPTED },
    });

    // Update campaign
    return this.prisma.influencerCampaign.update({
      where: { id: bid.campaignId },
      data: { status: CampaignStatus.CREATOR_SELECTED },
    });
  }
}

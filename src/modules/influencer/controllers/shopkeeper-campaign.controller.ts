import { Controller, Get, Post, Body, UseGuards, Param } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { InfluencerService } from '../influencer.service';
import { CreateCampaignDto } from '../dto/influencer.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';

@ApiTags('Shopkeeper Campaigns')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SHOPKEEPER)
@Controller('shopkeeper/influencer-campaigns')
export class ShopkeeperCampaignController {
  constructor(private readonly influencerService: InfluencerService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new influencer campaign' })
  createCampaign(@CurrentUser('id') userId: string, @Body() dto: CreateCampaignDto) {
    return this.influencerService.createCampaign(userId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Get my campaigns' })
  getMyCampaigns(@CurrentUser('id') userId: string) {
    return this.influencerService.getMyCampaigns(userId);
  }

  @Get(':id/bids')
  @ApiOperation({ summary: 'Get bids for a specific campaign' })
  getCampaignBids(@CurrentUser('id') userId: string, @Param('id') campaignId: string) {
    return this.influencerService.getCampaignBids(userId, campaignId);
  }

  @Post('bids/:id/accept')
  @ApiOperation({ summary: 'Accept an influencer bid' })
  acceptBid(@CurrentUser('id') userId: string, @Param('id') bidId: string) {
    return this.influencerService.acceptBid(userId, bidId);
  }
}

import { Controller, Get, Post, Body, UseGuards, Param, Patch, Delete } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { InfluencerService } from '../influencer.service';
import { CreateCampaignDto } from '../dto/influencer.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';

class CounterBidDto {
  @IsNumber()
  @Min(1)
  counterAmount: number;

  @IsOptional()
  @IsString()
  message?: string;
}

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

  @Post('bids/:id/counter')
  @ApiOperation({ summary: 'Counter an influencer bid' })
  counterBid(
    @CurrentUser('id') userId: string,
    @Param('id') bidId: string,
    @Body() dto: CounterBidDto
  ) {
    return this.influencerService.counterBid(userId, bidId, dto.counterAmount, dto.message);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an influencer campaign' })
  updateCampaign(
    @CurrentUser('id') userId: string,
    @Param('id') campaignId: string,
    @Body() dto: Partial<CreateCampaignDto>
  ) {
    return this.influencerService.updateCampaign(userId, campaignId, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete an influencer campaign' })
  deleteCampaign(
    @CurrentUser('id') userId: string,
    @Param('id') campaignId: string
  ) {
    return this.influencerService.deleteCampaign(userId, campaignId);
  }

  @Get('assignments')
  @ApiOperation({ summary: 'Get all campaign assignments for my campaigns' })
  getAssignments(@CurrentUser('id') userId: string) {
    return this.influencerService.getShopkeeperAssignments(userId);
  }

  @Post('assignments/:id/pay')
  @ApiOperation({ summary: 'Release payment for a completed assignment' })
  releasePayment(
    @CurrentUser('id') userId: string,
    @Param('id') assignmentId: string
  ) {
    return this.influencerService.releasePayment(userId, assignmentId);
  }
}

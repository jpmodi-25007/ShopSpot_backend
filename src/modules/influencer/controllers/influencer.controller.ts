import { Controller, Get, Post, Put, Patch, Body, UseGuards, Param, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { InfluencerService } from '../influencer.service';
import { UpdateInfluencerProfileDto, SubmitBidDto } from '../dto/influencer.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';

@ApiTags('Influencer')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.INFLUENCER)
@Controller('influencer')
export class InfluencerController {
  constructor(private readonly influencerService: InfluencerService) {}

  @Get('profile')
  @ApiOperation({ summary: 'Get influencer profile' })
  getProfile(@CurrentUser('id') userId: string) {
    return this.influencerService.getProfile(userId);
  }

  @Get('analytics')
  @ApiOperation({ summary: 'Get influencer earnings and analytics' })
  getAnalytics(@CurrentUser('id') userId: string) {
    return this.influencerService.getAnalytics(userId);
  }

  @Put('profile')
  @ApiOperation({ summary: 'Update or create influencer profile' })
  updateProfile(@CurrentUser('id') userId: string, @Body() dto: UpdateInfluencerProfileDto) {
    return this.influencerService.updateProfile(userId, dto);
  }

  @Get('campaigns')
  @ApiOperation({ summary: 'Get eligible campaigns for influencer' })
  getCampaigns(@CurrentUser('id') userId: string, @Query('industry') industry?: string) {
    return this.influencerService.getEligibleCampaigns(userId, industry);
  }

  @Get('bids')
  @ApiOperation({ summary: 'Get my bids' })
  getMyBids(@CurrentUser('id') userId: string) {
    return this.influencerService.getMyBids(userId);
  }

  @Post('campaigns/:id/bids')
  @ApiOperation({ summary: 'Submit a bid for a campaign' })
  submitBid(
    @CurrentUser('id') userId: string,
    @Param('id') campaignId: string,
    @Body() dto: SubmitBidDto,
  ) {
    return this.influencerService.submitBid(userId, campaignId, dto);
  }

  @Post('bids/:id/accept-counter')
  @ApiOperation({ summary: 'Accept a counter offer' })
  acceptCounterBid(@CurrentUser('id') userId: string, @Param('id') bidId: string) {
    return this.influencerService.acceptCounterBid(userId, bidId);
  }

  @Post('bids/:id/reject-counter')
  @ApiOperation({ summary: 'Reject a counter offer' })
  rejectCounterBid(@CurrentUser('id') userId: string, @Param('id') bidId: string) {
    return this.influencerService.rejectCounterBid(userId, bidId);
  }

  @Get('assignments')
  @ApiOperation({ summary: 'Get my campaign assignments' })
  getMyAssignments(@CurrentUser('id') userId: string) {
    return this.influencerService.getMyAssignments(userId);
  }

  @Patch('assignments/:id/submit')
  @ApiOperation({ summary: 'Submit campaign deliverables' })
  submitDeliverable(
    @CurrentUser('id') userId: string, 
    @Param('id') assignmentId: string,
    @Body('contentUrl') contentUrl: string
  ) {
    return this.influencerService.submitDeliverable(userId, assignmentId, contentUrl);
  }
}

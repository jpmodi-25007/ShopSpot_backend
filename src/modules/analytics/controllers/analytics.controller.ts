import { Controller, Get, Post, Body, UseGuards, Req, Param } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AnalyticsService } from '../analytics.service';
import { TrackEventDto } from '../dto/analytics.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';
import { Public } from '../../../common/decorators/public.decorator';

@ApiTags('Analytics')
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Public()
  @Post('events')
  @ApiOperation({ summary: 'Track an analytics event (Public/Authenticated)' })
  trackEvent(@Req() req: any, @Body() dto: TrackEventDto) {
    // If the user happens to have a token and is authenticated via a global guard or optional auth
    // Note: Since it's @Public, we might need to manually extract userId if we want to tie it.
    // Assuming for this MVP, we just pass null for public users or we can get it if injected.
    const userId = req.user?.id || null;
    return this.analyticsService.trackEvent(userId, dto);
  }

  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SHOPKEEPER)
  @Get('shop')
  @ApiOperation({ summary: 'Get shopkeeper analytics dashboard' })
  getShopAnalytics(@CurrentUser('id') userId: string) {
    return this.analyticsService.getShopAnalytics(userId);
  }

  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Get('admin')
  @ApiOperation({ summary: 'Get platform-wide admin analytics dashboard' })
  getAdminAnalytics() {
    return this.analyticsService.getAdminAnalytics();
  }

  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.INFLUENCER)
  @Get('influencer')
  @ApiOperation({ summary: 'Get influencer personal analytics' })
  getInfluencerAnalytics(@CurrentUser('id') userId: string) {
    return this.analyticsService.getInfluencerAnalytics(userId);
  }

  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SHOPKEEPER)
  @Get('influencer/:id')
  @ApiOperation({ summary: 'Get influencer analytics by user id for admin/shopkeeper' })
  getInfluencerAnalyticsById(@Param('id') id: string) {
    return this.analyticsService.getInfluencerAnalytics(id);
  }
}

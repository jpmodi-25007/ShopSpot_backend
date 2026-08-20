import { Controller, Get, Post, Body, UseGuards, Param, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AdminService } from '../admin.service';
import { VerifyShopDto, VerifyInfluencerDto, SuspendUserDto, PaginationDto, ResolveReportDto, CreateShopDto, CreateProductDto } from '../dto/admin.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@ApiTags('Admin')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Get main admin dashboard statistics' })
  getDashboardStats() {
    return this.adminService.getDashboardStats();
  }

  @Get('users')
  @ApiOperation({ summary: 'List all users with pagination' })
  getUsers(@Query() query: PaginationDto) {
    return this.adminService.getUsers(query);
  }

  @Get('shops')
  @ApiOperation({ summary: 'List all shops with pagination' })
  getShops(@Query() query: PaginationDto) {
    return this.adminService.getShops(query);
  }

  @Post('shops')
  @ApiOperation({ summary: 'Create a new shop from admin panel' })
  createShop(@Body() dto: CreateShopDto) {
    return this.adminService.createShop(dto);
  }

  @Post('shops/:id/products')
  @ApiOperation({ summary: 'Create a new product for a shop from admin panel' })
  createProduct(@Param('id') shopId: string, @Body() dto: CreateProductDto) {
    return this.adminService.createProduct(shopId, dto);
  }

  @Get('influencers')
  @ApiOperation({ summary: 'List all influencers with pagination' })
  getInfluencers(@Query() query: PaginationDto) {
    return this.adminService.getInfluencers(query);
  }

  @Get('users/:id')
  @ApiOperation({ summary: 'Get detailed user profile' })
  getUserDetail(@Param('id') userId: string) {
    return this.adminService.getUserDetail(userId);
  }

  @Post('users')
  @ApiOperation({ summary: 'Create a new user from admin panel' })
  createUser(@Body() dto: any) {
    return this.adminService.createUser(dto);
  }

  @Post('influencers')
  @ApiOperation({ summary: 'Create a new influencer from admin panel' })
  createInfluencer(@Body() dto: any) {
    return this.adminService.createInfluencer(dto);
  }

  @Get('shops/:id')
  @ApiOperation({ summary: 'Get detailed shop profile' })
  getShopDetail(@Param('id') shopId: string) {
    return this.adminService.getShopDetail(shopId);
  }

  @Get('influencers/:id')
  @ApiOperation({ summary: 'Get detailed influencer profile' })
  getInfluencerDetail(@Param('id') influencerId: string) {
    return this.adminService.getInfluencerDetail(influencerId);
  }

  @Post('users/:id/suspend')
  @ApiOperation({ summary: 'Suspend or activate a user' })
  suspendUser(@Param('id') userId: string, @Body() dto: SuspendUserDto) {
    return this.adminService.suspendUser(userId, dto);
  }

  @Post('shops/:id/verify')
  @ApiOperation({ summary: 'Verify a shop (KYC & GST)' })
  verifyShop(@Param('id') shopId: string, @Body() dto: VerifyShopDto) {
    return this.adminService.verifyShop(shopId, dto);
  }

  @Post('influencers/:id/verify')
  @ApiOperation({ summary: 'Verify an influencer' })
  verifyInfluencer(@Param('id') influencerId: string, @Body() dto: VerifyInfluencerDto) {
    return this.adminService.verifyInfluencer(influencerId, dto);
  }

  @Get('reports')
  @ApiOperation({ summary: 'List all content moderation reports' })
  getReports(@Query() query: PaginationDto) {
    return this.adminService.getReports(query);
  }

  @Get('reports/stats')
  @ApiOperation({ summary: 'Get stats for moderation reports' })
  getReportStats() {
    return this.adminService.getReportStats();
  }

  @Post('reports/:id/resolve')
  @ApiOperation({ summary: 'Resolve a content moderation report' })
  resolveReport(@Param('id') reportId: string, @Body() dto: ResolveReportDto) {
    return this.adminService.resolveReport(reportId, dto);
  }
  @Get('notifications')
  @ApiOperation({ summary: 'Get all admin system notifications' })
  getAdminNotifications() {
    return this.adminService.getAdminNotifications();
  }

  @Post('notifications/mark-read')
  @ApiOperation({ summary: 'Mark all notifications as read' })
  markNotificationsRead() {
    return this.adminService.markNotificationsRead();
  }

  @Get('settings')
  @ApiOperation({ summary: 'Get platform settings' })
  getSettings() {
    return this.adminService.getSettings();
  }

  @Post('settings')
  @ApiOperation({ summary: 'Update platform settings' })
  updateSettings(@Body() dto: any) {
    return this.adminService.updateSettings(dto);
  }
}

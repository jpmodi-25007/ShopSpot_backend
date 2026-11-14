import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import {
  Controller,
  Get,
  Post,
  Patch,
  Put,
  Delete,
  Body,
  UseGuards,
  Param,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AdminService } from '../admin.service';
import {
  VerifyShopDto,
  VerifyInfluencerDto,
  SuspendUserDto,
  PaginationDto,
  ResolveReportDto,
  CreateShopDto,
  CreateProductDto,
  CreateUserDto,
  CreateInfluencerDto,
  UpdateUserDto,
  UpdateShopDto,
  UpdateProductDto,
  AdminNoteDto,
  BulkReportDto,
  AdminNotificationsQueryDto,
  UpdateSubscriptionPlanDto,
  OverrideShopPlanDto,
} from '../dto/admin.dto';
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

  @Get('summary')
  @ApiOperation({ summary: 'Badge counts for the admin sidebar and bell' })
  getSummary(@CurrentUser('id') actorId: string) {
    return this.adminService.getSummary(actorId);
  }

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
  createUser(@Body() dto: CreateUserDto) {
    return this.adminService.createUser(dto);
  }

  @Post('influencers')
  @ApiOperation({ summary: 'Create a new influencer from admin panel' })
  createInfluencer(@Body() dto: CreateInfluencerDto) {
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
  suspendUser(
    @Param('id') userId: string,
    @Body() dto: SuspendUserDto,
    @CurrentUser('id') actorId: string,
  ) {
    return this.adminService.suspendUser(userId, dto, actorId);
  }

  @Patch('users/:id')
  @ApiOperation({ summary: 'Edit a user profile' })
  updateUser(
    @Param('id') userId: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser('id') actorId: string,
  ) {
    return this.adminService.updateUser(userId, dto, actorId);
  }

  @Delete('users/:id')
  @ApiOperation({ summary: 'Delete a user that has no dependent history' })
  deleteUser(@Param('id') userId: string, @CurrentUser('id') actorId: string) {
    return this.adminService.deleteUser(userId, actorId);
  }

  @Put('users/:id/notes')
  @ApiOperation({ summary: 'Save the internal admin note for a user' })
  setUserNote(
    @Param('id') userId: string,
    @Body() dto: AdminNoteDto,
    @CurrentUser('id') actorId: string,
  ) {
    return this.adminService.setUserNote(userId, dto.note, actorId);
  }

  @Patch('shops/:id')
  @ApiOperation({ summary: 'Edit shop details, status and verification' })
  updateShop(
    @Param('id') shopId: string,
    @Body() dto: UpdateShopDto,
    @CurrentUser('id') actorId: string,
  ) {
    return this.adminService.updateShop(shopId, dto, actorId);
  }

  @Delete('shops/:id')
  @ApiOperation({ summary: 'Delete a shop that has no dependent history' })
  deleteShop(@Param('id') shopId: string, @CurrentUser('id') actorId: string) {
    return this.adminService.deleteShop(shopId, actorId);
  }

  @Patch('products/:id')
  @ApiOperation({ summary: 'Edit a product from the admin panel' })
  updateProduct(
    @Param('id') productId: string,
    @Body() dto: UpdateProductDto,
    @CurrentUser('id') actorId: string,
  ) {
    return this.adminService.updateProduct(productId, dto, actorId);
  }

  @Delete('products/:id')
  @ApiOperation({ summary: 'Deactivate a product' })
  deleteProduct(
    @Param('id') productId: string,
    @CurrentUser('id') actorId: string,
  ) {
    return this.adminService.deleteProduct(productId, actorId);
  }

  @Post('shops/:id/verify')
  @ApiOperation({ summary: 'Verify a shop (KYC & GST)' })
  verifyShop(@Param('id') shopId: string, @Body() dto: VerifyShopDto) {
    return this.adminService.verifyShop(shopId, dto);
  }

  @Post('influencers/:id/verify')
  @ApiOperation({ summary: 'Verify an influencer' })
  verifyInfluencer(
    @Param('id') influencerId: string,
    @Body() dto: VerifyInfluencerDto,
  ) {
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

  @Post('reports/bulk')
  @ApiOperation({ summary: 'Resolve or remove several reported items at once' })
  bulkReports(@Body() dto: BulkReportDto, @CurrentUser('id') actorId: string) {
    return this.adminService.bulkReports(dto.ids, dto.action, actorId);
  }

  @Post('reports/:id/remove')
  @ApiOperation({ summary: 'Take down the reported content and resolve' })
  removeReportedContent(
    @Param('id') reportId: string,
    @CurrentUser('id') actorId: string,
  ) {
    return this.adminService.removeReportedContent(reportId, actorId);
  }

  @Get('notifications')
  @ApiOperation({ summary: "Get the signed-in admin's notifications" })
  getAdminNotifications(
    @CurrentUser('id') actorId: string,
    @Query() query: AdminNotificationsQueryDto,
  ) {
    return this.adminService.getAdminNotifications(actorId, query);
  }

  @Post('notifications/mark-read')
  @ApiOperation({ summary: "Mark the admin's notifications as read" })
  markNotificationsRead(@CurrentUser('id') actorId: string) {
    return this.adminService.markNotificationsRead(actorId);
  }

  @Post('notifications/:id/read')
  @ApiOperation({ summary: "Mark one of the admin's notifications as read" })
  markNotificationRead(
    @CurrentUser('id') actorId: string,
    @Param('id') notificationId: string,
  ) {
    return this.adminService.markNotificationRead(actorId, notificationId);
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

  // ─── SUBSCRIPTION MANAGEMENT ─────────────────────────────────────────────

  @Get('subscription-plans')
  @ApiOperation({ summary: 'Admin: list all subscription plans' })
  getSubscriptionPlans() {
    return this.adminService.getSubscriptionPlans();
  }

  @Post('subscription-plans/seed')
  @ApiOperation({ summary: 'Admin: seed or reset default subscription plans' })
  seedSubscriptionPlans() {
    return this.adminService.seedDefaultPlans();
  }

  @Patch('subscription-plans/:id')
  @ApiOperation({ summary: 'Admin: update a subscription plan' })
  updateSubscriptionPlan(
    @Param('id') id: string,
    @Body() dto: UpdateSubscriptionPlanDto,
  ) {
    return this.adminService.updateSubscriptionPlan(id, dto);
  }

  @Get('subscriptions')
  @ApiOperation({
    summary: 'List all subscriptions, optionally filtered by tier',
  })
  getAllSubscriptions(@Query('tier') tier?: string) {
    return this.adminService.getAllSubscriptions(tier);
  }

  @Get('payments/stats')
  @ApiOperation({ summary: 'Get payment & MRR statistics' })
  getPaymentStats() {
    return this.adminService.getPaymentStats();
  }

  @Post('shops/:id/override-plan')
  @ApiOperation({ summary: 'Admin: override a shop subscription plan' })
  overrideShopPlan(
    @Param('id') shopId: string,
    @Body() dto: OverrideShopPlanDto,
  ) {
    return this.adminService.overrideShopPlan(shopId, dto.tier);
  }
}

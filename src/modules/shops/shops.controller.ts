import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ShopsService } from './shops.service';
import { CreateShopDto, UpdateShopDto, NearbyQueryDto } from './dto/shop.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { UserRole } from '@prisma/client';

@ApiTags('Shops')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class ShopsController {
  constructor(private readonly shopsService: ShopsService) {}

  // ─── SHOPKEEPER ───────────────────────────────────────────────────────────

  @Post('shopkeeper/shops')
  @Roles(UserRole.SHOPKEEPER, UserRole.ADMIN)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Register a new shop' })
  createShop(@CurrentUser('id') userId: string, @Body() dto: CreateShopDto) {
    return this.shopsService.createShop(userId, dto);
  }

  @Get('shopkeeper/shops')
  @Roles(UserRole.SHOPKEEPER, UserRole.ADMIN)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Get my shop details' })
  getMyShop(@CurrentUser('id') userId: string) {
    return this.shopsService.getMyShop(userId);
  }

  @Put('shopkeeper/shops')
  @Roles(UserRole.SHOPKEEPER, UserRole.ADMIN)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Update my shop details' })
  updateShop(@CurrentUser('id') userId: string, @Body() dto: UpdateShopDto) {
    return this.shopsService.updateShop(userId, dto);
  }

  // ─── PUBLIC ───────────────────────────────────────────────────────────────

  @Public()
  @Get('shops/:id')
  @ApiOperation({ summary: 'Get public shop detail' })
  getShop(@Param('id', ParseUUIDPipe) id: string) {
    return this.shopsService.getPublicShop(id);
  }

  @Public()
  @Get('shops/:id/products')
  @ApiOperation({ summary: "Get shop's product catalog" })
  getShopProducts(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.shopsService.getShopProducts(id, +page, +limit);
  }

  @Public()
  @Get('shops/:id/reviews')
  @ApiOperation({ summary: 'Get shop reviews' })
  getShopReviews(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.shopsService.getShopReviews(id, +page, +limit);
  }

  @Public()
  @Get('shops/:id/offers')
  @ApiOperation({ summary: 'Get shop active offers' })
  getShopOffers(@Param('id', ParseUUIDPipe) id: string) {
    return this.shopsService.getShopOffers(id);
  }

  @Public()
  @Get('nearby/shops')
  @ApiOperation({ summary: 'Get nearby shops by lat/lng radius' })
  getNearbyShops(@Query() query: NearbyQueryDto) {
    return this.shopsService.getNearbyShops(query);
  }
}

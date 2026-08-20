import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { NegotiationsService } from './negotiations.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';

@ApiTags('Negotiations')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('access-token')
@Controller()
export class NegotiationsController {
  constructor(private readonly negotiationsService: NegotiationsService) {}

  @Post('negotiations')
  @Roles(UserRole.CUSTOMER)
  start(
    @CurrentUser('id') userId: string,
    @Body() body: { productId: string; offeredPrice: number; message?: string },
  ) {
    return this.negotiationsService.startNegotiation(userId, body);
  }

  @Get('negotiations')
  @Roles(UserRole.CUSTOMER)
  list(
    @CurrentUser('id') userId: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.negotiationsService.getMyNegotiations(userId, +page, +limit);
  }

  @Get('negotiations/:id')
  @Roles(UserRole.CUSTOMER)
  detail(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.negotiationsService.getNegotiationDetail(id, userId);
  }

  @Post('negotiations/:id/counter')
  @Roles(UserRole.CUSTOMER)
  counter(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
    @Body() body: { counterPrice: number },
  ) {
    return this.negotiationsService.counterOffer(id, userId, body.counterPrice);
  }

  @Post('negotiations/:id/accept')
  @Roles(UserRole.CUSTOMER)
  accept(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.negotiationsService.acceptDeal(id, userId);
  }

  @Post('negotiations/:id/reject')
  @Roles(UserRole.CUSTOMER)
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.negotiationsService.rejectDeal(id, userId);
  }

  // Shopkeeper side
  @Get('shopkeeper/negotiations')
  @Roles(UserRole.SHOPKEEPER, UserRole.ADMIN)
  shopList(
    @CurrentUser('id') userId: string,
    @Query('status') status?: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.negotiationsService.getShopNegotiations(
      userId,
      status,
      +page,
      +limit,
    );
  }

  @Post('shopkeeper/negotiations/:id/counter')
  @Roles(UserRole.SHOPKEEPER, UserRole.ADMIN)
  shopCounter(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
    @Body() body: { counterPrice: number; message?: string },
  ) {
    return this.negotiationsService.shopkeeperCounter(
      id,
      userId,
      body.counterPrice,
      body.message,
    );
  }

  @Post('shopkeeper/negotiations/:id/accept')
  @Roles(UserRole.SHOPKEEPER, UserRole.ADMIN)
  shopAccept(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.negotiationsService.shopkeeperAccept(id, userId);
  }

  @Post('shopkeeper/negotiations/:id/reject')
  @Roles(UserRole.SHOPKEEPER, UserRole.ADMIN)
  shopReject(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.negotiationsService.shopkeeperReject(id, userId);
  }
}

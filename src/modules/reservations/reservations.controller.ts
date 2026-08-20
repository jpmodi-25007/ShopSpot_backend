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
import { ReservationsService } from './reservations.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';

@ApiTags('Reservations')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('access-token')
@Controller()
export class ReservationsController {
  constructor(private readonly reservationsService: ReservationsService) {}

  @Post('reservations')
  @Roles(UserRole.CUSTOMER)
  create(
    @CurrentUser('id') userId: string,
    @Body()
    body: {
      productId: string;
      reservedPrice: number;
      quantity?: number;
      negotiationId?: string;
    },
  ) {
    return this.reservationsService.createReservation(userId, body);
  }

  @Get('reservations')
  @Roles(UserRole.CUSTOMER)
  list(
    @CurrentUser('id') userId: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.reservationsService.getMyReservations(userId, +page, +limit);
  }

  @Post('reservations/:id/cancel')
  @Roles(UserRole.CUSTOMER)
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.reservationsService.cancelReservation(id, userId);
  }

  @Post('shopkeeper/reservations/verify-qr')
  @Roles(UserRole.SHOPKEEPER, UserRole.ADMIN)
  verifyQr(
    @CurrentUser('id') userId: string,
    @Body() body: { qrToken: string },
  ) {
    return this.reservationsService.verifyQr(userId, body.qrToken);
  }

  @Post('shopkeeper/reservations/:id/complete')
  @Roles(UserRole.SHOPKEEPER, UserRole.ADMIN)
  complete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.reservationsService.completeReservation(id, userId);
  }

  @Get('shopkeeper/reservations')
  @Roles(UserRole.SHOPKEEPER, UserRole.ADMIN)
  shopList(
    @CurrentUser('id') userId: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.reservationsService.getShopReservations(userId, +page, +limit);
  }
}

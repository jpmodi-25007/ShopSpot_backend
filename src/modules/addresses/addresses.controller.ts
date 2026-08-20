import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Request } from '@nestjs/common';
import { AddressesService } from './addresses.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@Controller('addresses')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.CUSTOMER, UserRole.INFLUENCER, UserRole.SHOPKEEPER)
export class AddressesController {
  constructor(private readonly addressesService: AddressesService) {}

  @Get()
  getAddresses(@Request() req: any) {
    return this.addressesService.getAddresses(req.user.id);
  }

  @Post()
  createAddress(@Request() req: any, @Body() data: any) {
    return this.addressesService.createAddress(req.user.id, data);
  }

  @Put(':id')
  updateAddress(@Request() req: any, @Param('id') addressId: string, @Body() data: any) {
    return this.addressesService.updateAddress(req.user.id, addressId, data);
  }

  @Delete(':id')
  deleteAddress(@Request() req: any, @Param('id') addressId: string) {
    return this.addressesService.deleteAddress(req.user.id, addressId);
  }
}

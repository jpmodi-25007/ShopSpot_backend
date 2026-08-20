import { Controller, Get, Post, Delete, Param, UseGuards, Request } from '@nestjs/common';
import { SavedService } from './saved.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@Controller('saved')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.CUSTOMER) // Usually CUSTOMERs save products/shops
export class SavedController {
  constructor(private readonly savedService: SavedService) {}

  @Get('products')
  getSavedProducts(@Request() req: any) {
    return this.savedService.getSavedProducts(req.user.id);
  }

  @Post('products/:id')
  saveProduct(@Request() req: any, @Param('id') productId: string) {
    return this.savedService.saveProduct(req.user.id, productId);
  }

  @Delete('products/:id')
  removeSavedProduct(@Request() req: any, @Param('id') productId: string) {
    return this.savedService.removeSavedProduct(req.user.id, productId);
  }

  @Get('shops')
  getSavedShops(@Request() req: any) {
    return this.savedService.getSavedShops(req.user.id);
  }

  @Post('shops/:id')
  saveShop(@Request() req: any, @Param('id') shopId: string) {
    return this.savedService.saveShop(req.user.id, shopId);
  }

  @Delete('shops/:id')
  removeSavedShop(@Request() req: any, @Param('id') shopId: string) {
    return this.savedService.removeSavedShop(req.user.id, shopId);
  }
}

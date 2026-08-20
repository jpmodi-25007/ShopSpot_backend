import { Controller, Get, Post, Body, UseGuards, Put, Param, Delete } from '@nestjs/common';
import { RetailerInventoryService } from './retailer-inventory.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';

@Controller('shopkeeper/inventory')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SHOPKEEPER)
export class RetailerInventoryController {
  constructor(private readonly inventoryService: RetailerInventoryService) {}

  @Get('suppliers')
  async getSuppliers(@CurrentUser('id') userId: string) {
    return this.inventoryService.getSuppliers(userId);
  }

  @Post('suppliers')
  async createSupplier(@CurrentUser('id') userId: string, @Body() data: any) {
    return this.inventoryService.createSupplier(userId, data);
  }

  @Get('purchase-orders')
  async getPurchaseOrders(@CurrentUser('id') userId: string) {
    return this.inventoryService.getPurchaseOrders(userId);
  }

  @Post('purchase-orders')
  async createPurchaseOrder(@CurrentUser('id') userId: string, @Body() data: any) {
    return this.inventoryService.createPurchaseOrder(userId, data);
  }

  @Get('stock-history')
  async getStockHistory(@CurrentUser('id') userId: string) {
    return this.inventoryService.getStockHistory(userId);
  }
}

import { Controller, Get, Post, Patch, Body, UseGuards, Param } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { OrdersService } from '../orders.service';
import { CreateOrderDto, UpdateOrderStatusDto } from '../dto/orders.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';

@ApiTags('Orders')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new order (Customer)' })
  createOrder(@CurrentUser('id') userId: string, @Body() dto: CreateOrderDto) {
    return this.ordersService.createOrder(userId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Get my orders (Customer)' })
  getMyOrders(@CurrentUser('id') userId: string) {
    return this.ordersService.getMyOrders(userId);
  }

  @Get('shop')
  @Roles(UserRole.SHOPKEEPER)
  @ApiOperation({ summary: 'Get orders for my shop (Shopkeeper)' })
  getShopOrders(@CurrentUser('id') userId: string) {
    return this.ordersService.getShopOrders(userId);
  }

  @Patch(':id/status')
  @Roles(UserRole.SHOPKEEPER)
  @ApiOperation({ summary: 'Update order status (Shopkeeper)' })
  updateOrderStatus(
    @CurrentUser('id') userId: string,
    @Param('id') orderId: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    return this.ordersService.updateOrderStatus(userId, orderId, dto);
  }
}

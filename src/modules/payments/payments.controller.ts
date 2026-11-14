import {
  Controller,
  Post,
  Get,
  Body,
  Headers,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { PaymentsService } from './payments.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { UserRole } from '@prisma/client';
import {
  CreateOrderDto,
  VerifyPaymentDto,
} from '../subscriptions/dto/subscriptions.dto';

@ApiTags('Payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SHOPKEEPER)
  @Post('create-order')
  @ApiOperation({ summary: 'Create a Razorpay order for a subscription plan' })
  createOrder(@CurrentUser('id') userId: string, @Body() dto: CreateOrderDto) {
    return this.paymentsService.createOrder(userId, dto);
  }

  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SHOPKEEPER)
  @Post('verify')
  @ApiOperation({ summary: 'Verify payment and activate subscription' })
  verifyPayment(
    @CurrentUser('id') userId: string,
    @Body() dto: VerifyPaymentDto,
  ) {
    return this.paymentsService.verifyPayment(userId, dto);
  }

  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SHOPKEEPER)
  @Get('history')
  @ApiOperation({ summary: 'Get payment history for my shop' })
  getHistory(@CurrentUser('id') userId: string) {
    return this.paymentsService.getPaymentHistory(userId);
  }

  @Public()
  @Post('webhook')
  @HttpCode(200)
  @ApiOperation({ summary: 'Razorpay webhook endpoint' })
  webhook(
    @Body() payload: any,
    @Headers('x-razorpay-signature') signature: string,
  ) {
    return this.paymentsService.handleWebhook(payload, signature);
  }
}

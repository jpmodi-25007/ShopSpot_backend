import {
  Injectable,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import {
  CreateOrderDto,
  VerifyPaymentDto,
} from '../subscriptions/dto/subscriptions.dto';

@Injectable()
export class PaymentsService {
  private readonly razorpayKeyId: string;
  private readonly razorpayKeySecret: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptionsService: SubscriptionsService,
  ) {
    this.razorpayKeyId = process.env.RAZORPAY_KEY_ID || '';
    this.razorpayKeySecret = process.env.RAZORPAY_KEY_SECRET || '';
  }

  async createOrder(shopkeeperId: string, dto: CreateOrderDto) {
    const shop = await this.prisma.shop.findUnique({
      where: { ownerId: shopkeeperId },
    });
    if (!shop) throw new NotFoundException('Shop not found');

    const plan = await this.prisma.subscriptionPlan.findUnique({
      where: { id: dto.planId },
    });
    if (!plan || !plan.isActive) throw new NotFoundException('Plan not found');

    // Free plan — no payment needed, activate directly
    if (Number(plan.price) === 0) {
      const subscription = await this.subscriptionsService.activateSubscription(
        shop.id,
        plan.id,
        null,
      );
      return { free: true, subscription };
    }

    // Create Razorpay order via REST API
    const amountPaise = Math.round(Number(plan.price) * 100);
    const orderPayload = {
      amount: amountPaise,
      currency: 'INR',
      receipt: `shop_${shop.id}_plan_${plan.id}_${Date.now()}`,
      notes: {
        shopId: shop.id,
        planId: plan.id,
        planName: plan.name,
      },
    };

    const auth = Buffer.from(
      `${this.razorpayKeyId}:${this.razorpayKeySecret}`,
    ).toString('base64');
    const response = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(orderPayload),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new InternalServerErrorException(`Razorpay error: ${err}`);
    }

    const rzpOrder = await response.json();

    // Store order in DB
    await this.prisma.razorpayOrder.create({
      data: {
        shopId: shop.id,
        planId: plan.id,
        razorpayOrderId: rzpOrder.id,
        amount: plan.price,
        currency: 'INR',
        status: 'created',
      },
    });

    return {
      free: false,
      orderId: rzpOrder.id,
      amount: amountPaise,
      currency: 'INR',
      keyId: this.razorpayKeyId,
      planName: plan.name,
    };
  }

  async verifyPayment(shopkeeperId: string, dto: VerifyPaymentDto) {
    const shop = await this.prisma.shop.findUnique({
      where: { ownerId: shopkeeperId },
    });
    if (!shop) throw new NotFoundException('Shop not found');

    // Load order from DB
    const order = await this.prisma.razorpayOrder.findUnique({
      where: { razorpayOrderId: dto.razorpayOrderId },
    });
    if (!order || order.shopId !== shop.id) {
      throw new BadRequestException('Order not found');
    }
    if (order.status === 'paid') {
      throw new BadRequestException('Order already processed');
    }

    // Verify HMAC signature
    const body = `${dto.razorpayOrderId}|${dto.razorpayPaymentId}`;
    const expectedSignature = crypto
      .createHmac('sha256', this.razorpayKeySecret)
      .update(body)
      .digest('hex');

    if (expectedSignature !== dto.razorpaySignature) {
      await this.prisma.razorpayOrder.update({
        where: { id: order.id },
        data: { status: 'failed' },
      });
      throw new BadRequestException(
        'Payment verification failed: invalid signature',
      );
    }

    // Mark order as paid
    await this.prisma.razorpayOrder.update({
      where: { id: order.id },
      data: {
        status: 'paid',
        paymentId: dto.razorpayPaymentId,
        signature: dto.razorpaySignature,
      },
    });

    // Activate subscription
    const subscription = await this.subscriptionsService.activateSubscription(
      shop.id,
      order.planId,
      dto.razorpayOrderId,
    );

    return { success: true, subscription };
  }

  async getPaymentHistory(shopkeeperId: string) {
    const shop = await this.prisma.shop.findUnique({
      where: { ownerId: shopkeeperId },
    });
    if (!shop) throw new NotFoundException('Shop not found');

    return this.prisma.razorpayOrder.findMany({
      where: { shopId: shop.id },
      orderBy: { createdAt: 'desc' },
      include: { shop: { select: { name: true } } },
    });
  }

  async handleWebhook(payload: any, signature: string) {
    // Verify webhook signature
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || '';
    const expectedSig = crypto
      .createHmac('sha256', webhookSecret)
      .update(JSON.stringify(payload))
      .digest('hex');

    if (expectedSig !== signature) {
      throw new BadRequestException('Invalid webhook signature');
    }

    if (payload.event === 'payment.captured') {
      const paymentId = payload.payload?.payment?.entity?.id;
      const orderId = payload.payload?.payment?.entity?.order_id;
      if (orderId) {
        const order = await this.prisma.razorpayOrder.findUnique({
          where: { razorpayOrderId: orderId },
        });
        if (order && order.status !== 'paid') {
          await this.prisma.razorpayOrder.update({
            where: { id: order.id },
            data: { status: 'paid', paymentId },
          });
          await this.subscriptionsService.activateSubscription(
            order.shopId,
            order.planId,
            orderId,
          );
        }
      }
    }

    return { received: true };
  }
}

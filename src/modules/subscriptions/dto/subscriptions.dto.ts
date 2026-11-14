import { IsString, IsUUID, IsEnum, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { SubscriptionTier } from '@prisma/client';

export class CreateOrderDto {
  @ApiProperty({ description: 'ID of the SubscriptionPlan' })
  @IsUUID()
  planId: string;
}

export class VerifyPaymentDto {
  @ApiProperty()
  @IsString()
  razorpayOrderId: string;

  @ApiProperty()
  @IsString()
  razorpayPaymentId: string;

  @ApiProperty()
  @IsString()
  razorpaySignature: string;
}

export class SubscribeDto {
  @ApiProperty({ enum: SubscriptionTier })
  @IsEnum(SubscriptionTier)
  tier: SubscriptionTier;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  planName?: string;
}

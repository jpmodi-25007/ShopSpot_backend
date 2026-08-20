import { IsString, IsNumber, IsOptional, IsEnum, IsObject, IsArray } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DeliveryType, OrderStatus } from '@prisma/client';

export class CreateOrderDto {
  @ApiProperty()
  @IsString()
  shopId: string;

  @ApiProperty()
  @IsArray()
  items: any[];

  @ApiProperty()
  @IsNumber()
  subtotal: number;

  @ApiPropertyOptional()
  @IsNumber()
  @IsOptional()
  deliveryCharge?: number;

  @ApiPropertyOptional()
  @IsNumber()
  @IsOptional()
  discount?: number;

  @ApiProperty()
  @IsNumber()
  total: number;

  @ApiProperty()
  @IsObject()
  deliveryAddress: any;

  @ApiPropertyOptional({ enum: DeliveryType })
  @IsEnum(DeliveryType)
  @IsOptional()
  deliveryType?: DeliveryType;
}

export class UpdateOrderStatusDto {
  @ApiProperty({ enum: OrderStatus })
  @IsEnum(OrderStatus)
  status: OrderStatus;
}

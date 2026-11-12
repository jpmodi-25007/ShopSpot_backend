import {
  IsString,
  IsNumber,
  IsOptional,
  IsEnum,
  IsObject,
  IsArray,
  ArrayMinSize,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DeliveryType, OrderStatus } from '@prisma/client';

export class CreateOrderDto {
  @ApiProperty()
  @IsString()
  shopId: string;

  @ApiProperty()
  @IsArray()
  @ArrayMinSize(1)
  items: any[];

  @ApiProperty()
  @IsNumber()
  @Min(0)
  subtotal: number;

  @ApiPropertyOptional()
  @IsNumber()
  @Min(0)
  @IsOptional()
  deliveryCharge?: number;

  @ApiPropertyOptional()
  @IsNumber()
  @Min(0)
  @IsOptional()
  discount?: number;

  @ApiProperty()
  @IsNumber()
  @Min(0)
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

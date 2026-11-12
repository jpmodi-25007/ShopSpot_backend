import {
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class StartNegotiationDto {
  @IsUUID()
  productId: string;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  offeredPrice: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  message?: string;
}

export class CustomerCounterDto {
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  counterPrice: number;
}

export class ShopkeeperCounterDto {
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  counterPrice: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  message?: string;
}

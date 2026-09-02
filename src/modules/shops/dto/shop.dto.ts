import {
  IsString,
  IsOptional,
  IsEmail,
  IsNumber,
  MaxLength,
  IsUrl,
  Matches,
  Min,
  Max,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CreateShopDto {
  @ApiProperty({ example: 'ABC Electronics' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsUrl()
  logoUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsUrl()
  coverImageUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiProperty({ example: 'Shop 12, SG Highway, Ahmedabad' })
  @IsString()
  address: string;

  @ApiProperty({ example: 23.0225 })
  @IsNumber()
  @Min(-90)
  @Max(90)
  @Type(() => Number)
  latitude: number;

  @ApiProperty({ example: 72.5714 })
  @IsNumber()
  @Min(-180)
  @Max(180)
  @Type(() => Number)
  longitude: number;

  @ApiPropertyOptional({ example: 'Ahmedabad' })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ example: 'Gujarat' })
  @IsOptional()
  @IsString()
  state?: string;

  @ApiPropertyOptional({ example: '380054' })
  @IsOptional()
  @IsString()
  pincode?: string;

  @ApiPropertyOptional({ example: '9876543210' })
  @IsOptional()
  @IsString()
  @Matches(/^[6-9]\d{9}$/, { message: 'Must be a valid 10-digit Indian mobile number' })
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  whatsapp?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: '24AAAAA0000A1Z5' })
  @IsOptional()
  @IsString()
  gstNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  businessHours?: Record<
    string,
    { open: string; close: string; closed: boolean }
  >;
}

export class UpdateShopDto extends PartialType(CreateShopDto) {}

export class NearbyQueryDto {
  @ApiProperty() @IsNumber() @Type(() => Number) lat: number;
  @ApiProperty() @IsNumber() @Type(() => Number) lng: number;
  @ApiPropertyOptional({ default: 5 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  radiusKm?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() categoryId?: string;
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  page?: number;
  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  limit?: number;
}

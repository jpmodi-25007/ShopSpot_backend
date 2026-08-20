import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsString, IsOptional, IsUUID, Min, Max, IsArray, ValidateIf } from 'class-validator';

export class CreateReviewDto {
  @ApiPropertyOptional({ description: 'ID of the shop being reviewed' })
  @ValidateIf(o => !o.productId)
  @IsUUID()
  shopId?: string;

  @ApiPropertyOptional({ description: 'ID of the product being reviewed' })
  @ValidateIf(o => !o.shopId)
  @IsUUID()
  productId?: string;

  @ApiPropertyOptional({ description: 'Associated Order ID' })
  @IsOptional()
  @IsUUID()
  orderId?: string;

  @ApiProperty({ description: 'Rating from 1 to 5', minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @ApiPropertyOptional({ description: 'Text comment' })
  @IsOptional()
  @IsString()
  comment?: string;

  @ApiPropertyOptional({ description: 'Array of media URLs uploaded' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mediaUrls?: string[];
}

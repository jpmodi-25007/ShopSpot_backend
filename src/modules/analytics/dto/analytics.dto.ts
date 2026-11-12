import { IsString, IsOptional, IsObject, IsIn } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class TrackEventDto {
  @ApiProperty()
  @IsString()
  eventType: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  shopId?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  productId?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  sessionId?: string;

  @ApiPropertyOptional()
  @IsObject()
  @IsOptional()
  metadata?: any;
}

export class AdminAnalyticsQueryDto {
  /** today | week | month | all — controls every time-bound series on the admin analytics page. */
  @ApiPropertyOptional({
    enum: ['today', 'week', 'month', 'all'],
    default: 'month',
  })
  @IsOptional()
  @IsString()
  @IsIn(['today', 'week', 'month', 'all'])
  period?: string;
}

import { IsString, IsOptional, IsArray, IsUrl, IsNumber, Min, IsDateString, IsEnum, IsDecimal, MinLength, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BudgetType } from '@prisma/client';

export class UpdateInfluencerProfileDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  displayName?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  username?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  bio?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  profileImage?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  city?: string;

  @ApiPropertyOptional()
  @IsArray()
  @IsOptional()
  languages?: string[];

  @ApiPropertyOptional()
  @IsArray()
  @IsOptional()
  categories?: string[];

  @ApiPropertyOptional()
  @IsUrl()
  @IsOptional()
  instagramUrl?: string;

  @ApiPropertyOptional()
  @IsUrl()
  @IsOptional()
  facebookUrl?: string;

  @ApiPropertyOptional()
  @IsUrl()
  @IsOptional()
  youtubeUrl?: string;

  @ApiPropertyOptional()
  @IsNumber()
  @IsOptional()
  followers?: number;
}

export class CreateCampaignDto {
  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(150)
  title: string;

  @ApiProperty()
  @IsString()
  @MaxLength(1000)
  description: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  productId?: string;

  @ApiProperty()
  @IsArray()
  platforms: string[];

  @ApiProperty()
  @IsArray()
  contentTypes: string[];

  @ApiPropertyOptional()
  @IsNumber()
  @Min(1)
  @IsOptional()
  creatorCount?: number;

  @ApiProperty({ enum: BudgetType })
  @IsEnum(BudgetType)
  budgetType: BudgetType;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  budgetMin: number;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  budgetMax: number;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  city?: string;

  @ApiPropertyOptional()
  @IsArray()
  @IsOptional()
  targetCategories?: string[];

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  applicationDeadline?: string;
}

export class SubmitBidDto {
  @ApiProperty()
  @IsNumber()
  @Min(1)
  proposedAmount: number;

  @ApiProperty()
  @IsDateString()
  availableDate: string;

  @ApiProperty()
  @IsDateString()
  deliveryDate: string;

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(1000)
  @IsOptional()
  proposal?: string;
}

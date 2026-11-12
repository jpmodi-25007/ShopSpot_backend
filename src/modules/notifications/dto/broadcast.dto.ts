import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class BroadcastNotificationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  title: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  body: string;

  @IsOptional()
  @IsIn(['ALL', 'CUSTOMER', 'SHOPKEEPER', 'INFLUENCER'])
  targetRole?: 'ALL' | 'CUSTOMER' | 'SHOPKEEPER' | 'INFLUENCER';
}

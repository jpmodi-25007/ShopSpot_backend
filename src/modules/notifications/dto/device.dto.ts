import { IsString, IsNotEmpty, IsIn, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RegisterDeviceDto {
  @ApiProperty({ example: 'fcm_token_xyz...' })
  @IsString()
  @IsNotEmpty()
  token: string;

  @ApiProperty({ example: 'android', enum: ['android', 'ios', 'web'] })
  @IsString()
  @IsNotEmpty()
  @IsIn(['android', 'ios', 'web'])
  platform: string;

  @ApiPropertyOptional({ example: '1.0.0' })
  @IsOptional()
  @IsString()
  appVersion?: string;

  @ApiPropertyOptional({ example: 'Chrome' })
  @IsOptional()
  @IsString()
  browser?: string;
}

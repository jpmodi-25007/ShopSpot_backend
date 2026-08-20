import {
  IsEmail,
  IsString,
  MinLength,
  IsOptional,
  IsMobilePhone,
  MaxLength,
  IsEnum,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

export class RegisterEmailDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail({}, { message: 'Please provide a valid email address' })
  email: string;

  @ApiProperty({ example: 'SecurePass@123', minLength: 8 })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @MaxLength(72, { message: 'Password must be at most 72 characters' })
  password: string;

  @ApiPropertyOptional({ example: 'Raj Patel' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiProperty({ example: 'CUSTOMER', enum: UserRole })
  @IsEnum(UserRole)
  role: UserRole;
}

export class RegisterMobileDto {
  @ApiProperty({ example: '+919876543210' })
  @IsMobilePhone(
    'en-IN',
    {},
    { message: 'Please provide a valid Indian mobile number' },
  )
  mobile: string;

  @ApiProperty({ example: 'SecurePass@123', minLength: 8 })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @MaxLength(72)
  password: string;

  @ApiPropertyOptional({ example: 'Raj Patel' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiProperty({ example: 'CUSTOMER', enum: UserRole })
  @IsEnum(UserRole)
  role: UserRole;
}

export class LoginEmailDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'SecurePass@123' })
  @IsString()
  @MinLength(1)
  password: string;

  @ApiProperty({ example: 'CUSTOMER', enum: UserRole })
  @IsEnum(UserRole)
  role: UserRole;
}

export class LoginMobileDto {
  @ApiProperty({ example: '+919876543210' })
  @IsMobilePhone('en-IN')
  mobile: string;

  @ApiProperty({ example: 'SecurePass@123' })
  @IsString()
  @MinLength(1)
  password: string;

  @ApiProperty({ example: 'CUSTOMER', enum: UserRole })
  @IsEnum(UserRole)
  role: UserRole;
}

export class RefreshTokenDto {
  @ApiProperty()
  @IsString()
  refreshToken: string;
}

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'Raj Patel' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ example: 'en' })
  @IsOptional()
  @IsString()
  languagePreference?: string;
}

export class ForgotPasswordDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsString()
  emailOrPhone: string;
}

import {
  IsEmail,
  IsString,
  MinLength,
  IsOptional,
  IsMobilePhone,
  MaxLength,
  IsEnum,
  IsIn,
  Matches,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

/**
 * Roles that may be self-assigned at sign-up. ADMIN accounts can never be
 * created through the public registration endpoints.
 */
export const SELF_REGISTERABLE_ROLES: UserRole[] = [
  UserRole.CUSTOMER,
  UserRole.SHOPKEEPER,
  UserRole.INFLUENCER,
];

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

  @ApiProperty({ example: 'CUSTOMER', enum: SELF_REGISTERABLE_ROLES })
  @IsIn(SELF_REGISTERABLE_ROLES, {
    message: 'role must be one of: CUSTOMER, SHOPKEEPER, INFLUENCER',
  })
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

  @ApiProperty({ example: 'CUSTOMER', enum: SELF_REGISTERABLE_ROLES })
  @IsIn(SELF_REGISTERABLE_ROLES, {
    message: 'role must be one of: CUSTOMER, SHOPKEEPER, INFLUENCER',
  })
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

export class ChangePasswordDto {
  @ApiProperty({ example: 'OldSecurePass@123' })
  @IsString()
  @MinLength(8)
  oldPassword: string;

  @ApiProperty({ example: 'NewSecurePass@123' })
  @IsString()
  @MinLength(8)
  newPassword: string;
}

export class ResetPasswordDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsString()
  emailOrPhone: string;

  @ApiProperty({ example: '123456' })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'code must be a 6-digit number' })
  code: string;

  @ApiProperty({ example: 'NewSecurePass@123', minLength: 8 })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @MaxLength(72, { message: 'Password must be at most 72 characters' })
  newPassword: string;
}

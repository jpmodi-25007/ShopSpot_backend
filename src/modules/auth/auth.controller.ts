import {
  Controller,
  Post,
  Get,
  Put,
  Body,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
  Param,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import {
  RegisterEmailDto,
  RegisterMobileDto,
  LoginEmailDto,
  LoginMobileDto,
  RefreshTokenDto,
  UpdateProfileDto,
  ForgotPasswordDto,
} from './dto/auth.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Request } from 'express';

@ApiTags('Auth')
@UseGuards(ThrottlerGuard)
@Controller()
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // ─── REGISTRATION ─────────────────────────────────────────────────────────

  @Public()
  @Post('auth/register')
  @ApiOperation({ summary: 'Register with email and password' })
  @ApiResponse({ status: 201, description: 'Registration successful' })
  @ApiResponse({ status: 409, description: 'Email already registered' })
  registerEmail(@Body() dto: RegisterEmailDto) {
    return this.authService.registerWithEmail(dto);
  }

  @Public()
  @Post('auth/register/mobile')
  @ApiOperation({ summary: 'Register with mobile number and password' })
  @ApiResponse({ status: 201, description: 'Registration successful' })
  @ApiResponse({ status: 409, description: 'Mobile already registered' })
  registerMobile(@Body() dto: RegisterMobileDto) {
    return this.authService.registerWithMobile(dto);
  }

  // ─── LOGIN ─────────────────────────────────────────────────────────────────

  @Public()
  @Post('auth/login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with email and password' })
  loginEmail(@Body() dto: LoginEmailDto) {
    return this.authService.loginWithEmail(dto);
  }

  @Public()
  @Post('auth/login/mobile')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with mobile number and password' })
  loginMobile(@Body() dto: LoginMobileDto) {
    return this.authService.loginWithMobile(dto);
  }

  // ─── FORGOT PASSWORD ──────────────────────────────────────────────────────

  @Public()
  @Post('auth/forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request password reset' })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  // ─── TOKENS ───────────────────────────────────────────────────────────────

  @Public()
  @Post('auth/refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate refresh token pair' })
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refreshTokens(dto.refreshToken);
  }

  @UseGuards(JwtAuthGuard)
  @Post('auth/logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Revoke refresh token and logout' })
  logout(@CurrentUser('id') userId: string, @Body() dto: RefreshTokenDto) {
    return this.authService.logout(userId, dto.refreshToken);
  }

  // ─── PROFILE ──────────────────────────────────────────────────────────────

  @UseGuards(JwtAuthGuard)
  @Get('auth/me')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Get current user profile' })
  getMe(@CurrentUser('id') userId: string) {
    return this.authService.getMe(userId);
  }

  @UseGuards(JwtAuthGuard)
  @Put('auth/me')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Update user profile' })
  updateMe(@CurrentUser('id') userId: string, @Body() dto: UpdateProfileDto) {
    return this.authService.updateMe(userId, dto);
  }

  // ─── DEVICE ───────────────────────────────────────────────────────────────

  @UseGuards(JwtAuthGuard)
  @Post('me/devices')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Register FCM device token for push notifications' })
  registerDevice(
    @CurrentUser('id') userId: string,
    @Body() body: { fcmToken: string; platform: string },
  ) {
    return this.authService.registerDevice(
      userId,
      body.fcmToken,
      body.platform,
    );
  }

  // ─── ROLE UPGRADE ─────────────────────────────────────────────────────────

  @UseGuards(JwtAuthGuard)
  @Post('auth/role')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Request role upgrade (e.g., INFLUENCER, SHOPKEEPER)',
  })
  requestRole(
    @CurrentUser('id') userId: string,
    @Body() body: { role: string },
  ) {
    return this.authService.requestRoleUpgrade(userId, body.role);
  }

  // ─── HEALTH ───────────────────────────────────────────────────────────────

  @Public()
  @Get('health')
  @ApiOperation({ summary: 'API health check' })
  health() {
    return { status: 'ok', version: 'v1', timestamp: new Date().toISOString() };
  }

  // ─── LEGAL ────────────────────────────────────────────────────────────────

  @Public()
  @Get('auth/legal/:role')
  @ApiOperation({ summary: 'Get legal documents for a specific role' })
  getLegalDocs(@Param('role') role: string) {
    try {
      const fs = require('fs');
      const path = require('path');
      const settingsPath = path.join(process.cwd(), 'data', 'settings.json');
      if (fs.existsSync(settingsPath)) {
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        const legal = settings.legal || {};
        const roleData = legal[role.toLowerCase()] || {};
        return {
          terms: roleData.terms || `# Terms of Service\n\nWelcome to Findivo. By using our services as a ${role}, you agree to our terms. *(Admin placeholder)*`,
          privacy: roleData.privacy || `# Privacy Policy\n\nWe value your privacy as a ${role}. *(Admin placeholder)*`,
        };
      }
    } catch (e) {
      console.error('Failed to read settings', e);
    }
    return {
      terms: `# Terms of Service\n\nWelcome to Findivo. By using our services as a ${role}, you agree to our terms. *(Admin placeholder)*`,
      privacy: `# Privacy Policy\n\nWe value your privacy as a ${role}. *(Admin placeholder)*`,
    };
  }
}

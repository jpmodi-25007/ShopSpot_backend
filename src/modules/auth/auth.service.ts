import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { User } from '@prisma/client';
import * as argon2 from 'argon2';
import { v4 as uuidv4 } from 'uuid';
import * as nodemailer from 'nodemailer';
import {
  RegisterEmailDto,
  RegisterMobileDto,
  LoginEmailDto,
  LoginMobileDto,
  UpdateProfileDto,
  ForgotPasswordDto,
  ChangePasswordDto,
} from './dto/auth.dto';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface AuthResponse {
  user: Partial<User>;
  tokens: AuthTokens;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  // ─── REGISTRATION ───────────────────────────────────────────────────────────

  async registerWithEmail(dto: RegisterEmailDto): Promise<AuthResponse> {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase().trim() },
    });
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const hashed = await argon2.hash(dto.password);
    const user = await this.prisma.user.create({
      data: {
        email: dto.email.toLowerCase().trim(),
        password: hashed,
        name: dto.name?.trim(),
        role: dto.role,
        isEmailVerified: false,
      },
    });
    const tokens = await this.generateTokens(user);

    if (user.role === 'SHOPKEEPER') {
      await this.prisma.shop.create({
        data: {
          ownerId: user.id,
          name: `${user.name || 'Retailer'}'s Shop`,
          slug: `shop-${user.id.substring(0, 8)}-${Date.now()}`,
          address: 'Please update your shop address',
          latitude: 0,
          longitude: 0,
          status: 'ACTIVE',
        },
      });
    } else if (user.role === 'INFLUENCER') {
      await this.prisma.influencerProfile.create({
        data: {
          userId: user.id,
          displayName: user.name || 'New Influencer',
          username: `user_${user.id.substring(0, 8)}_${Date.now()}`,
          verificationStatus: 'PENDING',
        },
      });
    }

    return { user: this.sanitizeUser(user), tokens };
  }

  async registerWithMobile(dto: RegisterMobileDto): Promise<AuthResponse> {
    const mobile = this.normalizeMobile(dto.mobile);
    const existing = await this.prisma.user.findUnique({ where: { mobile } });
    if (existing) {
      throw new ConflictException(
        'An account with this mobile number already exists',
      );
    }

    const hashed = await argon2.hash(dto.password);
    const user = await this.prisma.user.create({
      data: { mobile, password: hashed, name: dto.name?.trim(), role: dto.role },
    });

    const tokens = await this.generateTokens(user);

    if (user.role === 'SHOPKEEPER') {
      await this.prisma.shop.create({
        data: {
          ownerId: user.id,
          name: `${user.name || 'Retailer'}'s Shop`,
          slug: `shop-${user.id.substring(0, 8)}-${Date.now()}`,
          address: 'Please update your shop address',
          latitude: 0,
          longitude: 0,
          status: 'ACTIVE',
        },
      });
    } else if (user.role === 'INFLUENCER') {
      await this.prisma.influencerProfile.create({
        data: {
          userId: user.id,
          displayName: user.name || 'New Influencer',
          username: `user_${user.id.substring(0, 8)}_${Date.now()}`,
          verificationStatus: 'PENDING',
        },
      });
    }

    return { user: this.sanitizeUser(user), tokens };
  }

  // ─── LOGIN ──────────────────────────────────────────────────────────────────

  async loginWithEmail(dto: LoginEmailDto): Promise<AuthResponse> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase().trim() },
    });
    if (!user) throw new UnauthorizedException('Invalid email or password');
    if (user.role !== dto.role)
      throw new UnauthorizedException('Invalid role for this account');
    if (!user.isActive)
      throw new UnauthorizedException('Account has been deactivated');

    const valid = await argon2.verify(user.password, dto.password);
    if (!valid) throw new UnauthorizedException('Invalid email or password');

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
    const tokens = await this.generateTokens(user);
    return { user: this.sanitizeUser(user), tokens };
  }

  async loginWithMobile(dto: LoginMobileDto): Promise<AuthResponse> {
    const mobile = this.normalizeMobile(dto.mobile);
    const user = await this.prisma.user.findUnique({ where: { mobile } });
    if (!user) throw new UnauthorizedException('Invalid mobile or password');
    if (user.role !== dto.role)
      throw new UnauthorizedException('Invalid role for this account');
    if (!user.isActive)
      throw new UnauthorizedException('Account has been deactivated');

    const valid = await argon2.verify(user.password, dto.password);
    if (!valid) throw new UnauthorizedException('Invalid mobile or password');

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
    const tokens = await this.generateTokens(user);
    return { user: this.sanitizeUser(user), tokens };
  }

  // ─── FORGOT PASSWORD ──────────────────────────────────────────────────────

  async forgotPassword(dto: ForgotPasswordDto): Promise<{ message: string }> {
    const isEmail = dto.emailOrPhone.includes('@');
    let user;

    if (isEmail) {
      user = await this.prisma.user.findUnique({
        where: { email: dto.emailOrPhone.toLowerCase().trim() },
      });
    } else {
      const mobile = this.normalizeMobile(dto.emailOrPhone);
      user = await this.prisma.user.findUnique({ where: { mobile } });
    }

    // We do not throw an error if the user is not found to prevent user enumeration
    if (user && isEmail) {
      try {
        const transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST || 'smtp.gmail.com',
          port: parseInt(process.env.SMTP_PORT || '465', 10),
          secure: true, // true for 465, false for other ports
          auth: {
            user: process.env.SMTP_EMAIL,
            pass: process.env.SMTP_PASSWORD,
          },
        });

        // Generate a random 6-digit code for reset
        const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
        // In a real app, save resetCode to DB with expiration!

        await transporter.sendMail({
          from: `"Findivo Support" <${process.env.SMTP_EMAIL}>`,
          to: dto.emailOrPhone,
          subject: 'Password Reset Request',
          text: `Your password reset code is: ${resetCode}\nIf you did not request this, please ignore this email.`,
          html: `<p>Your password reset code is: <b>${resetCode}</b></p><p>If you did not request this, please ignore this email.</p>`,
        });

        console.log(`Reset email sent successfully to ${dto.emailOrPhone}`);
      } catch (error) {
        console.error('Error sending reset email:', error);
      }
    } else if (user && !isEmail) {
      console.log(`Sending password reset SMS to ${dto.emailOrPhone}`);
    }

    return { message: 'Instructions sent successfully!' };
  }

  // ─── TOKENS ─────────────────────────────────────────────────────────────────

  async refreshTokens(rawToken: string): Promise<AuthTokens> {
    let payload: { sub: string };
    try {
      payload = this.jwtService.verify(rawToken, {
        secret: this.config.get('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const stored = await this.prisma.refreshToken.findUnique({
      where: { token: rawToken },
      include: { user: true },
    });

    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      // Detect potential reuse attack → revoke all tokens
      if (stored) {
        await this.prisma.refreshToken.updateMany({
          where: { userId: payload.sub },
          data: { revokedAt: new Date() },
        });
      }
      throw new UnauthorizedException('Refresh token has been revoked');
    }

    // Rotate: revoke old, issue new pair
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    return this.generateTokens(stored.user);
  }

  async logout(userId: string, refreshToken: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, token: refreshToken },
      data: { revokedAt: new Date() },
    });
  }

  // ─── PROFILE ────────────────────────────────────────────────────────────────

  async getMe(userId: string): Promise<Partial<User>> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    return this.sanitizeUser(user);
  }

  async updateMe(
    userId: string,
    dto: UpdateProfileDto,
  ): Promise<Partial<User>> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        name: dto.name?.trim(),
        languagePreference: dto.languagePreference,
      },
    });
    return this.sanitizeUser(user);
  }

  async updateAvatar(
    userId: string,
    avatarUrl: string,
  ): Promise<Partial<User>> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { avatarUrl },
    });
    return this.sanitizeUser(user);
  }

  async registerDevice(
    userId: string,
    fcmToken: string,
    platform: string,
  ): Promise<void> {
    await this.prisma.userDevice.upsert({
      where: { fcmToken },
      create: { userId, fcmToken, platform },
      update: { userId, platform },
    });
  }

  async requestRoleUpgrade(userId: string, role: string): Promise<void> {
    const allowed = ['INFLUENCER', 'SHOPKEEPER'];
    if (!allowed.includes(role.toUpperCase())) {
      throw new BadRequestException('Invalid role');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { role: role.toUpperCase() as any },
    });
  }

  // ─── HELPERS ────────────────────────────────────────────────────────────────

  async validateUserById(id: string): Promise<User | null> {
    return this.prisma.user.findFirst({ where: { id, isActive: true } });
  }

  private async generateTokens(user: User): Promise<AuthTokens> {
    const payload = {
      sub: user.id,
      email: user.email,
      mobile: user.mobile,
      role: user.role,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.config.get('JWT_ACCESS_SECRET'),
        expiresIn: this.config.get('JWT_ACCESS_EXPIRES_IN', '15m'),
      }),
      this.jwtService.signAsync(
        { ...payload, jti: uuidv4() },
        {
          secret: this.config.get('JWT_REFRESH_SECRET'),
          expiresIn: this.config.get('JWT_REFRESH_EXPIRES_IN', '7d'),
        },
      ),
    ]);

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);
    await this.prisma.refreshToken.create({
      data: { token: refreshToken, userId: user.id, expiresAt },
    });

    return { accessToken, refreshToken, expiresIn: 900 };
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const valid = await argon2.verify(user.password, dto.oldPassword);
    if (!valid) throw new UnauthorizedException('Invalid old password');

    const hashed = await argon2.hash(dto.newPassword);
    await this.prisma.user.update({
      where: { id: userId },
      data: { password: hashed },
    });

    return { message: 'Password changed successfully' };
  }

  private sanitizeUser(user: User): Partial<User> {
    const { password, ...sanitized } = user;
    return sanitized;
  }

  private normalizeMobile(mobile: string): string {
    const clean = mobile.replace(/\s+/g, '');
    return clean.startsWith('+') ? clean : `+91${clean}`;
  }
}

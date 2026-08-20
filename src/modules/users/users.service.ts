import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getUserById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        avatarUrl: true,
        role: true,
        createdAt: true,
        influencerProfile: {
          select: {
            displayName: true,
            username: true,
            bio: true,
            followers: true,
            rating: true,
            verificationStatus: true,
          }
        },
        shop: {
          select: {
            name: true,
            slug: true,
            logoUrl: true,
            rating: true,
            isKycVerified: true,
          }
        }
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }
}

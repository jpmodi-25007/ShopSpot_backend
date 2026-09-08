import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ChatsService {
  constructor(private prisma: PrismaService) {}

  async createOrGetRoom(userId: string, targetUserId: string, contextType?: string, contextId?: string) {
    let room = await this.prisma.chatRoom.findFirst({
      where: {
        OR: [
          { participantA: userId, participantB: targetUserId },
          { participantA: targetUserId, participantB: userId },
        ],
        contextType: contextType || null,
        contextId: contextId || null,
      },
      include: {
        userA: { select: { id: true, name: true, avatarUrl: true, role: true } },
        userB: { select: { id: true, name: true, avatarUrl: true, role: true } },
      }
    });

    if (!room) {
      room = await this.prisma.chatRoom.create({
        data: {
          participantA: userId,
          participantB: targetUserId,
          contextType,
          contextId,
        },
        include: {
          userA: { select: { id: true, name: true, avatarUrl: true, role: true } },
          userB: { select: { id: true, name: true, avatarUrl: true, role: true } },
        }
      });
    }
    return room;
  }

  async getMyRooms(userId: string) {
    return this.prisma.chatRoom.findMany({
      where: {
        OR: [
          { participantA: userId },
          { participantB: userId },
        ]
      },
      include: {
        userA: { select: { id: true, name: true, avatarUrl: true, role: true } },
        userB: { select: { id: true, name: true, avatarUrl: true, role: true } },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        }
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async sendMessage(userId: string, roomId: string, content: string) {
    const room = await this.prisma.chatRoom.findUnique({ where: { id: roomId } });
    if (!room) throw new NotFoundException('Chat room not found');
    if (room.participantA !== userId && room.participantB !== userId) {
      throw new ForbiddenException('Not a participant of this chat room');
    }

    const message = await this.prisma.chatMessage.create({
      data: {
        roomId,
        senderId: userId,
        content,
      },
    });

    await this.prisma.chatRoom.update({
      where: { id: roomId },
      data: { updatedAt: new Date() },
    });

    return message;
  }

  async getMessages(userId: string, roomId: string) {
    const room = await this.prisma.chatRoom.findUnique({ where: { id: roomId } });
    if (!room) throw new NotFoundException('Chat room not found');
    if (room.participantA !== userId && room.participantB !== userId) {
      throw new ForbiddenException('Not a participant of this chat room');
    }

    await this.prisma.chatMessage.updateMany({
      where: {
        roomId,
        senderId: { not: userId },
        isRead: false,
      },
      data: { isRead: true },
    });

    return this.prisma.chatMessage.findMany({
      where: { roomId },
      orderBy: { createdAt: 'asc' },
    });
  }
}

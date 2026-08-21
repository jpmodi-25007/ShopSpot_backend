import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { FirebaseMessagingProvider } from './firebase-messaging.provider';
import { NotificationType } from '@prisma/client';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly firebaseProvider: FirebaseMessagingProvider,
  ) {}

  async getMyNotifications(userId: string, page = 1, limit = 20) {
    const [data, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: +limit,
      }),
      this.prisma.notification.count({ where: { userId } }),
    ]);
    return { data, page, limit, total };
  }

  async getUnreadCount(userId: string) {
    const count = await this.prisma.notification.count({
      where: { userId, isRead: false },
    });
    return { unreadCount: count };
  }

  async markAsRead(id: string, userId: string) {
    return this.prisma.notification.updateMany({
      where: { id, userId },
      data: { isRead: true },
    });
  }

  async markAllAsRead(userId: string) {
    return this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
  }

  async registerDevice(userId: string, dto: any) {
    return this.prisma.userDevice.upsert({
      where: { fcmToken: dto.token },
      update: {
        userId,
        platform: dto.platform,
        updatedAt: new Date(),
      },
      create: {
        userId,
        fcmToken: dto.token,
        platform: dto.platform,
      },
    });
  }

  async sendNotification(
    userId: string,
    type: NotificationType,
    title: string,
    body: string,
    data?: any,
  ) {
    // 1. Save notification to DB
    const notification = await this.prisma.notification.create({
      data: {
        userId,
        type,
        title,
        body,
        data: data || {},
      },
    });

    // 2. Fetch user devices
    const devices = await this.prisma.userDevice.findMany({
      where: { userId },
    });

    if (devices.length === 0) {
      this.logger.debug(`No devices found for user ${userId}. Notification saved to DB only.`);
      return notification;
    }

    // 3. Send FCM push
    const tokens = devices.map(d => d.fcmToken);
    const stringifiedData = data ? this.stringifyData(data) : {};
    
    // Pass notification ID to the mobile app for deep linking / read status
    stringifiedData['notificationId'] = notification.id;
    stringifiedData['type'] = type;

    if (tokens.length === 1) {
      await this.firebaseProvider.sendToDevice(tokens[0], title, body, stringifiedData);
    } else {
      await this.firebaseProvider.sendToMultipleDevices(tokens, title, body, stringifiedData);
    }

    return notification;
  }

  private stringifyData(data: any): Record<string, string> {
    const result: Record<string, string> = {};
    for (const key in data) {
      if (typeof data[key] === 'object') {
        result[key] = JSON.stringify(data[key]);
      } else {
        result[key] = String(data[key]);
      }
    }
    return result;
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { FirebaseMessagingProvider } from './firebase-messaging.provider';
import { NotificationType, UserRole } from '@prisma/client';

/** Upper bound for list endpoints so one request cannot pull a whole table. */
const MAX_PAGE_SIZE = 100;
const BROADCAST_DB_BATCH = 1000;
const FCM_MULTICAST_LIMIT = 500;

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
        take: Math.min(Math.max(+limit || 20, 1), MAX_PAGE_SIZE),
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

  /**
   * Persists and pushes a notification. Many callers invoke this without
   * awaiting it, so it must never reject: a failure here is logged and
   * swallowed instead of becoming an unhandled rejection that could take the
   * process down or fail the business operation that triggered it.
   */
  async sendNotification(
    userId: string,
    type: NotificationType,
    title: string,
    body: string,
    data?: any,
  ) {
    try {
      return await this.deliverNotification(userId, type, title, body, data);
    } catch (error) {
      this.logger.error(
        `Failed to send ${type} notification to user ${userId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  private async deliverNotification(
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
      this.logger.debug(
        `No devices found for user ${userId}. Notification saved to DB only.`,
      );
      return notification;
    }

    // 3. Send FCM push
    const tokens = devices.map((d) => d.fcmToken);
    const stringifiedData = data ? this.stringifyData(data) : {};

    // Pass notification ID to the mobile app for deep linking / read status
    stringifiedData['notificationId'] = notification.id;
    stringifiedData['type'] = type;

    if (tokens.length === 1) {
      await this.firebaseProvider.sendToDevice(
        tokens[0],
        title,
        body,
        stringifiedData,
      );
    } else {
      await this.firebaseProvider.sendToMultipleDevices(
        tokens,
        title,
        body,
        stringifiedData,
      );
    }

    return notification;
  }

  /**
   * Admin broadcast: stores a SYSTEM notification for every active user in the
   * target role and pushes it to their registered devices in batches.
   */
  async broadcast(
    title: string,
    body: string,
    targetRole: 'ALL' | UserRole = 'ALL',
  ) {
    const users = await this.prisma.user.findMany({
      where: {
        isActive: true,
        ...(targetRole === 'ALL' ? {} : { role: targetRole }),
      },
      select: { id: true },
    });
    const userIds = users.map((u) => u.id);

    for (let i = 0; i < userIds.length; i += BROADCAST_DB_BATCH) {
      await this.prisma.notification.createMany({
        data: userIds.slice(i, i + BROADCAST_DB_BATCH).map((userId) => ({
          userId,
          type: NotificationType.SYSTEM,
          title,
          body,
          data: {},
        })),
      });
    }

    // Push is best-effort: failures are logged by the provider.
    for (let i = 0; i < userIds.length; i += BROADCAST_DB_BATCH) {
      const devices = await this.prisma.userDevice.findMany({
        where: { userId: { in: userIds.slice(i, i + BROADCAST_DB_BATCH) } },
        select: { fcmToken: true },
      });
      const tokens = devices.map((d) => d.fcmToken);
      for (let j = 0; j < tokens.length; j += FCM_MULTICAST_LIMIT) {
        await this.firebaseProvider.sendToMultipleDevices(
          tokens.slice(j, j + FCM_MULTICAST_LIMIT),
          title,
          body,
          { type: NotificationType.SYSTEM },
        );
      }
    }

    return { success: true, recipients: userIds.length };
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

import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { FirebaseMessagingProvider } from './firebase-messaging.provider';

@Module({
  imports: [PrismaModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, FirebaseMessagingProvider],
  exports: [NotificationsService],
})
export class NotificationsModule {}

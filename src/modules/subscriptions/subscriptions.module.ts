import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { SubscriptionsController } from './controllers/subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}

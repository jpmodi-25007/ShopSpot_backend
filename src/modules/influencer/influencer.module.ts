import { Module } from '@nestjs/common';
import { InfluencerController } from './controllers/influencer.controller';
import { ShopkeeperCampaignController } from './controllers/shopkeeper-campaign.controller';
import { InfluencerService } from './influencer.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [
    InfluencerController,
    ShopkeeperCampaignController,
  ],
  providers: [InfluencerService],
  exports: [InfluencerService],
})
export class InfluencerModule {}

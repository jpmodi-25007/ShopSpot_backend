import { Module } from '@nestjs/common';
import { InfluencerController } from './controllers/influencer.controller';
import { ShopkeeperCampaignController } from './controllers/shopkeeper-campaign.controller';
import { InfluencerService } from './influencer.service';

@Module({
  controllers: [InfluencerController, ShopkeeperCampaignController],
  providers: [InfluencerService],
  exports: [InfluencerService],
})
export class InfluencerModule {}

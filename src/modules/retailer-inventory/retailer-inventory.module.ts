import { Module } from '@nestjs/common';
import { RetailerInventoryController } from './retailer-inventory.controller';
import { RetailerInventoryService } from './retailer-inventory.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [RetailerInventoryController],
  providers: [RetailerInventoryService],
  exports: [RetailerInventoryService],
})
export class RetailerInventoryModule {}

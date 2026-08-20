import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { UploadController } from './upload.controller';
import { UploadService } from './upload.service';
import { ImageProcessor } from './processors/image.processor';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'image-processing',
    }),
  ],
  controllers: [UploadController],
  providers: [UploadService, ImageProcessor],
  exports: [UploadService],
})
export class UploadModule {}

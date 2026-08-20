import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import * as path from 'path';

@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);

  constructor(
    @InjectQueue('image-processing') private readonly imageQueue: Queue,
  ) {}

  /**
   * Adds an image to the processing queue and returns the completed job result asynchronously
   * if we want to wait for it. By default, we await the job completion so the API
   * can return the final URL synchronously to the client.
   */
  async processImageSync(file: Express.Multer.File): Promise<any> {
    const destinationDir = path.join(process.cwd(), 'public', 'uploads');
    
    this.logger.debug(`Adding file ${file.originalname} to the image processing queue`);
    
    // Add job to the queue
    const job = await this.imageQueue.add({
      file,
      destinationDir,
    });

    // Wait for the job to complete to return the result synchronously.
    // In a high-scale environment, we might just return the jobId instead.
    try {
      const result = await job.finished();
      return result;
    } catch (error) {
      this.logger.error(`Job failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Adds multiple images to the queue and waits for all of them.
   */
  async processImagesSync(files: Express.Multer.File[]): Promise<any[]> {
    const promises = files.map((file) => this.processImageSync(file));
    return Promise.all(promises);
  }
}

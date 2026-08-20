import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import * as _sharp from 'sharp';
const sharp = _sharp as any;
import * as path from 'path';
import * as fs from 'fs';

interface ImageJobData {
  file: {
    originalname: string;
    filename: string;
    path: string;
    mimetype: string;
    size: number;
  };
  destinationDir: string;
}

@Processor('image-processing')
export class ImageProcessor {
  private readonly logger = new Logger(ImageProcessor.name);

  @Process()
  async handleImageProcessing(job: Job<ImageJobData>) {
    this.logger.debug(`Processing image job ${job.id}`);
    
    const { file, destinationDir } = job.data;
    
    // Ensure the destination directory exists
    if (!fs.existsSync(destinationDir)) {
      fs.mkdirSync(destinationDir, { recursive: true });
    }

    try {
      const filenameWithoutExt = path.parse(file.originalname).name;
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      const finalFilename = `${filenameWithoutExt}-${uniqueSuffix}.webp`;
      const finalPath = path.join(destinationDir, finalFilename);

      // Process image:
      // 1. Resize to max 1200px width/height, maintaining aspect ratio.
      // 2. Convert to WebP.
      // 3. Compress with 80% quality.
      await sharp(file.path)
        .resize(1200, 1200, {
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: 80 })
        .toFile(finalPath);

      this.logger.debug(`Successfully processed and saved image to ${finalPath}`);

      // Attempt to clean up the original raw file from temp directory
      try {
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      } catch (cleanupErr) {
        this.logger.warn(`Failed to clean up temp file ${file.path}: ${cleanupErr.message}`);
      }

      // Return the relative URL path assuming the destinationDir maps to a static route.
      // E.g., if destinationDir is 'public/uploads', we might return '/uploads/finalFilename'
      const relativePath = `/uploads/${finalFilename}`;

      return {
        url: relativePath,
        filename: finalFilename,
        size: fs.statSync(finalPath).size,
        mimetype: 'image/webp',
      };
    } catch (error) {
      this.logger.error(`Failed to process image job ${job.id}: ${error.message}`, error.stack);
      throw error;
    }
  }
}

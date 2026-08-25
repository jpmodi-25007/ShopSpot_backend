import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';

@Injectable()
export class CloudinaryService {
  private readonly logger = new Logger(CloudinaryService.name);

  constructor(private readonly configService: ConfigService) {
    cloudinary.config({
      cloud_name: this.configService.get('CLOUDINARY_CLOUD_NAME'),
      api_key: this.configService.get('CLOUDINARY_API_KEY'),
      api_secret: this.configService.get('CLOUDINARY_API_SECRET'),
      secure: true,
    });
  }

  /**
   * Generates a signed signature for secure direct client uploads to Cloudinary.
   */
  generateSignature(folderName: string): { signature: string; timestamp: number; apiKey: string; cloudName: string; folder: string } {
    const timestamp = Math.round(new Date().getTime() / 1000);
    const apiSecret = this.configService.get<string>('CLOUDINARY_API_SECRET');
    const apiKey = this.configService.get<string>('CLOUDINARY_API_KEY') || '';
    const cloudName = this.configService.get<string>('CLOUDINARY_CLOUD_NAME') || '';
    
    const rootFolder = this.configService.get<string>('CLOUDINARY_FOLDER') || 'shopspot';
    const finalFolder = `${rootFolder}/${folderName}`;

    if (!apiSecret) {
      this.logger.error('CLOUDINARY_API_SECRET is missing from environment variables');
      throw new InternalServerErrorException('Cloudinary configuration is incomplete');
    }

    const signature = cloudinary.utils.api_sign_request(
      {
        timestamp,
        folder: finalFolder,
      },
      apiSecret,
    );

    return { signature, timestamp, apiKey, cloudName, folder: finalFolder };
  }

  /**
   * Deletes an asset from Cloudinary using the Admin API.
   */
  async deleteAsset(publicId: string): Promise<boolean> {
    try {
      this.logger.debug(`Deleting Cloudinary asset: ${publicId}`);
      const result = await cloudinary.uploader.destroy(publicId);
      return result.result === 'ok' || result.result === 'not found';
    } catch (error) {
      this.logger.error(`Failed to delete Cloudinary asset ${publicId}:`, error);
      return false;
    }
  }
}

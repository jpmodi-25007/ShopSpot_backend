import { Controller, Post, Delete, Param, UseGuards, Body, UnauthorizedException, BadRequestException, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiProperty } from '@nestjs/swagger';
import { CloudinaryService } from './cloudinary.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';
import { IsString, IsNotEmpty } from 'class-validator';

class SignatureRequestDto {
  @ApiProperty({ description: 'The folder to upload the asset into (e.g. products/123/images)' })
  @IsString()
  @IsNotEmpty()
  folder: string;
}

@ApiTags('Cloudinary')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller('cloudinary')
export class CloudinaryController {
  constructor(private readonly cloudinaryService: CloudinaryService) {}

  @Post('signature')
  @ApiOperation({ summary: 'Generate secure signature for direct Cloudinary upload' })
  generateSignature(@Body() dto: SignatureRequestDto, @CurrentUser() user: any) {
    // Basic validation to prevent arbitrary uploads
    // Ensure shopkeepers can only upload to shop/product folders, etc.
    if (user.role === UserRole.CUSTOMER && !dto.folder.startsWith('users/')) {
       throw new UnauthorizedException('Customers can only upload to user folders');
    }
    
    const signatureData = this.cloudinaryService.generateSignature(dto.folder);
    return {
      message: 'Signature generated successfully',
      data: signatureData,
    };
  }

  // A generic media deletion endpoint could be here or in a separate Media module.
  // For now, this is restricted to ADMIN only, as normal deletion should happen 
  // through the specific entity endpoint (e.g. deleting a product deletes its images)
}

import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PromotionsService } from './promotions.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('promotions')
export class PromotionsController {
  constructor(private readonly promotionsService: PromotionsService) {}

  @Get()
  async getActivePromotions() {
    const banners = await this.promotionsService.getActivePromotions();
    return { success: true, data: banners };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Get('all')
  async getAllPromotions() {
    const banners = await this.promotionsService.getAllPromotions();
    return { success: true, data: banners };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Post()
  async createPromotion(@Body() data: any) {
    const banner = await this.promotionsService.createPromotion(data);
    return {
      success: true,
      data: banner,
      message: 'Promotion created successfully',
    };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Put(':id')
  async updatePromotion(@Param('id') id: string, @Body() data: any) {
    const banner = await this.promotionsService.updatePromotion(id, data);
    return {
      success: true,
      data: banner,
      message: 'Promotion updated successfully',
    };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Delete(':id')
  async deletePromotion(@Param('id') id: string) {
    await this.promotionsService.deletePromotion(id);
    return { success: true, message: 'Promotion deleted successfully' };
  }
}

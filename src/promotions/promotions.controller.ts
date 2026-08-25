import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
} from '@nestjs/common';
import { PromotionsService } from './promotions.service';

@Controller('promotions')
export class PromotionsController {
  constructor(private readonly promotionsService: PromotionsService) {}

  @Get()
  async getActivePromotions() {
    const banners = await this.promotionsService.getActivePromotions();
    return { success: true, data: banners };
  }

  @Get('all')
  async getAllPromotions() {
    const banners = await this.promotionsService.getAllPromotions();
    return { success: true, data: banners };
  }

  @Post()
  async createPromotion(@Body() data: any) {
    const banner = await this.promotionsService.createPromotion(data);
    return { success: true, data: banner, message: 'Promotion created successfully' };
  }

  @Put(':id')
  async updatePromotion(@Param('id') id: string, @Body() data: any) {
    const banner = await this.promotionsService.updatePromotion(id, data);
    return { success: true, data: banner, message: 'Promotion updated successfully' };
  }

  @Delete(':id')
  async deletePromotion(@Param('id') id: string) {
    await this.promotionsService.deletePromotion(id);
    return { success: true, message: 'Promotion deleted successfully' };
  }
}

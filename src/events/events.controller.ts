import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Req } from '@nestjs/common';
import { EventsService } from './events.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@Controller('events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SHOPKEEPER)
  async create(@Req() req: any, @Body() createEventDto: any) {
    const data = await this.eventsService.create(req.user.id, {
      ...createEventDto,
      startDate: new Date(createEventDto.startDate),
      endDate: new Date(createEventDto.endDate),
    });
    return {
      status: 'success',
      data,
    };
  }

  @Get('shop')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SHOPKEEPER)
  async findShopEvents(@Req() req: any) {
    const data = await this.eventsService.findShopEvents(req.user.id);
    return {
      status: 'success',
      data,
    };
  }

  @Get('all')
  async findAll() {
    const data = await this.eventsService.findAll();
    return {
      status: 'success',
      data,
    };
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const data = await this.eventsService.findOne(id);
    return {
      status: 'success',
      data,
    };
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SHOPKEEPER)
  async update(@Param('id') id: string, @Body() updateEventDto: any) {
    const payload = { ...updateEventDto };
    if (payload.startDate) payload.startDate = new Date(payload.startDate);
    if (payload.endDate) payload.endDate = new Date(payload.endDate);
    
    const data = await this.eventsService.update(id, payload);
    return {
      status: 'success',
      data,
    };
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SHOPKEEPER)
  async remove(@Param('id') id: string) {
    await this.eventsService.remove(id);
    return {
      status: 'success',
      message: 'Event deleted successfully',
    };
  }
}

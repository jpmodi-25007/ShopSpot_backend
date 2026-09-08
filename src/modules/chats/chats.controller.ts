import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { ChatsService } from './chats.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ThrottlerGuard } from '@nestjs/throttler';

@Controller('chats')
@UseGuards(JwtAuthGuard, ThrottlerGuard)
export class ChatsController {
  constructor(private readonly chatsService: ChatsService) {}

  @Post('rooms')
  async createOrGetRoom(
    @CurrentUser('id') userId: string,
    @Body() dto: { targetUserId: string; contextType?: string; contextId?: string },
  ) {
    return this.chatsService.createOrGetRoom(userId, dto.targetUserId, dto.contextType, dto.contextId);
  }

  @Get('rooms')
  async getMyRooms(@CurrentUser('id') userId: string) {
    return this.chatsService.getMyRooms(userId);
  }

  @Get('rooms/:roomId/messages')
  async getMessages(@CurrentUser('id') userId: string, @Param('roomId') roomId: string) {
    return this.chatsService.getMessages(userId, roomId);
  }

  @Post('rooms/:roomId/messages')
  async sendMessage(
    @CurrentUser('id') userId: string,
    @Param('roomId') roomId: string,
    @Body() dto: { content: string },
  ) {
    return this.chatsService.sendMessage(userId, roomId, dto.content);
  }
}

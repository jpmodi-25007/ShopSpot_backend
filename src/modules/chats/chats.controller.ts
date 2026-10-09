import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ChatsService } from './chats.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ThrottlerGuard } from '@nestjs/throttler';

class CreateRoomDto {
  @IsString()
  @IsNotEmpty()
  targetUserId: string;

  @IsString()
  @IsOptional()
  contextType?: string;

  @IsString()
  @IsOptional()
  contextId?: string;
}

class SendMessageDto {
  @IsString()
  @IsNotEmpty()
  // Cap at 4000 chars to prevent DoS via oversized payloads hitting the DB
  @MaxLength(4000)
  content: string;
}

@Controller('chats')
@UseGuards(JwtAuthGuard, ThrottlerGuard)
export class ChatsController {
  constructor(private readonly chatsService: ChatsService) {}

  @Post('rooms')
  async createOrGetRoom(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateRoomDto,
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
    @Body() dto: SendMessageDto,
  ) {
    return this.chatsService.sendMessage(userId, roomId, dto.content);
  }
}

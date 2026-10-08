import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AppGateway } from './gateways/websocket.gateway';
import { ChatsModule } from '../chats/chats.module';

@Module({
  imports: [JwtModule, ChatsModule],
  providers: [AppGateway],
  exports: [AppGateway],
})
export class WebsocketModule {}

import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AppGateway } from './gateways/websocket.gateway';

@Module({
  imports: [JwtModule],
  providers: [AppGateway],
  exports: [AppGateway],
})
export class WebsocketModule {}

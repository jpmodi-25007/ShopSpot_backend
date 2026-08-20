import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';

@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/ws',
})
export class AppGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(AppGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const authHeader = client.handshake.auth.token || client.handshake.headers.authorization;
      if (!authHeader) throw new Error('No token provided');

      const token = authHeader.replace('Bearer ', '');
      const secret = this.configService.get<string>('JWT_ACCESS_SECRET');
      const payload = this.jwtService.verify(token, { secret });

      client.data.userId = payload.sub;
      client.data.role = payload.role;

      // Join a personal room so we can send directed events
      await client.join(`user:${payload.sub}`);
      this.logger.debug(`Client connected: ${client.id} (User: ${payload.sub})`);
    } catch (error) {
      this.logger.warn(`Unauthorized connection attempt: ${client.id}`);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.debug(`Client disconnected: ${client.id}`);
  }

  /**
   * Helper method to emit events to a specific user
   */
  emitToUser(userId: string, event: string, data: any) {
    this.server.to(`user:${userId}`).emit(event, data);
  }

  // --- Sample Real-time Handlers for Negotiations ---

  @SubscribeMessage('negotiation:offer')
  handleOffer(@ConnectedSocket() client: Socket, @MessageBody() payload: any) {
    // Expected payload: { shopkeeperId, negotiationId, price }
    // Broadcast to the shopkeeper's room
    this.emitToUser(payload.shopkeeperId, 'negotiation:new_offer', {
      ...payload,
      customerId: client.data.userId,
    });
  }

  @SubscribeMessage('negotiation:counter')
  handleCounter(@ConnectedSocket() client: Socket, @MessageBody() payload: any) {
    // Expected payload: { customerId, negotiationId, price }
    // Broadcast to the customer's room
    this.emitToUser(payload.customerId, 'negotiation:counter_offer', {
      ...payload,
      shopkeeperId: client.data.userId,
    });
  }
}

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
import { ChatsService } from '../../chats/chats.service';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  isOriginAllowed,
  parseCorsOrigins,
} from '../../../common/helpers/cors.helper';

@WebSocketGateway({
  cors: {
    origin: (
      origin: string,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      // Allow requests with no origin (mobile apps, server-to-server)
      if (!origin) return callback(null, true);
      const allowedOrigins = parseCorsOrigins(process.env.CORS_ORIGINS);
      if (isOriginAllowed(origin, allowedOrigins)) {
        callback(null, true);
      } else {
        callback(new Error('WebSocket origin not allowed by CORS'));
      }
    },
    credentials: true,
  },
})
export class AppGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(AppGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly chatsService: ChatsService,
    private readonly prisma: PrismaService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const authHeader =
        client.handshake.auth.token ||
        client.handshake.headers.authorization ||
        client.handshake.query.token;
      if (!authHeader) throw new Error('No token provided');

      const token = String(authHeader).replace('Bearer ', '');
      const secret = this.configService.get<string>('JWT_ACCESS_SECRET');
      const payload = this.jwtService.verify(token, { secret });

      client.data.userId = payload.sub;
      client.data.role = payload.role;

      // Join a personal room so we can send directed events
      await client.join(`user:${payload.sub}`);
      this.logger.debug(
        `Client connected: ${client.id} (User: ${payload.sub})`,
      );
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
  async handleOffer(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: any,
  ) {
    // Expected payload: { negotiationId, price }
    // The recipient is derived from the negotiation itself, never from the
    // payload, so a client cannot push events to arbitrary users.
    const negotiation = await this.findNegotiation(payload?.negotiationId);
    if (!negotiation || negotiation.customerId !== client.data.userId) return;

    this.emitToUser(negotiation.shop.ownerId, 'negotiation:new_offer', {
      ...payload,
      shopkeeperId: negotiation.shop.ownerId,
      customerId: client.data.userId,
    });
  }

  @SubscribeMessage('negotiation:counter')
  async handleCounter(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: any,
  ) {
    // Expected payload: { negotiationId, price }
    const negotiation = await this.findNegotiation(payload?.negotiationId);
    if (!negotiation || negotiation.shop.ownerId !== client.data.userId) return;

    this.emitToUser(negotiation.customerId, 'negotiation:counter_offer', {
      ...payload,
      customerId: negotiation.customerId,
      shopkeeperId: client.data.userId,
    });
  }

  private async findNegotiation(negotiationId: unknown) {
    if (typeof negotiationId !== 'string' || !negotiationId) return null;
    try {
      return await this.prisma.negotiation.findUnique({
        where: { id: negotiationId },
        select: {
          customerId: true,
          shop: { select: { ownerId: true } },
        },
      });
    } catch {
      return null;
    }
  }

  // --- Real-time Handlers for Chat ---

  @SubscribeMessage('joinRoom')
  async handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { roomId: string },
  ) {
    if (!payload?.roomId) return;

    // Only participants of a chat room may join its socket room.
    const room = await this.chatsService
      .getRoomById(payload.roomId)
      .catch(() => null);
    if (
      !room ||
      (room.participantA !== client.data.userId &&
        room.participantB !== client.data.userId)
    ) {
      return;
    }

    await client.join(`room:${payload.roomId}`);
    this.logger.debug(
      `User ${client.data.userId} joined room:${payload.roomId}`,
    );
  }

  @SubscribeMessage('leaveRoom')
  handleLeaveRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { roomId: string },
  ) {
    if (payload?.roomId) {
      client.leave(`room:${payload.roomId}`);
      this.logger.debug(
        `User ${client.data.userId} left room:${payload.roomId}`,
      );
    }
  }

  @SubscribeMessage('sendMessage')
  async handleSendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { roomId: string; content: string },
  ) {
    try {
      const userId = client.data.userId;
      const message = await this.chatsService.sendMessage(
        userId,
        payload.roomId,
        payload.content,
      );
      const room = await this.chatsService.getRoomById(payload.roomId);

      if (room) {
        // Broadcast to both participants via personal rooms
        this.emitToUser(room.participantA, 'newMessage', message);
        this.emitToUser(room.participantB, 'newMessage', message);
      }
    } catch (error) {
      this.logger.error(`Error sending message: ${error.message}`);
    }
  }
}

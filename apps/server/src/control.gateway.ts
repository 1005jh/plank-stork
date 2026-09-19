import { Logger } from '@nestjs/common';
import {
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  TestControlEvent,
} from '@plank-stork/protocol';
import type { Server, Socket } from 'socket.io';

@WebSocketGateway({
  cors: {
    // Allow the two HTTP dev servers on localhost or a LAN hostname/IP.
    origin: /^http:\/\/[^/]+:(5173|5174)$/,
    methods: ['GET', 'POST'],
  },
})
export class ControlGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(ControlGateway.name);

  @WebSocketServer()
  private server!: Server<ClientToServerEvents, ServerToClientEvents>;

  handleConnection(client: Socket<ClientToServerEvents, ServerToClientEvents>) {
    this.logger.log(`Socket connected: ${client.id}`);
  }

  handleDisconnect(client: Socket<ClientToServerEvents, ServerToClientEvents>) {
    this.logger.log(`Socket disconnected: ${client.id}`);
  }

  @SubscribeMessage('control:test')
  handleTestControl(@MessageBody() event: TestControlEvent): void {
    this.server.emit('control:test:received', event);
  }
}

import { Logger } from '@nestjs/common';
import {
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import type {
  CalibrationRequest,
  CalibrationRemoteState,
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

  // Single-controller development POC: relay only, with no state or timers on the server.
  @SubscribeMessage('calibration:sync:request')
  handleSync(@MessageBody() request: CalibrationRequest): void {
    this.server.emit('calibration:sync:requested', request);
  }

  @SubscribeMessage('calibration:neutral:start')
  handleNeutralStart(@MessageBody() request: CalibrationRequest): void {
    this.server.emit('calibration:neutral:start:requested', request);
  }

  @SubscribeMessage('calibration:action:start')
  handleActionStart(@MessageBody() request: CalibrationRequest): void {
    this.server.emit('calibration:action:start:requested', request);
  }

  @SubscribeMessage('calibration:action:reset')
  handleActionReset(@MessageBody() request: CalibrationRequest): void {
    this.server.emit('calibration:action:reset:requested', request);
  }

  @SubscribeMessage('calibration:state:publish')
  handleCalibrationState(@MessageBody() state: CalibrationRemoteState): void {
    this.server.emit('calibration:state', state);
  }
}

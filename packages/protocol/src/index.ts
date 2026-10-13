import type { CalibrationRemoteState, CalibrationRequest } from './calibration.js';
import type { GameStateSnapshot, GameSyncRequest, GameOperatorCommand } from './game.js';
export * from './game.js';
export type * from './calibration.js';
export type * from './kneeKick.js';

export type ControlDirection = 'LEFT' | 'RIGHT';

export interface TestControlEvent {
  direction: ControlDirection;
  timestamp: number;
}

export interface ClientToServerEvents {
  'game:state:publish': (snapshot: GameStateSnapshot) => void;
  'game:sync:request': (request: GameSyncRequest) => void;
  'game:command': (command: GameOperatorCommand) => void;
  'control:test': (event: TestControlEvent) => void;
  'calibration:sync:request': (request: CalibrationRequest) => void;
  'calibration:neutral:start': (request: CalibrationRequest) => void;
  'calibration:action:start': (request: CalibrationRequest) => void;
  'calibration:action:reset': (request: CalibrationRequest) => void;
  'calibration:state:publish': (state: CalibrationRemoteState) => void;
  'validation:start': (request: CalibrationRequest) => void;
  'validation:reset': (request: CalibrationRequest) => void;
  'kick:test:start': (request: CalibrationRequest) => void;
  'kick:test:reset': (request: CalibrationRequest) => void;
  'motion:validation:start': (request: CalibrationRequest) => void;
  'motion:validation:reset': (request: CalibrationRequest) => void;
}

export interface ServerToClientEvents {
  'game:state': (snapshot: GameStateSnapshot) => void;
  'game:sync:requested': (request: GameSyncRequest) => void;
  'game:command:requested': (command: GameOperatorCommand) => void;
  'control:test:received': (event: TestControlEvent) => void;
  'calibration:sync:requested': (request: CalibrationRequest) => void;
  'calibration:neutral:start:requested': (request: CalibrationRequest) => void;
  'calibration:action:start:requested': (request: CalibrationRequest) => void;
  'calibration:action:reset:requested': (request: CalibrationRequest) => void;
  'calibration:state': (state: CalibrationRemoteState) => void;
  'validation:start:requested': (request: CalibrationRequest) => void;
  'validation:reset:requested': (request: CalibrationRequest) => void;
  'kick:test:start:requested': (request: CalibrationRequest) => void;
  'kick:test:reset:requested': (request: CalibrationRequest) => void;
  'motion:validation:start:requested': (request: CalibrationRequest) => void;
  'motion:validation:reset:requested': (request: CalibrationRequest) => void;
}

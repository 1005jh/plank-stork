import type { CalibrationRemoteState, CalibrationRequest } from './calibration.js';
export type * from './calibration.js';

export type ControlDirection = 'LEFT' | 'RIGHT';

export interface TestControlEvent {
  direction: ControlDirection;
  timestamp: number;
}

export interface ClientToServerEvents {
  'control:test': (event: TestControlEvent) => void;
  'calibration:sync:request': (request: CalibrationRequest) => void;
  'calibration:neutral:start': (request: CalibrationRequest) => void;
  'calibration:action:start': (request: CalibrationRequest) => void;
  'calibration:action:reset': (request: CalibrationRequest) => void;
  'calibration:state:publish': (state: CalibrationRemoteState) => void;
}

export interface ServerToClientEvents {
  'control:test:received': (event: TestControlEvent) => void;
  'calibration:sync:requested': (request: CalibrationRequest) => void;
  'calibration:neutral:start:requested': (request: CalibrationRequest) => void;
  'calibration:action:start:requested': (request: CalibrationRequest) => void;
  'calibration:action:reset:requested': (request: CalibrationRequest) => void;
  'calibration:state': (state: CalibrationRemoteState) => void;
}

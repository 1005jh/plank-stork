export type ControlDirection = 'LEFT' | 'RIGHT';

export interface TestControlEvent {
  direction: ControlDirection;
  timestamp: number;
}

export interface ClientToServerEvents {
  'control:test': (event: TestControlEvent) => void;
}

export interface ServerToClientEvents {
  'control:test:received': (event: TestControlEvent) => void;
}

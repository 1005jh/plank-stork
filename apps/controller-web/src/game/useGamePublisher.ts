import { useEffect } from 'react';
import type { Socket } from 'socket.io-client';
import { GAME_HEARTBEAT_MS, isGameSyncRequest, type ClientToServerEvents, type ServerToClientEvents } from '@plank-stork/protocol';
import type { GameController } from './gameController';

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export function useGamePublisher(owner: GameController, socket: GameSocket | null): void {
  useEffect(() => {
    if (!socket) return;
    let active = true;
    let lastPublished = owner.getView().snapshot;
    const publish = () => {
      if (!active || !socket.connected) return;
      lastPublished = owner.getView().snapshot;
      // Drop on transport loss; heartbeat/sync sends the latest full state, never action backlog.
      socket.volatile.emit('game:state:publish', lastPublished);
    };
    const changed = () => { if (owner.getView().snapshot !== lastPublished) publish(); };
    const sync = (request: unknown) => {
      if (isGameSyncRequest(request) && (request.controllerInstanceId === null || request.controllerInstanceId === owner.instanceId)) publish();
    };
    const command = (request: unknown) => {
      if (!active || !socket.connected) return;
      const previous = owner.getView().snapshot;
      owner.command(request);
      // A change already published via the subscription; duplicates only resend current state.
      if (owner.getView().snapshot === previous) publish();
    };
    const unsubscribe = owner.subscribe(changed);
    socket.on('connect', publish);
    socket.on('game:sync:requested', sync);
    socket.on('game:command:requested', command);
    const timer = window.setInterval(publish, GAME_HEARTBEAT_MS);
    publish();
    return () => {
      active = false;
      unsubscribe();
      window.clearInterval(timer);
      socket.off('connect', publish);
      socket.off('game:sync:requested', sync);
      socket.off('game:command:requested', command);
    };
  }, [owner, socket]);
}

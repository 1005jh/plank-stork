import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents, GameCommandType } from '@plank-stork/protocol';
import { GameRemoteState } from './gameRemoteState';

type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
let requestNumber = 0;
const requestId = () => `game-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}-${++requestNumber}`;

export function useGameRemote(socket: GameSocket | null) {
  const [remote] = useState(() => new GameRemoteState());
  const view = useSyncExternalStore(remote.subscribe, remote.getView);
  const sync = useCallback(() => {
    if (socket?.connected) socket.volatile.emit('game:sync:request', {
      version: 1, requestId: requestId(), controllerInstanceId: remote.getView().selectedId,
    });
  }, [socket, remote]);

  useEffect(() => {
    if (!socket) { remote.connection(false, performance.now()); return; }
    let active = true;
    const connect = () => { if (active) { remote.connection(true, performance.now()); sync(); } };
    const disconnect = () => { if (active) remote.connection(false, performance.now()); };
    const receive = (payload: unknown) => { if (active && socket.connected) remote.receive(payload, performance.now()); };
    socket.on('connect', connect);
    socket.on('disconnect', disconnect);
    socket.on('connect_error', disconnect);
    socket.on('game:state', receive);
    if (socket.connected) connect(); else disconnect();
    const timer = window.setInterval(() => remote.tick(performance.now()), 250);
    return () => {
      active = false;
      window.clearInterval(timer);
      socket.off('connect', connect);
      socket.off('disconnect', disconnect);
      socket.off('connect_error', disconnect);
      socket.off('game:state', receive);
      remote.connection(false, performance.now());
    };
  }, [socket, remote, sync]);

  const select = useCallback((id: string) => { remote.select(id, performance.now()); sync(); }, [remote, sync]);
  const send = useCallback((command: GameCommandType) => {
    if (!socket?.connected) return;
    const request = remote.request(command, requestId(), performance.now());
    if (request) socket.volatile.emit('game:command', request);
  }, [socket, remote]);
  return { ...view, select, send };
}

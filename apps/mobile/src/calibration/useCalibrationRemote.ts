import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type { CalibrationRemoteState, ClientToServerEvents, ServerToClientEvents } from '@plank-stork/protocol';

export const REMOTE_STATE_TIMEOUT_MS = 1500;
export type CalibrationCommand = 'calibration:neutral:start' | 'calibration:action:start' | 'calibration:action:reset';
type CalibrationSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

// Works on phone HTTP LAN origins too, where crypto.randomUUID may be unavailable.
function request() {
  return { requestId: `${Date.now()}-${Math.random().toString(36).slice(2)}`, timestamp: Date.now() };
}

export function useCalibrationRemote(socket: CalibrationSocket | null) {
  const [state, setState] = useState<CalibrationRemoteState | null>(null);
  const receivedAt = useRef<number | null>(null);

  useEffect(() => {
    if (!socket) return;
    const clear = () => { receivedAt.current = null; setState(null); };
    const sync = () => {
      clear();
      if (socket.connected) socket.emit('calibration:sync:request', request());
    };
    const receive = (snapshot: CalibrationRemoteState) => {
      receivedAt.current = performance.now();
      setState(snapshot);
    };
    socket.on('connect', sync);
    socket.on('disconnect', clear);
    socket.on('connect_error', clear);
    socket.on('calibration:state', receive);
    if (socket.connected) sync();
    // This watchdog only expires the display; it never advances calibration stages/countdowns.
    const timer = window.setInterval(() => {
      if (receivedAt.current !== null && performance.now() - receivedAt.current >= REMOTE_STATE_TIMEOUT_MS) clear();
    }, 250);
    return () => {
      window.clearInterval(timer);
      socket.off('connect', sync);
      socket.off('disconnect', clear);
      socket.off('connect_error', clear);
      socket.off('calibration:state', receive);
      receivedAt.current = null;
    };
  }, [socket]);

  const send = useCallback((event: CalibrationCommand) => {
    // Never queue commands while offline or without a current controller snapshot.
    if (socket?.connected && receivedAt.current !== null && performance.now() - receivedAt.current < REMOTE_STATE_TIMEOUT_MS) {
      socket.emit(event, request());
    }
  }, [socket]);

  return { state, send };
}

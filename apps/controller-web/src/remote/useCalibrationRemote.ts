import { useCallback, useEffect, useRef } from 'react';
import type { Socket } from 'socket.io-client';
import type { CalibrationRequest, ClientToServerEvents, ServerToClientEvents } from '@plank-stork/protocol';
import { CalibrationRemoteController, type CalibrationPorts, type RemoteCommand } from './calibrationRemoteController';

export type CalibrationSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
export const REMOTE_PUBLISH_INTERVAL_MS = 250;

export function useCalibrationRemote(socket: CalibrationSocket | null | undefined, ports: CalibrationPorts) {
  const portsRef = useRef(ports);
  portsRef.current = ports;
  const remoteRef = useRef<CalibrationRemoteController | null>(null);
  if (!remoteRef.current) remoteRef.current = new CalibrationRemoteController(() => portsRef.current);
  const remote = remoteRef.current;

  const publish = useCallback(() => {
    if (socket?.connected) socket.emit('calibration:state:publish', remote.snapshot());
  }, [socket, remote]);

  const publishStopped = useCallback(() => {
    remote.clearError();
    if (socket?.connected) socket.emit('calibration:state:publish', remote.snapshot({ cameraRunning: false, poseDetected: false }));
  }, [socket, remote]);

  useEffect(() => {
    if (!socket) return;
    const command = (name: RemoteCommand) => (request: CalibrationRequest) => {
      remote.handle(name, request);
      publish();
    };
    const neutral = command('neutral:start');
    const action = command('action:start');
    const reset = command('action:reset');
    const validationStart = command('validation:start');
    const validationReset = command('validation:reset');
    socket.on('connect', publish);
    socket.on('calibration:sync:requested', publish);
    socket.on('calibration:neutral:start:requested', neutral);
    socket.on('calibration:action:start:requested', action);
    socket.on('calibration:action:reset:requested', reset);
    socket.on('validation:start:requested', validationStart);
    socket.on('validation:reset:requested', validationReset);
    publish();
    // Never called from the inference callback; only compact debug snapshots cross the wire.
    const timer = window.setInterval(publish, REMOTE_PUBLISH_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
      socket.off('connect', publish);
      socket.off('calibration:sync:requested', publish);
      socket.off('calibration:neutral:start:requested', neutral);
      socket.off('calibration:action:start:requested', action);
      socket.off('calibration:action:reset:requested', reset);
      socket.off('validation:start:requested', validationStart);
      socket.off('validation:reset:requested', validationReset);
    };
  }, [socket, remote, publish]);

  return { publishStopped };
}

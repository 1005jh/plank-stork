import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { PoseCamera } from './components/PoseCamera';
import type {
  ClientToServerEvents,
  ControlDirection,
  ServerToClientEvents,
  TestControlEvent,
} from '@plank-stork/protocol';

const socketServerUrl = `http://${window.location.hostname}:3000`;

export default function App() {
  const socketRef = useRef<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null);
  const [connected, setConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<TestControlEvent | null>(null);

  useEffect(() => {
    const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(socketServerUrl, {
      autoConnect: false,
    });
    socketRef.current = socket;

    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    const onReceived = (event: TestControlEvent) => setLastEvent(event);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onDisconnect);
    socket.on('control:test:received', onReceived);
    socket.connect();

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onDisconnect);
      socket.off('control:test:received', onReceived);
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  function sendControl(direction: ControlDirection) {
    const socket = socketRef.current;
    if (socket?.connected) {
      socket.emit('control:test', { direction, timestamp: Date.now() });
    }
  }

  return (
    <main>
      <h1>Plank Stork Controller</h1>
      <PoseCamera />
      <h2>Socket test</h2>
      <p role="status">Socket: {connected ? 'CONNECTED' : 'DISCONNECTED'}</p>
      <p>Socket server: <code>{socketServerUrl}</code></p>
      <div>
        <button type="button" disabled={!connected} onClick={() => sendControl('LEFT')}>
          LEFT
        </button>{' '}
        <button type="button" disabled={!connected} onClick={() => sendControl('RIGHT')}>
          RIGHT
        </button>
      </div>
      <dl aria-live="polite">
        <dt>Last direction</dt>
        <dd>{lastEvent?.direction ?? '—'}</dd>
        <dt>Last timestamp (Unix ms)</dt>
        <dd>{lastEvent?.timestamp ?? '—'}</dd>
      </dl>
    </main>
  );
}

import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { CalibrationPanel } from './calibration/CalibrationPanel';
import { useCalibrationRemote } from './calibration/useCalibrationRemote';
import './App.css';
import type {
  ClientToServerEvents,
  ControlDirection,
  ServerToClientEvents,
  TestControlEvent,
} from '@plank-stork/protocol';

const socketServerUrl = `http://${window.location.hostname}:3000`;

export default function App() {
  const socketRef = useRef<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null);
  const [socket, setSocket] = useState<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null);
  const [connected, setConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<TestControlEvent | null>(null);
  const remote = useCalibrationRemote(socket);

  useEffect(() => {
    const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(socketServerUrl, {
      autoConnect: false,
    });
    socketRef.current = socket;
    setSocket(socket);

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
      <h1>Plank Stork</h1>
      <p>Mobile Game</p>
      <p role="status">Socket: {connected ? 'CONNECTED' : 'DISCONNECTED'}</p>
      <p>Socket server: <code>{socketServerUrl}</code></p>
      <CalibrationPanel state={remote.state} connected={connected} send={remote.send} />
      <details className="socket-test"><summary>STEP 1 · Socket test</summary>
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
      </details>
    </main>
  );
}

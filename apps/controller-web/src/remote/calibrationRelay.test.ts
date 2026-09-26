// @vitest-environment node
import { KneeKickAnalysis } from '../pose/kick/kneeKickAnalysis';
import { KneeMotionValidation } from '../pose/motion/kneeMotionValidation';
import { ActionValidation } from '../pose/validation/actionValidation';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { io, type Socket } from 'socket.io-client';
import type { CalibrationRequest, ClientToServerEvents, ServerToClientEvents } from '@plank-stork/protocol';
import { CalibrationRemoteController } from './calibrationRemoteController';
import { PoseFeatureAnalysis } from '../pose/features/poseFeatureAnalysis';
import { PoseActionAnalysis } from '../pose/actions/poseActionAnalysis';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

describe('real NestJS Socket.IO relay', () => {
  const clients: Client[] = [];
  let app: { listen: (port: number, host: string) => Promise<void>; getUrl: () => Promise<string>; close: () => Promise<void> };
  let url: string;

  beforeAll(async () => {
    // Reuse the existing server compiler and controller test runner; no new test stack.
    const cwd = fileURLToPath(new URL('../../../../', import.meta.url));
    execFileSync('pnpm', ['--filter', '@plank-stork/protocol', 'build'], { cwd, stdio: 'pipe' });
    execFileSync('pnpm', ['--filter', '@plank-stork/server', 'build'], { cwd, stdio: 'pipe' });
    const serverRequire = createRequire(new URL('../../../server/package.json', import.meta.url));
    const { NestFactory } = serverRequire('@nestjs/core');
    const { AppModule } = serverRequire('./dist/app.module.js');
    app = await NestFactory.create(AppModule, { logger: false });
    await app.listen(0, '127.0.0.1');
    url = await app.getUrl();
    for (const port of [5173, 5174]) {
      const socket: Client = io(url, { autoConnect: false, extraHeaders: { Origin: `http://localhost:${port}` } });
      clients.push(socket);
      await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); socket.connect(); });
    }
  }, 30000);

  afterAll(async () => { clients.forEach((client) => client.disconnect()); await app?.close(); });

  const cases = [
    ['calibration:sync:request', 'calibration:sync:requested'],
    ['validation:start', 'validation:start:requested'],
    ['kick:test:start', 'kick:test:start:requested'],
    ['kick:test:reset', 'kick:test:reset:requested'],
    ['motion:validation:start', 'motion:validation:start:requested'],
    ['motion:validation:reset', 'motion:validation:reset:requested'],
    ['validation:reset', 'validation:reset:requested'],
    ['calibration:neutral:start', 'calibration:neutral:start:requested'],
    ['calibration:action:start', 'calibration:action:start:requested'],
    ['calibration:action:reset', 'calibration:action:reset:requested'],
  ] as const;

  it.each(cases)('relays %s unchanged to both clients', async (outgoing, incoming) => {
    const payload: CalibrationRequest = { requestId: outgoing, timestamp: 123456 };
    const received = clients.map((client) => new Promise<CalibrationRequest>((resolve) => client.once(incoming, resolve)));
    clients[1].emit(outgoing, payload);
    expect(await Promise.all(received)).toEqual([payload, payload]);
  });

  it('broadcasts a typed controller state without calculating or storing prototypes', async () => {
    const neutral = new PoseFeatureAnalysis(); const actions = new PoseActionAnalysis();
    const snapshot = new CalibrationRemoteController(() => ({
      getCamera: () => ({ cameraRunning: false, poseDetected: false }), getNeutral: () => neutral.getView(0),
      getActions: () => actions.getView(neutral.getView(0), 0), startNeutral() {}, startAction() {}, resetAction() {},
      getValidation: () => new ActionValidation().getView(0), startValidation: () => false, resetValidation() {},
      getMotion: () => new KneeMotionValidation().getView(0), startMotion: () => false, resetMotion() {},
      getKick: () => new KneeKickAnalysis().getView(0), startDetectorTest: () => false, resetDetectorTest() {},
    })).snapshot();
    const received = clients.map((client) => new Promise((resolve) => client.once('calibration:state', resolve)));
    clients[0].emit('calibration:state:publish', snapshot);
    expect(await Promise.all(received)).toEqual([snapshot, snapshot]);
  });

  it.each(['LEFT', 'RIGHT'] as const)('preserves manual control:test %s broadcasts', async (direction) => {
    const payload = { direction, timestamp: 123 };
    const received = clients.map((client) => new Promise((resolve) => client.once('control:test:received', resolve)));
    clients[direction === 'LEFT' ? 0 : 1].emit('control:test', payload);
    expect(await Promise.all(received)).toEqual([payload, payload]);
  });

  it('shares the existing HTTP health server', async () => {
    expect(await (await fetch(`${url}/health`)).json()).toEqual({ status: 'ok' });
  });
});

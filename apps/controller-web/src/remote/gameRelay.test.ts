// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { io, type Socket } from 'socket.io-client';
import { isGameSyncRequest, type ClientToServerEvents, type ServerToClientEvents, type GameStateSnapshot, type GameCommandType } from '@plank-stork/protocol';
import { GameController } from '../game/gameController';
import { GameRemoteState } from '../../../mobile/src/game/gameRemoteState';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;
describe('real NestJS controller-authoritative game relay', () => {
  let app: { listen: (port: number, host: string) => Promise<void>; getUrl: () => Promise<string>; close: () => Promise<void> };
  let controller: Client, mobile: Client, owner: GameController, remote: GameRemoteState;
  let unsubscribe = () => {}, number = 0;
  const received: GameStateSnapshot[] = [];
  const publish = () => { if (controller.connected) controller.volatile.emit('game:state:publish', owner.getView().snapshot); };
  const next = (predicate: (s: GameStateSnapshot) => boolean) => new Promise<GameStateSnapshot>((resolve) => {
    const receive = (s: GameStateSnapshot) => { if (predicate(s)) { mobile.off('game:state', receive); resolve(s); } };
    mobile.on('game:state', receive);
  });
  // Same-connection packet ordering is the barrier; no arbitrary sleeps for negative assertions.
  const barrier = () => new Promise<void>((resolve) => {
    mobile.once('control:test:received', () => resolve());
    mobile.emit('control:test', { direction: 'LEFT', timestamp: 1 });
  });
  async function send(command: GameCommandType) {
    const request = remote.request(command, `request-${++number}`, performance.now())!;
    expect(request).not.toBeNull();
    const result = next((s) => s.commandResult?.requestId === request.requestId);
    mobile.volatile.emit('game:command', request);
    return await result;
  }
  beforeAll(async () => {
    const cwd = fileURLToPath(new URL('../../../../', import.meta.url));
    execFileSync('pnpm', ['--filter', '@plank-stork/protocol', 'build'], { cwd, stdio: 'pipe' });
    execFileSync('pnpm', ['--filter', '@plank-stork/server', 'build'], { cwd, stdio: 'pipe' });
    // Also verifies Node 24 CommonJS Nest can load the shared ESM runtime validators.
    const serverRequire = createRequire(new URL('../../../server/package.json', import.meta.url));
    const { NestFactory } = serverRequire('@nestjs/core');
    const { AppModule } = serverRequire('./dist/app.module.js');
    app = await NestFactory.create(AppModule, { logger: false });
    await app.listen(0, '127.0.0.1');
    const url = await app.getUrl();
    controller = io(url, { autoConnect: false, transports: ['websocket'], extraHeaders: { Origin: 'http://localhost:5173' } });
    mobile = io(url, { autoConnect: false, transports: ['websocket'], extraHeaders: { Origin: 'http://localhost:5174' } });
    for (const client of [controller, mobile]) {
      await new Promise<void>((resolve, reject) => { client.once('connect', resolve); client.once('connect_error', reject); client.connect(); });
    }
    controller.on('game:sync:requested', (request) => {
      if (isGameSyncRequest(request) && (request.controllerInstanceId === null || request.controllerInstanceId === owner.instanceId)) publish();
    });
    controller.on('game:command:requested', (request) => { owner.command(request); publish(); });
    mobile.on('game:state', (s) => { received.push(s); remote.receive(s, performance.now()); });
    mobile.on('disconnect', () => remote.connection(false, performance.now()));
    mobile.on('connect', () => {
      remote.connection(true, performance.now());
      mobile.emit('game:sync:request', { version: 1, requestId: 'reconnect', controllerInstanceId: owner.instanceId });
    });
  }, 30000);
  beforeEach(async () => {
    unsubscribe(); owner = new GameController(`controller-${++number}`, () => performance.now());
    remote = new GameRemoteState(); remote.connection(true, performance.now()); received.length = 0;
    unsubscribe = owner.subscribe(publish);
    const initial = next((s) => s.controllerInstanceId === owner.instanceId);
    mobile.emit('game:sync:request', { version: 1, requestId: 'discover', controllerInstanceId: null });
    await initial; remote.select(owner.instanceId, performance.now());
  });
  afterAll(async () => { unsubscribe(); controller?.disconnect(); mobile?.disconnect(); await app?.close(); });

  it('syncs compact full state, START and local keyboard inputs, then RESET/STOP with no server scoring', async () => {
    const started = await send('START');
    expect(started).toMatchObject({ phase: 'RUNNING', score: 0, commandResult: { status: 'ACCEPTED' } });
    const scored = next((s) => s.score === 1);
    owner.input({ ...owner.getView().state.run, sequence: 1, occurredAtMs: performance.now(), action: 'LEFT_ACTION', provenance: { kind: 'TEST', method: 'KEYBOARD' } });
    await scored;
    expect(remote.getView().snapshot).toEqual(owner.getView().snapshot);
    expect(JSON.stringify(remote.getView().snapshot)).not.toMatch(/landmarks|baseline|history/);
    expect(await send('STOP')).toMatchObject({ phase: 'IDLE', score: 0, runId: null });
    const restarted = await send('START'); expect(restarted.runId).not.toBe(started.runId);
    expect(await send('RESET')).toMatchObject({ phase: 'IDLE', score: 0 });
  });
  it('deduplicates commands at the actual controller authority and rejects stale expectations', async () => {
    const request = remote.request('START', 'duplicate', performance.now())!;
    const started = next((s) => s.commandResult?.requestId === request.requestId);
    mobile.emit('game:command', request); mobile.emit('game:command', request);
    await started; await barrier();
    expect(owner.getView().state.usedRunIds).toHaveLength(1);
    expect(owner.getView().snapshot.revision).toBe(1);
    const rejected = next((s) => s.commandResult?.requestId === 'old');
    mobile.emit('game:command', { ...request, requestId: 'old', command: 'RESET' });
    expect(await rejected).toMatchObject({ phase: 'RUNNING', commandResult: { status: 'REJECTED', reason: 'WRONG_RUN' } });
  });
  it('blocks malformed snapshots/sync/commands at the server before either client can consume them', async () => {
    let commands = 0, syncs = 0;
    const countCommand = () => { commands++; }, countSync = () => { syncs++; };
    controller.on('game:command:requested', countCommand); controller.on('game:sync:requested', countSync);
    const before = received.length;
    mobile.emit('game:state:publish', { ...owner.getView().snapshot, provenance: { kind: 'POSE' } } as never);
    mobile.emit('game:state:publish', { ...owner.getView().snapshot, landmarks: [] } as never);
    mobile.emit('game:command', { command: 'INPUT', action: 'LEFT_ACTION' } as never);
    mobile.emit('game:sync:request', { version: 2, requestId: 'bad', controllerInstanceId: null } as never);
    await barrier();
    expect(received).toHaveLength(before); expect(commands).toBe(0); expect(syncs).toBe(0);
    expect(owner.getView().snapshot.score).toBe(0);
    controller.off('game:command:requested', countCommand); controller.off('game:sync:requested', countSync);
  });
  it('resyncs the latest full score after mobile disconnect, without replaying commands or actions', async () => {
    await send('START'); mobile.disconnect();
    expect(remote.getView().status).toBe('DISCONNECTED');
    expect(remote.request('RESET', 'offline', performance.now())).toBeNull();
    owner.input({ ...owner.getView().state.run, sequence: 1, occurredAtMs: performance.now(), action: 'LEFT_ACTION', provenance: { kind: 'TEST', method: 'KEYBOARD' } });
    const fresh = next((s) => s.revision === owner.getView().snapshot.revision);
    mobile.connect(); await fresh;
    expect(remote.getView()).toMatchObject({ status: 'LIVE', snapshot: { score: 1 } });
    expect(owner.getView().state.history).toHaveLength(1);
  });
  it('preserves calibration sync and LEFT/RIGHT control:test channels alongside game relay', async () => {
    const request = { requestId: 'calibration-independent', timestamp: 123 };
    const calibration = new Promise((resolve) => controller.once('calibration:sync:requested', resolve));
    mobile.emit('calibration:sync:request', request); expect(await calibration).toEqual(request);
    for (const direction of ['LEFT', 'RIGHT'] as const) {
      const received = new Promise((resolve) => mobile.once('control:test:received', resolve));
      controller.emit('control:test', { direction, timestamp: 123 });
      expect(await received).toEqual({ direction, timestamp: 123 });
    }
    expect(owner.getView().snapshot).toMatchObject({ phase: 'IDLE', score: 0 });
  });
  it('relays SCRIPT provenance, an interrupted demo and hands-free completion over the existing wire events', async () => {
    let now = 100;
    let pending: { callback: () => void; delay: number } | null = null;
    unsubscribe(); owner = new GameController(owner.instanceId, () => now); unsubscribe = owner.subscribe(publish);
    const runtime = { isVisible: () => true, schedule: (callback: () => void, delay: number) => {
      const job = { callback, delay }; pending = job;
      return () => { if (pending === job) pending = null; };
    } };
    const tick = async () => {
      if (!pending) throw new Error('Expected one scheduled SCRIPT input');
      const job = pending; pending = null;
      const revision = owner.getView().snapshot.revision;
      const result = next((s) => s.revision > revision);
      now += job.delay; job.callback(); return await result;
    };
    const first = next((s) => s.provenance.method === 'SCRIPT'); owner.startScriptedDemo(runtime); await first;
    expect(await tick()).toMatchObject({ score: 0, feedback: { outcome: 'WRONG' } });
    expect(await tick()).toMatchObject({ score: 1 });
    expect(await send('STOP')).toMatchObject({ phase: 'IDLE', score: 0, scriptStopReason: 'STOP', provenance: { method: 'SCRIPT' } });
    expect(pending).toBeNull();
    const restart = next((s) => s.phase === 'RUNNING'); owner.startScriptedDemo(runtime); await restart;
    for (let i = 0; i < 5; i++) await tick();
    expect(remote.getView().snapshot).toMatchObject({ phase: 'COMPLETED', score: 4, provenance: { kind: 'TEST', method: 'SCRIPT' } });
    expect(owner.getView().state.history).toHaveLength(5); expect(pending).toBeNull();
  });
});

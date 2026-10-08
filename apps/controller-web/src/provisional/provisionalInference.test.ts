// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PoseLandmarker } from '@mediapipe/tasks-vision';
import { createEstimator } from '../estimator/estimatorConfig';
import { frameSequence } from '../estimator/estimatorInference';
import { decodeWebMFrames, type DecodedVideoFrame } from '../replay/decodedVideoSource';
import { motionFrame } from '../pose/motion/testFixtures';
import { assertProvisionalPair, PROVISIONAL_PAIRS, PROVISIONAL_PROVENANCE, provisionalConfig, sha256 } from './provisionalContract';
import { runProvisionalEstimatorAnalysis, validateFullVideoCache, validateProvisionalFile } from './provisionalInference';
import { replayVideoSourceError, replayVideoSourceFromFilename } from '../replay/replayVideoSource';
import { validateEstimatorMedia } from '../estimator/estimatorInference';
import type { ReplaySession } from '../replay/replayTypes';
vi.mock('../estimator/estimatorConfig', async (original) => ({ ...await original<typeof import('../estimator/estimatorConfig')>(), createEstimator: vi.fn() }));
vi.mock('../replay/decodedVideoSource', async (original) => ({ ...await original<typeof import('../replay/decodedVideoSource')>(), decodeWebMFrames: vi.fn() }));
vi.mock('./provisionalContract', async (original) => { const actual = await original<typeof import('./provisionalContract')>(); return { ...actual, sha256: vi.fn(actual.sha256) }; });
const pair = PROVISIONAL_PAIRS[0], times = [0, 33, 67];
const file = () => new File(['video'], pair.webmFilename);
const plan = async () => ({ timestamps: times, sequence: await frameSequence(times) });
let frames: DecodedVideoFrame[], close: ReturnType<typeof vi.fn<() => void>>, iteratorClose: ReturnType<typeof vi.fn<() => void>>;
let model: { detect: ReturnType<typeof vi.fn>; detectForVideo: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
const cache = async () => ({ mediaId: pair.webmSha256, config: provisionalConfig('FULL_VIDEO_CONTROL'), sequence: (await plan()).sequence,
  frameSequenceParity: true, frames: times.map((tMs, order) => ({ tMs, order, landmarks: [], worldLandmarks: [], posePresent: false, inferenceMs: 1 })) });
beforeEach(() => {
  close = vi.fn(); iteratorClose = vi.fn(); vi.mocked(sha256).mockResolvedValue(pair.webmSha256);
  vi.stubGlobal('document', { createElement: vi.fn(() => ({ width: 0, height: 0, getContext: () => ({}) })) });
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => { throw new Error('Presentation clock forbidden'); }));
  frames = times.map((t) => ({ timestamp: t / 1000, displayWidth: 1280, displayHeight: 720, draw: vi.fn(), close: vi.fn() }));
  vi.mocked(decodeWebMFrames).mockImplementation(async function* () { try { yield* frames; } finally { iteratorClose(); } });
  const result = () => ({ landmarks: [motionFrame(0).landmarks], worldLandmarks: [], close });
  model = { detect: vi.fn(result), detectForVideo: vi.fn(result), close: vi.fn() };
  vi.mocked(createEstimator).mockResolvedValue(model as unknown as PoseLandmarker);
});
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals(); });
it('pins exactly the five authorized pairs and excludes the sixth media', () => {
  expect(PROVISIONAL_PAIRS.map((p) => [p.role, p.webmFilename])).toEqual([
    ['STRESS', '3차검증.webm'], ['REFERENCE_OLD_CLEAN', 'clean인가.webm'], ['REFERENCE_LIVE_1', '4gi replay webm.webm'],
    ['REFERENCE_LIVE_2', '4j result webm.webm'], ['REFERENCE_LIVE_3', '4k.2a webm.webm']]);
  expect(Object.isFrozen(PROVISIONAL_PAIRS)).toBe(true); expect(PROVISIONAL_PAIRS.every(Object.isFrozen)).toBe(true);
  expect(() => assertProvisionalPair({ ...pair, webmFilename: '2차검증1.webm' })).toThrow('mapping');
});
it.each(Object.keys(PROVISIONAL_PROVENANCE))('requires explicit %s before touching a file or inference', async (key) => {
  const bad = { ...pair }; delete (bad as Record<string, unknown>)[key];
  await expect(runProvisionalEstimatorAnalysis(bad, file(), 'FULL_IMAGE', await plan(), new AbortController().signal)).rejects.toThrow('provenance');
  expect(sha256).not.toHaveBeenCalled(); expect(createEstimator).not.toHaveBeenCalled();
});
it('provisional provenance cannot enter general replay or the original guarded estimator', () => {
  const selected = { ...replayVideoSourceFromFilename(pair.webmFilename), ...pair };
  expect(replayVideoSourceError({ filename: pair.captureId + '.webm', sourceCaptureId: pair.captureId }, selected)).not.toBeNull();
  expect(() => validateEstimatorMedia({ captureId: pair.captureId, video: { filename: pair.captureId + '.webm' } } as ReplaySession, file())).toThrow('다른 capture');
});
it('checks actual bytes and refuses renamed files before model creation', async () => {
  vi.mocked(sha256).mockResolvedValue('different'); await expect(validateProvisionalFile(pair, file())).rejects.toThrow('hash');
  await expect(validateProvisionalFile(pair, new File([], 'renamed.webm'))).rejects.toThrow('filename');
  expect(createEstimator).not.toHaveBeenCalled();
});
it.each(['FULL_VIDEO_CONTROL', 'FULL_IMAGE', 'HEAVY_VIDEO'] as const)('%s keeps every PTS and uses the matching API', async (variant) => {
  const run = await runProvisionalEstimatorAnalysis(pair, file(), variant, await plan(), new AbortController().signal);
  expect(run).toMatchObject(PROVISIONAL_PROVENANCE); expect(run.frames.map((f) => f.tMs)).toEqual(times); expect(run.sequence).toEqual((await plan()).sequence);
  expect(createEstimator).toHaveBeenCalledExactlyOnceWith(variant);
  const api = variant === 'FULL_IMAGE' ? model.detect : model.detectForVideo;
  expect(api).toHaveBeenCalledTimes(3); expect(variant === 'FULL_IMAGE' ? model.detectForVideo : model.detect).not.toHaveBeenCalled();
  if (variant !== 'FULL_IMAGE') expect(api.mock.calls.map((c) => c[1])).toEqual(times);
  expect(close).toHaveBeenCalledTimes(3); expect(model.close).toHaveBeenCalledOnce(); frames.forEach((f) => expect(f.close).toHaveBeenCalledOnce());
  expect(requestAnimationFrame).not.toHaveBeenCalled();
});
it('reuses a fully verified control cache without creating a model or decoding', async () => {
  const run = await runProvisionalEstimatorAnalysis(pair, file(), 'FULL_VIDEO_CONTROL', await plan(), new AbortController().signal, () => {}, await cache());
  expect(run.cacheReuse.reused).toBe(true); expect(createEstimator).not.toHaveBeenCalled(); expect(decodeWebMFrames).not.toHaveBeenCalled();
});
it.each(['hash', 'variant', 'model', 'mode', 'delegate', 'confidence', 'timestampHash', 'count', 'timestamps', 'rawFrameMissing'] as const)('rejects cache %s mismatch', async (key) => {
  const c = await cache();
  if (key === 'hash') c.mediaId = 'other';
  if (key === 'variant') c.config.variant = 'FULL_IMAGE';
  if (key === 'model') c.config.options.baseOptions.modelAssetPath = 'other-model';
  if (key === 'mode') c.config.options.runningMode = 'IMAGE';
  if (key === 'delegate') Object.assign(c.config.options.baseOptions, { delegate: 'CPU' });
  if (key === 'confidence') Object.assign(c.config.options, { minTrackingConfidence: .6 });
  if (key === 'timestampHash') c.sequence.timestampHash = 'wrong';
  if (key === 'count') c.sequence.decodedFrameCount++;
  if (key === 'timestamps') c.frames[1].tMs++;
  if (key === 'rawFrameMissing') c.frames.pop();
  expect((await validateFullVideoCache(c, pair.webmSha256, await plan())).valid).toBe(false);
});
it('re-infers the control when cache identity fails and records the reason', async () => {
  const c = await cache(); c.mediaId = 'wrong';
  const run = await runProvisionalEstimatorAnalysis(pair, file(), 'FULL_VIDEO_CONTROL', await plan(), new AbortController().signal, () => {}, c);
  expect(run.cacheReuse).toEqual({ reused: false, rejection: 'WebM SHA-256 mismatch.' }); expect(model.detectForVideo).toHaveBeenCalledTimes(3);
});
it.each(['missing', 'extra', 'changed'] as const)('refuses %s decoded frames with INVALID_FRAME_SEQUENCE', async (kind) => {
  if (kind === 'missing') frames.pop();
  if (kind === 'extra') frames.push({ ...frames[0], timestamp: .1 });
  if (kind === 'changed') frames[0] = { ...frames[0], timestamp: .001 };
  await expect(runProvisionalEstimatorAnalysis(pair, file(), 'FULL_IMAGE', await plan(), new AbortController().signal)).rejects.toThrow('INVALID_FRAME_SEQUENCE');
  expect(model.close).toHaveBeenCalledOnce();
});
it('snapshots primitive landmarks before result.close', async () => {
  const raw = motionFrame(0).landmarks;
  model.detect.mockReturnValueOnce({ landmarks: [raw], worldLandmarks: [], close: () => { raw[0].x = 999; } });
  const run = await runProvisionalEstimatorAnalysis(pair, file(), 'FULL_IMAGE', await plan(), new AbortController().signal);
  expect(run.frames[0].landmarks[0].x).toBe(.5);
});
it.each(['cancel', 'inference', 'decode'])('closes all owned resources on %s', async (kind) => {
  const c = new AbortController();
  if (kind === 'cancel') model.detect.mockImplementationOnce(() => { c.abort(); return { landmarks: [], worldLandmarks: [], close }; });
  if (kind === 'inference') model.detect.mockImplementationOnce(() => { throw new Error('inference'); });
  if (kind === 'decode') vi.mocked(decodeWebMFrames).mockImplementation(async function* () { try { yield frames[0]; throw new Error('decode'); } finally { iteratorClose(); } });
  await expect(runProvisionalEstimatorAnalysis(pair, file(), 'FULL_IMAGE', await plan(), c.signal)).rejects.toThrow();
  expect(model.close).toHaveBeenCalledOnce(); expect(frames[0].close).toHaveBeenCalledOnce(); expect(iteratorClose).toHaveBeenCalledOnce();
});

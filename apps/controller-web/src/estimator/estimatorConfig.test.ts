import { beforeEach, expect, it, vi } from 'vitest';
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { createEstimator, ESTIMATOR_VARIANTS, estimatorConfig } from './estimatorConfig';
import { VISION_WASM_URL } from '../pose/poseConstants';
vi.mock('@mediapipe/tasks-vision', () => ({ FilesetResolver: { forVisionTasks: vi.fn() }, PoseLandmarker: { createFromOptions: vi.fn() } }));
beforeEach(() => { vi.clearAllMocks(); vi.mocked(FilesetResolver.forVisionTasks).mockResolvedValue({ wasmLoaderPath: 'loader', wasmBinaryPath: 'wasm' }); });
it.each(ESTIMATOR_VARIANTS)('initializes exact experiment options for %s', async (variant) => {
  await createEstimator(variant);
  expect(FilesetResolver.forVisionTasks).toHaveBeenCalledWith(VISION_WASM_URL);
  expect(PoseLandmarker.createFromOptions).toHaveBeenCalledExactlyOnceWith({ wasmLoaderPath: 'loader', wasmBinaryPath: 'wasm' }, estimatorConfig(variant).options);
});
it('keeps GPU failure explicit and does not introduce CPU fallback', async () => {
  vi.mocked(PoseLandmarker.createFromOptions).mockRejectedValueOnce(new Error('GPU unavailable'));
  await expect(createEstimator('HEAVY_VIDEO')).rejects.toThrow('GPU unavailable');
  expect(PoseLandmarker.createFromOptions).toHaveBeenCalledOnce();
});

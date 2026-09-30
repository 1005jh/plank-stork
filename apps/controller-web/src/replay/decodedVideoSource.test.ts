import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeWebMFrames, type DecodedVideoFrame } from './decodedVideoSource';

const mock = vi.hoisted(() => ({ dispose: vi.fn(), track: vi.fn(), canDecode: vi.fn(), samples: vi.fn(), inputs: [] as unknown[], sources: [] as unknown[] }));
vi.mock('mediabunny', () => ({
  WEBM: 'WEBM',
  BlobSource: class { constructor(file: File) { mock.sources.push(file); } },
  Input: class { constructor(options: unknown) { mock.inputs.push(options); } getPrimaryVideoTrack = mock.track; dispose = mock.dispose; },
  VideoSampleSink: class { samples = mock.samples; },
}));
const frame = (): DecodedVideoFrame => ({ timestamp: 0, displayWidth: 1280, displayHeight: 720, close: vi.fn(), draw: vi.fn() });
beforeEach(() => {
  vi.clearAllMocks(); mock.inputs.length = 0; mock.sources.length = 0;
  vi.stubGlobal('VideoDecoder', class {});
  mock.track.mockResolvedValue({ canDecode: mock.canDecode }); mock.canDecode.mockResolvedValue(true);
});
afterEach(() => vi.unstubAllGlobals());
describe('local WebM decoder adapter and cancellation', () => {
  it('uses BlobSource/WebM only and yields every sample in order while respecting slow consumption', async () => {
    const values = [0, 33, 66].map((ms) => ({ ...frame(), timestamp: ms / 1000 }));
    const returned = vi.fn(); let consumed = 0;
    mock.samples.mockImplementation(async function* () {
      try { for (let index = 0; index < values.length; index++) { expect(consumed).toBe(index); yield values[index]; } }
      finally { returned(); }
    });
    const file = new File(['webm'], 'local.webm'), signal = new AbortController().signal;
    for await (const sample of decodeWebMFrames(file, signal)) { expect(sample).toBe(values[consumed]); consumed++; sample.close(); }
    expect(consumed).toBe(3); expect(returned).toHaveBeenCalledOnce(); expect(mock.dispose).toHaveBeenCalledOnce();
    expect(mock.sources).toEqual([file]); expect(mock.inputs[0]).toMatchObject({ formats: ['WEBM'] });
  });
  it('releases a pending decoder next() on cancel and removes the abort listener', async () => {
    const controller = new AbortController(), remove = vi.spyOn(controller.signal, 'removeEventListener');
    let unblock!: (value: IteratorResult<DecodedVideoFrame>) => void;
    const returned = vi.fn(async () => { unblock({ done: true, value: undefined }); return { done: true, value: undefined }; });
    const next = vi.fn(() => new Promise<IteratorResult<DecodedVideoFrame>>((resolve) => { unblock = resolve; }));
    mock.samples.mockReturnValue({ next, return: returned });
    const iterator = decodeWebMFrames(new File([], 'local.webm'), controller.signal);
    const pending = iterator.next(), rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(next).toHaveBeenCalledOnce());
    controller.abort(); await rejected;
    expect(returned).toHaveBeenCalled(); expect(mock.dispose).toHaveBeenCalled();
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  });
  it('closes the input and iterator if the downstream consumer fails', async () => {
    const returned = vi.fn(), sample = frame();
    mock.samples.mockImplementation(async function* () { try { yield sample; } finally { returned(); } });
    await expect((async () => {
      for await (const value of decodeWebMFrames(new File([], 'local.webm'), new AbortController().signal)) {
        try { throw new Error('Pose failed'); } finally { value.close(); }
      }
    })()).rejects.toThrow('Pose failed');
    expect(sample.close).toHaveBeenCalledOnce(); expect(returned).toHaveBeenCalledOnce(); expect(mock.dispose).toHaveBeenCalledOnce();
  });
  it('does not start decoder work when cancellation occurs during track initialization', async () => {
    const controller = new AbortController();
    mock.track.mockImplementation(async () => { controller.abort(); return { canDecode: mock.canDecode }; });
    await expect(decodeWebMFrames(new File([], 'local.webm'), controller.signal).next()).rejects.toMatchObject({ name: 'AbortError' });
    expect(mock.samples).not.toHaveBeenCalled(); expect(mock.dispose).toHaveBeenCalled();
  });
  it.each(['unsupported', 'no-track', 'codec', 'demux'] as const)('reports %s without falling back to natural playback', async (kind) => {
    if (kind === 'unsupported') vi.stubGlobal('VideoDecoder', undefined);
    if (kind === 'no-track') mock.track.mockResolvedValue(null);
    if (kind === 'codec') mock.canDecode.mockResolvedValue(false);
    if (kind === 'demux') mock.track.mockRejectedValue(new Error('Malformed WebM'));
    await expect(decodeWebMFrames(new File([], 'local.webm'), new AbortController().signal).next()).rejects.toHaveProperty('message');
    expect(mock.samples).not.toHaveBeenCalled();
    if (kind !== 'unsupported') expect(mock.dispose).toHaveBeenCalledOnce();
  });
});

import type { VideoSample } from 'mediabunny';

export type DecodedVideoFrame = Pick<VideoSample, 'timestamp' | 'displayWidth' | 'displayHeight' | 'draw' | 'close'>;
export const replayAborted = () => new DOMException('Replay cancelled', 'AbortError');

/** Local WebM only. The bounded decoder queue applies backpressure; it never follows a playback clock. */
export async function* decodeWebMFrames(file: File, signal: AbortSignal): AsyncGenerator<DecodedVideoFrame> {
  if (signal.aborted) throw replayAborted();
  if (typeof VideoDecoder === 'undefined') throw new Error('프레임 단위 Replay에는 WebCodecs VideoDecoder가 필요합니다. localhost/HTTPS의 최신 Chrome을 사용하세요.');
  // Keep demux/decoder code out of the live camera's initial bundle.
  const { Input, BlobSource, WEBM, VideoSampleSink } = await import('mediabunny');
  if (signal.aborted) throw replayAborted();
  const input = new Input({ source: new BlobSource(file), formats: [WEBM] });
  let iterator: AsyncGenerator<VideoSample, void, unknown> | null = null;
  const cancel = () => {
    input.dispose();
    // Wake a pending next() as well as releasing prefetched samples on cancellation.
    void iterator?.return().catch(() => {});
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (signal.aborted) throw replayAborted();
    if (!track || !await track.canDecode()) throw new Error('이 WebM의 video track을 디코딩할 수 없습니다. 지원되는 Chrome/codec으로 실행하세요.');
    if (signal.aborted) throw replayAborted();
    iterator = new VideoSampleSink(track).samples();
    while (true) {
      const next = await iterator.next();
      if (next.done) break;
      if (signal.aborted) { next.value.close(); throw replayAborted(); }
      // Ownership passes to the consumer, which must close each sample in finally.
      yield next.value;
    }
    if (signal.aborted) throw replayAborted();
  } catch (cause) {
    if (signal.aborted) throw replayAborted();
    throw cause;
  } finally {
    signal.removeEventListener('abort', cancel);
    input.dispose();
    await iterator?.return();
  }
}

import type { FrameTimestampStats, VideoReplayDiagnostics } from '../replay/videoReplayMetrics';
const ms = (value: number | null) => value === null ? '-' : value.toFixed(3);
function TimingRow({ name, stats }: { name: string; stats: FrameTimestampStats }) {
  return <tr><th>{name}</th><td>{stats.frameCount}</td><td>{ms(stats.firstMediaTimestampMs)}</td><td>{ms(stats.lastMediaTimestampMs)}</td>
    <td>{ms(stats.medianFrameIntervalMs)}</td><td>{ms(stats.maxFrameIntervalMs)}</td></tr>;
}
export function ReplayVideoDiagnostics({ diagnostics: d }: { diagnostics: VideoReplayDiagnostics }) {
  return <section aria-label="Video frame completeness">
    <h4>Video frame completeness · WebCodecs sequential</h4>
    <p>전체 · Recorded Pose Frames: {d.recordedPoseFrameCount} / Video Processed Frames: {d.videoProcessedFrameCount}</p>
    <p>Guided trial {d.guidedInterval.trialId} ({ms(d.guidedInterval.startMs)}–{ms(d.guidedInterval.endMs)}ms) · Recorded Pose Frames: {d.guidedInterval.recordedPoseFrameCount} / Video Processed Frames: {d.guidedInterval.videoProcessedFrameCount}</p>
    <p>Decoded: {d.decodedFrameCount} · Processed: {d.processedFrameCount} · Duplicate timestamps: {d.duplicateMediaTimestampCount} · Skipped: {d.skippedFrameCount} (역행 {d.outOfOrderMediaTimestampCount}, 잘못된 timestamp {d.invalidMediaTimestampCount})</p>
    <p>Expected approximate frames: {d.expectedApproxFrameCount ?? '-'} (capture duration × nominal FPS 추정값). Live inference 수와 source video frame 수는 같다고 가정하지 않습니다.</p>
    <div className="signal-table-scroll"><table className="visibility-table"><thead><tr>
      <th>Timeline</th><th>Frames</th><th>First ms</th><th>Last ms</th><th>Median interval ms</th><th>Max interval ms</th>
    </tr></thead><tbody>
      <TimingRow name="전체 recorded" stats={d.recordedTimestamps} /><TimingRow name="전체 video" stats={d} />
      <TimingRow name="Guided recorded" stats={d.guidedInterval.recordedTimestamps} /><TimingRow name="Guided video" stats={d.guidedInterval.videoTimestamps} />
    </tbody></table></div>
    <p>Skipped는 전달된 decoded frame 중 유효하지 않거나 역행하는 시각 때문에 제외한 수입니다. Duplicate와 별도 집계하며, 원본 촬영/인코딩 단계의 누락 수를 추정하지 않습니다.</p>
  </section>;
}

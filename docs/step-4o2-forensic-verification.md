# STEP 4O.2 — Pose-Trace Forensic Verification

## 실행 및 사전 등록

2026-10-08 실행. Node24.18.0 / pnpm12.4.2 / Chrome154 / WebCodecs / ANGLE Metal Apple M1 GPU. `@mediapipe/tasks-vision`1.0.1과 version1 Full model, VIDEO, GPU, numPoses1, confidence .5/.5/.5, segmentation false. Production URL/options를 읽되 별도 모델 instance만 생성했습니다.

사전 등록 시각: **2026-10-08T12:48:46.870Z**. 결과 경로: Desktop `plank-stork-shadow-analysis/step-4o2/`. `preregistration.json`에 코드/원본 SHA-256, 판정 규칙, stage/anchor, 6개 전체 packet PTS를 고정했습니다. 현재 hash는 이번 실험 파일/코드를 묶는 용도이며 과거 capture와의 암호학적 동일성을 증명하지 않습니다.

최초 harness 실행은 Vite HTML fallback 때문에 WebM 대신 HTML을 받아 decode 전에 실패했습니다. `detectForVideo` 호출/처리 프레임은 0개였으며 해당 진단을 `*.pre-inference-failure.json`에 보존했습니다. 경로 우선순위와 브라우저 수신 파일 SHA 검사를 수정한 뒤 실행했습니다. Frozen scoring/inference source는 변경하지 않았습니다.

## 고정 비교 규칙

- STEP4F mapping: `media PTS × 1000 = capture tMs`, offset0. Offset 최적화/미러링/픽셀 변환 없음.
- Recorded frame 순서대로 ±20ms 안의 가장 가까운 미사용 PTS 선택. 동률은 이른 PTS. 일대일/단조 증가, frame 재사용 없음.
- Coverage는 matched/all-recorded. Usable/matched, usable/all-recorded도 별도 제공.
- 8 joints의 finite imageXY와 visibility 기준(HIP≥.7, 나머지≥.5). 양쪽에서 유효한 joint 최소4개의 Euclidean XY error 중앙값이 frame error.
- Pearson은 axis별 paired sample≥30, 양쪽 population variance>1e-12일 때만 계산. Aggregate는 null 제외 axis 중앙값. Missing은 0으로 대체하지 않음.
- Delta는 직전 matched pair와의 raw dx/dy. 양쪽 joint가 두 frame 모두 유효하고 두 clock 모두 `0<dt<400ms`여야 함. Resampling/smoothing 없음. Joint별 vector RMSE와 dx/dy Pearson, aggregate 중앙값 제공.
- Temporal gate는 lastPTS+20ms가 필수 Guided stage/기존 anchor 끝을 포함하는지 검사. Anchor는 원본 capture/recorded evidence 범위로 제한. Duration 근접은 match 근거가 아님.
- 고정 acceptance: coverage≥.80, medianXY≤.05, p95XY≤.12, trajectory≥.90, delta≥.60 모두 필요.
- Runner-up: 다른 WebM 중 usable frame≥30, pose median/trajectory median이 있는 후보를 pose median 오름차순→trajectory 내림차순→content hash로 정렬. 시간 길이가 부족한 대안도 보수적으로 포함.
- 정확히1개 threshold pass, JSON 사이 shared WebM winner 없음, winner pose median < runner-up×.5 또는 trajectory ≥ runner-up+.20 필요. Runner-up 자체가 없으면 검증 불가.
- Stage/anchor별 같은 지표와 pose/joint missing confusion, visibility error, secondary worldXYZ error를 JSON에 포함. Label과 filename은 점수/승자 결정에 사용하지 않음.

## 후속 identity 설계 (미구현)

Capture JSON에 `captureId`, `videoFilename`, `videoSha256`, `videoByteLength`, `videoLastPts/duration`, codec, width, height를 기록하고 WebM sidecar에 `captureId`와 SHA-256을 남기는 후속 설계를 권장합니다. 이번 schema/capture path는 변경하지 않았습니다.

추후 5쌍 검증을 모두 통과하면 `jsonCaptureId`, 실제 `webmPath/name`, `verification: TRACE_VERIFIED_MEDIA_MATCH`, `forensicReportId`를 포함한 analysis-only pair에 양쪽 content hash도 묶어 STEP4O experimental runner에서만 검증할 수 있습니다. 일반 upload/replay guard에는 override를 추가하지 않습니다.

## 실측 결과

Report ID: `step-4o2-47474b3d5010f1c4`. **30쌍 중 verified 0, TRACE_MISMATCH 22, TEMPORALLY_INCOMPATIBLE 8**입니다. 모든 capture가 막혔으므로 Full IMAGE/Heavy는 실행하지 않았습니다. Pairing 기준은 변경하지 않았습니다.

파일별 decoded frame 수: 2차검증1.webm 954, 3차검증.webm 1,729, 4gi replay webm.webm 1,695, 4j result webm.webm 1,387, 4k.2a webm.webm 1,505, clean인가.webm 1,248. 총 **8,518**프레임이며 모든 PTS가 사전 packet 목록과 일치합니다.

아래는 **accepted winner가 아닌 유사도 1위 후보**와 runner-up입니다. 1위 후보의 이름은 결과가 나온 후에만 기존 예상 mapping과 비교했으며 5/5 일치했습니다.

| JSON | 1위 후보 | Runner-up | matched / usable | Coverage | Median / p95 XY | Trajectory r | Delta r |
|---|---|---|---:|---:|---:|---:|---:|
| STRESS | 3차검증.webm | clean인가.webm | 1713 / 1051 | 99.02% | 0.01436 / 0.12294 | 0.89226 | 0.12416 |
| OLD CLEAN | clean인가.webm | 4gi replay webm.webm | 1242 / 859 | 99.52% | 0.05326 / 0.20281 | 0.40288 | 0.01335 |
| LIVE1 | 4gi replay webm.webm | 4k.2a webm.webm | 1673 / 1028 | 98.82% | 0.02133 / 0.13441 | 0.70347 | 0.11195 |
| LIVE2 | 4j result webm.webm | 4k.2a webm.webm | 1331 / 1117 | 95.96% | 0.02024 / 0.20086 | 0.71536 | 0.02297 |
| LIVE3 | 4k.2a webm.webm | 4gi replay webm.webm | 1500 / 1053 | 99.87% | 0.04626 / 0.23223 | 0.65984 | 0.06606 |

모든 1위 후보가 p95≤.12, trajectory≥.90, delta≥.60을 충족하지 못했습니다. OLD CLEAN은 median≤.05도 미달했습니다. 따라서 JSON별 thresholdPassingCount=0이고 유일한 verified winner는 없습니다. 단순 분리 수식은 1위/runner-up에서 5/5 충족하지만 acceptance 실패를 덮어쓰지 않습니다. 이 결과는 요청된 forensic 규칙으로 identity를 검증하지 못했다는 뜻이며, 영상이 반드시 다른 capture라고 확정하는 뜻은 아닙니다.

`2차검증1.webm`은 다섯 조합 모두 포함했습니다. STRESS/LIVE1/LIVE2/LIVE3는 TEMPORALLY_INCOMPATIBLE, OLD CLEAN은 TRACE_MISMATCH입니다. 상태는 **UNMATCHED_MEDIA**, 실제 capture identity는 미확인이며 파일은 보존했습니다. Verified pairing이 없으므로 이번 결과상 나머지5개도 unmatched입니다.

### 30-pair matrix

M = TRACE_MISMATCH, T = TEMPORALLY_INCOMPATIBLE. 세부 지표는 [compact JSON](step-4o2-forensic-summary.json), per-joint/window/full metrics는 Desktop의 `forensic-report.json`에 있습니다.

| JSON | 2차검증1.webm | 3차검증.webm | 4gi replay webm.webm | 4j result webm.webm | 4k.2a webm.webm | clean인가.webm |
|---|---|---|---|---|---|---|
| STRESS | T | M | M | T | M | T |
| OLD CLEAN | M | M | M | M | M | M |
| LIVE1 | T | M | M | T | M | T |
| LIVE2 | T | M | M | M | M | M |
| LIVE3 | T | M | M | M | M | M |

## 검증

원본 JSON5개/WebM6개의 SHA-256이 사전 등록과 그대로 일치합니다. Production pose/camera/live/replay/remote/mobile/server/protocol은 HEAD 대비 변경이 없습니다. 기존 uncommitted STEP4O UI와 analysis export 변경은 유지했습니다. STEP4K.1/4K.2/4L/4M436/4N24의 원본 보고서를 재생성해 JSON 값 전체 일치를 확인했습니다. Commit/push 없음.

- `pnpm typecheck`: PASS.
- `pnpm build`: PASS. 기존 controller chunk 821.62kB의 500kB 초과 경고는 남음. Forensic CLI는 production bundle에 import하지 않음.
- `pnpm --filter @plank-stork/controller-web test`: **77 files / 830 tests PASS** (기존801 + forensic29). GPU 추론과 동시 실행했던 첫 전체 테스트는 시간 초과가 발생해 중단했으며, 추론/Chrome 종료 후 같은 명령을 단독으로 실행해 모두 통과. Timeout을 늘리거나 기존 테스트를 변경하지 않음.
- `git diff --check`: PASS.
- `regression.json`: 기존 4K.1/4K.2/4L/4M436/4N24 보고서 모두 동일.

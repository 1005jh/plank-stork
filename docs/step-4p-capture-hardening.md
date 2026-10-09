# STEP 4P — Capture Integrity + Estimator Neutral Readiness

이번 단계는 capture와 분석 입력의 품질을 보강한다. 실제 운동, 새 capture, 새 Full IMAGE/Heavy 추론을 수행하지 않았다. Estimator 우열이나 detector 성능에 대한 새 실험 결과는 없다.

## V1과 V2

V1의 filename + captureId guard는 파일 이름이 바뀌면 대응을 잃고, 같은 이름의 다른 bytes를 식별할 수 없다. 과거 결과를 재해석하거나 migration하지 않고 새 capture만 `version: 2`로 저장한다.

- V1: `EXISTING_FILENAME_CAPTURE_ID_GUARD`. 기존 filename/captureId mismatch 차단, LANDMARK/VIDEO replay 및 1초 Neutral reconstruction 유지.
- V2: `video.integrity`, `attemptId`, `validation`, 각 trial의 `estimatorNeutralReference` 및 `validationStatus` 추가. Optional fields 방식이지만 reader는 V2 필드를 필수 검증한다.
- `attemptId = captureId`. 모든 실제 attempt와 실패를 보존한다. 결과가 좋은 capture만 골라 남기지 않는다.
- 과거 `PROVISIONAL_MEDIA_PAIR`는 별도 analysis-only 경로 그대로다. V2 cryptographic pair와 합치지 않는다. 기존 preregistration/source hash ledger도 수정하지 않는다.

## 정확한 WebM artifact

`RECORDING → STOPPING → WEBM_READY → HASHING → MEDIA_INSPECTION → ARTIFACT_READY` 순서이며 오류·취소는 `ARTIFACT_FAILED`다. `stop()`은 최종 dataavailable과 inspection이 끝난 뒤 resolve한다. Live inference/detector를 멈추지 않고 capture 종료 후 비동기로 진행한다.

`video.integrity`:

```ts
{
  algorithm: 'SHA-256',
  sha256, byteLength,
  decodedFrameCount, firstPtsMs, lastPtsMs, timestampHash,
  decodedWidth, decodedHeight,
  finalizedAt
}
```

SHA는 최종 다운로드되는 동일 Blob의 전체 bytes를 Web Crypto로 계산한 lowercase 64자리 hex다. Hash 이후 remux/변환을 하지 않는다. `byteLength`는 해당 Blob.size다. JSON은 integrity 저장 후에만 생성하며 두 다운로드 버튼 모두 `ARTIFACT_READY` 전에는 잠긴다. 실패 시 raw recovery 다운로드는 제공하지 않는다.

기존 `decodeWebMFrames`로 모든 frame을 검사한다. PTS는 seconds × 1000의 milliseconds이며 음수·비정상·중복·역순은 실패한다. 생략하지 않는다. Timestamp hash는 기존 estimator `frameSequence`와 같은 UTF-8 `JSON.stringify(number[])`의 SHA-256이다. 모든 frame의 display dimensions가 동일하고 녹화 당시 camera width/height와 같아야 한다. 모든 yielded frame은 성공/실패/취소 시 `finally`에서 close한다. AbortSignal과 기존 decoder cleanup을 사용한다. Unmount 시 finalization을 취소하며 완료 callback에서 React state를 갱신하지 않는다.

공통 `validateReplayMediaArtifact`를 Replay VIDEO와 estimator가 사용한다. V2는 size → 실제 bytes SHA → decoded manifest 순서로 검사한다. 같은 bytes라면 filename 변경을 허용하고 `CRYPTOGRAPHIC_MEDIA_MATCH`, `renamed: true`를 표시한다. 같은 이름이라도 다른 bytes는 `MEDIA_HASH_MISMATCH`, 크기 차이는 `MEDIA_SIZE_MISMATCH`로 거부한다. PTS/dimension 차이도 거부한다. 실제 inference pass의 PTS/dimension도 재검사한다.

Cache는 한 분석 session의 동일 File 객체에 한정한다. 선택이 바뀌면 버리며 size/lastModified 기반의 persistent trust는 없다. 세 variant에서 같은 파일을 재사용할 때 전체 bytes SHA를 반복 계산하지 않는다.

## 별도 3초 estimator Neutral reference

Production `PoseFeatureAnalysis`의 `CALIBRATION_WINDOW_MS = 1000`, knee grace 및 FROZEN 시점은 그대로다. 이를 늘리면 live detector의 기존 동작이 바뀌므로 별도 capture observer가 이미 받은 FRAME으로 품질을 측정한다. 추가 inference와 매 frame React render는 없다.

시작점은 capture 중 최신 `NEUTRAL_CALIBRATION_START`다. 최근 3000ms만 보관하고 다음을 모두 만족해야 READY다.

1. Production Neutral `collectionState === FROZEN`.
2. 최신 Neutral 시작부터 3000ms 이상 경과.
3. 최근 window에 8개 joint 모두 usable인 frame 60개 이상.
4. 각 joint의 usable count도 60개 이상.

| Joint | Index | Image / 존재하는 world visibility |
| --- | --- | --- |
| LEFT / RIGHT SHOULDER | 11 / 12 | ≥ .5 |
| LEFT / RIGHT HIP | 23 / 24 | ≥ .7 |
| LEFT / RIGHT KNEE | 25 / 26 | ≥ .5 |
| LEFT / RIGHT ANKLE | 27 / 28 | ≥ .5 |

Image XY와 world XYZ는 finite여야 한다. Image visibility는 필수이며 world visibility가 제공되면 같은 threshold를 적용한다. 누락을 0으로 바꾸지 않는다. Preview Mirror와 무관하다.

첫 READY 시 `[readyAtMs - 3000, readyAtMs]` 양 끝을 포함하는 범위를 freeze한다. protocolId, calibrationStartMs, readyAtMs, durationMs, analysisReadyFrameCount, perJointUsableFrames, poseFrameCount, thresholds를 기록한다. 이후 count가 변해도 reference는 움직이지 않는다. 새 Neutral 시작 시 pending reference/count를 초기화한다. Trial START에 reference를 deep copy하고 소비하므로 다음 trial에는 새 Neutral 보정이 필요하다. 이미 시작된 trial의 사본은 변경하지 않는다.

Capture panel은 artifact state, reference NOT_STARTED/COLLECTING/READY, rolling counts, 현재 missing joint, Neutral 유지 안내를 표시한다. Production FROZEN 이후에도 estimator reference가 READY가 될 때까지 Neutral을 유지한다.

## Guided 시작과 분석

Capture RECORDING 중에만 실제 `PoseCamera.startDetectorTest()`에서 production 준비 상태와 estimator reference를 모두 검사한다. Desktop 버튼과 기존 mobile/remote 요청은 같은 함수로 진입한다. Capture가 꺼져 있으면 기존 시작 조건 그대로다. Mobile protocol/UI는 변경하지 않는다.

시작 후 pose/joint loss로 22초 Guided timeline을 pause/stop/연장하지 않는다. Reference 없는 START가 방어 경로로 들어오면 `INVALID_MISSING_ESTIMATOR_REFERENCE` marker/trial status를 남기고 capture를 INCOMPLETE로 만든다. 이미 시작된 live Guided는 중단하지 않는다.

V2 estimator는 세 variant 모두 trial에 복사된 정확한 3초 범위를 사용한다. 수치 baseline은 각 variant의 자기 landmarks로 재구성한다. Y, geometry, fixed flexion 및 segment baseline에 동일 범위를 넘긴다. Report에는 `neutralFrameCount`, `leftUsableSamples`, `rightUsableSamples`, `bodyScale`, `baselineStatus`를 기록한다. 양쪽 중 usable sample이 20개 미만이면 `INSUFFICIENT_VARIANT_NEUTRAL`이며 다른 variant나 저장된 production baseline으로 대체하지 않는다.

V1 `neutralCalibrationWindow()`의 구현과 기존 1000ms semantics는 변경하지 않았다. Analysis helper의 명시적 optional window는 V2 estimator에서만 전달한다. 기존 LANDMARK replay는 저장된 live baseline과 oracle을 그대로 사용한다.

## Capture quality와 실험 결과 구분

V2 validation metadata의 protocolId와 네 boolean을 기록한다:
`mediaIntegrityReady`, `estimatorReferenceReady`, `trialHasEstimatorReference`, `guidedTrialCompleted`.
모두 true이고 invalid reason이 없을 때만 `VALIDATION_CAPTURE_COMPLETE`, 나머지는 `INCOMPLETE`다. 이는 과학적 가설 PASS가 아닌 artifact 품질 상태다. Estimator 비교는 incomplete capture를 거부한다. 완성된 WebM의 incomplete JSON은 보존/일반 replay/debug를 위해 다운로드할 수 있다.

- `INVALID_CAPTURE`: hash/finalization 실패, frame sequence 손상/variant 간 불일치, reference 누락, Guided 미완료. Estimator 가설 평가에 넣지 않는다.
- `VALID_MEDIA_BUT_INSUFFICIENT_VARIANT_NEUTRAL`: media는 정확하나 variant baseline이 부족하다. Report의 `INSUFFICIENT_VARIANT_NEUTRAL`로 별도 식별한다.
- 충분한 variant baseline에서 false/miss 발생: 유효한 capture의 실험 결과로 남긴다. 좋은 결과가 나올 때까지 다시 찍는 방식으로 지우지 않는다.

## 다음 capture의 사전 고정 절차

`capture/estimatorValidationProtocol.ts`의 `ESTIMATOR_VALIDATION_PROTOCOL_V1`에 `STEP_4P_ESTIMATOR_HOLDOUT_V1`, 3000ms/60 frames, 8 joints/visibility, `FULL_VIDEO_CONTROL / FULL_IMAGE / HEAVY_VIDEO`, `PRODUCTION_Y_V3 / FIXED_REFERENCE`, `thresholdTuningAllowed: false`를 고정했다. 이번 작업에서는 commit하지 않았고 실제 attempt도 없다. 실제 capture 전에 이 protocol 코드를 commit할 예정이다.

기존 발 쪽에서 머리를 바라보는 배치(책상 높이, 몸 전체 frame)를 유지한다. 새 angle 탐색은 하지 않는다.

1. Start Camera.
2. Start Replay Capture.
3. Calibrate Neutral.
4. Estimator Neutral reference READY까지 Neutral 유지.
5. Guided Test 정확히 1회.
6. Stop Capture.
7. ARTIFACT_READY 확인.
8. WebM과 JSON 둘 다 저장.

이 한 capture가 첫 candidate dataset이며 실패를 포함한 모든 attempt를 기록한다. 결과를 본 뒤 threshold를 조정하지 않는다.

## 검증

Synthetic MediaRecorder/decoded-frame fixture와 실제 SHA-256 계산으로 media identity, PTS, dimension, stop 지연/취소, exact Blob, readiness 경계·expiry·reset, desktop/remote gate, 22초 pose-loss 진행, V2 baseline/reader 및 V1 호환성을 검사한다. 과거 encoder fixture는 가짜 WebM이므로 테스트용 finalizer를 주입하고, 과거 analysis fixture의 V1 schema/1초 timeline은 유지했다.

저장된 로컬 V1 입력/추론 cache만 재계산하여 JSON deep equality를 확인했다: 4K.1, 4K.2 holdout, 4L, 4M 436 configs, 4N 24 quality gates, 4O.2 forensic matrix, 4O.3 15개 cached run 기반 전체 sensitivity report가 모두 일치했다. 새 model 추론이나 media capture는 없었다. 원본 ledger/report/cache는 수정하지 않았다.

검증 결과:

- `pnpm typecheck`: workspace 전체 성공.
- `pnpm build`: workspace 전체 성공. 기존 500kB bundle warning만 발생.
- `pnpm --filter @plank-stork/controller-web test`: 923개 성공, 기존 4L 분석 테스트 1개가 기본 병렬 실행에서 5000ms timeout.
- `pnpm --filter @plank-stork/controller-web test --maxWorkers=2`: **84 files / 924 tests 모두 성공** (기존 871개 유지 + 신규 53개). Assertion이나 timeout을 완화하지 않고 worker 수만 줄였다.
- `git diff --check`: 성공.

Production detector/pose 설정, mobile/server/shared protocol 파일은 변경하지 않았다. Commit/push는 수행하지 않았다.

## STEP 4P.1 — Default test concurrency stabilization

대상: `src/discovery/analyzeTwistConfusion.test.ts`의 `post-failure exploratory reporting > requires all five roles and can report EXPLORATORY_VIABLE only when stage recall/false regressions pass`.

수정 전 테스트에 임시 계측을 넣어 `performance.now()` wall time과 `process.cpuUsage()`를 측정했다. 계측 코드는 최종 파일에서 제거했다.

| 구간 | 단독 실행 | 전체 기본 병렬 실행 |
| --- | ---: | ---: |
| Synthetic captures 2개 | 214ms | 606ms |
| Twist fixtures 준비 | 276ms | 1236ms |
| Twist evidence | 68ms | 189ms |
| 기존 Integrity fixtures 준비 | 169ms | 387ms |
| 변경 전 전체 Integrity report | 475ms | 1610ms |
| 변경 후 전체 Integrity report | 391ms | 1769ms |
| 테스트 본문 전체 | 1709ms PASS | 6152ms / 5000ms timeout |

측정상 expensive fixture/report preparation(B), 전체 report 재계산(C), 병렬 CPU 경쟁(D)이 주요 원인이다. 전체 report 두 번 계산은 원래 분석 결과의 불변성을 확인하므로 제거하지 않았다. 계측 구간 합산 wall time은 1708→6146ms, process CPU time은 2362→3654ms였다(CPU time은 V8의 보조 thread를 포함하므로 wall보다 클 수 있다). 실행 전후 활성 리소스는 양쪽 모두 PipeWrap 3개와 테스트 runner Timeout 1개로 같았고 계산이 완료됐다. Async hang이나 누적 timer/cleanup leak의 증거는 없었다.

수정은 테스트 파일에 한정한다. 다섯 role의 입력, prepared fixtures/evidence와 비교 기준 전체 report를 해당 case의 `five-role regression` describe 내부 `beforeAll`에서 한 번 준비한다. 앞선 두 테스트의 실행 순서를 유지하고 이 준비 hook을 다른 case에 적용하지 않는다. 해당 fixture는 이 테스트 하나만 사용하며 다른 테스트는 기존처럼 독립 입력을 만든다. 비교 기준을 4L 분석 전에 확정하고 테스트 본문에서 전체 report를 다시 계산한다. 기존 assertion 문장, 설정 grid, production/replay 비교 및 결정성 검증을 그대로 유지했다. 단독 4L 파일 실행에서 5개 테스트가 통과했고 최종 범위에서 해당 본문은 942ms였다. 이 변경은 준비 비용을 별도 lifecycle로 분리하며 전체 분석을 생략하지 않는다.

Timeout(전역/파일/개별)과 maxWorkers, package script는 변경하지 않았다. 테스트 삭제/skip도 없다. 저장된 실제 4L 보고서를 현재 코드로 재계산한 전체 JSON이 기존 파일과 같고 `exploratoryViableConfigs == []`도 확인했다. STEP4P 및 production 코드는 변경하지 않았다.

첫 기본 전체 실행은 924 PASS였다. 다음 실행 중에는 수정 대상 4L은 통과했으나, 시스템 8 logical cores / load average 22.78 상태에서 다른 기존 테스트 6개 파일에 timeout/후속 실패 10개가 발생했다. 이 실행을 연속 성공으로 세지 않았으며, 같은 기본 명령으로 연속 검증을 다시 시작했다. 사용자 프로세스를 중단하거나 concurrency/timeout 제한을 바꾸지 않았다.

후속 측정에서 `PoseActions.test.tsx`와 `controllerRemote.test.tsx`는 동기 fake interval callback을 매 tick마다 비동기 `act`로 감싸 불필요한 비동기 작업을 반복했다. 두 테스트 파일의 `advance()` helper만 동기 `act`로 변경했다. 호출부의 await, 50ms 단위 frame/tick, React update flush, assertion 및 실제 비동기 작업의 `act`는 유지한다. 같은 세 파일(이 두 UI 파일과 수정하지 않은 holdout 파일) 40개 테스트를 수정 전후 모두 통과했다. 주요 UI case는 3053→1745ms, 1633→979ms, 1159→639ms로 감소했고, 같은 실행의 기존 holdout case도 3571→2499ms였다. Holdout 테스트 자체는 수정하지 않았다.

최종 수정 범위는 위 세 테스트 파일과 이 기록뿐이다. 작업 시작 시점의 파일 hash와 비교해 기존 STEP4P를 포함한 모든 production 파일이 그대로임을 확인했다. 세 테스트 파일의 기존 assertion 문장도 모두 유지했다.

최종 검증:

| 명령 | 결과 |
| --- | --- |
| 기본 controller test 1회차 | 84 files / 924 PASS, 34.01s |
| 기본 controller test 2회차 | 84 files / 924 PASS, 39.99s |
| 기본 controller test 3회차 | 84 files / 924 PASS, 37.86s |
| 이후 STEP4L 단독 파일 실행 | 5 PASS, 4.26s |
| 이후 `pnpm typecheck` | PASS |
| 이후 `pnpm build` | PASS, 기존 500kB bundle warning만 발생 |

세 전체 실행은 모두 `pnpm --filter @plank-stork/controller-web test`를 옵션 없이 연속 실행한 결과다. 최종 테스트는 924개이며 삭제/skip, timeout 증가, worker 제한, 설정/threshold 변경은 없다. Commit/push는 하지 않았다.

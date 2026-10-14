# STEP 4Y — Ground Truth Pilot Feasibility & Minimum Tooling Design

작성일: 2026-10-15 · 검토 branch: `main` · 로컬 HEAD: `c2e721d1845b8aaba0877e64abf3d7fd784dec81`

**최종 판정: `BLOCKED_BY_UNRESOLVED_DESIGN`.** WebM 무결성 검증과 LIVE 관측 기능은 재사용할 수 있다. 그러나 Controller monotonic clock과 실제 저장 영상 PTS 사이의 독립적인 anchor 및 오차 상한을 확보하는 방법이 아직 검증 가능한 수준으로 확정되지 않았다. 정답 영상의 가시성, 스마트폰 역할 분리, 독립 annotator 확보도 미확인 의존성이다. 전체 Pilot pipeline의 구현·촬영 준비가 끝났다는 판정은 하지 않는다.

이 문서는 **조사와 설계만** 수행한 결과다. 아래 새 파일·타입·로그·화면·시험은 후속 구현 제안이며 현재 기능이 아니다. [4X plan](step-4x-recognition-validation-plan.md)과 [4X GT guide](step-4x-ground-truth-guide.md)가 primary requirements다. 두 문서의 상태는 **`PROPOSED / 사용자 미승인 / NOT REGISTERED`** 그대로다. 사용자 검토·승인 전에는 다음 구현이나 실험으로 진행하지 않는다.

## 1. Executive Summary — 지금 준비된 것과 부족한 것

| 질문 | 현재 답과 근거 수준 |
| --- | --- |
| 기존 capture를 재사용할 수 있는가? | **부분적으로 가능, source 확인.** 원본 camera stream 녹화, 최종 Blob SHA-256, 전체 decoded PTS 검사, raw pose snapshot, production baseline 저장을 재사용한다. 독립 E, durable attempt ledger, E 전체 clock/reset/diagnostic 기록과 blind annotation은 추가 설계가 필요하다. |
| Foot-side만으로 실제 정답을 판독할 수 있는가? | **NOT_EVALUATED.** 이번 작업에서 영상을 보거나 새 촬영을 하지 않았다. 기존 landmark visibility나 Guided 성공 수는 사람이 실제 side/onset/return을 볼 수 있다는 증거가 아니다. |
| 기존 기록으로 clock 오차 ≤50ms를 입증할 수 있는가? | **입증 불가.** Capture-relative performance 시각과 native media PTS는 서로 다른 근거로 생성된다. 시작 버튼 시각을 빼서 숫자를 비슷하게 만드는 것으로 대응 frame이나 고정 지연이 입증되지 않는다. |
| 스마트폰 reference가 가능한가? | **HYPOTHESIS / 기기 조건 미확인.** 가림을 보완할 후보지만 같은 폰의 얼굴 쪽 게임·안내 화면 역할과 충돌한다. 두 영상과 Controller clock의 정렬도 필요하다. |
| 독립 주석 운영이 준비됐는가? | **NOT_EVALUATED.** 독립 인간 annotator 2명과 불일치 검토 담당 제3자의 확보 여부를 알 수 없다. 혼자 두 번 주석하는 것으로 대체할 수 없다. |
| 다음 가장 작은 작업은? | 승인 후 **private attempt ledger와 sidecar 최소 계약·검증**부터 한다. Camera/detector 없이 실패 시도를 보존할 수 있는 작은 단위다. 이것만 완료해도 촬영 허가나 sync PASS가 되지는 않는다. |

근거 수준을 구별한다. **VERIFIED(source)**는 코드를 읽어 해당 경로·조건을 확인했다는 뜻이며 이번 장비에서 실행했다는 뜻이 아니다. **OBSERVED(prior report)**는 과거 보고서의 제한된 관측이다. **HYPOTHESIS**는 확인 전 제안, **NOT_EVALUATED**는 해당 실물·운영 검증 부재다.

기존 결정은 유지한다.

- [4T](step-4t-game-input-strategy.md): TEST 게임 개발과 운동 인식 연구를 분리한다. 현재 [GameInput](../apps/controller-web/src/game/gameTypes.ts)과 [ScriptedGameInput](../apps/controller-web/src/game/scriptedGameInput.ts)의 KEYBOARD/SCRIPT TEST 입력은 실제 운동 정답이 아니다.
- [4P](step-4p-capture-hardening.md): V2 media integrity 및 별도 estimator reference는 데이터 준비 기능이다. Capture READY와 인식 정확도 PASS는 다르다.
- [4Q](step-4q-holdout-analysis.md): 단일 V2의 동일 1,988 PTS와 33,530,994 bytes 일치를 기록했다. Guided 채점은 LIVE L/R/false 1/1/0, FULL_VIDEO 0/1/1이다. FULL_IMAGE coverage 부족, HEAVY Neutral knee usable 0/0도 보존한다. 이번에 SHA나 추론을 재실행하지 않았다.
- [4R](step-4r-live-video-divergence.md): 원본 LIVE replay parity PASS 및 MIXED(input stream/sampling) 귀속은 기존 보고서 결과다. 이것은 영상–Controller의 독립 시간 동기화 PASS가 아니다.
- [4S](step-4s-recovery-shadow-feasibility.md): **NO_SAFE_CANDIDATE 유지.** 결합 shadow의 이 capture 개선은 synthetic 위험을 통과하지 못했다. 자동 니킥 인식 일반의 불가능성을 증명한 것은 아니다.

## 2. 기존 구현 Inventory — 파일·함수 기준

`EXISTS_AND_REUSABLE`은 명시한 작은 책임을 재사용할 수 있다는 뜻이다. 해당 행을 포함한 전체 Pilot이 완성됐다는 뜻은 아니다. `MISSING`은 아래 연결 경로와 source 검색에서 요청한 책임을 제공하는 구현을 찾지 못했다는 뜻이다.

| 기능 / 상태 | 실제 파일·함수·타입 | 확인한 책임과 한계 |
| --- | --- | --- |
| Raw WebM 수집 — `EXISTS_AND_REUSABLE` | [replayCapture.ts](../apps/controller-web/src/replay/replayCapture.ts): `ReplayCapture.start`, `captureMime`, `stop`, `onStop` | Camera stream을 MediaRecorder에 직접 전달한다. Canvas/미러 overlay를 녹화하지 않는다. WebM VP8 또는 WebM 지원 여부를 검사하고 최종 dataavailable/stop을 기다린다. 이 row는 녹화 primitive에 한정한다. |
| Media 동일성 — `EXISTS_AND_REUSABLE` | [mediaArtifact.ts](../apps/controller-web/src/replay/mediaArtifact.ts): `hashBlob`, `finalizeMediaArtifact`, `ReplayMediaValidationCache.validate`, `VideoIntegrity` | 최종 bytes의 SHA-256/byteLength와 decoded frame count/PTS hash/dimension을 확인한다. V2의 같은 bytes filename 변경을 허용한다. 실제 동작 정답이나 두 clock의 대응을 검사하지 않는다. |
| Native WebM PTS — `EXISTS_AND_REUSABLE` | [decodedVideoSource.ts](../apps/controller-web/src/replay/decodedVideoSource.ts): `decodeWebMFrames`; `mediaArtifact.ts`: `inspectReplayMedia` | Decoder가 반환한 timestamp seconds를 ms로 바꾼다. PTS 전체의 finite/nonnegative/strict increase 및 크기를 검증한다. WebM 외 reference 형식 지원은 별개다. |
| Inference 관측 — `EXISTS_BUT_INSUFFICIENT` | [usePoseCamera.ts](../apps/controller-web/src/camera/usePoseCamera.ts): `usePoseCamera`, `onFrame`; [replayTypes.ts](../apps/controller-web/src/replay/replayTypes.ts): `copyPoseFrame`, `ReplayPoseFrame`, `asPoseFrame` | 매 새 video.currentTime에 detectForVideo를 호출한다. 원래 PoseFrame에는 inference 시작 performance 시각과 videoTime이 있으나 ReplayPoseFrame에는 videoTime이 저장되지 않는다. `asPoseFrame`의 tMs/1000은 replay용 재구성값이지 원본 video PTS가 아니다. |
| Camera-only 준비 경로 — `EXISTS_BUT_INSUFFICIENT` | `usePoseCamera`; [PoseCamera.tsx](../apps/controller-web/src/components/PoseCamera.tsx): `PoseCamera` | 현재 Camera RUNNING은 MediaPipe 초기화와 함께 시작한다. 현재 버튼을 눌러 inference 없는 clock 사전 점검이 가능하다고 안내할 수 없다. 그런 점검 경로가 필요하면 별도 최소 도구로 승인받는다. |
| Production Neutral — `EXISTS_AND_REUSABLE` | [poseFeatureAnalysis.ts](../apps/controller-web/src/pose/features/poseFeatureAnalysis.ts): `PoseFeatureAnalysis`, `CALIBRATION_WINDOW_MS`, `KNEE_CALIBRATION_GRACE_MS`; [kneeKickAnalysis.ts](../apps/controller-web/src/pose/kick/kneeKickAnalysis.ts): `collect`, `freeze` | 기존 1초 rolling window, HIP 준비 뒤 최대 1초 knee grace, FROZEN semantics와 V3 baseline을 그대로 사용한다. 새 E 시작이나 reference 수집이 이를 재설정하면 안 된다. |
| Estimator reference — `EXISTS_AND_REUSABLE` | [estimatorValidationProtocol.ts](../apps/controller-web/src/capture/estimatorValidationProtocol.ts): `ESTIMATOR_VALIDATION_PROTOCOL_V1`; [estimatorNeutralReadiness.ts](../apps/controller-web/src/capture/estimatorNeutralReadiness.ts): `EstimatorNeutralReadiness.process`, `getView`, `takeReference` | `STEP_4P_ESTIMATOR_HOLDOUT_V1`, 3초/60 usable frames/8 joints를 검사한다. Production FROZEN과 별개 readiness다. Guide 시작 때 reference를 소비하는 기존 lifecycle을 E 시작에 차용하지 않는다. |
| Raw frames / LIVE events / baseline — `EXISTS_BUT_INSUFFICIENT` | `ReplayCapture.observe`; `ReplaySession`, `ReplayEvent`, `KickObservation` | Capture 전 구간 raw frames와 trial 밖 이벤트도 저장할 기반이 있다. Event는 id/side/tMs/trialId로 축약된다. 전체 baseline epoch 이력, event evidence epoch/source, clock domain bridge를 모두 보존하는 구조는 아니다. |
| Actual clock/reset 로그 — `EXISTS_BUT_INSUFFICIENT` | [useKneeKick.ts](../apps/controller-web/src/pose/kick/useKneeKick.ts): `useKneeKick`, `getCurrent`, `reset`; `ReplayCapture.observe` | Hook은 CLOCK/FRAME/START/RESET 및 reset reason을 관측자에게 보낸다. Capture는 **열린 Guided trial에서만 CLOCK을 저장**한다. RESET은 trial 종료에 쓰며 reason별 독립 전체 로그로 남기지 않는다. |
| 상세 진단 — `EXISTS_BUT_INSUFFICIENT` | `KneeKickAnalysis.analyzeFrame`, `getReplaySnapshot`; [kneeKickDetectorV3.ts](../apps/controller-web/src/pose/kick/kneeKickDetectorV3.ts): `getValuesForDiagnostics`, `getReplaySnapshot`; [guidedDetectorTest.ts](../apps/controller-web/src/pose/kick/guidedDetectorTest.ts): `recordDiagnosticFrame` | 기존 엔진에 Y/enter/clear/epoch/eligibility 진단이 있다. 저장 diagnostic frames는 Guided ACTIVE에 한정된다. Passive replay snapshot은 baseline/state/last event 등을 제공하지만 전체 per-side 진단은 모두 노출하지 않는다. |
| Guided / replay — `EXISTS_BUT_INSUFFICIENT` | `KneeKickAnalysis.startTest`, `resetTest`; [kneeKickV3Replay.ts](../apps/controller-web/src/replay/kneeKickV3Replay.ts): `replayKneeKickV3`, `resolveV3ReplayBaseline` | START는 V3/legacy `restartTrial()`을 실행한다. 기존 replay runner는 종료된 Guided trial과 stage 채점을 요구한다. 120초 E나 actual GT scorer로 그대로 사용하거나 가짜 trial을 만들어 넣지 않는다. |
| 다운로드 — `EXISTS_BUT_INSUFFICIENT` | [useReplayCapture.ts](../apps/controller-web/src/replay/useReplayCapture.ts): `useReplayCapture`; [useLocalDownload.ts](../apps/controller-web/src/replay/useLocalDownload.ts): `useLocalDownload`; [ReplayCapturePanel.tsx](../apps/controller-web/src/components/ReplayCapturePanel.tsx): `ReplayCapturePanel` | Local Blob/ObjectURL 다운로드 및 정리는 재사용한다. Capture는 메모리에 있고 ARTIFACT_READY 이후 파일 제공이 가능하다. 시작 실패·finalization 실패·새로고침까지 남기는 durable attempt ledger는 없다. |
| Mobile operator / Socket — `EXISTS_BUT_INSUFFICIENT` | [controller useCalibrationRemote](../apps/controller-web/src/remote/useCalibrationRemote.ts), [CalibrationRemoteController](../apps/controller-web/src/remote/calibrationRemoteController.ts): `snapshot`, `handle`; [mobile useCalibrationRemote](../apps/mobile/src/calibration/useCalibrationRemote.ts); [ControlGateway](../apps/server/src/control.gateway.ts) | 기존 상태 전달/명령 gate를 유지한다. 250ms publish, Date.now payload, mobile 로컬 수신 performance freshness는 정밀 clock sync 기록이 아니다. Ground truth용 raw 영상이나 PTS를 전송하는 경로도 아니다. |
| E marker / 실패 ledger / 독립 sync anchors — `MISSING` | `ReplayMarkerType`, `ReplaySession`, `ReplayCapture.observe` 및 capture/remote 경로 조사 | 현재 marker union에는 CAPTURE/NEUTRAL/GUIDED 등이 있고 독립 E나 clock anchor가 없다. 과거 analysis의 false-event/peak `anchor`는 sync anchor가 아니다. |
| Reference importer / blind annotation / `4X-MATCH-1` scorer — `MISSING` | `decodeWebMFrames`, `replayKneeKickV3` 및 기존 analysis 경로 조사 | 원본 PTS decoder와 순수 detector는 재사용 가능하다. 두 영상 동기 주석, 독립 인간 제출물, actual-motion matching 구현은 확인되지 않는다. 기존 Guided summary로 대신할 수 없다. |
| 실물 배치 / reference 형식 / 주석 인력 / ≤50ms 정확도 — `NOT_EVALUATED` | Source만으로 판단할 수 없는 운영 조건 | 폰 모델·사용 가능 카메라·파일 형식·거치 공간·보조 인력은 미확인이다. 영상 판독/시간 오차 실측은 이번에 수행하지 않았다. |

`ReplayCapture.start` 실패는 session/chunks를 비우고, unmount는 stop/finalization 취소 경로를 탄다. 성공 파일만 다운로드하는 현재 UI로는 실패 시도 분모를 복구할 수 없다. 또한 Guided를 하지 않은 raw capture가 ARTIFACT_READY여도 4P validation은 INCOMPLETE일 수 있다. 이를 오류 없이 보존하고, 별도 recognition sidecar 상태와 구분해야 한다.

## 3. Ground Truth 영상 구성 옵션

아래 가시성·부담 평가는 **HYPOTHESIS**다. 이번에 어떤 배치도 실제 영상으로 PASS 판정하지 않았다. LEFT/RIGHT는 해부학적 side이며 mirror, MediaPipe ID, 화면 방향으로 정하지 않는다.

| 비교 항목 | A. Foot-side만 | B. Foot-side + 스마트폰 reference | C. Foot-side + 독립 observer | D. Development 배치 변경 |
| --- | --- | --- | --- | --- |
| 신체 좌우 / knee와 twist | Orientation key가 필요. 발·골반의 투영으로 반대 무릎이나 독립 knee cycle이 가려질 수 있음 | 별도 시점이 도움 될 가능성. 두 영상 모두 실제 side 확인 필요 | 관찰자가 side·동작 종류를 보완 기록할 수 있으나 기억/지시를 영상 정답으로 승격할 수 없음 | 사선/측면/높이 조정 후보. 한쪽을 잘 보면서 반대쪽이 더 가려질 수 있음 |
| onset / returnComplete | 원본 frame에서 판독돼야 함. Pose visibility와 무관하게 육안 불가일 수 있음 | Reference native PTS에서 bracket 후 검증된 mapping으로 test PTS에 변환 | 수동 버튼/메모 반응시간으로 50ms 경계를 보장 못함. 영상을 대신하는 timing 정답으로 부적합 | 실제 frame 확인 전 개선 주장 불가 |
| 가림 / loss challenge | Test 시야를 가리면 실제 신체 동작 정답도 함께 사라질 위험 | Reference 시야를 유지하면 보완할 가능성. detector 입력으로 사용 금지 | 사건의 존재·작업 오류 기록에는 유용. 정밀 경계 증거 부족은 남음 | Test 시야와 reference 시야의 동시 가림을 줄이는지는 별도 검증 |
| Sync | Controller↔WebM 한 bridge는 여전히 필수 | Controller↔test 및 reference↔test 두 bridge 필요 | Observer clock/반응 지연이 추가됨. 타이핑 시각을 영상 PTS와 동일시 금지 | Camera 하나면 A, 둘이면 B와 같은 문제 |
| 노트북/폰 역할 | 노트북 foot-side 입력, 폰 얼굴 쪽 화면 유지 | 같은 폰을 측면 촬영용으로 옮기거나 native camera app을 열면 얼굴 쪽 안내와 충돌 | Observer가 노트북 준비/기록을 도울 수 있음. 1인 hands-free 제품 UX와 다름 | 노트북 위치/전신 거리/폰 가독성 함께 재검토 |
| 공간 / 반복 조작 | 기존 배치 부담이 가장 작을 가능성 | 폰 거치·시야·저장공간, 시작/종료/파일 옮기기 부담 증가 | 보조자 시야와 이동 공간 필요, 매번 인력 필요 | 높이·거리·점유 폭/깊이와 설치 시간 재측정 필요 |
| 추가 비용 | 추가 카메라 없이 가능할 후보. GT 판독 실패 시 절약 효과 없음 | 보유 폰을 쓸 수 있는지 미확인. 안내 화면을 유지하려면 별도 화면/폰/보조자 등이 필요할 수 있음 | 장비보다 인력 시간 비용. 2인 blind annotation 의무를 대체하지 않음 | 장비 재배치부터 검토. 추가 센서/구매를 자동 권고하지 않음 |
| 현재 적합성 | 가장 작은 관측 가능성 사전 점검 후보 | 가림/loss까지 다룰 GT의 우선 보완 후보 | 운영 보조·정성 기록용. 단독 정밀 GT 경로로 추천하지 않음 | A/B 한계 확인 뒤 별도 Development 조건으로 다룸 |

**조건부 추천:** A의 판독 가능성을 먼저 Development 수준에서 확인하되 loss 중 실제 동작까지 관측하려면 B를 준비 후보로 둔다. Foot-side 가림 중 정답을 잃는 구간을 NEUTRAL이나 수행 성공으로 채우지 않는다. A가 제안된 pilot GT 기준을 만족하지 못하면 confirmatory로 넘어가지 않는다. D로 test camera를 변경하면 새로운 배치 버전으로 기록하고 기존 foot-side 결과와 합치지 않는다.

폰 한 대만 있다면 “reference 촬영 + 얼굴 쪽 기존 game/remote UI”의 동시 사용을 가정하지 않는다. 제안은 (a) pilot에서만 폰을 GT 촬영에 전용하고 별도 승인된 음성/보조자 안내를 쓰거나, (b) 사용 가능한 두 번째 화면/카메라를 확인하는 것이다. (a)는 실제 제품 역할 구조의 사용성 검증이 아니다. Native camera 녹화와 브라우저 화면의 동시 유지, 화면 잠금 시 녹화, 실제 파일 형식·codec·rotation·PTS 추출 지원은 모두 **NOT_EVALUATED**다. 지금 구매나 특정 각도를 확정하지 않는다.

## 4. Timestamp / Clock domain 조사와 sync 설계

### 4.1 지금 얻는 시각의 의미

| 시각 | source / 현재 저장 | 해석하면 안 되는 것 |
| --- | --- | --- |
| Test WebM frame PTS | `decodeWebMFrames` → `sample.timestamp * 1000`; `inspectReplayMedia`의 전체 배열 및 manifest hash | Decoder 실행 시각, inference 시작 시각, 물리 exposure 시각과 자동으로 같지 않음 |
| Controller monotonic | `usePoseCamera`/`useKneeKick`의 `performance.now()`; capture origin과 상대 tMs/order | 다른 페이지·폰의 performance clock 또는 UTC와 같은 clock이 아님 |
| Recording start | `ReplayCapture.start(..., now)`의 origin과 CAPTURE_START. `recorder.start(1000)` 호출에 사용 | 첫 encoded frame의 PTS origin이나 실제 exposure 시작을 입증하지 않음. 1000은 chunk timeslice이며 frame cadence가 아님 |
| Recording stop | `stop(now)`의 요청 시각, track 종료 시 `onStop`에서 얻는 시각, 최종 Blob 이후 finalizedAt | stop 요청이 마지막 frame PTS와 동일하다는 보장 없음. finalizedAt은 artifact 처리 완료 UTC이며 영상 종료 clock이 아님 |
| Live inference frame | `video.currentTime` 중복 방지 후 `started = performance.now()`; `detectForVideo(video, started)`; 결과 PoseFrame.timestamp=started | 실제 exposure 시각/추론 완료/사용자 표시 시각이 아님. `videoTime`은 callback에 있으나 Replay JSON frame에서 버려짐 |
| Detector event | `KneeKickDetectorV3.processFrame(..., timestamp)`가 confirmation frame timestamp를 event에 사용; Capture가 origin을 빼 tMs 저장 | 실제 wall-clock emit 완료, Socket 전달, 폰 렌더 완료 latency가 아님 |
| Actual detector clock read | `useKneeKick.getCurrent`의 clock 관측. Capture 저장은 열린 Guided trial에 한정 | Poll 없는 구간을 규칙적 250ms tick으로 생성하거나 clock gap을 detector 준비 상태로 메울 수 없음 |
| Reference video PTS | 현재 수집/import 경로 없음 | 스마트폰 Date.now, 파일 생성 시각, 파일명 시각을 native PTS나 test clock으로 사용할 수 없음 |
| Socket 송수신 | Controller snapshot Date.now, mobile request Date.now, mobile receive performance.now 기반 freshness; 서버 relay | 양방향 clock offset·one-way delay·frame PTS를 추정할 동기화 로그가 아님. publish 주기보다 정밀한 보장을 하지 않음 |

`PoseCamera`의 다른 recorder/validation metadata에 `performance.timeOrigin`이 있더라도 test/reference 영상의 exposure 대응이 생기는 것은 아니다. 기존 ReplaySession에는 captureStartPerformanceMs만 있고 per-frame media mapping은 없다. `MediaRecorder` start event 시각과 `BlobEvent.timecode`도 현재 저장하지 않는다. 이 필드를 추가하더라도 chunk 통지나 시작 통지가 실제 촬영 anchor라는 증명은 별도다.

4R의 [alignFrames](../apps/controller-web/src/holdout/divergenceTimeline.ts)는 capture-relative LIVE 시각과 VIDEO PTS에 **±16.666667ms의 근접 매칭 허용치**를 적용했다. 허용치는 독립 측정된 sync error가 아니다. `originalParity`가 동일 frame/clock 입력에서 같은 event를 만든 것은 detector replay 검증이며, 그 event와 실제 영상 동작 사이 offset 검증은 아니다. 기존 4R 결과를 변경하지 않는다.

### 4.2 두 bridge를 독립적으로 확보해야 한다

Canonical time은 **원본 test WebM PTS ms**다. Test 영상 origin을 바꾸거나 일정 fps로 다시 표본화하지 않는다.

1. **Controller performance → test WebM:** 같은 물리 신호와 monotonic 기록의 관계가 검증돼야 한다. Camera preview의 frame metadata와 inference callback의 연결, recording PTS와의 연결이 현재 빠져 있다.
2. **Reference native PTS → test WebM:** 양쪽 영상에 공통으로 보이는 고유 sync 신호를 동일 사건으로 판독할 수 있어야 한다. 공통 flash만으로 1번 bridge까지 생기는 것은 아니다.

각 bridge에 capture 시작·중간·끝의 **독립 anchor ≥3**, 인접 간격 **≤60,000ms**를 둔다. E 전체를 anchor 범위로 감싸며 외삽으로 보완하지 않는다. 120초 E라면 setup/E 전후 여유를 포함한 anchor 간격 때문에 4개 이상이 필요할 수도 있다. 예약 시각이 아닌 실제 관측 간격을 검사한다. Pilot clip은 최대 120초이며 미래 confirmatory의 고정 E 120초와 혼동하지 않는다.

각 anchor는 `anchorId`, 물리 신호 종류/고유 패턴, source clock domain, source 관측 bracket, test native frame index/PTS bracket, reference bracket(사용 시), 대응 근거와 미확인 지연을 저장한다. 단순한 “sync 버튼을 누름”은 operator log일 뿐 anchor가 아니다.

### 4.3 최소 후보와 아직 풀리지 않은 부분

**Optical candidate — HYPOTHESIS:** 몸을 가리지 않는 작은 영역에서 고유 코드/점멸을 두 카메라가 보게 하고, 각 영상에서 마지막 OFF/첫 ON 등 native frame bracket을 기록한다. 양쪽 영상 간 동시 사건을 찾는 데 사용할 수 있는 후보다. 몸 동작/모델 출력/온셋으로 코드를 찾거나 offset을 최적화하지 않는다.

- Foot-side 노트북 웹캠이 노트북 자신의 화면을 본다고 가정할 수 없다. 폰 화면을 신호원으로 쓰면서 같은 폰이 reference를 촬영하고 얼굴 쪽 안내도 제공한다고 가정할 수도 없다. 실제 시야와 사용할 신호원·거치 방법의 결정이 먼저다.
- Controller의 화면 갱신 요청/paint callback을 기록해도 **광자가 나온 시각**과 같다는 보장이 없다. Network로 폰 flash를 지시하면 네트워크·렌더 지연이 더 생긴다. 수동 flash를 동시에 기록한 영상 두 개는 영상 간 bridge 후보이지 Controller bridge 증거가 아니다.
- 향후 최소 관측 로그 후보는 inference sequence, 원래 videoTime, inference 시작/종료 performance, 실제 관측 순서, recorder 시작/종료 통지, 지원되는 browser video-frame metadata다. 현재 detection trigger를 바꾸지 않고 관측만 해야 한다. `requestVideoFrameCallback` 등에서 얻을 수 있는 필드와 해당 브라우저 의미는 후속 설계에서 확인해야 하며, callback 시각을 exposure나 MediaRecorder PTS로 즉시 간주하지 않는다. 서로 다른 callback이 같은 frame을 가리키는지도 입증해야 한다.
- 따라서 **공통 optical 신호의 실제 Controller 발생 시각 오차와, 그 frame이 encoder/inference 경로에 연결되는 방식이 아직 미해결**이다. 미확인 offset을 0으로 놓지 않는다. 이 문제가 전체 판정을 BLOCKED로 만드는 핵심이다.

**Audio candidate — 현재 비추천:** 기존 `getUserMedia`는 `audio: false`다. Test 영상에 공통 녹음 채널이 없으므로 음성 cue만으로 cross-video anchor를 만들 수 없다. Audio를 추가한다면 재생·전파·수집·A/V offset을 별도 검증해야 한다. 이번 설계에서 기존 audio 설정을 바꾸거나 TTS 시작 콜백을 50ms anchor로 승인하지 않는다.

### 4.4 후속 오차 실측·검증 절차 — 이번에 실행하지 않음

1. 사용자 승인 후 신호원·두 시야·파일 형식과 **Controller 발생 시각을 독립 확인할 수 있는 근거**를 먼저 선택한다. 근거를 제공할 수 없으면 운동 촬영에 들어가지 않고 clock 설계를 중단한다. 추가 장비 필요성도 그때 명시한다.
2. 운동·detector 정확도 평가와 분리된 timing 자격 점검을 한다. Native PTS/프레임 대응, 신호 출력 지연, camera/encoder 경로의 미지 offset과 변동을 측정할 계획 및 도구를 먼저 고정한다. 현재 Camera 버튼은 ML도 실행하므로 이를 inference 없는 점검으로 부르지 않는다. 필요하면 최소 camera/clock 전용 경로를 별도 승인받는다.
3. 실제 clip마다 첫/끝 anchor만으로 `t_test = a*t_source + b`를 계산한다. 중간/추가 anchor는 **검증용으로 보류**하고 fitting에 다시 넣어 residual을 줄이지 않는다. Anchor 누락, 비단조 PTS, clock reset, 대응 모호성, 미측정 latency 항은 실패/미확인으로 보존한다.
4. Endpoint bracket 불확실성을 전체 구간에 전파하고, frame quantization/anchor 판독, 독립적으로 측정한 고정 offset·변동 상한, 내부 검증 anchor 오차를 포함한 보수적 bound를 만든다. 항목 간 중복 여부와 산식을 미리 잠근다. 동일한 미지의 지연은 모든 anchor에서 residual이 작아도 남을 수 있다. **작은 residual만으로 ≤50ms PASS 금지.** 값이 UNKNOWN인 항이 있으면 finite bound를 발명하지 않는다.
5. 각 source→test mapping의 제안 bound는 **≤50ms**다. Reference를 쓰는 실제 event↔annotation 비교는 두 bridge의 상대 오차도 전파해야 한다. 각 bridge가 따로 50ms라고 해서 둘의 차이도 50ms라고 할 수 없다. 증명된 공통오차 상쇄가 없으면 보수적으로 합산하고, event↔GT에 적용되는 sync bound 및 GT onset 반폭과의 합 **ε≤100ms**를 확인한다. 예를 들어 두 bridge 각 25ms 배분은 가능한 설계 예시이지 새 승인 기준이나 달성 사실이 아니다. 4X의 sync/onset 한도를 완화하지 않는다.
6. `syncBoundMs > 50`, onset 반폭 >50, 합산 ε>100 또는 bound 미확인 시 해당 capture의 정밀 recall/latency matching을 보류하고 `TIMING_UNCERTAIN / UNSCORABLE`로 보존한다. 좋은 구간만 자르거나 detector event/onset에 맞춰 보정하지 않는다. 자료는 Development로 남기고 원인·새 방법·버전·사용자 검토 후 재설계한다. 합격 기준을 조용히 낮추지 않는다.

미래 native PTS 검증기는 불규칙 간격과 누락을 그대로 드러내야 한다. 30fps라는 nominal 값으로 누락 frame을 합성하거나 정수 frame 번호/fps로 경계를 대신하지 않는다.

## 5. 독립 Annotation 운영과 최소 데이터

### 5.1 역할과 blind 순서

- 수집 담당자는 모든 attempt와 원본 media/JSON/sidecar hash를 보존한다. Detector 결과를 아는 사람은 그 사실을 기록하며 blind annotator로 조용히 겸임하지 않는다.
- **인간 annotator A/B 두 명**이 모든 E를 서로의 annotation 없이 독립 판독한다. 원본 영상, native PTS, 검증된 E/clock mapping, orientation key만 제공한다. Guided expected labels, cue schedule, detector trace/count/landmarks, game score는 제공하지 않는다. 원본 audio는 보존하되 annotation 재생은 mute한다.
- Orientation 구간에서 실제 신체 side를 확인한다. 필요 시 비센싱 색상 표시를 쓸지 사전 결정하되 MediaPipe ID나 screen-left로 정하지 않는다. Key가 모호하면 해당 side를 UNLABELABLE로 남긴다.
- 현재 live 화면에는 skeleton/진단·count가 있어 blind viewer가 아니다. 미래 수집 화면은 운영 상태/녹화/시간만 보이게 분리하고 결과 노출을 기록해야 한다. View를 가리는 것과 detector를 멈추는 것은 다르다.
- A/B 제출물을 먼저 각각 version/SHA 동결한다. 비교는 4X guide의 **onset 순서, nearest ≤500ms, 일대일, 동률 이른 onset/actionId**, class/side를 매칭 조건으로 쓰지 않는 규칙 그대로다. Unmatched도 초벌 불일치 분모에 남긴다.
- 초벌 class+side 일치율 ≥90%, label 일치 쌍 중 onset 차이 ≤100ms 비율 ≥90%라는 제안을 검사한다. 불일치는 **제3 adjudicator**가 detector-blind로 검토한다. 조정 후에도 초벌 불일치율과 두 원안을 남긴다. 해결 안 된 것은 ANNOTATION_DISAGREEMENT다.
- 최종 annotation, unknown masks, mapping과 버전/SHA를 동결한 뒤에만 detector output을 연다. SHA는 변경 탐지 수단이지 사람의 독립성/정직성을 보장하는 수단이 아니므로 역할과 접근 기록도 필요하다.

실제 행동 정의는 `4X-GT-1`을 참조하며 새 정의를 만들지 않는다. Onset/returnComplete의 뒤 100ms 확인은 offline human annotation 절차이고 detector에는 미래 frame을 주지 않는다. Hold 없는 cycle은 hold 필드 null/noHold로 보존한다. E 전체를 실제 negative/knee/other/unknown으로 partition하며 transition을 빈 시간으로 버리지 않는다.

### 5.2 최소 private annotation 계약 — 설계 제안

| 묶음 | 최소 필드 / 처리 |
| --- | --- |
| 제출물 | schemaVersion, attemptId/captureId, annotator pseudonym/role, blind exposure declaration, guide version/SHA, media SHA, PTS manifest SHA, E/mapping version/SHA, annotationVersion, createdAt, previousVersionSha |
| Action | actionId, actual label/anatomical side, source media ID, native frame index/PTS brackets, onset/holdStart/holdEnd/returnStart/returnComplete, noHold/truncated, boundary uncertainty, 근거/가림 사유. Mapping 전 source PTS도 보존 |
| 시간 partition | `[start,end)`, actual class 또는 UNLABELABLE/ANNOTATION_DISAGREEMENT, TIMING_UNCERTAIN flags, 알려진/모르는 필드. 원본과 canonical bracket 둘 다 유지 |
| 비교/판정 | 양쪽 원본 annotation SHA, 초벌 일치율 및 unmatched, adjudicator/근거, unresolved intervals, 최종 annotation SHA. Detector 출력은 freeze 이전 계약에 포함하지 않음 |

Raw NaN/missing은 좌표 0 또는 NEUTRAL로 바꾸지 않는다. JSON serialization에서 NaN과 null을 섞어 잃지 않도록 미래 sidecar에는 invalid-kind/reason 또는 별도 validity mask를 둔다. 기존 Replay JSON 형식을 고쳐 과거 파일을 재저장하지 않는다. Reference에서 actual knee를 볼 수 있으나 Pose가 없는 경우는 정답 불명확이 아니라 **실제 action + detector unavailable**이며 전체 recall 분모에 남는다. 원자료에서 판독 못한 UNLABELABLE과 두 사람의 불일치 ANNOTATION_DISAGREEMENT는 별개다.

### 5.3 인력이 부족할 때

한 사람의 재주석·시간을 두고 다시 보기·AI 두 번 호출은 독립 인간 2인 검증이 아니다. 한 사람으로 할 수 있는 것은 파일 열기/PTS 확인, orientation 후보 검토, 입력 폼 연습, 예상 가림 기록 같은 **Development preflight**다. 이것을 4X pilot의 2인 일치 기준 PASS나 confirmatory GT로 부르지 않는다. A/B가 없으면 승인된 6-clip pilot 완료 판정도 보류한다. 제3 adjudicator가 없을 때 불일치를 당사자 합의만으로 확정하지 않으며, 미해결 범위와 운영 의존성을 남긴다.

## 6. Blocker와 해소 조건

| ID | Blocker / 현재 상태 | 다음 관문을 열 근거 |
| --- | --- | --- |
| B1 | Controller↔test PTS의 물리 anchor/offset bound가 미정 | 출력·수집 경로를 명시한 clock 설계, 실제 대응 가능한 로그/신호, 독립 오차 budget과 timing 자격 검증. 미측정 항 없는 ≤50ms bound를 승인된 방식으로 입증 |
| B2 | Foot-side actual 좌우·경계·loss 중 GT 가시성 미확인 | 승인된 Development pilot에서 원본 영상 및 2인 독립 판독. 제안 95% labelable 등 미달이면 A 중단, B/D 별도 검토 |
| B3 | 같은 폰의 reference/얼굴 쪽 안내 역할, 거치/저장/형식 미확인 | 보유 기기·역할 표, 시야·공간·반복 조작 계획, 원본 형식 decode/PTS 보존 검증. 추가 장비 필요 시 사용자 결정 |
| B4 | 독립 annotator A/B와 제3 adjudication 인력 미확인 | 역할·blind 접근·소요 시간·불일치 운영 합의. 미확보 시 Development preflight에 한정 |
| B5 | 독립 E와 E 전체 actual clocks/reset/diagnostics/epoch log 없음 | 아래 M1–M3 및 parity/비간섭 검증. Guided를 재시작하거나 clock tick을 새로 생성하지 않는 경로 |
| B6 | 실패 attempt 보존, sidecar, blind 입력/PTS viewer, actual scorer 없음 | 아래 도구를 순서대로 준비. 성공 capture만 남는 방식과 가짜 Guided trial 금지 |
| B7 | 4X 수치·절차 사용자 미승인 | 승인 범위/버전/SHA 기록. 문서 존재나 이번 설계 완료를 승인 시각으로 대체하지 않음 |

B1은 장비를 더 사면 자동 해결되는 문제가 아니다. B2/B3/B4의 확인이 장비·인력 blocker로 확정될 수 있으나 현재는 부족하다는 사실조차 일부 미확인이다. 그래서 전체 판정은 장비 부족 단정 대신 **BLOCKED_BY_UNRESOLVED_DESIGN**으로 둔다.

## 7. 최소 Tooling Dependency Plan — 전부 미구현 제안

새 DB/서버/클라우드/다중 사용자 플랫폼 없이 로컬 private 파일을 사용한다. 아래 `pilot/`와 `PilotCapturePanel.tsx`는 **아직 없는 파일명 제안**이며 현재 링크가 아니다. 기존 경로는 controller-web의 `src/` 기준이다. 승인 후 필요한 부분만 연결하며 production detector/config/protocol은 유지한다.

의존 순서: **M1 ledger/계약 → M2 E marker와 M3 passive 기록 → M4 clock 자격 검증 → M5 reference 검증 → M6 manifest 동결 → M7 blind 주석 → M8 scorer**. B1/B3/B4 조사는 M1과 독립적으로 먼저 해결해야 한다. Reference가 필요 없다고 입증된 A라면 M5의 reference 부분은 명시적 NOT_APPLICABLE이며 Controller bridge는 생략하지 않는다.

### M1. 실패를 포함하는 Pilot attempt ledger

- **재사용/파일:** `useLocalDownload`의 export 정리만 재사용. 제안 `pilot/pilotTypes.ts`, `pilot/pilotLedger.ts` 및 대응 test. 첫 slice는 camera와 연결하지 않는다.
- **입출력:** 사용자 승인 참조/Development split, 예정 attempt slot·ID, environment/배치·담당 → revision 순서가 있는 ledger. Attempt는 permission/카메라 시작 **전에** 남긴다. `PLANNED → START_REQUESTED → ... → COMPLETE/SETUP_FAILED/INTERRUPTED/ARTIFACT_FAILED` 등 운영 상태와 실패 사유, 파일 없음도 명시한다. 실제 schema enum은 구현 전 잠근다.
- **보존:** 작은 ledger의 저빈도 변경만 browser local storage에 쓰고 revision JSON을 Git 밖에 export하는 최소안을 제안한다. Raw 영상/매 frame 데이터는 넣지 않는다. Export 후 파일 존재/SHA를 운영자가 확인한다. 재접속 시 미종료 attempt는 INTERRUPTED로 보존하고 새 ID로 덮지 않는다. Local storage는 변경 불가 저장소가 아니므로 원본 export를 보존하고 이전 revision SHA로 연결한다. 다운로드 click을 디스크 저장 성공으로 간주하지 않는다.
- **실패/시험:** 저장 권한·quota 실패면 시작 차단. crash/reload, setup 실패, 중복 ID, revision 역행, 부분 export, 실패 후 retry가 같은 slot을 교체하지 않는지 synthetic test. Storage 삭제 시 원본 export 없이 복구했다고 주장하지 않음.
- **선행/제외:** 승인된 작은 계약만 필요. 모델/웹캠/운동/score/DB/자동 재촬영은 구현하지 않는다.

### M2. 독립 evaluation window E

- **재사용/파일:** 기존 Controller monotonic clock 사용. 제안 `pilot/evaluationWindow.ts`, 향후 `components/PilotCapturePanel.tsx`. `ReplayMarkerType`에 억지로 GUIDED marker를 재사용하지 않고 sidecar에 별도 기록한다.
- **입출력:** attemptId, clock-domain ID, 승인된 clip 계획, actual start 관측 → E_START, 예정 deadline, actual end callback/stop와 order, canonical E는 M4 mapping 완료 후 생성한다. Future confirmatory는 canonical `E_end = E_start + 120000ms`로 고정한다. Controller에서 예약한 종료 deadline, 실제 callback/stop, canonical end는 별개 필드다. Mapping 뒤 영상이 고정 E 끝까지 없으면 incomplete이며 E를 축소하지 않는다. 늦은 callback 때문에 E를 연장하거나 실제 gap을 숨기지도 않는다. Pilot의 사전 지정된 ≤120초 범위를 미래 18-attempt 일정으로 자동 전환하지 않는다.
- **실패/시험:** 이중 시작, end-before-start, clock 역행, tab 중단, early stop/unmount, E 일부가 media 범위 밖이면 incomplete. E 끝 event 제외/half-open 경계, planned end와 늦은 callback 보존, E 표시 중 detector reset/start 호출 **0회**를 시험한다.
- **선행/제외:** M1. E UI를 새 인식 gate/Guided stage/Socket command/game scoring으로 만들지 않는다. 안내 cue는 별도 운영 기록이며 정답이 아니다.

### M3. Guided START/reset 없는 passive 수집

- **재사용/파일:** `ReplayCapture`, `KickObservation`, `useKneeKick`의 observer와 `getReplaySnapshot` 재사용. 제안 `pilot/pilotObservation.ts`, `pilot/usePilotCapture.ts`; 미래 연결 지점은 `PoseCamera.tsx`, `pose/kick/useKneeKick.ts`. Frame별 상세 eligibility가 필요하면 `pose/kick/kneeKickAnalysis.ts`에서 **이미 계산한** diagnostics를 관측자에게 전달하는 작은 추가만 별도 검토한다. `KneeKickDetectorV3` 내부를 바꾸지 않는다.
- **입출력:** 준비 전부터 actual FRAME/CLOCK/RESET, 원본 frame videoTime, 기존 production baseline freeze/변경, 상세 event/diagnostic → ordered private log. Capture부터 E 이후 stop까지 기록한다. 시간 domain/original order/reset reason/epoch ID를 보존한다. Epoch ID는 logging용이며 detector state를 조작하지 않는다.
- **중요 경계:** 기존 250ms view/remote 호출에서 생기는 CLOCK을 그대로 받아 저장하고 추가 `getView()`/tick을 만들지 않는다. UI에서 계산한 저빈도 snapshot을 frame 데이터로 사용하지 않는다. Passive snapshot에 없는 세부 진단을 현재 API로 이미 수집할 수 있다고 주장하지 않는다. 완전한 baseline/reset history 없이 replay가 복구 가능하다고도 주장하지 않는다.
- **흐름:** attempt 기록 → capture 시작 → 기존 production Neutral 한 번 → FROZEN/baseline과 별도 4P reference 준비 상태 기록 → 독립 E 시작 → E 종료 후 anchor/tail 확보 → capture stop/finalize. E 시작에 `kick.startTest`, `resetTest`, recalibration을 호출하지 않는다. 4P Guided는 실행하지 않은 상태로 유지 가능하며 INCOMPLETE를 새 pilot 실패나 완료로 오독하지 않는다. Readiness가 불충분하면 사유를 ledger에 남기고 승인된 준비 규칙에 따른다.
- **실패/시험:** logging overflow, camera stop/reset/recalibration, page unload, snapshot 누락은 보존 후 incomplete. Observer on/off에 따른 detector event/state/clock order 동일성, trial 밖 CLOCK 저장, reset-before/after 순서, NaN/null 구분, result.close lifecycle, mirror 무관성, 취소·중복 listener 검증. 기존 22초 replay parity도 유지한다.
- **선행/제외:** M1/M2. Raw stream과 순서를 바꾸거나 frame을 보간/제거하지 않는다. 기존 capture schema 변경·새 detector·새 readiness 기준·자동 복구는 범위 밖이다.

### M4. Clock anchor 수집과 mapping validator

- **재사용/파일:** `decodeWebMFrames`, `inspectReplayMedia` 재사용. 제안 `pilot/pilotClock.ts`와 tests; 필요 시 `camera/usePoseCamera.ts`의 원래 videoTime/이미 얻은 timing 정보를 관측 전용으로 전달. 물리 신호 출력 도구 파일은 **B1 결정 전 확정하지 않는다**.
- **입출력:** M3 clock-domain/order 기록, 물리 신호 manifest와 각 영상 native anchor brackets → mapping a/b, 검증 anchor residual, 불확실성 budget, `VERIFIED/UNVERIFIED/FAILED` 및 이유. Source PTS와 변환 PTS 모두 보존한다.
- **실패/시험:** anchor <3, gap >60초, E 외삽, 고정 지연 미측정, 잘못된 units, source reset, nonfinite/NaN, frame gap, 순서 역행, bound 초과. 합성 fixtures로 affine drift/offset·bracket 전파·중간 anchor FAIL·양 bridge 합산·동일 offset의 작은 residual이 PASS 못 되는 경우를 검사한다. **Synthetic test PASS는 실제 ≤50ms 증거가 아니다.** 실물 timing 자격 점검은 별도다.
- **선행/제외:** M1–M3와 B1 방법 결정. Detector/actual onset fitting, 모델 재추론, audio 설정 변경, Socket clock sync 기반 추정은 하지 않는다.

### M5. Reference media identity와 native PTS

- **재사용/파일:** `hashBlob`은 bytes hash에 재사용. `decodeWebMFrames`는 WebM 원본일 때만 재사용. 제안 `pilot/referenceMedia.ts`; 실제 폰 파일이 다른 container이면 해당 원본의 PTS/rotation을 읽는 작은 adapter가 필요한지 먼저 검토한다.
- **입출력:** 원본 파일 → SHA/bytes/MIME·container·codec·dimension·rotation, 전체 native PTS 배열/hash, decode 지원 여부, M4에 연결할 media ID. 외부 reference는 detector 입력으로 보내지 않는다.
- **실패/시험:** 미지원 원본 형식, 중간 누락/비단조 PTS, 파일 교체, decode 취소, orientation metadata 해석 불명. Rename 허용/byte 변화 거부, VFR/gap 보존, 원본 rotation와 preview만의 변환 분리 시험. 원본을 재인코딩해 PTS/identity 오류를 숨기지 않는다.
- **선행/제외:** B3의 실물 형식 확인, M4 mapping 계약. 설치 구매, cloud upload, reference의 MediaPipe inference, 자동 장면 인식은 없음.

### M6. Private sidecar manifest 동결

- **재사용/파일:** V2 원본을 참조하고 `hashBlob`/local export 재사용. M1의 `pilotTypes.ts` 확장 및 제안 `pilot/pilotManifest.ts`/validator. 기존 protocol ID·schema를 덮지 않는다.
- **입출력:** ledger, test WebM/JSON SHA, M3 log, M4 mapping, M5 reference(또는 명시적 없음) → 새 schemaVersion의 recognition sidecar. 최소 필드는 approval/plan/guide SHA, attempt/session/split, source commit/patch·model/WASM/config hash, 실제 환경/delegate, media identities, clock domains/anchors/mapping/status, E와 cue 기록의 분리, baseline epochs/reset history, log/annotation 참조·SHA, 실패 사유다. 실값 미입력은 null/미등록이며 미래 hash를 발명하지 않는다.
- **실패/시험:** 파일/SHA 누락·교체, ID 충돌, E 범위 부족, baseline/clock 부재, 서로 다른 media 혼합, approval 미등록은 valid 평가 패키지가 아니다. 부재/변조/중복과 결정적 serialization, 예전 manifest 불변, V2 4P status와 recognition status 독립성을 시험한다.
- **선행/제외:** M1–M5. 실패 manifest도 export 가능해야 하며 COMPLETE만 다운로드하는 gate를 재사용하지 않는다. 영상/landmark/개인 정보는 Git 밖; 새 DB/Socket DTO 없음.

### M7. Blind annotation 입력·저장

- **재사용/파일:** WebM PTS decoder와 `useLocalDownload`만 작은 책임으로 재사용. 제안 `components/PilotAnnotation.tsx`, `pilot/pilotAnnotation.ts` 및 tests. 기존 분석/replay 화면은 detector 결과를 노출하므로 그대로 blind viewer로 쓰지 않는다.
- **입출력:** 결과 없는 media package/E/orientation/mapping → A/B 독립 annotation JSON, 초벌 비교, 별도 adjudication revision. 최소 UI는 native frame step/PTS, 전체 속도 맥락 재생, side/class/경계 bracket/unknown 입력·export다. Reference frame을 test frame과 같다고 꾸미지 않고 각각 PTS/mapping uncertainty를 표시한다. Native 음성은 mute하고 결과 파일 import는 freeze 전 차단한다.
- **실패/시험:** overlay/Guided cue 노출, 다른 annotator 결과 선노출, wrong orientation/media hash, 경계 순서 오류, E partition hole/overlap, 누락 bracket. No-hold/truncated/unknown/불일치 구분, A/B 파일 분리, 최초 제출 불변, 불리한 timing 경계와 frame gap 표시를 시험한다.
- **선행/제외:** M4–M6, A/B·adjudicator 운영. AI 자동 labeling, platform 계정/협업 서버, detector score 표시를 만들지 않는다. 현재 STEP에서는 이 viewer도 구현하지 않는다.

### M8. 미래 `4X-MATCH-1` scorer 준비

- **재사용/파일:** 기존 pure `KneeKickDetectorV3`, `usableKneesV3`, baseline 검증 및 clock/order replay 패턴 재사용. 제안 `pilot/pilotScoring.ts`, `pilot/pilotReplay.ts`, tests. 기존 `replayKneeKickV3`는 22초 회귀용으로 보존하고 actual-motion 채점에 Guided expected label을 사용하지 않는다.
- **필수 입력:** 승인·동결된 plan/guide/matching/source/config, 모든 attempt/실패, verified media/PTS/mapping 및 ε, E 전체 frozen GT/unknown partition, 원본 actual ordered LIVE frames/CLOCK/reset/baseline epochs, full event identity/source/epoch, fresh per-side eligibility/coverage 기록이다. 새 replay adapter는 준비부터 E 종료까지 실제 lifecycle을 재생하고 LIVE와 parity를 먼저 확인해야 한다. E에서 detector를 임의 ARMED로 초기화하지 않는다.
- **출력:** 4X의 owner/half-open window/primary event category, actual all-action recall, false/wrong/duplicate/unknown, 100ms 지지 시간 coverage와 availability, boundary uncertainty 및 분모/실패 사유. 4X guide의 가상 예제와 matching 규칙을 그대로 구현할 후속 계약이다. Pilot은 GT feasibility 보고이며 18-attempt 인식 acceptance로 승격하지 않는다.
- **실패/시험:** 불완전 clock/reset 로그, LIVE parity 불일치, invalid ID/time, missing/NaN, 기준 미등록이면 PASS 불가. E end/outside, return 뒤 false, same-owner duplicate, opposite-side wrong, late/unknown, 양 경계 불확실성, zero denominator, GT는 보이나 pose 없는 action의 recall 분모 유지 등을 검사한다.
- **선행/제외:** M1–M7와 승인된 scorer 계약·회귀. 본격 detector 점수 계산은 GT freeze 후에만 한다. Scorer는 observer 정답을 detector에 입력하거나 새 정책을 탐색하지 않는다. 모든 도구/테스트 승인 전 새 holdout 수집은 없다.

## 8. 다음 단계에서 가장 작은 작업

**권고 slice: M1의 ledger + M6의 sidecar 최소 schema/validator 골격만, synthetic 입력으로 검증.** Source 구현을 시작한다면 사용자 승인 후 별도 단계로 한다. Calibration/camera hook/Socket/game을 건드리지 않고 실패 시도 ID와 append revision, missing artifact/UNREGISTERED/UNVERIFIED 상태를 정확히 표현하는 것으로 한정한다.

완료 조건은 start 전 attempt 보존, 실패 후 재접속 시 기존 시도 유지, revision/파일 hash 연결, 실패 자료 export, source/clock/GT 미준비를 COMPLETE로 표시하지 않는 테스트 통과다. 실제 개인정보/raw 입력 없이 synthetic fixtures로 확인할 수 있다. 이 slice 뒤 M2/M3 연결을 검토하고, B1 clock 방법이 해소되기 전 full pilot pipeline 구현을 READY로 선언하지 않는다.

병행해서 사용자가 확인할 운영 조건은 **보유 폰/태블릿 수·reference 촬영 역할, 설치 공간/거치, 독립 annotator 두 명과 adjudicator, private 파일 보관 위치 및 승인 범위**다. 현재 이 정보를 추측해 장비를 주문하거나 촬영을 요청하지 않는다. 도구 선택에 필요한 실물 clock 설계와 인력 조건을 확인한 뒤 승인된 Development preflight를 별도 계획한다.

## 9. 기존 요구사항·결정·결과 보존

| 보존 대상 | 이번 문서의 처리 |
| --- | --- |
| 4X pilot 수치 | **PROPOSED 유지:** 6 clips, clip당 ≤120초, actual LEFT/RIGHT 각각 ≥12, negative 각 ≥30초, 반복/교대 각각 4 sequence, loss/recovery 4회, labelable ≥95%, 초벌 label ≥90%, onset 차이 ≤100ms 비율 ≥90%, sync ≤50ms/onset 반폭 ≤50ms/합산 ε≤100ms. 승인이나 실측 PASS로 바꾸지 않음 |
| 18-attempt holdout | 후속 미등록 계획이다. 이번 pilot/설계와 별개이며 진행하지 않음. 기존 V2/4Q/R/S는 Development/Regression이고 새 holdout으로 재사용하지 않음 |
| 4P capture | `STEP_4P_ESTIMATOR_HOLDOUT_V1`, 22초 Guided, SHA/PTS validation/readiness 및 기존 파일은 유지. Recognition E와 완료 status를 sidecar에서 분리할 계획 |
| Calibration | 기존 production 1초 및 bounded knee grace/FROZEN 유지. 별도 3초/60/8 joints reference를 production baseline 대신 쓰지 않음 |
| Detector / model | S1/S2, threshold/config, inference/model/delegate 동작 변경 없음. 4S NO_SAFE_CANDIDATE 유지 |
| Game / Socket | KEYBOARD/SCRIPT TEST와 Pose 연구 분리. protocol 변경·Pose→game 연결 없음 |
| Raw / 과거 결과 | 영상·landmark·capture JSON을 새 문서에 복사하지 않음. 4P/Q/R/S 분석 결과, 4X 두 문서, README를 수정하지 않음 |

## 10. 최종 판정과 이번 검증 범위

**`BLOCKED_BY_UNRESOLVED_DESIGN`** — code primitive 재사용 가능성과 Pilot 실행 가능성은 다른 결론이다. 특히 Controller↔WebM bridge의 실측 가능한 오차 근거가 아직 미정이다. Reference/annotation 의존성도 해소되지 않았다. 어느 옵션도 실제 GT 관측이나 ≤50ms sync PASS로 보고하지 않는다.

이번 검증은 로컬 문서/source 검토, 요구사항 대조, 파일·symbol 존재 및 Git/whitespace 검사다. 시작 시 `main`, HEAD `c2e721d1845b8aaba0877e64abf3d7fd784dec81`, clean working tree를 확인했다. 사용자가 지정한 GitHub 기준 SHA와 로컬 HEAD가 같다. 원격 최신 HEAD를 별도로 fetch해 확인했다는 뜻은 아니다.

작업 종료 검증: 기존 tracked **305개 파일**을 시작 시 SHA-256 목록과 비교해 모두 불변임을 확인했다. 신규 산출물은 이 Markdown 하나뿐이며 기존 source/tests/config/README/4X와 분석 결과를 변경하지 않았다. `git diff --check` 및 untracked 문서의 별도 whitespace 검사에서 오류가 없었고, 실제 파일 링크 **31개**와 인용 symbol의 존재를 확인했다. Tracked diff/stat은 비어 있고 새 문서만 untracked로 표시된다.

문서 전용 작업이므로 전체 tests/typecheck/build를 **재실행하지 않았다**. 과거 PASS를 이번 실행 결과로 보고하지 않는다. 실제 영상 판독·운동 촬영·모델 추론·detector 실험·timing 실측·tooling 구현은 하지 않았다. Commit/push 하지 않는다. 사용자 검토와 다음 작업의 승인 전에는 이 설계 이후 단계로 진행하지 않는다.

# STEP 4K.2A — Independent Holdout 사전 등록

등록일: 2026-10-06. STEP 4K.1의 기존 네 fixture 결과로 후보를 정했으며, 이번 단계에서는 새로운 운동/촬영 또는 새 holdout 자료 검토를 수행하지 않는다. 아래 값은 독립 자료 평가 전에 고정한다. Holdout 실패를 근거로 이번 평가에서 다른 threshold를 선택하지 않는다.

## 고정 설정과 실행 경계

- Role: `REFERENCE_LIVE_3_HOLDOUT`. 파일명과 무관하게 사용자가 직접 선택한다.
- `PRE_REGISTERED_INTEGRITY_CONFIG`: `Y_VELOCITY`, `velocity: 12`, `minRatio: null`. 런타임에서도 freeze한 상수다.
- 기존 candidate-entry 현재/직전 usable frame veto를 그대로 사용한다. 모든 frame의 velocity cap으로 확대하지 않는다.
- Soft recovery: 관측된 `abs(Y) < 0.25`가 연속 100ms여야 READY. 기존 missing/400ms hard-loss 처리도 그대로다.
- Y: enter 0.40/50ms, clear 0.25/100ms.
- Fixed flexion: enter 15°/67ms, clear 5°/150ms, `TRIGGER_CHANNEL_CLEAR`.

`validateIntegrityHoldout`에는 config/grid 입력이 없다. 오직 상수12로 Y_ONLY와 FIXED_Y_OR_FLEXION을 각각 한 번 실행한다. STEP 4K.1 evidence/sweep/report 함수는 HOLDOUT을 거부하며, 저수준 integrity runner도 HOLDOUT에 다른 설정을 전달하면 거부한다. UI는 준비된 fixture를 role로 분리해 각 평가에 전달한다. 탐색의 `viableIntegrityConfigs`와 `viableFixedFlexionDiagnosticConfigs`는 기존 네 역할만 사용한다. 자동 BEST/10 또는15 fallback은 없다.

## Parity와 calibration 선검사

모든 holdout capture/trial은 Y_V3여야 하며 실제 production LANDMARK replay를 먼저 수행한다. LIVE와 event 방향/시각, Guided summary, final state, 저장/재구성 Neutral·X·V3 baseline이 모두 일치해야 한다. 하나라도 다르면 guard 실행과 holdout 결과 생성을 중단한다. Legacy capture를 holdout 역할로 지정해도 독립 검증 PASS로 취급하지 않는다.

Holdout만 `LATEST_FROZEN` calibration 선택을 사용한다. 기록된 시간/order로 Guided 직전 마지막 START→FROZEN 성공 쌍을 선택하며, 이후 미완료 START는 선택하지 않는다. Segment/flexion Neutral window와 baseline 재구성이 같은 선택을 공유한다. FROZEN 부재 또는 저장 baseline 불일치는 실패이며, 첫 Neutral로 대체하지 않는다. 기존 탐색/replay의 기본 선택 방식은 유지한다.

## 사전 고정 acceptance

**A: Y guard safety**는 production Y의 정상 event 방향·stage·시각을 보존해야 한다(기존 replay 시간 허용오차 0.000001ms). 같은 stage의 다른 event로 손실을 숨기지 않는다. Stage별 false/wrong/duplicate 증가가 없어야 하며 hard cross-gap, soft-gap confirmation, hard/soft reacquisition false는 각각0이어야 한다. Y의 알려진 feature 한계로 한쪽을 놓치는 경우 L/R1/1 자체를 요구하지 않는다.

**B: Fixed flexion full candidate**는 전체 Guided sequence의 평가 frame이 있어야 하며 TWIST_LEFT/TWIST_RIGHT/모든 NEUTRAL false0, KNEE_LEFT와 KNEE_RIGHT correct 각각 정확히1, wrong/duplicate/hard cross-gap/soft-gap/hard·soft reacquisition false0이어야 한다. Expected-limb kick 중 integrity activation이 하나라도 있으면 횟수/episode/reason을 보고하고 `fullCandidatePass: false`로 둔다. 해당 값을 근거로 자동 threshold 조정은 하지 않는다.

두 boolean은 독립적이다. Y miss를 flexion이 보완하면 둘 다 통과할 수 있고, Y를 훼손하지 않아도 full candidate에 false가 남으면 B만 실패한다. 여러 capture/trial이 있으면 각 결과를 보존하고 모든 trial이 통과해야 aggregate PASS다. Trial이 없거나 자료가 불완전하면 full PASS하지 않는다.

## UI와 로컬 report

기존 Integrity 패널에서 JSON의 역할을 지정하고 **Inspect Integrity Features**로 parity를 확인한 뒤 **Validate HOLDOUT · velocity12**를 실행한다. HOLDOUT만 입력했을 때 탐색 sweep/CSV 버튼은 비활성화된다. 기존 네 역할과 섞어 입력해도 **Run Integrity Guard Comparison**은 기존 역할만 처리한다. 역할 변경/새 파일/취소/초기화/unmount 시 이전 준비 및 holdout 결과를 폐기한다.

**Download Integrity JSON**의 별도 `holdoutValidation`에 role, preRegisteredConfig, fixedFlexionConfig, `perFixture[]`, aggregate acceptance를 저장한다. 각 fixture에는 `liveReplayParity`, 선택 calibration과 재구성, 실제 `yProductionReference`, `yWithGuard12`, `fixedFlexionWithGuard12`, `acceptance.yGuardSafetyPass/fullCandidatePass`, 실패 이유와 유실 event/추가 count/activation이 포함된다. 기존 exploratory 결과는 이 section과 별개다. Raw 영상/landmark 업로드나 production 적용은 없다.

현재 구현 검증은 합성 raw capture와 기존 STEP 4K.1 네 fixture 회귀만 사용한다. 새 독립 holdout에 대한 성공 결과를 의미하지 않는다.

## 구현 검증 결과

`pnpm typecheck`, `pnpm build`, `pnpm --filter @plank-stork/controller-web test` 모두 성공했다. 기존638개를 유지하고18개를 추가해 **58 files / 656 tests**가 통과했다. 합성 LIVE raw capture로10 통과/12 실패,15 통과/12 실패, production true event 손실, Y miss의 flexion 보완, expected-limb activation 차단, parity 실패, calibration 선택과 UI 분리/취소/다운로드를 검증했다.

기존 네 실제 fixture를37개 설정으로 재실행한 전체 report는 저장된 `step-4k1-integrity-results.json`과 동일했다(생성 시각을 맞춰 비교). 로컬 자료 경로를 사용하는 임시 회귀 검사는 통과 후 제거했다. 기존 sweep의 viable 네 설정과 event/trace/baseline/summary는 그대로다. Build에는 controller main chunk712.13kB의 기존500kB 초과 경고가 남는다. 새 holdout 자료 검토, 새 운동, commit/push는 수행하지 않았다.

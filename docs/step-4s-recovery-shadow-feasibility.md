# STEP 4S — Detector Recovery Policy Shadow Feasibility

**최종 판정: NO_SAFE_CANDIDATE.** S1+S2는 이 capture에서 LIVE 성공을 유지하고 FULL_VIDEO의 LEFT miss와 Neutral false를 동시에 해결했다. 그러나 사전 등록한 synthetic negative controls에서 S1의 tracking-jump false와 S2의 연속 킥 재무장 비용이 확인됐다. 실제 capture 결과만 보고 후보를 승인하지 않았다.

기준 HEAD: `8b9ffb21dc99bc9bb68cafa027417655acef9db2`.
Capture: `plank-stork-replay-2026-10-11T23-45-38-330Z`.
정책/기준 등록: **2026-10-12T14:20:30.513105Z**, shadow capture 결과 생성 전.
집계와 정책별 state transition timeline: [step-4s-recovery-shadow-summary.json](./step-4s-recovery-shadow-summary.json).

## 고정한 정책과 구현 경계

CONTROL은 기존 `KneeKickDetectorV3` 인스턴스다. 모든 정책에서 enter `.40`, enter dwell `50ms`, clear `.25`, clear dwell `100ms`, tracking loss `33ms`, stale `400ms` 및 기존 visibility/scale/arbitration 값이 같다.

- **S1:** ARMED/CANDIDATE에서 현재 usable인 `REACQUIRED_NOT_READY` side도 기존 enter run을 시작할 수 있다. 첫 high-Y frame은 provisional candidate, 확인은 그 뒤 **새로운 연속 50ms**를 관측했을 때만 가능하다. 별도의 두 번째 dwell은 추가하지 않았다. Loss/gap에서 기존 run, 적분 evidence, 이전 evidence는 초기화되고 새 epoch에서 시작한다. Neutral tracking 상태를 READY로 위장하지 않는다. WAIT_RETURN/WAIT_CLEAR는 변경하지 않는다.
- **S2:** WAIT_RETURN 이후 양쪽 모두 usable이고 `absY < .25`인 구간이 **연속으로 100ms 겹쳐야** 재무장한다. 한쪽이라도 missing/nonclear이거나 gap이면 joint return run을 초기화한다. Entry/reacquisition/동률 arbitration은 변경하지 않는다.
- **S1+S2:** 위 두 변경만 결합한다. 추가 정책, threshold 탐색, smoothing 또는 다른 gate를 만들지 않았다.

Production에는 정책 주입 지점이 없으므로 리팩터링하지 않았다. Node 전용 factory가 SHA로 고정한 원본 source를 읽어 constructor flag와 **두 분기만** 치환하고 메모리에서 컴파일한다. 전체 엔진 소스 복제 파일이나 private state 조작은 없다. Source drift/치환 위치 불일치/예상하지 않은 runtime dependency가 있으면 중단한다. 이 코드는 앱 runtime에서 import하지 않는다.

원본 detector SHA: `a14c3a56dab54dc9b3fb19c524b47af832c5154ee00357afd6bcc2591334a358`.
분석용 치환 source SHA: `fc09b3b573d2f57c1b05de5823274ca68507370f34ee2763b084d78a52eca03d`.
두 flag를 끈 mirror는 다섯 번째 실험 정책이 아니라 **구현 검증 전용**이다. 고정 synthetic 사례, 2,000개 결정적 irregular/missing/time-order 입력과 실제 두 스트림에서 원본의 event/diagnostic/view/reset/snapshot 일치를 확인했다.

## 입력/CONTROL 무결성

원본 V2 JSON/WebM SHA 및 byteLength, STEP4Q 세 raw run SHA, STEP4R 등록 report SHA, 기존 source/config를 확인했다. 캐시 landmark에서 기존 STEP4Q/4R report를 재생성하여 전체 동일성을 확인했다. 기존 report나 원본 파일은 쓰지 않았다. 새 모델 추론/영상 decode/촬영은 없다.

두 스트림 모두 **저장 production V3 baseline A**를 사용한다. Neutral calibration은 재수행하거나 변경하지 않는다. CONTROL 결과는 기존 `replayKneeKickV3` 및 STEP4R의 LIVE_A/VIDEO_A와 event timestamp/count/final state까지 일치한다.

| 입력 | 원본 전체 | START 전 setup | START 후 처리 | 원본 trial 내 | Guided 내 | 실제 clockSamples |
|---|---:|---:|---:|---:|---:|---:|
| LIVE | 1720 | 561 | 1159 | 661 | 660 | 178 |
| FULL_VIDEO | 1988 | 561 | 1427 | 661 | 661 | 0 |

기존 replay와 같은 trial START/reset 경계를 사용한다. START 전 setup은 원본에 보존하고 이미 저장된 baseline을 사용한다. START 이후에는 **missing 포함 모든 frame**을 원래 시각/order 그대로 capture 끝까지 처리했다. Pose 품질에 따른 제외, subset, 보간, retiming은 없다. 원본 Guided `[18689, 40689)`로만 사후 채점하고 이후 event는 별도 diagnostic이다. Stage label/미래 frame은 detector에 전달하지 않는다.

## 네 정책 결과

아래 false는 Guided 내부만 포함한다. 모든 조합의 Twist false, wrong direction, duplicates, cross-gap은 **0**이다.

| 정책 | LIVE LEFT / RIGHT / Neutral false | VIDEO LEFT / RIGHT / Neutral false | VIDEO reacquisition false | LIVE 성공 보존 | 정책 판정 |
|---|---|---|---:|---|---|
| CONTROL | 1 / 1 / 0 | 0 / 1 / 1 | 1 | 예 | PARTIAL_OR_UNSAFE |
| S1 | 1 / 1 / 0 | 1 / 1 / 1 | 1 | 예 | PARTIAL_OR_UNSAFE |
| S2 | 1 / 1 / 0 | 0 / 1 / 0 | 0 | 예 | PARTIAL_OR_UNSAFE |
| S1+S2 | 1 / 1 / 0 | 1 / 1 / 0 | 0 | 예 | PARTIAL_OR_UNSAFE |

모든 정책의 LIVE 이벤트 시각은 LEFT `32007.5ms`, RIGHT `36566.800003ms`로 동일하다. 모든 조합의 trial 최종 상태는 ARMED다.

| VIDEO 정책 | Guided 이벤트 시각 ms |
|---|---|
| CONTROL | RIGHT 36649, RIGHT 38815 (Neutral false) |
| S1 | LEFT 32085, RIGHT 36649, RIGHT 38815 (Neutral false) |
| S2 | RIGHT 36649 |
| S1+S2 | LEFT 32085, RIGHT 36649 |

**S1의 LEFT 복구:** `31818–31885ms` loss 이후 `31918ms`에 재획득한다. `32018ms`부터 새로운 high-Y 후보가 시작되어 `32085ms`에 67ms를 채운다. Loss 이전 evidence는 사용하지 않았고 event epoch도 일치한다. CONTROL/S2는 이 구간에서 REACQUIRED_NOT_READY gate 때문에 miss한다.

**S2의 false 제거:** CONTROL/S1은 RIGHT 단독 clear로 `38715ms`에 ARMED가 되고, `38749→38815ms` 후보가 Neutral false를 만든다. S2 계열은 왼쪽이 아직 clear가 아니므로 WAIT_RETURN을 유지한다. 이후 양쪽 clear가 겹치는 run을 채운 `39082ms`에 재무장해 false 후보가 발생하지 않는다.

## Synthetic negative controls

Synthetic 입력은 사전 고정했고 기대 결과를 정책에 유리하게 바꾸지 않았다. **아래 FAIL은 정책 위험의 측정 결과**이며, 자동 테스트는 그 FAIL이 정확히 보고되는지를 검증하므로 전체 테스트 PASS와 모순되지 않는다. Synthetic PASS는 실제 운동 인식의 독립적 증거가 아니다.

| 검증 | CONTROL | S1 | S2 | S1+S2 |
|---|---|---|---|---|
| 재획득 뒤 33ms의 짧은 fake spike: event 없음 | PASS | PASS | PASS | PASS |
| 재획득 뒤 지속되는 fake high-Y: false 없음 | PASS | **FAIL** | PASS | **FAIL** |
| Pose loss 중 event 없음 | PASS | PASS | PASS | PASS |
| Loss 이전 run/epoch/evidence 불사용 | PASS | PASS | PASS | PASS |
| 400ms gap 이전 enter dwell 불사용 | PASS | PASS | PASS | PASS |
| Missing/NaN 안전성 | PASS | PASS | PASS | PASS |
| 긴 hold와 .30 tail에서 duplicate 없음 | PASS | PASS | PASS | PASS |
| 동일/역행/NaN/무한대 시간에서 상태 불변 | PASS | PASS | PASS | PASS |
| Reset/recalibration의 run/baseline/event ID 초기화 | PASS | PASS | PASS | PASS |
| 정책별 clear 경계와 100ms 완료 후 재무장 | PASS | PASS | PASS | PASS |
| 양쪽 clear가 있는 LEFT→RIGHT→LEFT 연속 킥 | PASS | PASS | PASS | PASS |
| 반대쪽 .30 tail 후 다음 RIGHT 킥 보존 | PASS | PASS | **FAIL** | **FAIL** |
| Prefix causality: 미래 입력이 과거 결과를 바꾸지 않음 | PASS | PASS | PASS | PASS |

추가 회귀 테스트로 모든 정책의 **return-clear dwell도 400ms gap을 넘지 않음**을 확인한다.

### S1 위험: 지속 tracking jump

Neutral 뒤 `10ms`, `43ms`에 knee loss를 주고 `76ms`에 fake normalized Y `1.2`로 복귀시킨다. `101ms`, `126ms`에도 같은 가짜 값을 관측한다. 실제 킥을 공급하지 않은 negative control이다.

S1/S1+S2는 **126ms에 LEFT false**, candidate start 76ms, dwell 50ms, 새 epoch 1로 확정한다. 즉 old-run leakage나 cross-gap 버그가 아니라 **정책이 허용한 신선한 가짜 evidence**로 발생한다. 양측 return 규칙은 첫 false event를 방지하지 못한다. CONTROL/S2는 Neutral clear 전까지 이 가짜 신호를 막는다. 같은 관측값만으로 이 synthetic jump와 진짜 post-loss 킥을 구별할 추가 근거는 이번 정책에 없다.

### S2 위험: 재무장 지연/누락

LEFT event 후 LEFT는 0으로 돌아왔지만 RIGHT는 .30에 머물고, 다음 실제 RIGHT pulse가 .60으로 상승하는 synthetic sequence를 사용했다. CONTROL/S1은 LEFT 50ms, RIGHT 275ms 두 event를 낸다. S2/S1+S2는 양측 clear 구간이 없어서 LEFT만 검출하고 다음 RIGHT를 놓친다. 이 실패를 threshold를 낮추거나 sequence를 바꿔 숨기지 않았다.

실제 LIVE capture에서도 마지막 RIGHT 이후 재무장은 CONTROL/S1의 **38031.800003ms**에서 S2 계열의 **39164.5ms**로 **1132.700ms 지연**됐다. 이 capture에는 해당 구간에 채점할 추가 킥이 없으므로 실제 recall 회귀로 세지는 않지만, availability 비용은 관측된다. VIDEO에서도 재무장은 38715→39082ms로 367ms 늦어진다.

## 판정 범위

- CONTROL: 기존 LEFT miss와 Neutral false가 남는다.
- S1: LEFT 복구만 성공하고 Neutral false 및 sustained-jump 위험이 남는다.
- S2: Neutral false만 제거하고 LEFT miss 및 연속 킥 availability 위험이 남는다.
- S1+S2: 이 capture의 두 증상은 동시에 해결하지만 **synthetic negative 2개 FAIL**로 후보 조건을 충족하지 못한다.

따라서 전체 **NO_SAFE_CANDIDATE**다. 새 정책 생성이나 threshold sweep으로 재시도하지 않았다. 이 결과는 “결합 정책이 production에 적합하다”는 결론이 아니며, 이미 관찰한 V2를 사용했으므로 독립 holdout도 아니다. FULL_IMAGE는 기존 STEP4Q/4R 관측만 보존하고 추가 shadow 평가하지 않았다. HEAVY는 baseline 부족으로 평가하지 않았고, LIVE2/LIVE3도 acceptance에 사용하지 않았다.

## 재현과 보존

`apps/controller-web/scripts/recovery-policy.mjs`는 V2 JSON/WebM, STEP4Q directory, STEP4R directory, 사전 등록된 STEP4S directory를 입력받는다. `registration.json`과 `preservation-before.json`을 복사한 새 Git 밖 directory에서 기준 HEAD로 실행한다. 출력과 implementation lock은 write-once이고 lock 이후 source 변경 시 중단한다.

```sh
cd apps/controller-web
node scripts/recovery-policy.mjs <capture.json> <capture.webm> <step4q-private-dir> <step4r-private-dir> <registered-step4s-private-dir>
```

Private 결과: `Documents/plank-stork-private/step4s/<captureId>/recovery-report.json`. 정책별 `CONTROL-live-trace.csv`, `S1-video-trace.csv`, `S2-video-trace.csv`, `S1+S2-video-trace.csv` 등에 전체 frame diagnostic을 보존했다. 공개 JSON은 파생 집계/상태 변화만 포함하고 raw WebM/JSON/landmark는 Git 밖에 있다. Report는 두 번 생성하여 결정성을 검증했고 기존 STEP4Q/4R 결과는 byte SHA와 재생성 결과 모두 동일하다.

최종 검증: 기본 `pnpm --filter @plank-stork/controller-web test`는 **89 files / 1,022 tests PASS (47.72s)**, 신규 STEP4S targeted tests는 **26 PASS**다. `pnpm typecheck`와 `pnpm build`도 PASS다. Build에는 기존 500kB chunk 크기 경고만 남는다. 기존 tracked 파일 273개 및 STEP4Q/4R private 파일 42개의 SHA가 모두 보존됐고, 분석 source lock 및 공개 집계와 private report의 일치도 확인했다.

Production detector, Neutral calibration, Guided 22초, config, package scripts와 기존 테스트는 변경하지 않았다. Commit/push 하지 않았다. 상세 검증 로그와 `checks.json`은 private STEP4S directory에 보존한다.

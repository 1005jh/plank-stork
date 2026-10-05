# STEP 4K.1 — Landmark Integrity 분석 기록

분석일: 2026-10-06. 저장된 네 capture만 사용했으며 새 운동/촬영, production 변경, threshold 변경, commit/push는 하지 않았습니다. 이 문서의 veto 수치는 analysis-only grid 결과입니다.

## 입력과 LIVE parity

| Role | Capture ID 끝부분 | 파일 |
| --- | --- | --- |
| REFERENCE_OLD_CLEAN | 2026-09-30T12-09-14-840Z | clean인가요.json |
| STRESS | 2026-09-30T11-39-17-364Z | 3차검증2.json |
| REFERENCE_LIVE_1 | 2026-10-03T16-39-36-229Z | 4gi replay json.json |
| REFERENCE_LIVE_2_INDEPENDENT | 2026-10-05T14-37-39-718Z | 4j result json.json |

Role은 명시적으로 지정했습니다. 두 Y_V3 capture의 event/time·Guided summary·final·Neutral/X/V3 baseline parity가 모두 MATCH입니다. Guard 없는 분석 Y도 production replay와 이벤트 시각/방향·final이 일치합니다.

Independent Y 이벤트는 **26704.800 RIGHT, 27237.900 RIGHT, 28338.000 LEFT, 33262.400 RIGHT ms**입니다. 앞의 두 개는 NEUTRAL **25329.700–27329.700ms**에 속하는 false이며, 뒤의 두 개는 각각 올바른 kick입니다. False2/wrong0/duplicate0/final ARMED입니다. Replay/wiring 불일치는 없었습니다.

Segment Neutral은 flexion과 같은 정확한 window에서 각 segment의 usable-length median으로 계산했습니다. Independent는 **11688.900ms START**, **12705.700ms FROZEN**, 실제 median window **(11705.700,12705.700]ms**, 양쪽 31 frames입니다. Old CLEAN만 첫 Neutral 60 frames를 사용하며 해당 stage는 독립 평가에서 제외했습니다. 모든 baseline은 고정이며 이후 동작으로 바뀌지 않습니다.

## 측정 정의

- `deltaDyNorm`은 기존 Y_V3의 signed hip-center-relative Y delta / frozen bodyScale입니다. 속도는 바로 이전 usable frame과의 signed 차이 / recorded seconds입니다.
- Knee relative 2D velocity는 hip-center-relative XY의 인접 변화 벡터 크기 / bodyScale / seconds입니다. 양수 크기를 미분하는 방식이 아닙니다.
- Hip-knee, knee-ankle image length는 normalized XY 공간의 거리입니다. 각각 Neutral median으로 나누어 ratio를 기록합니다. Geometry는 필요한 same-side image landmark visibility≥0.5와 유한한 XY를 요구합니다. Y에는 기존 hip≥0.7/knee≥0.5 guard를 적용합니다.
- Ankle missing/미준비 segment median은 ratio=null입니다. 관측되는 zero-length segment는 ratio=0이며 angle은 undefined/null입니다. 이 차이를 유지합니다.
- Knee image angle/angle velocity, hip·other hip·knee·ankle visibility를 함께 저장합니다. World hip-knee/knee-ankle length 및 3D angle은 optional world visibility≥0.5/유한 XYZ와 image visibility를 요구하는 **진단 전용** 값입니다.
- Velocity는 missing, dt≤0, dt≥400ms를 가로질러 계산하지 않습니다. Guided label 경계는 시간 연속성을 끊지 않습니다. Median은 가운데 두 값 평균, p05/p95는 nearest rank입니다.

## False / true candidate entry 직접 비교

CSV에는 아래 8개 anchor의 **각 entry 전후 500ms, 총 241개 frame 행**이 있습니다. 확인 시각은 inference가 실제로 반환한 recorded tMs만 사용합니다.

| Fixture / label | Entry ms | Event ms | Signed Y velocity /s | 2D velocity /s | Knee-ankle ratio | Image angle ° |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Independent FALSE RIGHT #1 | 26638.000 | 26704.800 | -23.597 | 23.607 | 0.345 | 16.128 |
| Independent FALSE RIGHT #2 | 27171.300 | 27237.900 | -16.953 | 16.953 | 0.124 | 131.955 |
| Independent TRUE LEFT | 28272.200 | 28338.000 | -7.484 | 7.492 | 0.313 | 165.082 |
| Independent TRUE RIGHT | 33196.900 | 33262.400 | -5.714 | 6.250 | 0.624 | 177.845 |
| Old CLEAN TRUE LEFT | 20509.800 | 20576.600 | -7.451 | 7.575 | 0.651 | 135.473 |
| Old CLEAN TRUE RIGHT | 25842.700 | 25910.400 | -6.356 | 6.874 | 0.932 | 162.505 |
| First LIVE TRUE LEFT | 38922.900 | 39064.500 | -4.562 | 4.892 | 0.692 | 173.941 |
| First LIVE RIGHT, fixed-flexion diagnostic | 43989.000 | 44088.800 | -0.606 | 2.274 | 1.109 | 160.707 |

마지막 RIGHT는 원래 Y_V3에서는 miss입니다. 고정 flexion candidate를 비교용 anchor로 사용한 것이며 LIVE Y의 성공으로 세지 않습니다.

첫 false의 직전 frame부터 확인 frame까지:

| tMs | Y | Y velocity /s | KA ratio | Angle ° | Knee vis | Ankle vis | Y tracking / run ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 26604.700 | 0.082 | -1.493 | 0.865 | 175.955 | 0.828 | 0.689 | READY / 0 |
| **26638.000** | **-0.704** | **-23.597** | **0.345** | **16.128** | **0.794** | **0.649** | READY / 0, entry |
| 26671.500 | -0.720 | -0.484 | 0.265 | 10.149 | 0.772 | 0.613 | READY / 33.5 |
| **26704.800** | -0.538 | 5.465 | 0.942 | 155.654 | 0.770 | 0.595 | READY / 0, event |

두 번째 false:

| tMs | Y | Y velocity /s | KA ratio | Angle ° | Knee vis | Ankle vis | Y tracking / run ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 27138.000 | -0.199 | -4.219 | 0.186 | 143.693 | 0.717 | 0.509 | READY / 0 |
| **27171.300** | **-0.764** | **-16.953** | **0.124** | **131.955** | **0.719** | **0.526** | READY / 0, entry |
| 27204.600 | -0.584 | 5.398 | 0.129 | 71.252 | 0.701 | 0.507 | READY / 33.3 |
| **27237.900** | -0.553 | 0.928 | 0.232 | 120.730 | 0.697 | 0.502 | READY / 0, event |

두 entry 모두 hip/knee visibility가 기존 Y guard를 통과했고 tracking은 READY였습니다. 특히 첫 angle은 한 frame에 약176°→16°로 변했습니다. Soft discontinuity 가설과 일치하는 관측이지만, landmark 수치만으로 실제 신체 자세나 corruption 원인을 확정하지 않습니다. Event frame의 run=0은 detector가 발화 후 run을 초기화한 결과입니다. CSV에는 상대 XY, normalized XY, HK length/ratio, angle velocity 및 world 값도 있습니다.

## 전체 평가 frame 분포

아래는 calibration-only Neutral을 제외한 side별 분포입니다. 속도는 **p95 / max**, ratio는 **min / p05 / median**입니다. Null은 통계에서 제외하고 coverage/usable count는 JSON에 보존했습니다. Stage별 분포도 JSON/UI에 있습니다.

| Fixture | Side | abs(Y velocity) /s | 2D velocity /s | Knee-ankle ratio |
| --- | --- | --- | --- | --- |
| Old CLEAN | LEFT | 3.077 / 8.660 | 4.653 / 12.602 | .380 / .569 / .851 |
| Old CLEAN | RIGHT | 2.355 / 11.885 | 2.920 / 19.622 | .571 / .835 / 1.003 |
| STRESS | LEFT | 4.152 / 8.998 | 4.531 / 9.024 | .132 / .861 / 1.006 |
| STRESS | RIGHT | 4.804 / 11.769 | 4.926 / 13.868 | .017 / .680 / .986 |
| First LIVE | LEFT | 4.562 / 22.505 | 7.191 / 30.724 | .394 / .670 / 1.113 |
| First LIVE | RIGHT | 3.443 / 20.336 | 5.419 / 28.499 | .667 / .952 / 1.128 |
| Independent | LEFT | 4.274 / 27.940 | 5.119 / 28.190 | .065 / .540 / .947 |
| Independent | RIGHT | 5.285 / 32.130 | 6.250 / 32.139 | .119 / .755 / .965 |

True stage 전체에도 큰 instantaneous velocity가 있습니다. 따라서 entry veto 결과를 모든 frame에 적용하는 velocity cap의 성능으로 해석하면 안 됩니다.

## Guard 의미와 결과

A/B는 **현재 eligible candidate entry 또는 바로 직전 usable frame**의 속도가 veto 이상이면 suspect로 바꿉니다. Candidate 진행 중의 속도를 positive confirmation이나 추가 speed cap으로 사용하지 않습니다. C는 현재 usable knee-ankle ratio가 MIN_RATIO 미만일 때 연속 검사하므로 진행 중 run도 중단할 수 있습니다. D는 이 두 조건의 OR입니다.

한 activation에서 side를 `SUSPECT_NOT_READY`로 전환하고 그쪽 Y·flexion run을 버립니다. 이미 suspect인 동안은 같은 episode이며 activation을 매 frame 더하지 않습니다. Y가 `.25` 미만으로 100ms 연속 관측돼야 복귀합니다. Recovery frame은 새 gesture를 시작하지 않으며, missing/dt≥400ms는 clear를 초기화합니다. 원래 hard-loss gate와 반대 side, Guided timeline은 계속 동작합니다. Return clock은 실제 관측을 계속 받아 불필요한 두 번째 100ms hold를 추가하지 않습니다.

| Guard | 요청 grid | Y_ONLY viable | Fixed Y+flexion diagnostic viable |
| --- | --- | ---: | ---: |
| NONE reference | 1 | 0 | 0 |
| A Y velocity | 10/12/15/18/20/25/30 | **3/7: 10,12,15** | **3/7: 10,12,15** |
| B 2D velocity | 10/12/15/20/25/30/35 | **1/7: 15** | **1/7: 15** |
| C segment collapse | .20/.25/.30/.35/.40/.50 | **0/6** | **0/6** |
| D Y velocity OR collapse | 12/15/18/20 × .25/.30/.35/.40 | **0/16** | **0/16** |

**viableIntegrityConfigs = 4**: `Y_VELOCITY/10/-`, `Y_VELOCITY/12/-`, `Y_VELOCITY/15/-`, `KNEE_2D_VELOCITY/15/-`입니다. Fixed flexion diagnostic의 viable 목록도 같은 네 개입니다. 검토한 이산 grid이며 모든 중간 threshold가 통과한다는 뜻은 아닙니다.

- A18/20은 Independent false1을 남기고 A25/30은 false2를 남깁니다. 정상 L/R는 유지합니다.
- B10/12는 Independent false를 지우지만 First LIVE LEFT recall을 잃습니다. B15만 네 fixture 조건을 통과하고, B20 이상은 false를 남깁니다.
- C.20은 false1을 남깁니다. C.25 이상은 정상 Independent LEFT를 차단합니다. 실제 LEFT stage **28237.900ms**에 ratio **0.229467**가 관측되어 .25 guard가 켜지고, **31338.700ms**에야 복귀해 kick 구간을 놓칩니다. C.40/.50은 old CLEAN LEFT 손실/오방향까지 유발합니다. Segment ratio 단독으로 false와 true를 분리하지 못했습니다.
- D의 모든 16개는 segment 조건 때문에 Independent LEFT를 잃습니다. 단순 OR 추가가 안전성을 자동으로 높이지 않습니다.

Viable Y guard 적용 후 old CLEAN은 **L1/R1/false0**, First LIVE는 기존 **L1/R0/false0**, Independent는 **L1/R1/false0**, STRESS는 unobservable kick miss를 유지한 **events0**입니다. Wrong/duplicate/hard-gap/soft-gap/reacquisition false 모두0, final은 모두 ARMED입니다. Guided stage 시간은 변하지 않습니다.

Y_ONLY 기준 activation 비교:

| Config | Old / Stress / Live1 / Independent activations | True kick stage activations 합계 | Independent neutral activations | Independent ready latency min–max | Unresolved |
| --- | --- | ---: | ---: | --- | ---: |
| Y velocity10 | 1 / 1 / 1 / 7 | 2 | 6 | 166.600–566.600ms | 0 |
| Y velocity12 | 0 / 0 / 0 / 7 | 0 | 6 | 166.600–566.600ms | 0 |
| Y velocity15 | 0 / 0 / 0 / 5 | 0 | 4 | 166.600–300.000ms | 0 |
| 2D velocity15 | 1 / 0 / 0 / 5 | 1 | 4 | 166.600–300.000ms | 0 |

`guardActivationsDuringTrueKick`는 kick-labelled stage 내 양쪽 activation 수입니다. 실제 expected limb activation은 별도 필드입니다. `candidateCancelledBySoftLoss`에는 예방된 entry도 포함하며 `entryPreventedBySoftLoss`와 `existingRunCancelledBySoftLoss`를 따로 기록합니다. 미복귀 episode의 latency는 null이며 0ms로 대체하지 않습니다.

Descriptive하게 보면 A는 B와 같은 단일 feature guard이면서 검토한 세 인접 값10/12/15에서 통과했습니다. 그중12/15는 true kick stage activation0입니다. B는 검토한15 하나만 통과하고 activation1이 남습니다. **BEST 자동 선택이나 production threshold 확정은 하지 않습니다.**

## Fixed flexion interaction

Flexion ENTER15°/dwell67ms/clear5°/150ms를 유지했습니다. 명시되지 않은 return policy는 기존 STEP 4J default `TRIGGER_CHANNEL_CLEAR`를 그대로 사용했고 추가 sweep하지 않았습니다.

Guard 없는 fixed Y+flexion은 Independent에서 **26405.100ms FLEXION false1**, 정상 LEFT/RIGHT 각1입니다. 이는 production Y false2와 다른 결합 상태기의 결과입니다. OR detector의 event/WAIT_RETURN을 함께 처리하므로 기존 Y 이벤트를 단순 합집합한 값이 아닙니다.

네 viable guard 모두 fixed flexion false를 제거하고 old CLEAN·First LIVE·Independent의 L/R 각1을 유지합니다. Y15에서는 Independent activation6, true kick stage0, completed5/unresolved1이며, Y12에서는10/0/8/2입니다. Trial 종료까지 Y clear를 못 본 side는 SUSPECT로 남을 수 있습니다. Global final ARMED를 양쪽 입력 READY와 혼동하지 않습니다. 모든 event의 hard/soft-gap과 reacquisition false는0입니다. Fixed flexion은 여전히 diagnostic 전용입니다.

## 산출물과 한계

- Desktop `plank-stork-shadow-analysis/step-4k1-integrity-results.json`: per-frame primitive features, full distributions, exact traces, parity/baselines, 37개 설정 × 2개 evidence mode 결과.
- 같은 폴더 `step-4k1-traces.csv`: 8개 trace / 241 rows. Full landmark/영상 업로드는 없습니다.
- 동일 네 입력과 설정을 두 번 실행해 결과 결정성과 원본 불변을 확인했습니다. 기존 post-trial `trialId:null`/closed result 불변 회귀를 유지합니다.

이 Independent 자료는 STEP 4K 이전 후보에 대해서는 독립 자료였지만, 이번 guard는 실패를 관찰한 뒤 비교했으므로 **새 guard에 대한 독립 검증은 아닙니다**. 이번 STEP 완료에 새 운동은 필요하지 않았습니다. Production 변경 전에는 후보/허용 기준을 미리 고정하고 별도 자료에서 재검증해야 합니다. 카메라 위치 변경이나 새 운동을 이번 작업에서 요구하지 않았습니다.

## 구현·검증

`integrityFeatures.ts`는 window/geometry/미분/분포를, `integrityGuard.ts`는 분석용 side별 suspect lifecycle을, `analyzeIntegrity.ts`는 trace·두 evidence mode·fixture acceptance·export를 담당합니다. `IntegrityAnalysis.tsx`는 역할 선택 → feature inspection → 고정 grid → JSON/CSV 다운로드 순서입니다. 기존 분석 코어에 optional veto hook과 재사용 가능한 summary runner를 추가했으며 NONE은 기존 Y/4J 동작과 동일합니다. 카메라 metrics tick은 memo 처리한 결과 표를 재렌더링하지 않습니다.

`pnpm typecheck`, `pnpm build`, `pnpm --filter @plank-stork/controller-web test` 모두 성공했습니다. **57 files / 638 tests**로 기존608개와 신규30개가 통과했습니다. 정상 rise, instantaneous jump, high hold, observed clear100ms, missing ankle, visible collapse, pre/post-soft run 분리, Guided 고정 시간, determinant replay, 최신 baseline/compatibility, world 독립성, 명시적 role, parity 실패 중단, UI 취소·reset·unmount, 기존 post-trial attribution 회귀를 포함합니다. 빌드에는 main chunk706.03kB의 기존500kB 초과 경고가 남습니다.

Production `kneeKickDetectorV3.ts`, `kneeKickAnalysis.ts`, MediaPipe 설정, `replayCapture.ts`에는 변경이 없습니다. 원본 capture/영상은 수정하지 않았습니다.

# STEP 4X — Independent Recognition Validation Preregistration

작성일: 2026-10-14 · 검토 HEAD: `a681c427c549583191f6b5470872d1fb9bf9bbef`

**상태: PROPOSED / 사용자 미승인 / NOT REGISTERED.** 문서 버전 `4X-PLAN-1`, 주석 가이드 `4X-GT-1`, matching 규칙 `4X-MATCH-1`, 제안 capture protocol `STEP_4X_RECOGNITION_V1`이다. 아래 수치는 실행 가능한 최초 제안이지 현재 detector 성능 추정치·제품 요구 확정·촬영 승인이 아니다. 사용자 검토와 등록 manifest 동결 전에는 confirmatory 수집·평가를 시작하지 않는다. 이 단계에서 새 촬영, 추론, 실험, detector/game/protocol 변경은 하지 않았다.

짝 문서: [실제 동작 Ground Truth Guide](step-4x-ground-truth-guide.md). 수치와 acceptance의 기준 문서는 이 plan이고, 가이드가 다른 값을 암묵적으로 적용해서는 안 된다. 등록할 때 두 문서의 SHA-256을 함께 고정한다.

## 1. 근거와 주장할 수 있는 범위

`VERIFIED`는 source 또는 기존 보고서의 검증 기록을 확인했다는 뜻이다. 이번 STEP에서 과거 실험을 재실행했다는 뜻은 아니다. `OBSERVED`는 특정 저장 자료에서의 관측, `HYPOTHESIS`는 아직 확인하지 않은 설명/효과, `NOT_EVALUATED`는 독립 평가 부재를 뜻한다.

| 수준 | 근거 | 이번 계획의 제한 |
| --- | --- | --- |
| VERIFIED | [4P](step-4p-capture-hardening.md)는 V2 WebM SHA-256/byteLength/전체 PTS 검사와 별도 3초 estimator reference를 제공한다. [protocol source](../apps/controller-web/src/capture/estimatorValidationProtocol.ts)는 3,000ms·60 usable frames·8 joints를 고정한다. | Media integrity와 reference READY는 동작 정답이나 인식 PASS가 아니다. |
| VERIFIED | [4Q](step-4q-holdout-analysis.md)는 단일 V2 `plank-stork-replay-2026-10-11T23-45-38-330Z`의 33,530,994 bytes 및 세 estimator의 동일 1,988 PTS를 검증했다. | **하나의 capture**다. 세 재추론은 세 독립 표본이 아니다. |
| OBSERVED | 그 영상의 Guided 채점은 LIVE L/R/false = 1/1/0, FULL_VIDEO Y V3 = 0/1/1. FULL_IMAGE는 kick coverage 부족, HEAVY는 Neutral knee usable 0/0이었다. | Guided label은 지시 시각이다. 실제 신체 LEFT/RIGHT, onset, Neutral 정답을 독립 검증한 결과가 아니다. |
| VERIFIED / OBSERVED | [4R](step-4r-live-video-divergence.md)은 원본 LIVE replay parity PASS를 기록했다. A/B/C baseline 교체로는 counts가 안 바뀌고, input stream 및 VIDEO matched subset 변경에서 차이가 재현됐다. 귀속은 MIXED였다. | Sampling과 estimator history를 완전히 분리한 인과 증거가 아니다. LIVE와 VIDEO가 bit-identical하다는 가정을 하지 않는다. |
| OBSERVED | [4S](step-4s-recovery-shadow-feasibility.md)의 S1+S2는 이 영상의 VIDEO 1/1/0을 만들었지만 sustained fake high-Y 및 다음 킥 누락 synthetic controls에 실패했다. | **NO_SAFE_CANDIDATE 유지.** 새로운 실제 동작 검증이나 production 승인으로 바꾸지 않는다. |
| HYPOTHESIS | Foot-side 원근·가림 또는 추적 history가 좌우 관측에 영향을 줄 수 있다. 독립 주석이 Guided/실제 동작 불일치를 드러낼 수 있다. | 카메라 원인, 다른 배치·모델의 superiority는 미확정이다. |
| NOT_EVALUATED | 독립 신체 ground truth 기준 recall/false/latency, 연속 킥 availability, 다인 일반화, Pose→게임 정확도. | 자동 니킥 인식의 일반적인 불가능성 역시 증명되지 않았다. |
| VERIFIED / NOT_EVALUATED | 현재 [gameTypes](../apps/controller-web/src/game/gameTypes.ts)와 [SCRIPT runner](../apps/controller-web/src/game/scriptedGameInput.ts)는 KEYBOARD/SCRIPT TEST 경로를 제공한다. | STEP4W의 hands-free TEST 성공은 실제 운동 인식 승인 근거가 아니다. |

[4T 전략](step-4t-game-input-strategy.md)을 유지한다. TEST 게임 개발과 인식 검증은 분리하며 Steam 출시라는 최종 제품 목표를 유지한다. 이 문서는 Steam 패키징 설계가 아니다.

## 2. 최초 검증의 대상과 관측 가능성 pilot

최초 confirmatory 범위 제안은 **한 명의 사전 등록된 사용자, 한 노트북/웹캠/브라우저/Full VIDEO GPU 설정, 기존 foot-side 배치**다. 발 쪽에서 머리 방향, 책상 높이, 전신 frame, 폰은 얼굴 쪽 안내 화면으로 둔다. 정확한 높이·거리·시야·기기 ID는 pilot에서 측정해 등록 manifest에 잠그고 holdout 도중 최적화하지 않는다. Preview Mirror는 metadata이고 신체 LEFT/RIGHT나 주석 좌표를 바꾸지 않는다.

대상은 실제 플랭크 중 양쪽 니킥, Neutral/Twist negatives, 같은 방향 반복, 좌우 교대, tracking loss/reacquisition이다. 빠른 템포·다른 자세·다른 기기·다른 사람에 대한 주장은 범위 밖이다. Reference 영상은 정답 관측 전용이며 detector 입력으로 사용하지 않는다.

**관측 가능성 pilot 제안:** Development로만 사용할 6 clips, 같은 날/다른 날 구분 기록, clip당 최대 120초. 총 LEFT/RIGHT 각각 12 actual actions, 각 negative 30초 이상, 반복/교대 각각 4 sequence, loss/recovery 4회가 관측될 수 있는 과제를 준비한다. 부족하면 pilot 미완료이며 재설계된 pilot은 새 버전으로 기록한다. 인식 score나 detector 출력을 보지 않고 다음을 확인한다.

| pilot 결정 기준 — 모두 PROPOSED | 완료 조건 / 못 채웠을 때 |
| --- | --- |
| 실제 신체 좌우와 양쪽 무릎 | 두 annotator가 labelable 시간 ≥95%, LEFT/RIGHT action 각각 ≥12개를 독립 판독. 가려진 다리를 추정하지 않는다. |
| onset/hold/return | 초벌 action label 일치율 ≥90%, 대응 action의 onset 차이 ≤100ms 비율 ≥90%. 최종 주석의 onset 불확실성 반폭 ≤50ms. |
| 시간 정렬 | 영상–controller 및 추가 reference 영상의 각 정렬 residual/불확실성 bound ≤50ms. 기준 frame PTS를 확인할 수 있어야 한다. |
| 설치/사용성 | 각 clip의 배치 높이·거리·점유 폭/깊이, 설치 시간(분), 필요한 반복 폰 터치 횟수, 화면/음성 안내 인지 여부, 추가 장비 수/비용을 ledger에 기록. 성능 우위로 환산하지 않는다. |
| 가림 때문에 위 기준 미달 | Foot-side만으로 confirmatory 진행 금지. 별도 reference 시점 또는 observer를 Development pilot 후보로 비교한다. Observer의 반응 시각만으로 ≤50ms를 보장할 수 없으면 onset 정답으로 쓰지 않는다. |

이번에 장비 구매·카메라 구성 확정은 하지 않는다. 다른 배치/추가 센서는 후속 pilot 후보일 뿐이다. 이미 확보된 장비로도 정답을 판독할 수 있는지는 **NOT_EVALUATED**다. 수치 미달을 detector threshold 변경으로 해결하지 않는다.

## 3. 데이터 분리와 고정된 수집 규모 제안

### 3.1 독립성

- 기존 V2 및 4Q/R/S, 모든 관측 가능성/배치/정책 pilot은 **Development/Regression**이다. 원본 결과와 실패 사례를 보존한다.
- 같은 영상의 재추론·재샘플링·filename 변경·baseline 변경은 새로운 holdout이 아니다. 연속 영상의 인접 frame이나 같은 capture의 trial을 양쪽 split에 나누지 않는다.
- 할당 단위는 **session → capture → 그 안의 모든 trial/sequence**다. Confirmatory 세션 전체를 사전에 HOLDOUT으로 할당한다. Capture를 잘라 새 ID를 줘도 같은 split이다. 같은 날 개발 조정 후 남은 영상은 holdout으로 쓰지 않는다.
- 이번 제안은 사용자 내 새 세션 재현성만 다룬다. 다인 일반화를 주장하려면 별도 계획에서 사람 단위 분리 및 사람별 표본 수를 다시 등록해야 한다.
- 개발자는 holdout 영상/landmark/event/score를 후보 동결 전에 열람하지 않는다. 수집 담당자도 score 피드백으로 행동을 바꾸지 않는다. 독립 annotator는 영상만 보고 정답을 잠근다. 혼자 수행해 완전한 blind가 불가능하면 그 한계를 기록하고 독립 annotator 확보 전 confirmatory PASS를 주장하지 않는다.

### 3.2 18 attempts의 고정 계획 — PROPOSED

**3세션, 서로 ≥24시간 간격, 세션당 6 capture attempts**, 순서는 A1→A2→B1→B2→C1→C2. 각 attempt의 분석 구간 E는 독립 start marker부터 **120초 `[0,120000)`**다. Setup/Neutral 보정은 E 이전, 시작 후 detector 상태에 따라 E를 멈추거나 연장하지 않는다. Capture 간 휴식은 최소 180초이며 필요하면 더 길게 쉬고 기록한다. 세션이 끝나면 남은 attempt를 몰아서 다른 세션에 합치지 않는다.

다음 표는 **cue 시각**이며 actual action 정답이 아니다. 잘못 수행하거나 늦게 수행한 동작은 가이드대로 실제 영상을 주석한다. 운동 tempo 제안은 나가기 약 0.5초 → 유지 약 0.5초 → 복귀 약 0.5초이며 이는 detector acceptance threshold가 아니다.

| capture 종류 | E 시작 후 cue onset(초), 신체 side | 세션당 계획 actual 수 | 반복/교대 의도 |
| --- | --- | --- | --- |
| A1, A2 각각 | 6L, 12R, 18L, 24R, 30L, 36R, 42L, 48R | LEFT 8 / RIGHT 8 | 간격 6초의 isolated actions |
| B1, B2 각각 | 6L, 8L / 16R, 18R / 26L, 28L / 36R, 38R | LEFT 8 / RIGHT 8 | LL 4쌍, RR 4쌍 |
| C1, C2 각각 | 6L, 8R, 10L / 21R, 23L, 25R | LEFT 6 / RIGHT 6 | LRL 2회, RLR 2회 |

모든 capture에서 공통으로 80–100초 NEUTRAL, 100–110초 TWIST_LEFT, 110–120초 TWIST_RIGHT를 지시한다. 각 Twist는 약 1초 이동, 8초 유지, 1초 복귀를 의도한다. 나머지 시간도 임의로 버리지 않고 실제 상태를 전부 주석한다. Negative 최소 시간은 cue 길이가 아니라 **실제 판독된 시간**으로 계산한다.

Loss challenge는 C1의 5.0–5.5초 및 19.0–20.5초에 test 카메라 시야를 가리는 과제, C2의 50.0–50.5초 및 65.0–66.5초에 같은 과제를 제안한다. C1은 이후 action, C2는 이후 Neutral을 의도한다. 원본 영상/clock 기록은 계속하고 software pause/새 baseline은 하지 않는다. 동작 정답용 reference 시야는 유지해야 한다. **가림 지시가 실제 detector loss나 실제 Neutral임을 증명하지 않는다.** 실제 loss가 부족하면 INSUFFICIENT이며 원하는 결과가 나올 때까지 추가 시도하지 않는다. 가림 방식·관측 가능성은 먼저 pilot에서 확정한다.

전체 계획은 **LEFT 66 / RIGHT 66**, LL/RR 각각 12쌍, LRL/RLR 각각 6회, 명시적 negative cue 720초, 가림 challenge 12회다. 각 attempt는 시작 시점부터 ledger에 남기며 준비 실패도 포함한다. Neutral 준비는 attempt당 최대 60초, 자동/수동 재보정 반복 없이 한 번 수행한다. 못 끝내면 `SETUP_FAILED`로 보존한다. 중단·artifact 실패·CPU fallback도 실패 attempt로 보존한다. **대체 촬영/추가 attempt 예산은 0**이다. 부족하면 이 batch는 INSUFFICIENT이고 새 등록에서만 재수집한다. 66→최소60의 여유는 주석 불가/실제 수행 차이를 허용하기 위한 것이지 좋은 60개만 선택할 권한이 아니다. 모든 평가 가능한 동작을 사용한다.

### 3.3 기존 capture 기능과의 경계

`STEP_4P_ESTIMATOR_HOLDOUT_V1`과 기존 Guided 22초는 그대로 보존한다. 위 120초 계획이 현재 Guided에 구현돼 있다고 주장하지 않는다. 후속 준비 단계에서 별도 **private sidecar manifest**로 E/cue/sequence/clock anchors를 기록할 수 있어야 한다. V2의 SHA/PTS/readiness 기능을 재사용하되, `VALIDATION_CAPTURE_COMPLETE`를 이 새 recognition protocol의 완료로 해석하지 않는다. 아직 없는 sidecar 기록·blind 재생·scorer 기능의 준비와 검증은 실제 수집 전 필수 관문이다.

4X detector primary는 **LIVE 입력 stream + 실제 저장 production baseline + 실제 clock/reset 기록**이다. 같은 stream의 replay parity를 확인한다. 기존 1초 production Neutral 및 knee grace를 3초 estimator reference로 대체하지 않는다. 별도 reference는 integrity/readiness 자료이며 LIVE baseline과 구분한다. Guided START를 사용하면 발생하는 reset도 manifest에 기록하고 **E 중간에는 Guided START/reset/recalibration을 실행하지 않는다.** E 시작용 marker 자체가 detector를 reset해서는 안 된다.

기존 4Q/R/S의 post-Guided `trialId: null` 이벤트는 기존 집계에서 계속 diagnostic이다. 새 4X에서는 독립적으로 등록된 E와 실제 주석에 속하면 `trialId: null`이어도 채점한다. 과거 결과를 재채점하는 규칙이 아니다. E 밖 이벤트는 별도 diagnostic으로 전부 보존한다.

## 4. 시간·분모·결측에 관한 공통 규칙

- Canonical time은 capture의 **WebM PTS milliseconds**. Controller monotonic clock, reference PTS의 affine mapping/anchors/잔차를 정답·detector 결과를 보기 전에 동결한다. Phone 수신 시각이나 cue 시각으로 onset을 대체하지 않는다. 정렬 방법과 경계는 [가이드](step-4x-ground-truth-guide.md)의 `4X-MATCH-1`을 따른다.
- 모든 E는 반개구간. 전 구간을 NEUTRAL/TWIST/kick cycle/OTHER_MOVEMENT 또는 unknown mask로 partition한다. Unknown은 `UNLABELABLE`과 `ANNOTATION_DISAGREEMENT` 및 `TIMING_UNCERTAIN` 이유를 따로 남기고 합집합 시간도 보고한다.
- **전체 실제 action recall:** 독립적으로 side/onset을 확정한 모든 knee action이 분모다. Pose 없음, knee unusable, detector NOT_READY/WAIT_RETURN, tracking loss, 늦은 event 때문에 action을 제외하지 않는다. GT 자체가 불명확한 경우는 분모를 추정하지 않고 unknown action/slot 수와 시간, 불확실성을 함께 보고한다.
- 조건부 recall은 보조 지표만 허용한다. 각 action의 matching window에서 해당 knee usable 시간이 ≥80%인 action으로 조건을 고정하고 조건부 분자/분모 및 제외 수를 병기한다. **전체 recall 없이 조건부 값만 발표하거나 acceptance에 대신 쓰지 않는다.**
- Coverage는 E 전체의 **시간 비율**을 primary로 한다. 관측 frame i는 `[t_i, min(t_(i+1), t_i+100ms, E_end))`까지만 그 frame의 presence/usability를 갖는다. 첫 frame 전·100ms 이후 공백·missing은 unavailable 시간이다. 이는 측정용 최대 지지 시간이며 detector stale 400ms 변경이나 보간/추가 frame 생성이 아니다. 실제 inference-frame 개수 기반 비율도 별도로 병기한다.
- Pose presence는 결과의 pose 존재 여부다. Knee usability는 기존 `usableKneesV3`: 양 hip visibility ≥.7 및 finite hip center, 해당 knee visibility ≥.5 및 finite knee XY/offsetY. Baseline 부족과 pose 존재/knee usability를 분리한다. Side entry availability는 fresh diagnostics의 `left/rightEligibleNow`를 읽으며, 없는 clock 구간을 READY로 채우지 않는다.
- Raw null/NaN/±Infinity/missing을 0 좌표·중앙값·성공으로 대체하지 않는다. Availability 계산에서는 unavailable로 세되 이유별 건수를 보존한다. 잘못된 event timestamp/side/ID는 별도 `INVALID_EVENT`; 삭제·retime하지 않으며 PASS를 막는다. 동일 ID의 중복 저장은 transport/log duplicate, 다른 ID의 반복 발화는 detector duplicate로 구분한다. ID가 같고 payload가 다르면 무결성 오류다.
- 합산 지표는 capture 분자/분모를 먼저 보존하고 전체 micro 합계, session별, capture별, side별, activity별을 함께 보고한다. 단일 frame을 독립 사람/시행 표본으로 세지 않는다. 분모 0은 `null / INSUFFICIENT`, 비율 0이나 100%가 아니다. Latency는 보간 없는 nearest-rank p50/p95와 max, 표본 수를 사용한다.

모든 비교는 반올림 전 값으로 수행한다. `≥90%`는 정수 성공 수 `ceil(0.90×분모)` 이상을 뜻한다. 예를 들어 12 sequence의 90%는 11개 이상이고, 10개라면 9개 이상이다. Unknown slot ≤5%는 계획132개 중 최대6개이며, 계획 밖 unknown actual action은 추가로 보고한다. 복귀 latency의 유한 값만으로 percentile을 산출할 때는 censored/미복귀 수를 반드시 병기하고, 미복귀0 조건을 따로 적용한다.

## 5. 사전등록 metric 정의 — 모두 PROPOSED

`A_s`는 확정 actual knee action 수, `C_s`는 one-to-one으로 확정 매칭한 same-side event 수, `T_E`는 E 합집합 시간, `T_N/T_TL/T_TR`은 실제 labelable negative 시간이다. 각 metric에는 unknown/NaN/경계 불확실성 수를 나란히 표시한다. 경계가 애매한 결과로 PASS를 만들지 않는 방법은 가이드 5절에 고정한다.

| 지표 | 분자 / 분모 및 단위 | 집계 / 실패·결측 처리 |
| --- | --- | --- |
| 1. LEFT recall | `C_LEFT / A_LEFT`, %, n/N | 전체·각 session/capture. Pose가 없는 실제 LEFT도 분모에 유지, event 없으면 miss. 확정 실제 action ≥60 필요. |
| 2. RIGHT recall | `C_RIGHT / A_RIGHT`, %, n/N | LEFT와 동일, 별도 ≥60. 양쪽 평균으로 한쪽 실패를 숨기지 않는다. |
| 3. Neutral/Twist false | 해당 실제 negative interval의 모든 새 event 수 / 각 interval 시간, events와 초 | Neutral, Twist L, Twist R 따로 집계. Pose loss 중 event도 그대로 false. GT unknown은 `UNSCORABLE_EVENT`, false 0으로 취급하지 않는다. |
| 4. Negative 시간당 false | 위 세 false 합 / `(T_N+T_TL+T_TR)/3600000`, events/hour | 전체와 label별 시간 가중. 시간 최소 미달은 INSUFFICIENT; 0 event/0 시간은 null. |
| 5. Wrong direction | owner knee cycle에서 반대 side event 수 / `(A_LEFT+A_RIGHT)`, events/action 및 count | Action의 miss와 병기한다. Wrong을 correct 또는 다른 action의 event로 재사용하지 않는다. |
| 6. Duplicate | 이미 correct 매칭된 같은 cycle의 추가 same-side 새 event 수 / `(A_LEFT+A_RIGHT)`, events/action 및 count | 첫 correct 이후 hold/return 동안도 포함. Wrong과 배타적 primary category. log 중복은 별도다. |
| 7. Event latency | 각 correct pair의 `eventPTS−actualOnsetPTS`, ms; 분모는 correct pair 수 | Side별 p50/p95/max, `≤500ms` correct 수 / **전체 A_s**도 함께 보고. Miss는 latency null이며 timely 성공 분모에서 빠지지 않는다. 저장 event의 frame timestamp 기준이지 Mobile 수신/실제 dispatch latency는 아니다(후자는 NOT_EVALUATED). |
| 8. Pose coverage | pose-present 지지 시간 / T_E, % | 모든 E, side 공통. Frame가 없는 시간 포함. Capture·kick/negative별 추가 집계; 낮으면 성능 FAIL, 좋은 구간만 남겨 INSUFFICIENT로 회피하지 않는다. |
| 9. Side knee usability | 해당 usable 지지 시간 / T_E, % 및 usable frame 수 / 전체 inference frames | LEFT/RIGHT 각각. NaN·가림·pose missing과 정상 pose의 unusable knee를 분리. Baseline invalid라고 분모를 줄이지 않는다. |
| 10. Tracking loss/reacquisition | episode별 `firstUsable−lossStart`, `firstEligible−firstUsable`, `firstEligible−lossStart` ms; recovery ≤1,000ms 수 / 전체 유효 loss-side episodes | 기존 ≥33ms unusable 또는 ≥400ms frame gap에서 loss. 한 양측 episode는 challenge 건수로 1회, side 지표로는 각각 1회. Usable 복귀와 READY/eligible 복귀를 구분. 끝까지 미복귀는 right-censored, 성공 분자 0이며 생존한 episode만의 평균으로 대체하지 않는다. |
| 11. Rearm availability | actual Neutral에서 side eligible 지지 시간 / actual Neutral 시간, %; 다음 action onset에 해당 side eligible인 수 / 연속 action opportunities | 이전 actual returnComplete→최초 eligible까지 ms도 보고(이미 eligible이면 0). 실제 action 직전 ≤100ms의 신선한 관측이 없으면 unavailable. 전체 sequence의 첫 action 뒤 모든 next-action을 opportunity로 세어 첫 event miss도 제외하지 않는다. |
| 12. 같은 방향 반복 성공 | 두 action 모두 timely correct이고 interval 내 wrong/duplicate/false/late가 없는 LL 또는 RR pair 수 / 모든 판독된 계획 pair 수 | LL/RR 각각 count·%, 최소 각10쌍. 두 onset 간 실제 1,500–2,500ms, 별개 복귀 확인. Pose 누락은 pair 실패. Cue 수행 자체가 불명확하면 performance miss와 분리해 execution/GT failure로 보존. |
| 13. 좌우 교대 성공 | 세 action 모두 timely correct이고 interval 내 extra event 없는 LRL/RLR 수 / 모든 판독된 계획 triplet 수 | 전체 및 시작 side별, 최소 총10회(각5회). 각 실제 onset 간 1,500–2,500ms. 실제 순서/tempo 위반은 실행 편차로 기록하고 최소 수 충족에 쓰지 않지만 개별 actual action은 전체 recall에 유지. |
| 14. INSUFFICIENT | 부족/불명확 capture·action slots·time·loss episode 수 / 각각 계획 18 attempts·132 knee cues·전체 E·12 challenges | 단일 accuracy 값이 아니라 사유 벡터. 조기중단, integrity/sync 오류, baseline/GT 부족, 알려진 failure를 각각 보고. 알려진 recall/false FAIL을 INSUFFICIENT로 덮지 않는다. |

Reacquisition episode의 `lossStart`는 첫 unusable frame 시각 또는 gap 직전 frame 시각이며, timestamp가 같은 episode들은 같은 원인임을 증명하지 않는다. 각 episode는 usable 복귀 후 최소 2,000ms 관측이 필요하다. 미복귀는 최소 loss 시작 뒤 3,000ms 관측했으면 실패로 확정하고, 더 일찍 E가 끝나면 censored/자료 부족이다. `firstEligible`은 상태 로그에서 읽는 값이며 자동으로 `firstUsable`과 같다고 두지 않는다. 집계용 freshness 100ms 바깥은 unknown/unavailable이고 새로운 loss frame을 detector에 넣지 않는다.

Distinct loss는 사전 계획 challenge에 연결된 양측 loss interval의 합집합으로 센다. 추가 자연 loss도 모두 보고하되 두 겹친 side loss를 두 challenge로 부풀리지 않는다. Neutral 복귀 challenge는 firstUsable 뒤 2,000ms 동안 실제 NEUTRAL이 판독되는 것, action 복귀 challenge는 그 2,000ms 안에 실제 knee onset이 있는 것이다. 다른 경우는 OTHER_RECOVERY로 남긴다. `POST_REACQUISITION` source tag와 별도로 firstUsable 뒤 `[0,2000ms)`의 false를 집계한다. 오래전 재획득 태그를 직전 tracking jump의 증거로 쓰지 않는다.

Sequence의 event 감사 interval은 첫 actual onset부터 마지막 actual returnComplete까지이며 끝은 제외한다. Next-action availability는 각 sequence 첫 action 다음의 모든 actual onset에서 **그 다음 동작 side**를 평가한다. Rearm delay는 각 실제 returnComplete에 해당했던 side의 최초 eligible 관측까지이며, 다음 동작이 시작됐다는 이유로 기다리던 episode를 삭제하지 않는다. Loss 안전성의 “event 금지”는 전체 pose 부재 또는 **event를 낸 side**의 unusable/stale 구간에 적용한다. 반대 다리만 LOST인 경우 정상 side event까지 금지하는 새 bilateral 정책은 아니다.

## 6. 수치안과 acceptance

다음은 **PROPOSED**, 과거 V2의 1/1에서 추정한 목표가 아니다. 사용자 검토 후 새 데이터 이전에 동결한다. 초기에 허용하기 어려운 잘못된 입력을 엄격히 막되, 소규모 feasibility 이상의 제품 정확도 주장은 하지 않기 위한 기준이다.

| 항목 | 제안 기준 | 이유와 한계 |
| --- | --- | --- |
| 실제 action 규모 | LEFT ≥60, RIGHT ≥60, 각 세션 각 side ≥18; 계획 각66 | 각 side 독립 gate 및 세션별 편차를 보고할 표본. 60개는 소규모이며 같은 사용자·capture 내 상관이 크다. 다인 정확도 추정 불가. |
| Negative exposure | 총 ≥600초: Neutral ≥300초, Twist L/R 각각 ≥150초 | Pose가 없는 negative도 GT가 있으면 포함. 계획 공통 cue 720초. 10분 무오탐도 시간당 실제 false rate가 0임을 뜻하지 않는다. |
| Recall / latency | side별 전체 recall ≥90%; side별 전체 actual의 timely correct(0–500ms) ≥90%; correct latency p95 ≤500ms | 60 action에서 54 timely가 최소. 500ms는 TEST 이후 입력의 초기 반응성 예산 제안이지 제품 검증 결과가 아니다. |
| Matching window | `[onset, onset+1000ms)`를 actual returnComplete/다음 actual onset에서 먼저 절단 | 느린 event와 miss를 구분할 1초 기록 범위. 500–1000ms event가 matching돼도 timely 성공은 아니다. |
| 잘못된 추가 입력 | Neutral false =0, Twist false =0, wrong =0, duplicate =0, LATE_UNMATCHED =0, OTHER_FALSE/UNASSIGNED_EXTRA =0, invalid event =0 | 초기 score 없는 shadow로도 불필요한 입력을 허용하지 않는 보수적 gate. LATE_CORRECT는 extra가 아니지만 timely/latency gate를 따로 적용. 영구적인 무오탐 보증이 아니다. |
| Loss 안전성 | loss/stale 중 event=0, cross-gap confirmation=0; reacquisition 후 negative false=0 | 4S 위험을 별도 감사. 이벤트 source tag만으로 재획득 인과를 주장하지 않는다. |
| Coverage | E 전체 및 각 capture pose ≥95%; 양쪽 knee usability 각각 ≥90% | 좋은 평균으로 실패 capture를 가리지 않음. 100ms 지지 시간 정의로 inference 공백도 비용으로 포함. |
| Availability | side별 Neutral eligible 시간 ≥90%; next-action eligible ≥90%; returnComplete 이후 eligible 지연 p95 ≤1000ms, 2000ms 내 미복귀 0 | S2처럼 false 감소 대가로 다음 동작을 못 받는 정책을 차단. 1초/2초는 검증용 초기 UX 예산이다. |
| 연속 성공 | LL ≥10쌍, RR ≥10쌍, 각각 성공률 ≥90%; 교대 ≥10회(각 시작 side ≥5회), 성공률 ≥90% | 계획 LL/RR 각12 및 교대12. 2초±0.5초 onset 간격의 제한된 검증이며 더 빠른 운동으로 일반화하지 않는다. |
| Loss 자료 | 실제 distinct loss/recovery ≥12회, side별 ≥6회, 실제 Neutral 복귀 ≥6회 및 action 복귀 ≥6회 | 두 위험을 모두 노출. 의도한 카메라 가림을 실제 loss로 자동 계수하지 않음. 부족하면 추가 선별 촬영 대신 INSUFFICIENT. |
| Recovery | 각 side `firstEligible−firstUsable ≤1000ms` 비율 ≥90%, p95 ≤1000ms; 충분히 관측된 2000ms 내 미복귀 0 | Usable만 돌아와도 entry가 막힐 수 있어 두 시각을 나눔. Duration null/censored는 성공이 아니다. |
| GT / sync | labelable E 시간 ≥95%; unknown actual-action slots ≤5%; 초벌 label 일치 ≥90% 및 onset 차이 ≤100ms 비율 ≥90%; sync bound ≤50ms, onset 반폭 ≤50ms | GT 품질 관문. 최종 unresolved는 추정하지 않음. 최대 합산 timing uncertainty 100ms로 경계 성공을 보수적으로 다룸. |
| 운영/자료 완전성 | 계획 18 attempts 모두 ledger에 기록, 세션 3개, 재촬영 0; 모두 valid artifact 및 primary baseline/clock 확보 | Artifact/로그 손실로 event 없음과 detector 침묵을 혼동하지 않는다. 실패 attempt를 제외하고 green 결과만 택하지 않음. |

**판정 순서:**

1. `FAIL`: 판독·시간 정렬 가능한 관측에서 금지 event 또는 수치 하한 위반이 확인되면 FAIL이다. Baseline이 없어도 실제 동작/시간이 관측됐다면 miss/unavailable 비용을 보고한다. Coverage/recall 부족을 자료 부족으로 바꿔 숨기지 않는다.
2. `INSUFFICIENT`: 알려진 failure와 별도로 규모/independence/integrity/GT/baseline/clock 부족 또는 uncertainty로 결론을 확정할 수 없는 항목을 기록한다. E 안의 UNSCORABLE_EVENT가 하나라도 있으면 false0을 확인할 수 없으므로 PASS를 막는다. 충분한 반증은 `FAIL + insufficiency flags`; 반증 없이 부족하면 INSUFFICIENT다.
3. `PASS_FOR_SCORELESS_SHADOW`: 모든 규모/품질/성능/회귀 관문을 만족할 때만 가능하다. Timing uncertainty의 가장 불리한 허용 해석에서도 gate를 만족해야 한다. 기준을 넘을 가능성이 남으면 INSUFFICIENT다. 현재 결과가 아니며 production/game 승인과 다르다.

전부 silence인 detector는 actual recall/timely success/sequence success가 0이므로 FAIL이다. 데이터가 없으면 INSUFFICIENT다. False=0 하나만으로 PASS할 수 없다. 18 attempts/132 계획 actions는 feasibility 예산이며 독립 베르누이 시행 132개로 간주하지 않는다. 비율의 n/N와 세션별 편차를 우선 보고하고 사후에 confidence 목표를 바꾸지 않는다.

## 7. 후보와 분석 동결 / 변경 절차

첫 평가 제안은 **한 개 고정 후보**다. 현재 V3를 평가하면 다음 source 값을 그대로 등록하며, 안전 후보로 승인됐다는 뜻은 아니다. Development에서 후보를 바꾸면 새 source/config를 정확히 등록한 뒤 새 holdout에 한 번 평가한다. Holdout에서 여러 후보를 골라 최고 점수를 보고하지 않는다.

현재 읽기 전용 기준:

- [KneeKickDetectorV3](../apps/controller-web/src/pose/kick/kneeKickDetectorV3.ts): evidence `abs(deltaDyNorm)`, landmark identity side, enter `.40 / 50ms`, clear `<.25 / 100ms`, tracking loss `33ms`, stale `400ms`, hip `.7`, knee `.5`. [공유 상수](../apps/controller-web/src/pose/kick/kneeKickDetector.ts)의 최소 bodyScale `.01`. 동시 후보 arbitration과 epoch/reset semantics도 source 전체 hash로 잠근다.
- [baseline builder](../apps/controller-web/src/pose/kick/kneeKickBaselineV3.ts): 양쪽 usable samples 각각 ≥20, 기존 production bounded Neutral 및 freeze. [4P reference](../apps/controller-web/src/capture/estimatorValidationProtocol.ts)는 3초/60/8 joints로 별개다.
- [MediaPipe 설정](../apps/controller-web/src/pose/createPoseLandmarker.ts), [asset 상수](../apps/controller-web/src/pose/poseConstants.ts): tasks-vision `1.0.1`, Full float16 asset version `1`, VIDEO, numPoses1, detection/presence/tracking 각 `.5`, segmentation false. Primary delegate **GPU**. 현재 CPU fallback 코드는 유지하되 CPU attempt를 GPU 표본에 섞지 않고 `OUT_OF_REGISTERED_ENVIRONMENT`로 보존한다.
- Primary는 LIVE다. 저장 LIVE replay는 parity 검증용이며 독립 인식 표본이 아니다. FULL_VIDEO 재추론 등 estimator 비교를 추가하려면 별도 사전등록이 필요하다. Offline 결과를 LIVE latency로 보고하지 않는다.

수집 전에 Git 밖의 변경 불가 registration manifest에 다음 실값을 채운다. 현재 검토 HEAD는 위에 기록했지만 **미래 후보/analysis hash나 승인 시각을 지금 발명하지 않는다.** 미기입 필드가 있으면 등록 미완료다.

| 필수 항목 | 동결 내용 |
| --- | --- |
| 승인/등록 | 사용자 승인 기록, UTC `registeredAt`, plan/guide version 및 두 SHA-256, protocol ID, 서명자/수집·주석·분석 담당 역할 |
| 실행 구현 | source commit SHA, dirty diff 없음을 확인하거나 승인된 정확한 patch hash, detector 버전/source dependency hashes, baseline/reset/clock semantics |
| Estimator | package/lockfile, model·WASM bytes SHA 및 URL/version, 실제 delegate, options 전체, browser/OS/GPU/camera ID 및 실제 width/height/fps |
| 분석 | scorer/replay/coverage 코드와 dependency SHA, matching `4X-MATCH-1`, 예제 검증 결과, acceptance 표 전체, clock mapping 방법/오차 규칙 |
| 설계 | participant/session/capture/trial ID와 split, 배치 수치, 위 cue schedule, 18 attempts/재촬영0, E/anchors/휴식/중단 규칙, annotation blind·adjudication 담당 |
| 수집 후 append-only | 모든 attempt 시각/성공·실패 사유, 실제 배치 편차, WebM/JSON/reference/annotation/clock SHA 및 bytes/PTS manifest, 원본 경로, 접근 이력 |

Freeze 이후 코드/config/model/camera 범위/label 정의/매칭/수치 변경이 필요하면 **중단 → 기존 등록 보존 → 변경 이유와 새 버전/hash/사용자 검토 → 새 등록** 순서다. 결과나 raw를 한 번이라도 탐색한 holdout은 다음 정책의 Development/Regression으로 이동한다. 아직 열람하지 않은 자료도 변경된 조건과 호환된다는 사전 증거가 없으면 새 confirmatory batch로 대체한다. 기존 실패 batch와 ledger를 삭제하지 않는다. 기준을 재해석해 같은 holdout을 다시 PASS시키지 않는다.

## 8. 반드시 보존할 regression과 안전성 감사

| 기존 위험 | 보존 자료 / 새 독립 평가의 질문 |
| --- | --- |
| LIVE/VIDEO LEFT divergence, Neutral false | 4Q/4R 원본 집계·private raw·baseline·parity 보존. 실제 GT에 맞는 LEFT 검출/Neutral false인가를 새 자료에서 분리한다. |
| 재획득 후 sustained fake high-Y | 4S S1 synthetic FAIL 그대로 보존. 실제 Neutral 복귀의 post-loss false와 action 복귀 miss를 함께 보고한다. |
| Bilateral clear의 다음 킥 누락 | 4S S2의 opposite `.30` tail 및 연속 킥 FAIL 보존. 실제 next-action eligibility/LL/RR/LRL/RLR을 확인한다. |
| Missing/NaN, loss, stale gap | 값 대체 금지, pose loss 중 event 금지, loss/gap 전 epoch/evidence 재사용 금지를 기존 synthetic 회귀로 검증한다. |
| Clock 역행/중복, reset/recalibration | 기존 테스트·event identity·clock 로그 보존, 순서 오류를 조용히 정렬해 detector에 재주입하지 않는다. |

Synthetic PASS는 실제 운동 정답을 대신하지 않는다. 새 후보는 과거 observation report를 덮어쓰지 않고 version별 regression 결과를 추가한다. Production source와 4S 정책을 이번 문서 때문에 바꾸지 않는다.

## 9. 후속 관문 — 이번 STEP에서 실행하지 않음

| 단계 | 시작 조건 | 완료 조건 |
| --- | --- | --- |
| 1. GT 관측 가능성 pilot | 사용자 검토 및 pilot 범위 승인, private ledger/두 annotator 준비 | 2절의 판독·sync·설치 기준 통과 또는 실패 근거 기록. Pilot은 모두 Development. |
| 2. 필요 시 배치/센싱 Development | Pilot 한계가 명확함 | 동일 과제에서 양측 관측과 설치 비용 평가, 하나의 대상 환경 선택. Superiority를 전제하지 않음. |
| 3. 후보/평가 도구 동결 | GT 가능성 확보, regression/sidecar/scorer 준비 | Source·model·config·clock·guide·matching·수치·attempt ledger·승인 시각 모두 등록. 예제/경계 scorer 검증과 기존 회귀 통과. |
| 4. 미열람 독립 holdout | 위 등록 완료, 3세션 전체 사전 할당, blind annotation 가능 | 모든 18 attempts 보존, 독립 주석 먼저 동결, 이후 한 번 primary 평가. PASS/FAIL/INSUFFICIENT와 분모 공개. |
| 5. 점수 없는 Pose shadow | `PASS_FOR_SCORELESS_SHADOW` 및 해당 후속 작업 승인 | 새 session에서 detector와 game scoring 분리, readiness/stale/reset/source/잘못된 side/latency 전파 확인. 점수·운동 기록을 생성하지 않음. |
| 6. 게임 입력 연결 | Shadow 검증 보고와 **별도 사용자 승인**, 허용 환경/중단 조건 확정 | 별도 Pose adapter 계약·source gate·중복/시각 검증·회귀·실기기 E2E. TEST와 실제 운동 입력을 구별. |

계획을 작성한 것 자체는 어떤 관문의 자동 승인도 아니다. 소규모 한 사용자 PASS로 Steam 제품 전체 정확도, 카메라 인과, estimator superiority를 주장하지 않는다. Raw WebM/landmark/개인 식별 자료는 Git 밖에 유지하고 public 산출물은 승인된 집계만 사용한다.

## 10. 이번 문서 작업의 검증 경계

산출물은 이 plan과 [ground-truth guide](step-4x-ground-truth-guide.md) 두 파일뿐이다. 검토 HEAD 일치와 시작 시 clean 상태를 확인했다. 기존 증거/source와 상호 수치를 대조하고, 가상 timestamp 예제의 owner/window/500ms·1000ms 경계 및 cue 표본 수 계산을 검토했다. 실제 detector나 과거 capture를 실행한 결과는 아니다.

문서 검증 결과: 로컬 링크 **20개**(anchor 포함) 유효, 기존 tracked 파일 **303개 SHA-256 모두 불변**, 추가 파일은 요청한 두 문서만 존재한다. `git diff --check`와 미추적 두 문서의 별도 `--no-index --check`에서 whitespace 오류가 없었다. 문서 작업이므로 전체 test/typecheck/build 및 모델/분석 실험은 재실행하지 않았다. 결과 수집이나 performance PASS를 보고하는 문서가 아니다. Commit/push 하지 않았다.

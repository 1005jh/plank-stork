# STEP 4X — Actual-Motion Ground Truth Guide

작성일: 2026-10-14 · 검토 HEAD: `a681c427c549583191f6b5470872d1fb9bf9bbef`

**PROPOSED / 사용자 미승인 / NOT REGISTERED.** 가이드 `4X-GT-1`, matching `4X-MATCH-1`. [Recognition Validation Plan](step-4x-recognition-validation-plan.md)의 표본·수치·acceptance와 함께 승인·SHA 동결해야 한다. 이 문서는 annotator/scorer의 절차 제안이며 촬영·추론·자동 동작 판정 구현이 아니다.

## 1. 정답의 출처와 좌우

정답은 **영상에서 독립적으로 관측한 실제 동작**이다. Guided stage, cue, controller target, keyboard/script, detector label·landmark·normalized Y·threshold crossing은 정답이 아니다. 사용자가 지시를 늦게 수행하거나 반대쪽으로 수행하면 실제 동작을 적는다. Cue는 이후 별도 execution-adherence 분석에만 사용한다.

좌우는 사용자의 해부학적 신체 기준이다. 미러 화면의 왼쪽/오른쪽, image X 부호, MediaPipe landmark ID를 보고 신체 side를 결정하지 않는다. Foot-side 영상의 screen-left가 body-left라는 가정을 하지 않는다. Pilot에서 카메라 방향과 신체 side를 확인할 짧은 orientation 구간을 정답용 영상에 남기고 annotator에게 동일한 orientation key를 준다. 필요하다면 비센싱 색상 표시도 pilot 후보이나 이번에 부착·구매·확정하지 않는다. Side를 확인할 수 없으면 UNLABELABLE이다.

원본은 미러링/overlay 없는 영상과 native PTS를 보존한다. Reference camera를 쓰면 detector가 그 영상을 입력으로 받지 않도록 분리한다. 원본 foot-side 영상만으로 side/onset/return이 충분히 보이는지는 **NOT_EVALUATED**이고 [plan 2절](step-4x-recognition-validation-plan.md#2-최초-검증의-대상과-관측-가능성-pilot)의 pilot으로 결정한다.

## 2. 행동과 경계 주석

아래는 새 실험의 조작적 정의다. 과거 Guided 수행이 이 정의와 일치했다고 소급하지 않는다. 운동 자세의 의학적 적절성이나 효과를 판정하지 않는다. Landmark 좌표/각도 threshold로 육안 정답을 만들지 않는다.

| label / 필드 | 영상에서 확인할 사실 |
| --- | --- |
| NEUTRAL | 등록된 시작 플랭크 자세로 돌아와 의도적인 knee 이동/골반 twist가 없는 구간. 호흡·작은 자연 흔들림만으로 kick을 만들지 않음. |
| TWIST_LEFT | 골반의 **신체 왼쪽 측면을 바닥 방향으로 내리는 회전**과 복귀. Knee를 옆구리 방향으로 끌어오는 독립 knee cycle이 없어야 함. |
| TWIST_RIGHT | 위 동작의 신체 오른쪽. 화면 방향과 분리. |
| KNEE_LEFT | 왼쪽 무릎을 굽혀 왼쪽 옆구리/팔꿈치 쪽으로 전진·옆 이동시킨 뒤 등록된 플랭크 위치로 복귀하는 식별 가능한 cycle. 골반만 회전하거나 발만 흔드는 것은 해당하지 않음. |
| KNEE_RIGHT | 위 동작의 신체 오른쪽. 가려진 쪽을 반대쪽 움직임으로 추정하지 않음. |
| OTHER_MOVEMENT | 동작은 보이지만 위 class가 아닌 자세 변경/중단/자리 조정. Knee false를 숨기지 않도록 이 구간 event도 extra로 보존. |
| onset | 동작 방향으로 시작하는 **최초 관측 가능한 변화 frame**. 다음 100ms의 관측으로 같은 excursion이 이어졌음을 확인하고 onset을 첫 frame으로 되돌려 표기. 보조 확인은 offline 주석에만 쓰며 detector에 미래 frame을 주지 않음. |
| holdStart / holdEnd | outward 이동이 끝나 유지하기 시작한 시점 / 되돌아가기 시작한 시점. 유지 구간이 없는 실제 동작이면 `null, noHold: true`; onset/side/cycle이 명확하면 actual action에서 제외하지 않음. |
| returnStart / returnComplete | 복귀 움직임의 시작 / 등록된 Neutral 형태로 돌아온 첫 frame. returnComplete는 뒤 100ms의 관측으로 확인하고 첫 frame에 표기. Capture 종료로 확인할 수 없으면 `truncated`와 uncertainty를 남김. |

경계는 `onset ≤ holdStart ≤ holdEnd = returnStart ≤ returnComplete`를 기본으로 한다. Hold 없는 동작은 hold 필드 null, 실제 returnStart만 쓴다. 비정상 순서로 숫자를 맞추지 않는다. Onset/return은 가능하면 `[lastClearlyBeforePTS, firstClearlyAfterPTS]` bracket과 midpoint를 함께 저장한다. Native frame 간격도 bracket에 포함하며 정밀도가 부족한 값을 소수점으로 그럴듯하게 만들지 않는다.

**주석 단위와 반복:**

- 각 knee cycle은 고유 actionId를 갖는다. Same-side 반복은 첫 cycle의 복귀와 ≥100ms의 관측 가능한 Neutral 확인 후 새 excursion이 보여야 별개 action이다. 같은 hold에서 떨림·detector 재발화가 있더라도 새 action을 만들지 않는다.
- Opposite-side 연속은 각 무릎의 별개 excursion/복귀가 보이면 side별 action으로 분리한다. Neutral hold가 짧아도 side/onset을 분리할 수 있으면 기록하되, 겹친 동작은 multi-action ambiguity flag를 남긴다. 실제 동시 knee/twist 혼합을 임의 단일 정답으로 만들지 않는다.
- 판독 가능한 동작의 timing이 cue와 다르더라도 전체 actual recall에 포함한다. 등록된 반복/교대 sequence success에는 실제 side 순서와 onset 간격 **1,500–2,500ms**를 만족하는 sequence만 분모로 쓰고 execution 편차 수도 별도 보고한다. 원하는 cadence만 사후 선택하지 않는다.
- 완전한 정답 partition은 모든 E 시간에 존재해야 한다. Twist outward/hold/return은 TWIST, knee outward/hold/return은 knee cycle로 표시한다. 두 cycle 사이 actual Neutral은 NEUTRAL이다. Transition을 blank로 두어 false 평가를 피하지 않는다.

## 3. UNLABELABLE과 ANNOTATION_DISAGREEMENT

| 상태 | 적용 | 결과 처리 |
| --- | --- | --- |
| UNLABELABLE | 가림·프레임/영상 손실·orientation 부재·모호한 혼합 동작 등으로 원자료만으로 actual class/side/onset을 판독할 수 없음 | 이유, `[start,end)`, 알려진 필드와 모르는 필드, 관련 cue slot만 기록. 지시 label로 채우지 않음. |
| ANNOTATION_DISAGREEMENT | 두 annotator가 독립적으로 서로 다른 class/side/boundary를 제출했고 blind adjudication으로도 해소하지 못함 | 양쪽 원안/근거와 adjudication 결과를 모두 보존. UNLABELABLE과 별도 건수·시간. 다수결을 위해 detector를 보지 않음. |
| TIMING_UNCERTAIN | 행동은 보이지만 onset 반폭 >50ms, sync bound >50ms 또는 합산 bound >100ms | Action 존재/side count는 descriptive로 유지, 확정 timestamp matching은 하지 않음. Unknown action slots와 시간에 포함하여 acceptance 부족을 숨기지 않음. |

관측 불가와 사람 사이 불일치는 다른 문제다. 겹치는 원인은 multi-flags로 남기고 전체 unknown 시간은 합집합으로 한 번만 센다. `AMBIGUOUS_MOTION`은 UNLABELABLE의 사유이며 ANNOTATION_DISAGREEMENT와 동의어가 아니다. Raw NaN은 주석상의 Neutral이 아니다.

부분적으로만 알려진 action은 actionId와 알려진 side/구간을 보존하되 확정 recall 분모를 조용히 늘리거나 줄이지 않는다. 보고서에는 `confirmed actual count`, `known-side but timing unknown count`, `unknown-side action/slot count`, `labelable/unknown duration`을 분리한다. Pose가 사라져도 reference에서 actual action을 판독할 수 있으면 **확정 actual action**이며 전체 recall 분모에 남는다.

Acceptance 제안은 labelable E ≥95%, unknown action slots ≤5%다. Action slot 분모는 계획 132 knee cues이며, cue와 무관하게 관측된 불명확 actual action은 별도 추가 count로 보고한다. Slot의 actual 수행 여부를 확정하지 못하면 unknown으로 센다. Known omitted cue는 실제 action을 꾸며 넣지 않고 execution omission으로 기록한다. 최소 실제 LEFT/RIGHT ≥60을 별도로 충족해야 한다. 계획 밖 unknown action이 하나라도 acceptance를 뒤집을 수 있으면 INSUFFICIENT다.

E 안에 UNSCORABLE_EVENT가 있으면 false0을 확인할 수 없으므로 PASS할 수 없다. Unknown 시간/slot 비율이 5% 이하라는 이유로 그 event를 삭제하지 않는다. 이미 확정된 failure가 있으면 FAIL과 insufficiency 사유를 함께 보고한다.

## 4. Blind annotation과 시각 동기화

### 4.1 순서

1. 수집 담당자가 attempt ledger 및 WebM/JSON/reference SHA·PTS를 보존한다. 파일명은 익명 capture ID로 주고 outcome을 이름에 넣지 않는다. E/clock anchor와 orientation key는 제공하되 detector trace·score·Guided 기대 label은 제공하지 않는다. 음성 cue가 원영상에 있으면 원본은 보존하고 주석 viewer만 mute한다.
2. 두 annotator가 **모든 E**를 독립 주석한다. 전체 속도로 맥락을 확인하고 frame step으로 경계를 적는다. Landmark overlay를 보여주지 않는다. 타인의 주석도 먼저 보지 않는다.
3. 자동/수동 비교는 actual onset 순서대로 nearest onset ≤500ms의 미사용 action을 일대일로 대응하고, 동률은 이른 onset/actionId 순서로 고정한다. Class/side는 이 비교의 매칭 조건으로 쓰지 않는다. Unmatched annotation도 불일치다. 초벌 label 일치율은 class+side 일치 쌍 / (모든 대응 쌍+양쪽 unmatched 합), onset 차이 ≤100ms 비율은 label 일치 쌍 중 해당 쌍 비율이다.
4. ≥90% label 일치 및 ≥90% onset 차이 기준을 확인한다. 미달하면 주석 방법 품질은 INSUFFICIENT이며 detector 점수를 보고 가이드를 고치지 않는다. 제3 adjudicator가 detector-blind로 차이를 검토하고 최종 경계/미해결 이유를 남긴다. 최초 불일치율은 해소 후에도 보고한다.
5. 최종 annotation/unknown masks/clock mapping의 SHA·시각·버전을 잠근 뒤에만 detector event를 열고 scoring한다. 같은 사람이 이미 detector 결과를 봤으면 annotator blind 조건 위반을 ledger에 적고 독립 주석 절차를 먼저 보완한다.

### 4.2 시간 규칙

- 기준은 원본 test WebM PTS ms다. Capture별 시작·중간·끝의 **3개 이상 독립 anchor**, 인접 anchor ≤60,000ms를 계획한다. Controller clock↔WebM 및 reference↔WebM 각각에 대해 `t_webm = a*t_source+b`를 기록한다. 첫/끝 anchor로 affine mapping을 계산하고 중간/추가 anchor로 검사한다. Detector/동작 event에 맞춰 offset을 최적화하지 않는다.
- Anchor는 reference/test 영상과 해당 monotonic log에서 대응이 검증 가능한 신호여야 한다. SHA 일치나 Guided START가 시간 정확도 ≤50ms를 자동 증명하지 않는다. 현재 capture metadata만으로 보장되지 않으면 후속 도구/pilot에서 먼저 입증해야 한다. 단순 observer 버튼 누름/말소리 반응 지연을 0으로 가정하지 않는다.
- Frame quantization과 anchor 판독 불확실성을 포함한 mapping bound **≤50ms**, 최종 annotation onset 반폭 **≤50ms**, 합산 **ε≤100ms**를 요구한다. 원본 PTS를 resample하거나 gap을 보간하지 않는다. 단위/clock domain이 불명확하면 NOT_COMPARABLE/INSUFFICIENT다.
- Capture의 mapping bound가 기준을 넘으면 그 capture의 event latency/recall confirmatory matching을 보류하고 UNSCORABLE로 보존한다. 결과가 좋은 구간만 따로 새 window로 잘라 PASS시키지 않는다.
- Replay event time은 입력 frame 시각일 수 있다. 여기의 latency는 등록된 event timestamp와 actual onset 차이다. 실제 사용자에게 보이는 Mobile 반응 지연을 측정한 것으로 소개하지 않는다.

## 5. `4X-MATCH-1` one-to-one 규칙

Matching/owner 규칙은 annotation을 잠근 뒤 적용하는 **사후 scorer**다. Detector에는 stage label, actual onset, future frame을 제공하지 않는다. 이 단계에서는 scorer를 구현하지 않는다.

### 5.1 Owner와 window

1. 각 capture E에 대해 actual actions와 unknown/negative partition을 시간순으로 고정한다. Event는 원본 ID·시각·발생 순서를 보존한다. Scorer에서 비교를 위한 `(timestamp, originalIndex)` 순서를 쓰더라도 detector replay에 정렬된 새 stream을 주입하지 않는다. 동일 event ID+payload는 log duplicate로 한 번만 채점하고 충돌 ID는 integrity 오류다.
2. Knee action i의 **cycle owner interval**은 `[onset_i, min(returnComplete_i, nextActualKneeOnset, E_end))`다. Return 미완료는 E_end까지이되 `truncated`를 남긴다. 다음 독립 actual onset이 경계를 자른다는 규칙을 사전에 고정한다. 두 action이 판독상 분리되지 않는 동시/겹침 구간은 ambiguity mask로 처리한다.
3. Event의 owner는 그 시각을 포함하는 actual knee interval 하나뿐이다. 첫 event 이후에도 owner를 다른 action으로 바꾸지 않는다. 최대 matching window는 **`[onset_i, min(onset_i+1000ms, ownerEnd))`**다. Onset 포함, 끝 제외다. Negative/unknown mask를 관통하거나 이전 action으로 되돌아가 매칭하지 않는다.
4. 수학적으로 두 onset+1000 window가 겹쳐도 ownerEnd로 잘리므로 event는 하나에만 속한다. 늦은 이전 action event를 다음 action의 성공처럼 재사용할 수 있는 한계는 event만으로 완전히 해결되지 않는다. 이 규칙은 시간적 대응이며 생물학적 원인 증명이 아니고, 그러한 ambiguity는 주석 mask/sequence extra-event 감사와 함께 보고한다.

### 5.2 Event 하나당 primary category 하나

아래 우선순위를 고정한다. 동일 event를 correct/wrong/false에 중복 계수하지 않는다. Tracking/cross-gap/source는 별도 감사 태그로 교차 집계할 수 있다.

| 우선순위 | 조건 | 결과 |
| --- | --- | --- |
| 1 | timestamp/side/ID가 유효하지 않음 | INVALID_EVENT; PASS 불가. NaN을 time 0으로 바꾸지 않음. |
| 2 | E 밖 | OUTSIDE_E_DIAGNOSTIC. E 끝과 정확히 같은 event도 밖이다. |
| 3 | unknown/불일치/시간 판독 불가 mask | UNSCORABLE_EVENT. Correct나 false 0으로 편입하지 않음. |
| 4 | actual NEUTRAL 또는 TWIST interval | NEUTRAL_FALSE / TWIST_LEFT_FALSE / TWIST_RIGHT_FALSE. 이전 knee의 1초 window가 남았더라도 복귀 완료 이후 negative가 우선한다. |
| 5 | owner knee와 반대 side | WRONG_DIRECTION. Owner는 unmatched이면 여전히 miss; 나중 same-side correct는 가능하나 wrong은 사라지지 않음. |
| 6 | owner knee의 same-side, 이미 correct가 있음 | DUPLICATE. 1초 window 뒤라도 같은 cycle hold/return이면 duplicate. 다른 ID의 추가 event가 대상. |
| 7 | same-side, 아직 correct 없음, matching window 안 | CORRECT 1회. Latency `0–500ms`이면 TIMELY, `>500–<1000ms`이면 LATE_CORRECT. 후자는 overall recall에는 포함하되 timely 성공 아님. |
| 8 | owner는 있으나 1초 window가 끝났고 아직 correct 없음 | LATE_UNMATCHED; action은 miss. |
| 9 | 나머지 보이는 OTHER_MOVEMENT 등 | OTHER_FALSE/UNASSIGNED_EXTRA. Neutral/Twist rate와 별도로 보고하고 추가 입력 0 gate에는 포함. |

Event가 없으면 matching은 만들지 않는다. 확정 actual action은 MISS로 남고, no-pose/side-unusable/NOT_READY/WAIT_RETURN/late 등 원인을 함께 기록한다. Wrong 후 correct가 하나 생기면 action recall은 1이지만 wrong=1이어서 acceptance는 FAIL이다. 여러 frame의 같은 `lastEvent` snapshot을 여러 독립 event로 세지 않는다.

### 5.3 Timing uncertainty

위 nominal count와 별도로 ε bound를 적용한다. Event/onset/return/window/E 경계, 500ms timely 경계의 오차 구간이 겹치면 `BOUNDARY_UNCERTAIN`으로 표시한다. 확정되지 않은 pair를 definite-correct 분자에 넣지 않는다. 전체 actual 분모는 유지하고 possible-correct/possible-false/possible-wrong·duplicate와 latency 범위를 함께 낸다.

Acceptance는 허용 오차 내 가장 불리한 해석에서도 6절 gate를 만족할 때만 PASS할 수 있다. 적어도 한 해석이 FAIL이고 다른 해석은 PASS면 INSUFFICIENT, 모든 해석에서 금지 event가 남거나 하한 미달이면 FAIL이다. 같은 event를 오차 해석마다 누적해 가상의 event 수를 늘리지 않는다. 경계별 가능한 owner/window 분류의 조합을 one-to-one 제약 안에서 검토하는 scorer가 준비돼야 하며, 아직 준비되지 않았다면 uncertainty 있는 자료로 confirmatory 평가를 시작하지 않는다.

## 6. 손으로 검토할 timestamp 예제

아래는 실제 capture가 아닌 **문서 규칙 검토용 가상 ms timeline**이다. 별도 표기가 없으면 annotation/sync ε=0인 이상적인 예제로 경계 포함/제외를 명확히 한다. 실제 영상의 ε를 0이라고 가정하라는 뜻이 아니다. 각 사례는 독립적이며 event IDs는 모두 다르다.

| 사례 | Actual / event timeline (ms) | 채점 결과 |
| --- | --- | --- |
| 첫 correct와 중복 | L onset1000, return1800; L@1200, L@1400 | LEFT correct1, latency200, duplicate1. 첫 event를 재사용하지 않음. |
| 실제 side가 cue와 다름 | Cue LEFT, 실제 R onset2000 return2900; R@2300 | RIGHT correct1, latency300. Cue 불이행은 별도이며 wrong 아님. |
| Wrong 후 correct | L onset3000 return3900; R@3100, L@3300 | LEFT correct1/latency300, wrong1. Wrong을 지우거나 RIGHT 실제 action을 만들지 않음. |
| 겹치는 원래 1초 window | L onset4000 return4500; L onset4700 return5400; L@4800 | 첫 matching `[4000,4500)`, 둘째 `[4700,5400)`; 첫 MISS, 둘째 correct1/100ms. 4800을 첫 action에도 쓸 수 없음. |
| 복귀 뒤 Neutral | L onset6000 return6400; L@6500 | Matching은6400에 종료. LEFT MISS, NEUTRAL_FALSE1. Nominal onset+1000 안이라는 이유로 성공 처리 금지. |
| 500ms inclusive | R onset7000 return8500; R@7500 | CORRECT+TIMELY, latency500. |
| 느린 correct | R onset9000 return10500; R@9750 | Overall correct1, latency750; timely0. 최종 latency gate와 extra 없는 조건을 별도 적용. |
| 1000ms exclusive | L onset11000 return12500; L@12000 | LATE_UNMATCHED1, LEFT MISS. |
| 반대쪽으로 이어짐 | L onset13000 return13800; R onset13600 return14400이 분리 판독됨; L@13700 | 첫 owner는13600에 잘림. 두 번째 owner에서 WRONG_DIRECTION1, 두 actual action 모두 MISS. 실제 겹침이 판독 불가면 이 대신 unknown mask. |
| Unknown 및 Twist | UNLABELABLE `[15000,16000)`; TWIST_RIGHT `[16000,17000)`; L@15500, R@16500 | UNSCORABLE_EVENT1, TWIST_RIGHT_FALSE1. Unknown을 NEUTRAL로 추정하지 않음. |
| Pose loss action | 실제 L onset18000 return18900은 reference로 확인; test Pose 없음, event 없음 | 전체 LEFT 0/1, 조건부 usable action 수0/null. “보이지 않아서 정답에서 제외” 금지. |
| 지시만 있고 실제 동작 없음 | Cue RIGHT@19000, actual NEUTRAL; event 없음 | 실제 RIGHT 분모0, cue execution omission1. False0이 recognition PASS는 아님. |
| E 경계와 무라벨 trialId | E `[0,20000)`; Neutral에서 R@19900(trialId null), R@20000 | 첫 NEUTRAL_FALSE1, 둘째 OUTSIDE_E_DIAGNOSTIC1. trialId로 E를 대체하지 않음. |
| 오차 때문에 onset 경계 불명확 | L onset21000±40, sync bound20; L event21030 | 합산ε60, nominal latency30이지만 실제 −30–90ms 가능. Definite-correct0, possible-correct1; early/Neutral false 가능. 이 불확실성으로 PASS를 만들지 않음. |
| 오차 때문에 timely 경계 불명확 | R onset23000±40, sync bound20; R event23500 | Same-side correct는 확정 가능, latency440–560ms로 timely 불확실. Worst-case gate/INSUFFICIENT 처리. |
| 정렬 자체 실패 | Sync bound80ms 또는 onset 반폭70ms | 기준 초과. 임의 허용 window 확장 없이 TIMING_UNCERTAIN/INSUFFICIENT. |

규칙 검토 결과: early event는 다음 actual action의 correct가 될 수 없고, return 이후 negative는 이전 action으로 흡수되지 않으며, 하나의 event가 여러 actual 정답이 되지 않는다. Silence는 full recall0이다. 두 예제의 same-side 연속처럼 second event가 first가 아닌 second에만 속하는 것을 future scorer의 회귀 예제로 유지한다. 이 문서 작성에서는 실제 데이터 replay/실험을 실행하지 않는다.

## 7. 저장할 주석/감사 필드와 보고서

아래는 **private sidecar 문서 스키마 제안**이며 `packages/protocol`이나 기존 capture JSON을 수정하지 않는다.

- Manifest: plan/guide/matching version, 등록/승인 시각과 SHA, capture/attempt/session/participant 익명 ID, split, 원본 test/reference media SHA·PTS·clock mapping 및 ε, annotator/adjudicator ID와 blind 위반 여부.
- Interval: ID, `[startMs,endMs)`, actualLabel, 신체 side 또는 null, observable 근거, UNKNOWN category/reason, boundary bracket/uncertainty, native source frame index.
- Action: ID, actualLabel/side, onset/holdStart/holdEnd/returnStart/returnComplete, 각 uncertainty, truncated/noHold/mixed flags, sequence ID, 실제 onset 간격. Missing 수치는 null이며 NaN을 JSON 0으로 바꾸지 않음.
- Sequence: 사전 계획 slot/순서, 실제 대응 action IDs, LL/RR/LRL/RLR, execution deviation, 모든 step의 timely 결과, extra events, next-action eligibility. 정답 수에 맞춰 sequence를 사후 새로 묶지 않음.
- Comparison: annotator 원안 두 개, 대응/unmatched, 초벌 일치율, adjudication 이유와 최종 판독, immutable annotation hash/time. Cue expected는 이 lock 뒤에만 결합.
- Scoring: event ID/original index/PTS, assigned owner ID 또는 null, primary category 하나, uncertainty bounds, latency, tracking/epoch/cross-gap diagnostic flags. Side별 전체/조건부 actual 분모, unknown slot 수, missing/NaN counts, negative 시간, censored episodes를 모두 남김.

원본/주석/ledger를 덮어쓰지 않는다. 정정이 필요하면 이전 버전, 사유, 정정 전 detector 열람 여부와 새 SHA를 append한다. Outcome을 본 뒤 ground truth나 기준을 바꾼 자료는 confirmatory를 계속할 수 없으며 [plan의 변경 절차](step-4x-recognition-validation-plan.md#7-후보와-분석-동결--변경-절차)를 따른다.

## 8. 수치 교차 확인과 비목표

이 가이드와 plan의 공통 제안: LEFT/RIGHT 각각 최소60(계획66), negative 최소600초(Neutral300/Twist각150), LL/RR 각10쌍 및 교대10회(시작 side각5), 실제 onset 간격1500–2500ms, matching1000ms 미만/허용 latency500ms 이하, wrong/duplicate/false/기타 extra0, pose95%/side knee90%, loss12회/side각6, recovery·rearm p95 1000ms 이하/2000ms 내 미복귀0, GT95%/unknown slots5% 이하, sync50ms/onset반폭50ms/합산100ms 이하다. Recall·timely·sequence·eligibility gate와 세션/attempt 규모는 plan 5–6절 전체를 함께 적용한다.

이번 작업은 두 설계 문서 작성만 한다. 장비 구매, 새 촬영, model inference, detector/config/threshold 변경, 새로운 recovery 정책, 게임 입력·Socket/protocol 변경, raw media/landmark Git 추가를 하지 않는다. 기존 synthetic 결과는 회귀 자료이지 실제 독립 정답이 아니다. STEP4S `NO_SAFE_CANDIDATE`는 유지하고, STEP4W SCRIPT 데모는 계속 TEST다. 문서 계획의 승인과 실제 Pose 게임 입력의 승인은 별개다.

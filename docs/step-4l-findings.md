# STEP 4L — Twist / Knee-Kick Confusion Analysis

**POST_FAILURE_EXPLORATORY.** 이번에 탐색한28개 entry-only 설정은 모두 REJECTED이며 `exploratoryViableConfigs: []`다. LIVE3 false를 제거하면서 다섯 fixture의 정상 recall을 보존하는 threshold neighborhood는 이 grid에서 찾지 못했다. Production detector, live wiring, MediaPipe, Y .40/50ms·clear .25/100ms, integrity12, fixed flexion15°/67ms·clear5°/150ms는 변경하지 않았다. 새 운동/촬영은 하지 않았다.

## 자료, 기준과 재현

기존 JSON 다섯 개를 사용했다. 역할은 직접 지정하며 파일명으로 추론하지 않는다.

| Role | Capture timestamp |
|---|---|
| REFERENCE_OLD_CLEAN | 2026-09-30T12-09-14-840Z |
| STRESS | 2026-09-30T11-39-17-364Z |
| REFERENCE_LIVE_1 | 2026-10-03T16-39-36-229Z |
| REFERENCE_LIVE_2_INDEPENDENT | 2026-10-05T14-37-39-718Z |
| REFERENCE_LIVE_3_HOLDOUT_FAILURE | 2026-10-06T11-19-04-864Z |

LIVE1/2/3의 LIVE↔LANDMARK event/time·summary·baseline·final parity는 모두 MATCH다. 기존 STEP4K.2A holdout은 **Y guard safety PASS / full candidate FAIL**로 유지된다. STEP4L에 원래 `REFERENCE_LIVE_3_HOLDOUT` 역할을 선택해도 report에는 sourceRole을 보존하고 역할을 `REFERENCE_LIVE_3_HOLDOUT_FAILURE`로 바꾼다. 새 rule에 대한 독립 검증으로 사용하지 않는다.

Controller의 기존 Integrity 패널 아래 **STEP4L**에서 파일/역할을 지정하고 **Analyze Twist/Kick Confusion**으로 분포와 trace를 먼저 출력한다. 이후에만 **Compare Twist Entry Guards**가 활성화된다. **Download Twist JSON / Download Twist Traces CSV**는 로컬 다운로드다. STEP4K.1/4K.2 결과와 별도 상태를 사용하며 취소/역할 변경/파일 교체/초기화/unmount는 진행 중 작업을 폐기한다.

전체 결과는 Desktop `plank-stork-shadow-analysis/`에 저장했다:

- `step-4l-evidence.json`: 다섯 fixture의 모든 stage/label 분포,35개 event/peak/corruption trace, 비교 matrix.
- `step-4l-traces.csv`: **1,515개 trace row**, candidate-relative 값·visibility·tracking·속도12 activation 포함.
- `step-4l-results.json`: evidence와28개 전략의 per-fixture event, entry 관측, suppression, 회귀 판정.
- `step-4l-summary.json`: 전략 요약.
- `step-4l-original-holdout-parity.json`: 변경하지 않은 원래 사전 등록 holdout 판정.

Raw capture/WebM은 repo에 넣지 않았다. 기존 네 fixture의37개 설정 전체 STEP4K.1 report도 다시 계산해 저장된 report와 동일함을 확인했다. 다섯 fixture의28개 전략을 두 번 실행한 결과도 동일했다.

## Feature 정의와 결측값

`extractPoseFeatures`, `calibratePoseFeatures`, `CALIBRATION_FEATURES`, 기존 visibility eligibility와 `ACTION_FEATURE_SCALES`를 재사용한다. **Smoothed/prototype/rawAction/stableAction/confidence를 쓰지 않는다.** 매 recorded inference frame의 값이다.

- `deltaHipDepthDifference`는 기존 정의인 **world LEFT hip Z − RIGHT hip Z − Neutral**이다. Image Z로 대체하지 않는다. Normalized depth는 이 값을0.08로 나눈 값이며 veto에는 절댓값을 사용한다. Sign을 임의의 Twist 방향으로 매핑하지 않는다.
- Hip center X/Y scale은 각각0.05, hipMotionScore는 이들 세 normalized hip delta의 RMS다. 기존 neutralMovementScore와 같은 수식이며 classifier 결과가 아니다.
- 기존 hipWidth는 **abs(leftHip.x−rightHip.x)**다. Euclidean pelvis length로 바꾸지 않았다. Neutral median 대비 ratio를 기록한다.
- Pelvis axis는 normalized image XY의 left→right `atan2`다. Neutral의 circular mean과 shortest angle delta를 사용하며0-length/ambiguous reference는 null이다.
- 각 trial 직전 마지막 successful/frozen calibration을 선택한다. 기존 legacy CLEAN은 실제 setup이 없어 `FIRST_NEUTRAL_COMPATIBILITY`를 사용하며 첫 Neutral을 평가에서 제외한다. Baseline은 고정한다. 이후 재보정 marker를 앞 trial의 baseline으로 쓰지 않는다.
- Hip은 기존0.7, knee는0.5 visibility eligibility를 재사용한다. Bilateral 값은 양쪽 값이 있을 때만 계산한다. Zero denominator는 null이며0/Infinity로 대체하지 않는다. sameSignY도 어느 한 값이0이거나 missing이면 null이다.
- Flexion은 기존 same-side hip/knee/ankle feature다. Ankle missing이면 그 side와 relational feature는 null이다. Coverage 분모에는 missing frame도 포함한다. Optional shoulder feature는 추가하지 않았다.

## LIVE3 exact false와 정상 kick 비교

Guided TWIST_LEFT는 **20.2435–23.2435s**다. Production Y와 Y+integrity12는 RIGHT candidate가 **21.5099s**에 시작해 **21.5765s**에 false를 확인했다. Right Y는 entry부터 confirmation까지 .5349→.5060→.5397로 .40을66.6ms 유지해 기존 .40/50ms 조건을 충족했다. Entry 현재/직전 right signed velocity는 약−4.712/+1.934/s로12/s보다 작아서 integrity guard가 개입하지 않았다.

Fixed Y+flexion+12는 다른 사건이다. **21.4099s LEFT flexion entry →21.5099s LEFT false**가 먼저 나온다. LEFT flexion은16.03→140.20→34.39→165.38°로15°를100ms 연속 충족한다. 같은 구간 RIGHT flexion은30.00→160.64→0→156.14°로 끊겨 LEFT가 먼저 확인된다. 따라서 Production RIGHT false만 사후 필터링해서 fixed candidate 결과라고 보고하지 않는다.

| Entry anchor | abs depth /0.08 | Hip motion | Candidate/opponent Y | Y symmetry | Candidate/opponent flexion° | Flex symmetry |
|---|---:|---:|---:|---:|---:|---:|
| Y false RIGHT21.5099 | .753 | .659 | .535/.290 | .543 | 156.14/165.38 | .944 |
| Y true LEFT31.4424 | .998 | 1.046 | .408/.256 | .628 | 16.86/2.58 | .153 |
| Y true RIGHT36.6007 | .258 | .811 | .440/.169 | .385 | 35.67/2.34 | .066 |
| Fixed false LEFT21.4099 | .325 | .634 | .134/.288 | .463 | 16.03/30.00 | .534 |
| Fixed true RIGHT36.5004 | .618 | .743 | .179/.215 | .831 | 31.51/6.66 | .211 |

Y true confirmations는 LEFT31.5091s/RIGHT36.6669s다. Fixed LEFT는 같은 entry/confirmation, fixed RIGHT는36.6007s confirmation이다.

False 구간에 bilateral motion은 있다. **21.4432s**에는 signed Y가 LEFT−.4461/RIGHT−.4420, symmetry .9908이고, Y confirmation에는 .9305다. 그러나 **실제 entry 순간**에는 상대 Y가 .4 미만이다. Fixed false entry에는 양쪽 모두 .4 미만이다. 따라서 `both Y active>=.4 AND symmetry`를 요구하는 entry-only rule은 이 false를 잡지 못한다. Past/future peak를 가져오면 entry 시점 정보 누출이 된다.

Visibility는 entry에서 LEFT knee .644/RIGHT .812, Y confirmation에서 .547/.522로 낮아지며, 이후 RIGHT .473/LEFT .482로 관측 불가능해진다. Flexion이140–165°로 급변하는 모습은 projection/landmark geometry 변화와 일치하지만, raw 영상의 자세 정답 없이 실제 신체 형태나 corruption의 원인을 확정하지 않는다.

## Temporal relation

모든 window는 실제 candidateStartedAt±750ms이며 future row도 **진단용으로만** 저장한다. Missing expected kick은 `EXPECTED_STAGE_PEAK`로 분리하고 confirmation을 만들지 않는다. LIVE1 RIGHT의 stage peak와 STRESS Twist/가용 knee peak, LIVE2 rejected corruption entry도 포함한다.

| Anchor | abs normalized hip depth peak | Peak offset | Hip-motion peak | Peak offset |
|---|---:|---:|---:|---:|
| LIVE3 Y false | 2.124 | +200.9ms | 1.358 | +300.0ms |
| LIVE3 fixed false | 2.124 | +300.9ms | 1.358 | +400.0ms |
| LIVE3 true LEFT | 1.151 | −133.2ms | 1.053 | −65.6ms |
| LIVE3 Y true RIGHT | 2.149 | +708.1ms | 1.283 | +366.3ms |

False의 큰 hip peak는 두 confirmation **이후**다. 정상 LEFT에서는 hip peak가 entry보다 먼저이고, 정상 RIGHT도 큰 depth peak가 confirmation 이후에 있다. 큰 peak만으로 false를 분리할 근거가 없다. 최대값의 시간은 상승 시작이나 인과관계와 같지 않으며 window 끝 peak는 report에서 별도로 표시한다.

## Stage 분포

아래는 LIVE3 label별 모든 usable frame이다. `min / p05 / median / p95 / max`, missing/zero-ratio는 제외하되 전체 frame 수는 coverage 분모에 남긴다.

| Feature | Label | Usable/frames | min / p05 / median / p95 / max |
|---|---|---:|---|
| signed deltaHipDepthDifference | TWIST | 179/179 | −.1699 / −.1622 / .0562 / .1377 / .1570 |
| signed deltaHipDepthDifference | KNEE | 180/181 | −.1017 / −.0921 / −.0052 / .1718 / .1723 |
| abs normalized hip depth | TWIST | 179/179 | .0278 / .4477 / 1.2080 / 2.0277 / 2.1241 |
| abs normalized hip depth | KNEE | 180/181 | .0035 / .0193 / .7805 / 2.1480 / 2.1536 |
| Hip motion | TWIST | 179/179 | .4358 / .4861 / .8528 / 1.3548 / 1.4314 |
| Hip motion | KNEE | 180/181 | .2580 / .3229 / .7135 / 1.2769 / 1.2828 |
| Y symmetry | TWIST | 87/179 | .0180 / .0769 / .6086 / .9348 / .9920 |
| Y symmetry | KNEE | 147/181 | .0012 / .1019 / .3769 / .8793 / .9961 |
| Y dominance abs | TWIST | 87/179 | .0001 / .0051 / .0805 / .1504 / .2835 |
| Y dominance abs | KNEE | 147/181 | .0001 / .0116 / .1380 / .6620 / .7123 |
| Flexion symmetry | TWIST | 77/179 | 0 / 0 / .1229 / .9441 / .9966 |
| Flexion symmetry | KNEE | 117/181 | 0 / 0 / .0062 / .6333 / .9049 |
| Flexion dominance abs° | TWIST | 78/179 | 0 / .1959 / 1.8852 / 9.8276 / 34.3935 |
| Flexion dominance abs° | KNEE | 138/181 | 0 / 0 / 5.6912 / 19.1257 / 59.3961 |

LIVE3 NEUTRAL도 abs depth median/p95 **.955/2.115**, hip-motion **.691/1.256**으로 움직임 stage와 겹친다. 고정 baseline 이후 Neutral 복귀가 initial calibration과 같다고 가정할 수 없다. Dynamic baseline으로 이 차이를 지우지 않았다.

False-Twist window와 True-Knee window를 각각 합칠 때 겹치는 frame을 중복 가중하지 않았다. 이 두 window의 median/p95는 depth **1.213/2.000 vs .381/2.132**, hip-motion **.980/1.317 vs .622/1.269**, Y symmetry **.735/.981 vs .373/.879**, flexion symmetry **0/.873 vs .001/.670**이다. Window별 차이와 entry 시점 차이는 구분해야 한다.

## Fixture 간 일관성

| Fixture | abs depth median TWIST/KNEE | Hip-motion median TWIST/KNEE | Y symmetry median TWIST/KNEE | Flex symmetry median TWIST/KNEE |
|---|---:|---:|---:|---:|
| OLD CLEAN | .433/1.825 | .961/1.091 | .506/.215 | .040/0 |
| STRESS | .582/1.199 | .734/5.791 | .438/.763 | .319/0 |
| LIVE1 | .834/1.830 | .873/1.140 | .431/.282 | 0/0 |
| LIVE2 | .722/1.552 | .564/.970 | .647/.163 | 0/0 |
| LIVE3 | 1.208/.781 | .853/.714 | .609/.377 | .123/.006 |

STRESS KNEE usable coverage는 hip-motion55.6%, bilateral Y10.6%, flexion symmetry6.1%다. 작은 usable 부분의 median을 정상 kick 증거로 일반화하지 않는다.

Hip-only 값은 OLD/LIVE1/LIVE2에서는 KNEE가 더 크고 LIVE3에서는 TWIST가 더 크다. Framing이 달라져도 일관된 separation이라는 근거가 없다. Neutral image hipWidth median도 .02169/.05337/.01607/.02800/.03736, pelvis circular reference는 −30.07°/−135.49°/−96.92°/−80.23°/+9.58°로 다르다. Axis sign이나 world-depth sign을 임의의 사용자의 Twist 방향으로 바꾸지 않는다.

LIVE3 정상 Y kicks는 entry에서 candidate Y가 더 크지만 fixed RIGHT는 Y .179/.215로 그렇지 않다. Flexion dominance도 fixture 전체에 공통이지 않다. **LIVE1 정상 RIGHT flexion entry의 symmetry는 .934**(17.29°/16.14°)이며, OLD 정상 RIGHT도 .586이다. LIVE3 fixed false의 .534보다 높으므로 “flexion이 양쪽에서 비슷하면 false”라는 단순 일반화도 지지되지 않는다.

## Entry-only 비교와 acceptance

STEP4L은 fixed Y+flexion+integrity12 shadow 위에서만 veto를 추가했다. Hip depth/motion은 현재 frame에서 threshold 이상이면 entry를 막는다. Bilateral rule의 active는 기존 Y enter **양쪽>=.40**이다. Missing은 unavailable이며 자동 veto하지 않는다. Combined는 AND다.

현재 side에 계속 진행 중인 Y/FLEXION run이 있으면 취소하지 않는다. 현재 값이 enter 미만으로 떨어져 끝난 run은 새 다른 채널 entry를 면제하지 않는다. 거부된 entry는 다음 eligible frame에서 **그때의 값으로** 재시도하며 새로운 gesture latch/clear dwell은 없다. Peaks, future, earlier strong hip value, stage label은 veto에 쓰지 않는다. 기존 velocity12와 soft recovery는 독립적으로 계속 동작한다.

False/recall/duplicate 차이는 stage별로 계산해 stage 간 상쇄를 막았다. OLD/LIVE3 양쪽1회, 기존 fixed-candidate recall 유지, LIVE2 false 재발 없음, LIVE3 TwistLeft false0, STRESS false/gap/reacquisition 증가 없음, wrong0, duplicate 증가 없음이 필요하다. 통과 이름은 EXPLORATORY_VIABLE뿐이다.

| Family / threshold | False removed / added | True lost 합계 | LIVE3 L/R/false | 결과 |
|---|---:|---:|---:|---|
| Hip depth .5 | 0/0 | 3 | 1/1/1 | REJECTED |
| Hip depth .75,1,1.25 | 각각0/0 | 각각2 | 1/1/1 | REJECTED |
| Hip depth1.5,2 | 각각0/0 | 각각1 | 1/1/1 | REJECTED |
| Hip motion .5 | 1/1 | **5** | **1/0/0** | REJECTED |
| Hip motion .75,1 | 각각0/0 | 각각2 | 1/1/1 | REJECTED |
| Hip motion1.25 | 0/0 | 1 | 1/1/1 | REJECTED |
| Hip motion1.5,2 | 각각0/0 | 0 | 1/1/1 | REJECTED |
| Bilateral Y .35,.50,.65,.80 | 각각0/0 | 0 | 1/1/1 | REJECTED |
| Hip depth AND bilateral: [.75,1.25,2]×[.5,.8] | 각각0/0 | 0 | 1/1/1 | REJECTED |
| Hip motion AND bilateral: [.75,1.25,2]×[.5,.8] | 각각0/0 | 0 | 1/1/1 | REJECTED |

Hip-motion .5는 OLD LEFT, LIVE1 양쪽, LIVE2 LEFT, LIVE3 RIGHT를 잃는다. LIVE2에서는 **31.1627s NEUTRAL KNEE_LEFT**가 새로 생기며 hard/soft reacquisition false도1로 증가한다. 모든 설정의 wrong/duplicate/hard cross-gap/soft-gap confirmation은0이지만, 이 조건만으로 acceptance가 성립하지 않는다.

28개 중 viable은0이다. 단일 hip feature는 충분하지 않고, 이번 hip+bilateral-Y 결합도 false를 제거하지 못한다. 더 작은 threshold를 사후 추가하거나 velocity/flexion threshold를 바꾸지 않았다. 따라서 시험한 범위 바깥에도 해법이 없다고 주장하지 않지만, 이번 범위에서 안정적인 neighborhood는 없다.

## 기존 detector 회귀 matrix

각 cell은 **L/R/false**다.

| Fixture | Production Y | Y+integrity12 | Fixed Y+flexion+integrity12 |
|---|---:|---:|---:|
| OLD CLEAN | 1/1/0 | 1/1/0 | 1/1/0 |
| STRESS | 0/0/0 | 0/0/0 | 0/0/0 |
| LIVE1 | 1/0/0 | 1/0/0 | 1/1/0 |
| LIVE2 | 1/1/2 | 1/1/0 | 1/1/0 |
| LIVE3 failure | 1/1/1 | 1/1/1 | 1/1/1 |

STRESS의 missing knee를 성공으로 취급하지 않는다. 기존 corruption 개선을 잃지 않으면서 LIVE3 Twist false까지 없애는 설정은 이번에는 없다.

## 다음 판단

새 독립 운동으로 현재 후보를 확인하기 전에 **feature/temporal 가설을 다시 설계해야 한다.** 큰 hip peak는 false 확인 이후이며, 정상 kick에서도 더 큰 hip motion과 bilateral flexion이 나타난다. Current-entry scalar hip magnitude + bilateral-Y만으로 분리된다는 가설은 이 자료에서 지지되지 않는다. 특히2D flexion의 급격한 접힘과 visibility 감소, torso/pelvis 변화와 limb 변화의 시간 관계를 기존 자료에서 더 검토할 수 있으나, 이번 단계에서는 새로운 detector/threshold/classifier를 구현하지 않았다. 새 후보를 선택한다면 LIVE3를 다시 holdout이라고 부르지 않고, 후보와 acceptance를 고정한 뒤 별도 독립 검증이 필요하다.

## 자동 검증

`pnpm typecheck`, `pnpm build`, `pnpm --filter @plank-stork/controller-web test` 모두 성공했다. 기존656개를 유지하고25개를 추가해 **62 files / 681 tests**가 통과했다. Raw/calibrated 정의 재사용, circular angle, null/zero ratio, latest frozen/legacy exclusion, current-entry 판정, 과거 peak 무시, ongoing run 보존, 채널 전환 entry 검사, integrity12 독립성, 기존 production/replay/holdout 불변, 탐색 provenance, 결정성, UI 역할/분포 선출력/로컬 export/취소를 검증한다.

로컬 실제 fixture regression은 별도 임시 검사로 통과했고 머신별 경로가 들어간 검사는 이후 제거했다. Build에는 controller main chunk738.08kB의 기존500kB 초과 경고가 남는다. Production `KneeKickDetectorV3`, live `KneeKickAnalysis`, ReplayCapture, MediaPipe 설정, normalization scales, preregistered velocity12 및 fixed flexion threshold는 그대로다. Commit/push는 하지 않았다.

# STEP 4M — Body-local / Temporal Kick Feature Redesign

**POST_FAILURE_EXPLORATORY.** 기존 다섯 capture로 분포를 먼저 확인한 뒤 직접 scalar 256개, causal temporal 180개를 비교했다. **436개 모두 REJECTED, EXPLORATORY_VIABLE 0개**다. 새 운동/촬영, production detector/live/ReplayCapture/MediaPipe 변경, 기존 Y·integrity12·flexion threshold 변경, commit/push는 하지 않았다. 아래 값은 실측 replay에서 계산했으며 일반적 분류 성능이나 independent holdout 결과가 아니다.

## 재현과 출력

Controller의 별도 **STEP 4M** section에서 기존 JSON 다섯 개를 선택하고 `REFERENCE_OLD_CLEAN`, `STRESS`, `REFERENCE_LIVE_1`, `REFERENCE_LIVE_2`, `REFERENCE_LIVE_3`를 직접 지정한다. 파일명으로 추측하지 않는다. **Inspect Body-local Features → Compare Candidate Families → Compare Causal Temporal Candidates** 순서다. 직접 256개가 모두 REJECTED일 때 temporal 버튼이 활성화된다. 새 촬영이나 Camera Start는 필요 없다. 역할 변경/파일 교체/Cancel/Reset/unmount는 진행 중 작업을 폐기한다. 기존 4K/4L의 결과 상태와 분리되어 있고 업로드/Socket 전송은 없다.

**Download Body-local JSON**은 비교 전 evidence만, 비교 후 전체 결과를 저장한다. 이번 실행의 로컬 artifact는 Desktop `plank-stork-shadow-analysis/`에 있다:

- `step-4m-evidence.json`: frozen baseline/coverage, 모든 stage·label·event-window 분포, 기존35개 anchor의 frame trace와 temporal/onset 통계.
- `step-4m-direct.json`: 직접256개 조합.
- `step-4m-results.json`: 위 evidence, 비교 matrix, 436개 조합의 per-fixture events/counts/coverage/latency, threshold/dwell neighborhood.
- `step-4m-summary.json`: 실측 요약. 중복 config-event를 독립 표본으로 계산하지 않는다.
- `step-4m-original-holdout.json`: 기존 사전 등록 4K.2 결과의 재실행.

Raw capture/WebM을 repository에 복사하지 않는다. 보고서의 full ±750ms trace는 진단용이며 detector decision에는 사용하지 않는다.

## 1. Feature 정의와 coverage

좌표는 normalized image XY다. `v_s = knee_s - hip_s`. SAME_HIP_Y는 `abs((v.y-neutralMedian)/frozenBodyScale)`, SAME_HIP_DISTANCE는 `abs((hypot(v)-neutralMedian)/frozenBodyScale)`다. Same-side X/Y raw와 delta도 보존한다.

Pelvis는 `eLat=normalize(HR-HL)`, `eNorm=rot90(eLat)`로 항상 LEFT→RIGHT 순서다. 각 v의 projection을 Neutral median과 비교하고 frozen bodyScale로 나눈다. PELVIS_LOCAL_NORMAL은 normal delta 절댓값, PELVIS_LOCAL_2D는 lateral/normal delta의 hypot다. Torso는 shoulderCenter−hipCenter의 unit long axis와 그 수직 side axis를 쓰며 side axis를 pelvis lateral 방향과 맞춘다. TORSO_LOCAL_LONG은 long delta 절댓값이다. Lateral/side 및 2D 보조값도 기록한다. Shoulder unavailable은 torso만 무효화한다.

Signed oldY/sameHipY/pelvisNormal/torsoLong 각각 `common=(L+R)/2`, `diff=(L-R)/2`, residual LEFT=diff/RIGHT=−diff와 절댓값·ratio를 기록한다. 양측 중 하나라도 missing이면 relational 값은 null이다. 분모0도 null이다. 각 vector angle은 frozen circular reference 대비 shortest delta [-180,180)다. Torso length/shoulder width의 frozen median ratio와 두 axis angle delta는 진단 전용이다. World를 detector 후보로 승격하지 않았다.

Hips≥.7, knees/shoulders≥.5를 사용한다. 보존된 ankle visibility는 기존≥.5 분석 기준이며 새 evidence의 필수 입력은 아니다. Axis length<1e-8은 수치적 degeneracy로 null이며 분류 threshold가 아니다. Live1/2/3 parity(event/time/summary/baseline/final)는 모두 MATCH. Guided 직전 latest successful/frozen calibration의 마지막 최대1000ms 내 유효 per-feature median을 사용한다. OLD CLEAN만 first Neutral 호환이며 해당 stage는 평가에서 제외한다. 기존 bodyScale은 고정하고 현재 frame scale로 바꾸지 않는다.

전체 평가 구간 coverage(단위 %, missing 포함 분모):

| Fixture | 개별 LEFT | 개별 RIGHT | 양측 residual |
|---|---:|---:|---:|
| REFERENCE_OLD_CLEAN | 72.7 | 99.3 | 72.7 |
| STRESS | 45.4 | 51.7 | 44.0 |
| REFERENCE_LIVE_1 | 87.4 | 99.8 | 87.4 |
| REFERENCE_LIVE_2 | 76.4 | 99.5 | 76.4 |
| REFERENCE_LIVE_3 | 70.8 | 86.6 | 70.2 |

이번 자료에서는 sameHip/pelvis/torso 개별 family의 coverage가 동일했다. 합성 shoulder-missing 테스트에서는 torso만 null이 됨을 별도로 확인한다. 전체 coverage와 expected kick stage observability는 다른 값이다.

## 2–3. LIVE3 false와 true 비교

아래는 **기존 event의 candidate entry 한 frame**에서의 절댓값 evidence다. 전체 stage peak나 새 detector가 발생한 event와 혼동하지 않는다.

| Anchor | Entry ms | SameHip Y | Pelvis normal | Torso long | Pelvis 2D | SameHip distance |
|---|---:|---:|---:|---:|---:|---:|
| Y FALSE_EVENT RIGHT | 21509.9 | 0.547 | 0.431 | 1.373 | 0.475 | 0.550 |
| Y TRUE_EVENT LEFT | 31442.4 | 0.294 | 0.055 | 1.797 | 0.066 | 0.116 |
| Y TRUE_EVENT RIGHT | 36600.7 | 0.321 | 0.183 | 1.655 | 0.713 | 0.278 |
| Fixed flexion FALSE_EVENT LEFT | 21409.9 | 0.201 | 0.065 | 1.751 | 0.606 | 0.203 |

Y false RIGHT 21509.9→21576.5ms와 fixed-flexion false LEFT 21409.9→21509.9ms를 별도 anchor로 유지했다. SameHip Y는 Y false를 줄이지 못하며, pelvis-normal은 false보다 true LEFT를 더 작게 만들었다. Torso-long은 true에서도 크지만 false에서도1.373으로 커서 분리를 보장하지 않는다. 한 anchor 값만으로 threshold를 고르지 않았고 이후 모든 stage를 stateful core로 재평가했다.

## 4. LIVE1 RIGHT miss

RIGHT stage90개 frame에서 개별 다섯 family coverage는100%, 양측 residual은47/90=52.2%다. 반대쪽 knee 결측 때문에 bilateral 자료가 줄어든다.

| Family | Stage p95 | Stage max | Direct32 중 RIGHT exactly1 | 전체 fixture acceptance |
|---|---:|---:|---:|---:|
| SAME_HIP_Y | 0.145 | 0.281 | 0 | 0 |
| PELVIS_LOCAL_NORMAL | 1.156 | 1.166 | 3 | 0 |
| TORSO_LOCAL_LONG | 1.751 | 1.763 | 0 | 0 |
| PELVIS_LOCAL_2D | 1.843 | 2.000 | 0 | 0 |
| SAME_HIP_DISTANCE | 0.147 | 0.160 | 0 | 0 |
| PELVIS_DIFFERENTIAL | 0.177 | 0.279 | 0 | 0 |
| TORSO_DIFFERENTIAL | 0.215 | 0.314 | 0 | 0 |
| SAME_HIP_RESIDUAL | 0.151 | 0.238 | 0 | 0 |

Pelvis-normal에서 RIGHT 검출이 생기는3개 조합이 있지만 다른 stage false/recall 문제 때문에 fixture 전체는 모두 실패한다. 높은 stage peak는 충분한 dwell·clear/re-arm·방향 선택을 보장하지 않는다. Miss anchor44122.4ms는 실제 confirmation이 없는 diagnostic peak로 남긴다.

## 5. LIVE2 corruption false

| Y false RIGHT entry | SameHip Y | Pelvis normal | Torso long | Pelvis 2D | SameHip distance |
|---|---:|---:|---:|---:|---:|
| 26638.0ms | 0.697 | 0.574 | 1.367 | 0.741 | 0.701 |
| 27171.3ms | 0.785 | 0.519 | 1.282 | 0.745 | 0.779 |

Corruption은 새 좌표에서도 큰 값이다. 사전에 정해진 grid의 `.40/50ms` slice에서 sameHipY와 distance는 LIVE2 false2개를 그대로 재현하고 pelvis-normal은3, torso-long은1, pelvis2D는1개다. 이 slice는 비교를 위한 공통 좌표이며 BEST가 아니다.

## 6–7. Family grid와 neighborhood

| Family | Direct configs | Temporal configs | Acceptance passing | EXPLORATORY_VIABLE |
|---|---:|---:|---:|---:|
| SAME_HIP_Y | 32 | 36 | 0 | 0 |
| PELVIS_LOCAL_NORMAL | 32 | 36 | 0 | 0 |
| TORSO_LOCAL_LONG | 32 | 36 | 0 | 0 |
| PELVIS_LOCAL_2D | 32 | 36 | 0 | 0 |
| SAME_HIP_DISTANCE | 32 | 36 | 0 | 0 |
| PELVIS_DIFFERENTIAL | 32 | 0 | 0 | 0 |
| TORSO_DIFFERENTIAL | 32 | 0 | 0 | 0 |
| SAME_HIP_RESIDUAL | 32 | 0 | 0 | 0 |

Direct threshold [.15,.20,.25,.30,.40,.50,.60,.80] × dwell[50,67,100,150]을 모두 실행했다. 통과 설정이 없으므로 threshold/dwell neighborhood도 없다. 코드상 acceptance를 통과해도 인접 threshold와 dwell 지지가 없는 설정은 FRAGILE이다. 자동 BEST는 없다.

Generic `FeatureKickShadow`는 production class를 threshold만 바꿔 호출하지 않는다. Landmark side identity, FIRST observed dwell, 기록 timestamp, missing/dt≥400ms run 중단, ≥33ms loss 후 clear gate를 독립 구현한다. 동시에 ready이면 누적 excess evidence integral로 비교하고 exact tie면 양측 WAIT_CLEAR다. Return parameter는 이번 비교에서만 **clear=enter×.625, clear dwell100ms**로 고정했다(기존 .25/.40 비율 재사용). Return grid를 추가하거나 production 설정을 바꾸지 않았다. 이 고정 return·arbitration 선택까지 포함한 결과이며 모든 가능한 state machine을 부정하는 결론은 아니다.

## 8. Common-motion residual

공통 움직임의 크기를 줄이는 데는 의미가 있지만 `abs(L-common)==abs(R-common)`이다. 그러므로 residual 절댓값만으로는 어느 무릎이 움직였는지 식별할 수 없다. PELVIS_RESIDUAL과 TORSO_RESIDUAL은 각각 PELVIS_DIFFERENTIAL/TORSO_DIFFERENTIAL의 정확한 alias이며 중복 grid로 표본을 부풀리지 않았다. 별도 SAME_HIP_RESIDUAL 포함 세 family는 모든 direct config에서 event0이다. False0은 true0/방향 동률에 의한 결과여서 성공으로 보지 않는다. 양측 동일 이동 및 한쪽만 이동하는 합성 테스트로 이 성질을 검증했다.

## 9. Causal coherence / efficiency

각35개 anchor에서 아홉 signal(8 family의 signed 원값 + 기존 signed Y)에 대해 과거50/100/150/200ms, entry부터50/100/150/200ms 대기 구간을 저장했다. 후자는 해당 시간까지 기다려야 사용할 수 있다. Future full ±window peak는 detector에 전달하지 않는다. Start/end/min/max/range/absPeak/관측-sample RMS, 초 단위 trapezoidal signedArea/absArea, coherence, netChange/path/efficiency를 기록한다. Missing/dt≥400ms 연결은 끊고 불연속 구간의 coherence/efficiency/netChange는 null이다. 경계 frame을 보간하거나 없던 시각을 만들지 않는다. Onset은 pre-entry200ms에서 실제 low→high 관측으로만 잡으며 이미 high인 경우 left-censored로 표시한다.

100ms Y anchor 이후 sameHipY `(coherence, efficiency)`:

- LIVE3 false RIGHT: **(1.000, .813)**. True LEFT **(1.000,1.000)** / RIGHT **(1.000,1.000)**.
- LIVE2 false #1: **(1.000,.967)**, false #2 **(1.000,1.000)**. False가 꼭 oscillatory/low-efficiency인 것은 아니다.
- OLD true LEFT는100ms efficiency .446,200ms .012로 정상 동작에서도 낮아진다.
- LIVE3 false+200ms는 pose coverage .5로 끊어져 coherence/efficiency가 null이다. 이를0이나 motion rejection의 증거로 바꾸지 않는다.

Signed displacement의 부호가 유지되면 그 구간 coherence는1이기 쉽다. 특히 nonnegative2D magnitude의 coherence는 추가 식별력을 주지 않는다. Coherence를 velocity coherence로 몰래 재정의하지 않았다. Efficiency 조건은 일부 false를 줄여도 true도 잃으며 다섯 fixture를 통과하지 못했다.

## 10–11. Scalar 충분성 / temporal 필요성

이번 직접 scalar와 return/gate grid는 충분하지 않았다. 이후에만 사전에 정해 둔 제한적 extension을 실행했다: 방향별 독립값이 있는 첫5개 family × threshold[.30,.50] × wait[100,150,200] × (coherence[.5,.65,.8] 또는 efficiency[.4,.6,.8]) =180개. 두 metric을 AND하지 않고 residual의 수학적 방향 동률을 temporal로 감추지 않는다.

Temporal entry는 threshold 이상이어야 하고 T동안 계속 threshold 이상인 관측을 요구한다. 최초 관측 frame≥entry+T에서 결정하되 metric은 정확히entry+T 이하 관측만 사용한다. 기각된 attempt는 clear 전 재진입하지 않는다. 이 의미와 bounded grid에서는 해결하지 못했다. **따라서 “temporal confirmation이 필요하다/충분하다”는 결론을 내리지 않는다.** 다른 trajectory feature나 관측 가능성 연구가 필요할 수 있으나 지금 데이터로 자동 채택하지 않는다.

## 12. Confirmation latency

각 config의 true event별 candidateStart/confirm/latency와 p50/p95/max를 JSON에 보존한다. 아래는 여러 config의 같은 capture-event가 반복되는 pooled 진단값이며 독립 표본/채택 후보의 지연이 아니다.

| Wait | Config-event 수 | p50 ms | p95 ms | max ms |
|---|---:|---:|---:|---:|
| Direct dwell50–150 | 581 | 100.0 | 166.9 | 171.0 |
| 100 | 177 | 100.7 | 133.2 | 134.1 |
| 150 | 164 | 166.6 | 167.6 | 171.0 |
| 200 | 141 | 200.9 | 233.8 | 233.9 |

200ms 후보는 최소200ms에 frame 도착 지연까지 더해진다. 이를 게임 pause로 숨기거나 production에 연결하지 않았다.

## 13–14. 후보와 다섯 fixture 회귀

`acceptancePassingConfigs=[]`, `exploratoryViableConfigs=[]`. 436개 전체에서 hard cross-gap event0이다. 개별 조합의 wrong/duplicate/reacquisition false 및 true 손실은 모두 report에 남기며 aggregate false 감소로 상쇄하지 않는다.

기존 reference matrix는 아래와 같다(L/R/false):

| Fixture | Production Y | Y+integrity12 | Fixed Y+flexion+12 |
|---|---|---|---|
| REFERENCE_OLD_CLEAN | 1/1/0 | 1/1/0 | 1/1/0 |
| STRESS | 0/0/0 | 0/0/0 | 0/0/0 |
| REFERENCE_LIVE_1 | 1/0/0 | 1/0/0 | 1/1/0 |
| REFERENCE_LIVE_2 | 1/1/2 | 1/1/0 | 1/1/0 |
| REFERENCE_LIVE_3 | 1/1/1 | 1/1/1 | 1/1/1 |

기존 네 fixture37-config 전체 STEP4K.1 report, STEP4K.2 원래 holdout report, 다섯 fixture28-config 전체 STEP4L report는 저장본과 **정확히 일치**했다. 4K.2는 Y guard safety PASS / full candidate FAIL을 유지한다. 이번 436-config report는 동일 입력으로 두 번 계산해 createdAt을 고정한 전체 JSON이 일치했다. LIVE3를 새 feature의 independent holdout이라고 부르지 않는다.

## 15. 검증

추가 테스트는 translation/rotation 불변성, unilateral/bilateral 분해, shoulder/side 결측 독립성, visibility/axis boundary, frozen scale/결측 baseline, angle wrap, causal window의 미래 frame 배제, missing/400ms 경계, first dwell/동률/return/reacquisition, report 결정성, production·4K.2·4L 불변성, 수동 role/분포 우선/UI 취소/로컬 export를 검증한다. 실제 캡처 검증용 임시 machine-path 테스트는 제거했다.

`pnpm typecheck`, `pnpm build`, `pnpm --filter @plank-stork/controller-web test` 모두 성공했다. 기존681개를 유지하고42개를 추가하여 **67 files / 723 tests**가 통과했다. Controller main chunk767.27kB의 기존500kB 초과 경고는 남는다.

## 16–17. Independent validation 후보 / 다음 조사

현재 독립 live validation으로 넘길 후보는 없다. 실패 자료에서 성능이 안 나온 설정으로 새 운동을 요구하지 않는다. Production 적용 전에는 새로운 설정을 사전 등록하고 별도 독립 live holdout으로 검증해야 한다.

다음은 이번 결과에서 나온 **미검증 가설**이다. 발쪽에서 머리 방향으로 보는 영상의 2D 투영에서 pelvis/torso axis 변화가 실제 limb 움직임과 섞이고, torso projection이 크게 바뀌며, 반대 knee 가림으로 bilateral 정보가 사라지는 한계를 우선 조사할 수 있다. 기존 저장 world shoulder/hip/knee의 길이·축 연속성 및 image-plane foreshortening을 진단하여 3D 좌표가 추가 식별 정보를 주는지 확인한다. 그것도 불안정하다면 단안 관측 한계와 추가 시점/depth/inertial 관측의 정보 이득을 별도 연구 주제로 다룬다. 지금 world를 production evidence로 승격하거나 센서 도입/새 운동을 수행한 것은 아니다.

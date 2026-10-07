# STEP 4N — Pose Geometry Reliability / Projection Failure Analysis

**DIAGNOSTIC / POST_FAILURE_EXPLORATORY.** 기존 다섯 capture를 사용했다. 현재 근거는 **CASE B — pose estimate 자체의 geometry instability 가능성**에 가장 가깝다. Image projection 압축도 함께 관찰되지만, world 길이도 크게 변하며 world motion이 true/false를 일관되게 분리하지 못한다. 원인이나 identity swap을 확정한 것은 아니다.

Entry-only thought experiment24개 중 **`IDENTITY_CONTINUITY/0` 1개만 EXPLORATORY_QUALITY_VIABLE**이다. 이는 `image.swapAdvantage > 0 OR world.swapAdvantage > 0`이며, `.10/.20/.30`에서는 탈락했다. 작은 양수에 의존하는 탐색 결과라 production-ready나 넓은 threshold neighborhood를 주장하지 않는다. World detector를 만들거나 기존 production/live/ReplayCapture/MediaPipe/Y .40/50·clear .25/100/integrity12/fixed flexion 설정을 변경하지 않았다. 새 운동·촬영·센서 도입·카메라 위치 변경·commit/push는 하지 않았다.

## 재현과 파일

별도 **STEP 4N — Pose Geometry Reliability** section에서 기존 JSON5개를 선택하고 OLD CLEAN/STRESS/LIVE1/LIVE2/LIVE3 역할을 직접 지정한다. 파일명으로 역할을 추정하지 않는다.

**Inspect Geometry Reliability → Compare Reliability Markers → Optional Quality-Gate Thought Experiment** 순서다. 분포 확인 전에는 marker를 실행하지 않고, marker 비교 전에는 gate 실험을 실행하지 않는다. 파일 교체/역할 변경/Cancel/Reset/unmount는 진행 중 작업을 폐기한다. 기존4K/4L/4M 상태와 분리되어 있으며 서버/Socket 업로드는 없다. Camera Start는 필요 없다.

Desktop `plank-stork-shadow-analysis/`에 다음을 저장했다:

- `step-4n-evidence.json`:201개 numeric feature, frozen baseline, stage/label/group 분포,54개 anchor trace. 기존35개 anchor에 STRESS loss onset19개를 추가했다.
- `step-4n-traces.csv`:2,370개 trace row. 모든 image/world/visibility/identity 값과 기존 Y·flexion·integrity12 activation 포함.
- `step-4n-results.json`:evidence,20개 marker cut,4개 descriptive profile, world information-gain cuts,24개 quality-gate 결과.
- `step-4n-summary.json`:이번 기록에 사용한 실측 요약과 통과 gate의 모든 차단 entry/기존 이벤트 시각 비교.
- `step-4n-regression.json`:LIVE parity와 stored4K.1/4K.2/4L/4M436 결과 일치, 결정성 검증.

Raw capture/WebM은 repository에 넣지 않았다. UI의 Download Geometry JSON / Download Geometry Traces CSV로 다시 내보낼 수 있다.

## 계산과 missing 원칙

Image는 normalized XY, world는 기록된 XYZ다. World는 절대 위치 truth가 아니다. Hip visibility≥.7, knee/ankle/shoulder≥.5를 사용한다. World point는 같은 image joint의 eligibility와 finite XYZ를 요구하고, world visibility가 기록돼 있으면 같은 joint 기준을 적용한다. World visibility 자체가 null인 구형 기록은 허용하지만 world 좌표 결측은 허용하지 않는다.

LIVE1/2/3는 event/timestamp/summary/baseline/final parity MATCH 후 분석한다. Guided 직전 latest successful/frozen calibration의 마지막 최대1000ms bounded window에서 positive segment median과 vector/local component median을 고정한다. OLD CLEAN만 FIRST_NEUTRAL_COMPATIBILITY이며 첫 Neutral은 평가에서 제외한다. BodyScale은 기존 값을 고정한다. WorldLegScale은 usable left/right hip-knee 3D Neutral median 두 값의 median이다. 유효한 한쪽만 있으면 그 값을 쓰며 모두 없으면 null이다. 재보정이나 current-frame rescale은 하지 않는다.

Image/world 각각 hip-knee, knee-ankle, pelvis, shoulder, torso 길이와 ratio·abs(ratio−1)·deltaRatio·ratio/sec를 계산한다. ProjectionRelativeRatio는 imageRatio/worldRatio다. 분모≤1e-8은 null이다. Current length0은 baseline이 유효하면 실제 collapse 관측0으로 남기고, baseline0이나 missing을 유효0으로 만들지 않는다. Missing/dt≤0/dt≥400ms continuity는 연결하지 않는다. Image 축 velocity는 shortest angle delta를 쓴다. Numeric epsilon은4M의1e-8을 공유한다.

World 3D frame은 HL→HR lateral, shoulderCenter−hipCenter를 lateral에 Gram–Schmidt 직교화한 long, cross(lateral,long) depth로 구성한다. 결정적인 오른손 좌표계이며 temporal flip 보정으로 관측 축 변화를 숨기지 않는다. Depth를 앞/뒤 행동 방향으로 해석하지 않는다. Shoulder missing은 local3D를 unavailable로 만들지만 same-side vector/segment/knee 진단은 계속된다. World local delta와 sameHip vector delta는 frozen worldLegScale로 정규화한다.

Assignment는 image/world 각각 knee−hipCenter의 전후 두 점을 같은 identity로 연결한 비용과 swapped 비용을 비교한다. `sameCost−swappedCost > 0`은 swapped 연결이 더 짧다는 뜻일 뿐이다. Image/world 벡터 component sign을 서로 직접 비교하지 않는다. Movement 증가 방향 boolean도 두 magnitude의 시간 변화에 대해서만 계산한다.

Stage/label 분포와 TRUE_KICK/TWIST_FALSE/TRACKING_CORRUPTION_FALSE/TRACKING_LOSS/NORMAL_NON_KICK을 기록한다. 같은 group 안의 겹치는 window는 frame을 중복 가중하지 않는다. Information-gain과 marker는 unique(timestamp, candidate-side) 관측이다. Group 사이에는 중첩이 있어 독립 표본/서로 배타적인 ground-truth class가 아니다. Loss group은 loss episode 전체±750ms이며 STRESS trace는 onset±750ms다. Normal non-kick은 event/loss window를 제외한다. Null은 anomaly0이 아니다.

## 1–2. LIVE2 corruption / LIVE3 twist false의 segment stability

기존 candidate entry의 값이다. Ratio1은 Neutral median이며 이미지와 world 각각의 기준으로 계산한다.

| Anchor | Image HK | Image KA | World HK | World KA | World HK ratio/sec | World KA ratio/sec |
|---|---:|---:|---:|---:|---:|---:|
| LIVE_2 Y RIGHT 26.6380s | 0.326 | 0.345 | 0.179 | 0.685 | -14.470 | -10.755 |
| LIVE_2 Y RIGHT 27.1713s | 0.251 | 0.124 | 0.441 | 0.436 | -3.658 | -3.918 |
| LIVE_3 Y RIGHT 21.5099s | 0.451 | 0.186 | 0.449 | 0.872 | 0.959 | 20.512 |
| LIVE_3 fixed LEFT 21.4099s | 0.796 | 0.324 | 0.873 | 0.885 | 2.340 | -0.001 |

LIVE2 첫 false는 world HK가 Neutral의17.9%까지 줄고 직전 frame 대비 ratio velocity −14.47/s다. 두 번째도 world HK/KA .441/.436으로 감소한다. LIVE3 Y false는 image/world HK가 모두 약.45이고 world KA는 그 순간 .872지만 velocity+20.51/s로 변한다. “Image만 깨지고 world는 안정적”인 공통 패턴은 아니다.

Fixed LEFT false는 그 entry 한 frame에서 world ratio가 .873/.885로 비교적 가까운 반면 image KA .324로 줄어든다. 따라서 모든 segment/시각을 하나의 단순 원인으로 단정하지 않는다. Trace에는 entry 이후의 값도 보존하지만 gate에는 현재 entry만 사용한다.

## 3. True kick의 world bone length

| Anchor | World HK ratio | World KA ratio |
|---|---:|---:|
| OLD_CLEAN Y LEFT 20.5098s | 0.969 | 0.512 |
| OLD_CLEAN Y RIGHT 25.8427s | 0.655 | 1.009 |
| LIVE_1 Y LEFT 38.9229s | 0.852 | 0.543 |
| LIVE_1 fixed RIGHT 44.1224s (miss stage peak, event 아님) | 0.847 | 0.868 |
| LIVE_2 Y LEFT 28.2722s | 0.880 | 0.667 |
| LIVE_2 Y RIGHT 33.1969s | 0.536 | 1.054 |
| LIVE_3 Y LEFT 31.4424s | 0.988 | 0.858 |
| LIVE_3 Y RIGHT 36.6007s | 0.554 | 0.729 |

World segment가 안정적인 상태에서 local knee position만 바뀐다는 가정도 일관되지 않다. True OLD LEFT의 KA .512, LIVE2 RIGHT HK .536, LIVE3 RIGHT HK .554처럼 정상 label에서도 큰 길이 차이가 있다. 이 값은 실제 뼈 길이 변화가 아니라 추정 geometry의 Neutral 대비 변화다. Neutral 추정 자체의 오차 가능성도 포함한다.

## 4. ProjectionRelativeRatio

| False anchor | HK image/world ratio | KA image/world ratio |
|---|---:|---:|
| LIVE_2 Y RIGHT 26.6380s | 1.822 | 0.503 |
| LIVE_2 Y RIGHT 27.1713s | 0.569 | 0.285 |
| LIVE_3 Y RIGHT 21.5099s | 1.005 | 0.214 |
| LIVE_3 fixed LEFT 21.4099s | 0.912 | 0.366 |

LIVE3 Y false HK는1.005여서 image와 world가 비슷하게 줄고, KA는.214로 image의 추가 압축이 크다. LIVE2는 HK1.822/.569, KA.503/.285로 양상이 다르다. Projection 효과는 있지만 world 안정성을 전제로 2D 한계만으로 설명할 수는 없다.

## 5. Image-axis conditioning

| False anchor | Pelvis length/bodyScale | Torso length/bodyScale | Pelvis angular velocity°/s | Torso angular velocity°/s |
|---|---:|---:|---:|---:|
| LIVE_2 Y RIGHT 26.6380s | 0.199 | 1.227 | -736.879 | -23.738 |
| LIVE_2 Y RIGHT 27.1713s | 0.263 | 0.954 | -233.009 | -11.798 |
| LIVE_3 Y RIGHT 21.5099s | 0.049 | 1.161 | 493.327 | 26.903 |
| LIVE_3 fixed LEFT 21.4099s | 0.195 | 1.108 | 225.988 | 70.785 |

LIVE3 Y false pelvis 축은 bodyScale의.049로 짧고493°/s 변한다. 그렇지만 true OLD RIGHT pelvis도2163°/s, true OLD LEFT torso643°/s다. 큰 angular velocity가 false 전용 특징은 아니다.90/180°/s gate는 LIVE3 false를 없애지만 OLD RIGHT와 LIVE1 LEFT를 잃는다. Numeric axis degeneracy와 coarse angular marker는 별도 관측이며 small-axis를 임의 angle0으로 만들지 않는다.

## 6. Knee/ankle overlap과 depth

| False anchor | Image knee pair norm | World knee pair norm | Knee projection ratio | Ankle projection ratio | World knee Z separation |
|---|---:|---:|---:|---:|---:|
| LIVE_2 Y RIGHT 26.6380s | 0.333 | 0.644 | 0.517 | 0.403 | 0.242 |
| LIVE_2 Y RIGHT 27.1713s | 0.599 | 0.580 | 1.033 | - | 0.051 |
| LIVE_3 Y RIGHT 21.5099s | 0.206 | 0.135 | 1.526 | 0.601 | 0.022 |
| LIVE_3 fixed LEFT 21.4099s | 0.128 | 0.089 | 1.440 | 1.003 | 0.032 |

LIVE3에서는 image뿐 아니라 world에서도 knee pair가 가까워지고 Z separation도 작다. World에서 충분히 떨어진 두 limb가 image에서만 겹친다는 가정과는 다르다. LIVE2 첫 false는 pair ratio .517로 image 압축이 있지만 두 번째는1.033이고 ankle pair는 반대쪽 visibility 부족으로 unavailable다. Overlap 단독으로 모든 false를 설명할 수 없다. Z sign을 action direction으로 매핑하지 않는다.

## 7. Visibility와 geometry mismatch

False entry의 knee/ankle visibility는 LIVE2 #1 .794/.649, #2 .719/.526, LIVE3 Y .626/.584, fixed LEFT .644/.638이다. 모두 해당 segment의 기존 eligibility를 통과해도 geometry가 크게 달라진다. “기준을 통과함”을 높은 정확도의 증명으로 해석하지 않는다.

예를 들어 LIVE2 RIGHT hip/knee visibility 통과658 frame 중 world segment deviation≥.50 marker가 판단 가능한654 frame에서13개, image는26개다. LIVE3 RIGHT는570 frame 중 world 판단 가능535 frame에서10개, image 판단 가능533 frame에서10개다. HK/KA 중 알려진 anomaly는 유지하고 다른 segment가 missing이면 판단 가능 수를 따로 기록한다. Missing world/ankle을 정상0으로 채우지 않는다.

## 8. Identity continuity / swapAdvantage

| False anchor | Image swap advantage | World swap advantage |
|---|---:|---:|
| LIVE_2 Y RIGHT 26.6380s | -0.057 | -0.061 |
| LIVE_2 Y RIGHT 27.1713s | -0.268 | -0.405 |
| LIVE_3 Y RIGHT 21.5099s | -0.029 | 0.022 |
| LIVE_3 fixed LEFT 21.4099s | 0.013 | -0.029 |

LIVE3 fixed LEFT entry의 image +.01252, Y RIGHT entry의 world +.02250에서 swapped assignment가 더 가깝다.21543.2ms의 image +.06602,21576.5ms의+.00303도 관찰된다. 그 이후에는 동일 side의 기존 run이 없는 eligible entry에 한해서만 다시 판단한다.

그러나 LIVE2 첫 false±750ms에는 image/world 모두 양수0/43이다. 두 번째에는 image4/43, world2/43이며, 정상 LIVE2 LEFT에도 image5/45/world3/45가 있다. 정상 LIVE3 LEFT31376.8ms에는 image+.6032/world+.0613도 나타난다. 즉 positive advantage나 ordering sign inversion은 identity swap 확정이나 false 전용 지표가 아니다.

## 9. World 정보 이득

Anchor-side/time을 중복 제거한±750ms window의 magnitude 분포다. 각 값은 `median / p95`다. Local3D는 body axes 변화도 포함한다.

| Fixture/group | Coverage | Image movement | World sameHip movement | World local3D |
|---|---:|---|---|---|
| OLD_CLEAN TRUE_KICK | 100.0% | 0.138 / 0.787 | 0.521 / 1.040 | 0.553 / 2.024 |
| LIVE_1 TRUE_KICK | 100.0% | 0.178 / 0.894 | 0.335 / 0.958 | 1.134 / 1.564 |
| LIVE_2 TRUE_KICK | 97.8% | 0.145 / 0.901 | 0.328 / 0.920 | 1.405 / 1.749 |
| LIVE_2 TRACKING_CORRUPTION_FALSE | 98.4% | 0.109 / 0.700 | 0.480 / 0.873 | 1.560 / 1.694 |
| LIVE_3 TRUE_KICK | 100.0% | 0.138 / 0.892 | 0.450 / 1.018 | 0.717 / 1.551 |
| LIVE_3 TWIST_FALSE | 60.0% | 0.206 / 0.570 | 0.430 / 0.993 | 0.971 / 1.435 |

LIVE3 false와 true의 world sameHip median .430/.450 및 p95 .993/1.018은 겹친다. Local3D도 false p95 1.435, true1.551로 겹친다. LIVE2 corruption world local median1.560은 true1.405보다 크다. Long/depth delta 분포와.15/.25/.35/.50/.75/1.0 descriptive cut도 JSON에 기록했지만 threshold detector를 만들지 않았다. LIVE3 false window usable coverage60%와 true100% 차이가 있으므로 결측을 낮은 motion으로 해석하지 않는다. World가 image보다 안정적으로 분리를 제공한다는 근거는 없다.

## 10. 일관된 anomaly 여부

Bone ratio/축 velocity/overlap/positive assignment 모두 단독으로 false에만 나타나는 공통 신호는 아니다. 단, LIVE2/LIVE3의 여러 false에서 world와 image geometry의 동반 변동이 관찰되어 단순 2D projection 설명을 약화한다. 정상 kick도 geometry 변동을 동반하므로 “큰 ratio deviation이면 entry 차단”은 recall 손실을 일으킨다.

## 11–12. Quality-gate thought experiment

기준은 **변경하지 않은 fixed Y+flexion+integrity12**다. LIVE2 false는 이미12가 제거했으므로 quality gate의 공으로 계산하지 않는다. 각 gate는 현재 eligible candidate entry만 본다. 어느 channel이라도 같은 side의 run이 계속되는 중이면 새 gate로 취소하지 않는다. 차단 frame 이후 current value로 재시도하며 별도 latch/return rule/recovery를 도입하지 않는다. Unknown marker는 unavailable로 기록하고 자동 veto하지 않는다.

Segment gate는 해당 side HK/KA deviation OR, projection gate도 해당 side HK/KA OR, identity는 image/world swap advantage OR다. Axis gate는 numeric degeneracy 또는 pelvis/torso abs angular velocity다. 단일4 family×4 cut=16개와 world+projection/world+identity의 aligned4-profile OR8개, 총24개다. Image-only segment marker4개는 진단용 비교에만 포함했다. OR에 known true가 있으면 true, false와 unknown만 있으면 unknown이다.

| Gate | False removed | False added | True lost | Assessment |
|---|---:|---:|---:|---|
| WORLD_SEGMENT_INSTABILITY/0.15 | 0 | 1 | 6 | REJECTED |
| WORLD_SEGMENT_INSTABILITY/0.25 | 0 | 0 | 4 | REJECTED |
| WORLD_SEGMENT_INSTABILITY/0.35 | 0 | 0 | 2 | REJECTED |
| WORLD_SEGMENT_INSTABILITY/0.5 | 0 | 0 | 0 | REJECTED |
| IMAGE_WORLD_PROJECTION_DISAGREEMENT/0.2 | 1 | 1 | 4 | REJECTED |
| IMAGE_WORLD_PROJECTION_DISAGREEMENT/0.35 | 0 | 0 | 0 | REJECTED |
| IMAGE_WORLD_PROJECTION_DISAGREEMENT/0.5 | 0 | 0 | 0 | REJECTED |
| IMAGE_WORLD_PROJECTION_DISAGREEMENT/0.75 | 0 | 0 | 0 | REJECTED |
| IDENTITY_CONTINUITY/0 | 1 | 0 | 0 | EXPLORATORY_QUALITY_VIABLE |
| IDENTITY_CONTINUITY/0.1 | 0 | 0 | 0 | REJECTED |
| IDENTITY_CONTINUITY/0.2 | 0 | 0 | 0 | REJECTED |
| IDENTITY_CONTINUITY/0.3 | 0 | 0 | 0 | REJECTED |
| AXIS_DEGENERACY/90 | 1 | 0 | 2 | REJECTED |
| AXIS_DEGENERACY/180 | 1 | 0 | 2 | REJECTED |
| AXIS_DEGENERACY/360 | 0 | 0 | 2 | REJECTED |
| AXIS_DEGENERACY/720 | 0 | 0 | 1 | REJECTED |
| WORLD_SEGMENT_INSTABILITY/0.15 OR IMAGE_WORLD_PROJECTION_DISAGREEMENT/0.2 | 1 | 0 | 7 | REJECTED |
| WORLD_SEGMENT_INSTABILITY/0.15 OR IDENTITY_CONTINUITY/0 | 1 | 1 | 6 | REJECTED |
| WORLD_SEGMENT_INSTABILITY/0.25 OR IMAGE_WORLD_PROJECTION_DISAGREEMENT/0.35 | 1 | 1 | 5 | REJECTED |
| WORLD_SEGMENT_INSTABILITY/0.25 OR IDENTITY_CONTINUITY/0.1 | 0 | 0 | 4 | REJECTED |
| WORLD_SEGMENT_INSTABILITY/0.35 OR IMAGE_WORLD_PROJECTION_DISAGREEMENT/0.5 | 0 | 0 | 2 | REJECTED |
| WORLD_SEGMENT_INSTABILITY/0.35 OR IDENTITY_CONTINUITY/0.2 | 0 | 0 | 2 | REJECTED |
| WORLD_SEGMENT_INSTABILITY/0.5 OR IMAGE_WORLD_PROJECTION_DISAGREEMENT/0.75 | 0 | 0 | 0 | REJECTED |
| WORLD_SEGMENT_INSTABILITY/0.5 OR IDENTITY_CONTINUITY/0.3 | 0 | 0 | 0 | REJECTED |

`IDENTITY_CONTINUITY/0`만 기존8 true event의 entry/confirmation 시각을 모두 유지하고 LIVE3 false1을 제거했다. OLD/LIVE1/LIVE2/LIVE3 모두 L1/R1/false0/wrong0/duplicate0, STRESS event0이며 hard/soft cross-gap0이다. 정상 entry를 전혀 막지 않았다는 뜻은 아니다: LIVE3 LEFT31376.8ms 등 일부 early entry는 차단했으나 최종 확인 이벤트8개는 그대로다. Blocking observations는 OLD2, STRESS0, LIVE1 2, LIVE2 2, LIVE3 10개다. Unknown entries는 LIVE2/LIVE3 각각1개다.

.10/.20/.30은 LIVE3 false를 남겼다. `.0` cut은 작은 양수·frame sampling·추정 흔들림에 민감할 수 있으며 별도 margin/neighbor 검증을 통과한 설정이 아니다. 이번 다섯 capture에서 조건을 통과했다는 **EXPLORATORY_QUALITY_VIABLE**만 부여한다. 자동 BEST/production 적용/identity swap의 원인 확정은 하지 않는다.

## 13. CASE A/B/C/D 판정

**Evidence is most consistent with CASE B.** LIVE2 false의 world HK/KA collapse, LIVE3 Y false의 world HK collapse와 KA 급변, true motion에서도의 world length 변동은 world pose estimate 자체의 상대 geometry 신뢰성 문제와 가장 부합한다.

일부 segment에서는 projection 압축도 크고, fixed false entry의 world 길이는 상대적으로 안정적이므로 여러 효과가 섞인다. World motion의 true/false 분리가 확인되지 않아 CASE A로 넘어갈 근거는 없다. Geometry가 일관되게 안정적이지 않아 CASE C만으로 설명할 수도 없다. Fixture/segment 차이는 남지만, 현 단계에서는 센서를 바로 바꾸기보다 기존 pose 추정의 geometry/identity 연속성 한계를 조사하는 쪽이 적절하다. 절대 truth나 인과 진단으로 표현하지 않는다.

## 14. 다섯 fixture 및 이전 report 회귀

| Fixture | Production Y L/R/false | Y+12 | Fixed Y+flexion+12 | Identity>0 gate |
|---|---|---|---|---|
| OLD_CLEAN | 1/1/0 | 1/1/0 | 1/1/0 | 1/1/0 |
| STRESS | 0/0/0 | 0/0/0 | 0/0/0 | 0/0/0 |
| LIVE_1 | 1/0/0 | 1/0/0 | 1/1/0 | 1/1/0 |
| LIVE_2 | 1/1/2 | 1/1/0 | 1/1/0 | 1/1/0 |
| LIVE_3 | 1/1/1 | 1/1/1 | 1/1/1 | 1/1/0 |

LIVE1/2/3 event/time/summary/baseline/final parity 모두 MATCH다. 기존 stored4K.1 전체37개,4K.2 원래 사전 등록 결과,4L 전체28개,4M 전체436개 report는 재실행 후 저장본과 정확히 일치했다. 새4N도 동일 입력으로 두 번 계산해 createdAt을 고정한 전체 JSON이 일치했다. 새 gate24개 모두 hard cross-gap0이다. LIVE3는4N의 independent holdout이 아니다.

## 15. 테스트

Synthetic 테스트는 image-only/world 동시 collapse, 높은 visibility에서의 anomaly, translation 제거, synthetic swap/정상 unilateral assignment, degenerate axis/angle wrap, shoulder/ankle 결측 독립성, zero baseline/scale/null, dt≤0/dt≥400 및 missing continuity 단절, 3D 직교 frame, frozen scale, strict positive cut, unknown OR semantics, entry-only/no-mid-run/current-frame retry, 기존 integrity12 recovery를 검증한다. Report 결정성과 production/4K.2/4L/4M436 불변, group window 중복 제거, parity 및 calibration gate, UI 수동 role/분포 우선/marker 우선/로컬 download/취소/정리도 검증한다. 실측 machine-path 임시 테스트는 실행 후 제거했다.

`pnpm typecheck`, `pnpm build`, `pnpm --filter @plank-stork/controller-web test` 모두 성공했다. 기존723개를 유지하고38개를 추가하여 **71 files / 761 tests**가 통과했다. Controller main chunk799.47kB의 기존500kB 초과 경고는 남는다.

## 16–17. 추가 운동과 다음 단계

이번 STEP 완료에 추가 운동은 필요 없었고 새 camera capture를 하지 않았다. Camera 위치 변경이나 second camera/phone sensor 도입을 요구하지 않는다.

다음 방향은 **pose estimator limitation / identity-continuity 진단**이다. 기존 trace에서 positive assignment가 실제 limb overlap·추정 좌표 교차·큰 움직임 중 어느 현상과 관련되는지 검토하고, 좁은 zero-cut gate의 안정성을 독립된 문제로 다룰 수 있다. World-assisted positive kick detector로 넘어갈 근거는 아직 없다. 통과한 quality gate도 자동 채택하지 않는다. Production 변경 전 별도 사전 등록과 independent validation이 필요하지만 이번 STEP에서 이를 수행하거나 새 운동을 요청한 것은 아니다.

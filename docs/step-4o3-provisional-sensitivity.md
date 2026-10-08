# STEP 4O.3 — Provisional Estimator Sensitivity Scan

PAIRING_STATUS = **PROVISIONAL_MEDIA_PAIR**
analysisStatus = **POST_FAILURE_EXPLORATORY**
decisionStatus = **NON_DECISIONAL**

**Because media pairing is provisional, these results cannot establish estimator superiority.**

## 범위와 실행

STRESS→3차검증.webm, OLD CLEAN→clean인가.webm, LIVE1→4gi replay webm.webm, LIVE2→4j result webm.webm, LIVE3→4k.2a webm.webm의 지정된 mapping만 사용합니다. JSON/WebM content hash를 고정하고 이름/원본을 변경하지 않습니다. 2차검증1.webm은 UNMATCHED_MEDIA로 남겨 두었습니다. 추가 pairing 탐색이나 4O.2 판정 기준 변경은 없습니다.

`runProvisionalEstimatorAnalysis`는 explicit provenance와 고정 mapping을 먼저 확인하고 실제 WebM SHA-256을 검사하는 별도 분석 진입점입니다. 일반 replay/live/UI에서는 import하지 않습니다. Source/manifest/content hash로 이번 scan의 산출물을 묶습니다.

```sh
node apps/controller-web/scripts/provisional-estimator.mjs prepare <step-4o2-directory> <step-4o3-directory>
node apps/controller-web/scripts/provisional-estimator.mjs infer <step-4o2-directory> <step-4o3-directory>
node apps/controller-web/scripts/provisional-estimator.mjs report <step-4o2-directory> <step-4o3-directory>
```

`prepare`는 mapping/코드/비교 정책/전체 PTS/입력과 캐시 hash를 등록합니다. `infer`는 localhost read-only allowlist와 독립 Chrome profile을 사용하고 완료 시 종료합니다. Start marker가 남은 미완료 run은 자동 재시도하지 않습니다. Full VIDEO는 WebM SHA-256, 전체 variant config(model URL/runningMode/delegate 포함), decoded sequence metadata와 raw frame PTS hash가 모두 맞을 때만 캐시를 재사용하며, 불일치 시 동일 설정으로 재추론합니다. IMAGE는 `detect`, VIDEO 두 종류는 `detectForVideo`를 호출합니다. 각 decoded frame/result/model을 즉시 혹은 작업 종료 시 close합니다. No camera/upload/Socket.

Full/Heavy 공식 version1 모델, tasks-vision1.0.1, GPU, numPoses1, confidence .5/.5/.5, segmentation false. IMAGE 외에는 모두 VIDEO mode. 모델별 inference wall clock은 성능 진단에만 사용하고 baseline/detector 시간은 raw media PTS×1000입니다. Mirror transform/프레임 생략/시각 보간 없음. Count/firstPTS/lastPTS/timestampHash와 전체 숫자 PTS 목록이 모두 동일해야 하며 불일치는 INVALID_FRAME_SEQUENCE로 중단합니다.

## 분석 의미

모든 variant에서 원본 recorded Neutral marker 구간을 사용해 **자기 출력으로** baseline을 재계산하고 freeze합니다. OLD CLEAN에만 기존 first-Neutral compatibility를 적용하고 해당 구간은 평가에서 제외합니다. 부족한 baseline은 null이며 다른 variant/stored baseline을 대신 사용하지 않습니다.

4N의 rawReliabilityGeometry/freezeGeometryBaseline/measureReliabilityFrame/assignmentContinuity를 그대로 사용합니다. Detector는 PRODUCTION_Y_V3와 기존 Y_OR_FLEXION+integrity12인 FIXED_REFERENCE만 사용하며 threshold/geometry gate를 추가하지 않습니다. 일반 filename guard와 production path는 그대로입니다.

LEFT/RIGHT는 실제 KNEE_LEFT/KNEE_RIGHT stage에서 올바른 방향으로 발생한 event 수입니다. False는 Neutral/Twist stage의 event이며 wrong/duplicate/cross-gap/reacquisitionFalse를 별도 집계합니다. True recall 유지는 각 control의 올바르게 검출한 KNEE stage가 유지되는지로 비교하므로 다른 stage의 duplicate로 상쇄하지 않습니다. 이는 지정된 stage 시각에 대한 provisional 분석이며 독립적인 video label 검증을 대신하지 않습니다.

기존 false anchor ±750ms를 고정 관찰 창으로 사용합니다. Variant마다 anchor를 새로 고르지 않습니다. 원본 event 시각에 새 event를 강제하지 않으며 window union으로 같은 frame의 중복 집계를 피합니다. 개별 anchor summary/trace와 union summary를 모두 저장합니다. Image/world HK/KA ratio deviation과 ratio velocity, swapAdvantage 최대값/positive count, pose/joint missing, pelvis/torso axis angular velocity의 분포를 포함합니다. Missing은 unavailable이며 정상 geometry의 0으로 해석하지 않습니다.

## 실행 전에 고정한 descriptive 정책

- Geometry 개선: LIVE2와 LIVE3 **각각**의 기존 false-window union에서 6개 기존 count(image/world segment extreme, positive/large swap, pose/joint missing) 중 최소2개가 감소하고 어떤 count도 증가하지 않으며, segment/swap의 측정 가능 observation 수도 감소하지 않아야 합니다.
- Event 개선: detector별로 LIVE2/LIVE3 false가 모두 감소하고, OLD/LIVE1/LIVE2/LIVE3의 control true stage recall이 유지되며, 모든 pair에서 false/wrong/duplicate/cross-gap/reacquisition count 증가가 없어야 합니다.
- 두 개선이 함께 있으면 MATERIAL_EVENT_AND_GEOMETRY_IMPROVEMENT. 한쪽만이면 EVENT_ONLY_DIFFERENCE 또는 GEOMETRY_ONLY_DIFFERENCE. 조건 미충족은 NO_MATERIAL_DIFFERENCE이며 원시 변화/악화는 별도 perPair 표에 남깁니다.
- NEXT_VALIDATION_WORTHY는 한 detector의 복합 개선에 더해 다른 detector에서도 recall 손실/부정 event 증가가 없을 때만 표시합니다.
- 전체 NO_MATERIAL_DIFFERENCE는 두 variant의 event/stage count 및 6개 known-false anomaly count가 control과 모두 같을 때만 사용합니다. 임의 오차 허용치/새 최적화가 없으므로 서로 다른 변화 방향은 MIXED로 유지합니다. Baseline/sequence가 불충분하면 INSUFFICIENT입니다.
- Offline inference timing은 진단값입니다. 재사용 Full VIDEO 캐시는 이전 실행의 host load가 다릅니다. 이 수치로 live FPS나 variant 우위를 확정하지 않습니다.

좋은 패턴이 보여도 새 capture validation이 필요합니다. 결과가 비슷하면 ESTIMATOR_VARIANTS_NOT_SUFFICIENT로 남기고 camera viewpoint/occlusion/single-camera observability/sensing setup을 재평가합니다. 혼재된 변화나 raw geometry 변화가 있다는 사실만으로 sensing 원인을 확정하지 않습니다.

## 실측 결과

Scan `step-4o3-d9f80261159bbacf`. 사전 등록 `2026-10-08T13:23:56.845Z`. 전체 판정 **INSUFFICIENT**, **NEXT_VALIDATION_WORTHY 없음**. 세 variant가 같다는 결론이 아니라, 고정 Neutral 구간에서 baseline이 부족한5개 실행과 재현되지 않은 control false 때문에 종합 비교의 근거가 부족한 결과입니다.

Raw 15개 run, 원본 PTS/입력 해시가 포함된 registration, 전체 anchor trace와 sensitivity report는 Desktop `plank-stork-shadow-analysis/step-4o3/`에 저장했습니다. [Compact summary](step-4o3-provisional-summary.json)에는 아래 모든 표의 수치와 provenance가 있습니다. 모든 결과는 PROVISIONAL_MEDIA_PAIR / POST_FAILURE_EXPLORATORY / NON_DECISIONAL입니다.

### 1. Frame parity

| Pair | 각 variant frames | firstPTS ms | lastPTS ms | 세 variant timestamp hash |
|---|---:|---:|---:|---|
| STRESS | 1729 | 0 | 57572 | PASS `14024d518e3e9302…` |
| OLD CLEAN | 1248 | 0 | 41581 | PASS `f89df10436d58e96…` |
| LIVE1 | 1695 | 0 | 56440 | PASS `96a3781d721856e6…` |
| LIVE2 | 1387 | 0 | 46178 | PASS `b3fc47c594f80987…` |
| LIVE3 | 1505 | 0 | 50109 | PASS `ebc954761f8d104e…` |

Variant별 7,564 frames, 총22,692 inference output frames. Full VIDEO7,564는 검증된 기존 캐시 재사용, IMAGE/Heavy15,128프레임은 신규 추론. 모든15개 raw run의 전체 PTS 배열을 확인했습니다. 프레임 누락/보간/offset 최적화 없음.

### Baseline 부족 (fallback 없음)

양쪽 knee의 usable Neutral sample이 각각20개 필요합니다. 아래 detector 결과는 **N/A**로 유지했습니다.

| Pair | Variant | interval frames | left usable | right usable | hips usable |
|---|---|---:|---:|---:|---:|
| STRESS | FULL_IMAGE | 30 | 9 | 5 | 13 |
| OLD CLEAN | HEAVY_VIDEO | 60 | 0 | 0 | 60 |
| LIVE1 | FULL_IMAGE | 30 | 17 | 9 | 17 |
| LIVE2 | HEAVY_VIDEO | 30 | 0 | 25 | 30 |
| LIVE3 | HEAVY_VIDEO | 30 | 0 | 0 | 30 |

### 2. FULL_VIDEO detector matrix

순서: **LEFT / RIGHT / false / wrong / duplicate / cross-gap / reacquisitionFalse**. N/A는0이 아닙니다.

| Pair | PRODUCTION_Y_V3 | FIXED_REFERENCE |
|---|---|---|
| STRESS | 0 / 0 / 0 / 0 / 0 / 0 / 0 | 0 / 0 / 1 / 0 / 0 / 0 / 0 |
| OLD CLEAN | 0 / 1 / 4 / 1 / 0 / 0 / 2 | 0 / 1 / 3 / 1 / 0 / 0 / 2 |
| LIVE1 | 0 / 1 / 1 / 1 / 0 / 0 / 2 | 0 / 0 / 1 / 0 / 0 / 0 / 1 |
| LIVE2 | 1 / 1 / 0 / 1 / 1 / 0 / 1 | 1 / 1 / 0 / 1 / 1 / 0 / 1 |
| LIVE3 | 1 / 1 / 0 / 1 / 1 / 0 / 1 | 1 / 1 / 0 / 0 / 0 / 0 / 0 |

### 3. FULL_IMAGE detector matrix

순서: **LEFT / RIGHT / false / wrong / duplicate / cross-gap / reacquisitionFalse**. N/A는0이 아닙니다.

| Pair | PRODUCTION_Y_V3 | FIXED_REFERENCE |
|---|---|---|
| STRESS | N/A | N/A |
| OLD CLEAN | 0 / 0 / 0 / 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 / 0 / 0 / 0 |
| LIVE1 | N/A | N/A |
| LIVE2 | 2 / 0 / 0 / 0 / 1 / 0 / 0 | 2 / 0 / 0 / 0 / 1 / 0 / 0 |
| LIVE3 | 0 / 0 / 0 / 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 / 0 / 0 / 0 |

### 4. HEAVY_VIDEO detector matrix

순서: **LEFT / RIGHT / false / wrong / duplicate / cross-gap / reacquisitionFalse**. N/A는0이 아닙니다.

| Pair | PRODUCTION_Y_V3 | FIXED_REFERENCE |
|---|---|---|
| STRESS | 0 / 0 / 2 / 0 / 0 / 0 / 1 | 0 / 1 / 0 / 0 / 0 / 0 / 0 |
| OLD CLEAN | N/A | N/A |
| LIVE1 | 0 / 1 / 1 / 0 / 0 / 0 / 1 | 0 / 1 / 0 / 0 / 0 / 0 / 0 |
| LIVE2 | N/A | N/A |
| LIVE3 | N/A | N/A |

### 5–7. LIVE1 RIGHT / LIVE2 corruption false / LIVE3 twist false

| 관측 | Detector | FULL_VIDEO | FULL_IMAGE | HEAVY_VIDEO |
|---|---|---:|---:|---:|
| LIVE1 RIGHT | PRODUCTION_Y_V3 | 1 | N/A | 1 |
| LIVE1 RIGHT | FIXED_REFERENCE | 0 | N/A | 1 |
| LIVE2 Neutral false | PRODUCTION_Y_V3 | 0 | 0 | N/A |
| LIVE2 Neutral false | FIXED_REFERENCE | 0 | 0 | N/A |
| LIVE3 Twist false | PRODUCTION_Y_V3 | 0 | 0 | N/A |
| LIVE3 Twist false | FIXED_REFERENCE | 0 | 0 | N/A |

Full VIDEO 재추론에서 LIVE2/LIVE3의 기존 false가 이미0입니다. 따라서 IMAGE/Heavy의 false 감소를 입증할 control 재현이 없습니다. LIVE1의 FIXED_REFERENCE RIGHT는0→1로 변했지만 Y V3는1→1이고 다른 capture의 baseline/recall 문제가 남습니다. IMAGE의 OLD CLEAN RIGHT1→0, LIVE2 RIGHT1→0, LIVE3 LEFT/RIGHT1/1→0/0도 관측됐습니다. 이 손실은 false0으로 상쇄하지 않습니다.

### 8. Known-false anchor union geometry

HK/KA는 좌우 segment 중 최대 `abs(ratio−1)`, velocity는 최대 absolute ratio/sec입니다. I/W=image/world. 각 숫자와 함께 observation coverage를 JSON에 보존했습니다. Heavy의 baseline 부족과 left knee geometry missing 때문에 관측 가능한 일부 segment 수치만 남거나 null이며, 작은 값/0 count를 안정성으로 해석하지 않습니다.

| Pair | Variant | HK deviation I/W | KA deviation I/W | segment velocity I/W | image pelvis/torso velocity °/s |
|---|---|---|---|---|---|
| LIVE2 | FULL_VIDEO | 0.357 / 0.624 | 0.818 / 0.719 | 18.012 / 17.282 | 5370.0 / 4908.4 |
| LIVE2 | FULL_IMAGE | 0.104 / 0.066 | 0.096 / 0.097 | 2.931 / 2.682 | 1987.4 / 362.3 |
| LIVE2 | HEAVY_VIDEO | 0.132 / 0.100 | 0.087 / 0.091 | 5.347 / 4.098 | 3602.1 / 457.8 |
| LIVE3 | FULL_VIDEO | 0.283 / 0.213 | 0.131 / 0.098 | 1.282 / 2.005 | 1045.1 / 142.6 |
| LIVE3 | FULL_IMAGE | 0.403 / 0.117 | 0.256 / 0.192 | 7.677 / 3.527 | 5397.6 / 240.2 |
| LIVE3 | HEAVY_VIDEO | — / — | — / — | — / — | 2168.6 / 58.1 |

World pelvis/torso angular velocity는 기존4N 정의에 없으므로 새 공식을 추가하지 않았습니다. World segment velocity와 image axis velocity를 비교했습니다.

### 9. Swap / missing

Count는 window 내 frame 수입니다. Joint missing은8개 joint의 image/world 중 하나라도 unavailable인 frame입니다.

| Pair | Variant | frames | extremes I/W | positive swap | max swap I/W | pose missing | joint missing |
|---|---|---:|---|---:|---|---:|---:|
| LIVE2 | FULL_VIDEO | 62 | 1 / 1 | 8 | 0.062 / 0.046 | 1 | 1 |
| LIVE2 | FULL_IMAGE | 62 | 0 / 0 | 0 | -0.001 / -0.054 | 2 | 4 |
| LIVE2 | HEAVY_VIDEO | 62 | 0 / 0 | 0 | — / -0.443 | 0 | 46 |
| LIVE3 | FULL_VIDEO | 48 | 0 / 0 | 0 | -0.163 / -0.886 | 0 | 43 |
| LIVE3 | FULL_IMAGE | 48 | 0 / 0 | 0 | -0.163 / -0.455 | 12 | 26 |
| LIVE3 | HEAVY_VIDEO | 48 | 0 / 0 | 0 | — / — | 0 | 48 |

LIVE2 IMAGE는 segment extreme1/1→0/0, positive swap8→0으로 줄지만 pose missing1→2, joint missing1→4로 증가합니다. LIVE3 IMAGE는 pose missing0→12이며 image HK/KA deviation과 segment/axis velocity도 증가합니다. Heavy LIVE3의 segment observation은0이고 joint missing48/48입니다. 두 capture에 걸친 일관된 geometry 개선은 인정되지 않습니다.

### 10. Performance (diagnostic only)

| Variant | frames | median ms | p95 ms | max ms | estimated FPS |
|---|---:|---:|---:|---:|---:|
| FULL_VIDEO | 7564 | 13.70 | 23.10 | 695.40 | 66.91 |
| FULL_IMAGE | 7564 | 19.80 | 21.40 | 475.80 | 54.36 |
| HEAVY_VIDEO | 7564 | 28.30 | 36.70 | 1207.20 | 36.34 |

Estimated FPS는1000/mean inference ms이며 decode/UI를 포함하지 않습니다. Full VIDEO는 이전 host load에서 수집한 cache timing이므로 직접 속도 우위의 근거로 쓰지 않습니다. GPU는 Chrome154 / ANGLE Metal Apple M1, 모델/프레임 설정은 등록 내용과 일치합니다.

### 11–14. 판정과 한계

- Sensitivity classification: **INSUFFICIENT**.
- EVENT_ONLY / GEOMETRY_ONLY / EVENT_AND_GEOMETRY 개선 조건을 충족한 variant 없음. Mode별 NO_MATERIAL_DIFFERENCE는 개선 요건 미충족을 뜻하며 모든 raw signal이 같다는 뜻이 아닙니다.
- NEXT_VALIDATION_WORTHY: **없음**. 일부 국소 변화가 전체 recall/missing 보존과 함께 나타나지 않았습니다.
- **Because media pairing is provisional, these results cannot establish estimator superiority.** 과거 capture pairing·recorded stage 정합을 추가로 확정한 실험이 아닙니다. Production acceptance에 사용하지 않습니다.

### 15–18. 검증 및 다음 단계

- 4K.1/4K.2/4L/4M436/4N24의 이전 보고서 전체 JSON을 재생성해 일치 확인.
- `pnpm typecheck`: PASS.
- `pnpm build`: PASS. 기존 controller chunk821.63kB 경고는 남음.
- `pnpm --filter @plank-stork/controller-web test`: **79 files / 871 tests PASS** (기존830+추가41).
- 동일 analysis 입력/createdAt으로 report 두 번 생성해 결과 일치. Full15개 run/config/전체 PTS/hash 확인.
- 원본 JSON5개/WebM5개 및 기존 Full VIDEO cache5개 hash 불변. 제외한6번째 WebM과4O.2 원본 결과/threshold도 보존. 일반 identity/replay guard·production pose/live/detector/config 변경 없음.
- 추가 운동/촬영 없이 이번 scan은 완료했습니다. 현재 결과는 특정 variant를 채택하기 위한 반복 운동 검증을 바로 권할 근거가 아닙니다.
- 다음은 camera viewpoint/occlusion과 양쪽 knee 관측·Neutral sample 확보, single-camera observability/sensing setup, JSON↔WebM hash provenance를 먼저 재평가합니다. 실제 우위/적합성 판단을 계속하려면 그 설계를 반영한 **새 paired capture**가 필요합니다. 이번에는 새 capture를 수행하지 않았습니다.
- Commit/push 하지 않았습니다.

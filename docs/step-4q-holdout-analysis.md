# STEP 4Q — First Cryptographically Verified V2 Holdout Analysis

대상: `plank-stork-replay-2026-10-11T23-45-38-330Z`. 기존 발 쪽 배치의 단일 V2 holdout을 재추론했다. 새 촬영·운동·threshold/config 변경·production 교체는 하지 않았다. **미디어/PTS 무결성 PASS**, estimator별 이벤트 관측은 아래와 같다. 이 문서의 FAIL/INSUFFICIENT는 해당 영상의 관측이며 5-role acceptance 판정이 아니다.

## 무결성과 공통 입력

- Protocol: `STEP_4P_ESTIMATOR_HOLDOUT_V1`; `VALIDATION_CAPTURE_COMPLETE`.
- WebM SHA-256: `e50775d539e656f01b584d63c33e03b1f1852ba61de41a2095b954aed21ec2df`. 실제 33,530,994 bytes 일치.
- Capture JSON SHA-256: `1d89fef8f4a7a4f98e8c75b2c2c45e3bec033ad1be189b173924fa256b8c2d43`.
- 세 variant 모두 **1988개 PTS**, 0–66203ms, 1280×720. 각 variant의 모든 frame timestamp를 배열 단위로 정확히 대조했다.
- PTS SHA-256(JSON number array): `5fa92c067ebe1b613bb2030ee1c5b83d8af36ff26daaf9283d9084314c725ec5`.
- 공통 Neutral reference: **10549.200004577637–13549.200004577637ms**, 양 끝 포함, 정확히 3000ms. 각 재추론 결과에서 90프레임. Capture 시점 usable 90/60, 8 joints 각각 90.
- Guided: **18689–40689ms**, 9 stages / 22초. label은 저장된 stage marker의 `[start,end)` 구간이다. 실제 trial STOP은 40697.700ms이며 이 지연을 Guided 연장으로 취급하지 않았다.

`validateEstimatorMediaArtifact` / `ReplayMediaValidationCache`, `decodeEstimatorFrames`, `runEstimator`를 그대로 사용했다. 각 estimator는 Full VIDEO / Full IMAGE / Heavy VIDEO의 사전등록 설정과 GPU delegate로 새로 생성·정리했다. 새 canvas에 decoded frame을 그렸고 Mirror 변환은 없다. 파일명만으로 동일성을 가정하거나 frame을 subsample하지 않았다.

## Variant별 Neutral baseline

`rebuildEstimatorBaseline`으로 각 variant 자신의 landmark만 사용했다. Y/bodyScale, fixed flexion, segment, 4N geometry에 같은 3초 window를 전달했다. 저장된 LIVE baseline, 다른 variant, 동작 stage를 대체 baseline으로 사용하지 않았다. 기존 Y baseline 최소 usable 20개 조건을 그대로 사용한다.

| Variant | Neutral frames | LEFT usable | RIGHT usable | Body scale | 판정 |
| --- | ---: | ---: | ---: | ---: | --- |
| FULL_VIDEO_CONTROL | 90 | 90 | 90 | 0.290307 | READY |
| FULL_IMAGE | 90 | 90 | 90 | 0.245060 | READY |
| HEAVY_VIDEO | 90 | 0 | 0 | — | INSUFFICIENT_VARIANT_NEUTRAL |

Full 두 variant는 Neutral에서 8 joints 모두 90/90 usable이었다. Heavy는 pose 자체는 90/90 검출했으나 양쪽 knee/ankle usable이 모두 0/90이었다(hips/shoulders는 90/90). Heavy Neutral knee visibility 범위는 LEFT 0.0117–0.0441, RIGHT 0.0039–0.0133으로 기존 0.5 기준 미달이다. **Heavy는 INSUFFICIENT_VARIANT_NEUTRAL**이며 detector replay를 실행하지 않고 null로 남긴다.

## Guided 이벤트

각 LEFT/RIGHT kick stage는 한 번씩이다. L/R은 correct event 수이며 각 1회 기대한다. 기존 `replayKneeKickV3`와 고정 `FIXED_Y_OR_FLEXION` + `PRE_REGISTERED_INTEGRITY_CONFIG`(velocity 12)를 재사용했다. `compareEstimators`, 과거 role의 acceptance, 과거 false anchor는 호출/이식하지 않았다. 내부 fixture adapter의 role은 UNASSIGNED이며 role 기반 acceptance boolean은 보고/판정에 쓰지 않는다.

| Variant / detector | L / R | Twist false | Neutral false | Wrong | Duplicate | Cross-gap | Reacquisition false | 판정 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| FULL_VIDEO_CONTROL / PRODUCTION_Y_V3 | 0 / 1 | 0 | 1 | 0 | 0 | 0 | 1 | FAIL |
| FULL_VIDEO_CONTROL / FIXED_REFERENCE | 1 / 1 | 0 | 1 | 1 | 1 | 0 | 2 | FAIL |
| FULL_IMAGE / PRODUCTION_Y_V3 | 0 / 0 | 0 | 0 | 0 | 0 | 0 | 0 | INSUFFICIENT |
| FULL_IMAGE / FIXED_REFERENCE | 0 / 0 | 0 | 0 | 0 | 0 | 0 | 0 | INSUFFICIENT |
| HEAVY_VIDEO / PRODUCTION_Y_V3 | — | — | — | — | — | — | — | INSUFFICIENT |
| HEAVY_VIDEO / FIXED_REFERENCE | — | — | — | — | — | — | — | INSUFFICIENT |

- Full VIDEO / Y V3: LEFT stage는 observable인데 **MISS**. RIGHT true 36649ms 이후 마지막 Neutral에서 RIGHT false 38815ms.
- Full VIDEO / fixed: LEFT 31752ms, RIGHT 36916ms는 검출했지만 Neutral LEFT false 33718ms, RIGHT stage의 wrong LEFT 36616ms가 함께 발생해 duplicate도 1이다. Recall 회복만으로 PASS하지 않는다.
- Full IMAGE: 두 detector 모두 이벤트 0. LEFT/RIGHT kick stage가 기존 observability 기준에서 UNOBSERVABLE이므로 **INSUFFICIENT**. False 감소를 개선으로 해석하지 않는다.
- Heavy: baseline 부재이므로 L/R/false를 0으로 채우지 않는다.
- 모든 평가 가능한 detector에서 cross-gap 0, fixed soft-gap/soft-recovery false 0. Reacquisition false는 기존 POST_REACQUISITION 태그와 false/wrong의 교집합이다. 손실 직후라는 뜻이나 인과관계 증명이 아니다.

판정 규칙: 관측된 false/wrong/duplicate/cross-gap/reacquisition 위반 또는 observable kick miss는 FAIL. 그런 위반이 없더라도 stage coverage/Neutral baseline이 부족하면 INSUFFICIENT. 모든 stage가 observable이고 두 kick을 각각 한 번 올바르게 검출한 경우만 이 capture의 이벤트 관측 PASS다. 이는 새로운 detector threshold 또는 과거 5-role 전체 acceptance가 아니다.

## Stage별 coverage

각 셀은 **pose / LEFT Y / RIGHT Y usable 비율(%)**이다. Pose 검출과 joint usability를 구분한다. 8 joints 각각의 image/world usable count 및 coverage는 [집계 JSON](step-4q-holdout-summary.json)의 perStage에 포함했다. Visibility threshold는 기존 4N/production 값을 그대로 사용했다.

| Stage | Expected | Frames | Full VIDEO P/L/R | Full IMAGE P/L/R | Heavy VIDEO P/L/R |
| --- | --- | ---: | --- | --- | --- |
| 0 | NEUTRAL | 60 | 100.0 / 100.0 / 100.0 | 100.0 / 100.0 / 100.0 | 100.0 / 0.0 / 0.0 |
| 1 | TWIST_LEFT | 90 | 100.0 / 100.0 / 100.0 | 100.0 / 100.0 / 100.0 | 100.0 / 0.0 / 0.0 |
| 2 | NEUTRAL | 61 | 100.0 / 100.0 / 100.0 | 100.0 / 100.0 / 100.0 | 100.0 / 0.0 / 0.0 |
| 3 | TWIST_RIGHT | 90 | 100.0 / 100.0 / 100.0 | 94.4 / 94.4 / 94.4 | 100.0 / 0.0 / 0.0 |
| 4 | NEUTRAL | 60 | 100.0 / 100.0 / 100.0 | 98.3 / 98.3 / 98.3 | 100.0 / 0.0 / 0.0 |
| 5 | KNEE_LEFT | 90 | 96.7 / 96.7 / 96.7 | 77.8 / 77.8 / 43.3 | 98.9 / 15.6 / 12.2 |
| 6 | NEUTRAL | 60 | 100.0 / 100.0 / 100.0 | 91.7 / 88.3 / 56.7 | 100.0 / 61.7 / 71.7 |
| 7 | KNEE_RIGHT | 90 | 100.0 / 100.0 / 100.0 | 42.2 / 25.6 / 42.2 | 100.0 / 25.6 / 100.0 |
| 8 | NEUTRAL | 60 | 100.0 / 100.0 / 100.0 | 91.7 / 91.7 / 90.0 | 100.0 / 25.0 / 58.3 |

Full IMAGE의 LEFT kick pose coverage는 77.8%, RIGHT kick은 42.2%다. 해당 side Y coverage도 각각 77.8%, 42.2%다. Heavy는 pose가 거의 계속 있어도 knee visibility 때문에 Y usability가 부족할 수 있음을 보여준다.

## 기존 4N geometry 진단

동일 661개 Guided PTS에서 `rawReliabilityGeometry`, `freezeGeometryBaseline`, `measureReliabilityFrame`, 기존 `continuitySummary`를 사용했다. Stage가 바뀌어도 연속성 계산을 임의로 reset하지 않는다. 아래 값은 frame 단위이며 joint observations는 image/world 8개씩 합산한다.

| Variant | Image segment extreme | World segment extreme | Positive / large swap | Pose missing | Joint-missing frames | Missing joint observations | Large axis velocity |
| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: |
| FULL_VIDEO_CONTROL | 102 | 6 | 19 / 8 | 3 | 3 | 48 | 95 |
| FULL_IMAGE | 20 | 2 | 19 / 1 | 88 | 167 | 1696 | 65 |
| HEAVY_VIDEO | N/A | N/A | N/A | 1 | 586 | 4190 | 53 |

Image의 일부 anomaly count가 낮지만 pose/joint missing은 크게 늘었다. Heavy의 leg ratio/swap은 baseline/scale이 없어 대부분 unavailable이다. 내부 count 0은 정상 geometry 증거가 아니며 표에서는 N/A로 표시했다. 측정값의 availability 분포를 함께 제공하고 geometry 기반 새 gate/threshold는 추가하지 않았다.

## 전체 영상 inference 성능 — offline only

| Variant | Frames | Mean ms | Median ms | p95 ms | Max ms | Inference total s | Offline wall s |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| FULL_VIDEO_CONTROL | 1988 | 12.026 | 11.400 | 14.100 | 544.200 | 23.909 | 116.040 |
| FULL_IMAGE | 1988 | 17.997 | 21.000 | 22.900 | 342.700 | 35.778 | 44.117 |
| HEAVY_VIDEO | 1988 | 26.592 | 30.300 | 34.600 | 519.900 | 52.864 | 113.300 |

Chrome 154 / ANGLE Metal Apple M1 GPU에서 각 1회 실행했다. Inference duration은 각 detect 호출 전후 performance.now() 차이다. 미검출 frame도 포함하며, first-frame 비용도 제외하지 않았다. Wall time은 모델 download/초기화·decode·yield 비용을 포함해 variant 속도 순위에 쓰지 않는다. 1000/mean ms도 **실측 live FPS가 아니다**.

## LIVE와 Guided 이후 diagnostic

저장된 LIVE는 Guided LEFT 1 / RIGHT 1 / false 0이다. LIVE에는 1720개 pose frame, 이번 모든 estimator에는 1988개 decoded PTS가 있다. 재추론에서는 각자의 3초 baseline을 다시 만들었다. FULL_VIDEO 결과가 LIVE와 bit-identical해야 한다고 가정하거나 불일치를 미디어 무결성 실패로 판정하지 않는다. 이 차이만으로 tracking/model/기기 원인을 확정할 수도 없다.

Guided end 40689ms 이후의 RIGHT 이벤트는 별도 무라벨 diagnostic이다: 저장된 LIVE 44131.800ms (`trialId: null`), 재추론 Full VIDEO Y V3 44279ms, fixed 43746ms. Image post-Guided 이벤트는 0, Heavy는 baseline 부족으로 미평가다. 이 값들은 Guided recall/false에 포함하지 않는다.

## 해석 범위와 보존

무결성 및 동일 PTS 검증은 PASS다. 이 capture에서는 Full VIDEO의 Y recall 손실/Neutral false, fixed의 추가 wrong/duplicate가 관측됐다. Full IMAGE는 coverage 손실을 동반했고 Heavy는 Neutral baseline을 만들지 못했다. **어느 variant의 superiority나 production 교체도 확정하지 않는다(일반화 INSUFFICIENT).** Stage label은 실행 지시의 시간표이며 독립적인 육안 ground truth annotation은 아니다.

기존 STEP4O source/result와 detector/capture/MediaPipe 설정, Replay schema, network behavior는 보존했다. Raw WebM, 원본 capture JSON, 각 variant의 raw landmark cache 및 전체 진단 report는 저장소 밖의 private 분석 디렉터리에만 있다. 이 저장소에는 analysis-only 코드/테스트와 집계 자료만 추가한다. Commit/push는 하지 않는다.

## 재현

카메라 없이 저장된 파일만 사용한다. 출력 디렉터리는 저장소 밖의 새 디렉터리여야 한다. Attempt/registration/raw 결과를 덮어쓰지 않으며 실패 attempt도 보존한다.

```sh
node apps/controller-web/scripts/v2-holdout.mjs infer <capture.json> <capture.webm> <private-output-directory>
node apps/controller-web/scripts/v2-holdout.mjs report <capture.json> <capture.webm> <private-output-directory>
```

동일 raw 결과로 report를 두 번 재계산해 JSON 전체 equality를 확인했다. 모델 재추론을 반복해 더 좋은 결과를 고르지 않았다.

## 검증 결과

- `pnpm --filter @plank-stork/controller-web test`: **86 files / 978 PASS** (기존 962개 + STEP4Q 16개), wall 60.296s.
- `pnpm typecheck`: PASS, 7.858s.
- `pnpm build`: PASS, 8.105s. 기존 500kB bundle warning 유지.
- 새 테스트는 동일 전체 PTS/config/hash 검증, variant별 3초 baseline 재구성, 부족한 baseline의 null 유지, missing coverage, 실제 post-Guided pulse의 scoring 제외, PASS/FAIL/INSUFFICIENT 구분과 보고서 결정성을 확인한다.
- 작업 전 기존 tracked 파일 262개와 SHA-256 대조: **변경 0개**. 기존 STEP4O 결과/source, production 설정·동작, 원본 capture bytes와 HEAD를 보존했다. 추가 파일은 분석 실행기, 분석 모듈/테스트, 이 문서와 집계 JSON의 5개뿐이다. Raw media/landmark 배열은 Git 작업 디렉터리에 추가하지 않았다. Commit/push 없음.

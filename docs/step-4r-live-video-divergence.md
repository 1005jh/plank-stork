# STEP 4R — LIVE vs FULL_VIDEO divergence attribution

대상: `plank-stork-replay-2026-10-11T23-45-38-330Z`. 기준 HEAD: `d6e37392f36b0ee523ee2d1382fbd9421283ac9a`.

**원본 LIVE replay parity PASS. 최종 귀속은 MIXED: INPUT_STREAM_SENSITIVE + sampling에 한정된 TIMING_OR_SAMPLING_SENSITIVE.** Baseline 교체나 실제 clockSamples 제거로는 이벤트 차이가 재현되지 않았다. 같은 baseline에서 입력 스트림을 교체하면 차이가 재현되고, 사전 고정한 시간 매칭 subset으로 frame을 제외해도 결과가 달라진다. 이 두 민감도는 서로 겹치며 독립적인 두 근본 원인을 증명한 것은 아니다.

분석 전용 결과다. 저장된 landmark만 사용했고 재촬영·모델 추론·threshold 탐색·production 변경을 하지 않았다. 세 estimator의 1,988 PTS 및 STEP4Q 전체 report를 저장 raw run에서 다시 계산하여 동일함을 확인했다. 기존 STEP4O/4Q 파일은 보존했다. 이 단일 capture로 estimator 우월성, 카메라 원인, production 교체를 판단하지 않는다.

집계 데이터: [step-4r-divergence-summary.json](./step-4r-divergence-summary.json). 세 baseline의 모든 값/차이, 관절 availability, stage별 결과, FULL_IMAGE 유효 구간과 Y 분포가 포함된다. 모든 frame trace/매칭/미매칭 원본 index는 Git 밖의 `Documents/plank-stork-private/step4r/<captureId>/divergence-report.json`에 보존했다. 같은 디렉터리의 `LIVE_A-trace.csv`, `VIDEO_C-trace.csv`, `FULL_IMAGE-trace.csv`, `VIDEO_MATCHED_SUBSET-trace.csv`에서 순서대로 확인할 수 있다. Raw landmark/영상은 repository에 추가하지 않았다.

## 1. 무결성과 원본 parity

| 검증 | 결과 |
|---|---|
| Capture JSON SHA-256 | `1d89fef8f4a7a4f98e8c75b2c2c45e3bec033ad1be189b173924fa256b8c2d43` 일치 |
| WebM SHA-256 | `e50775d539e656f01b584d63c33e03b1f1852ba61de41a2095b954aed21ec2df` 일치 |
| WebM bytes | 33,530,994 일치 |
| 세 raw run SHA | STEP4Q provenance와 모두 일치; 값은 집계 JSON provenance 참조 |
| STEP4Q source/config/protocol/PTS | 일치, 추론 없이 기존 report 전체 재현 |
| 원본 replay | PASS: actual clockSamples 178개, 저장 baseline A, 원본 Guided markers |
| 이벤트 | LEFT 32007.5ms / RIGHT 36566.800003ms, LIVE와 timestamp 차이 모두 0ms |
| 판정 | LEFT 1 / RIGHT 1 / false 0 / wrong 0 / duplicate 0 |
| Stage별 event summary / Guided summary / 최종 상태 | 모두 일치 / ARMED |
| Production calibration replay | Neutral/X/V3 baseline 모두 저장값과 일치 |

이벤트 parity 허용오차는 기존 replay의 `0.000001ms`다. 아래 frame 근접 매칭 허용오차와 다르다. Replay의 cross-gap 및 reacquisition false는 모두 0이다. LIVE JSON은 확장 tracking diagnostic을 이벤트별로 저장하지 않으므로 그 값의 LIVE bit parity까지 주장하지 않는다.

저장 trial/replay의 frame count는 661, usable-any는 634이다. **엄밀한 Guided `[18689, 40689)`에는 LIVE 660프레임**이다. 나머지 1프레임은 `40697.700004ms`의 trial 종료 frame이며, 원본 replay 경계에는 포함되지만 Guided stage에는 속하지 않는다. 이 경계를 섞지 않았다.

Guided 후 저장된 RIGHT `44131.800003ms` (`trialId: null`)는 별도 diagnostic이며 recall/false에 넣지 않았다. STEP4Q의 재추론 post-Guided 결과도 그대로 보존한다.

## 2. Baseline 비교

A는 production의 실제 freeze frame `11549.400002ms`에서 끝나는 1초 rolling collection이다. 수집 시작 marker는 `10539.400002ms`, 실제 사용 구간은 `(10549.400002, 11549.400002]`, 첫 사용 frame은 `10582.700005ms`다. Baseline 생성에 쓰인 30프레임을 production lifecycle로 감사하여 저장값과 다시 일치시켰다.

B/C는 각각 LIVE/FULL_VIDEO 자체 landmark에서 동일한 estimator reference **`[10549.200005, 13549.200005]` 3초**를 사용했다. Production 보정 window와 같지 않다. 모두 유효하며, A는 LEFT/RIGHT usable 30/30, B/C는 각각 90/90이다. 8개 관절 availability도 A는 모두 30, B/C는 모두 90이다.

| 값 | A: 저장 production | B: LIVE 3초 | C: FULL_VIDEO 3초 |
|---|---:|---:|---:|
| bodyScale | 0.295422161 | 0.291979727 | 0.290306930 |
| leftXMedian | -0.037774324 | -0.034994632 | -0.040956534 |
| rightXMedian | 0.001708820 | 0.001708820 | 0.001865774 |
| leftYMedian | 0.302119482 | 0.299010810 | 0.299256612 |
| rightYMedian | 0.287725743 | 0.283758435 | 0.282230079 |
| leftDistanceMedian | 0.289594995 | 0.284863364 | 0.286259689 |
| rightDistanceMedian | 0.301249326 | 0.299096089 | 0.294354171 |

Scale의 B−A는 −0.003442434, C−A는 −0.005115231이다. Y 기준의 B−A는 LEFT −0.003108673 / RIGHT −0.003967308, C−A는 LEFT −0.002862871 / RIGHT −0.005495664다. 값은 달라도 아래 실험에서 이벤트 개수와 시각은 baseline 교체에 민감하지 않았다. 다른 capture나 다른 baseline까지 일반화하지 않는다.

## 3. 네 counterfactual

LIVE 두 조합은 실제 clockSamples를 사용한다. VIDEO 두 조합은 STEP4Q와 동일하게 decoded PTS만 사용하며 LIVE clock을 주입하지 않는다. 실제 LIVE 결과는 LIVE+A이고, 나머지는 원인 진단용 counterfactual이다. 네 조합 모두 유효 baseline과 같은 capture의 시계를 사용하여 COMPARABLE이다. 구현은 baseline이 없으면 NOT_COMPARABLE을 반환하며 fallback baseline을 만들지 않는다.

| 입력 + baseline | LEFT | RIGHT | Neutral false | Twist false | wrong / duplicate / cross-gap | reacquisition false | 이벤트(ms) |
|---|---:|---:|---:|---:|---|---:|---|
| LIVE + A | 1 | 1 | 0 | 0 | 0 / 0 / 0 | 0 | L 32007.5, R 36566.800003 |
| LIVE + B | 1 | 1 | 0 | 0 | 0 / 0 / 0 | 0 | L 32007.5, R 36566.800003 |
| FULL_VIDEO + A | 0 | 1 | 1 | 0 | 0 / 0 / 0 | 1 | R 36649, R 38815(false) |
| FULL_VIDEO + C | 0 | 1 | 1 | 0 | 0 / 0 / 0 | 1 | R 36649, R 38815(false) |

모두 최종 ARMED다. LIVE에서 clockSamples를 제거해도 counts/event timestamps/final state는 그대로다. 원본 parity 문제 또는 이 baseline window 차이만으로 LEFT miss/Neutral false를 설명할 수 없다.

## 4. Frame timeline / 시간 매칭

분석 전에 private `registration.json`으로 고정: capture-relative LIVE performance 시각과 기존 decoded media PTS를 사용한다. LIVE 시간/order 오름차순으로, 같은 stage의 아직 사용하지 않은 이후 VIDEO index 중 가장 가까운 frame을 **±16.666667ms** 안에서 선택한다. 동률은 이전 PTS를 선택한다. 단조 일대일이며 offset fitting·보간·pose 품질에 따른 선택은 없다. Pose missing도 매칭에 포함한다. 시간상 가까움이 동일 camera frame을 증명하지 않는다.

| 항목 | LIVE | FULL_VIDEO |
|---|---:|---:|
| 전체 frame | 1720 | 1988 |
| 전체 pose missing | 469 | 699 |
| 전체 간격 min / median / p95 / max ms | 19.800 / 33.300 / 37.600 / 8963.400 | 2 / 33 / 34 / 97 |
| Guided frame | 660 | 661 |
| Guided pose missing | 27 | 3 |
| Guided usable LEFT / RIGHT | 606 / 633 | 658 / 658 |
| Guided 간격 min / median / p95 / max ms | 21.800 / 33.300 / 36.600 / 43.200 | 26 / 33 / 34 / 40 |
| Guided 400ms 이상 frame gap | 0 | 0 |

LIVE의 전체 최대 gap은 `55596.700005→64560.100006ms`로 Guided 밖이다. 왜 이 구간에 inference가 없었는지는 저장 데이터만으로 확정하지 않는다. 전체 missing 개수의 분모도 다르므로 우열 지표로 사용하지 않는다.

| Stage | LIVE frames / pose miss / usable L,R | VIDEO frames / pose miss / usable L,R | 매칭 / unmatched LIVE,VIDEO |
|---|---|---|---|
| 0 NEUTRAL | 60 / 0 / 60,60 | 60 / 0 / 60,60 | 44 / 16,16 |
| 1 TWIST_LEFT | 90 / 0 / 90,90 | 90 / 0 / 90,90 | 84 / 6,6 |
| 2 NEUTRAL | 60 / 0 / 60,60 | 61 / 0 / 61,61 | 58 / 2,3 |
| 3 TWIST_RIGHT | 90 / 0 / 90,90 | 90 / 0 / 90,90 | 89 / 1,1 |
| 4 NEUTRAL | 60 / 0 / 60,60 | 60 / 0 / 60,60 | 59 / 1,1 |
| 5 KNEE_LEFT | 90 / 0 / 90,90 | 90 / 3 / 87,87 | 88 / 2,2 |
| 6 NEUTRAL | 60 / 0 / 60,60 | 60 / 0 / 60,60 | 57 / 3,3 |
| 7 KNEE_RIGHT | 90 / 27 / 46,63 | 90 / 0 / 90,90 | 76 / 14,14 |
| 8 NEUTRAL | 60 / 0 / 50,60 | 60 / 0 / 60,60 | 45 / 15,15 |

전체 1602쌍, unmatched LIVE 118 / VIDEO 386. Guided는 600쌍, unmatched LIVE 60 / VIDEO 61이다. 전체 절대 정렬차 median 13.399994ms / p95 16.299995ms / max 16.599998ms. 모든 unmatched index와 시각을 private report에 남겼다.

**Sampling control:** 동일 production baseline A에서 VIDEO 661개를 사전 고정한 matched 600개 subset으로 바꾸면 LEFT 0 / RIGHT 1은 유지되지만 Neutral false가 1→0이 된다. 이 subset의 landmark와 순서를 고정하고 시각만 매칭된 LIVE 시각으로 바꾸면 counts는 그대로이고 RIGHT event만 `36649→36639.600006ms`로 변한다.

Subset에는 원래 RIGHT clear를 시작한 `38615ms`와 그 구간의 `38682ms`가 없다. 따라서 clear 시작이 `38648ms`로 늦어지고 `38715ms`까지 67ms밖에 누적되지 않아 WAIT_RETURN을 벗어나지 않는다. Full stream은 같은 시점에 100ms가 되어 ARMED로 돌아온다. Frame을 제외하면 관측된 clear dwell이 바뀐다는 재현 결과다. **Subset은 실제 LIVE frame 스트림이 아니며, 개선된 결과로 선택하거나 원본 frame을 폐기하지 않았다.** 이 실험만으로 LIVE/VIDEO 차이 전부를 sampling 탓으로 귀속하지 않는다.

## 5. LEFT miss / RIGHT 검출 / Neutral false trace

기존 값만 읽었다: `abs(normalizedY) >= 0.40`, enter dwell 50ms, clear `<0.25` 100ms, tracking loss 최소 33ms, stale gap 400ms. Normalized Y는 `(knee−hipCenter Y − baseline Y) / bodyScale`이며 좌우는 landmark identity다.

### LEFT

LIVE는 LEFT stage 내 pose/양쪽 knee 90/90이고 tracking이 계속 READY다. LEFT가 `31939.900002ms`에 −0.507295로 기준을 넘고 `31973.200005ms`에 dwell 33.300ms, `32007.5ms`에 −0.717876 / dwell 67.600ms로 LEFT event를 낸다. 그 전 RIGHT 후보는 33.300ms만 유지되어 취소된다.

FULL_VIDEO+C는 다음과 같다. A로 바꿔도 miss다.

| 시각 ms | LEFT Y | LEFT tracking | clear ms | enter ms | 결과 |
|---:|---:|---|---:|---:|---|
| 31785 | -0.3096 | READY | 0 | 0 | RIGHT의 짧은 후보만 시작 |
| 31818, 31852, 31885 | null | LOST | 0 | 0 | 3 pose-missing frame, 후보 초기화 |
| 31918 | -0.2734 | REACQUIRED_NOT_READY | 0 | 0 | 100ms loss 후 복귀 |
| 31951 | -0.2444 | REACQUIRED_NOT_READY | 0 | 0 | clear 시작 |
| 31985 | -0.2252 | REACQUIRED_NOT_READY | 34 | 0 | 100ms 미달 |
| 32018 | -0.4094 | REACQUIRED_NOT_READY | 0 | 0 | clear 취소, enter 사용 불가 |
| 32051 | -0.7820 | REACQUIRED_NOT_READY | 0 | 0 | 큰 Y여도 gate에 막힘 |
| 34817 | -0.1392 | READY | 133 | 0 | LEFT stage 종료 후에야 복귀 |

LEFT stage의 기준 초과 49프레임 **전부 gate에 막혔다**. Stage tracking 분포는 READY 33 / LOST 3 / REACQUIRED_NOT_READY 54다. “Y evidence 자체가 전혀 없었다”가 아니라, 손실 후 clear가 충분히 유지되지 않아 enter 후보가 만들어지지 않은 경로다.

### RIGHT 정상 검출

LIVE: `36506.200005→36566.800003ms`, dwell 60.600ms, NORMAL_TRACKING.
FULL_VIDEO+C: `36583→36649ms`, dwell 66ms, RIGHT Y −0.451056→−0.893714, POST_REACQUISITION. 두 스트림 모두 RIGHT 1이며 confirmation 시각은 82.200ms 다르다. 값과 시각이 bit-identical해야 한다고 가정하지 않았다.

### 마지막 Neutral false

FULL_VIDEO의 RIGHT는 연속 usable/READY 상태다. C 기준 RIGHT Y가 `38615ms −0.2013`, `38648 −0.2176`, `38682 −0.2032`, `38715 −0.2316`으로 clear 100ms를 채워 WAIT_RETURN→ARMED가 된다. 다음 `38749ms −0.6219`에서 후보가 시작되고, `38782 −0.6177`의 dwell 33ms를 거쳐 **`38815 −0.6040`, 66ms에서 RIGHT event**가 난다. Guided stage는 이미 NEUTRAL이므로 false다.

LIVE는 직전 `38632ms` pose loss 후 `38665ms`에 RIGHT를 재획득한다. `38698.200005ms`의 Y −0.2533은 clear 기준을 아직 충족하지 못하고, READY 복귀는 `38897.900002ms`다. 이 Neutral stage에서 RIGHT의 `absY >= .4` frame은 0이다. 따라서 같은 후보 경로가 없다.

VIDEO false의 eventSource는 POST_REACQUISITION이지만 마지막 reacquiredAt은 **31918ms**, 후보 시작보다 6831ms 전이다. 이 tag는 과거 reacquisition 이후라는 뜻이지 event 직전에 새 loss가 있었다는 뜻이 아니다. Cross-gap confirmation은 false다. Guided label은 지시 시각이지 독립적으로 주석한 실제 운동 ground truth가 아니므로 “사용자가 실제로 완전한 Neutral이었다”까지 확정하지 않는다.

## 6. FULL_IMAGE / HEAVY 보조 진단

FULL_IMAGE baseline은 READY지만 kick stage coverage가 부족하다.

| Stage | pose miss / 전체 | pose 존재 중 knee unusable L,R | usable L,R | 대상 side 기준 초과 / READY에서 초과 | 대상 enter dwell 최대 |
|---|---|---|---|---|---|
| KNEE_LEFT | 20 / 90 | 0,31 | 70,39 | 10 / 2 | 33ms |
| KNEE_RIGHT | 52 / 90 | 15,0 | 23,38 | 2 / 0 | 0ms |

LEFT의 READY 초과 구간은 `31752–31785ms` 두 frame(33ms)이며, 다음 frame에서 기준 아래로 내려간다. 나머지 초과 8프레임은 REACQUIRED_NOT_READY다. RIGHT는 `37116`, `38682ms`에서 기준을 넘지만 둘 다 REACQUIRED_NOT_READY다. 유효 구간 Y evidence는 LEFT absY median 0.119131 / p95 0.610030 / max 1.041731, RIGHT median 0.077184 / p95 0.680624 / max 0.856831이다. 큰 순간 evidence와 연속 사용 가능한 후보는 다르며, 위 관측으로 0 event를 설명할 수 있다. 전체 유효 frame interval은 집계 JSON `auxiliary[].replay.kickStageSignals`에 있다. 검출 성능의 일반적인 결론은 INSUFFICIENT다.

HEAVY Neutral reference에는 pose가 **90/90 존재**한다. 하지만 knee/ankle usable은 모두 0이다.

| 관절 | visibility min / median / max | usable / 90 |
|---|---|---:|
| LEFT HIP | .992214 / .995646 / .997283 | 90 |
| RIGHT HIP | .994280 / .996613 / .997875 | 90 |
| LEFT SHOULDER | .937166 / .965617 / .978830 | 90 |
| RIGHT SHOULDER | .956824 / .975555 / .986224 | 90 |
| LEFT KNEE | .011672 / .023953 / .044138 | 0 |
| RIGHT KNEE | .003938 / .006069 / .013287 | 0 |

Pose 미검출이 아니라, 존재하는 pose의 knee visibility가 기존 .5 기준보다 낮아 양쪽 Neutral sample이 0인 상태다. **INSUFFICIENT_VARIANT_NEUTRAL; detector 성능 NOT_EVALUATED.** 영상/카메라의 원인 또는 Heavy 모델 일반 성능으로 확대 해석하지 않는다.

## 7. 판정과 재현

- REPLAY_PARITY_FAILURE: 관측되지 않음. 원본 parity PASS.
- BASELINE_SENSITIVE: 시험한 A/B/C 교체에서 이벤트 변화 없음.
- INPUT_STREAM_SENSITIVE: A를 고정한 LIVE→VIDEO 교체로 LEFT miss/Neutral false 재현.
- TIMING_OR_SAMPLING_SENSITIVE: matched subset으로 frame을 제외할 때 false가 사라지는 sampling 민감도는 재현. Clock 제거 / 같은 subset의 시각 교체로는 counts 변화 없음.
- MIXED: 위 두 민감도를 함께 기록한다. LIVE와 VIDEO 사이의 landmark 차이·sampling·추적 history를 완전히 독립적으로 분리한 인과 증거는 INSUFFICIENT다.

실행기는 `apps/controller-web/scripts/live-divergence.mjs`다. 입력 JSON/WebM, 기존 STEP4Q private directory, **STEP4R registration.json을 복사한 새로운 Git 밖 output directory**를 인수로 사용한다. 출력은 write-once다.

```sh
cd apps/controller-web
node scripts/live-divergence.mjs <capture.json> <capture.webm> <step4q-private-dir> <fresh-step4r-private-dir>
```

Registration에는 분석 전에 고정한 alignment/실험 정의와 원본 hash가 있다. 재현 시 이를 변경하지 않는다. 실행기는 capture SHA, raw run SHA, 등록된 source/config/protocol, 전체 PTS, STEP4Q 결과의 동일성을 검증하고 불일치 시 중단한다. 브라우저·카메라·MediaPipe inference를 호출하는 경로는 없다. Report는 동일 입력으로 두 번 생성해 결정성을 검사한다.

회귀 검증은 원본 parity와 time/order 경계, 저장 baseline과 자체 baseline, 네 조합, null baseline 차단, missing/NaN 구분, unmatched 보존, post-Guided 제외, 결정성, 4Q 결과 불변을 포함한다. 기본 test command의 기존 worker policy/timeout/package scripts를 변경하지 않았다.

최종 검증: `pnpm --filter @plank-stork/controller-web test` **87 files / 996 tests PASS** (60.18초). 신규 분석 테스트 별도 실행 **18 PASS**. `pnpm typecheck` PASS, `pnpm build` PASS (기존 500kB 초과 chunk 경고 유지). 기존 tracked 267파일과 STEP4Q private 20파일의 SHA가 모두 보존되었다. Commit/push 하지 않았다.

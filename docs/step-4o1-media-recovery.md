# STEP 4O.1 — Capture Media Pair Recovery

읽기 전용 조사 결과입니다. **정확한 identity 0쌍, metadata상 유력한 STRONG_MEDIA_MATCH 5쌍, canRun4O=false**입니다. 기존 STEP4O 코드와 guard는 수정하지 않았습니다. 날짜는 표에 달리 표시하지 않으면 UTC입니다.

## 1. 현재 guard의 정확한 조건

`replayVideoSourceError`는 actual selected filename이 JSON `video.filename`과 정확히 같아야 통과시킵니다. 표준 `plank-stork-replay-YYYY-MM-DDTHH-mm-ss-SSSZ.webm` 이름이면 파싱한 ID와 JSON `captureId`도 정확히 같아야 합니다. 파싱할 수 없는 이름의 ID는 null이며 추정하지 않습니다. 파일명은 현재 identity의 필수 부분이고 대소문자·공백·확장자도 비교에 포함됩니다.

- [실제 identity guard](</Users/gimjeonghyeon/Documents/ChatGPT/plank-stork/apps/controller-web/src/replay/replayVideoSource.ts>) — 이름/파싱 가능한 ID 비교. 파일 내용·크기·길이·codec·해상도·hash는 읽지 않습니다.
- [STEP4F.1 호출부](</Users/gimjeonghyeon/Documents/ChatGPT/plank-stork/apps/controller-web/src/components/ReplayRunner.tsx>) — UI 버튼과 VIDEO 실행 직전 둘 다 guard 검사. LANDMARK에는 WebM이 필요 없습니다.
- [STEP4O 호출부](</Users/gimjeonghyeon/Documents/ChatGPT/plank-stork/apps/controller-web/src/estimator/estimatorInference.ts>) — 같은 guard 이후 Full model URL, GPU, VIDEO/numPoses/confidence/segmentation 옵션이 기록된 control 설정과 같은지 추가 검사합니다. 이는 media byte identity 검증과 별개입니다.
- JSON parser는 captureId 문자열·video.filename 문자열·width/height 숫자 등 구조를 검증할 뿐, 선택한 WebM과 media metadata를 비교하지 않습니다.

## 2. 현재 실패 이유와 내부 metadata

발견된 6개 이름 모두 5개 JSON의 expected filename과 다릅니다. 모두 표준 파일명이 아니어서 selected sourceCaptureId=null입니다. 실제 guard로 5×6=30개 조합을 실행한 결과 모두 같은 mismatch 오류로 거부되었습니다. 다섯 JSON의 Full/VIDEO/GPU 설정은 일치하므로 현재 첫 실패는 파일명 검사입니다.

`ReplayCapture`는 camera MediaStream을 MediaRecorder로 녹화하고 받은 chunk를 그대로 Blob으로 합칩니다. captureId는 JSON과 다운로드 이름에만 넣으며 WebM 내부에 쓰지 않습니다. 6개 파일의 실제 EBML header는 Chrome MuxingApp/WritingApp과 VP8/1280×720, TrackUID를 포함합니다. parsed tags는 `{}`이며 captureId 문자열, DateUTC, SegmentUID, Duration, DefaultDuration은 발견되지 않았습니다. TrackUID를 JSON에 저장하지 않아 이것으로 pair를 대조할 수 없습니다. 파일 xattr에는 Chrome quarantine 기록만 있고 원래 파일명이나 captureId는 없습니다.

**파일명만 나중에 변경되었다는 사실은 UNKNOWN입니다.** 아래 일치 근거는 이를 뒷받침하지만, 저장할 때부터 다른 이름을 사용했는지 또는 다른 동일 조건 녹화인지까지 증명하지 않습니다.

## 3. 탐색 범위와 WebM 후보 inventory

`~/Downloads`, `~/Desktop`, `~/Documents/ChatGPT`를 숨김/ignore 파일을 포함해 확장자 대소문자 구분 없이 탐색했습니다. project와 `~/Desktop/plank-stork-shadow-analysis`는 이 탐색에 포함됩니다. directory symlink는 따라가지 않았으며 다른 디스크·클라우드·휴지통·archive 내부까지 없다고 주장하지 않습니다. Downloads 0개, Desktop 6개, project/주변 ChatGPT 폴더 0개, shadow-analysis 하위 0개입니다.

공통 codec=VP8, 크기=1280×720. **WebM nominal fps와 정확한 display duration은 미기록**입니다. fps는 encoded packet의 관측 평균입니다. `computeDuration()`은 이 파일들에서 last-packet duration=0 때문에 마지막 PTS와 같습니다. 이를 정확한 녹화 duration이라고 간주하지 않습니다. PTS 시작은 모두 0이고 전 구간 strictly increasing입니다. 영상 decode/pose inference는 하지 않았습니다.

| Absolute path | Size (bytes) | Modified UTC | File birth UTC | PTS range (s) | Packets / observed fps |
|---|---:|---|---|---|---|
| [/Users/gimjeonghyeon/Desktop/2차검증1.webm](</Users/gimjeonghyeon/Desktop/2차검증1.webm>) | 16,314,317 | 2026-09-30T11:21:09.177Z | 2026-09-30T11:21:09.159Z | 0–31.751 | 954 / 30.04630 |
| [/Users/gimjeonghyeon/Desktop/3차검증.webm](</Users/gimjeonghyeon/Desktop/3차검증.webm>) | 29,202,260 | 2026-09-30T11:40:17.885Z | 2026-09-30T11:40:17.837Z | 0–57.572 | 1729 / 30.03196 |
| [/Users/gimjeonghyeon/Desktop/4gi replay webm.webm](</Users/gimjeonghyeon/Desktop/4gi replay webm.webm>) | 28,591,187 | 2026-10-03T16:40:35.116Z | 2026-10-03T16:40:35.074Z | 0–56.440 | 1695 / 30.03189 |
| [/Users/gimjeonghyeon/Desktop/4j result webm.webm](</Users/gimjeonghyeon/Desktop/4j result webm.webm>) | 23,440,158 | 2026-10-05T14:39:05.060Z | 2026-10-05T14:39:05.029Z | 0–46.178 | 1387 / 30.03595 |
| [/Users/gimjeonghyeon/Desktop/4k.2a webm.webm](</Users/gimjeonghyeon/Desktop/4k.2a webm.webm>) | 25,374,793 | 2026-10-06T11:20:04.301Z | 2026-10-06T11:20:04.269Z | 0–50.109 | 1505 / 30.03452 |
| [/Users/gimjeonghyeon/Desktop/clean인가.webm](</Users/gimjeonghyeon/Desktop/clean인가.webm>) | 21,159,257 | 2026-09-30T12:09:58.494Z | 2026-09-30T12:09:58.462Z | 0–41.581 | 1248 / 30.01371 |

5개 JSON의 실제 metadata는 다음과 같습니다. 공통 video MIME=`video/webm;codecs=vp8`, width/height=1280×720, nominal fps=30, requested bitrate=4,000,000bps입니다. duration은 JSON의 capture clock 값이며 container duration과 동일 필드는 아닙니다.

| Role / JSON path | captureId | createdAt UTC | Capture duration (s) | Pose frames / first–last tMs |
|---|---|---|---:|---|
| STRESS / [/Users/gimjeonghyeon/Desktop/3차검증2.json](</Users/gimjeonghyeon/Desktop/3차검증2.json>) | `plank-stork-replay-2026-09-30T11-39-17-364Z` | 2026-09-30T11:39:17.364Z | 57.628500 | 1730 / 7.100–57613.100 |
| OLD CLEAN / [/Users/gimjeonghyeon/Desktop/clean인가요.json](</Users/gimjeonghyeon/Desktop/clean인가요.json>) | `plank-stork-replay-2026-09-30T12-09-14-840Z` | 2026-09-30T12:09:14.840Z | 41.620100 | 1248 / 19.400–41600.200 |
| LIVE1 / [/Users/gimjeonghyeon/Desktop/4gi replay json.json](</Users/gimjeonghyeon/Desktop/4gi replay json.json>) | `plank-stork-replay-2026-10-03T16-39-36-229Z` | 2026-10-03T16:39:36.229Z | 56.481700 | 1693 / 8.600–56454.700 |
| LIVE2 / [/Users/gimjeonghyeon/Desktop/4j result json.json](</Users/gimjeonghyeon/Desktop/4j result json.json>) | `plank-stork-replay-2026-10-05T14-37-39-718Z` | 2026-10-05T14:37:39.718Z | 46.216200 | 1387 / 14.900–46194.900 |
| LIVE3 / [/Users/gimjeonghyeon/Desktop/4k.2a json.json](</Users/gimjeonghyeon/Desktop/4k.2a json.json>) | `plank-stork-replay-2026-10-06T11-19-04-864Z` | 2026-10-06T11:19:04.864Z | 50.151900 | 1502 / 19.600–50132.400 |

## 4. JSON별 pairing 상태

| Role | Expected original WebM | Current candidate | Status | canRun4O |
|---|---|---|---|---|
| STRESS | `plank-stork-replay-2026-09-30T11-39-17-364Z.webm` | [3차검증.webm](</Users/gimjeonghyeon/Desktop/3차검증.webm>) | STRONG_MEDIA_MATCH | false |
| OLD CLEAN | `plank-stork-replay-2026-09-30T12-09-14-840Z.webm` | [clean인가.webm](</Users/gimjeonghyeon/Desktop/clean인가.webm>) | STRONG_MEDIA_MATCH | false |
| LIVE1 | `plank-stork-replay-2026-10-03T16-39-36-229Z.webm` | [4gi replay webm.webm](</Users/gimjeonghyeon/Desktop/4gi replay webm.webm>) | STRONG_MEDIA_MATCH | false |
| LIVE2 | `plank-stork-replay-2026-10-05T14-37-39-718Z.webm` | [4j result webm.webm](</Users/gimjeonghyeon/Desktop/4j result webm.webm>) | STRONG_MEDIA_MATCH | false |
| LIVE3 | `plank-stork-replay-2026-10-06T11-19-04-864Z.webm` | [4k.2a webm.webm](</Users/gimjeonghyeon/Desktop/4k.2a webm.webm>) | STRONG_MEDIA_MATCH | false |

## 5. EXACT / STRONG / AMBIGUOUS 근거

EXACT_IDENTITY는 0입니다. 위 다섯 STRONG 판정은 파일명 유사성이 아닌 전체 후보 간 codec/해상도/PTS span/파일 생성 시각 비교를 검토한 결과입니다. 이것은 자동 pairing이나 실행 승인이 아닙니다. 정확한 content identity와 rename-only 여부는 여전히 UNKNOWN이며 STRONG을 EXACT로 승격하지 않습니다.

| Role | Capture stop − last PTS (ms) | Stop − nominal last-frame end estimate (ms) | File birth − capture end (s) | JSON inference frames / WebM packets |
|---|---:|---:|---:|---|
| STRESS | 56.500 | 23.167 | 2.845 | 1730 / 1729 |
| OLD CLEAN | 39.100 | 5.767 | 2.002 | 1248 / 1248 |
| LIVE1 | 41.700 | 8.367 | 2.363 | 1693 / 1695 |
| LIVE2 | 38.200 | 4.867 | 39.095 | 1387 / 1387 |
| LIVE3 | 42.900 | 9.567 | 9.253 | 1502 / 1505 |

Nominal last-frame end는 JSON의 30fps에서 33.333ms를 더한 참고 추정이며 measured duration이 아닙니다. 수십 ms 차이를 정확한 길이 일치로 표현하지 않습니다. MediaRecorder packet 수와 inference 수는 서로 다른 sampling path이므로 동일성을 보장하는 fingerprint가 아닙니다. 다른 25개 조합은 이 capture와 PTS 범위 및 파일 생성 시점이 다르므로 MISMATCH로 기록했습니다. 후보 여러 개가 동등하게 일치하는 AMBIGUOUS case는 발견하지 못했지만, STRONG도 역사적 원본 identity가 증명되었다는 뜻은 아닙니다.

`2차검증1.webm`은 PTS 31.751s, 생성 2026-09-30 11:21:09 UTC로 다섯 대상 어느 것에도 맞지 않습니다.

각 영상과 JSON의 byte SHA-256, 전체 encoded packet timestamp SHA-256을 계산했습니다. 원래 JSON에는 video hash/byte length가 없으므로 새 hash로 과거 JSON↔WebM pairing을 소급 증명할 수 없습니다. 같은 이름/내용의 중복 후보는 발견되지 않았습니다. 전체 30개 대조와 원시 metadata/hash는 [local inventory JSON](</Users/gimjeonghyeon/Desktop/plank-stork-shadow-analysis/step-4o1-media-recovery.json>)에 있습니다.

## 6. 누락된 WebM 존재 여부

Expected original filename의 파일은 5개 모두 탐색 범위에서 찾지 못했습니다. 다만 유력한 content 후보는 다섯 개 모두 있으므로 영상 내용 자체가 분실되었다고 단정하지 않습니다. 원본 이름의 파일 부재는 확인했고, 원본 내용 부재는 UNKNOWN입니다.

## 7. STEP4O 실행 가능 여부

**canRun4O=false, allPairsSafe=false.** 다섯 pair 모두 현재 guard를 통과하지 못합니다. guard 수정, 이름 변경, JSON 변경 또는 새 File wrapper의 이름 교체 같은 우회는 하지 않았습니다.

## 8. Estimator 실행 결과

FULL_VIDEO_CONTROL / FULL_IMAGE / HEAVY_VIDEO 모두 미실행입니다. 기존 STEP4O 설정·threshold·analysis 로직은 그대로 두었습니다.

## 9. 사용자에게 필요한 정확한 파일

기존 다운로드/백업/원래 저장 폴더에서 다음 이름의 원본 파일과 실제 위치를 찾아야 합니다. 새로 아래 이름을 붙이거나 복사본 이름을 바꿔 guard를 통과시키는 복구는 하지 않습니다. 탐색한 로컬 경로 안에서는 찾지 못했으므로 미확인 절대 경로를 만들어 안내하지 않습니다.

- STRESS: `plank-stork-replay-2026-09-30T11-39-17-364Z.webm`
- OLD CLEAN: `plank-stork-replay-2026-09-30T12-09-14-840Z.webm`
- LIVE1: `plank-stork-replay-2026-10-03T16-39-36-229Z.webm`
- LIVE2: `plank-stork-replay-2026-10-05T14-37-39-718Z.webm`
- LIVE3: `plank-stork-replay-2026-10-06T11-19-04-864Z.webm`

## 10. 향후 rename-safe identity 설계안 (미구현)

Capture stop과 마지막 dataavailable 이후 확정된 WebM 바이트에 SHA-256을 계산합니다. JSON manifest에 captureId, videoFilename(표시용), videoSha256, videoByteLength, 측정한 videoDuration 또는 null 및 측정 방식, codec, width, height를 함께 저장합니다. WebM tag 또는 sidecar에는 같은 captureId를 기록하고 sidecar도 video hash/byte length를 참조하게 합니다.

차후 버전의 validator는 filename 대신 실제 선택한 bytes의 hash+length를 authoritative binding으로 검사하고, 읽을 수 있는 captureId를 교차검증합니다. codec/해상도/길이는 보조 검사로만 사용합니다. WebM에 tag를 추가한다면 최종 muxing이 끝난 뒤 hash를 계산해야 합니다. JSON+WebM+manifest를 한 archive로 내려받게 하면 pair 분실을 줄일 수 있습니다. digest는 manifest와 파일을 묶는 수단이며 그 자체로 외부 진본성을 보장하는 서명은 아닙니다.

과거 capture에 hash를 지금 추가해 원래부터 확인된 pair로 취급하지 않습니다. 과거 검증 불가 상태를 보존하고, schema/validator migration은 STEP4O 결과 이후 별도 cleanup에서 수행합니다. 이번 단계에서는 설계만 기록했습니다.

## 11. Tests / 무변경 검증

- 실제 guard로 30개 JSON/WebM 조합 검사: 통과 0, 거부 30.
- `pnpm --filter @plank-stork/controller-web test`: **75 files / 801 tests 통과**.
- 6개 WebM + 5개 JSON의 SHA-256·크기·inode·mtime 재확인: 모두 불변.
- guard, ReplayCapture, replay schema, production initializer/constants, KneeKickDetectorV3: HEAD와 byte 동일.
- 이 단계에서 추가한 repo 파일은 이 조사 보고서뿐입니다. 기존 STEP4O 미커밋 변경은 보존했습니다. application code 변경이 없어 typecheck/build는 이번 단계에서 반복하지 않았습니다.

## 12. Commit / push

commit/push 하지 않았습니다. 기존 media/JSON 삭제·이동·rename·metadata 수정, 새 운동·촬영, production 또는 estimator 변경도 하지 않았습니다.

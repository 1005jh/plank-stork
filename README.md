# Plank Stork

STEP 4D: 폰에서 Neutral 보정 후 Knee Motion Validation을 수행하고, 노트북에서 raw Pose·knee 후보 feature·속도·corridor 통계를 JSON으로 내려받습니다. Action Calibration은 필요하지 않습니다. STEP 4C의 Action Signal Validation도 별도로 유지합니다. STEP 4B-2의 단계 안내와 Live Classification도 유지합니다. controller-web이 Pose 측정과 보정/classifier 계산을 담당하며 NestJS Socket.IO가 요청과 상태 snapshot을 중계합니다. STEP 3B의 로컬 Dataset Recorder, STEP 3A의 좌표 패널, STEP 2의 성능 지표와 STEP 1의 Socket.IO 테스트도 유지합니다. Raw Pose는 전송하지 않으며 게임 입력으로 변환하지 않습니다.

```text
apps/
  controller-web/  Vite + React + TypeScript
  mobile/          Vite + React + TypeScript
  server/          NestJS + TypeScript
packages/
  protocol/        방향/테스트 메시지 및 calibration remote wire 타입
```

## 설치

Node.js 24 LTS를 사용합니다. nvm 사용 시 `nvm install && nvm use`로 버전을 맞출 수 있습니다.

```sh
corepack enable pnpm
pnpm install
```

Corepack이 없다면 `npm install --global corepack` 후 위 명령을 실행합니다.
루트 `packageManager`에 pnpm 버전이 고정되어 있으며 `pnpm-lock.yaml`을 함께 관리합니다.

## 실행

루트에서 세 앱을 동시에 실행합니다.

```sh
pnpm dev
```

또는 별도 터미널에서 필요한 앱만 실행합니다.

```sh
pnpm dev:controller-web
pnpm dev:mobile
pnpm dev:server
```

루트의 개발 및 타입 검사 명령은 공통 타입 패키지를 먼저 빌드합니다. `protocol` 타입을 수정했다면 실행 중인 개발 명령을 다시 시작하거나 `pnpm --filter @plank-stork/protocol build`를 실행합니다.

| 앱 | 로컬 주소 | 표시 또는 응답 |
| --- | --- | --- |
| controller-web | http://localhost:5173 | Plank Stork Controller |
| mobile | http://localhost:5174 | Plank Stork / Mobile Game |
| server | http://localhost:3000/health | `{"status":"ok"}` |

세 앱은 `0.0.0.0`에서 listen합니다. 같은 LAN의 다른 기기에서는 `localhost` 대신 개발 컴퓨터의 LAN IP를 사용합니다(예: `http://192.168.0.10:3000/health`). 기기 간 네트워크 연결과 해당 포트의 방화벽 허용이 필요합니다. 웹 앱은 지정 포트가 이미 사용 중이면 오류를 표시합니다.

## STEP 1: 노트북 ↔ 스마트폰 테스트

1. 두 기기를 같은 LAN/Wi-Fi에 연결하고 노트북에서 `pnpm dev`를 실행합니다.
2. 노트북에서 controller-web `http://localhost:5173`을 엽니다. 서버는 HTTP와 Socket.IO 모두 `http://localhost:3000`을 사용하며, 상태 확인 경로는 `/health`입니다.
3. Vite 시작 로그의 `Network` 주소 또는 OS 네트워크 설정에서 노트북의 LAN IP를 확인합니다.
4. **스마트폰에서 먼저** `http://<LAPTOP_LAN_IP>:3000/health`를 열어 `{"status":"ok"}` 응답을 확인합니다.
5. 스마트폰에서 mobile `http://<LAPTOP_LAN_IP>:5174`를 엽니다. 스마트폰에서 `localhost`를 사용하면 스마트폰 자신을 가리킵니다.
6. 두 화면에서 `CONNECTED`를 확인합니다. 표시된 Socket server 주소는 각각 페이지의 현재 hostname과 포트 3000으로 만들어집니다.
7. 노트북의 LEFT/RIGHT를 누르면 **두 화면 모두** 같은 direction과 timestamp(발신 기기의 `Date.now()`, Unix 밀리초)를 표시해야 합니다. 스마트폰에서도 두 버튼을 눌러 반대 방향을 확인합니다. 서버는 발신자를 포함한 모든 연결에 `control:test:received`를 전송합니다.
8. 서버를 중지하면 두 화면에 `DISCONNECTED`가 표시되고 버튼이 비활성화됩니다. 서버를 다시 실행하면 자동으로 재연결됩니다. 서버 로그에서 연결/해제를 확인할 수 있습니다.

스마트폰 없이 로컬 동작만 확인하려면 노트북에서 `http://localhost:5174`를 함께 열어 같은 순서로 테스트합니다. 실제 기기 간 통신은 위 스마트폰 절차로 확인합니다.

접속되지 않으면 사설 네트워크에서 Node.js 또는 TCP 포트 3000·5173·5174의 접근을 허용하고, Wi-Fi의 기기 간 통신 차단/게스트 네트워크 여부를 확인합니다. 방화벽 전체를 끄지 않습니다. Socket.IO CORS는 HTTP 개발 화면의 포트 5173·5174를 허용하도록 설정되어 있습니다.

## STEP 2: 웹캠 Pose Landmark POC

`pnpm install` 후 `pnpm dev` 또는 `pnpm dev:controller-web`로 실행하고 **웹캠이 있는 노트북의 http://localhost:5173**을 엽니다. 카메라는 [secure context(localhost 또는 HTTPS)](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia#privacy_and_security)에서 사용할 수 있습니다. HTTP LAN IP로 연 화면에서는 카메라가 제한될 수 있으므로 이번 POC은 노트북의 localhost에서 테스트합니다.

Start Camera를 누르고 카메라 권한을 허용합니다. 첫 시작에는 인터넷을 통해 WASM과 [공식 Pose Landmarker Full 모델](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker#models)을 내려받으므로 로딩 시간이 필요합니다. URL은 `src/pose/poseConstants.ts`에서 관리하며, WASM과 npm 패키지는 같은 버전(1.0.1)으로 고정했습니다. VIDEO 모드, GPU 우선(CPU 1회 fallback), 최대 1명, 세 confidence 값은 각각 0.5, segmentation은 비활성화합니다.

초기화 진단은 브라우저 콘솔의 `[Pose]` 로그로 확인합니다: `WASM_LOADING` → `WASM_READY` → `MODEL_LOADING` → `GPU_INITIALIZING` → `POSE_READY`. GPU가 실패하면 원본 오류를 warning으로 남기고 `CPU_INITIALIZING`을 거쳐 CPU로 한 번 재시도합니다. 최종 실패는 `console.error`에 원본 오류 객체를 기록하고 화면에도 오류 메시지를 표시합니다. 성공한 delegate는 화면에 GPU 또는 CPU로 표시됩니다.

`WASM_READY`는 FilesetResolver의 경로 준비 완료를 뜻합니다. 실제 모델 다운로드와 WASM 런타임·delegate 초기화는 MediaPipe의 `createFromOptions` 내부에서 처리됩니다.

다음 항목을 확인합니다. 이 단계는 자세를 분류하거나 동작 성공 여부를 판정하지 않습니다.

1. **Start / Stop**: 영상이 시작되는지, Stop 후 카메라 사용 표시가 꺼지고 overlay·지표·visibility가 초기화되는지 확인합니다. 시작 도중 Stop 및 반복 Start/Stop도 확인합니다.
2. **Skeleton overlay**: 모든 landmark 점과 연결선이 영상의 신체 위치와 일치하는지 확인합니다. Mirror ON/OFF로 영상과 overlay를 함께 뒤집을 수 있으며, LEFT/RIGHT 이름은 사람의 신체 기준입니다.
3. **사람 없음**: 화면에서 벗어나면 overlay가 지워지고 `Pose: NOT DETECTED`, visibility `-`가 표시되는지 확인합니다(지표 갱신 주기는 500ms).
4. **서 있는 자세**: 전신이 보이도록 서서 양쪽 어깨·골반·무릎·발목의 visibility를 확인합니다.
5. **플랭크 자세**: 카메라 높이·각도를 조절하면서 가려지는 관절과 추적 끊김을 관찰합니다.
6. **몸을 좌우로 비트는 동작**: 좌우 landmark가 바뀌거나 overlay가 튀는지 관찰합니다.
7. **왼쪽 무릎을 옆으로 이동**: 왼쪽 골반·무릎·발목을 관찰합니다.
8. **오른쪽 무릎을 옆으로 이동**: 오른쪽 골반·무릎·발목을 관찰합니다.
9. **FPS / inference ms**: 각 자세에서 5~10초 정도 유지하고 지표를 비교합니다. CPU/GPU 부하, 조명, 카메라 각도·거리, 실제 영상 크기를 함께 기록하면 비교하기 좋습니다.

지표는 다음 의미입니다.

| 지표 | 계산 |
| --- | --- |
| Camera / Render FPS | 최근 갱신 구간에서 관측한 서로 다른 video frame 수 / rAF 실행 수를 각각 경과 초로 나눈 값. Camera FPS는 브라우저에서 처리한 프레임률이며 카메라 하드웨어의 전체 출력 프레임률이 아닙니다. |
| Pose inference FPS | 같은 구간의 실제 `detectForVideo` 호출 수 ÷ 경과 초. 동일 video frame에서는 재호출하지 않으며, 정상 동작 시 Camera FPS와 같을 수 있습니다. |
| Average inference time | `detectForVideo` 호출 전후 `performance.now()` 차이의 최근 30회 이동 평균(ms). 모델 로딩, canvas 그리기 시간은 제외합니다. |

UI 지표와 visibility는 500ms마다 갱신합니다. 추론은 메인 스레드에서 실행하므로 느린 기기에서는 Render FPS도 함께 내려갈 수 있습니다. 권한 거부·장치 없음·모델 로딩 실패는 화면의 오류 메시지를 확인한 뒤 다시 시작합니다. 백그라운드 탭에서는 브라우저가 rAF를 제한하므로 성능 비교는 활성 탭에서 진행합니다.

Pose 데이터는 controller-web 내부에서만 사용하며 Socket으로 전송하지 않습니다. 화면 아래 LEFT/RIGHT Socket 테스트는 STEP 1과 동일하게 사용할 수 있습니다.

## STEP 3A: Pose Signal Analysis

노트북에서 `http://localhost:5173`을 열고 Start Camera를 누릅니다. 양쪽 hip/knee가 보이도록 카메라 위치를 고정한 뒤 `Pose Signal Analysis — Hip / Knee` 패널을 관찰합니다.

- 대상: LEFT_HIP(23), RIGHT_HIP(24), LEFT_KNEE(25), RIGHT_KNEE(26).
- `x`, `y`, `z`, `visibility`는 `landmarks`, `worldX`, `worldY`, `worldZ`는 같은 인덱스의 `worldLandmarks`에서 가져옵니다. 원본 숫자를 소수점 세 자리로 표시하며, 해석이나 보정 없이 500ms마다 갱신합니다.
- 결과 또는 해당 값이 없으면 `-`로 표시하며 Stop 시에도 초기화합니다.
- Mirror ON/OFF는 video와 canvas의 **표시만** 뒤집습니다. 모델 입력, 좌표 부호·값, 신체 기준 LEFT/RIGHT, Socket 테스트나 향후 게임 방향과는 연결되지 않습니다. 토글 시 카메라를 재시작하지 않습니다.

아래 순서대로 각 자세를 **약 3~5초 유지**하면서 좌우 hip/knee의 좌표 변화와 visibility를 관찰합니다. Neutral은 같은 기본 플랭크 자세로 돌아오는 것을 뜻합니다. Left/Right는 본인의 신체 기준으로 수행합니다.

1. Neutral plank
2. Twist left
3. Neutral
4. Twist right
5. Neutral
6. Knee left
7. Neutral
8. Knee right

각 Neutral 복귀 시 값이 어떻게 돌아오는지, 특정 자세에서 관절이 가려지면서 visibility가 낮아지거나 값이 끊기는지 함께 관찰합니다. Mirror 설정을 바꿔 같은 순서를 반복해도 좌표의 의미는 같습니다. Pose FPS / inference ms / GPU·CPU도 함께 확인합니다. 이 raw 패널은 보정 전 값을 그대로 보여줍니다. Neutral 대비 변화와 smoothing은 아래 STEP 4A 패널에서 따로 확인합니다.

## STEP 3B: Pose Dataset Recorder

이번 실험의 권장 카메라 배치는 **발쪽에서 머리 방향을 바라보는 위치**, **책상 높이**, **몸 전체가 프레임에 들어오는 거리**입니다. 이는 현재 실측에서 가장 안정적으로 관찰된 baseline이며, 확정된 제품 요구사항은 아닙니다.

1. `pnpm dev` 실행 후 노트북에서 `http://localhost:5173`을 열고 Start Camera를 누릅니다.
2. Camera가 RUNNING이고 Pose가 감지되는지 확인합니다. 감지 전에는 Start Guided Recording을 사용할 수 없습니다. 버튼을 누를 때도 최신 raw frame으로 다시 확인합니다.
3. Mirror ON/OFF를 원하는 표시 방식으로 설정하고 **Start Guided Recording**을 한 번 누릅니다. Voice guide가 켜져 있으면 가능한 브라우저에서 한국어로 안내합니다. 음성 미지원/실패 시에도 화면 안내와 기록은 계속됩니다.
4. 다음 총 **33초** sequence를 따릅니다. 좌우는 본인의 신체 기준입니다. 전환 중에는 가능하면 Neutral을 거쳐 다음 자세로 이동합니다.

| 단계 | 시간 | 저장 |
| --- | --- | --- |
| PREPARE | 5초 | X |
| STABILIZE — 자세 안정화 중 | 1초 | X |
| NEUTRAL | 3초 | O |
| TRANSITION → TWIST_LEFT | 3초 | X |
| TWIST_LEFT | 3초 | O |
| TRANSITION → TWIST_RIGHT | 3초 | X |
| TWIST_RIGHT | 3초 | O |
| TRANSITION → KNEE_LEFT | 3초 | X |
| KNEE_LEFT | 3초 | O |
| TRANSITION → KNEE_RIGHT | 3초 | X |
| KNEE_RIGHT | 3초 | O |

5. 화면의 현재 단계, 남은 시간, Samples를 확인합니다. Pose가 사라진 기록 프레임은 저장하지 않고 Dropped frames에 집계하며, 다음 정상 프레임부터 계속 기록합니다. 준비·안정화·전환 중에는 sample과 dropped 모두 집계하지 않습니다. STABILIZE에서는 Neutral plank를 유지하며 추적이 안정될 시간을 줍니다.
6. COMPLETED 후 label별 `N samples / N dropped`와 전체 Dropped frames를 확인하고 **Download JSON**을 누릅니다. 30 inference FPS라면 label당 약 90개, 총 약 450개가 예상되지만 실제 FPS와 pose 누락에 따라 달라집니다.
7. 새 실험은 필요한 파일을 다운로드한 뒤 **Reset Dataset**으로 시작합니다. Reset은 진행 중인 기록도 중단하고 샘플·count를 지웁니다.

카메라 Stop, 연결 해제, frame 처리 오류, 컴포넌트 unmount는 Recorder를 안전하게 중단합니다. 화면이 유지되는 경우 부분 데이터도 `status: "INTERRUPTED"`로 다운로드할 수 있습니다. 페이지를 닫거나 새로고침하면 메모리 데이터는 사라집니다. 안내와 성능 측정을 위해 기록 중에는 이 탭을 활성 상태로 유지합니다.

**데이터와 시간 기준**

- UI의 500ms 좌표/metrics와 별개로, `detectForVideo`가 반환한 **각 추론 프레임**에서 전체 landmark와 world landmark(가능하면 각각 33개)의 primitive 값만 복사합니다. `result.close()`는 기존처럼 실행됩니다.
- top-level: `version: 1`, `createdAt`(기록 시작 ISO 시각), `model: "pose_landmarker_full"`, `delegate`, `videoWidth`, `videoHeight`, `previewMirrored`, `timeOrigin`, `status`, `sampleCounts`, `droppedPoseFrameCount`, `droppedPoseFrameCounts`, `samples`.
- `droppedPoseFrameCounts`는 다섯 label별 누락 수이며 그 합은 기존 전체 `droppedPoseFrameCount`와 같습니다. 필드 추가이므로 JSON `version: 1`을 유지합니다. 이전 v1 파일에는 label별 집계가 없을 수 있으며, 분석 시 누락된 집계를 0으로 단정하지 않습니다.
- 각 sample: `label`, `timestamp`, `videoTime`, `landmarks`, `worldLandmarks`. 각 점은 `index`, `x`, `y`, `z`, `visibility`이며 없는 visibility는 `null`입니다. 표시용 반올림을 적용하지 않은 원본 정밀도로 저장합니다.
- `timestamp`는 해당 추론 시작 시의 `performance.now()` 밀리초이며, `timeOrigin + timestamp`로 Unix 밀리초 시각을 얻습니다. `videoTime`은 카메라의 `video.currentTime` 초입니다. sequence와 label 경계는 React 상태가 아닌 같은 단조 시계로 결정합니다.
- `previewMirrored`는 **기록 시작 시** 표시 설정의 메타데이터입니다. 기록 도중 토글해도 raw/world 좌표, 신체 기준 label, 기존 dataset 값은 변하지 않습니다.
- JSON은 `plank-stork-pose-<시각>.json` 이름으로 Blob/ObjectURL을 이용해 다운로드하며, 영상·이미지·음성은 저장하지 않습니다. 서버/Socket/DB로 전송하지 않습니다.

Recorder의 raw 좌표에는 아래 STEP 4A의 visibility 조건, calibration, smoothing을 적용하지 않습니다. 음성 안내의 자세명은 수집 label을 안내하는 것이며 자동 판별 결과가 아닙니다.

## STEP 4A: Calibrated Pose Features

`Pose Signal Analysis` 아래에서 **Raw Features → Neutral Calibration → Calibrated / Smoothed Features**를 확인합니다. 모든 추론 결과를 독립 분석 객체에 전달하며 React 화면은 250ms마다 갱신합니다. Recorder label/JSON 형식과 분석 코드는 분리되어 있고, Mirror 설정을 분석 함수에 전달하지 않습니다.

**Feature 계산**

| Feature | 계산 |
| --- | --- |
| hipCenterX / hipCenterY | image 좌표의 양쪽 hip(23, 24) X / Y 평균 |
| hipWidth | 양쪽 hip image X 차이의 절댓값 |
| hipDepthDifference | world landmark의 left hip Z − right hip Z |
| left/rightKneeRelativeX / Y | 같은 쪽 knee(25, 26) image X / Y − hip image X / Y |
| left/rightKneeDistanceFromHip | 같은 쪽 image hip/knee의 2D 거리 `hypot(dx, dy)` |
| left/rightHipVisibility, left/rightKneeVisibility | 각 image landmark의 원본 visibility |

관련 landmark/값이 없거나 유한한 숫자가 아니면 해당 feature만 `null`(`-`)입니다. world 좌표가 없으면 world 기반 depth만 비어 있고 image feature는 유지됩니다. Raw에는 visibility 필터, 좌우 변환, smoothing을 적용하지 않습니다.

**Calibration / smoothing 규칙**

- **Calibrate Neutral**을 누른 뒤 최소 1초 동안 Neutral을 유지합니다. 최근 `(현재 시각 − 1000ms, 현재 시각]`의 유효 값으로 각 baseline의 **중앙값(median)**을 구합니다. 각 feature는 유효 값 최소 20개가 모이면 기준값과 당시 count를 고정합니다.
- 전체 완료의 필수 항목은 **hipCenterX, hipCenterY, hipDepthDifference**입니다. 이 세 항목이 준비되면 `CALIBRATED`로 전환합니다. world depth도 필수이므로 world 좌표가 없으면 HIP은 `PARTIAL`입니다.
- 양쪽 knee X/Y baseline은 각각 독립적으로 수집합니다. knee sample이 0개여도 HIP 완료를 막지 않습니다. **HIP이 처음 READY가 된 frame의 시각(`hipReadyAt`)부터 최대 1000ms** 동안만 미완료 knee를 추가 수집합니다(`KNEE_CALIBRATION_GRACE_MS = 1000`). baseline이 없는 delta는 `null`로 유지하며 0이나 다른 값으로 대체하지 않습니다.
- UI는 **HIP / LEFT KNEE / RIGHT KNEE**별 `N / 20 READY 또는 PARTIAL`을 표시합니다. 그룹 count는 해당 feature들의 유효 count 중 최솟값입니다. 수집 중인 값은 최근 1초의 count이며, 오래된 sample은 계속 누적하지 않습니다. 준비된 baseline/count는 즉시 고정됩니다. Grace 종료 시 미완료 feature도 종료 시각 기준 최근 1초의 count와 `null` baseline으로 고정됩니다.
- **상태 순서**: `CALIBRATING`(HIP 수집) → `CALIBRATED / FINISHING`(HIP READY, knee 추가 수집 최대 1초) → `CALIBRATED` + `Calibration frozen`(모든 수집 종료). FINISHING에서는 `HIP READY · Finalizing knee calibration...`와 남은 시간을 표시합니다. 모든 knee가 먼저 준비되면 즉시 고정하므로 FINISHING을 일찍 마치거나 건너뛸 수 있습니다.
- **FINISHING 안내가 끝날 때까지 Neutral을 유지하세요.** 자동으로 Neutral 자세인지 판정하지 않습니다. Grace 마감 시각과 같거나 이후인 frame은 calibration에 넣지 않습니다. UI 갱신이 늦거나 추론 frame이 끊겨도 마감 시각은 연장되지 않습니다.
- `Calibration frozen` 이후에는 PARTIAL knee가 있어도 정상 종료입니다. 더 이상 sample을 수집하지 않으며 Twist/Knee 동작이나 pose loss로 baseline/count가 변경되지 않습니다. 미완료 knee feature의 delta는 계속 `null`입니다. 다시 수집하려면 **Calibrate Neutral**을 누릅니다. 진행 중/고정 후 모두 기존 baseline·count·grace 시각·smoothing을 비우고 처음부터 시작합니다.
- `poseFeatureAnalysis.ts`의 **HIP_CALIBRATION_VISIBILITY = 0.7**, **KNEE_CALIBRATION_VISIBILITY = 0.5**를 사용합니다. HIP feature에는 양쪽 hip이 각각 0.7 이상, knee feature에는 해당 hip이 0.7 이상이고 해당 knee가 0.5 이상인 sample만 넣습니다. 값/visibility가 없으면 제외합니다.
- 분리 이유: 실측에서 hip visibility는 안정적으로 **0.9~1.0** 수준이지만, knee는 카메라 각도·가림 때문에 더 낮을 수 있었습니다. Knee 0.5는 초기 실험 기준이며 **향후 추가 데이터에 따라 조정 가능한 상수**입니다. 이는 calibration/smoothing의 측정 품질 조건으로, 동작 classification threshold가 아닙니다. Raw feature와 Recorder에는 적용하지 않습니다.
- `Calibrated`는 7개 feature의 **현재 raw 값 − 해당 Neutral baseline**입니다. 어느 한쪽이 없으면 `null`입니다. `Smoothed`는 위 visibility 조건을 만족한 **최근 400ms delta의 중앙값**으로 각 feature를 독립 처리합니다.
- 분석 결과의 `smoothed`는 `{ values, validNow, lastValidAt }`입니다. `validNow`는 HIP calibration이 완료되고 현재 frame의 필수 HIP 값과 visibility가 유효할 때만 true입니다. `lastValidAt`은 마지막 유효 HIP frame의 `performance.now()` 기준 밀리초 시각이며 UI 갱신 시각이 아닙니다.
- Pose loss나 필수 HIP 값 누락/낮은 visibility가 발생한 **즉시** `validNow: false`, `values` 전체를 `null`로 반환합니다. UI는 다음 250ms 갱신에서 **STALE / -**를 표시합니다. 최초 유효 값이 아직 없으면 UNAVAILABLE입니다. HIP은 유효하지만 특정 knee만 누락/미보정이면 그 knee 값만 `null`로 가립니다. 과거 smoothing 값이 현재 사용할 수 있는 값처럼 노출되지 않습니다.
- 짧은 pose loss 동안 내부 버퍼는 유지하므로 pose가 복귀하면 smoothing을 재개합니다. 마지막 유효 HIP frame 이후 **400ms 이상** 지나면 버퍼를 비웁니다. 추론 frame 자체가 멈춰도 같은 시간 기준으로 invalid 처리하고 비우며, 복귀 후에는 새 sample로 시작합니다. baseline은 유지합니다. Raw/delta는 pose 누락 frame에서 바로 비며 frame 공급이 멈추면 1초 후 만료됩니다.
- Mirror는 baseline이나 validity를 바꾸지 않습니다. 재calibration은 이전 baseline/smoothing/유효 시각을 비우고 새로 수집합니다. Camera Stop·카메라 해제·추론 오류·unmount는 calibration, smoothing과 모든 분석 버퍼를 초기화합니다. 이 feature 분석층은 동작을 판정하지 않으며, 아래 STEP 4B classifier에 smoothed 값을 제공합니다. 실제 control 입력 변환은 하지 않습니다.

**실제 테스트 순서**

1. `pnpm dev` 후 노트북의 `http://localhost:5173`에서 Start Camera를 누릅니다. 카메라는 위 STEP 3B의 발쪽→머리 방향 baseline 위치에 고정합니다.
2. Neutral plank를 유지하며 **Calibrate Neutral**을 누르고 `CALIBRATING → CALIBRATED / FINISHING → CALIBRATED`, HIP READY와 knee별 READY/PARTIAL을 확인합니다. Knee visibility가 낮아도 HIP 완료를 막지 않는지 확인하고, FINISHING 동안 최대 1초 더 Neutral을 유지합니다. `Calibration frozen` 이후 PARTIAL이어도 정상이며, 계속 움직여도 baseline과 count는 고정되어야 합니다. 화면상 작은 좌표 변화는 그대로 기록되며 앱이 Neutral 여부를 판정하지는 않습니다.
3. Neutral에서 delta가 기준값 근처인지 관찰합니다. **Twist left → Neutral → Twist right → Neutral → Knee left → Neutral → Knee right**를 각 3~5초 유지하며 raw/calibrated/smoothed와 hip/knee visibility를 비교합니다.
4. 특히 `deltaHipCenterX`, `deltaHipDepthDifference`, 같은 쪽 knee X/Y 변화를 비교합니다. 지표는 신호 관찰용이며 자세명/성공 판정을 출력하지 않습니다. Pose FPS, inference ms, GPU/CPU 표시도 확인합니다.
5. Mirror ON/OFF를 바꿔도 baseline이 유지되고 좌표·delta·신체 기준 좌우가 바뀌지 않는지 확인합니다. 사람 없이 있을 때 다음 UI 갱신에서 smoothed가 STALE / `-`가 되는지 확인합니다. 400ms 이내의 짧은 가림 후에는 smoothing이 재개되는지, 400ms 넘게 화면에서 벗어났다가 돌아오면 새 sample만 사용하는지 비교합니다. Knee만 가려지면 HIP은 유효하고 해당 knee 값만 `-`인지도 확인합니다.
6. Calibrate Neutral을 다시 눌러 기존 기준값과 pending/grace/smoothing이 초기화되고 새 기준으로 수집되는지 확인합니다. Calibration 도중 Stop 후 재시작하면 `NOT CALIBRATED`와 비어 있는 baseline으로 돌아와야 합니다.
7. **Start Guided Recording**으로 33초 sequence도 실행해 `STABILIZE`에서는 Samples/Dropped가 증가하지 않는지, 완료 후 label별 dropped의 합이 전체 dropped와 같은지 확인하고 JSON을 내려받습니다. Feature 분석 여부와 관계없이 raw sample 수집은 유지됩니다.

**코드 재사용**

- `src/pose/features/extractPoseFeatures.ts`: MediaPipe와 Recorder에 의존하지 않는 pure extractor. MediaPipe 인덱스 순서의 두 배열을 받습니다.
- `calibratePoseFeatures.ts`: pure `current − baseline` 계산.
- `poseFeatureAnalysis.ts`: HIP readiness·최대 1초 knee grace·최종 freeze, 1초 sample 버퍼, 400ms median buffer와 현재 유효성/pose loss 처리. `collectionState`는 IDLE/HIP/FINISHING/FROZEN이며 `kneeGraceRemainingMs`로 남은 시간을 제공합니다. `usePoseFeatures.ts`는 객체 수명과 250ms UI 갱신만 담당합니다.

기존 JSON sample도 같은 함수를 그대로 사용할 수 있습니다. `index` 순서가 변경된 외부 데이터는 먼저 MediaPipe 인덱스에 맞춰 배열을 구성합니다.

```ts
const features = extractPoseFeatures(sample.landmarks, sample.worldLandmarks);
const deltas = calibratePoseFeatures(features, neutralBaseline);
```

## STEP 4B: Pose Action Classifier v1

이 단계는 **사용자/카메라 세션별 prototype 보정**을 사용합니다. `NONE`, `TWIST_LEFT`, `TWIST_RIGHT`, `KNEE_LEFT`, `KNEE_RIGHT`를 debug 패널에서 관찰하며, 게임/LEFT·RIGHT 입력/strength와 연결하지 않습니다. STEP 4B-2에서는 보정 상태와 classifier debug snapshot만 Socket으로 폰에 전달합니다. 좌우는 사용자의 **신체 기준**이고 Mirror는 모든 계산과 독립입니다.

**Action Calibration**

Neutral이 `FROZEN`일 때 **Start Action Calibration**을 사용할 수 있습니다. 33초 Dataset Recorder와 별도의 상태 머신이며 총 15초입니다. 시간 기준과 sample label은 Controller가 결정하며 폰은 snapshot을 표시합니다.

| 단계 | 시간 | sample 수집 |
| --- | --- | --- |
| PREPARE / Neutral 유지 | 2초 | X |
| MOVE → TWIST_LEFT | 1초 | X |
| RECORD / HOLD → TWIST_LEFT | 1.5초 | O |
| RETURN_NEUTRAL | 1초 | X |
| MOVE → TWIST_RIGHT | 1초 | X |
| RECORD / HOLD → TWIST_RIGHT | 1.5초 | O |
| RETURN_NEUTRAL | 1초 | X |
| MOVE → KNEE_LEFT | 1초 | X |
| RECORD / HOLD → KNEE_LEFT | 1.5초 | O |
| RETURN_NEUTRAL | 1초 | X |
| MOVE → KNEE_RIGHT | 1초 | X |
| RECORD / HOLD → KNEE_RIGHT | 1.5초 | O |

- UI state를 읽어서 수집하지 않습니다. 매 `detectForVideo` 결과에서 STEP 4A 분석을 먼저 처리하고, **그 inference frame의 최신 smoothed snapshot**을 Action 보정과 classifier에 전달합니다. React UI는 250ms 간격입니다. UI polling은 sample이나 안정화 유지 시간을 추가하지 않습니다.
- 수집 조건: Neutral FROZEN, `smoothed.validNow`, 최신 유효 시각이 400ms 미만, HIP의 X/Y/depth delta 모두 유효. 각 동작 recording 구간의 feature별 primitive 값을 복사합니다. PREPARE/MOVE/RETURN_NEUTRAL, 중복 timestamp, pose loss frame은 제외합니다. 첫 TWIST_LEFT도 MOVE 1초를 거친 뒤 기록하므로 이동 중 frame과 이전 Neutral smoothing 값의 혼입을 줄입니다.
- 각 feature의 **최소 15 samples 중앙값**을 prototype으로 저장합니다. HIP 3개 모두 충분해야 해당 동작이 READY입니다. Knee는 해당 feature가 15개 미만이면 `null`이며, knee baseline이 PARTIAL이어도 HIP이 충분하면 유효한 prototype을 만듭니다. 부족한 HIP을 한 frame이나 fallback 값으로 채우지 않습니다.
- 네 동작이 모두 READY여야 live 판정을 활성화합니다. 보정이 PARTIAL이면 충분한 추적 상태에서 Start Action Calibration으로 전체 sequence를 다시 수집합니다. **Reset Action Calibration**은 Neutral을 유지하면서 Action prototype/sample/pending/stable state만 초기화합니다.
- **Neutral 재보정, Camera Stop, unmount**는 Action prototype과 classifier 상태를 모두 초기화합니다. Prototype은 기존 Neutral 기준의 delta에 종속되므로 새 Neutral 기준에 재사용하지 않습니다. Pose가 잠시 사라지는 것만으로 prototype을 삭제하지는 않습니다.

**거리와 NONE 규칙**

공통 feature마다 `(current − prototype) / scale`을 계산하고 그 값들의 RMS, 즉 `sqrt(mean(normalizedDifference²))`를 거리로 사용합니다. HIP 3개는 반드시 비교할 수 있어야 하며 knee는 양쪽 값이 존재하는 차원만 포함합니다. 사용 가능한 knee 차원 수에 따라 RMS 분모도 바뀝니다.

Neutral movement score는 HIP 3개 delta를 각 scale로 나눈 값의 RMS입니다. 가장 가까운 prototype이 있어도 Neutral score가 충분히 작으면 **NONE을 우선**합니다. 최단 거리와 두 번째 거리를 비교해 너무 먼 후보 또는 분리가 부족한 후보도 NONE으로 거절합니다.

`confidence = min(clamp(1 − bestDistance / ACTION_MAX_DISTANCE), clamp((secondBestDistance − bestDistance) / ACTION_MIN_MARGIN))`이며 clamp 범위는 0~1입니다. Neutral로 판단한 경우 confidence는 0입니다. Confidence는 후보 action에 대한 실험용 점수이며 통계적 확률이 아닙니다.

| Reason | 의미 |
| --- | --- |
| OK | Neutral이어서 NONE이거나 충분히 분리된 action 후보 |
| NOT_CALIBRATED | Neutral이 아직 FROZEN이 아님 |
| POSE_STALE | 현재 pose/HIP 값이 유효하지 않거나 마지막 유효 frame이 400ms 이상 지남 |
| ACTION_CALIBRATION_INCOMPLETE | 네 action prototype이 모두 준비되지 않음 |
| LOW_CONFIDENCE | prototype에서 너무 멀거나 confidence가 최소값 미만 |
| AMBIGUOUS | best와 second-best 거리 차이가 너무 작음 |

`valid`는 pose/calibration 입력 준비 여부입니다. LOW_CONFIDENCE/AMBIGUOUS로 거절된 유효 입력에서도 true일 수 있으므로 action 값과 reason을 함께 봅니다.

**안정화와 초기 상수**

Raw 후보가 **200ms 연속 유지**되어야 stable action을 진입/전환합니다. NONE 복귀는 **150ms release delay**입니다. 다른 action으로 전환할 때도 새 후보의 유지 시간을 처음부터 셉니다. 후보가 바뀌면 pending 시간을 초기화합니다. Pose stale/invalid, calibration invalidation은 지연 없이 raw/stable 모두 NONE으로 만들고 pending도 지웁니다. 400ms 이상의 추론 간격은 연속 유지로 인정하지 않습니다.

Neutral hysteresis는 stable action이 NONE일 때 EXIT score, action일 때 ENTER score를 사용합니다. 이 hysteresis와 유지 시간에 STEP 4A의 400ms median smoothing 지연도 더해지므로 실측 시 반응 속도를 함께 확인합니다.

모든 상수는 `src/pose/actions/poseActionConstants.ts`에서 관리합니다. **초기 실험값이며 실측에 따라 조정 가능**합니다. 사용자와 무관한 최종 전역 threshold로 확정한 값이 아닙니다. Feature scale은 단위를 맞추는 용도이고, 동작의 위치는 매 세션 수집한 prototype이 결정합니다.

| 설정 | 초기값 |
| --- | --- |
| Hip X / Y scale | 0.05 / 0.05 |
| Hip depth scale | 0.08 |
| Left / right knee X scale | 0.06 / 0.06 |
| Left / right knee Y scale | 0.08 / 0.08 |
| NEUTRAL_EXIT_SCORE / NEUTRAL_ENTER_SCORE | 0.5 / 0.3 |
| ACTION_MAX_DISTANCE | 1.5 |
| ACTION_MIN_MARGIN | 0.2 |
| ACTION_MIN_CONFIDENCE | 0.25 |
| ACTION_MIN_SAMPLES | 15 per feature per action |
| ACTION_ENTER_MS / ACTION_RELEASE_MS | 200 / 150ms |
| ACTION_MAX_FRAME_GAP_MS | 400ms |
| ACTION_UI_INTERVAL_MS | 250ms |

HIP만 있는 경우 Twist/Knee가 서로 겹칠 수 있습니다. 가까운 두 prototype의 거리와 AMBIGUOUS를 확인하며 더 구별되는 신호를 측정합니다. v1은 겹치는 prototype을 강제로 구분하지 않습니다.

**수동 테스트 순서**

1. `pnpm dev` → 노트북 `http://localhost:5173` → Start Camera. 기존 실험과 같은 카메라 위치·각도·조명을 유지합니다.
2. Neutral plank에서 Calibrate Neutral을 누르고 FINISHING이 끝나 **Calibration frozen**이 되는지 확인합니다. Knee PARTIAL이어도 Action 보정 시작은 가능합니다.
3. **Start Action Calibration**을 누르고 PREPARE/RETURN에서는 Neutral을 유지하며 MOVE에서 다음 자세로 이동합니다. RECORDING 구간에서는 해당 동작을 1.5초 유지합니다. 실제 플랭크 사용 시에는 아래 STEP 4B-2 폰 안내를 사용합니다. 신체 기준 왼쪽/오른쪽을 사용합니다.
4. 네 Action Prototypes가 READY인지, HIP sample이 최소 15개인지 확인합니다. `Prototype feature medians`를 펼쳐 실제 prototype 값과 비어 있는 knee 값을 확인할 수 있습니다.
5. Neutral → Twist left → Neutral → Twist right → Neutral → Knee left → Neutral → Knee right를 반복합니다. 각 동작을 2~3초 유지하며 Raw/Stable Action, Confidence, Reason, Neutral score, best/second-best 및 개별 action 거리를 비교합니다. 작은 흔들림은 NONE인지, 한 frame spike로 stable action이 바뀌지 않는지 관찰합니다.
6. 화면에서 벗어나면 다음 UI 갱신에 raw/stable NONE과 POSE_STALE이 표시되는지 확인합니다. 복귀 후에도 action은 enter 시간을 다시 만족해야 합니다. Mirror ON/OFF는 prototype과 판정값을 뒤집거나 보정을 reset하지 않아야 합니다.
7. Reset Action Calibration, Neutral 재보정, Camera Stop을 각각 확인합니다. Reset Action은 Neutral을 유지하며, Neutral 재보정/Stop은 기존 action prototype을 무효화해야 합니다. 카메라 위치나 몸의 기준 위치를 바꿨다면 Neutral과 Action 모두 다시 보정합니다.
8. 기존 LEFT/RIGHT Socket 테스트는 수동 버튼으로 그대로 확인합니다. Pose classifier가 Socket direction/timestamp를 갱신하지 않아야 합니다.

## STEP 4B-2: Mobile Calibration Remote

**현재 calibration remote sync는 single controller + single mobile 개발 POC이며, 여러 사용자가 동시에 연결되는 구조는 이후 Room/Session 단계에서 해결한다.** Controller와 mobile은 각각 탭 하나씩 사용합니다.

- **Controller**: 카메라, Neutral/Action 상태 머신, prototype과 classifier의 유일한 원본입니다. 기존 Socket 연결로 **250ms마다** 상태만 publish합니다. inference frame마다 emit하지 않으며 영상·landmark·prototype 좌표는 전송하지 않습니다.
- **Server**: 동일한 HTTP/Socket.IO port 3000에서 아래 이벤트를 모든 client에게 단순 relay합니다. 보정 timer, classifier 계산, prototype/state 저장은 없습니다.
- **Mobile**: 시작/reset 요청과 화면 표시만 담당합니다. 자체 stage timer나 countdown 계산은 없습니다. Controller가 보낸 `remainingMs`를 초 단위로 표시합니다. Action 시작 시 안내 영역으로 스크롤하며 이동/유지/Neutral 복귀를 큰 글씨로 안내합니다. LEFT/RIGHT는 본인 신체 기준이고 Mirror와 무관합니다.
- Action Calibration에는 **speechSynthesis 안내를 사용하지 않습니다**. 기존 Dataset Recorder 음성 기능은 그대로입니다. Classifier scale/threshold/유지 시간도 변경하지 않습니다.

| Client → Server | Server → Client | 처리 |
| --- | --- | --- |
| `calibration:sync:request` | `calibration:sync:requested` | Controller가 즉시 현재 상태 publish |
| `calibration:neutral:start` | `calibration:neutral:start:requested` | 카메라 RUNNING + Pose detected일 때 Neutral 재보정 |
| `calibration:action:start` | `calibration:action:start:requested` | Neutral FROZEN일 때 15초 Action 보정 시작 |
| `calibration:action:reset` | `calibration:action:reset:requested` | Neutral을 유지하고 Action 초기화 |
| `calibration:state:publish` | `calibration:state` | Controller snapshot을 phone에 전달 |

요청 payload는 `{ requestId, timestamp }`입니다. Snapshot에는 카메라/Pose 상태, Neutral status·collectionState·HIP/knee count·readiness·grace·frozen, Action phase·action·remaining·prototype readiness, Raw/Stable Action·Confidence·Reason·거리 debug와 `lastCommandError`가 들어갑니다. 실패한 요청은 CAMERA_NOT_READY / POSE_NOT_DETECTED / NEUTRAL_NOT_FROZEN으로 표시합니다.

**Sync, 중복 요청, lifecycle**

- Phone connect/reconnect 시 sync 요청을 보내고, Controller는 이를 받으면 즉시 snapshot을 보냅니다. Controller connect 시에도 즉시 publish하므로 어느 쪽이 먼저 접속해도 동기화됩니다. 서버가 상태를 기억할 필요가 없습니다.
- Controller는 최근 256개 command/requestId를 기억해 같은 요청의 재실행을 막습니다. 서로 다른 requestId여도 Neutral HIP/FINISHING 또는 Action ACTIVE 상태에서 같은 보정 start를 다시 실행하지 않습니다. 무시한 요청에도 현재 snapshot으로 응답합니다.
- Neutral 재보정은 기존 Action prototype/sample/pending/stable을 초기화합니다. Action reset은 Neutral을 유지합니다. Camera Stop/해제/오류/unmount는 두 보정과 classifier를 초기화하고 연결되어 있다면 정지 snapshot을 보냅니다.
- Pose stale이면 기존 classifier의 raw/stable NONE을 전달하고 폰은 **Pose를 찾는 중... / POSE STALE**로 표시합니다. Server socket이 끊기면 즉시, Controller snapshot이 **1.5초** 동안 없으면 **연결 대기**로 돌아가 이전 classification을 숨기고 버튼을 비활성화합니다. 이 만료 기준은 폰의 로컬 수신 시각이므로 기기 시계 차이에 영향받지 않습니다. 연결 대기 중 명령은 queue하지 않습니다.
- React StrictMode/unmount에서 remote listener와 interval을 제거합니다. Snapshot 전송은 기존 250ms debug 갱신 수준이며 카메라 result.close lifecycle, raw Recorder와 수동 LEFT/RIGHT Socket test는 유지됩니다.

**실제 폰 테스트**

1. 같은 LAN에서 노트북에 `pnpm dev`를 실행합니다. 노트북 `http://localhost:5173`에서 **Start Camera**까지만 누릅니다. 카메라는 현재 실험 baseline인 **발 쪽에서 머리 방향, 책상 높이, 몸 전체가 들어오는 거리**에 둡니다.
2. 폰에서 먼저 `http://<LAPTOP_LAN_IP>:3000/health`가 `{ "status": "ok" }`인지 확인한 뒤 `http://<LAPTOP_LAN_IP>:5174`를 엽니다. 접근이 막히면 사설 네트워크의 Node.js/3000·5174 포트 허용을 확인합니다. 방화벽 전체를 끄지 않습니다.
3. **Mobile Socket CONNECTED**, Camera RUNNING, Pose DETECTED를 확인합니다. 폰을 얼굴 앞에서 읽을 수 있는 곳에 놓고 플랭크 자세로 이동합니다. 두 브라우저 탭을 활성 상태로 유지합니다.
4. 폰에서 **Neutral 보정 시작**을 누릅니다. 기본 자세를 유지하며 HIP count, 필요 시 FINISHING 남은 시간을 확인하고 **기본 자세 보정 완료 ✓ / FROZEN**까지 기다립니다. Knee PARTIAL이어도 다음 단계로 진행할 수 있습니다.
5. 폰에서 **동작 보정 시작**을 누릅니다. PREPARE 2초 → 왼쪽 Twist MOVE 1초/HOLD 1.5초 → Neutral 1초 → 오른쪽 Twist → 왼쪽 Knee → 오른쪽 Knee 순서로 폰의 안내만 따라갑니다. 모든 동작 앞에는 MOVE 1초가 있습니다.
6. 완료 후 네 prototype READY를 확인합니다. RETRY NEEDED가 있으면 카메라 추적 상태를 확인하고 **다시 보정**합니다.
7. 폰 **Live Classification**으로 Neutral / Twist Left / Twist Right / Knee Left / Knee Right를 각 2~3초 유지하며 Stable/Raw, Confidence/Reason, 펼칠 수 있는 거리 debug를 비교합니다. 노트북 화면을 볼 필요가 없습니다.
8. Pose를 가리면 기존 action 대신 POSE STALE이 표시되는지 확인합니다. Controller 탭 종료/네트워크 해제 시 1.5초 이내 연결 대기로 바뀌고, 재접속 시 sync로 복원되는지도 확인합니다.
9. 폰 Neutral 다시 보정 → Action 보정 필요, Action 초기화 → Neutral 유지, 노트북 Stop Camera → 카메라 준비 필요를 각각 확인합니다. Mirror를 바꿔도 폰 안내/신체 좌우/prototype이 바뀌지 않아야 합니다.
10. 폰 아래 **STEP 1 · Socket test**를 펼쳐 수동 LEFT/RIGHT 양방향 통신도 확인합니다. Pose action은 게임/control:test 입력으로 변환하지 않습니다.

## STEP 4C: Action Signal Adequacy Validation

**Action Signal Validation은 classifier 성능을 개선하는 기능이 아니라, 현재 Pose signal과 feature representation이 실제 반복 동작에서 충분히 재현 가능한지를 측정하기 위한 실험 도구다.**

STEP 4B v1의 feature 선택, scale/threshold, RMS 거리, Neutral 규칙, prototype 중앙값, enter/release timing은 그대로 유지합니다. 데이터로 다음 가능성을 구분하기 위한 단계입니다: (A) 신호는 충분하지만 현재 거리 기반 표현/판정이 부적절한지, (B) 같은 동작의 feature가 보정 때와 다르게 재현되는지, (C) 현재 7개 feature 밖의 raw 33 landmark에 더 좋은 신호가 있는지. 자동 PASS/FAIL이나 해결책 선택은 하지 않습니다.

**독립 Validation sequence — 총 21.5초**

Controller의 `performance.now()`가 유일한 시간 기준입니다. Camera RUNNING, Neutral FROZEN, Action Calibration READY와 네 prototype이 모두 있어야 시작합니다. Pose가 잠시 보이지 않더라도 이 조건이 준비되어 있으면 시작할 수 있으며, 이후 실제 invalid inference도 진단용으로 기록합니다.

| 시작~종료 (초) | 단계 / expectedAction | 기록 |
| --- | --- | --- |
| 0~2 | PREPARE / NONE | X |
| 2~3.5 | RECORD_NEUTRAL / NONE | O |
| 3.5~4.5 | MOVE / TWIST_LEFT | X |
| 4.5~6 | RECORD_ACTION / TWIST_LEFT | O |
| 6~7 | RETURN_NEUTRAL / NONE | X |
| 7~8 | RECORD_NEUTRAL / NONE | O |
| 8~9 | MOVE / TWIST_RIGHT | X |
| 9~10.5 | RECORD_ACTION / TWIST_RIGHT | O |
| 10.5~11.5 | RETURN_NEUTRAL / NONE | X |
| 11.5~12.5 | RECORD_NEUTRAL / NONE | O |
| 12.5~13.5 | MOVE / KNEE_LEFT | X |
| 13.5~15 | RECORD_ACTION / KNEE_LEFT | O |
| 15~16 | RETURN_NEUTRAL / NONE | X |
| 16~17 | RECORD_NEUTRAL / NONE | O |
| 17~18 | MOVE / KNEE_RIGHT | X |
| 18~19.5 | RECORD_ACTION / KNEE_RIGHT | O |
| 19.5~20.5 | RETURN_NEUTRAL / NONE | X |
| 20.5~21.5 | RECORD_NEUTRAL / NONE | O |

구간은 시작 시각 포함, 종료 시각 제외입니다. 총 기록 시간은 11.5초이므로 30 inference FPS라면 약 345 samples가 예상되지만 실제 count는 추론 속도에 따라 달라집니다. UI timer로 sample을 만들지 않고 중복 inference timestamp도 제외합니다. 추론 자체가 멈추면 새 sample은 없으며, 반환된 pose-missing frame은 빈 landmark 배열과 `poseValid: false`로 남습니다.

**저장과 JSON 구조**

`src/pose/validation/actionValidation.ts`는 상태와 sample buffer, `validationAnalyzer.ts`는 pure summary 계산, `useActionValidation.ts`는 250ms 표시/다운로드/lifecycle을 담당합니다. 기존 STEP 3B Recorder와 별개입니다.

```text
version: 1, status: COMPLETED
createdAt, model, delegate, videoWidth, videoHeight, previewMirrored
startedAt, timeOrigin
neutralBaseline
actionPrototypes
actionCalibrationSampleCounts
classifierConfig:
  featureScales, neutralExitScore, neutralEnterScore
  maxDistance, minMargin, minConfidence, enterMs, releaseMs
  maxFrameGapMs, smoothingWindowMs, actionMinSamples
  hipCalibrationVisibility, kneeCalibrationVisibility
sequence: [{ phase, expectedAction, durationMs }, ...]
summary: { actions: { TWIST_LEFT: ..., ... }, neutral: ... }
samples: [{
  timestamp, videoTime, stageIndex, expectedAction, poseValid,
  landmarks: [{ index, x, y, z, visibility }, ...],
  worldLandmarks: [{ index, x, y, z, visibility }, ...],
  rawFeatures,
  calibratedFeatures,
  smoothedFeatures: { values, validNow, lastValidAt },
  classification: {
    rawAction, stableAction, confidence, valid, reason,
    neutralMovementScore, bestDistance, secondBestDistance, actionDistances
  }
}, ...]
```

- `timestamp`/`startedAt`/`lastValidAt`은 Controller의 monotonic milliseconds, `videoTime`은 영상의 초 단위 시간입니다. `timeOrigin + timestamp`로 Unix ms를 복원할 수 있습니다. `stageIndex`로 최초 Neutral과 각 동작 뒤 Neutral 구간을 따로 분석할 수 있습니다.
- 매 inference callback에서 features를 처리한 뒤 `actions.processFrame()`이 **동일 timestamp의 PoseActionView**를 반환합니다. 이 값을 즉시 복사하며 250ms React state나 remote snapshot을 읽어 sample을 만들지 않습니다.
- image/world 좌표는 제공된 전체 배열(보통 각 33개)을 `result.close()` **전에** primitive object로 복사합니다. 없는 visibility는 `null`입니다. Raw feature 14개, calibrated delta 7개, smoothed delta 7개와 validity, classifier 결과/거리도 각각 복사합니다. MediaPipe result나 배열 reference, 영상/이미지는 저장하지 않습니다.
- 시작 시 Neutral baseline, 네 prototype, feature별 calibration sample count와 실제 classifier 설정을 깊이 복사합니다. Mirror는 `previewMirrored` metadata만 기록하며 좌표/expected label/feature/판정을 변환하지 않습니다.

**Summary 해석**

- Action별 totalRecordedFrames / validPoseFrames / staleFrames, rawCorrectRate / stableCorrectRate, ownPrototypeNearestRate, median confidence / own distance / closest-other distance / margin을 제공합니다.
- `poseValid`는 raw pose가 있고 현재 required HIP smoothing이 유효한 경우입니다. `staleFrames = totalRecordedFrames - validPoseFrames`로 invalid/HIP 품질 부족도 포함합니다. **Raw/stable 정답률의 분모는 validPoseFrames**입니다. Pose loss에서 나온 NONE을 Neutral 정답으로 세지 않도록 했습니다. 전체 프레임 중 invalid 비율은 별도로 함께 확인해야 합니다.
- Own nearest의 분모 `distanceComparableFrames`는 유효 pose 중 네 거리가 모두 finite인 frame 수입니다. Own distance가 다른 세 거리의 최솟값보다 **엄격히 작을 때만** 단독 최단으로 계산하고 동률은 제외합니다. 거리 중앙값들도 동일한 비교 가능 frame을 사용합니다.
- `medianMargin`은 각 frame의 `closestOtherDistance - ownDistance`를 구한 뒤 중앙값을 취합니다. 두 중앙값의 차이가 아닙니다.
- Neutral은 유효 frame의 raw/stable NONE 비율과 neutralMovementScore median/p90을 제공합니다. `scoreFrames`는 finite score 개수이며 p90은 오름차순 **nearest rank `ceil(0.9 × N)`**를 사용합니다.
- 7개 feature별 유효 smoothed sample 수, prototype, validation median, **signed difference = validation median − prototype**, **normalizedDrift = abs(difference) / 시작 시 저장한 scale**를 제공합니다. 선택 knee가 누락되어도 0으로 채우지 않습니다. 분모/sample/prototype이 없으면 해당 통계는 `null`이고 UI에서는 `-`입니다.
- Summary는 수집 종료 시 한 번 계산하며 JSON에도 포함됩니다. Expected label은 안내한 자세이지 실제 수행을 독립 확인한 정답이 아니므로, 안내와 실제 동작이 맞았는지도 실측 시 확인해야 합니다.

**Remote와 lifecycle**

기존 relay에 `validation:start → validation:start:requested`, `validation:reset → validation:reset:requested`를 추가합니다. Request payload/중복 차단은 기존 `requestId` 방식을 재사용하며 ACTIVE 중 start 반복으로 시계가 재시작되지 않습니다. 서버는 sample/timer/state를 저장하지 않습니다.

기존 `calibration:state`에는 `validation: { status, phase, expectedAction, remainingMs, recordedFrames }`만 추가됩니다. Phone은 이 상태를 표시하며 자체 sequence/countdown을 진행하지 않습니다. Raw landmark, features, dataset, summary 전체는 Socket으로 전송하지 않습니다. 재접속 sync/1.5초 연결 만료 정책도 그대로 적용합니다.

Neutral 재보정, Action 재보정/reset, Camera Stop/해제/추론 오류, unmount는 **Validation dataset과 summary도 초기화**합니다. 기록 중 보정 기준이 달라진 frame이 들어오면 방어적으로 초기화해 서로 다른 기준을 섞지 않습니다. 검증 완료 후에는 보정/정지/초기화 전에 JSON을 다운로드하세요. 명시적으로 다시 검증을 시작하면 이전 validation을 새 데이터로 교체합니다.

**실제 테스트**

1. `pnpm dev` 후 노트북 `http://localhost:5173`에서 **Start Camera**를 누릅니다. 발쪽→머리 방향의 기존 카메라 baseline을 유지합니다.
2. 폰에서 `http://<LAPTOP_LAN_IP>:3000/health` 확인 후 `:5174`에 접속합니다. **Neutral 보정 시작**을 누르고 FROZEN까지 기본 자세를 유지합니다.
3. 폰에서 **동작 보정 시작**을 누르고 네 Action prototype READY를 확인합니다.
4. 폰의 **동작 검증 시작**을 누릅니다. 약 **21.5초** 동안 폰의 큰 글씨와 countdown만 따라 수행합니다. 각 동작 후 Neutral 복귀에 이어 기본 자세를 유지하는 기록 구간도 있습니다.
5. 완료 후 노트북으로 이동해 **STEP 4C — Action Signal Validation**의 summary와 feature repeatability 표를 확인하고 **Download Validation JSON**을 누릅니다. 다운로드 전 Camera Stop/재보정을 누르면 dataset이 초기화됩니다.
6. JSON에서 expected/raw/stable을 비교하고 invalid 비율, own/other 거리와 margin, 7개 feature의 normalized drift, 동작별로 나뉜 Neutral score를 살펴봅니다. 필요하면 저장된 33개 raw/world 좌표로 다른 신호 후보를 다음 분석 단계에서 검토합니다. 현재 앱은 새 classifier나 threshold를 적용하지 않습니다.
7. Reset Validation과 각 재보정/Camera Stop, Mirror ON/OFF, Pose loss 및 폰 재접속도 확인합니다. 완료/부분 기록을 성공/실패로 자동 판정하지 않습니다.

## STEP 4D: Knee Motion Signal Validation

이번 실험은 **Neutral corridor → 이동 → peak → 복귀**의 시간 신호를 측정합니다. 최종 KICK detector, 고정 전역 threshold, classifier v2는 구현하지 않습니다. 기존 STEP 3B/4A/4B/4C와 classifier v1의 상수·feature·거리식·보정·안정화 동작을 유지합니다.

**시작과 sequence — 총 15초**

필수 조건은 **Camera RUNNING + Pose detected + Neutral FROZEN**입니다. Action Calibration이나 prototype은 필요하지 않습니다. Controller의 `performance.now()`만으로 단계를 진행하며, 폰은 수신한 phase/remaining을 표시합니다.

| 시간 (초) | phase | expectedMotion | 기록 |
| --- | --- | --- | --- |
| 0~2 | PREPARE | NEUTRAL | X |
| 2~3 | NEUTRAL | NEUTRAL | O |
| 3~4 / 4~5 / 5~6 | MOVE / HOLD / RETURN | TWIST_LEFT | O |
| 6~7 / 7~8 / 8~9 | MOVE / HOLD / RETURN | TWIST_RIGHT | O |
| 9~10 / 10~11 / 11~12 | MOVE / HOLD / RETURN | KNEE_LEFT | O |
| 12~13 / 13~14 / 14~15 | MOVE / HOLD / RETURN | KNEE_RIGHT | O |

시작 시각 포함/종료 시각 제외입니다. **MOVE/HOLD/RETURN을 모두 기록**하며 RETURN의 expectedMotion은 직전 동작을 유지합니다. 예를 들어 KNEE_LEFT/RETURN은 왼쪽 니킥에서 기본 자세로 돌아오는 구간입니다. 총 기록 시간은 13초이며 30 inference FPS라면 약 390 frames입니다. UI refresh로 sample을 만들거나 동일 timestamp를 두 번 기록하지 않습니다.

**후보 feature와 속도**

`src/pose/motion/kneeMotionFeatures.ts`의 pure function으로 normalized image coordinates를 측정합니다. World 좌표도 33개 전체를 저장하지만 이번 후보 수식은 **image-space 2D**입니다.

- Hip center X는 양쪽 hip X의 평균입니다. 각 knee의 center offset X는 `knee.x - hipCenterX`, max absolute offset은 양쪽 절댓값의 최댓값입니다.
- Same-side offset은 `knee.x - 해당 hip.x`, knee–hip distance는 normalized image X/Y의 2D Euclidean 거리입니다.
- Pelvis axis는 `normalize(rightHip.xy - leftHip.xy)`입니다. Hip center→knee 벡터와의 내적으로 signed projection을 기록합니다. `hipWidth`는 이 2D hip 간 거리입니다. 길이가 **0.0001 미만**이거나 필요한 좌표가 invalid이면 projection은 null입니다. 이 수치는 나눗셈의 불안정성을 막는 numerical guard이며 동작 판정 threshold가 아닙니다.
- 후보 9개(center offset L/R, maxAbs, same-side offset L/R, distance L/R, pelvis projection L/R)와 body debug용 hipCenterX/hipWidth/knee X, hip/knee visibility를 저장합니다. Visibility cutoff나 새 smoothing을 적용하지 않습니다. 낮은 visibility의 signal도 데이터로 확인할 수 있습니다.
- 속도는 **normalized coordinate/second**, `(현재 값 − 이전 valid frame 값) × 1000 / dtMs`입니다. Center/same-side offset L/R, distance L/R, raw knee X L/R 및 hipCenterVelocityX를 저장합니다. Relative velocity는 `kneeVelocityX - hipCenterVelocityX`입니다.
- `deltaTimeMs`도 저장하며 previous frame 없음, dt ≤ 0, **dt ≥ 400ms**, 필요한 coordinate 결측이면 해당 velocity는 null입니다. 400ms는 derivative continuity를 위한 측정 guard이며 classifier 상수 변경이 아닙니다. Previous valid는 양쪽 hip/knee의 2D 좌표가 있는 마지막 frame입니다. 짧은 pose loss는 그 frame과 비교하고, 긴 gap 복귀 첫 frame은 null velocity로 시작한 뒤 다음 frame부터 재개합니다. PREPARE 중 frame도 derivative 기준으로만 사용할 수 있으며 dataset에는 저장하지 않습니다.

**Neutral corridor / summary / dominant knee**

- 최초 **NEUTRAL 1초**의 각 후보별 finite sample에서 median, nearest-rank p10/p90, **MAD = median(abs(value − median))**를 계산합니다. MAD를 표준편차로 환산하지 않습니다. Sample 수와 null도 그대로 제공합니다.
- 각 MOVE/HOLD/RETURN stage 및 expectedMotion별로 total/valid/stale frames, median/max absolute center offset, 좌우 peak absolute relative velocity, 좌우 peak knee–hip distance change와 distance velocity, 좌우 visibility median을 요약합니다. `peakKneeHipDistanceChange`는 **해당 거리의 Neutral median 대비 최대 절대 변화량**입니다. Distance velocity는 별도로 초당 변화량을 제공합니다.
- Pose valid는 양쪽 hip/knee 4점의 finite X/Y 좌표가 있는 경우입니다. 전체/invalid 수와 별개로 개별 통계는 **해당 값이 finite인 frame**을 사용하므로 부분 관측을 조용히 버리지 않습니다. 이는 tracking 신뢰도 판정이 아니며 visibility 통계도 함께 확인해야 합니다.
- 각 후보마다 `median ± k × MAD`, **k = 1.5 / 2 / 2.5 / 3**에서 corridor 바깥인 frame 비율을 계산합니다. 경계와 같은 값은 crossing이 아닙니다. MOVE/HOLD의 KNEE_LEFT/RIGHT crossing, TWIST_LEFT/RIGHT false crossing, 최초 NEUTRAL false crossing을 각각 제공합니다. RETURN은 이 비교에서 제외하고 별도 stage summary로 관찰합니다.
- 분모는 해당 candidate가 finite이고 corridor가 준비된 frame 수입니다. Crossing count/분모/비율을 모두 저장합니다. Neutral false crossing은 corridor를 만든 같은 구간의 기술 통계이며 독립 검증 정확도가 아닙니다. MAD가 0이면 corridor도 정확히 한 값으로 남깁니다. 임의 margin/floor를 추가하지 않으며 부족한 데이터의 비율은 null입니다. k를 자동 선택하거나 PASS/FAIL로 판정하지 않습니다.
- Dominant knee는 각 KNEE MOVE/HOLD에서 **좌우 각각의 Neutral center-offset median 대비 peak absolute displacement**를 비교합니다. 실제 변위가 더 큰 landmark를 LEFT_LANDMARK/RIGHT_LANDMARK로 기록하며, 동률·양쪽 0·비교 자료 부족은 NONE입니다. **KNEE_LEFT == LEFT_KNEE라는 가정은 없습니다.** 두 peak 값도 함께 저장합니다.

**JSON / remote / lifecycle**

`kneeMotionValidation.ts`는 독립 상태 머신과 ref 밖의 sample buffer, `kneeMotionAnalyzer.ts`는 pure 분석, `useKneeMotionValidation.ts`는 250ms UI 갱신/다운로드/cleanup을 담당합니다. STEP 4C와 `snapshotLandmarks.ts` helper만 공유합니다.

JSON 최상단은 `version`, `createdAt`, `model`, `delegate`, video size, `previewMirrored`, `startedAt`, `timeOrigin`, **시작 시 복사한 neutralBaseline**, `measurementConfig`, `neutralCorridor`, `sequence`, `samples`, `summary`입니다. Action prototype은 필요하지 않으며 저장하지 않습니다.

각 sample에는 `timestamp`, `videoTime`, `stageIndex`, `expectedMotion`, `phase`, `poseValid`, 전체 image/world `landmarks`(index/x/y/z/visibility), `features`, `velocity`가 들어갑니다. MediaPipe `result.close()` 전에 primitive copy하며 없는 visibility는 null입니다. Pose-missing frame도 빈 배열과 null feature/velocity로 남습니다. 영상/이미지나 result reference를 보관하지 않습니다.

`motion:validation:start/reset` 요청은 서버가 `motion:validation:start/reset:requested`로 relay합니다. 기존 requestId와 ACTIVE 중복 시작 방지를 재사용합니다. `calibration:state.motionValidation`에는 **status/phase/expectedMotion/remainingMs/recordedFrames만** 보냅니다. 서버에 timer/sample을 저장하지 않고, full dataset은 폰이나 서버로 전송하지 않습니다. Socket 연결 만료/재접속 sync 정책은 기존과 같습니다.

Neutral 재보정, Camera Stop/해제/추론 오류, unmount는 Motion dataset/summary/velocity 이력을 초기화합니다. **Mirror toggle은 reset하지 않으며** metadata에 시작 시 설정만 남깁니다. Action 재보정/reset은 Motion의 Neutral 기준을 바꾸지 않으므로 Motion을 초기화하지 않습니다. 다만 서로 다른 guide를 동시에 실행하지 말고 실험별로 수행하세요. 완료 후 카메라를 멈추거나 재보정하기 전에 JSON을 다운로드합니다. 명시적인 재시작은 이전 Motion dataset을 교체합니다.

**실제 테스트 방법**

1. `pnpm dev` 후 노트북 `http://localhost:5173`에서 **Start Camera**를 누릅니다. 발쪽→머리 방향의 기존 카메라 baseline을 사용합니다.
2. 폰에서 `http://<LAPTOP_LAN_IP>:3000/health`를 확인하고 `http://<LAPTOP_LAN_IP>:5174`로 접속합니다.
3. 플랭크 자세에서 폰의 **Neutral 보정 시작**을 누르고 FROZEN을 확인합니다. **Action Calibration은 하지 않아도 됩니다.**
4. Neutral 영역 다음의 **Knee Motion Validation 시작**을 누르고 15초 동안 폰 안내를 따릅니다. MOVE에서는 실제로 이동하고 HOLD에서는 유지하며 RETURN에서는 Neutral로 돌아옵니다.
5. 완료 후 노트북 **STEP 4D — Knee Motion Signal Validation**에서 stage/motion summary, Neutral corridor, k별 crossing, dominant landmark를 확인합니다.
6. **Download Motion Validation JSON**을 누릅니다. 같은 조건에서 여러 번 측정하고, pose/visibility와 실제 동작 수행을 함께 확인하며 세션별 corridor·속도·반복 변화를 비교합니다. 현재 앱은 이 통계로 KICK을 판정하지 않습니다.
7. 짧은/긴 pose loss, Mirror ON/OFF, Reset, Neutral 재보정, Camera Stop 및 폰 연결 해제도 확인합니다. 접근이 막히면 기존 STEP 1의 사설 네트워크 포트 허용 안내를 따르며 방화벽 전체를 끄지 않습니다.

## STEP 4E-v2: Temporal Knee Kick Confirmation + Mobile Operator Gating

기존 STEP 4E의 첫 ENTER crossing 즉시 확정을 **candidate → temporal confirmation**으로 변경합니다. 실제 관측에서 첫 crossing은 RIGHT 우세였지만 33~500ms 후 LEFT가 우세해진 사례와, 한쪽 knee만 보인 낮은 속도의 Twist 오검출을 재검증하기 위한 실험입니다. Action classifier v1, STEP 4D, camera/visibility/좌표 계산과 4D/4E 패널 순서는 유지합니다. Action Calibration이나 STEP 4D 기록 없이 Neutral 보정 후 사용할 수 있습니다.

**기존 Neutral baseline과 좌표는 유지**

Neutral HIP/FINISHING 구간의 최근 1초에서 각 knee 유효 표본 20개를 모아 FROZEN 시 baseline을 고정합니다. Hip visibility 양쪽 ≥ 0.7, 해당 knee visibility ≥ 0.5를 그대로 사용합니다. Center offset의 좌우 median과 `(leftKneeHipDistance median + rightKneeHipDistance median) / 2`인 bodyScale을 사용합니다. Scale < 0.01 또는 표본 부족이면 NOT_READY이며, FROZEN 후 추가 동작으로 baseline을 갱신하지 않습니다.

각 knee displacement는 `(현재 knee center offset − Neutral median) / bodyScale`입니다. Visibility 기준과 v1 relative velocity/bodyScale 계산은 유지하며, v2.1은 아래 설명처럼 runtime validity에서 4A smoothing 의존만 분리합니다. Mirror와 MediaPipe landmark 이름으로 방향을 바꾸지 않습니다.

**EXPERIMENTAL candidate / confirmation**

| 상수 | 값 | 의미 |
| --- | --- | --- |
| KICK_ENTER_DISPLACEMENT | 0.28 | ARMED에서 candidate 시작, 즉시 event 아님 |
| KICK_EXIT_DISPLACEMENT | 0.15 | 기존 양쪽 Neutral 복귀 경계 |
| RETURN_DWELL_MS | 180ms | 기존 연속 복귀 유지 시간 |
| KICK_CANDIDATE_MIN_MS | 60ms | 이 시간 전 confirmation 금지 |
| KICK_CANDIDATE_MAX_MS | 600ms | 이 시각부터 timeout, confirmation 금지 |
| KICK_CONFIRM_DISPLACEMENT | 0.34 | Candidate의 가장 큰 절대 peak |
| KICK_CONFIRM_VELOCITY | 5.0 | Candidate의 normalized absolute velocity peak (초당) |
| KICK_DIRECTION_MARGIN | 0.08 | 양/음 peak magnitude 차이 |

모두 **현재 확보한 데이터에 대한 experimental 시작값**이며 최종·일반화된 threshold가 아닙니다. 기존 4D의 Kick normalized peak는 최소 약 0.345 이상, Twist는 대부분 0.28 이하였고, diagnostics의 false Twist는 약 0.342 displacement에 velocity 약 1.3을 보였습니다. v2는 displacement와 velocity를 함께 사용합니다. 다양한 실제 세션에서 재검증해야 합니다.

확정 이벤트 경로는 `ARMED → CANDIDATE → WAIT_RETURN → ARMED`, 미확정 후보 경로는 `ARMED → CANDIDATE → WAIT_CLEAR → ARMED`입니다. Baseline이 없으면 NOT_READY입니다.

1. ARMED + 현재 fresh/usable knee가 한 개 이상이고 dominant 절댓값 ≥ 0.28이면 candidate를 시작합니다. 첫 부호는 방향으로 확정하지 않습니다.
2. Candidate 동안 **모든 usable 좌우 displacement**에서 positivePeak(0 이상 최댓값), negativePeak(0 이하 최솟값)를 누적합니다. 양/음 evidence가 없던 쪽 magnitude는 0입니다. 가장 큰 좌우 absolute normalized velocity, 좌우 관측 여부와 frame count도 누적합니다.
3. `60ms ≤ elapsed < 600ms`, 좌우 knee를 각각 최소 한 번 관측, 가장 큰 magnitude ≥ 0.34, velocity peak ≥ 5.0, 양/음 magnitude 차이 ≥ 0.08을 모두 만족하면 이벤트를 한 번 발생시킵니다. 양쪽 knee가 같은 frame에서 usable할 필요는 없습니다. 현재 frame도 fresh하고 최소 한 knee가 usable해야 합니다.
4. Candidate 전체 trajectory에서 negative magnitude가 크면 KNEE_LEFT, positive가 크면 KNEE_RIGHT입니다. 동률은 margin 부족으로 확정하지 않습니다. **이벤트 timestamp는 confirmation 시각**입니다.
5. 600ms에 도달하면 그 frame에서 새 evidence를 받아 확정하지 않고 TIMED_OUT → WAIT_CLEAR입니다. 신뢰할 수 있는 관측(현재 fresh + usable knee)이 400ms 이상 끊기면 STALE → WAIT_CLEAR입니다. 추론이 멈춘 경우에도 기존 Controller UI clock이 만료를 처리하며 event는 만들지 않습니다.

Timeout/stale로 확정되지 않은 후보는 **WAIT_CLEAR**에서 현재 usable dominant 절댓값이 ENTER 미만인 프레임을 확인하면 즉시 ARMED로 돌아갑니다. 0.28 이상이거나 usable 프레임이 없으면 새 후보를 만들지 않습니다. **실제로 확정된 이벤트만 WAIT_RETURN**에서 양쪽 knee가 usable하고 양쪽 절댓값이 EXIT 미만인 상태를 180ms 유지해야 ARMED로 돌아갑니다. 복귀 dwell의 기준·visibility·gap 처리는 유지합니다. Confirmed event를 크게 800ms 표시하는 cue와 historical lastEvent/count도 유지합니다.

**Guided Detector Test — 고정 22초 (2026-09-29 재시험 수정)**

시작에는 Camera RUNNING, Neutral FROZEN 및 detector READY(보정값)가 필요합니다. 현재 pose/양쪽 knee visibility/ARMED 여부는 시작을 막지 않습니다. 시작과 Reset Test는 보정값을 유지하고 이전 candidate, return latch, event/count, velocity history를 정리합니다. 진행 중 중복 시작은 무시합니다.

```text
NEUTRAL 2s
TWIST_LEFT 3s → NEUTRAL 2s
TWIST_RIGHT 3s → NEUTRAL 2s
KNEE_LEFT 3s → NEUTRAL 2s
KNEE_RIGHT 3s → NEUTRAL 2s → COMPLETE
```

Controller clock은 pose loss나 WAIT_RETURN 상태에도 진행합니다. 늦은 tick은 시작 시각 기준 현재 단계로 따라잡습니다. 폰은 Controller의 단계와 남은 시간을 표시합니다. `waitingForArmed`는 호환성을 위해 남아 있지만 항상 false이며 `armedWaitMs`는 0입니다. 진단과 이벤트는 고정 stageTimings의 시작 포함/종료 제외 구간에 귀속됩니다.

인식기의 양쪽 무릎 복귀/180ms dwell은 중복 이벤트 방지를 위해 유지합니다. 복귀 실패로 놓친 동작은 miss로 남으며 테스트를 기다리게 하지 않습니다. ARMED는 내부 재입력 가능 상태이지 사용자에게 기다리라는 요구가 아닙니다. 실시간 무릎/geometry 상태는 진단용으로 표시합니다.

완료 summary의 Twist/Neutral falseKickCount와 각 Knee detected/directionCorrect/wrongEventCount/duplicateCount는 유지합니다. Expected stage는 안내이지 독립적으로 확인한 정답이 아니며 자동 PASS/FAIL을 만들지 않습니다.

**개발 메모 — 운동 중 operator 정보는 폰에도 표시**

운동 중 동작 안내와 시간은 Phone에서 확인 가능해야 합니다. Detector state는 진단 정보이며 ARMED/Pose 복귀를 기다리라는 문구로 사용자 행동을 막지 않습니다. Tracking OK / Tracking Weak는 작은 상태 표시로만 사용합니다. Raw numeric debug, 상세 표와 JSON 다운로드는 Controller 전용이어도 됩니다. 이번 변경은 레이아웃/디자인 개선이 아니며 기존 패널 순서를 유지합니다.

**실제 테스트 순서**

1. `pnpm dev` 후 노트북 `http://localhost:5173`에서 Camera 시작. 기존 발쪽→머리 카메라 배치를 사용합니다.
2. 폰에서 `http://<LAPTOP_LAN_IP>:3000/health` 확인 후 `:5174`에 접속하고 Neutral을 보정합니다.
3. Neutral 보정 후 READY를 확인하고 Guided Detector Test를 시작합니다. 현재 인식 상태에 관계없이 시작할 수 있습니다.
4. 안내에 따라 각 동작을 한 번 수행합니다. 첫 crossing에 바로 KICK이 뜨지 않는 것이 정상입니다. Neutral 2초가 지나면 다음 동작 안내를 따릅니다.
5. 성공/오방향/miss run을 각각 노트북의 **Download Current Detector Diagnostics JSON**으로 저장합니다. 첫 방향과 확정 방향, confirmation latency, 한쪽 knee 미관측으로 인한 timeout을 비교합니다.
6. 한 동작을 유지할 때 event가 중복되지 않는지, Reset Test 후 이전 WAIT_RETURN/event가 정리되는지, Pose loss·Mirror·재보정·Camera Stop을 확인합니다. JSON은 진행 중에도 다운로드할 수 있고, Stop/재보정 시 최신 종료 trial snapshot을 보존합니다. 여러 run을 비교하려면 각각 파일로 저장하세요.

## STEP 4E-v2.1: Kick-specific validity / freshness

이전 Kick 경로는 `neutral.smoothed.validNow`를 전역 gate로 사용했습니다. STEP 4A의 이 값은 calibrated HIP X/Y/depth 전체를 요구하므로, 예를 들어 world depth가 누락되면 image-space Kick geometry가 정상이어도 displacement 계산을 막았습니다. v2.1은 **Neutral FROZEN과 baseline 수집 조건을 유지**하고, 이후 runtime 판정에서 이 의존을 제거합니다. 4A smoothing과 Action classifier 자체는 바꾸지 않습니다.

Detector API는 `processFrame(features, timestamp)`입니다. 외부 poseFresh를 받지 않으며 현재 inference의 `KneeMotionFeatures`로 다음을 계산합니다.

- Hips usable: 양쪽 hip visibility ≥ 0.7, finite hipCenterX
- 각 knee usable: hips usable, 해당 knee visibility ≥ 0.5, finite knee X / center offset X / knee–hip distance
- 한쪽이라도 usable이면 현재 displacement를 계산합니다. Candidate window 내 양쪽 knee evidence 필요 조건은 그대로입니다.
- STEP 4A의 hipCenterY / hipDepthDifference / world depth / smoothed.validNow는 runtime gate에 사용하지 않습니다. 기존 STEP 4D의 **2D knee–hip distance 수식에 필요한 image x/y geometry**는 여전히 필요하며 결측을 보간하지 않습니다.

Inference 전달 시각과 geometry 유효성을 구분합니다. `validNow`는 **마지막 inference 이후 400ms 미만 + 현재 최소 한 knee usable**이며, `usableLeftNow/usableRightNow`도 delivery가 stale이면 false입니다. Landmarks가 없는 inference는 즉시 unusable입니다. 실제 전달 또는 usable 관측이 400ms 끊기면 기존 candidate STALE 취소가 적용됩니다. ENTER 0.28, EXIT 0.15, return 180ms, candidate 60–600ms, confirmation 0.34 / 5.0 / 0.08과 velocity 계산은 변경하지 않았습니다.

Guided Test는 보정 완료 후 현재 knee usability와 관계없이 시작하며 고정 22초 동안 진행합니다. 폰은 READY/state와 함께 Tracking OK / Tracking Weak를 진단용으로 표시합니다. 시작 버튼 옆에는 보정/카메라 전제조건을 표시합니다. Geometry 메시지는 자동 스크롤된 진행 안내에도 표시합니다. 원격에는 boolean 두 개만 추가하며 raw 수치는 보내지 않습니다.

**실제 재검증 순서**

1. 기존 발쪽→머리 카메라 배치에서 Camera 시작 → 폰 Neutral 보정 → FROZEN / READY를 확인합니다. 현재 Pose/ARMED 여부는 시작 전제조건이 아닙니다.
2. 폰 Guided Detector Test를 여러 번 실행하고, Neutral 대기가 끝난 후 각 동작을 수행합니다. 한쪽 knee 안내가 나오면 해당 무릎이 보이는지 확인합니다.
3. 성공한 run과 KNEE_LEFT miss run을 각각 **Stop/Reset/재보정/새 test 전에** 노트북에서 JSON으로 저장합니다.
4. KNEE_LEFT stage의 `neutralInvalidFrames`, `kickAnyUsableFrames`, `kickBothUsableFrames`, **`neutralInvalidButKickUsableFrames`**를 비교합니다. 마지막 값이 0보다 크면 이전 4A gate에서는 제외됐을 현재 Kick 사용 가능 frame이 실제 존재한 것입니다. 이것만으로 miss 원인 전체를 단정하지 않습니다.
5. 해당 frame의 `neutralSmoothedValidNow`, `kickValidityReasons`, raw visibility/offset/distance와 normalized displacement, candidate evidence/confirmation latency를 시간순으로 비교합니다. 전달 중단은 `inferenceGapMs`로 별도 확인합니다.
6. 한쪽 knee 가림에서도 시작되는지, 장시간 pose loss에서 stale 취소되는지, WAIT_RETURN 중에도 테스트가 완료되는지 확인합니다. Mirror, Reset Test, Neutral 재보정, Camera Stop 동작도 유지되는지 확인합니다.

## STEP 4E-v2.2: Non-blocking runtime / detector recovery

이전 실측의 긴 대기는 Neutral sway 후보의 confirmation 실패 후에도 확정 Kick과 같은 WAIT_RETURN 조건을 요구하고, 테스트가 ARMED를 기다리던 구조와 관련이 있었습니다. 이제 **miss를 기다려서 성공으로 바꾸지 않습니다.** 모든 stage는 Controller `performance.now()`의 시작 시각 기준으로 진행하며 정상 완료 시간은 정확히 22초입니다. 늦은 UI tick이나 inference 중단도 stage를 연장하지 않습니다.

- 시작 전제조건: Camera RUNNING + Neutral FROZEN + Kick baseline READY. 현재 pose loss / CANDIDATE / WAIT_RETURN / WAIT_CLEAR는 시작을 막지 않습니다.
- 새 시작 및 Reset Test: baseline만 유지하고 candidate evidence/ID, return timer, velocity previous frame, 마지막 frame 시각·derived 값, event/count를 지웁니다. 새 trial은 clean ARMED이고 첫 현재 inference 전에는 validNow=false입니다. 진행 중 중복 start 요청은 무시합니다.
- 미확정 timeout/stale: WAIT_CLEAR → 현재 usable `abs(dominant) < 0.28`이면 즉시 ARMED. `0.28` 이상에서는 후보를 반복 생성하지 않습니다. 후보 결과는 진단에서 새 후보 전까지 확인할 수 있습니다.
- 확정 이벤트: 기존 WAIT_RETURN → 양쪽 displacement가 `0.15` 미만으로 `180ms` 유지되어야 ARMED. 이 복귀가 실패해 다음 Knee stage에서 event가 없으면 `detected=false`로 남습니다.
- Threshold, confirmation 시간, velocity 계산, Kick-specific validity, STEP 4D와 기존 Action classifier는 변경하지 않습니다. UI 배치/디자인 작업이나 게임 연결도 포함하지 않습니다.

**v3 진단 확장**

각 stage에 `stagePlannedDurationMs`, `stageActualDurationMs`, `detectorUnavailableFrames`, `stageStartedWhileState`, `stageEndedWhileState`를 추가하고 기존 before/after state counts를 유지합니다. `WAIT_CLEAR`도 state count에 포함됩니다. Actual duration은 완료된 stage에서는 예정 길이와 같고, ACTIVE/INTERRUPTED의 현재 stage는 실제 경과 시간이며 아직 시작하지 않은 stage는 0입니다. Boundary state는 경계 시각 관측값이며, 늦은 tick/프레임 공백에서는 직전 관측 상태를 사용합니다. 관측이 없으면 null입니다. 기존 `stateAtStageStart`는 첫 inference 직전 상태이므로 별도로 유지합니다.

`detectorUnavailableFrames`는 현재 사용 가능한 knee가 없거나 stateBefore가 NOT_READY/WAIT_RETURN/WAIT_CLEAR인 frame 수입니다. CANDIDATE는 확인 가능한 상태여서 geometry가 usable하면 unavailable로 세지 않습니다. 추론이 아예 없는 구간에 가상 frame을 추가하지 않습니다. Planned/actual duration과 firstFrameTimestamp, inferenceGapMs, 각 state별 count를 함께 보세요. 자동으로 POSE PROBLEM/STATE MACHINE BUG 등의 원인 결론을 붙이지 않습니다.

Download는 **ACTIVE / COMPLETED / INTERRUPTED** snapshot을 지원합니다. Reset 시 현재 summary는 지우고 다운로드용 종료 snapshot을 별도로 보존합니다. 화면의 `현재 trial / 보존된 이전 trial`과 status/frame 수로 구분합니다. 아직 새 trial에 frame이 없으면 보존된 이전 파일을 받을 수 있고, 새 frame이 기록되면 현재 trial을 다운로드합니다. 최신 종료 기록 하나만 보존하므로 비교할 run은 각각 저장하세요.

**Actual-game design invariant**

> After initial calibration, gameplay must never pause waiting for pose/detector readiness.
> Tracking/detector failure is treated as an input miss to be measured and improved, not as a reason to block the player.

**재검증**

1. Camera 시작 → 폰 Neutral 보정 → READY 후 테스트를 시작합니다. 시작 시 pose가 잠시 없어도 추가 대기를 요구하지 않습니다.
2. 폰 동작 안내에 따라 수행하고 Neutral은 2초, 각 Action은 3초, 전체는 22초인지 확인합니다. Tracking Weak, CANDIDATE, WAIT_CLEAR, WAIT_RETURN에도 countdown과 다음 동작은 그대로 진행해야 합니다.
3. 약한 sway가 후보를 만들었지만 event가 없으면 WAIT_CLEAR를 관찰합니다. 현재 displacement가 0.27이면 ARMED로 복귀하고 0.30 유지 중에는 candidate ID가 계속 증가하지 않아야 합니다.
4. 실제 Kick 후 hold에서는 중복 event가 없어야 합니다. 복귀가 늦어 다음 Kick을 놓치면 완료 summary의 detected=false 및 해당 stage의 WAIT_RETURN count를 확인합니다.
5. 진행 중 Download, Reset 후 INTERRUPTED 다운로드, Camera Stop 후 다운로드를 각각 확인합니다. 페이지를 닫기 전 파일로 저장하세요.
6. 같은 Neutral 보정으로 즉시 두 번째 trial을 시작해 이전 candidate/count/latch의 영향을 받지 않는지 확인합니다. 완료 파일에서 stageActualDurationMs 합계가 22000이고 예정 길이와 같은지 비교하세요.

## STEP 4E-DIAG: Knee Kick Detector 진단 기록

기존 STEP 4E-DIAG 기록, candidate evidence, 4A/Kick validity 비교와 raw Kick geometry를 유지합니다. v2.2에서는 고정 stage 시각과 부분 기록의 수명 정보를 추가합니다. JSON schema는 **version 3**입니다. 아래 기록은 Controller 전용이며 full landmarks/영상은 포함하지 않습니다.

**수집 위치와 동작 보존**

Guided Detector Test가 ACTIVE인 동안 각 inference frame에서 아래 값만 snapshot합니다. React의 250ms 표시 값으로 기록하지 않으며, per-frame React render를 추가하지 않습니다. 전부 Controller 내부의 비-React buffer에 저장합니다.

- `timestamp`, `stageIndex`, `expected`
- 현재 `usableKnees(features)`의 결과인 `usableLeft/Right`. 기존 `poseFresh` 필드는 현재 Kick knee 중 하나 이상 usable이라는 의미로 유지합니다.
- `inferenceGapMs`: 직전 처리 inference와의 실제 시간 간격, 첫 frame이면 null
- `neutralSmoothedValidNow`, `kickHipsUsable`, `kickLeftUsable`, `kickRightUsable`, `kickValidityReasons`
- gate와 무관하게 보존하는 raw 좌우 hip/knee visibility, hipCenterX, 좌우 knee X / center offset X / knee–hip distance (결측은 null)
- `stateBefore` / `stateAfter`: `detector.processFrame()` 직전/직후 상태
- 계산된 `hipCenterX`, `hipWidth`, 좌우 knee visibility
- detector가 실제 사용한 `normalizedLeft/Right`, `dominantNormalizedDisplacement`
- detector가 계산한 `normalizedLeft/RightVelocity`
- 그 frame에서 **새로 발생한** event의 ID·방향·timestamp 또는 null

검출기의 read-only `getStateForDiagnostics()` / `getValuesForDiagnostics()`만 사용합니다. 진단 수집에서 `getView()`를 추가 호출하지 않습니다. 기존 `getView()`는 stale 시 복귀 dwell을 초기화할 수 있으므로, 그 부수 효과를 진단이 유발하지 않도록 했습니다. 변위/속도를 별도 수식으로 재계산하지 않으며, 기존 event 기록 호출도 유지합니다.

Pose missing 또는 양쪽 knee unusable인 inference도 저장합니다. 기존 monotonic frame 중복 방지와 stage 시간 구간(시작 포함/종료 제외)을 그대로 사용합니다. **IDLE/COMPLETED 및 마지막 stage 종료 시각 이후에는 추가 기록하지 않습니다.** Full 33 landmarks, world landmarks, 영상/이미지는 저장하지 않습니다. 진단 수치나 전체 frame buffer는 Socket으로 전송하지 않습니다.

**Stage summary**

완료 후 9개 stage 각각에 다음을 제공합니다. Neutral이 여러 번 나오므로 `stageIndex`로 구별합니다.

- `totalFrames`, `freshFrames`, `staleFrames`, `leftUsableFrames`, `rightUsableFrames`, `bothUsableFrames`
- `neutralInvalidFrames`, `kickAnyUsableFrames`, `kickBothUsableFrames`, `neutralInvalidButKickUsableFrames`
- `leftVisibilityRejectedFrames`, `rightVisibilityRejectedFrames`, `hipRejectedFrames`: 각 visibility reason 및 hips unusable frame 수. 하나의 frame이 여러 항목에 포함될 수 있으며, 결측 visibility도 rejection에 포함합니다.
- `stateAtStageStart`와 `firstFrameTimestamp`: **그 stage의 첫 관측 inference 직전 상태**와 시각입니다. 정확한 stage 경계에 frame이 없으면 첫 관측 시점을 사용하고, stage 전체에 frame이 없으면 둘 다 null입니다.
- `stateFrameCounts`는 **stateBefore**, `stateAfterFrameCounts`는 **stateAfter**의 상태별 개수입니다. TRIGGERED_LEFT/RIGHT는 내부 one-shot 전이이므로 실제 관측되지 않으면 0을 유지합니다.
- `maxAbsDominantDisplacement`, `signedDominantAtMax`, 좌우 `maxAbsLeft/RightDisplacement`. 절댓값 peak가 동률이면 먼저 관측한 signed 값을 남깁니다.
- `framesAboveEnter`: `abs(dominant) >= 0.28`인 frame 수. `armedFramesAboveEnter`는 여기에 `stateBefore === ARMED` 조건을 적용한 수입니다.
- `maxAbsDominantWhileArmed`, `enterMargin = maxAbsDominantDisplacement − 0.28`, `armedEnterMargin = maxAbsDominantWhileArmed − 0.28`. 비교 가능한 값이 없으면 null입니다.
- 좌우 `peakAbsLeft/RightVelocity`, visibility median/min
- `medianHipCenterX`, `minHipCenterX`, `maxHipCenterX`, `medianHipWidth`
- `eventCount`, 발생 순서의 `eventDirections`, 기존 `wrongEventCount`, `duplicateCount`

Median/min/max/peak 계산은 해당 값이 finite인 frame만 사용하고 결측을 0으로 바꾸지 않습니다. v3의 fresh/stale는 **현재 Kick geometry usability** 기준이므로 v2의 4A HIP gate 기준 수치와 직접 같은 의미로 비교하지 않습니다. 이전 조건은 `neutralSmoothedValidNow` 및 `neutralInvalidFrames`로 확인합니다. Inference가 아예 오지 않은 시간에는 가상 stale frame을 만들지 않으므로 `inferenceGapMs`, total과 firstFrameTimestamp도 함께 확인해야 합니다. 자동 원인 판정이나 PASS/FAIL은 추가하지 않습니다.

`kickValidityReasons`는 동시에 발생한 조건을 배열로 기록합니다. 모두 사용 가능하면 `OK`, 나머지는 `NO_LANDMARKS`, `HIP_VISIBILITY`, `HIP_GEOMETRY`, `LEFT_KNEE_VISIBILITY`, `RIGHT_KNEE_VISIBILITY`, `LEFT_KNEE_GEOMETRY`, `RIGHT_KNEE_GEOMETRY`, `NO_USABLE_KNEE`입니다. 한쪽 knee가 unavailable이어도 다른 쪽이 usable할 수 있습니다. 이는 판정 조건 기록이며 camera problem 등의 결론을 자동으로 붙이지 않습니다.

**Neutral 위치 진단과 JSON**

기존 Neutral 수집 buffer에 위치/visibility 숫자만 함께 저장하고 동일한 freeze 시점에 통계를 계산합니다. `baseline.diagnostics.hipCenterX`는 sampleCount/median/p10/p90, 좌우 knee visibility는 sampleCount/median입니다. p10/p90은 기존 nearest-rank 방식을 사용합니다. 낮은 visibility 값도 finite이면 진단 통계에 남깁니다. 이 값들은 bodyScale이나 trigger 계산에 사용하지 않습니다.

완료 후 Controller의 **STEP 4E → Guided Detector Test 기존 summary 아래**에 작은 진단 표가 표시됩니다. **Download Current Detector Diagnostics JSON**은 inference가 한 개 이상 기록되면 ACTIVE 중에도 사용할 수 있습니다. 전체 22초 동안 inference가 전혀 없었던 COMPLETED trial도 빈 frames와 MISS summary로 다운로드할 수 있습니다. 파일 이름은 `plank-stork-kick-diagnostics-<timestamp>.json`입니다.

```text
version: 3
status: ACTIVE | COMPLETED | INTERRUPTED
capturedAt: snapshot 시각 (Controller monotonic ms)
endedAt: 완료/중단 시각, ACTIVE이면 null
interruptionReason: RESET_TEST | CAMERA_STOP | RECALIBRATION | UNMOUNT 등, 중단이 아니면 null
createdAt: 테스트 시작 당시 ISO 시각
startedAt: Controller monotonic milliseconds
detectorConfig:
  enterDisplacement, exitDisplacement, returnDwellMs
  hipVisibility, kneeVisibility, staleMs
  candidateMinMs, candidateMaxMs, confirmDisplacement, confirmVelocity, directionMargin
baseline:
  detector: 기존 KneeKickBaseline snapshot
  diagnostics: Neutral hipCenterX / knee visibility 통계
testStart:
  detectorState, ready, valid
sequence: [{ expected, durationMs }, ...]
stageTimings: [{ stageIndex, expected, startedAt, endedAt, armedWaitMs, stageStartedWhileState, stageEndedWhileState }, ...]
frames: [{ timestamp, stageIndex, expected, poseFresh, usableLeft, usableRight,
           inferenceGapMs, neutralSmoothedValidNow,
           kickHipsUsable, kickLeftUsable, kickRightUsable, kickValidityReasons,
           rawLeftHipVisibility, rawRightHipVisibility, rawLeftKneeVisibility, rawRightKneeVisibility,
           rawHipCenterX, rawLeftKneeX, rawRightKneeX,
           rawLeftKneeCenterOffsetX, rawRightKneeCenterOffsetX, rawLeftKneeHipDistance, rawRightKneeHipDistance,
           stateBefore, stateAfter, hipCenterX, hipWidth,
           leftKneeVisibility, rightKneeVisibility,
           normalizedLeft, normalizedRight, dominantNormalizedDisplacement,
           normalizedLeftVelocity, normalizedRightVelocity, event,
           candidateId, candidateActive, candidateStartedAt, candidateAgeMs,
           candidatePositivePeak, candidateNegativePeak, candidatePeakAbsVelocity,
           candidateSawLeft, candidateSawRight, candidateFrameCount,
           candidateStrongestMagnitude, candidateDirectionMargin,
           candidateOutcome, candidateEndedAt, confirmationLatencyMs }, ...]
stageSummaries: [위 stage별 통계, ...]
existingGuidedSummary: 기존 falseKickCount / detected / directionCorrect / duplicateCount 등
```

`timestamp - startedAt`은 테스트 시작 후 경과 ms입니다. 시작 시 baseline과 testStart를 복사하므로 이후 상태와 섞이지 않습니다. 현재 테스트는 보정 완료 후 즉시 시작하며 시작 직후 detector 상태를 testStart에 기록합니다. stageTimings는 고정 22초 일정입니다. 이전 데이터에는 늘어난 Neutral 구간이 남아 있습니다. 폰에는 compact 결과와 좌우 usable boolean만 전달하며 JSON은 노트북의 Blob/ObjectURL 다운로드로만 받습니다.

Candidate 진단은 시작 이후 누적한 양/음 peak, velocity peak, 좌우 관측 여부, age/frame count와 결과(CONFIRMED/TIMED_OUT/STALE)를 유지합니다. Read-only snapshot이 candidate를 확정하거나 만료시키지 않습니다. `confirmationLatencyMs`는 확정된 candidate의 시작→event 경과 시간이며, event가 없는 frame의 historical latency를 새 event로 세지 않습니다.

Stage summary에 `candidateCount`, `confirmedCandidateCount`, `timedOutCandidateCount`, `staleCandidateCount`, `confirmationLatenciesMs`, `medianConfirmationLatencyMs`를 추가합니다. Candidate ID별 시작/결과의 **첫 관측 frame이 속한 stage**에 각각 한 번만 집계합니다. 시작과 결과가 stage를 가로지르면 서로 다른 stage에 집계될 수 있습니다. Frame이 끊겼다가 만료 결과를 나중에 관측한 경우 실제 deadline은 candidateEndedAt으로 확인합니다. 통계와 별개로 event는 confirmation 시각의 정확한 stage에 귀속됩니다.

**초기화와 실제 실험**

Reset Detector Test는 Neutral baseline을 유지하고 현재 guided summary/diagnostics와 detector transient state를 초기화합니다. 초기화 전에 진행 중 기록을 INTERRUPTED로 복사해 다운로드용 이전 trial로 보존합니다. Neutral 재보정, Camera Stop/해제/오류, unmount는 baseline도 초기화하지만 진단 snapshot은 보존합니다. 완료된 기록은 COMPLETED 상태를 유지합니다. 이전 snapshot과 새 trial frames는 섞지 않습니다. 다운로드 ObjectURL은 reset/unmount 시 해제합니다. 최신 종료 snapshot 하나를 페이지 메모리에 보존하므로 component remount 후에도 다운로드할 수 있지만 브라우저 새로고침/탭 종료 후에는 사라집니다. 자동 다운로드나 서버 저장은 하지 않습니다.

1. 기존 순서로 Camera 시작 → 폰 Neutral 보정 → Detector READY를 확인합니다. Action Calibration은 필요하지 않습니다.
2. 폰에서 Neutral 보정 READY를 확인하고 Guided Detector Test를 실행합니다. 화면 좌측 등 실제 평소 위치를 유지하고 고정 22초 동작 안내를 따릅니다.
3. 완료 후 **Stop/재보정/Reset/새 test 시작 전에** 노트북에서 Download Current Detector Diagnostics JSON을 누릅니다. 성공한 run과 miss가 난 run을 각각 저장하세요.
4. KNEE_LEFT stage에서 peak와 enterMargin, ARMED일 때의 peak/margin 및 armedFramesAboveEnter를 함께 비교합니다. stateAtStageStart와 WAIT_RETURN frame 수, fresh/usable 수와 visibility를 확인합니다.
5. 해당 stage의 hipCenterX/hipWidth와 Neutral 위치 통계를 비교해 관측 위치 차이도 살펴봅니다. 단일 수치로 원인을 확정하지 않고, 성공/누락 run의 per-frame stateBefore/stateAfter와 event를 시간순으로 비교합니다.

자동 회귀 테스트는 진단 활성/비활성에 동일 synthetic frame sequence를 넣어 v2 event 방향·시각·개수·최종 상태가 일치하는지 확인합니다. v1의 즉시 확정 기대값은 v2 temporal confirmation 기대값으로 갱신했습니다. 실제 간헐적 miss의 원인은 다음 실측 JSON을 통해 판단합니다.

## STEP 4F — Raw Webcam Capture / Pose Replay

Controller에 개발용 **Replay Capture**와 **Replay Runner**를 추가했습니다. 현재 recovery detector의 임계값, candidate/WAIT_CLEAR/WAIT_RETURN, pose-loss 동작은 그대로입니다. 이번 단계는 저장된 입력으로 변경 전후를 비교하는 도구입니다.

### 실제 Capture → Replay 순서

1. `pnpm dev`로 실행하고 Chrome/macOS의 노트북에서 `http://localhost:5173`을 엽니다. 기존 폰 remote를 함께 사용해도 됩니다.
2. **Start Camera**를 누릅니다. 카메라는 발쪽에서 머리 방향을 바라보는 기존 실험 배치를 사용합니다. Capture 전 Pose FPS / Average inference ms를 확인합니다.
3. **STEP 4F — Replay Capture → Start Replay Capture**를 누릅니다. `RECORDING`, duration, video size, pose frame count가 증가하는지 확인합니다. 사람이 아직 감지되지 않아도 Camera RUNNING이면 녹화할 수 있습니다.
4. **Capture가 시작된 후 Calibrate Neutral**을 다시 누르고 Neutral FROZEN / Kick READY까지 기본 자세를 유지합니다. 이 순서가 calibration replay에 필요합니다. Action Calibration은 필요하지 않습니다.
5. 기존 **Start Guided Detector Test**를 실행하고 폰의 고정 22초 안내를 따릅니다. Capture는 stage, event, 실시간 inference 결과를 계속 관찰합니다. 완료 후 1초 정도 더 기다립니다.
6. **Stop Replay Capture**를 누르고 `RECORDED`를 확인합니다. **Download Replay WebM**, **Download Replay JSON**을 각각 눌러 같은 capture ID의 두 파일을 저장합니다. Capture 중 Camera Stop도 녹화를 종료합니다. 탭을 닫기 전에 필요한 파일을 다운로드하세요.
7. 성능 비교를 위해 Capture ON 상태의 기존 Pose FPS / inference ms를 OFF 때와 비교합니다. Capture 종료 후 **Stop Camera**를 권장합니다. 별도의 live/Replay 모델을 동시에 실행하면 GPU/CPU 부하가 늘어납니다.
8. **STEP 4F — Replay Runner → Replay JSON**에서 저장한 JSON을 선택하고 trial을 고릅니다. **LANDMARK REPLAY**를 두 번 실행합니다. 같은 코드 버전에서는 LIVE와 Events/time, Summary, Final state가 MATCH인지 확인합니다. 영상 파일은 필요하지 않습니다.
9. **CALIBRATION REPLAY**를 누르고 Neutral / Kick baseline MATCH 및 baseline 숫자를 확인합니다. Neutral 시작 marker가 없는 녹화는 calibration replay를 실행할 수 없습니다.
10. 같은 capture ID의 파일을 **Replay WebM**에 선택하고 **VIDEO REPLAY**를 누릅니다. 영상의 decoded frame을 순차 추론하는 동안 frame count를 확인합니다. 실시간보다 느려도 프레임 처리를 기다립니다. 이 모드는 모델 초기화/다운로드가 필요할 수 있습니다. 완료 후 LIVE / LANDMARK / VIDEO의 usable frames, 좌우 event 수, Twist/Neutral false kick, knee detected/direction, 최종 상태를 비교합니다.
11. **Download Replay Results JSON**으로 비교 결과와 재생 detector config, baseline 비교를 저장합니다. 재생 취소/새 파일 선택은 이전 video 작업과 결과를 정리합니다. raw video를 결과 JSON에 다시 넣지 않습니다.

### 저장 구조와 시간 기준

- 기존 `getUserMedia` **동일 MediaStream**을 preview/MediaPipe와 `MediaRecorder`가 공유합니다. 카메라를 추가로 열거나 canvas를 녹화하지 않습니다. WebM에는 skeleton, UI, 텍스트, CSS mirror가 들어가지 않습니다.
- `MediaRecorder.isTypeSupported`로 `video/webm;codecs=vp8` → `video/webm` 순서로 확인합니다. 미지원이면 오류를 표시합니다. 개발용 초기 요청 bitrate는 **4 Mbps**이며 실제 recorder의 `mimeType`, `videoBitsPerSecond`와 track frame rate를 metadata에 저장합니다.
- 모든 live inference에서 `result.close()` **전에** 33개 image/world landmark의 primitive를 복사합니다. 미검출 frame은 빈 배열이고 없는 visibility는 `null`입니다. Mirror는 표시 metadata에만 남으며 좌표 변환을 하지 않습니다. UI용 250/500ms snapshot을 recording 입력으로 사용하지 않습니다.

```text
version: 1
captureId, createdAt
video: filename, mimeType, width, height, nominalFrameRate, videoBitsPerSecond,
       sourceVideoTimeAtStart
pose: model, modelUrl, delegate, settings
display: mirrorEnabled
timing: durationMs, captureStartPerformanceMs
markers: [{ type, tMs, order, trialId?, stageIndex?, expected? }]
poseFrames: [{ tMs, order,
   landmarks: [{ x, y, z, visibility }],
   worldLandmarks: [{ x, y, z, visibility }] }]
clockSamples: [{ tMs, order, trialId }]
liveResult:
   neutralBaseline, kickBaseline, detectorConfig, guidedSummary, events
   trials: [{ id, startMs, endMs, startOrder, endOrder,
              neutralBaseline, baseline, result }]
```

`CAPTURE_START/STOP`, `NEUTRAL_CALIBRATION_START/FROZEN`, `GUIDED_TEST_START/STAGE_CHANGE/COMPLETE/STOP` marker를 중복 없이 기록합니다. `tMs = inference timestamp − captureStartPerformanceMs`로 원래 inference gap을 보존하고 `order`로 같은 시각의 관측 순서를 구분합니다. 영상과 JSON은 `plank-stork-replay-<ISO timestamp>` 파일명을 공유합니다. 여러 Guided trial을 녹화하면 trial별 frozen baseline과 결과를 별도로 비교합니다.

기존 detector의 `getView()`도 inference 사이에 stale/candidate timeout을 처리하므로, **실제로 호출된** clock의 상대 시각을 `clockSamples`에 추가 기록합니다. Capture 때문에 새로운 detector clock을 호출하지 않습니다. Landmark replay는 저장한 frame/clock 순서만 빠른 loop로 실행합니다. `performance.now()`나 처리 속도를 detector 시간으로 사용하거나 실제 22초를 기다리지 않습니다. 중복 timestamp frame은 첫 frame만 사용하고 out-of-order 입력은 시간/관측 순서로 정렬합니다. 이벤트 시각 비교 허용 오차는 상대시간 뺄셈의 부동소수점 차이만 위한 **0.000001ms**입니다.

### 코어 공유와 Video replay 차이

- Detector replay는 trial의 저장된 **kick baseline**으로 별도의 `KneeKickAnalysis`를 생성하고, live와 같은 feature extraction / `analyzeFrame` / `KneeKickDetector` / Guided Test 코어를 통과합니다. React 상태를 재현하거나 live 인스턴스를 초기화하지 않습니다.
- Calibration replay는 Neutral 시작 marker부터 실제 `PoseFeatureAnalysis`와 `KneeKickAnalysis`에 recorded frame을 넣어 baseline을 다시 만듭니다. 저장된 trial baseline과 비교하며 calibration 수식은 바꾸지 않습니다.
- Video replay는 별도의 PoseLandmarker에서 같은 Full model URL, 저장된 GPU/CPU delegate, VIDEO/1 pose/confidence 설정을 사용합니다. 설정이 다르거나 저장된 delegate를 사용할 수 없으면 명시적으로 중단합니다.
- STEP 4F.1부터 Video는 자연 재생 대신 WebCodecs decoded sample의 **presentation timestamp × 1000**을 사용합니다. 중복/역행 timestamp를 별도 집계하고 callback `now`를 사용하지 않습니다. 재추론한 frame을 같은 분석 코어에 넣고, Guided 구간의 결과를 비교합니다.
- WebM의 첫 encoded frame과 live capture 시작 사이의 지연 및 압축/decoding 차이 때문에 video Pose는 live와 bit-identical하지 않습니다. Video 시간축은 컨테이너에 저장된 presentation timestamp이며 임의로 live에 맞추는 offset은 더하지 않습니다. 결과 차이는 위 표에서 functional behavior로 검토합니다. 비교 표의 frame count는 선택한 Guided trial 구간, 재생 progress의 count는 영상 전체 inference 수입니다.

### 자원과 로컬 저장

`dataavailable`에서는 Blob chunk만 보관합니다. 고빈도 frame/clock은 React 밖의 메모리에 쌓고 Capture UI는 250ms마다 갱신합니다. MediaPipe inference 호출/시각/기존 지표 계산 순서는 유지합니다. ON 시 snapshot 복사와 인코딩 비용은 있으므로 실제 기기의 ON/OFF FPS로 확인해야 하며, 장시간 녹화는 메모리/JSON 크기를 증가시킵니다. 우선 Neutral + 한 번의 22초 trial 정도로 검증하세요.

WebM/JSON은 사용자가 다운로드 버튼을 누를 때만 Blob/ObjectURL로 로컬 파일을 만듭니다. backend upload, Socket 전송, cloud/persistent 저장은 추가하지 않습니다. 기존 MediaPipe 모델/WASM 로드는 기존 URL을 사용합니다. Camera stop/unmount 시 recorder를 종료하고, 완료 시 listener를 해제합니다. 다운로드 URL은 정리하며, 취소/새 파일/unmount 시 decoder iterator와 전용 모델도 해제합니다. 4F.1 Video replay는 ObjectURL이나 재생 callback을 만들지 않습니다. 브라우저 새로고침/탭 종료 후 메모리 기록은 복구되지 않습니다.

자동 테스트에는 MediaRecorder mock, 실제 camera callback의 result.close 전 복사, Capture ON/OFF live 동등성, clock 포함 live/replay 동등성, calibration 비교, mediaTime/중복 frame, 취소/파일 교체/자원 정리를 포함합니다. **candidate → NO_LANDMARKS → 400ms 이내 Neutral 복귀 → 이전 evidence로 false KNEE_RIGHT**는 의도적으로 보존한 regression fixture입니다. 이번 STEP에서는 detector bug나 threshold를 수정하지 않습니다.

## STEP 4F.1 — Frame-Complete Video Replay

### 변경 이유와 방식

기존 4F는 `video.play()` 상태에서 rVFC를 받고 `detectForVideo()`가 끝난 뒤 다음 callback을 등록했습니다. 그동안 compositor/media clock은 계속 진행하므로, main thread 추론이 느리면 다음 callback은 이미 더 뒤의 presented frame을 전달합니다. rVFC는 모든 source frame을 보관하는 queue가 아니며 callback은 best-effort입니다. ([MDN API](https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback)) 따라서 기존 VIDEO의 Guided 375 frames / 345 usable / event 0은 coverage 문제와 detector 결과를 분리해 봐야 합니다. 과거 run에는 source timestamp 진단이 없어 286개의 차이 전부가 어디에서 생겼는지 역으로 단정할 수는 없습니다.

고정 `1 / nominalFPS` seek는 VFR/불규칙 timestamp에서 같은 frame을 반복하거나 짧은 frame을 지나칠 수 있습니다. pause/rVFC도 compositor에 이미 전달된 다음 frame을 정확히 열거하는 보장이 없습니다. source completeness를 위해 **WebM demux + WebCodecs 순차 decode**가 필요하다고 판단했습니다. 직접 컨테이너 parser/codec을 구현하는 대신 `mediabunny@1.61.0`의 `BlobSource` / `VideoSampleSink.samples()`만 사용합니다. 라이브러리는 Video Replay를 시작할 때 동적으로 불러오고, 입력은 사용자가 고른 로컬 File입니다. ([순차 sample API](https://mediabunny.dev/guide/media-sinks))

```text
local WebM → bounded decoder queue (backpressure)
          → next decoded sample
          → raw frame canvas
          → await detectForVideo(canvas, sample.timestamp × 1000)
          → Pose primitive snapshot → result.close() → sample.close()
          → UI/Cancel에 실행 기회 제공 → next decoded sample
```

샘플은 presentation 순서로 소비하고 **동시 Pose inference는 1개**입니다. Decoder가 미리 읽은 소수의 frame은 소비자가 느리면 queue에 보존하고 더 읽기를 기다립니다. 별도의 playback clock은 없습니다. Cancel 버튼을 처리하기 위한 event-loop yield의 대기 시간은 Pose/detector timestamp와 무관합니다. 영상 시간이 22초여도 처리 시간이 그보다 길 수 있습니다. 모델/설정/delegate와 detector/threshold, LANDMARK 경로는 유지합니다.

WebCodecs `VideoDecoder`가 없는 환경이나 지원하지 않는 codec은 명시적으로 실패합니다. 프레임을 다시 놓칠 수 있는 자연 재생 fallback은 제공하지 않습니다. localhost/HTTPS의 Chrome을 사용하세요. UI preview는 처리 중인 원본 frame canvas로 변경했고 mirror/overlay는 적용하지 않습니다. 새 구현에는 pending seek/rVFC/video listener/ObjectURL이 없습니다. Cancel/새 파일/unmount 시 pending `next()`를 깨우고 reader/decoder/queue를 dispose하며, 현재 sample 및 MediaPipe result/model을 해제합니다. 이미 실행 중인 동기 MediaPipe 추론은 끝난 직후 정리하고 다음 추론은 시작하지 않습니다.

파일 선택과 VIDEO REPLAY 실행 직전에 source 일치를 검사합니다. 현재는 파일명/파싱 가능한 capture ID 검증이며 WebM 내부 metadata를 읽거나 삽입하지 않습니다. identity 추출과 비교를 작은 별도 함수로 분리했으므로, 향후 파일명 변경을 지원할 때 검증된 container metadata를 입력으로 확장할 수 있습니다.

### Frame completeness 진단

VIDEO 결과 화면과 Download Replay Results JSON의 `video.videoDiagnostics`에 저장합니다.

| 항목 | 의미 |
| --- | --- |
| `decodedFrameCount` | 순차 iterator에서 소비자에게 전달된 decoded sample 수 |
| `processedFrameCount`, `videoProcessedFrameCount` | 실제 Pose 추론과 snapshot을 완료한 frame 수 |
| `duplicateFrameCount`, `duplicateMediaTimestampCount` | 이미 관측한 동일 media timestamp의 sample 수. 두 필드는 같은 값 |
| `skippedFrameCount` | 잘못된/음수 timestamp 또는 역행 timestamp 때문에 제외한 decoded sample 수. Duplicate는 포함하지 않음 |
| `outOfOrderMediaTimestampCount`, `invalidMediaTimestampCount` | skipped의 사유별 수 |
| `firstMediaTimestampMs`, `lastMediaTimestampMs` | 처리한 media timestamp의 처음/마지막 |
| `medianFrameIntervalMs`, `maxFrameIntervalMs` | 연속 처리 timestamp 간격의 중앙값/최댓값. 2개 미만이면 null |
| `expectedApproxFrameCount` | capture duration × nominal FPS의 추정값. 컨테이너의 exact frame count가 아님 |
| `recordedPoseFrameCount`, `recordedTimestamps` | 전체 Capture JSON의 inference 수와 시간 분포 |
| `guidedInterval` | 선택한 Guided trial의 recorded/video count 및 각각의 처음/마지막/median/max 간격 |

정상 완료 시 `decoded = processed + duplicate + skipped`입니다. 이 등식은 소비한 decoded sample을 빠짐없이 계산했다는 뜻이며 **촬영/인코딩 전에 빠진 source frame 수를 복원했다는 뜻이 아닙니다.** 중복 timestamp를 missing source frame으로 세지 않고 nominal FPS와의 차이를 임의의 skipped 수로 만들지 않습니다. 전체 frame 수와 Guided frame 수를 혼동하지 마세요.

Guided 범위는 기존 LANDMARK replay와 동일하게 trial의 관측된 시작/종료 경계를 사용합니다(`GUIDED_TEST_START` / `GUIDED_TEST_STOP`, 동일 시각에는 기록된 order 반영). 예정된 22초 `GUIDED_TEST_COMPLETE`보다 실제 완료를 관측한 inference/clock이 조금 늦을 수 있으며, 기존 661-frame 비교의 그 경계를 바꾸지 않습니다. live inference와 encoded video는 1:1이 아닐 수 있으므로 두 timeline의 count와 first/last/median/max를 함께 비교합니다. 별도의 timestamp offset 보정은 하지 않습니다.

### clean fixture 재검증

대용량 사용자 WebM/JSON은 repo에 넣지 않습니다. 실제 clean 파일은 로컬에서 아래 순서로 검증하세요.

1. `pnpm install` → `pnpm dev` 후 노트북 Chrome의 `http://localhost:5173`에서 Camera를 정지합니다.
2. Replay JSON에 **clean인가요.json**을 선택하고 기존 clean Guided trial을 고릅니다.
3. LANDMARK REPLAY를 두 번 실행해 **661 frames / 657 usable / KNEE_LEFT @ 20377.09999847412ms / final ARMED**, Events/time·Summary·Final state MATCH가 유지되는지 확인합니다.
4. Replay WebM에서 같은 recording의 WebM을 선택하고 VIDEO REPLAY를 실행합니다. **clean인가.webm**으로 이름을 바꿨다면 먼저 JSON의 `video.filename`(화면의 Expected video)과 같은 원래 파일명으로 되돌리세요. 선택한 파일명이 다르면 `Replay JSON과 다른 capture의 WebM입니다.`를 표시하고 Video 실행을 차단합니다. Recorder의 표준 파일명에서 capture ID를 파싱할 수 있으면 JSON의 `captureId`(결과의 `sourceCaptureId`)와도 비교합니다. Landmark Replay는 WebM mismatch와 무관하게 실행할 수 있습니다.
5. 완료 시 전체 count와 별도로 **Guided Recorded Pose Frames: 661 / Video Processed Frames: N**을 확인합니다. 기존 약 375보다 coverage가 개선됐는지, duplicate/skipped가 있는지, timestamp 처음/끝/간격에 큰 차이가 있는지 확인합니다. N을 661로 강제하거나 성공 기준으로 하드코딩하지 않습니다.
6. 기능 결과는 **LEFT detected/correct, RIGHT miss, Twist/Neutral false kick 0**에 가까워지는지 비교합니다. coverage가 충분한지 먼저 확인하고 남은 차이를 detector miss로 단정하지 않습니다. RIGHT miss나 pose-loss detector 수정은 이번 단계 범위에 없습니다.
7. Download Replay Results JSON으로 진단과 비교 결과를 저장합니다. 다시 실행해서 같은 source timestamp 분포/count가 유지되는지도 확인합니다. Video decode/Pose의 수치적 bit-identical은 별도 보장이 아닙니다.

자동 테스트는 50ms/frame 처리에서도 `[0, 33, 66, 100, 133]` 전부 처리, concurrency 1, wall-clock/presentation callback 독립성, duplicate/역행/간격 집계, decoder 취소 및 자원 정리, 전체/Guided UI·export를 확인합니다. 661/657/정확한 LEFT timestamp/ARMED를 재현하는 **작은 synthetic landmark regression**도 추가했습니다. 이는 제공된 결과 요약을 검증하는 fixture이며 사용자의 실제 clean raw 데이터를 대신한다고 주장하지 않습니다.

## STEP 4G — Kick Feature Discovery / Limb-Relative Motion Analysis

저장된 **STEP 4F version 1 Replay Capture JSON**의 landmark를 분석하는 Controller 개발 도구입니다. Camera 시작, 새 운동 촬영, WebM, MediaPipe 재추론이 필요하지 않습니다. Diagnostic version 3 / Replay 결과 JSON은 입력 대상이 아닙니다. 여러 파일의 모든 Guided trial을 `filename + captureId + trialId`로 구분합니다. 원본 파일은 repo에 넣지 않습니다.

### Ground truth / Neutral / 측정 규칙

- Label은 `GUIDED_STAGE_CHANGE`의 expected stage입니다. detector miss/wrong event와 관계없이 NEUTRAL → TWIST_LEFT → NEUTRAL → TWIST_RIGHT → NEUTRAL → KNEE_LEFT → NEUTRAL → KNEE_RIGHT → NEUTRAL을 분석합니다. Marker 시각을 우선하며 경계는 **[start, end)**, 정확히 경계에 있는 frame은 다음 stage입니다. 마지막 stage는 COMPLETE/STOP/trial 종료로 제한합니다. 전체 stage marker가 없을 때만 trial 시작 + 기존 22초 sequence로 추정하고 경고를 표시합니다. 일부 marker 누락/잘못된 순서는 입력 오류로 표시합니다.
- 각 trial의 **첫 NEUTRAL stage**에서 usable frame의 component별 median으로 analysis-only reference를 만듭니다. 이후 Neutral/Twist/Knee는 reference를 바꾸지 않습니다. component별 valid count도 내보내며 baseline이 없으면 delta는 null입니다. 기존 production Neutral/Kick baseline, detector state, smoothing에 쓰지 않습니다.
- Image normalization의 `bodyScale`은 trial에 저장된 frozen `baseline.bodyScale`을 그대로 사용해 기존 X control과 같은 단위를 유지합니다. 새 relative vector/distance/angle/world 기준값은 위 analysis-only reference입니다. World normalization은 첫 Neutral의 **same-side world hip-knee length median**입니다. 0에 가까운 분모는 null입니다.
- Usability: image hip visibility ≥ 0.7, knee ≥ 0.5. Hip-center 후보는 양쪽 hip, same-side 후보는 해당 hip/knee만 필요합니다. World는 해당 image hip/knee의 visibility를 확인하고, world visibility가 있으면 같은 기준을 적용합니다(null이면 image visibility 사용). World 누락은 image 후보를 무효화하지 않습니다. Angle은 image XY hip-knee-ankle 각도(도)이며 ankle ≥ 0.5도 필요합니다. Angle/world의 reference가 없으면 해당 delta만 null입니다.
- 좌표를 mirror하거나 좌표 부호로 limb를 바꾸지 않습니다. Image XY는 기존 detector와 같은 MediaPipe normalized image 좌표이며 pixel aspect 보정은 하지 않습니다. World/angle은 탐색 후보입니다.

### 후보와 통계

| 분류 | 계산값 |
| --- | --- |
| Existing control | per-side `kneeCenterOffsetX`, `normalizedXDisplacement`, GLOBAL `dominantNormalizedXDisplacement` (저장된 Kick baseline, 기존 usability/부호/동률 규칙) |
| Hip-center image | `dx/dy`, `deltaDx/deltaDy`, `deltaDxNorm/deltaDyNorm`, `hipCenterRelative2DDisplacement = hypot(deltaDx, deltaDy) / bodyScale` |
| Same-side hip image | `sameHipDeltaXNorm/YNorm`, `sameHip2DDisplacementNorm` |
| Hip-knee distance | current/neutral distance, signed change, absolute change, 각각 bodyScale normalized change |
| World exploratory | same-hip `worldDx/Dy/Dz`, Neutral 대비 `deltaWorldX/Y/Z`, 각 abs delta, `world3DDisplacement`; delta/abs delta/3D magnitude의 neutral world length normalized 버전 |
| Angle exploratory | `kneeFlexionAngle`, `kneeFlexionAngleChange`; 자체 coverage |
| Translation diagnostic | `hipCenterXChange`, `hipCenterYChange` |

LEFT evidence는 **LEFT limb의 Neutral 대비 변화량**, RIGHT evidence는 **RIGHT limb의 변화량**입니다. Signed motion 후보도 evidence에는 절댓값을 사용합니다. Raw 위치/현재 길이/현재 angle/hip translation은 진단용이며 kick separation/direction 값을 만들지 않습니다. 기존 dominant X는 GLOBAL control로 separation만 계산하고 limb direction은 N/A입니다. 자동 BEST/WINNER 선정은 없습니다.

Dataset × stage × feature × side별 `frameCount`, `usableFrameCount`, `coverage`, `median`, `p90`, `p95`, `max`, `peak`, `peakAbsVelocity`, `velocitySampleCount`를 저장합니다. Median은 가운데 2개 평균, p90/p95는 nearest-rank입니다. Signed feature의 median/percentile/max는 **signed 원값**, peak는 **max absolute value**입니다. Separation/direction은 evidence magnitude를 사용하므로 signed stage p95와 구분해야 합니다.

주요 hip-center 2D / same-hip 2D / absolute distance change / world3D displacement 및 기존 normalized X에 대해 `(current − previous) / ((tMs − previous.tMs) / 1000)`으로 velocity를 계산합니다. Wall-clock이나 재생 속도는 사용하지 않습니다. 연속 관측 중 하나라도 missing, dt ≤ 0, dt ≥ **400ms**, stage 변경이면 velocity는 null입니다. Missing frame을 뛰어넘어 이전 값에 연결하지 않습니다. 기존 Replay와 같이 timestamp 정렬 후 동일 timestamp는 첫 frame만 분석하며 landmark 배열 자체를 복제하지 않습니다.

각 dataset 및 aggregate에 다음을 표시합니다.

- `nonKickP95/Max`: NEUTRAL + TWIST_LEFT + TWIST_RIGHT의 양쪽 limb evidence를 pool. `kneeLeftPeak`: KNEE_LEFT의 LEFT evidence peak, `kneeRightPeak`: KNEE_RIGHT의 RIGHT evidence peak. `minKickPeak = min(L, R)`.
- `sampleSeparationMargin = minKickPeak − nonKickMax`, `robustSeparationMargin = minKickPeak − nonKickP95`. Aggregate는 usable sample을 pool하므로 긴 trial의 비중이 커지고, 각 label의 peak는 선택한 trial 전체의 peak입니다. 따라서 aggregate만으로 STRESS 결과를 판단하지 않습니다.
- 각 실제 KNEE stage에 leftPeak/rightPeak/correctSideMargin을 보존합니다. KNEE_LEFT는 `left − right`, KNEE_RIGHT는 `right − left`입니다. 표의 Direction L/R Margin은 해당 label의 **모든 trial 중 최소 margin**입니다. `directionConsistentAcrossObservedKicks`는 모든 관측 stage의 margin이 양수이며 두 kick label이 모두 존재할 때 true, 하나라도 0 이하이면 false, 비교할 limb/label이 없으면 null(UNKNOWN)입니다. 양수인 CLEAN으로 음수/누락 STRESS를 덮지 않습니다.
- `overallCoverage`, `neutralCoverage`, `twistCoverage`, `kneeLeftCoverage`, `kneeRightCoverage`: **usable side-frame / 기록된 stage side-frame**. 양쪽 후보의 분모는 frame 수 × 2, GLOBAL은 × 1입니다. Pose가 없는 recorded frame도 분모에 포함합니다. 원본 카메라 FPS 대비 coverage는 아닙니다. 한 항목이라도 **80% 미만 또는 관측 없음**이면 LOW / MISSING COVERAGE를 표시합니다. 이는 coverage 표시 기준이며 detector threshold가 아닙니다. World/angle은 LOW여도 다른 후보 계산에 영향을 주지 않습니다. Stage details에서 좌우 각각의 coverage를 확인하세요.

이 통계는 **현재 small fixture set**의 기술 통계입니다. Universal threshold, 최종 feature 선택, 실제 kick 검출 정확도를 의미하지 않습니다. 이번 단계에서는 ENTER/CONFIRM/velocity threshold, WAIT_RETURN/WAIT_CLEAR, production calibration, 기존 LANDMARK/VIDEO Replay를 수정하지 않습니다.

### CLEAN / STRESS 실행 절차

1. `pnpm dev:controller-web`을 실행하고 노트북 브라우저에서 `http://localhost:5173`을 엽니다. 카메라는 시작하지 않습니다. 기존 Socket 기능과 별개로 이 분석에는 서버/휴대폰이 필요하지 않습니다.
2. **STEP 4G — Kick Feature Discovery** → **Feature Discovery Replay JSON**에서 기존 로컬 **clean인가요.json**, **3차검증2.json**을 동시에 선택합니다. Capture JSON만 필요합니다. 선택 즉시 파일 단위로 분석하며, 잘못된 파일은 이름과 오류를 표시하고 aggregate에서 제외합니다.
3. 각 파일의 captureId / trialId / stage source를 먼저 확인합니다. CLEAN 표에서 기존 `normalizedXDisplacement` RIGHT와 `deltaDyNorm`, `hipCenterRelative2DDisplacement`, `sameHip2DDisplacementNorm`, distance/world 후보의 KNEE_RIGHT peak를 비교합니다. 숫자가 커도 NonKick p95/max와 correct-side margin을 함께 확인합니다.
4. **Stage / limb details**를 펼치고 후보를 선택해 KNEE_LEFT/KNEE_RIGHT 각각의 LEFT/RIGHT usable count, coverage, peak, velocity를 확인합니다. Analysis-only Neutral reference의 valid count도 볼 수 있습니다.
5. STRESS 표에서 pose-loss/visibility 구간의 coverage 저하와 null을 확인합니다. World/angle의 LOW coverage 및 반대 limb 반응도 비교합니다. CLEAN과 STRESS를 먼저 따로 보고 Aggregate의 sample/robust margin과 `directionConsistentAcrossObservedKicks`를 확인합니다. 현재 제공된 설명만으로 새 후보가 RIGHT miss를 해결한다고 단정할 수 없습니다.
6. **Download Feature Discovery JSON**으로 summary를 저장합니다. **Reset Feature Discovery**는 분석 결과/진행 중 파일 읽기를 폐기합니다. 다른 파일 선택은 이전 결과를 대체합니다. 촬영·운동을 다시 수행하지 않습니다.

Export는 `{ version: 1, createdAt, inputs: [{ filename, captureId, trialId }], features: { definitions, settings }, perDataset, aggregate }`입니다. `perDataset`에는 stage 범위/label, Neutral reference/valid counts, stage summaries, feature coverage/separation/direction이 들어갑니다. **Full landmarks, per-frame scalar 배열, 영상, detector event는 export하지 않습니다.** 파일 처리 중 raw JSON과 percentile 계산용 scalar pool만 일시적으로 보유하고, 분석 완료 후 React state에는 summary만 저장합니다. 파일 사이에 UI에 실행 기회를 주고 per-frame state update는 하지 않습니다. Blob/ObjectURL 로컬 다운로드만 사용하며 upload/Socket/DB 저장은 없습니다.

자동 테스트는 XY translation invariance, 작은 X + 큰 Y, world depth-only, LEFT/RIGHT limb evidence, scale normalization, ankle/world/반대 hip 누락 격리, Neutral median, recorded velocity/gap, stage 경계, multiple trial, signed 통계/separation/direction, STRESS coverage, mirror 독립성, input/live detector immutability 및 기존 LIVE↔LANDMARK parity, 다중 파일 UI/invalid input/reset/unmount/summary export를 검증합니다. Synthetic test는 사용자의 실제 CLEAN/STRESS 측정 결과를 대신하지 않습니다.

## STEP 4G.1 — Temporal Validation for Knee-Y Kick Evidence

STEP 4G의 같은 Capture JSON 선택으로 시간 축 분석도 실행합니다. PRIMARY는 `abs(deltaDyNorm)`, SECONDARY는 `hipCenterRelative2DDisplacement`, CONTROL은 `normalizedXDisplacement`입니다. Raw Y 값과 velocity는 부호를 유지하되 **direction은 신체 LEFT/RIGHT limb의 적분 evidence로 비교**합니다. World/angle은 4G.1 평가 대상이 아닙니다. 위 STEP 4G의 analysis-only 첫 Neutral reference와 recorded bodyScale을 재사용하며 production calibration/detector에는 쓰지 않습니다.

### 계산 및 해석

- Y threshold: **0.25, 0.30, 0.35, 0.40, 0.45, 0.50, 0.60**. Dwell: **0, 50, 80, 100, 150, 200, 300ms**. 각 stage/side에 framesAbove, fractionAbove(usable frame 분모), longestContiguousRunFrames/Ms, first/lastCrossingMs, lastAboveMs, crossingCount를 저장합니다. Crossing은 above run의 **진입**이며 시각은 capture-relative `tMs`입니다.
- 연속 시간은 마지막 above frame − 첫 above frame입니다. 한 frame spike는 **0ms**입니다. Trigger는 dwell을 만족한 **첫 실제 관측 frame의 시각**이며 사이 시각을 보간하지 않습니다. Below-threshold, missing, 비양수 dt, **dt ≥ 400ms**, stage/window 경계에서 run을 끊습니다. Gap 전 candidate를 reacquisition 뒤에 이어붙이지 않습니다.
- `deltaDyNormVelocity = (signed Y[n] − signed Y[n−1]) / recorded dt seconds`. Stage/window별 `peakAbsVelocity`, `p95AbsVelocity`, valid velocity sample count를 제공합니다. Missing 또는 400ms 이상 gap을 건너뛰지 않습니다. Peak/p95 evidence는 절댓값, velocity는 signed Y의 변화량의 절댓값 통계입니다.
- Direction candidate window는 **양쪽 Y가 usable**이며 한쪽이라도 threshold 이상인 연속 구간입니다. 각 limb에 `max(0, abs(Y) − threshold)`를 recorded dt로 사다리꼴 적분합니다(단위: evidence × seconds). Window 첫/마지막 관측 바깥으로 연장하지 않습니다. Missing/400ms gap은 window와 적분도 끊습니다. 좌우 peak, integrated evidence, KNEE_LEFT의 `left − right`, KNEE_RIGHT의 `right − left` margin을 출력합니다. 양쪽 적분이 같거나 수치 오차 범위(1e-8)이면 AMBIGUOUS입니다. 한 frame의 적분은 0이며 방향을 확정하지 않습니다.
- 제한된 2D confirmation **OFF / 0.30 / 0.40 / 0.50**도 비교합니다. Y contiguous dwell을 만족한 frame에서 **같은 limb의 2D ≥ confirmation**이면 trigger입니다. 2D 자체의 별도 dwell이나 production rule을 추가하지 않습니다. 2D는 abs(Y) 이상이므로 Y threshold보다 낮은 2D 기준은 수학적으로 중복일 수 있습니다. 추가 이득은 OFF와 더 높은 2D 기준의 실제 결과를 비교해야 합니다.
- FULL은 기존 `[stageStart, stageEnd)`, TRIMMED는 **[stageStart+200ms, stageEnd−200ms)**입니다. 양쪽을 독립 계산하고, trim 뒤 첫 frame에 trim 전 velocity/dwell/적분을 이어받지 않습니다. Trim은 stage-edge contamination 실험이며 production latency가 아닙니다.

### CLEAN 평가와 STRESS 관측성

모든 파일은 **UNASSIGNED**로 시작합니다. UI의 **Dataset roles**에서 각 trial을 CLEAN/STRESS로 명시적으로 지정하세요. 파일명(Unicode 표기/이름 변경 포함)으로 role을 추론하지 않습니다. **Run Temporal Validation**을 실행할 때 CLEAN이 없으면 **No CLEAN dataset selected**를 표시하고 export에도 warnings로 남깁니다. 역할은 Feature 표시/export, Temporal, Shadow에서 공유하며, role 변경은 기존 Shadow 결과를 무효화합니다.

`observableStage = usable coverage ≥ 80% AND 최대 usable gap < 400ms`입니다. 이는 **분석용 관측성 기준**이며 detector threshold가 아닙니다. 누락 frame, 400ms 이상 inference gap, window 시작/종료의 긴 무관측 시간을 `usableGaps { startMs, endMs, durationMs, reason }`에 남깁니다. Coverage는 기록된 frame 기준이므로 높은 coverage라도 긴 시간 gap이 있으면 observable=false일 수 있습니다. 관측 가능한 구간에서 실제 trigger를 봤다면 `observedTrigger=true`로 남깁니다. Trigger가 없고 관측 불가이면 `triggered=null (UNKNOWN)`이며 false-negative로 바꾸지 않습니다.

**CLEAN으로 지정한 모든 trial**의 모든 대상 stage를 관측할 수 있을 때만 조합을 평가합니다. Non-kick은 어느 limb든 trigger가 있으면 해당 stage를 false-trigger stage로 집계하고, KNEE_LEFT/RIGHT는 각각 올바른 limb에서 모든 해당 stage가 trigger되어야 detected=true입니다. 필요한 label이나 관측성이 부족하면 INSUFFICIENT_EVIDENCE입니다. STRESS/UNASSIGNED는 CLEAN rule 평가에서 제외합니다.

`viableRulesClean`은 Neutral/Twist L/Twist R false-trigger stage 수가 전부 0이고 양쪽 Knee가 모두 detected인 조합을 **전부** 나열합니다. FULL/TRIMMED × threshold 7 × dwell 7 × confirmation 4 = **392개**를 비교합니다. Direction/AUC는 별도 진단이며 viable 판정에 숨은 조건으로 사용하지 않습니다. 자동 BEST/WINNER, production threshold 추천 또는 자동 결론은 없습니다. STRESS는 표의 observable/coverage/gap 및 usable non-kick의 observed trigger를 따로 검토합니다.

### 기존 fixture로 실행

1. `pnpm dev:controller-web` → `http://localhost:5173`. Camera나 새 운동 테스트 없이 기존 **clean인가요.json / 3차검증2.json**을 STEP 4G 입력에서 동시에 선택합니다.
2. **STEP 4G.1**에서 capture/trial을 확인하고 CLEAN/STRESS role을 직접 선택한 뒤 **Run Temporal Validation**을 누릅니다.
3. Window **FULL**, confirmation **OFF**로 시작합니다. 49개 threshold+dwell 표와 **All viable combinations**를 확인합니다. 0개일 때 각 조합이 REJECTED인지 관측 부족인지 구분합니다.
4. Y threshold/dwell을 바꿔 non-kick의 높은 peak가 짧은 run인지, kick의 유지시간은 충분한지 확인합니다. Stage별 peak/p95, longest duration, fraction/crossing count, Y velocity를 함께 봅니다. Peak 하나로 spike/sustained를 단정하지 않습니다.
5. Paired candidate windows에서 Left/Right integrated evidence와 correct-side margin을 비교합니다. 방향이 AMBIGUOUS이거나 paired usable frame이 없는 경우를 임의로 LEFT/RIGHT로 채우지 않습니다.
6. 2D confirmation을 **0.30 / 0.40 / 0.50**으로 바꿔 OFF 대비 false triggers 감소와 양쪽 Kick 유지 여부를 비교합니다. Window를 **TRIMMED**로 바꿔 stage-edge tail의 영향과 viable 조합 차이도 확인합니다.
7. STRESS의 KNEE_RIGHT coverage/observable 및 usable gaps를 확인합니다. UNKNOWN은 failure가 아닙니다. Tracking loss 전후 candidate가 다른 window로 분리되고, missing/gap을 포함한 dwell이 이어지지 않는지 start/end와 gap 목록을 비교합니다.
8. **Download Feature Temporal Discovery JSON**으로 결과를 로컬 저장합니다. 기존 Feature Discovery JSON 다운로드도 유지됩니다. Reset Feature Discovery/다른 파일 선택은 두 분석 결과를 모두 초기화합니다.

Export는 `{ version: 1, createdAt, feature: "deltaDyNorm", inputs: [{ filename, captureId, trialId, role }], settings, perDataset, rulesClean, viableRulesClean, warnings }`입니다. `perDataset.stages`에 FULL/TRIMMED별 sides의 coverage/observability, Y/2D/X 요약, Y velocity, visibility median, thresholds/dwellResults, usable gaps, candidate directionEvidence가 들어갑니다. **Raw landmarks 및 per-frame temporal series는 React state/export에 넣지 않습니다.** STEP 4G.2 반복 실행용 scalar timeline만 ref에 보관하고, Reset/새 파일/unmount 시 폐기합니다. 원본 JSON/landmarks는 보관하지 않습니다. 서버 upload/Socket/game 연결은 없습니다.

실제 측정 결과와 synthetic 자동 테스트 결과는 구분해야 합니다. STEP 4G.2 작업에서 기존 Desktop CLEAN/STRESS Capture JSON을 찾아 명시적 role로 Temporal/Shadow를 로컬 재실행했으며, 아래에 Shadow 결과를 기록합니다.

## STEP 4G.2 — Stateful Y-Kick Shadow Detector Simulation

기존 4G/4G.1과 함께 동작하는 **분석 전용** `YKickShadowDetector`입니다. 각 trial의 전체 Guided timeline을 한 번에 replay하며 **stage 경계에서 detector를 reset하지 않습니다.** Guided expected label은 사후 평가에만 쓰고 detector에는 전달하지 않습니다. 따라서 KNEE_LEFT 이후 Neutral에 남는 return tail도 동일한 WAIT_RETURN의 일부로 처리합니다. 기존 production `KneeKickDetector`, X constants, Neutral calibration 및 LIVE/LANDMARK/VIDEO 경로는 변경하지 않습니다.

### State / side usability / direction

- Evidence는 4G의 같은 `discoveryFeatures` 계산에서 추출한 **abs(left/right deltaDyNorm)**입니다. 첫 Neutral 분석 기준값과 recorded bodyScale을 그대로 공유합니다. Hips visibility ≥ 0.7, 해당 knee ≥ 0.5이며, **반대쪽 knee는 필요하지 않습니다.** 2D와 velocity는 진입/확정 조건으로 사용하지 않습니다.
- `ARMED → CANDIDATE`: 한쪽이라도 ENTER 이상이면 시작합니다. Side별 run 시작/eligible 시각/peak/적분을 독립적으로 기록합니다. 기본 ENTER **0.4**, dwell **50ms**입니다. 실제 recorded timestamp에서 연속 dwell을 만족해야 하며 frame 수를 시간으로 바꾸지 않습니다.
- **FIRST_DWELL**: 먼저 실제 관측 frame에서 dwell을 충족한 side를 사용합니다. 동시에 두 side가 충족하면 임의 방향 event를 내지 않고 AMBIGUOUS cancellation → WAIT_CLEAR로 갑니다.
- **INTEGRATED_WINDOW**: 첫 dwell을 충족한 시각부터 **100ms** decision window의 `max(0, abs(Y) − ENTER)`를 초 단위 사다리꼴 적분합니다. 마지막 interval이 window 끝을 넘으면 recorded sample 간 보간으로 deadline까지만 적분하고, event는 deadline 이상인 첫 실제 frame에서 냅니다. Window deadline까지 dwell을 충족한 side만 방향 후보입니다. Opponent가 missing이거나 dwell을 충족하지 못하면 단독 eligible limb를 막지 않습니다. 두 eligible side의 적분이 같으면(수치 오차 1e-8) AMBIGUOUS입니다. FIRST_DWELL의 적분은 candidate 시작~확정 구간, INTEGRATED_WINDOW의 적분은 decision window이므로 값의 시간 범위를 구분하세요.
- Event에는 좌우 적분/peak, `absoluteMargin = abs(L−R)`, `ratio = max(L,R)/(L+R)`를 저장합니다. Ratio는 균등 0.5, 단독 1, 합이 0이면 null입니다. Margin/ratio를 production gate로 선택하지 않습니다.
- Candidate owner가 unusable이면 **즉시 evidence 폐기 → WAIT_CLEAR(owner)**, reason=POSE_LOSS입니다. dt ≥ **400ms**도 cancellation + WAIT_CLEAR이며 reason=TIMESTAMP_GAP입니다. Opponent loss는 그쪽 run/eligible/peak/적분만 지우고 owner를 막지 않습니다. WAIT_CLEAR는 owner가 usable한 상태로 `abs(Y) < EXIT`를 return dwell만큼 유지해야 끝납니다. Pose loss 자체는 clear가 아닙니다. Candidate seed는 먼저 관측한 above limb이며 동시 onset에는 큰 evidence 쪽(동률 LEFT)을 **clear owner로만** 고릅니다. 이 규칙으로 event 방향을 결정하지 않습니다.
- Event 후 **WAIT_RETURN(triggeredSide)**: **event를 발생시킨 limb만** EXIT 미만인지 확인합니다. Opponent가 missing/high여도 triggered limb가 연속 return dwell을 만족하면 ARMED입니다. Triggered limb가 missing이면 기다리며, 이전 return dwell은 폐기합니다. 긴 gap 뒤 below 관측도 그 frame부터 새 dwell입니다. 평소 threshold 아래로 끝난 미확정 candidate는 BELOW_ENTER 취소 후 ARMED로 돌아갑니다.
- 모든 판단은 recorded frame에서만 일어납니다. 중복/역행 timestamp는 전처리/코어에서 제외하며 wall-clock, synthetic tick, classifier/game 상태를 사용하지 않습니다.

### 비교 범위 / 평가

ENTER **0.35/0.40/0.45** × entry dwell **33/50/80ms** × EXIT **0.15/0.20/0.25/0.30** × return/clear dwell **100/150/180/200ms** × 두 방향 strategy = **288개**입니다. 기본 표는 0.4/50의 32개 return/strategy 조합을 보여주며 checkbox로 모든 이웃을 표시합니다. 자동 BEST 선택은 없습니다.

각 조합은 dataset/trial별 event, cancellation reason, 상태 전이, rearm timestamp/return latency, 다음 action 시작 전 ARMED 여부, final state, stage별 관측성/정답/중복을 보존합니다. 다음 action 준비 상태는 경계 이전 마지막 실제 관측 state이며 `lastObservedFrameAt`을 함께 기록합니다. 새로운 frame/clock을 생성하지 않습니다. 최종 Neutral 내 ARMED 복귀 여부는 final state로 확인합니다.

KNEE_LEFT observability는 **LEFT만**, KNEE_RIGHT는 **RIGHT만** 평가합니다. 반대쪽 knee가 가려져도 expected kick을 unobservable로 만들지 않습니다. 기존 coverage ≥ 80%, usable gap < 400ms는 **통계 평가용** 관측성 기준이며, runtime shadow event는 이 stage 요약값을 gate로 사용하지 않습니다. Non-kick의 안전성 평가에는 양쪽 관측성을 확인합니다.

`viableStatefulConfigs`는 모든 CLEAN trial에 필요한 label과 **expected kick side의 관측성**이 있고, KNEE_LEFT/RIGHT 각각 올바른 event 1개, Neutral/Twist false 0, wrong/duplicate 0인 조합입니다. Non-kick coverage는 별도 `nonKickCoverageLimited` 진단이며 관측된 timeline의 event count를 추가로 veto하지 않습니다. 따라서 viable도 누락된 frame의 안전성을 증명하지 않습니다. STRESS는 recall을 판정에 넣지 않으며 unobservable miss는 UNOBSERVABLE로 남깁니다. STRESS의 cross-gap confirmation 또는 pose-loss recovery-associated false/wrong event가 있으면 viable로 표시하지 않습니다.

Cross-gap은 event에 보존한 **evidence epoch와 현재 side epoch**로 검사합니다. Pose loss/긴 gap으로 취소된 candidate의 ID, clear 완료 시각을 이후 첫 새 event의 `recovery`에 남깁니다. 별도로 **첫 reacquired frame에서 above run을 시작한 경우** `entryReacquisition {timestamp, lossAt, reason}`을 보존합니다. `poseLossGeneratedFalseEvents`는 이 두 연결 중 하나가 있는 unexpected/wrong event 수를 보수적으로 집계하며, **인과관계가 증명되었다는 뜻은 아닙니다.** ARMED 상태에서 loss 후 완전히 새 dwell을 모은 false event와 이전 candidate evidence 재사용을 구분할 수 있습니다. STRESS의 다른 usable false events도 별도 집계합니다. ARMED에서의 pose loss에 새로운 clear gate를 임의로 추가하지 않으므로, fresh reacquisition false가 남는지도 이 실험의 결과로 드러납니다.

### 기존 CLEAN/STRESS 파일로 실행

1. `pnpm dev:controller-web` → `http://localhost:5173`. Camera를 시작하거나 운동을 다시 촬영하지 않습니다.
2. STEP 4G 입력에서 기존 **clean인가요.json**, **3차검증2.json** Capture JSON을 함께 선택합니다.
3. **Dataset roles**에서 각 CLEAN trial은 CLEAN, STRESS trial은 STRESS를 직접 선택합니다. 파일명에 따른 자동 지정은 없습니다. CLEAN이 없으면 Temporal/Shadow 모두 **No CLEAN dataset selected**를 표시합니다. UNASSIGNED trial은 진단 출력에는 남지만 viability 평가에서는 제외합니다.
4. **Run Temporal Validation**으로 기존 stage-independent 통계를 확인하고, **STEP 4G.2 → Run Shadow Validation**을 누릅니다. Shadow는 같은 scalar timeline을 ref에서 읽고 8개 config마다 UI에 실행 기회를 줍니다. 진행 중 Cancel, role 변경, Reset, 새 파일, unmount 시 오래된 결과를 폐기합니다.
5. 기본 0.4/50 표에서 FIRST_DWELL/INTEGRATED_WINDOW의 Clean L/R, false/wrong/duplicate, Stress Cross-Gap/Recovery False, final state를 비교합니다. **Inspect**에서 event별 margin/ratio, cancellation, return latency/다음 action readiness를 확인합니다. 특히 LEFT 후 Neutral tail과 RIGHT-only visibility, STRESS POSE_LOSS cancellation을 봅니다.
6. **모든 이웃 조합 표시**로 0.35/0.45와 33/80ms 안정성을 비교하고, **All viable stateful configurations**에서 조건을 만족한 조합 전체를 확인합니다. 0개면 INSUFFICIENT_EVIDENCE와 REJECTED를 구분하세요.
7. **Download Y Kick Shadow Result JSON**으로 저장합니다. Schema는 `{ version:1, createdAt, inputs:[{filename,captureId,trialId,role}], settings, configs, perConfig, viableStatefulConfigs, warnings }`입니다. 각 perConfig에는 clean/stress의 집계 및 개별 dataset/trial 진단과 unassigned 결과가 있습니다. 원본 landmark/영상/per-frame scalar arrays는 내보내지 않으며 upload/Socket 전송도 없습니다.

자동 회귀는 33ms spike 차단 / 67ms dwell / 양쪽 sustained kick / 700ms tail 단발 / opponent missing return / POSE_LOSS cancellation / reacquisition 전후 evidence 격리 / WAIT_RETURN loss / RIGHT-only usable / A/B 방향 차이·동률 / EXIT equality·400ms gap / deterministic replay / 4G Y 값 일치 / 기존 production LIVE↔LANDMARK parity를 검증합니다. **합성 fixture 결과와 사용자 실제 CLEAN/STRESS 결과를 구분해야 합니다.**

### 기존 실제 fixture 실행 결과 (2026-10-02)

Desktop의 CLEAN(약 10.3MB) / STRESS(약 14.8MB) 원본 Capture를 **읽기만** 하고 두 role을 직접 지정해 전체 288개 config를 실행했습니다. 한글 파일명이 분해형 Unicode(NFD)여서 기존 정확한 파일명 비교가 role을 지정하지 못한 상황도 확인했습니다. 원본은 repo에 복사하지 않았습니다.

- **CLEAN 0.4 / 50ms의 32개 EXIT/RETURN/strategy 조합 모두** LEFT 1, RIGHT 1, false 0, wrong 0, duplicate 0, final ARMED였습니다. RIGHT는 해당 knee 90/90 usable이며 반대 LEFT의 57/90 coverage가 검출을 막지 않았습니다.
- FIRST_DWELL event: LEFT **20576.600ms**, RIGHT **25910.400ms**. INTEGRATED_WINDOW event: LEFT **20676.600ms**, RIGHT **26042.900ms**. 기본 EXIT 0.20 / RETURN 180ms에서 A의 적분 absolute margin은 LEFT **0.008288**, RIGHT **0.002645**; B는 LEFT **0.002050**, RIGHT **0.000955**였습니다. 적분 시간 범위가 다르므로 숫자 크기만으로 strategy 우열을 정하지 않습니다.
- Return sweep에서 LEFT rearm은 **23410.700–24044.000ms**, 다음 RIGHT stage 시작 **24333.200ms** 전에 모두 ARMED였습니다. RIGHT rearm은 A **26042.900–26176.200ms**, B **26176.200–26309.500ms**였습니다. LEFT 이후 Neutral tail은 중복 event로 기록되지 않았습니다.
- **STRESS cross-gap confirmations 0**, 37094.800ms의 POSE_LOSS candidate 취소 및 WAIT_CLEAR 유지가 확인됐습니다. Expected RIGHT는 usable 0/90이므로 UNOBSERVABLE로 표시합니다.
- 그러나 STRESS에는 **ARMED 상태의 pose loss 이후 새 evidence로 시작한 RIGHT false event 1회**가 남았습니다. Loss **30227.100ms**, first reacquisition/candidate **30293.100ms**, event A **30361.500ms** / B **30494.700ms**, expected NEUTRAL입니다. 이는 pre-loss candidate 재사용과 별개의 문제이며 `entryReacquisition`으로 드러납니다.
- 따라서 **viableStatefulConfigs = 0 / 288**입니다. CLEAN 중심 조합 통과를 STRESS까지 해결한 것으로 보고하지 않습니다. 자동으로 새 ARMED recovery gate나 threshold를 추가하지 않았으며 이 결과가 다음 설계 판단 자료입니다. 일부 CLEAN non-kick의 낮은 LEFT coverage도 별도 진단에 남겨 관측된 false 0의 한계를 표시합니다.

로컬 산출물은 Desktop의 `plank-stork-shadow-analysis/`에 `step-4g2-shadow-results.json`, `step-4g2-central-summary.json`, `step-4g1-temporal-results.json`, `step-4g2-findings.md`로 저장했습니다. 결과 JSON에는 raw landmark를 포함하지 않습니다.

## STEP 4G.3 — Pose Reacquisition Gate Analysis

Production detector/calibration, MediaPipe, original LANDMARK/VIDEO replay는 그대로 두고 **analysis-only Y shadow**에 side별 entry eligibility를 추가했습니다. UI의 STEP 4G 입력/명시적 CLEAN·STRESS role/scalar timeline을 재사용하며, 새 촬영이나 재추론 없이 기존 JSON을 분석합니다.

### Gate 정의와 비교 범위

- LEFT/RIGHT의 `tracking: USABLE | LOST`와 `state: LOST | REACQUIRED_NOT_READY | READY`를 별도로 관리합니다. 반대 knee의 loss는 현재 knee의 eligibility를 막지 않습니다. Hip visibility loss는 별도 episode로 남기고 양 side에 반영합니다. Physical usability는 기존 cancellation/return/epoch 계산에 그대로 전달하며, gate가 닫힌 값을 가짜 pose loss로 바꾸지 않습니다.
- Loss duration은 **첫 unusable 관측 → 첫 usable 관측**입니다. 마지막 usable → 다음 usable 간격도 별도 기록합니다. `lossMinMs`는 **0/33/67/100/150/200/300/400**이며 경계값을 포함합니다. 0은 한 frame loss도 포함합니다. 첫 관측부터 missing인 경우도 기록하고, dt ≥ 400ms는 이전 관측 시각부터 timestamp gap으로 취급합니다.
- **FIXED_SETTLE**: 재추적 후 **0/50/100/150/200/300/400/500ms**가 지나야 entry를 허용합니다.
- **CLEAR_ONLY**: usable `abs(deltaDyNorm) < 0.15/0.20/0.25/0.30`를 **50/100/150/180/200/300ms** 연속 관측해야 허용합니다. Equality는 clear가 아닙니다. 이미 kick 자세로 재등장하면 실제 clear 복귀 전까지 disarm합니다.
- **SETTLE_AND_CLEAR**: settle **100/150/200ms** AND clear **0.20/0.25/0.30**, dwell **50/100/150ms**입니다. 두 시계는 동시에 진행할 수 있지만 READY 시점에 현재 clear run도 dwell을 충족해야 합니다. 과거 완료 후 끊긴 clear run은 사용할 수 없습니다.
- Missing/dt ≥ 400ms가 clear 연속성을 끊습니다. READY가 되기 전 재손실하면 복귀 시 settle도 다시 시작합니다. 이미 disarmed인 side는 짧은 재손실이 lossMin보다 작아도 unlock되지 않습니다.
- **Gate는 해당 side 입력만 일시적으로 막습니다. 게임/timeline을 pause하거나 사용자에게 기다리도록 요구하는 UX가 아닙니다. Tracking loss 중 발생한 gesture는 의도적으로 MISS가 될 수 있습니다.** 이번 코드는 game/mobile에 연결하지 않습니다.

이 sweep에서는 기존 CLEAN 중심 조합 중 **ENTER 0.4 / dwell 50ms / EXIT 0.2 / return 180ms**를 고정합니다. 8 loss minima × (8 fixed + 24 clear + 27 combined) × FIRST_DWELL/INTEGRATED_WINDOW = **944 configs**입니다. 4G.2의 288개 grid와 곱하지 않습니다. Strategy complexity는 fixed/clear=1, combined=2이며 **자동 BEST 선택이나 production threshold 적용은 없습니다.**

### Trace / 진단 / 판정

Sweep 전에 ungated false reacquisition trace를 두 방향 전략으로 계산합니다. Capture 기준 timestamp, last usable/gap/reacquisition/candidate/event, 50/100/200/300/500ms peak, hip/knee visibility 및 첫 1초의 제한된 scalar 관측을 export합니다. Raw landmark/이미지/영상은 export하지 않습니다.

50/100/200/300/500/1000ms evidence는 **재추적부터 checkpoint까지의 누적 median**과 **checkpoint 직전 50ms median**을 함께 기록합니다. 둘 다 stage 안의 usable 관측만 쓰고 count를 표시하며 보간/0 채우기를 하지 않습니다. 따라서 1초 누적 median이 높아도 그 시점 tracking이 missing이면 지속적인 baseline drift로 단정하지 않습니다. `driftDiagnostic`은 다음 loss 전 continuous evidence가 ENTER 아래로 돌아왔는지를 표시합니다. 자동 re-baseline은 하지 않습니다.

각 threshold/dwell의 `firstClearStartMs`, `firstClearSatisfiedMs`, `satisfiedRunStartMs`, `timeToClearMs`를 reacquisition부터 해당 stage 끝까지만 계산합니다. Clear 자체가 없으면 **NO_CLEAR_OBSERVED**, clear 관측은 있지만 dwell이 부족하면 **CLEAR_DWELL_NOT_SATISFIED**입니다. Runtime shadow gate는 stage 경계에서 리셋하지 않고 다음 stage에서도 실제 clear를 기다립니다.

Event의 `NORMAL_TRACKING / POST_REACQUISITION`은 최종 event 방향 side의 evidence가 시작된 연속 tracking 구간을 뜻합니다. 마지막 loss 이후 구간의 모든 candidate가 POST이며, `candidateStartedTrackingAgeMs`는 마지막 재추적부터 candidate까지의 시간입니다. Loss가 lossMin 미만이어도 source는 POST입니다. 반대 side가 먼저 시작한 candidate에 복귀한 side가 합류해 이기는 경우 candidate age는 음수일 수 있으며, 해당 side의 `sideEvidenceStartedAt / sideEvidenceStartedTrackingAgeMs`를 따로 기록합니다. 이것은 시간적 연결이며 인과관계 판정이나 임의의 post-reacquisition timeout이 아닙니다.

각 config는 CLEAN L/R/false/wrong/duplicate/final, STRESS cancellation/cross-gap/pose-loss false/reacquisition false/post events/final을 보존합니다. 각 CLEAN trial이 expected kick side의 관측성을 충족하고 L=1/R=1/false=wrong=duplicate=0/final ARMED이며, STRESS cross-gap/pose-loss false/reacquisition false가 모두 0일 때 viable입니다. CLEAN/STRESS 둘 다 있어야 판정합니다. STRESS unobservable expected kick miss는 제외하며 non-kick coverage 제한은 계속 진단합니다.

`addedEligibilityLatencyMs`는 gated episode의 reacquisition → 실제 READY 관측까지입니다. CLEAN/STRESS별 완료 count/median/max와 unresolved count를 함께 표시합니다. 도중 재손실 또는 trial 종료로 READY를 관측하지 못한 episode는 **censored/null이며 0ms가 아닙니다.** LossMin 미만이라 즉시 허용한 episode는 added latency 집계에 포함하지 않습니다.

### 기존 실제 CLEAN/STRESS 실행 결과 (2026-10-03)

원본 `clean인가요.json`과 `3차검증2.json`을 읽기만 하고 동일 timeline에 944개 조합을 실행했습니다.

- Ungated RIGHT false: last usable **30193.700ms**, loss start **30227.100ms**, reacquisition/candidate **30293.100ms**. Loss **66.000ms**, usable-to-usable gap **99.400ms**입니다. Candidate latency **0ms**; FIRST_DWELL trigger **30361.500ms (+68.400ms)**, INTEGRATED_WINDOW **30494.700ms (+201.600ms)**입니다.
- 재추적 RIGHT Y **1.178251**; 첫 50/100/200/300/500ms peak는 **1.194546 / 1.196189 / 1.349907 / 1.349907 / 1.349907**입니다. LEFT는 visibility 부족으로 전부 null입니다. 재추적 visibility는 hips **0.999714 / 0.999826**, LEFT knee **0.344041**, RIGHT knee **0.869608**입니다.
- 누적 RIGHT median(50/100/200/300/500/1000ms)은 **1.186399 / 1.194546 / 1.241580 / 1.258779 / 1.258779 / 1.258779**입니다. 그러나 마지막 usable은 **30527.200ms (+234.100ms)**이고 **30560.800ms (+267.700ms)**부터 다시 loss입니다. 300/500/1000ms 직전 50ms usable count는 0이므로 해당 local median은 null입니다. 관측 가능한 구간에서 ENTER 아래로의 decay는 없었지만, 장기 baseline drift는 이 자료로 확정할 수 없습니다.
- 모든 **24 clear threshold/dwell**에서 이 Neutral stage 끝까지 **NO_CLEAR_OBSERVED**입니다. Clear gate가 계속 disarmed인 것은 의도된 결과입니다. 이후 다른 stage의 새 tracking 구간에서는 다시 clear를 만족하면 READY로 돌아옵니다.
- **CLEAN은 모든 944개 조합에서 L=1/R=1/false=wrong=duplicate=0/final ARMED**입니다. 이 fixture의 brief dropout 때문에 정상 kick이 막힌 조합은 없었습니다. 별도 합성 회귀에서는 kick 직전 dropout으로 MISS가 생기는 경우도 검증합니다.
- **FIXED_SETTLE: 20 / 128 viable.** lossMin **0 또는 33ms**에서 FIRST_DWELL은 settle **200/300/400/500ms**, INTEGRATED_WINDOW는 **100/150/200/300/400/500ms**가 통과했습니다. 짧은 settle의 통과는 후속 loss가 dwell/decision 중 candidate를 취소한 영향입니다. 높은 Y가 500ms 계속되는 합성 회귀에서는 settle100 이후 false event가 가능하므로, 이 통과를 neutral recovery 증명으로 해석하면 안 됩니다.
- **CLEAR_ONLY: 96 / 384 viable.** lossMin **0 또는 33ms**, 모든 요청 clear threshold/dwell, 두 방향 전략이 통과했습니다.
- **SETTLE_AND_CLEAR: 108 / 432 viable.** lossMin **0 또는 33ms**, 모든 요청 bounded 조합/방향 전략이 통과했습니다.
- **총 viableReacquisitionConfigs = 224 / 944.** lossMin **67ms 이상**은 실제 66ms episode를 gate하지 않아 false를 제거하지 못했습니다.

가장 단순한 후보군은 complexity 1인 fixed/clear입니다. 예를 들어 lossMin33 + FIRST_DWELL + fixed200의 READY latency median은 CLEAN **216.7ms**, STRESS **201.6ms**(unresolved **10/12**)입니다. lossMin33 + FIRST_DWELL + clear0.25/dwell100은 CLEAN **125.9ms**, STRESS **133.2ms**(unresolved **7/12**)이며 문제의 재추적 구간 자체는 clear를 관측하지 못해 null입니다. 완료된 episode만의 median이므로 latency 숫자만으로 우열을 정하지 않습니다. 어떤 조합도 자동 선택하지 않았습니다.

결과는 Desktop `plank-stork-shadow-analysis/`의 `step-4g3-exact-traces.json`, `step-4g3-reacquisition-results.json`, `step-4g3-config-summary.json`, `step-4g3-findings.md`에 저장합니다. 원본 Capture는 repo에 복사하지 않습니다.

검증: `pnpm typecheck`, `pnpm build`, `pnpm --filter @plank-stork/controller-web test` 모두 통과했습니다. 기존 테스트를 유지하며 **43 files / 515 tests**가 통과했습니다. 실제 944 configs를 두 번 실행해 결과 일치도 확인했습니다. Controller main chunk **631.38kB**의 기존 500kB 초과 경고는 남아 있습니다.

### 재실행

1. `pnpm dev:controller-web` → `http://localhost:5173`. Camera를 시작하지 않습니다.
2. STEP 4G 입력에서 기존 CLEAN/STRESS Capture JSON 두 개를 선택하고 **Dataset roles**를 각각 CLEAN/STRESS로 지정합니다.
3. **STEP 4G.3 → Run Reacquisition Analysis**를 누릅니다. Ungated trace를 먼저 표시하고, 8 configs마다 UI에 실행 기회를 주며 sweep합니다.
4. **False reacquisition trace**에서 gap/trigger/peak/median/visibility/clear availability를 확인합니다. 표는 50개씩 보며 Viable filter 또는 **Inspect gate**에서 event source, side/hip continuity, cancellation, stage outcome, latency를 확인합니다.
5. **Download Reacquisition Analysis JSON**으로 전체 결과를 저장합니다. 파일/role 변경, Reset, Cancel, unmount는 진행 중 결과를 폐기합니다. 서버 upload/Socket 전송은 없습니다.

## 검증 및 빌드

```sh
pnpm typecheck
pnpm build
pnpm --filter @plank-stork/controller-web test
curl http://localhost:3000/health
```

자동 테스트는 초기화/fallback, 프레임 중복 방지, 지표/좌표 갱신, Mirror 독립성, raw snapshot·STABILIZE·sequence·label별 count/dropped·reset·JSON, 음성 실패, feature 수식·null 처리·중앙값 calibration·HIP readiness·독립 knee 완성·grace 경계/고정/재보정·delta·시간 기반 smoothing·pose loss 즉시 무효화/복귀·visibility 경계값, result/camera/unmount lifecycle을 검증합니다. 추가로 Action Validation의 21.5초 경계·수집 구간·primitive snapshot·invalid frame·summary/feature drift·JSON·remote/reset/lifecycle과 Action 보정 sequence·중앙값·필수 HIP/선택 knee, 정규화 거리·NONE·confidence·hysteresis·enter/release·pose stale·Mirror·재보정/Stop/unmount를 검증합니다. STEP 4B-2는 실제 NestJS 서버를 임시 loopback 포트에서 실행해 5개 relay 이벤트와 기존 LEFT/RIGHT, health를 검증하고, Controller 요청/중복/reset/주기/cleanup 및 Mobile 화면/sync/stale/연결 만료를 기존 controller-web Vitest 환경에서 함께 검증합니다. Mobile/Server 전용 테스트 stack이나 별도 test script는 추가하지 않았습니다. STEP 4D는 Neutral-only 시작, 15초 stage 경계·MOVE/HOLD/RETURN 기록, 후보 geometry/projection·derivative, corridor/crossing/dominant-knee 수식, full snapshot·pose loss·remote·다운로드·reset/cleanup도 검증합니다. STEP 4E는 baseline/freeze, signed crossing·body normalization, one-shot/re-arm·dwell, visibility/stale·velocity, Guided Test summary, remote/phone·Mirror·reset/unmount도 검증합니다. 실제 웹캠의 추적·분류·kick event 정확도는 위 실측 가이드로 별도 확인합니다.

빌드 결과는 각 패키지의 `dist/`에 생성됩니다. 빌드한 서버는 `pnpm --filter @plank-stork/server start`로 실행합니다. 웹 빌드는 `pnpm --filter @plank-stork/controller-web preview` 또는 `pnpm --filter @plank-stork/mobile preview`로 확인할 수 있습니다.

`packages/protocol`에는 STEP 1 Socket 테스트 타입과 STEP 4B-2/4C/4D/4E calibration·validation·detector debug 요청/debug snapshot wire 타입이 있습니다. Raw Pose나 classifier 내부 계산 타입은 포함하지 않습니다. Web Worker, 사용자 독립 최종 threshold, cooldown, control strength, Pose → game control 변환, Room/Session, 로그인/인증, DB, Redis, Phaser/게임 로직, Capacitor/모바일 네이티브 기능, WebRTC, custom ML model은 구현하지 않습니다.

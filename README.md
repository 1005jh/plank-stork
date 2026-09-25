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

## 검증 및 빌드

```sh
pnpm typecheck
pnpm build
pnpm --filter @plank-stork/controller-web test
curl http://localhost:3000/health
```

자동 테스트는 초기화/fallback, 프레임 중복 방지, 지표/좌표 갱신, Mirror 독립성, raw snapshot·STABILIZE·sequence·label별 count/dropped·reset·JSON, 음성 실패, feature 수식·null 처리·중앙값 calibration·HIP readiness·독립 knee 완성·grace 경계/고정/재보정·delta·시간 기반 smoothing·pose loss 즉시 무효화/복귀·visibility 경계값, result/camera/unmount lifecycle을 검증합니다. 추가로 Action Validation의 21.5초 경계·수집 구간·primitive snapshot·invalid frame·summary/feature drift·JSON·remote/reset/lifecycle과 Action 보정 sequence·중앙값·필수 HIP/선택 knee, 정규화 거리·NONE·confidence·hysteresis·enter/release·pose stale·Mirror·재보정/Stop/unmount를 검증합니다. STEP 4B-2는 실제 NestJS 서버를 임시 loopback 포트에서 실행해 5개 relay 이벤트와 기존 LEFT/RIGHT, health를 검증하고, Controller 요청/중복/reset/주기/cleanup 및 Mobile 화면/sync/stale/연결 만료를 기존 controller-web Vitest 환경에서 함께 검증합니다. Mobile/Server 전용 테스트 stack이나 별도 test script는 추가하지 않았습니다. STEP 4D는 Neutral-only 시작, 15초 stage 경계·MOVE/HOLD/RETURN 기록, 후보 geometry/projection·derivative, corridor/crossing/dominant-knee 수식, full snapshot·pose loss·remote·다운로드·reset/cleanup도 검증합니다. 실제 웹캠의 추적 품질과 분류 품질은 위 STEP 2·3A·3B·4A·4B 순서로 별도 확인합니다.

빌드 결과는 각 패키지의 `dist/`에 생성됩니다. 빌드한 서버는 `pnpm --filter @plank-stork/server start`로 실행합니다. 웹 빌드는 `pnpm --filter @plank-stork/controller-web preview` 또는 `pnpm --filter @plank-stork/mobile preview`로 확인할 수 있습니다.

`packages/protocol`에는 STEP 1 Socket 테스트 타입과 STEP 4B-2/4C/4D calibration·validation 요청/debug snapshot wire 타입이 있습니다. Raw Pose나 classifier 내부 계산 타입은 포함하지 않습니다. Web Worker, 사용자 독립 최종 threshold, cooldown, control strength, Pose → game control 변환, Room/Session, 로그인/인증, DB, Redis, Phaser/게임 로직, Capacitor/모바일 네이티브 기능, WebRTC, custom ML model은 구현하지 않습니다.

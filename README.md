# Plank Stork

STEP 4A: controller-web에서 raw Pose feature를 추출하고 Neutral calibration과 최근 구간 smoothing을 관찰합니다. STEP 3B의 로컬 Dataset Recorder, STEP 3A의 좌표 패널, STEP 2의 성능 지표와 STEP 1의 Socket.IO 테스트도 유지합니다. 동작 자동 판정은 아직 구현하지 않습니다.

```text
apps/
  controller-web/  Vite + React + TypeScript
  mobile/          Vite + React + TypeScript
  server/          NestJS + TypeScript
packages/
  protocol/        방향, 테스트 메시지, Socket 이벤트 공통 타입
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
- 양쪽 knee X/Y baseline은 각각 독립적으로 수집합니다. knee sample이 0개여도 HIP 완료를 막지 않으며, `CALIBRATED` 이후에도 미완료 knee만 계속 수집합니다. baseline이 없는 delta는 `null`로 유지하며 0이나 다른 값으로 대체하지 않습니다.
- UI는 **HIP / LEFT KNEE / RIGHT KNEE**별 `N / 20 READY 또는 PARTIAL`을 표시합니다. 그룹 count는 해당 feature들의 유효 count 중 최솟값입니다. 준비되지 않은 값은 최근 1초의 count이며, 오래된 sample은 계속 누적하지 않습니다. 완료된 baseline/count는 pose가 없어져도 유지됩니다.
- **PARTIAL인 knee를 완성하려면 Neutral을 계속 유지하세요.** 자동으로 Neutral 자세인지 판정하지 않습니다. HIP 완료 후 동작을 시작하면 미완료 knee에 그 동작의 값이 수집될 수 있으므로, 필요한 knee가 READY가 된 뒤 동작을 비교합니다. 다시 기준을 잡으려면 Neutral에서 Calibrate Neutral을 누릅니다.
- `poseFeatureAnalysis.ts`의 **HIP_CALIBRATION_VISIBILITY = 0.7**, **KNEE_CALIBRATION_VISIBILITY = 0.5**를 사용합니다. HIP feature에는 양쪽 hip이 각각 0.7 이상, knee feature에는 해당 hip이 0.7 이상이고 해당 knee가 0.5 이상인 sample만 넣습니다. 값/visibility가 없으면 제외합니다.
- 분리 이유: 실측에서 hip visibility는 안정적으로 **0.9~1.0** 수준이지만, knee는 카메라 각도·가림 때문에 더 낮을 수 있었습니다. Knee 0.5는 초기 실험 기준이며 **향후 추가 데이터에 따라 조정 가능한 상수**입니다. 이는 calibration/smoothing의 측정 품질 조건으로, 동작 classification threshold가 아닙니다. Raw feature와 Recorder에는 적용하지 않습니다.
- `Calibrated`는 7개 feature의 **현재 raw 값 − 해당 Neutral baseline**입니다. 어느 한쪽이 없으면 `null`입니다. `Smoothed`는 위 visibility 조건을 만족한 **최근 400ms delta의 중앙값**으로 각 feature를 독립 처리합니다.
- 분석 결과의 `smoothed`는 `{ values, validNow, lastValidAt }`입니다. `validNow`는 HIP calibration이 완료되고 현재 frame의 필수 HIP 값과 visibility가 유효할 때만 true입니다. `lastValidAt`은 마지막 유효 HIP frame의 `performance.now()` 기준 밀리초 시각이며 UI 갱신 시각이 아닙니다.
- Pose loss나 필수 HIP 값 누락/낮은 visibility가 발생한 **즉시** `validNow: false`, `values` 전체를 `null`로 반환합니다. UI는 다음 250ms 갱신에서 **STALE / -**를 표시합니다. 최초 유효 값이 아직 없으면 UNAVAILABLE입니다. HIP은 유효하지만 특정 knee만 누락/미보정이면 그 knee 값만 `null`로 가립니다. 과거 smoothing 값이 현재 사용할 수 있는 값처럼 노출되지 않습니다.
- 짧은 pose loss 동안 내부 버퍼는 유지하므로 pose가 복귀하면 smoothing을 재개합니다. 마지막 유효 HIP frame 이후 **400ms 이상** 지나면 버퍼를 비웁니다. 추론 frame 자체가 멈춰도 같은 시간 기준으로 invalid 처리하고 비우며, 복귀 후에는 새 sample로 시작합니다. baseline은 유지합니다. Raw/delta는 pose 누락 frame에서 바로 비며 frame 공급이 멈추면 1초 후 만료됩니다.
- Mirror는 baseline이나 validity를 바꾸지 않습니다. 재calibration은 이전 baseline/smoothing/유효 시각을 비우고 새로 수집합니다. Camera Stop·카메라 해제·추론 오류·unmount는 calibration, smoothing과 모든 분석 버퍼를 초기화합니다. 실제 control/classifier는 구현하지 않습니다.

**실제 테스트 순서**

1. `pnpm dev` 후 노트북의 `http://localhost:5173`에서 Start Camera를 누릅니다. 카메라는 위 STEP 3B의 발쪽→머리 방향 baseline 위치에 고정합니다.
2. Neutral plank를 유지하며 **Calibrate Neutral**을 누르고 `CALIBRATING → CALIBRATED`, HIP READY와 knee별 READY/PARTIAL을 확인합니다. Knee visibility가 낮아도 HIP 완료를 막지 않는지 확인하고, PARTIAL knee가 있으면 Neutral을 더 유지하며 count가 쌓이는지 관찰합니다. 화면상 작은 좌표 변화는 그대로 기록되며 앱이 Neutral 여부를 판정하지는 않습니다.
3. Neutral에서 delta가 기준값 근처인지 관찰합니다. **Twist left → Neutral → Twist right → Neutral → Knee left → Neutral → Knee right**를 각 3~5초 유지하며 raw/calibrated/smoothed와 hip/knee visibility를 비교합니다.
4. 특히 `deltaHipCenterX`, `deltaHipDepthDifference`, 같은 쪽 knee X/Y 변화를 비교합니다. 지표는 신호 관찰용이며 자세명/성공 판정을 출력하지 않습니다. Pose FPS, inference ms, GPU/CPU 표시도 확인합니다.
5. Mirror ON/OFF를 바꿔도 baseline이 유지되고 좌표·delta·신체 기준 좌우가 바뀌지 않는지 확인합니다. 사람 없이 있을 때 다음 UI 갱신에서 smoothed가 STALE / `-`가 되는지 확인합니다. 400ms 이내의 짧은 가림 후에는 smoothing이 재개되는지, 400ms 넘게 화면에서 벗어났다가 돌아오면 새 sample만 사용하는지 비교합니다. Knee만 가려지면 HIP은 유효하고 해당 knee 값만 `-`인지도 확인합니다.
6. calibration 도중 Stop 후 재시작하여 `NOT CALIBRATED`와 비어 있는 baseline을 확인합니다. 새 Neutral 기준을 만들고 반복합니다.
7. **Start Guided Recording**으로 33초 sequence도 실행해 `STABILIZE`에서는 Samples/Dropped가 증가하지 않는지, 완료 후 label별 dropped의 합이 전체 dropped와 같은지 확인하고 JSON을 내려받습니다. Feature 분석 여부와 관계없이 raw sample 수집은 유지됩니다.

**코드 재사용**

- `src/pose/features/extractPoseFeatures.ts`: MediaPipe와 Recorder에 의존하지 않는 pure extractor. MediaPipe 인덱스 순서의 두 배열을 받습니다.
- `calibratePoseFeatures.ts`: pure `current − baseline` 계산.
- `poseFeatureAnalysis.ts`: HIP readiness·독립 knee calibration, 1초 sample 버퍼, 400ms median buffer와 현재 유효성/pose loss 처리. `usePoseFeatures.ts`는 객체 수명과 250ms UI 갱신만 담당합니다.

기존 JSON sample도 같은 함수를 그대로 사용할 수 있습니다. `index` 순서가 변경된 외부 데이터는 먼저 MediaPipe 인덱스에 맞춰 배열을 구성합니다.

```ts
const features = extractPoseFeatures(sample.landmarks, sample.worldLandmarks);
const deltas = calibratePoseFeatures(features, neutralBaseline);
```

## 검증 및 빌드

```sh
pnpm typecheck
pnpm build
pnpm --filter @plank-stork/controller-web test
curl http://localhost:3000/health
```

자동 테스트는 초기화/fallback, 프레임 중복 방지, 지표/좌표 갱신, Mirror 독립성, raw snapshot·STABILIZE·sequence·label별 count/dropped·reset·JSON, 음성 실패, feature 수식·null 처리·중앙값 calibration·HIP readiness·독립 knee 완성·delta·시간 기반 smoothing·pose loss 즉시 무효화/복귀·visibility 경계값, result/camera/unmount lifecycle을 검증합니다. 실제 웹캠의 추적 품질과 수집 데이터는 위 STEP 2·3A·3B·4A 순서로 별도 확인합니다.

빌드 결과는 각 패키지의 `dist/`에 생성됩니다. 빌드한 서버는 `pnpm --filter @plank-stork/server start`로 실행합니다. 웹 빌드는 `pnpm --filter @plank-stork/controller-web preview` 또는 `pnpm --filter @plank-stork/mobile preview`로 확인할 수 있습니다.

`packages/protocol`에는 STEP 1의 Socket 테스트 타입만 있습니다. Web Worker, 자세/동작 판별, classification threshold, hysteresis/cooldown, control strength, Pose → Socket 변환, Room/Session, 로그인/인증, DB, Redis, Phaser/게임 로직, Capacitor/모바일 네이티브 기능, WebRTC, custom ML model은 구현하지 않습니다.

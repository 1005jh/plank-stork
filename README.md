# Plank Stork

STEP 3A: controller-web에서 플랭크 동작 중 hip/knee Pose Landmark의 원본 좌표 변화를 관찰합니다. STEP 2의 추적 성능 지표와 STEP 1의 LAN Socket.IO 테스트도 유지합니다.

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

각 Neutral 복귀 시 값이 어떻게 돌아오는지, 특정 자세에서 관절이 가려지면서 visibility가 낮아지거나 값이 끊기는지 함께 관찰합니다. Mirror 설정을 바꿔 같은 순서를 반복해도 좌표의 의미는 같습니다. Pose FPS / inference ms / GPU·CPU도 함께 확인합니다. 이 단계는 값 관찰만 수행하며 Twist/Knee 판별, threshold, smoothing, hysteresis, strength 계산, Pose → Socket 전송, 게임 로직은 추가하지 않습니다.

## 검증 및 빌드

```sh
pnpm typecheck
pnpm build
pnpm --filter @plank-stork/controller-web test
curl http://localhost:3000/health
```

자동 테스트는 초기화/fallback, 프레임 중복 방지, 지표 갱신/이동 평균, 리소스 정리, hip/knee 좌표 매핑·누락값 처리·500ms 갱신, Mirror 토글과 좌표의 독립성을 검증합니다. 실제 웹캠의 추적 품질과 좌표 변화는 위 STEP 2·3A 항목으로 별도 확인합니다.

빌드 결과는 각 패키지의 `dist/`에 생성됩니다. 빌드한 서버는 `pnpm --filter @plank-stork/server start`로 실행합니다. 웹 빌드는 `pnpm --filter @plank-stork/controller-web preview` 또는 `pnpm --filter @plank-stork/mobile preview`로 확인할 수 있습니다.

`packages/protocol`에는 STEP 1의 Socket 테스트 타입만 있습니다. Web Worker, 자세/동작 판별, smoothing/hysteresis, control strength, Pose → Socket 변환, Room/Session, 로그인/인증, DB, Redis, Phaser/게임 로직, Capacitor/모바일 네이티브 기능, WebRTC, custom ML model은 구현하지 않습니다.

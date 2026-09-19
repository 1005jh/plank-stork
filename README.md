# Plank Stork

STEP 1: Node.js 24 LTS + pnpm workspace + TypeScript 기반의 LAN Socket.IO 통신 검증입니다.

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

## 검증 및 빌드

```sh
pnpm typecheck
pnpm build
curl http://localhost:3000/health
```

빌드 결과는 각 패키지의 `dist/`에 생성됩니다. 빌드한 서버는 `pnpm --filter @plank-stork/server start`로 실행합니다. 웹 빌드는 `pnpm --filter @plank-stork/controller-web preview` 또는 `pnpm --filter @plank-stork/mobile preview`로 확인할 수 있습니다.

`packages/protocol`에는 `ControlDirection`, `TestControlEvent`, 송수신 이벤트 타입만 있습니다. Room/Session, 로그인/인증, DB, Redis, MediaPipe/Pose detection, Phaser/게임 로직, Capacitor/모바일 네이티브 기능, WebRTC는 구현하지 않습니다.

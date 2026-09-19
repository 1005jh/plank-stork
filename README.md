# Plank Stork

STEP 0: Node.js 24 LTS + pnpm workspace + TypeScript 초기 구조입니다.

```text
apps/
  controller-web/  Vite + React + TypeScript
  mobile/          Vite + React + TypeScript
  server/          NestJS + TypeScript
packages/
  protocol/        공통 타입을 위한 빈 패키지
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

| 앱 | 로컬 주소 | 표시 또는 응답 |
| --- | --- | --- |
| controller-web | http://localhost:5173 | Plank Stork Controller |
| mobile | http://localhost:5174 | Plank Stork / Mobile Game |
| server | http://localhost:3000/health | `{"status":"ok"}` |

세 앱은 `0.0.0.0`에서 listen합니다. 같은 LAN의 다른 기기에서는 `localhost` 대신 개발 컴퓨터의 LAN IP를 사용합니다(예: `http://192.168.0.10:3000/health`). 기기 간 네트워크 연결과 해당 포트의 방화벽 허용이 필요합니다. 웹 앱은 지정 포트가 이미 사용 중이면 오류를 표시합니다.

## 검증 및 빌드

```sh
pnpm typecheck
pnpm build
curl http://localhost:3000/health
```

빌드 결과는 각 패키지의 `dist/`에 생성됩니다. 빌드한 서버는 `pnpm --filter @plank-stork/server start`로 실행합니다. 웹 빌드는 `pnpm --filter @plank-stork/controller-web preview` 또는 `pnpm --filter @plank-stork/mobile preview`로 확인할 수 있습니다.

`packages/protocol`은 빈 export와 빌드 설정만 포함합니다. Socket.IO, MediaPipe, Phaser, Capacitor, DB, 인증, Room, Pose detection 및 비즈니스 타입은 아직 구현하지 않습니다.

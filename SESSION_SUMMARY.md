# PTZ Web Client 세션 요약

작성일: 2026-10-08

## 오늘 확인한 기존 프로젝트

- `C:\PTZ_VMS_Server`는 Pi RTSP H.264 수신 및 VMS RTSP/TCP relay를 구현한다.
- WebSocket 주소는 기본 `ws://127.0.0.1:5000/ws`이다.
- stream REST 주소는 `/api/v1/cameras/{cameraId}/stream`이며 현재 반환 프로토콜은 RTSP/TCP다.
- VMS의 `WebRtcGateway`는 인터페이스만 있고 실제 WebRTC 구현은 없다.
- 현재 VMS API는 PTZ 명령을 지원하지 않으며 `capabilities.ptz`는 false다.
- `C:\PTZ_Project_Qt`의 UI를 참고해 카메라 목록, 중앙 영상, 우측 PTZ 구조를 웹에 적용했다.

## 현재 웹 프로젝트

위치: `/mnt/c/PTZ_WEB_Client`

- `index.html`: 웹 UI 구조
- `style.css`: 반응형 스타일 및 화이트/다크 테마
- `app.js`: 데모 영상, WebRTC/WHEP 연결, VMS WebSocket, PTZ 입력 처리
- `server.mjs`: 정적 파일 개발 서버
- `vendor/reader.js`: MediaMTX 공식 WebRTC reader 로컬 포함
- `tests/console.spec.js`: Playwright 테스트
- `README.md`: 실행 방법, 연결 계약, 현재 서버 제한 사항

## 구현된 기능

- 화이트 모드 / 다크 모드 전환 및 localStorage 저장
- Qt 참고 레이아웃의 카메라 목록·영상·PTZ 제어 화면
- Canvas 기반 데모 영상 테스트 패턴
- WebRTC/WHEP 영상 연결 및 프레임 증가 확인 후 LIVE 표시
- 영상 정지, 재연결, 전체 화면
- PTZ 방향 버튼, 방향키, 속도 조절, 정지
- 데모 모드와 실제 연결 모드 분리
- VMS WebSocket 카메라 목록·상태 조회
- `PTZ_MOVE`, `PTZ_STOP` 클라이언트 제안 계약
- 연결 설정 저장: camera ID, WHEP 주소, WebSocket 주소
- 모바일 반응형 레이아웃
- WebRTC/VMS 오류 및 연결 종료 처리

## 실행 및 검증

```bash
cd /mnt/c/ptz_web_client
npm install
npm run dev
```

브라우저 주소: `http://localhost:5173`

검증 명령:

```bash
npm test
```

Playwright 4개 테스트가 통과했다.

## 다음 작업 후보

1. VMS 서버에 실제 WebRTC gateway 또는 WHEP endpoint 구현
2. VMS 서버에 실제 PTZ 명령 처리 및 `capabilities.ptz=true` 상태 연결
3. Pi의 실제 WebRTC/WHEP 주소와 CORS 설정 확인
4. 실제 카메라 영상을 연결한 종단 간 테스트
5. 필요하면 VMS가 제공하는 stream URI를 웹 클라이언트가 자동 조회하도록 연결

현재 웹 UI는 완료되었지만, 실제 WebRTC/PTZ 종단 간 동작은 서버 기능이 추가된 뒤 검증해야 한다.

# PTZ Studio Web Client

Qt Mini VMS 화면의 카메라 목록 / 영상 / PTZ 배치를 참고한 브라우저 클라이언트입니다.
현재 VMS 계약에 맞춰 ONVIF 카메라 등록, PTZ, 실시간 메타데이터, 탐지/상태 이력 검색, 녹화 제어·검색, 자연어 검색 화면을 제공합니다.

## 시스템 구조

```mermaid
flowchart LR
    Static["Node 정적 파일 서버 :5173"] -->|"HTML / CSS / JS"| Web["PTZ Studio · Browser"]
    Pi["Raspberry Pi Camera"] -->|RTSP :8554| VMS["Mini VMS Server"]
    VMS -->|"내장 WebRTC / ICE UDP"| Web
    Web <-->|"WebSocket :5000 / 상태·SDP 신호 교환"| VMS
    Web -->|"PTZ · 등록 · 녹화 · 탐지/채팅 검색"| VMS
    VMS -->|"ONVIF Digest :8080"| Pi
```

Node 서버는 정적 파일을 제공합니다. 영상은 VMS가 받은 H.264를 내장 libdatachannel로 WebRTC 전송합니다. Web은 Pi에 직접 연결하지 않습니다.

## 코드 구조

```mermaid
flowchart TD
    UI["index.html · 카메라/영상/PTZ/설정"] --> App["app.js · 화면·연결 상태"]
    CSS["style.css · 테마·반응형"] --> UI
    App --> Demo["Canvas 데모"]
    App --> Reader["native-webrtc.js · RTCPeerConnection"]
    Reader --> Video["video · frame 수신 확인"]
    App --> WS["WebSocket · VMS 조회·상태 알림"]
    App --> Storage["localStorage · 설정·테마"]
    App --> Workspace["vms-workspace.js · metadata / 검색 / 녹화 / 등록"]
```

```text
PTZ_WEB_Client/
├── index.html             # 화면
├── style.css              # 테마·반응형
├── app.js                 # 데모·WebRTC·VMS·PTZ 입력
├── vms-workspace.js       # 실시간 bbox·이벤트·녹화·채팅·ONVIF 등록
├── server.mjs             # Node 정적 파일 서버
├── package.json           # 실행·테스트 명령
├── package-lock.json      # dependency 잠금
├── native-webrtc.js        # VMS SDP 교환 / RTCPeerConnection
├── tests/                 # Playwright UI / mock VMS
└── playwright.config.js   # 테스트 설정
```

## 실행

`import.meta.dirname`을 지원하는 Node.js 20.11 이상에서:

```sh
npm ci
npm run dev
```

브라우저에서 http://localhost:5173 을 엽니다. 처음에는 **데모 모드**이며 Canvas 테스트 패턴만 표시합니다. 방향 버튼을 누르거나 방향키를 누르면 패턴을 이동하고, 놓으면 정지합니다. R은 데모 중앙 복귀입니다. 실제 장치에 명령을 보내지 않습니다.

상단 달/해 버튼으로 화이트 / 다크 테마를 전환합니다. 초기 테마는 화이트이며 테마 및 연결 설정은 브라우저 localStorage에 저장합니다. 좁은 화면에서는 패널을 세로로 배치합니다.

## 실제 영상

VMS WebSocket 주소를 설정하고 데모 모드를 끕니다. GET_WEB_STREAM으로 준비 상태를 조회한 후 WEBRTC_START/WEBRTC_ANSWER로 SDP를 교환합니다. native-webrtc.js의 RTCPeerConnection이 VMS와 직접 연결합니다.

기본 신호 주소는 ws://127.0.0.1:5000/ws, 미디어는 VMS ICE UDP 50000~50100입니다. PC MediaMTX 프로세스·WHEP·HTTP 8889·ICE 8189는 사용하지 않습니다. 이전 저장 설정의 Pi whepUrl도 사용하지 않습니다.

실제 영상 프레임 증가를 확인한 뒤 LIVE로 표시합니다. 정지·페이지 종료·세션 단절 때 peer를 해제하며 실패하면 다시 연결합니다. [VMS 빌드·포트·검증](../PTZ_VMS_Server/docs/LIVE_ROUTING.md)

## 실제 PTZ 연결 계약

Web 이동 요청은 VMS의 `panVelocity/tiltVelocity` 계약을 사용합니다. ONLINE 상태와 `capabilities.ptz=true`일 때 제어를 활성화하며 기본 속도는 0.3입니다.

- `GET_CAMERA_LIST`, `GET_CAMERA_STATUS`, `CAMERA_STATUS` 알림
- `version: 1`, 문자열 `requestId`, `command`, `cameraId`
- 응답 `type: "response"`, `ok`, `data` 또는 `error`

VMS가 요구하는 필드는 `panVelocity/tiltVelocity`입니다. 값은 -1..1이며 위쪽은 양의 tilt입니다.

```json
{"version":1,"requestId":"3","command":"PTZ_MOVE","cameraId":"CAM01","panVelocity":0.3,"tiltVelocity":0}
{"version":1,"requestId":"4","command":"PTZ_STOP","cameraId":"CAM01"}
{"version":1,"requestId":"5","command":"PTZ_CENTER","cameraId":"CAM01"}
```

현재 Web 동작:

- 누르는 동안 약 200ms마다 MOVE 갱신, 놓으면 STOP 요청.
- VMS의 ACCEPTED 응답과 같은 requestId의 PTZ_RESULT 알림을 구분합니다.
- PI_ACKNOWLEDGED는 ONVIF 응답이며 모터 도착 완료가 아닙니다. FAILED/SUPERSEDED도 처리해야 합니다.
- 서버의 ptzCenter capability에 따라 중앙 버튼/R 키를 PTZ_CENTER로 연결합니다.

실제 장비의 Web PTZ 구동은 검증하지 않았습니다. VMS는 PT1S timeout, 600ms 갱신 lease 및 연결 단절 시 Stop 시도를 구현했습니다.

버튼 release/cancel, 키 해제, 창 focus 이탈, 탭 숨김, 카메라/모드 전환 시 정지를 요청합니다. 소켓이 이미 끊긴 경우 정지 명령 전달은 보장되지 않습니다. 현재 VMS에는 세션 종료 및 이동 lease 만료 시 Stop 처리가 구현되어 있습니다. 웹의 응답 시간 초과 또는 이동 오류 시 제어를 비활성화합니다. 브라우저는 Qt legacy의 raw TCP `PTZ:LEFT` 프로토콜에 직접 연결하지 않습니다.

영상 연결과 PTZ 연결은 독립적입니다. 카메라 목록에서 다른 카메라를 선택하면 기존 WebRTC peer를 정지하여 이전 카메라 영상이 남지 않게 합니다.

## 검증

```sh
npx playwright install chromium
npm test
```

Playwright로 테마·데모·모바일 표시, 최신 PTZ 명령·200ms 갱신·정지·Pi 응답·중앙 복귀, nullable 메타데이터·만료·카메라 격리, 검색 필터·페이지네이션·녹화 연결, 채팅·오류·이전 응답 무시, 등록·녹화 API를 검사합니다. 모의 서버 기반 테스트이며 실제 영상·서보·장시간 시험은 사용자가 수행합니다.

## VMS 기능 화면

- **실시간 정보**: nullable topic 병합·영상 기준 bbox·2초 만료. 자동 추적 ON/OFF는 capabilities.tracking 확인 후 요청하며 실제 상태는 Pi metadata로 확인합니다. Pi 응답만으로 ON으로 표시하지 않습니다.
- **탐지 검색**: GET_DETECTIONS / GET_EVENTS, 한국 시간 범위·종류·confidence 필터, cursor 페이지네이션. Web 재생 버튼·위치 조회는 없습니다.
- **녹화**: START_RECORDING / STOP_RECORDING, GET_RECORDINGS. 완료된 segment만 조회하며 한 번에 최대 100개입니다.
- **채팅 검색**: CHAT_SEARCH, timezone=Asia/Seoul, 45초 timeout, clarify/unsupported/error/다음 페이지/결과 선택. Gemini 키는 Web에 저장하지 않습니다.
- **카메라 등록**: DISCOVER_CAMERAS → 장치 선택 → REGISTER_CAMERA. 계정은 VMS 서버 설정을 사용합니다.

**녹화 영상 재생은 Qt 전용입니다.** Web의 녹화 제어·목록 조회는 유지하고 검색 결과의 재생 버튼·offsetMs 표시를 제거했습니다. 라이브 영상은 VMS → 내장 WebRTC로 연결합니다.

[API·검증 범위](docs/VMS_INTEGRATION.md)

`SESSION_SUMMARY.md`는 작성 시점의 기록입니다. 이후 추가된 서버 PTZ 등 현재 기능은 이 README와 소스를 기준으로 확인합니다.

## 관련 프로젝트

| 저장소 | 역할 |
|---|---|
| [PTZ_VMS_Server](https://github.com/PTZ-CAMERA/PTZ_VMS_Server) | 카메라 수신·RTSP TCP/UDP 중계·녹화·ONVIF PTZ |
| [Qt_Client](https://github.com/PTZ-CAMERA/Qt_Client) | VMS를 사용하는 Qt 데스크톱 클라이언트 |
| [PTZ_WEB_Client](https://github.com/PTZ-CAMERA/PTZ_WEB_Client) | WebRTC 영상·PTZ용 브라우저 화면 |

## WebRTC 구현

브라우저 표준 RTCPeerConnection과 기존 WebSocket을 사용합니다. 이전 MediaMTX reader는 제거했습니다. 화면의 Google Fonts는 네트워크가 없으면 시스템 폰트로 표시합니다.

## 자동 녹화와 검증 범위

탐지 자동 녹화 정책은 VMS가 담당하며 설정 또는 Qt에서 선택합니다. Web에는 자동 모드 변경 체크박스를 추가하지 않았습니다. 기존 수동 녹화 시작·정지와 완료 목록·탐지 검색은 제공합니다. 녹화 재생은 Qt 전용입니다.

Playwright UI 테스트 11개 통과. 별도 합성 시험으로 실제 VMS/FFmpeg/libdatachannel/Chromium에서 1280×720 디코딩과 정지·재연결을 확인했습니다. 실제 Pi 영상의 새 WebRTC 경로, 다중 카메라 부하, 외부 NAT·장시간 시험은 아직 검증하지 않았습니다.

현재 VMS Tracking은 기존 ONVIF 계약이고 최신 Pi 소스는 독립 /camera/control JSON 추적 스위치를 추가했습니다. 최신 Pi 배포에 맞는 VMS adapter와 실제 OFF 동작 확인은 남은 작업입니다.

관련 Pi 저장소: [PTZ_CAMERA](https://github.com/PTZ-CAMERA/PTZ_CAMERA).

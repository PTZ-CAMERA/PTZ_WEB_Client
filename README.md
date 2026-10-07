# PTZ Studio Web Client

Qt Mini VMS 화면의 카메라 목록 / 영상 / PTZ 배치를 참고한 브라우저 클라이언트입니다.
ONVIF, 녹화, 추적 및 이벤트 화면은 포함하지 않습니다.

## 시스템 구조

```mermaid
flowchart LR
    Static["Node 정적 파일 서버 :5173"] -->|"HTML / CSS / JS"| Web["PTZ Studio · Browser"]
    Pi["Raspberry Pi Camera"] --> Media["별도 MediaMTX / WHEP<br/>실제 가용성 확인 필요"]
    Media -->|"WebRTC 영상"| Web
    Web <-->|"WebSocket :5000 / 상태 조회"| VMS["Mini VMS Server"]
    Web -.->|"PTZ 계약 수정 후 연결"| VMS
    VMS -->|"ONVIF Digest :8080"| Pi
    VMS -.->|"향후 VMS WebRTC Gateway"| Web
```

Node 서버는 정적 파일을 제공합니다. 현재 영상은 Pi의 별도 WebRTC 서버에 연결하며 VMS WebRTC 중계는 미구현입니다. 점선은 미완료 연동을 뜻합니다.

## 코드 구조

```mermaid
flowchart TD
    UI["index.html · 카메라/영상/PTZ/설정"] --> App["app.js · 화면·연결 상태"]
    CSS["style.css · 테마·반응형"] --> UI
    App --> Demo["Canvas 데모"]
    App --> Reader["vendor/reader.js · MediaMTX reader"]
    Reader --> Video["video · frame 수신 확인"]
    App --> WS["WebSocket · VMS 조회·상태 알림"]
    App --> Storage["localStorage · 설정·테마"]
```

```text
PTZ_WEB_Client/
├── index.html             # 화면
├── style.css              # 테마·반응형
├── app.js                 # 데모·WebRTC·VMS·PTZ 입력
├── server.mjs             # Node 정적 파일 서버
├── package.json           # 실행·테스트 명령
├── package-lock.json      # dependency 잠금
├── vendor/                # WebRTC reader 및 라이선스
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

톱니바퀴에서 카메라 ID, WebRTC WHEP 주소 및 VMS WebSocket 주소를 설정하고 데모 모드를 끕니다.

- 기본 WHEP 주소: `http://192.168.0.92:8889/cam/whep`
- 기본 VMS 주소: `ws://127.0.0.1:5000/ws`

Qt legacy 코드의 `http://192.168.0.92:8889/cam/` 재생 페이지를 바탕으로 MediaMTX WHEP 경로를 초기값으로 구성했습니다. **Pi에 MediaMTX 및 해당 WHEP 경로가 있는지는 실제 확인이 필요합니다.**

MediaMTX 공식 WebRTC reader를 로컬에 포함해 SDP/ICE, 세션 해제 및 재접속을 처리합니다. `video` 요소의 프레임 증가를 확인한 뒤에만 LIVE로 표시합니다. 데모에는 실제 해상도·프레임 통계 값을 만들지 않습니다. 영상 정지, 모드 전환 및 페이지 종료 시 reader/트랙을 해제합니다.

현재 VMS는 RTSP 중계·녹화·ONVIF PTZ를 제공하지만 **WHEP/WebRTC gateway는 구현되어 있지 않습니다.** 따라서 기본 영상 주소는 VMS를 경유하지 않고 Pi의 별도 WebRTC 서버에 접속합니다. VMS 경유 구조로 바꾸려면 VMS 측 WebRTC gateway가 필요합니다. 브라우저가 접속 가능한 주소 및 영상 서버의 CORS 설정이 필요하고 HTTPS 웹페이지에서는 HTTPS/WSS 주소를 사용해야 합니다.

공식 참고: https://mediamtx.org/docs/read/web-browsers

## 실제 PTZ 연결 계약

현재 VMS에는 PTZ가 구현되어 있지만 Web의 이동 요청 필드가 아직 서버와 맞지 않습니다. `capabilities.ptz=true`를 받으면 버튼이 활성화될 수 있으나 현재 MOVE 형식은 INVALID_VELOCITY로 거절됩니다. 기본 조회 프로토콜은 VMS를 따릅니다.

- `GET_CAMERA_LIST`, `GET_CAMERA_STATUS`, `CAMERA_STATUS` 알림
- `version: 1`, 문자열 `requestId`, `command`, `cameraId`
- 응답 `type: "response"`, `ok`, `data` 또는 `error`

현재 Web 코드가 전송하는 이동 형식:

```json
{"version":1,"requestId":"3","command":"PTZ_MOVE","cameraId":"CAM01","pan":0.5,"tilt":0}
{"version":1,"requestId":"4","command":"PTZ_STOP","cameraId":"CAM01"}
```

VMS가 요구하는 필드는 `panVelocity/tiltVelocity`입니다. 값은 -1..1이며 위쪽은 양의 tilt입니다.

```json
{"version":1,"requestId":"3","command":"PTZ_MOVE","cameraId":"CAM01","panVelocity":0.3,"tiltVelocity":0}
{"version":1,"requestId":"4","command":"PTZ_STOP","cameraId":"CAM01"}
{"version":1,"requestId":"5","command":"PTZ_CENTER","cameraId":"CAM01"}
```

후속 Web 수정 사항:

- 이동 필드를 변경하고 누르는 동안 약 200ms마다 MOVE 갱신. 현재는 누름 시작 시 한 번만 전송합니다.
- VMS의 ACCEPTED 응답과 같은 requestId의 PTZ_RESULT 알림을 구분합니다.
- PI_ACKNOWLEDGED는 ONVIF 응답이며 모터 도착 완료가 아닙니다. FAILED/SUPERSEDED도 처리해야 합니다.
- 서버 capability에 따라 PTZ_CENTER 연결. 현재 실제 모드의 중앙 버튼은 비활성화됩니다.

실제 장비의 Web PTZ 구동은 검증하지 않았습니다. VMS는 PT1S timeout, 600ms 갱신 lease 및 연결 단절 시 Stop 시도를 구현했습니다.

버튼 release/cancel, 키 해제, 창 focus 이탈, 탭 숨김, 카메라/모드 전환 시 정지를 요청합니다. 소켓이 이미 끊긴 경우 정지 명령 전달은 보장되지 않습니다. 현재 VMS에는 세션 종료 및 이동 lease 만료 시 Stop 처리가 구현되어 있습니다. 웹의 응답 시간 초과 또는 이동 오류 시 제어를 비활성화합니다. 브라우저는 Qt legacy의 raw TCP `PTZ:LEFT` 프로토콜에 직접 연결하지 않습니다.

영상 연결과 PTZ 연결은 독립적입니다. 각 카메라의 WHEP 주소는 설정에서 지정해야 합니다. 카메라 목록에서 다른 카메라를 선택하면 기존 영상을 정지하여 잘못된 카메라 영상이 남지 않게 합니다.

## 검증

```sh
npx playwright install chromium
npm test
```

Playwright로 테마 저장, 데모 이동 및 정지, 미지원 PTZ 비활성화, 모의 서버 PTZ 명령 및 소켓 종료, 설정 저장과 모바일 overflow를 확인합니다. 모의 PTZ 서버는 웹의 기존 `pan` / `tilt` 형식을 사용합니다. 따라서 최신 VMS 계약 및 실제 영상·장비 연결 검증과 별개입니다.

`SESSION_SUMMARY.md`는 작성 시점의 기록입니다. 이후 추가된 서버 PTZ 등 현재 기능은 이 README와 소스를 기준으로 확인합니다.

## 관련 프로젝트

| 저장소 | 역할 |
|---|---|
| [PTZ_VMS_Server](https://github.com/PTZ-CAMERA/PTZ_VMS_Server) | 카메라 수신·RTSP TCP/UDP 중계·녹화·ONVIF PTZ |
| [Qt_Client](https://github.com/PTZ-CAMERA/Qt_Client) | VMS를 사용하는 Qt 데스크톱 클라이언트 |
| [PTZ_WEB_Client](https://github.com/PTZ-CAMERA/PTZ_WEB_Client) | WebRTC 영상·PTZ용 브라우저 화면 |

## 외부 코드

`vendor/reader.js`: bluenviron/mediamtx 공식 저장소에서 2026-10-07에 가져온 WebRTC reader. 라이선스는 `vendor/MEDIAMTX-LICENSE`에 보존했습니다. 외부 CDN 없이 포함합니다. 화면의 웹 폰트는 Google Fonts를 사용하며 네트워크가 없으면 시스템 폰트로 표시합니다.

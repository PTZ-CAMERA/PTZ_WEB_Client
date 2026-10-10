# VMS Web 연동 (2026-10-10)

기존 vanilla JavaScript와 WebSocket을 재사용한다. 브라우저 RTCPeerConnection과 VMS 내장 libdatachannel을 연결한다. PC MediaMTX reader와 게이트웨이는 제거했다.

## 주소와 기본 실행

- Web: `npm run dev` → `http://localhost:5173` (첫 화면은 데모).
- VMS: `ws://127.0.0.1:5000/ws`. 설정에서 주소 변경 후 데모를 끈다.
- 영상: GET_WEB_STREAM 후 WEBRTC_START/WEBRTC_ANSWER로 VMS와 직접 연결. Pi 직접 주소·저장된 whepUrl은 사용하지 않는다.
- 브라우저 다른 PC 사용 시 localhost를 VMS PC 주소로 변경하고 서버 bind/네트워크 접근을 별도로 구성한다.

## 요청 계약

모든 요청은 `{version:1, requestId:string, command, cameraId, ...fields}`이다. GET_CAMERA_LIST는 cameraId를 보내지 않는다. 서버 계정·Gemini 키는 브라우저에 입력하거나 저장하지 않는다.

| 기능 | command / 필드 |
|---|---|
| 카메라 상태 | GET_CAMERA_LIST / GET_CAMERA_STATUS, CAMERA_STATUS 알림 |
| 카메라 등록 | DISCOVER_CAMERAS, REGISTER_CAMERA: deviceServiceUrl, profileToken |
| 이동 | PTZ_MOVE: panVelocity, tiltVelocity (-1..1), 기본 0.3, 200ms 갱신 |
| 정지·중앙 | PTZ_STOP / PTZ_CENTER |
| 상태 이력 | GET_EVENTS: fromMs, toMs, types, minConfidence=0, limit=50, cursor |
| 탐지 샘플 | GET_DETECTIONS: fromMs, toMs, minConfidence, limit=50, cursor |
| Web 라이브 | GET_WEB_STREAM: cameraId → source=vms / ready / uri |
| 녹화 | START_RECORDING / STOP_RECORDING / GET_RECORDINGS: fromMs,toMs,limit=100 |
| 자연어 검색 | CHAT_SEARCH: message, timezone=Asia/Seoul (timeout 45초) |

시각 입력은 브라우저 OS 시간대에 관계없이 한국 시간으로 해석해 UTC ms로 전송한다. 종료 입력의 마지막 1초를 포함하는 exclusive toMs를 사용한다. 응답의 null confidence/상태는 ‘—’로 표시한다.

## 안전한 화면 갱신

- 카메라 전환·연결 해제·데모 전환 시 metadata, 검색 결과, 커서, 채팅을 초기화한다.
- 카메라 ID·연결 context·작업 token으로 이전 응답을 무시한다. 검색 조건 변경도 이전 검색 응답을 무효화한다.
- 독립 topic의 null은 다른 topic의 정보를 지우지 않는다. detection topic의 누락 bbox/confidence는 이전 값을 재사용하지 않는다.
- 64bit 프레임 ID 문자열은 숫자로 변환하지 않는다. 모터 각도는 측정값이 아닌 명령값으로 표시한다.
- 캡처 UTC와 영상 PTS의 정확한 동기화는 아직 없다. overlay는 최신 수신 정보이다. 녹화 위치·재생 UI는 Qt 전용이다.
- 활동 로그와 검색/채팅 응답은 textContent로 표시한다. 모델 응답 HTML을 실행하지 않는다.
- PTZ 접수(ACCEPTED)와 Pi 결과(PI_ACKNOWLEDGED/FAILED/SUPERSEDED)를 requestId로 연결한다. 접수만 받은 상태로 모터 도착을 표시하지 않는다.
- 포인터 해제/취소, 창 focus 이탈, 탭 숨김, 카메라 전환, 소켓 종료 시 이동 갱신을 중지하고 가능하면 Stop을 전송한다. 단절 시 최종 정지는 VMS의 lease/ONVIF timeout 처리도 필요하다.

## 남은 서버 기능

사용자 요청으로 Web 녹화 재생·위치 조회를 제외했다. 녹화 시작·정지·목록은 유지한다. Web 영상은 VMS 내장 libdatachannel → WebRTC로 구현했다. [실행 방법](../../PTZ_VMS_Server/docs/LIVE_ROUTING.md).

## 검증

Playwright 10개: 기존 화면·PTZ·메타데이터·검색·채팅·등록·녹화, 재생 UI 제거, VMS 영상 주소·이전 Pi 주소 무시를 검사한다. 별도 합성 시험에서는 실제 VMS 내부 WebRTC·Chromium으로 1280×720 WebRTC 프레임을 확인했다. 실물 시험은 사용자 담당이다.

실행 중인 VMS에도 브라우저를 연결해 CAM01 ONLINE/Events SUBSCRIBED/capabilities를 확인했다. GET_DETECTIONS, GET_EVENTS, GET_RECORDINGS 요청이 정상 응답했고 조회 범위에서는 모두 0개였다. JavaScript 오류는 없었다. 이 확인에서는 WHEP 연결을 차단하고 PTZ·녹화·Gemini 요청을 실행하지 않았다. 따라서 실물 영상 재생이나 실제 탐지 결과의 존재를 검증한 것은 아니다.

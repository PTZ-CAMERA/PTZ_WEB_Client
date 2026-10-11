# Web 디렉토리와 코드 읽는 순서

```text
PTZ_WEB_Client/
├── index.html             # 화면과 script 로드 순서
├── assets/
│   ├── js/
│   │   ├── app.js          # 소켓·카메라·입력·영상 조립
│   │   ├── native-webrtc.js # VMS SDP 교환·RTCPeerConnection 수명
│   │   └── vms-workspace.js # metadata·검색·녹화·등록 UI
│   └── css/style.css       # 테마·반응형
├── server.mjs             # 정적 파일 제공. VMS API 서버가 아니다
├── tests/                 # Playwright·실제 native WebRTC reader 검사
└── docs/
```

브라우저 URL·포트·JSON 계약·화면 동작은 유지한다. index.html은 assets 경로를 사용하고 정적 서버는 이전 /app.js, /native-webrtc.js, /vms-workspace.js, /style.css 주소도 같은 파일로 매핑한다. 기존 npm 실행·테스트 위치는 그대로다.

## 읽는 순서와 수명

1. index.html: native-webrtc → app → workspace 순서로 로드한다.
2. app.js: WS 요청·선택 카메라·contextVersion·영상 generation을 확인한다.
3. native-webrtc.js: offer/answer·ICE 수집·정지·프레임 확인 타이머를 확인한다.
4. vms-workspace.js: 검색별 token과 epoch로 이전 응답을 무효화한다.

ICE 연결과 영상 재생은 다르며 decoded frame 증가 이후에만 LIVE다. 검색 데이터는 textContent/텍스트 노드로 표시하고 서버가 보낸 문자열을 HTML로 실행하지 않는다. Gemini·DB·ONVIF는 VMS 책임이다. CSS·JS 위치만 바꾸며 새로운 bundler/framework나 runtime dependency를 추가하지 않는다.

[실행·기능·검증](../README.md) · [API 계약](VMS_INTEGRATION.md)

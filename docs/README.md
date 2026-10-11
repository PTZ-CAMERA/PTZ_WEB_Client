# Web 문서 안내

- [실행·기능·검증](../README.md)
- [전체 시스템 구조](SYSTEM_ARCHITECTURE.md)
- [코드 구조와 수명](CODE_GUIDE.md)
- [VMS API 연동](VMS_INTEGRATION.md)

`index.html`은 화면, `assets/`는 브라우저 코드, `server.mjs`는 정적 서버,
`tests/`는 모의 VMS 기반 검증이다. 기존 asset URL 호환 매핑과 실행 경로를 유지한다.
`node_modules/`, `test-results/`, `playwright-report/`는 생성물이며 Git에서 제외한다.
[SESSION_SUMMARY](../SESSION_SUMMARY.md)는 작성 당시 상태이며 현재 기능 목록이 아니다.

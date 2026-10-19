# Active Context

## Current Focus

- 프로젝트 이름 VideoStudioOM, 위치 E:\Claude\VideoStudioOM 로 이동 완료. 구현 계획 작성(docs/plan.md)
- 결정(2026-10-19): 줄거리/시나리오/대본은 LLM 텍스트 호출(MusicAutomation 방식), 에이전트 파이프라인 비채택(P-01 개정). 근거 docs/spike-agent.md(python 접두사 허용=임의 실행). design/plan/README/RULES/CLAUDE 반영 완료
- 정본은 artifacts/scene_plan.json, script.json (OpenMontage 체크포인트는 만들지 않음, 파이프라인 지정 시 앞 단계 요구로 거부됨)
- Wave 2 진행 중: 1.1(Vite+React+TS, 서버 뼈대, dev 러너, start/stop.bat 개선)과 1.2(접근 보호: Host/Origin/Sec-Fetch-Site 검사 + 쓰기 토큰, 테스트 6개) 완료. start.bat prod/dev 실행과 stop.bat 확인함
- OpenMontage 로컬 변경은 브랜치 videostudio-local 커밋 57c1382에 보관, 기록은 docs/openmontage-changes.md
- 1.3(shared/settings.mjs 스키마·검증·프로젝트 우선 해석, data/settings.json, /api/settings), 1.4(server/paths.mjs 경로 검증, server/projects.mjs 목록/생성/읽기/쓰기, junction 차단), 1.5(저장 시 수정 시각 비교, 충돌 409, 같은 파일 동시 저장은 직렬화) 완료. 테스트 25개 통과, 실제 OpenMontage 프로젝트 2개가 목록에 보임
- 프로젝트 설정 API: PUT /api/projects/:id/settings {set, unset}. 시작 페이지 항목은 shared START_PAGE_FIELDS(6개)
- 1.6(server/events.mjs SSE + fs.watch 디바운스), 미디어 스트리밍(Range, /api/projects/:id/media), 1.7 UI 틀(좌측 아이콘 6개, 상단 단계 표시·LLM 빠른 선택, 하단 메시지 줄, 라이트/다크), 1.8 프로젝트 목록·라이브러리(영상 재생) 완료. 브라우저에서 확인(설정 저장이 data/settings.json에 남음, 잘못된 값은 거부)
- Wave 2(P1) 완료. 다음: Wave 3(P2) 2.1 bridge/om_tool.py, 2.2 GPU 락, 2.3 설정 화면 확장과 2.3b 시작 페이지, 2.4 h3_local_video 확장. 아직 커밋 안 함(사용자 요청)

<!--
규칙:
- 최근 작업 10개만 유지 (오래된 항목은 삭제)
- 완료된 Wave의 내용은 CACHE.md로 이동 후 삭제
- 이 파일은 "지금 무엇을 하고 있나" 스냅샷, 히스토리 아님
-->

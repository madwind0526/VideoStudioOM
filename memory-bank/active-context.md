# Active Context

## Current Focus

- 구조 변경(2026-10-20): 줄거리/시나리오/대본/이미지/오디오/동영상은 프로젝트 구성품. 메뉴 = 만들기 + / 프로젝트(가운데 세로 카드 목록 → 오른쪽 위 가로 탭 → 본 화면 확인·수정, 상단 작업 단계 표시는 삭제) / 라이브러리(완성 동영상만) / 좋아요 / 최근 프로젝트 / 설정(맨 아래). 주소 #/projects/<id>/<구성품>
- P2 진행: bridge/om_tool.py(GPU 락), /api/jobs(한 번에 하나), h3_local_video FL2V·S2V 확장(OpenMontage 브랜치 videostudio-local 768589b), 화면 버튼으로 이미지 생성 확인. 남은 것: R2V, 영상 생성/S2V를 화면에서 끝까지 확인, 오디오 고정 시 클립이 짧아지는 원인
- 결정: 줄거리/시나리오/대본은 LLM 텍스트 호출(P-01), 에이전트 비채택(docs/spike-agent.md). LLM 선택은 설정에서만. 정본은 artifacts/scene_plan.json, script.json (장면의 script_section_id로 대본 구간과 연결)
- UI 기준은 SongYUE2(색 #171817/#8ed8c8, 사이드바 188px). 브랜드 "VideoStudioOM by madwind". 영상 크기는 프리셋 11개 + 직접 입력
- 테스트 53개 통과. 마지막 커밋 ddc63ce 이후 변경은 아직 커밋 안 함

<!--
규칙:
- 최근 작업 10개만 유지 (오래된 항목은 삭제)
- 완료된 Wave의 내용은 CACHE.md로 이동 후 삭제
- 이 파일은 "지금 무엇을 하고 있나" 스냅샷, 히스토리 아님
-->

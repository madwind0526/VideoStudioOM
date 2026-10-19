# Active Context

## Current Focus

- Wave 3(P2) 진행 중. 완료: bridge/om_tool.py(GPU 락, stdout 오염 방지), 작업 큐 /api/jobs(한 번에 하나, 취소, 재시작 복구), 설정 화면(SongYUE2 스타일, LLM 타일 선택, 입력/출력/프로젝트 폴더), 시작 화면(메뉴|작업 설정 패널|프로젝트 카드). 실제 Krea 이미지 생성 확인(15초)
- 남은 P2: 2.4 OpenMontage h3_local_video 확장(FL2V, R2V, 오디오 고정, 비율 보정, 새 파일 우선 + videostudio-local 브랜치 + docs/openmontage-changes.md 기록), 작업 시험 화면(이미지/I2V/FL2V/립싱크 버튼)
- 결정: 줄거리/시나리오/대본은 LLM 텍스트 호출(P-01), 에이전트 비채택(docs/spike-agent.md). LLM 선택은 설정 화면에서만. 정본은 artifacts/scene_plan.json, script.json
- UI 기준은 SongYUE2(색 #171817/#8ed8c8, 사이드바 188px). 브랜드 "VideoStudioOM by madwind". 카드: 썸네일 재생, 정보 팝업(줄거리/시나리오/대본/이미지/동영상), 즐겨찾기(studio/meta.json)
- 테스트 48개 통과. 마지막 커밋 39811a0 이후 변경은 아직 커밋 안 함

<!--
규칙:
- 최근 작업 10개만 유지 (오래된 항목은 삭제)
- 완료된 Wave의 내용은 CACHE.md로 이동 후 삭제
- 이 파일은 "지금 무엇을 하고 있나" 스냅샷, 히스토리 아님
-->

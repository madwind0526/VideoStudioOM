# Active Context

## Current Focus

- 구조: 메뉴 = 만들기 + / 프로젝트(가운데 세로 카드 목록 → 위 가로 탭 → 본 화면) / 라이브러리(완성 동영상만) / 좋아요 / 최근 프로젝트 / 설정. 주소 #/projects/<id>/<구성품>
- 미디어 화면(이미지/오디오/동영상): "새로 만들기"(한 건), "전체 만들기"(장면/대본 구간/이미지 쌍으로 없는 것만 차례로), "이어 붙이기"(오디오 → narration.wav, 영상 → renders/final.mp4), 항목마다 다시 만들기·지우기 아이콘. 만든 방법은 studio/assets.json에 기록
- 고급 설정(설정 > 고급): 워크플로 파일(탐색기로 선택)·모델·LoRA·업스케일러. 비면 기본 도구/모델, 값이 있으면 OpenMontage `comfyui_workflow`(2c1f93c). 서버는 server/engine.mjs
- 등장인물 탭(대본 다음): 설정집 studio/bible.json(화풍/인물/장소), 인물마다 캐릭터 시트(assets/images/sheet-<id>.png, 설정 > 고급에 시트 워크플로 칸), 영상은 시트를 참조(R2V). 새로 만들기 "자동" 모드. 다음 후보: OpenMontage 의존을 걷고 Node ComfyUI 클라이언트로 옮기기
- 프롬프트 만들기: server/prompts/ + prompt-maker.mjs(Krea 공식 expansion, H3 공식 가이드), 전체 만들기가 장면별 프롬프트를 LLM으로 먼저 만든다. 대본 구간 소리 종류(대화 TTS/효과음·연주곡·보컬 SongYUE2)는 studio/audio_kinds.json. 설명은 docs/prompting.md
- R2V(참조 영상 + 이미지로 얼굴/옷 교체)는 `h3_reference_video`로 실측 확인(3초 76초 소요). UI 종류로는 아직 노출 안 함
- 결정: 줄거리/시나리오/대본은 LLM 텍스트 호출(P-01). LLM 선택은 설정에서만. 정본은 artifacts/scene_plan.json, script.json
- 테스트 59개 통과. 알려진 문제: S2V 결과가 요청보다 짧음(117 vs 124 프레임), 모델·LoRA 덮어쓰기는 외부 워크플로에만 적용, 노드 자동 설치 없음

<!--
규칙:
- 최근 작업 10개만 유지 (오래된 항목은 삭제)
- 완료된 Wave의 내용은 CACHE.md로 이동 후 삭제
- 이 파일은 "지금 무엇을 하고 있나" 스냅샷, 히스토리 아님
-->

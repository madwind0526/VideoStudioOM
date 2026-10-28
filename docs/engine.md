# 엔진 (server/engine)

2026-10-20에 OpenMontage와 Python 브릿지(`bridge/om_tool.py`)를 걷어내고, 이미지·영상·음성·음악 생성을 Node 백엔드가 직접 한다. OpenMontage에서 만든 도구들은 모두 ComfyUI/SongYUE2를 부르는 얇은 래퍼였다.

| 파일 | 역할 |
|---|---|
| `comfy.mjs` | ComfyUI 클라이언트: 파일 올리기, 그래프 제출, 진행률(웹소켓), 완료 대기(/history), 다운로드, 취소(/interrupt), 바쁨 확인(/queue). 거부된 그래프는 "노드 4 UNETLoader: Value not in list (unet_name=...)"처럼 읽을 수 있는 문장으로 바꾼다 |
| `graphs.mjs` | 내장 그래프: Krea 2 Turbo, H3 I2V/FL2V/S2V, H3 R2V(참조 그림 9장, 영상, 오디오), RTX 2패스 확대. 이 PC에서 확인된 값 그대로 |
| `workflow-patch.mjs` | 사용자 워크플로(API 형식)에 프롬프트·크기·시드·파일·모델·LoRA를 채우는 규칙, 없는 노드/모델 찾기 |
| `services.mjs` | 꺼져 있는 SongYUE2, ComfyUI(8190), Rev0 ComfyUI(8188, 참조 영상과 RTX 확대)를 켜고 응답할 때까지 기다림 (경로는 설정의 연결 항목) |
| `tools.mjs` | 도구 7개: `comfyui_krea_image`, `h3_local_video`, `h3_reference_video`, `comfyui_workflow`, `qwen3_tts`, `songyue_music`, `songyue_sfx`. 입력 검사, 허용 폴더 밖 경로 거부, 취소 지원 |

## 작업 흐름
`POST /api/jobs` → `server/engine.mjs`(`applyEngine`: 설정의 워크플로·모델·LoRA를 호출에 반영) → `jobs.mjs`(한 번에 하나, 배치, 이어하기) → `tools.mjs`(`runTool`) → ComfyUI/SongYUE2.

- 취소: `AbortController` → ComfyUI `/interrupt` + 자식 프로세스(TTS) 종료. 실측: 12초에 취소하고 바로 다음 작업이 10초에 끝남.
- 진행률: 샘플러 단계(`progress` 메시지)를 작업의 `progress {value,max}`로 SSE에 실어 화면에 %로 보여 준다.
- GPU: ComfyUI `/queue`에 다른 실행이 있으면 시작하지 않는다(409). SongYUE2가 곡을 만드는 중이어도 시작하지 않는다.

## 설정(연결)
`connections`: ComfyUI(8190) 주소, Rev0 ComfyUI(8188) 주소·폴더(RTX 확대 결과는 `<폴더>/ComfyUI/output`에서 읽는다; 2026-10-27에 RTX 전용 주소·폴더·프로그램 폴더·결과 폴더 설정은 없앴다), SongYUE2 주소·폴더, ffmpeg 경로. 프로젝트 폴더의 기본 위치는 앱 폴더의 `projects/`이다(2026-10-27에 `OpenMontage\projects`에서 옮기고 `openmontageDir` 설정은 없앴다).

## 실측 (RTX 5070 12GB, 736×416)
Krea 이미지 12초, FL2V 3초 37초, R2V(그림 3장) 43초, S2V 45초, FL2V + RTX 확대(1920×1088) 90초, 효과음 7초, 한국어 음성 5초.

## OpenMontage에 남은 것
`E:\Claude\OpenMontage`는 더 이상 실행에도 데이터에도 쓰이지 않는다. 그 안의 `skills/`는 줄거리·시나리오 프롬프트를 만들 때 참고한 자료이고, `projects/`는 비어 있다(프로젝트는 VideoStudioOM의 `projects/`로 옮김). OpenMontage의 Backlot 보드로 새 위치를 보려면 `OPENMONTAGE_PROJECTS_DIR=E:\Claude\VideoStudioOM\projects`를 지정해 실행한다. 로컬 브랜치 `videostudio-local`과 `docs/openmontage-changes.md`는 기록으로 남긴다.

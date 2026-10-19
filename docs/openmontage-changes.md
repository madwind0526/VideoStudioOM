# OpenMontage 로컬 변경 기록

대상: `E:\Claude\OpenMontage`, 브랜치 `videostudio-local` (기준 `main` c806645, 원격 `calesthio/OpenMontage`).
기준: 새 파일 우선, 핵심(`lib/checkpoint.py`, `pipeline_defs/`)은 수정하지 않음, 작은 커밋. 업스트림을 받을 때는 이 브랜치에서 리베이스한다.

| 날짜 | 커밋 | 파일 | 이유 | 크기 |
|---|---|---|---|---|
| 2026-10-19 | 57c1382 | `CLAUDE.md`, `open.bat`, `stop-services.bat` | 로컬 도구 지침과 실행/중지 스크립트(기존 작업) | 소 |
| 2026-10-19 | 57c1382 | `tools/_comfyui/local_stack.py`, `tools/graphics/comfyui_krea_image.py`, `tools/video/h3_local_video.py`, `tools/audio/qwen3_tts.py`, `tools/audio/songyue_music.py` | 무료 로컬 도구(Krea, H3, Qwen3-TTS, SongYUE2) 추가(기존 작업, 새 파일) | 중 |

`backlot/__init__.py`는 작업 트리에 줄바꿈(CRLF)만 다른 상태여서 커밋하지 않았다.

예정(`docs/plan.md` 2.4): `h3_local_video` 확장(FL2V, R2V, 오디오 고정, 첫 프레임 비율 보정), GPU 락.

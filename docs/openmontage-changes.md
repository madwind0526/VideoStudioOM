# OpenMontage 로컬 변경 기록

대상: `E:\Claude\OpenMontage`, 브랜치 `videostudio-local` (기준 `main` c806645, 원격 `calesthio/OpenMontage`).
기준: 새 파일 우선, 핵심(`lib/checkpoint.py`, `pipeline_defs/`)은 수정하지 않음, 작은 커밋. 업스트림을 받을 때는 이 브랜치에서 리베이스한다.

| 날짜 | 커밋 | 파일 | 이유 | 크기 |
|---|---|---|---|---|
| 2026-10-19 | 57c1382 | `CLAUDE.md`, `open.bat`, `stop-services.bat` | 로컬 도구 지침과 실행/중지 스크립트(기존 작업) | 소 |
| 2026-10-19 | 57c1382 | `tools/_comfyui/local_stack.py`, `tools/graphics/comfyui_krea_image.py`, `tools/video/h3_local_video.py`, `tools/audio/qwen3_tts.py`, `tools/audio/songyue_music.py` | 무료 로컬 도구(Krea, H3, Qwen3-TTS, SongYUE2) 추가(기존 작업, 새 파일) | 중 |
| 2026-10-20 | 768589b | `tools/video/h3_local_video.py` | FL2V(`last_frame_path`), 오디오 고정 S2V(Sound2Video, 립싱크)(`audio_path`, `mux_audio`), 입력 프레임 비율 보정(`fit_images`) | 중(+67/-9줄, 기존 파일 한 곳) |
| 2026-10-20 | 2c1f93c | `tools/_comfyui/workflow_patch.py`, `tools/video/comfyui_workflow.py` (새 파일) | 사용자가 고른 ComfyUI API 형식 워크플로를 그대로 실행: 프롬프트/크기/시드/입력 파일을 노드 종류로 찾아 채우고, 모델 이름·LoRA·업스케일 모델을 덮어쓴다. 없는 노드/모델은 이름을 알려 주며 중단 | 중(새 파일 약 330줄) |
| 2026-10-20 | 80dc980 | `tools/video/h3_reference_video.py` (새 파일) | R2V와 참조 영상 수정(v2v): 코어 노드 `MiniMaxH3ReferenceToVideo`에 참조 이미지/영상/오디오를 넣는다 | 중(새 파일 약 230줄, 기존 파일은 그대로) |

`backlot/__init__.py`는 작업 트리에 줄바꿈(CRLF)만 다른 상태여서 커밋하지 않았다.

실측(RTX 5070 12GB, ComfyUI 0.39.1, 736×416 확대 없음): FL2V 57초(마지막 프레임이 입력 이미지와 일치, 중간은 자연스럽게 전환), S2V 56초(입 모양이 음성에 따라 계속 바뀜). 얼굴 이미지는 Krea 25초, 한국어 음성은 Qwen3-TTS 5초(33글자 → 5.04초, 초당 약 6.5글자).

알려진 사항
- 오디오를 고정하면 결과가 요청보다 짧게 나온다(요청 5.04초 → 117프레임 4.875초, 오디오 없이는 124프레임). 원인은 확인하지 않았다. P5에서 클립 길이를 보정해야 한다.
- R2V와 영상 수정은 `h3_reference_video`로 지원한다(사용자의 ComfyUI 워크플로 `Documents/ComfyUI/user/default/workflows/MiniMaxH3/`와 공식 템플릿 `video_minimax_h3_r2v`를 분석해 만듦). 가변 입력의 API 이름은 `ref_images.ref_image_N`, `ref_videos.ref_video_0`, `ref_video_audios.ref_video_audio_0`, `ref_audios.ref_audio_0`이다. 모델은 이 PC에 있는 `10Eros_Max_h3_TURBO_ref2va_beta2_int8_convrot`(터보, euler 8단계, 기본)와 공식 `minimax_h3_ref2va_pruned_int8_convrot`(20단계). 실측: 이미지 2장 R2V 66초(1번 그림의 벌이 2번 그림의 벌집 장면으로 이어짐), 5초 참조 영상 수정 126초(구도와 움직임은 원본을 따르고 수채화 스타일 변화는 약했음).
- 사용자의 Deno 워크플로(`Deno minimax 8 step turbo R2V`)는 커스텀 노드와 `MiniMax-H3-Ref2VA-Acc-8Step` LoRA가 필요한데, 이 PC의 `D:\sd-lib`에는 그 LoRA가 없어 쓰지 않았다. 터보 R2V LoRA(`minimax_h3_ref2v_turbo_4step`)도 없다. 사용자의 v2v 워크플로는 2단계 샘플링(시그마 이동 + 잠재 업스케일러)을 쓰는데, 지금 도구는 1단계다.

예정: GPU 락은 VideoStudioOM의 `bridge/om_tool.py`에서 처리하므로 OpenMontage 쪽 수정은 필요 없다.

### R2V subject swap check (verified)
`h3_reference_video` with `reference_video_path` + one `reference_image_paths` entry and the prompt
"Replace the woman in <Video 1> with the man from <Picture 1>. Keep the same motion, camera and background."
(736x416, 3 s, turbo, no upscale, 76 s): the person (face, beard, glasses, blue coat) came from the image;
pose, camera and park background stayed as in the reference video. Face swap and clothes swap work this way.

### comfyui_workflow (verified)
- Krea 그래프를 API JSON으로 저장해 실행: 15초, `models.diffusion` 덮어쓰기 적용. 없는 노드(`NoSuchNodeXYZ`)는 "ComfyUI에 설치되지 않은 노드가 필요합니다: NoSuchNodeXYZ"로 중단, UI 형식 JSON은 "Save (API Format)" 안내.
- 채우는 규칙: 긍정 프롬프트 = 샘플러의 positive 입력으로 이어지는 텍스트 노드, 시드 = `seed`/`noise_seed`, 크기·길이 = Latent 계열 노드의 `width/height/length`, 입력 파일 = LoadImage/LoadVideo/LoadAudio를 노드 번호 순서로, LoRA = diffusion 로더 뒤에 `LoraLoaderModelOnly`를 이어 붙임.
- 한계: 자동 설치는 하지 않는다(어떤 커스텀 노드가 필요한지 이름만 알려 줌). 모델·LoRA 덮어쓰기는 워크플로를 지정했을 때만 적용되고, 기본 도구(Krea, H3)는 코드에 고정된 모델을 쓴다.

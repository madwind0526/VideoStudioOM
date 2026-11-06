# Rules

> 이 프로젝트의 규칙과 컨벤션. 모든 sub-agent가 반드시 따라야 함.

## G-01: 코드 주석은 영어만 사용 (MANDATORY)

**규칙:** 모든 코드 주석(`//`, `/* */`, `///`)은 영어로 작성. 한글 주석 금지.
**이유:** 소스 파일 내 한글은 인코딩 문제 및 빌드 오류를 유발할 수 있음.
**적용 시점:** 코드 작성 또는 수정 시 항상. UI 텍스트(사용자에게 보이는 문자열)는 한국어 유지.

<!-- 예시 형식:

## [규칙 이름]

**규칙:** [한 줄 요약]
**이유:** [왜 이 규칙이 필요한가]
**적용 시점:** [언제 이 규칙이 발동되나]

-->

## P-01: 창작 텍스트는 LLM 텍스트 호출로, OpenMontage는 제작 도구로 (MANDATORY)

**규칙:** 줄거리, 시나리오(scene_plan), 대본(script)은 MusicAutomation 방식의 LLM 텍스트 호출(claude-cli → codex-cli → opencode-cli → ollama 체인)로 만든다. 단계마다 사람이 검토/수정/승인하고, 수정본이 다음 단계의 입력이 된다. OpenMontage는 이미지/영상/음성/음악/합성 도구로만 쓴다. 도구 권한을 가진 에이전트가 파이프라인을 돌리게 하지 않는다.
**이유:** 사용자 결정(2026-10-19, 개정). 이전 규칙(에이전트 CLI가 OpenMontage 파이프라인을 수행)은 스파이크(docs/spike-agent.md)에서 허용 목록으로 임의 코드 실행을 막지 못하는 것이 확인되어 폐기. 텍스트 호출은 권한이 필요 없고 MusicAutomation에서 검증됨.
**적용 시점:** 시나리오/스토리보드/영상 단계를 구현할 때 항상.

## P-02: LLM 호출 규칙

**규칙:** 텍스트 호출은 중립 디렉터리(os.tmpdir())에서 실행하고 프롬프트는 stdin으로 전달한다. 모델 지시는 영어로, 생성 결과(줄거리/대본)는 한국어로 요청한다. 구조화 출력(scene_plan, script)은 OpenMontage 스키마로 검증하고, 실패하면 이유를 알려 최대 3번 다시 요청한다.
**이유:** 전역 KB `claude-cli-subprocess-context-bleed.md` - 프로젝트 CLAUDE.md의 페르소나가 답변을 오염시킴. MusicAutomation에서 LLM이 필드를 비우거나 형식을 어기는 일이 확인됨(금지 규칙은 LLM이 지키지 않으므로 검증과 재요청으로 처리).

## P-03: Node가 Python을 spawn할 때

**규칙:** `PYTHONUTF8=1`, `PYTHONIOENCODING=utf-8`을 항상 설정한다.
**이유:** 전역 KB `python-subprocess-cp949-crash.md` - 한글 로케일에서 조용히 실패(종료코드 0).

## P-04: 포트와 프로세스

**규칙:** 포트는 `C:\Claude\PORTS.md`에서만 배정(백엔드 4314, 프론트엔드 5184). Vite는 `strictPort: true`. 백엔드는 dev에서 `node --watch`로 실행한다.
**이유:** 전역 KB `node-backend-no-hot-reload.md`, `windows-port-reclaim-so-reuseaddr.md`.

## ComfyUI workflow and generation contracts

- Treat ComfyUI UI workflows (`nodes`/`links`), API workflows (node IDs with `class_type`), and Flagship plans (`settings`/`references`/`scenes`/`clips`) as separate formats. Convert explicitly at import boundaries.
- Keep source audio used for final mux separate from model-conditioning audio when exact speech continuity matters.
- Report custom-node registration/static-asset checks separately from model, CUDA, GPU inference, and output-quality checks.
- Validate ComfyUI installations with `main.py --cpu --offline --quick-test-for-ci`; use `--disable-all-custom-nodes --whitelist-custom-nodes <folder>` for isolated binary-node loading when needed.

## Regeneration safety

- Preserve the current media file and its recipe as a revision until replacement output completes successfully.
- If a regenerated clip feeds later clips through image or AV context, mark dependent outputs stale through the next independent boundary.
- Lock output geometry and FPS after the first dependent video result, or branch the project before changing them.


## Flush 2026-11-05 (scene flow, picture description, continuation)

- The app's per-clip colour match worsens seams (a new clip starts ~5% darker than the previous end); use seam colour correction with a ramp instead
- The CSS class `row` had no rule since P1, so every `className="row"` (button groups, option labels, LoRA rows) was a plain block and its `gap` did nothing; it is now a flex row (gap 10). Use `.opts` for option checkboxes/selects and `.btn-row` for button groups; project sections share one column (`.section` max 960px)
- One ComfyUI by default since 2026-11-06: 8188 (Rev0) runs everything, `connections.comfyUrl` = `refUrl`, and `serviceSpecs` then starts the same server for both names. (Before: two servers, 8190 (SongYUE2, images/video) and 8188 (Rev0: Deno reference video and RTX 2-pass upscale, results from `<refDir>/ComfyUI/output`). The separate RTX server settings (rtxUrl, rtxRoot, rtxApp, rtxOutputDir) were removed on 2026-10-27
- Video size = pixel budget (0.5/1/2/3/4 M) x aspect ratio; generate size is about 0.3 M pixels at the same ratio, every side a multiple of 32. Settings keys `defaults.sizeMegapixels` and `defaults.aspect` ("custom" uses customSize) replaced `defaults.sizeId`
- Size settings: `defaults.sizeMegapixels` x one wide ratio (`defaults.aspect`: 16x9, 21x9, 4x3, 5x4, 1x1 or custom) x `defaults.orientation` (landscape/portrait, turns the ratio around)
- Picture names follow the scene number (`<n>-1` first, `<n>-2` last), so adding, deleting or moving a scene renames them: on save the screen computes `pictureMoves` (shared/scenes.mjs) from the saved and the edited scene list and calls `POST /api/projects/:id/arrange` (`versions.arrange`). Copies keep the file time (clips are not marked out of date), whatever stood at a spot is put into `assets/versions` (nothing deleted), clip records get the new first/last names; a picture shared by two clips is copied for both
- How clips are made is the PROJECT's video mode (start page `defaults.videoMode`: FL2V default, T2V, I2V, R2V; audio source S2V gives S2V), not a per-scene choice. `defaultMode`/`withProjectMode` (shared/scenes.mjs) put it into the scene options under the key `*` (never saved); a scene's `mode` in `scene_opts.json` still overrides but has no UI. fl2v: first+last picture, a connected clip shares the picture; t2v/i2v/s2v (chain): a picture only where a chain starts (first clip or a clip not connected), a connected clip starts from the last frame of the clip before (`first_frame_video_path` of h3_local_video, remade together by `chainFrom`); t2v makes that picture from text (Krea), i2v/s2v from the reference pictures of the scene (`editRefs`, Qwen); s2v always uses the song; r2v: references. The `type` field of scene_plan.json is kept in the file but nothing reads it
- Setting `video.continueMode` ("frame" default, "motion") decides how a clip that continues another is made, for ALL clips (no per-scene choice). "motion" applies to R2V, I2V and S2V clips and runs them on Rev0 (8188); a clip whose clip before has no `.latent` falls back to the last picture (reason in `data.continue_mode`); FL2V (first + last picture) always keeps the last-picture way)
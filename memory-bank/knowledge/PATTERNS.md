# Patterns

> 검증된 코드 패턴. 복붙 바로 가능한 형태로 유지.

<!-- 예시 형식:

## [패턴 이름]

**사용 시점:** [언제 이 패턴을 써야 하나]

```language
// 코드
```

-->

## H3 continuity frame calculation

- H3 output lengths use the 24 fps `17n+5` frame grid.
- For a continuation clip, generate the normal snapped clip length plus the 22-frame context prefix, then trim the prefix from the delivered result.


## Flush 2026-11-05 (scene flow, picture description, continuation)

- Chained clips: pin the previous clip's real frame at t=keep as the next first frame (`first_frame_path`), keep the reference picture, generate `keep`+0.5 s, cut each clip to its recorded `keep` when joining. A frame extracted with `-sseof -0.1` can come out empty (video stream shorter than audio): use -0.4 or an absolute -ss
- R2V node (`MiniMaxH3ReferenceToVideo`) has no first/last frame inputs; add them with separate `MiniMaxH3AddGuide` nodes (audio at frame 0, image at 0, last image at -1). Audio and image in one guide node did not lip-sync as well as the I2V path
- Versions of a generated file: `studio/versions.json` per shown path (versions with id, file, record; `selected`; `log`; `draft`). The shown file keeps its path; a re-made file is written to `assets/versions/` (job `candidateOf`) and registered when the job finishes; choosing a version swaps the two files (nothing deleted) and moves the records in `assets.json`. UI: `VersionDialog` (prompt tab, versions tab), opened from the prompt icon / version chip of images and clips
- Scene-centred flow (branch feature/scene-card-ui): one scene = one clip `assets/video/clip-<scene id>.mp4`; per-scene options in `studio/scene_opts.json` (continuePrevious default on, song, refs, prompt); rules in `shared/scenes.mjs` (clip path, continue, song range, stale = scene time moved or the clip before was remade after this one). Tools take `audio_range` [start, length] (a scene's piece of the song) and `first_frame_video_path` (last picture of the clip before, taken 0.4 s before its end)
- Qwen Image 2.1 image edit (`comfyui_image_edit`, graph `qwenEditGraph`, ComfyUI template image_qwen_image_2_1_image_edit without the prompt enhancer): `images.image_1` is the picture to edit and the result has its shape, the others are references named <image2>.. in the prompt. With `blank_canvas` (grey canvas of the wanted size as image_1) it makes a new picture of the person in a reference sheet or photo: face and clothes were kept, 25-32 s at 480x640 on the RTX 5070 (verified 2026-10-28). Krea 2 Turbo cannot take reference pictures (its style-reference LoRA is not installed). A workflow set in the settings (workflowI2I) replaces it; user workflows must be API format
- Chained clips with h3_local_video: the last frame of the clip before (taken 0.4 s before its end) is the first picture; checked 2026-10-28: the first frame of the second clip matches the last frame of the first (40 s and 60 s for 3 s clips at 480x640, no upscale)
- Picture description (2026-11-04): `describe_image` / `describe_video` (tools.mjs) run ComfyUI-QwenVL on the Rev0 server (8188): graph `qwenVlGraph` (LoadImage 5 -> AILab_QwenVL 7 -> `easy showAnything` 6; the text is `history.outputs["6"].text[0]`), model Qwen3-VL-4B-Instruct 4-bit, preset Ultra Detailed, `keep_model_loaded: false`. A clip stands for its last picture (taken 0.4 s before the end); a whole clip goes through `qwenVlVideoGraph` (VHS_LoadVideo at 2 fps, 32 frames at most, `📹 Video Summary`). `ImageResize+` does not exist on Rev0 (left out, not needed). 2B invents details (a tattoo text); 4B reads the text in the picture and invents less. 69 s for one picture, 93 s for a 5 s clip (first run downloads the model). `/api/prompt` describes first/last/reference pictures, the clip before and a reference clip before asking the LLM and caches them in `studio/descriptions.json` (key = `<kind><path>`, valid while the file time is the same); it skips this while a job holds the GPU, and a picture that cannot be described is left out. Text put into a prompt request is cut at 3000 characters
- Motion continuation (the all-in-one Chain), 2026-11-04: Rev0 nodes `MiniMaxH3MotionContext` (pins the last 39 frames of the clip before as never-denoised guides; `context_latent` pins its audio from the saved latent), `...Trim` (cuts the pinned frames off again, picture and sound), `...SaveLatent` / `...LoadLatent` (the AV latent crosses runs through a safetensors file; slot `clip_index: 1` gives a fixed file name). Graph helpers `addMotion` / `finishMotion` (graphs.mjs) serve `h3RefGraph` and `h3Graph`; the tool makes the clip 39 frames longer (the length snaps up on the 17-frame grid: 5.67 s for 5 s) and copies the saved latent from `<refDir>/ComfyUI/output/vsom_latents/` to `<clip>.latent`. A clip with sound (S2V) places the song piece at frame 39 (`frame_idx`) and pins only the pictures (no latent). Real runs (736x416, same seed): R2V official 20 steps seam 6.1 vs last-picture 15.3 (2nd clip 314 s vs 140 s); I2V turbo 4 steps seam 2.4 vs 3.0 (87 s vs 41 s); S2V seam 3.6 vs 9.0

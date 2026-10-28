# Cache

Temporary findings live here during a wave. Flush them to `knowledge/` when the wave completes.

## Active Findings

| Type | Finding | Destination |
|------|---------|-------------|
| Bug or fix | A song made with "no intro" still had ~12 s of silence at the start and an instrumental stretch (56-67 s of 10-70 s); with the whole mix as the guide the model opens the mouth through them. Split vocals first (audio.cpp `--task sep --family mel_band_roformer`) and use the vocals stem as the guide (`audio_path`), mux the original mix | `knowledge/trouble-shooting.md` |
| Code pattern | Chained clips: pin the previous clip's real frame at t=keep as the next first frame (`first_frame_path`), keep the reference picture, generate `keep`+0.5 s, cut each clip to its recorded `keep` when joining. A frame extracted with `-sseof -0.1` can come out empty (video stream shorter than audio): use -0.4 or an absolute -ss | `knowledge/PATTERNS.md` |
| Code pattern | R2V node (`MiniMaxH3ReferenceToVideo`) has no first/last frame inputs; add them with separate `MiniMaxH3AddGuide` nodes (audio at frame 0, image at 0, last image at -1). Audio and image in one guide node did not lip-sync as well as the I2V path | `knowledge/PATTERNS.md` |
| Rule or convention | The app's per-clip colour match worsens seams (a new clip starts ~5% darker than the previous end); use seam colour correction with a ramp instead | `knowledge/RULES.md` |
| Bug or fix | The CSS class `row` had no rule since P1, so every `className="row"` (button groups, option labels, LoRA rows) was a plain block and its `gap` did nothing; it is now a flex row (gap 10). Use `.opts` for option checkboxes/selects and `.btn-row` for button groups; project sections share one column (`.section` max 960px) | `knowledge/RULES.md` |
| Bug or fix | The app lists clips from `assets/video/` (singular); scripts that wrote `assets/videos/` made clips invisible in the app. The tool accepts any output path, so the folder name is not checked | `knowledge/trouble-shooting.md` |
| Rule or convention | Only two ComfyUI servers: 8190 (SongYUE2, images/video) and 8188 (Rev0: Deno reference video and RTX 2-pass upscale, results from `<refDir>/ComfyUI/output`). The separate RTX server settings (rtxUrl, rtxRoot, rtxApp, rtxOutputDir) were removed on 2026-10-27 | `knowledge/RULES.md` |
| Rule or convention | Video size = pixel budget (0.5/1/2/3/4 M) x aspect ratio; generate size is about 0.3 M pixels at the same ratio, every side a multiple of 32. Settings keys `defaults.sizeMegapixels` and `defaults.aspect` ("custom" uses customSize) replaced `defaults.sizeId` | `knowledge/RULES.md` |
| Bug or fix | test/stats.test.mjs asks the live SongYUE2 and fails while a song is being made there (songyueBusy true) | `knowledge/trouble-shooting.md` |
| Code pattern | Versions of a generated file: `studio/versions.json` per shown path (versions with id, file, record; `selected`; `log`; `draft`). The shown file keeps its path; a re-made file is written to `assets/versions/` (job `candidateOf`) and registered when the job finishes; choosing a version swaps the two files (nothing deleted) and moves the records in `assets.json`. UI: `VersionDialog` (prompt tab, versions tab), opened from the prompt icon / version chip of images and clips | `knowledge/PATTERNS.md` |
| Bug or fix | `.modal` had `max-height: 100%` inside a grid backdrop, so a long list (37 clips) made the details window taller than the screen and it could not scroll; use `calc(100vh - 48px)` | `knowledge/trouble-shooting.md` |
| Bug or fix | `/api/fs` (built-in file picker) answered 500 "서버 오류" since it was added: routes.mjs used `folderPaths` without importing it. The route had no test; one now lists a folder through the real server | `knowledge/trouble-shooting.md` |
| Rule or convention | Size settings: `defaults.sizeMegapixels` x one wide ratio (`defaults.aspect`: 16x9, 21x9, 4x3, 5x4, 1x1 or custom) x `defaults.orientation` (landscape/portrait, turns the ratio around) | `knowledge/RULES.md` |

## Classification

| Type | Destination |
|------|-------------|
| Code pattern | `knowledge/PATTERNS.md` |
| Rule or convention | `knowledge/RULES.md` |
| Bug or fix | `knowledge/trouble-shooting.md` |

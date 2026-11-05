# Trouble Shooting

> 발생했던 버그와 해결 방법. 같은 문제를 두 번 겪지 않기 위한 기록.

<!-- 예시 형식:

## [문제 제목]

### 증상

[어떤 에러 또는 현상이 나타났나]

### 원인

[왜 발생했나]

### 해결

[어떻게 고쳤나 — 코드/명령어 포함]

-->

## ComfyUI custom-node bundle installation

- Some bundle installers abort the entire operation if any target node or workflow already exists. Run their dry-run and SHA256 validation first, then install with the Python executable used by that ComfyUI instance.
- Do not mix a Full ZIP snapshot with a newer GitHub snapshot based only on successful imports. Node IDs, workflow contracts, Python APIs, and binary ABIs must come from one validated snapshot.
- If a user explicitly chooses a single newer adapter, record its exact commit and file hashes, avoid overwriting existing folders, and rerun the full custom-node quick-test. Import success still does not prove workflow or GPU-output compatibility.
- When target nodes collide, back up whole folders before replacement and compare every installed file against the selected bundle hashes.
- A `user/default/workflows` symlink can fail installers that require resolved paths to stay under the ComfyUI root. Validate in an empty staging ComfyUI, copy the workflow to the real link target, and verify its hash.
- Similar model or LoRA names do not imply compatible tensor/output-layer shapes. Select the exact documented family and confirm an actual model load.

## Windows paths in JavaScript

- A literal such as `"C:\ComfyUI"` loses its backslashes at runtime. Use `"C:\\ComfyUI"` or `String.raw`, and assert the evaluated default path in tests.


## Flush 2026-11-05 (scene flow, picture description, continuation)

- A song made with "no intro" still had ~12 s of silence at the start and an instrumental stretch (56-67 s of 10-70 s); with the whole mix as the guide the model opens the mouth through them. Split vocals first (audio.cpp `--task sep --family mel_band_roformer`) and use the vocals stem as the guide (`audio_path`), mux the original mix
- The app lists clips from `assets/video/` (singular); scripts that wrote `assets/videos/` made clips invisible in the app. The tool accepts any output path, so the folder name is not checked
- test/stats.test.mjs asks the live SongYUE2 and fails while a song is being made there (songyueBusy true)
- `.modal` had `max-height: 100%` inside a grid backdrop, so a long list (37 clips) made the details window taller than the screen and it could not scroll; use `calc(100vh - 48px)`
- `/api/fs` (built-in file picker) answered 500 "서버 오류" since it was added: routes.mjs used `folderPaths` without importing it. The route had no test; one now lists a folder through the real server
- A scene card that matched images by `path.includes(scene.id)` marks scene-1 done for scene-10..16 files; compare the exact path
- test/jobs.test.mjs `a batch runs in order...` fails now and then (queued 1 instead of 2: the fake job finishes before the check), also without any change of ours
- `projects.writeText(id, rel, content, expectedMtimeMs)` refuses (409) when the file exists and `expectedMtimeMs` is not the time that was read: pass the `mtimeMs` of `readText` back (null for a new file). A test double that ignores the argument hides it (describe.mjs failed from the second picture on)
- `ffprobe -show_entries stream=nb_frames,duration -of csv=p=0` prints the fields in ffprobe's own order (duration before nb_frames), not the requested one: read named values with `-of default=noprint_wrappers=1`
- FL2V with motion continuation (2026-11-04, NOT solved): the continued clip with an end picture (`last_frame` of MiniMaxH3ImageToVideo, or `MiniMaxH3AddGuide` at -1 or at the last frame index, with or without a first picture, after an FL2V or an I2V clip, same scene or not) started in another shot (the end picture's scene), seam change ~65 against ~2 normally; without the end picture after an FL2V clip it also broke, after an I2V clip it did not. FL2V therefore keeps the last-picture way. Compare with the all-in-one `chain_section.json` before trying again
- `start.bat` / `stop.bat` did not find the 4314 listener from an automated shell (stop.bat said Done, the server stayed up; start.bat left no server): probably `findstr "LISTENING"` against a Korean netstat. Not verified; a server started with `node server/index.mjs` stays until its PID is killed
- `test/engine-tools.test.mjs`: a failing assertion before `comfy.close()` leaves the fake ComfyUI open and `node --test` never exits: close it in `finally`

# Cache

Temporary findings live here during a wave. Flush them to `knowledge/` when the wave completes.

## Active Findings

| Type | Finding | Destination |
|------|---------|-------------|
| Bug or fix | A song made with "no intro" still had ~12 s of silence at the start and an instrumental stretch (56-67 s of 10-70 s); with the whole mix as the guide the model opens the mouth through them. Split vocals first (audio.cpp `--task sep --family mel_band_roformer`) and use the vocals stem as the guide (`audio_path`), mux the original mix | `knowledge/trouble-shooting.md` |
| Code pattern | Chained clips: pin the previous clip's real frame at t=keep as the next first frame (`first_frame_path`), keep the reference picture, generate `keep`+0.5 s, cut each clip to its recorded `keep` when joining. A frame extracted with `-sseof -0.1` can come out empty (video stream shorter than audio): use -0.4 or an absolute -ss | `knowledge/PATTERNS.md` |
| Code pattern | R2V node (`MiniMaxH3ReferenceToVideo`) has no first/last frame inputs; add them with separate `MiniMaxH3AddGuide` nodes (audio at frame 0, image at 0, last image at -1). Audio and image in one guide node did not lip-sync as well as the I2V path | `knowledge/PATTERNS.md` |
| Rule or convention | The app's per-clip colour match worsens seams (a new clip starts ~5% darker than the previous end); use seam colour correction with a ramp instead | `knowledge/RULES.md` |

## Classification

| Type | Destination |
|------|-------------|
| Code pattern | `knowledge/PATTERNS.md` |
| Rule or convention | `knowledge/RULES.md` |
| Bug or fix | `knowledge/trouble-shooting.md` |

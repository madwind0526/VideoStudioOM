# Active Context

## Current Focus

- Flagship Scene UI Native Full 2026-10-19 is installed in ComfyUI Rev0, with `ComfyUI-Flagship-Face-Adapters` added from GitHub commit `b66fb8a` by explicit request; full CPU quick-test passes. Optional Spectrum is not installed.
- Before using VideoStudioOM automatic Rev0 launch, fix the escaped Windows default path in `shared/settings.mjs` and add a settings regression test.
- Best small integration candidate: expose existing R2V reference video/audio backend inputs in the generation UI.
- Preserve successful media revisions and mark downstream continuity-dependent clips stale when regeneration is added.
- Keep Flagship plan JSON separate from ComfyUI API workflows and VideoStudioOM `scene_plan.json`.
- Defer Flagship UI/source copying because current features overlap and the upstream code is AGPL-3.0-only.
- Existing engine migration, structured R2V prompts, H3 frame-grid handling, node/model validation, and VRAM release remain in place.
- Known validation gap: no GPU inference, camera-quality, lip-sync, upscaler-quality, or FRUC runtime test has been run.

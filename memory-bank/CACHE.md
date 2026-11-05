# Cache

Temporary findings live here during a wave. Flush them to `knowledge/` when the wave completes.

## Active Findings

| Type | Finding | Destination |
|------|---------|-------------|
| Code pattern | The image library of the image menu is a HIDDEN PROJECT `_images` (`projects.ensureHidden`, id starts with "_", skipped by `list()`, made by `POST /api/images/ensure`): jobs, versions, records, descriptions and the media routes work on it unchanged, so a feature that belongs to no project costs one route plus a page (`src/pages/ImagesPage.tsx`) | `knowledge/PATTERNS.md` |
| Code pattern | Several prompts that differ in a chosen way come from ONE LLM call that returns `{"prompts": [...]}` (`makeVariations`, `composePrompts` in server/images.mjs; one retry that quotes the rejection): they differ from each other, and N calls in a row would take N times as long. The same shape as `askJson` in story.mjs | `knowledge/PATTERNS.md` |
| Rule or convention | Image menu pools: `data/image-pools.json` (not committed) with the built-in `DEFAULT_POOL` until it is saved; categories person, outfit, style, place, action, prop (`POOL_CATEGORIES`); an empty category is skipped when mixing; per category the screen can pick random, not used, or one fixed phrase | `knowledge/RULES.md` |

## Classification

| Type | Destination |
|------|-------------|
| Code pattern | `knowledge/PATTERNS.md` |
| Rule or convention | `knowledge/RULES.md` |
| Bug or fix | `knowledge/trouble-shooting.md` |

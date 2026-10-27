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

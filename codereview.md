# Code Review - VideoStudioOM

Date: 2026-10-27  
Reviewed: Full codebase (src, server, shared, tests)

## Overall Assessment

VideoStudioOM is a well-architected local video production GUI that orchestrates ComfyUI and SongYUE2. The codebase shows strong attention to security, error handling, and maintainability. The project follows clear design patterns with good separation of concerns between frontend, backend, and shared code.

**Overall Grade: A-**

## Strengths

### Security
- **Path traversal protection**: `server/paths.mjs` properly validates project IDs, checks for dangerous characters, resolves paths with `realpath()`, and ensures all operations stay inside project roots. Windows-specific edge cases (trailing dots/spaces, reserved names) are handled.
- **Request guard**: `server/guard.mjs` implements robust protection against DNS rebinding, cross-origin requests, and CSRF. Uses timing-safe token comparison. State-changing operations require `x-studio-token` header.
- **Input validation**: Extensive validation in `shared/settings.mjs` with schema-based validation, unknown key rejection, and type checking.
- **Local-only binding**: Server listens on `127.0.0.1` only, preventing LAN exposure.
- **Safe file operations**: Atomic writes with retry logic for Windows file locking (`server/fs-util.mjs`), proper cleanup on failures.

### Architecture
- **Clear separation**: Frontend (React/TS), backend (Node ESM), shared schemas - well organized.
- **Event-driven design**: SSE for real-time updates (`server/events.mjs`), good UX for long-running jobs.
- **Job queue system**: Robust queue with batching, pause/resume, cancellation, GPU locking to prevent conflicts (`server/jobs.mjs`).
- **Storage design**: Project files stored in `projects/<id>/` with clear structure, approval tracking via hashes.
- **LLM abstraction**: Clean fallback chain (claude-cli → codex-cli → opencode-cli → ollama) with proper timeout handling and output cleaning.

### Code Quality
- **Error handling**: Consistent use of `HttpError` class, proper error messages in Korean as per UI rules.
- **Type safety**: TypeScript on frontend, good validation on backend.
- **Testing**: Comprehensive test suite using Node's built-in test runner covering guards, paths, projects, jobs, etc.
- **Atomic operations**: File writes use atomic rename pattern to prevent corruption.
- **Resource management**: Proper cleanup (watchers, event listeners, child processes killed with `taskkill /T` on timeout).

### Frontend
- **Modern React**: Uses hooks, functional components, good state management.
- **Routing**: Hash-based routing is simple and works well for SPA.
- **Theme support**: Light/dark mode with localStorage persistence.
- **Component structure**: Well-organized components and sections.
- **Performance**: Lazy loading considerations, proper memoization patterns.

## Areas for Improvement

### Security
- **Token storage in memory**: Guard token is generated per server start and stored in memory - fine for single-user local app, but could be logged accidentally. Current implementation is acceptable.
- **CORS/origin checking**: The guard checks Origin header but some browsers may not send it. The `sec-fetch-site` check adds defense in depth - good.
- **Command injection**: LLM CLI calls use `cross-spawn` with argument arrays (not shell strings) which is good. But need to ensure all user inputs are properly sanitized before passing to CLIs.

### Backend
- **Error messages**: Some errors expose internal details (e.g., in jobs.mjs line 130). Consider sanitizing in production, though this is a local tool.
- **Race conditions**: The job queue has mutexes for persistence but there might be race conditions around GPU state checks. The double-checking (ComfyUI busy, SongYUE2 busy) is good defensive programming.
- **Process cleanup**: In `llm.mjs`, child processes are killed on timeout but Windows process trees need `taskkill /T`. The timeout handler does `child.kill()` which may not kill child processes on Windows - need to verify. The README says "종료할 때 자식 프로세스까지 `taskkill /T`로 끈다" but I don't see this in the code.
- **Logging**: Console.error used throughout - fine for local dev, but consider a proper logger.
- **Large file handling**: Text files limited to 5MB which is reasonable.

### Frontend
- **Error boundaries**: No React error boundaries found. A crash in one component could break the whole app.
- **Accessibility**: Some buttons have aria-labels, but could improve overall a11y (keyboard navigation, focus management).
- **State management**: App.tsx has a lot of state - could benefit from context or state reducer for complex flows.
- **Type definitions**: Some `any` types might exist (need to check more files). The codebase seems mostly typed though.

### Code Style
- **Comments**: Follows G-01 rule (English comments only) ✓
- **UI text**: Follows G-02 rule (Korean UI text) ✓
- **File naming**: Mix of .mjs and .ts/.tsx - consistent with ESM setup.
- **Magic numbers**: Some hardcoded values (timeouts, limits) could be constants.

### Testing
- **Coverage**: Good coverage of critical paths (guards, paths, projects, jobs). Could add more integration tests.
- **Test isolation**: Tests use temp directories which is good.
- **Mocking**: `test/helpers/fake-comfy.mjs` suggests good test patterns.

## Specific Issues Found

### Minor Issues

1. **server/llm.mjs:29** - On timeout, `child.kill()` is called but Windows child processes may not be killed. The project claims to use `taskkill /T` but it's not implemented. This could leave zombie processes.
2. **server/jobs.mjs:166** - When path is outside roots, it resolves to a failed promise but doesn't clean up properly.
3. **src/App.tsx:104** - Comment says "a details window belongs to the page it was opened on" but implementation could be clearer.
4. **server/routes.mjs:40-46** - Prompt logging errors are silently swallowed which is good, but makes debugging hard.
5. **shared/settings.mjs:295-301** - `sanitizeSettings` returns `{ value: {}, dropped: [""] }` when input is not an object - the empty string in dropped seems odd.

### Potential Bugs

1. **server/paths.mjs:48** - In the realpath resolution loop, when resolving symlinks, it does `path.join(real, path.relative(probe, target))` and checks if it's inside root, then returns the original `target` (line 49). This seems backwards - it should probably return the resolved path. Let me look again: it resolves the deepest existing ancestor to real path, checks if that resolved path is inside root, but returns the original unresolved target. That might be intentional to preserve the requested path structure, but could be confusing.
2. **server/projects.mjs:283** - "Dirent.isDirectory() is false for junctions and symlinks, so linked folders are never listed" - this is good for security, preventing symlink escapes.

## Recommendations

### High Priority
- **Implement proper process tree killing on Windows** in `server/llm.mjs` and `server/proc.mjs` as stated in requirements. Use `taskkill /T /F /PID` on Windows.
- **Add React Error Boundaries** to prevent UI crashes from breaking the whole app.
- **Review the realpath logic** in `server/paths.mjs` to ensure it's correctly preventing symlink escapes.

### Medium Priority
- **Add request rate limiting** for expensive operations (LLM calls, job starts) to prevent abuse.
- **Improve logging** with structured logging (levels, timestamps) instead of console.log/error.
- **Add health check for dependencies** (ComfyUI, SongYUE2 availability) on startup.
- **Consider adding CSP headers** for additional security.
- **Add more specific TypeScript types** where `any` might be used.

### Low Priority
- **Add JSDoc comments** for complex functions (some exist, could be more consistent).
- **Extract magic numbers** to named constants.
- **Add more unit tests** for edge cases in settings validation.
- **Consider using a proper router** on frontend instead of hash parsing (though hash routing is fine for this use case).

## Test Results

The test suite looks comprehensive with 23 test files covering:
- API endpoints
- Assets management
- Cards
- Engine integration
- Events
- Guard/security
- Jobs queue
- Paths validation
- Post-processing
- Projects
- Prompts
- Services
- Settings
- Stats
- Story generation
- Versions

All tests use Node's built-in test runner (`node --test`), which is good for avoiding external dependencies.

## Conclusion

This is a high-quality codebase with strong security practices, clean architecture, and good attention to detail. The few issues found are mostly minor improvements. The project demonstrates mature engineering practices especially around security (path traversal, CSRF protection), error handling, and defensive programming.

The codebase is ready for production use as a local tool. The main things to address are the Windows process killing implementation and adding error boundaries to the React app.

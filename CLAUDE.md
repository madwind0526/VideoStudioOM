# VideoStudioOM

> Working directory: `E:\Claude\VideoStudioOM`

## Project Overview

ComfyUI(이미지·영상)와 SongYUE2(음악·효과음·음성) 위에 얹는 **영상 제작 GUI**. 주제/줄거리 → 시나리오 → 대본 → 장면 이미지 → 영상(+오디오/노래) → 라이브러리까지를 화면에서 조종하고, 중간 산출물(시나리오, 대본, 이미지, 오디오, 영상)을 폴더에 저장해 읽고 수정한다.

- **줄거리/시나리오/대본은 LLM 텍스트 호출(MusicAutomation 방식)로 만들고, 단계마다 사람이 검토/수정/승인한다.** 이미지/영상/음성/음악 생성은 백엔드가 ComfyUI와 SongYUE2를 직접 호출한다(`server/engine/`). 도구 권한을 가진 에이전트는 쓰지 않는다 (`memory-bank/knowledge/RULES.md` P-01, 근거 `docs/spike-agent.md`).
- 엔진: ComfyUI 8190(SongYUE2 내장: Krea 2 Turbo, MiniMax H3), RTX 확대용 ComfyUI 8191, Qwen3-TTS(SongYUE2 audio.cpp). 프로젝트 데이터는 `projects/<id>/` (기본 위치는 기존 `E:\Claude\OpenMontage\projects`, 설정에서 바꿈)
- 음악: SongYUE2 백엔드 `http://127.0.0.1:4311`
- 설계: `docs/design.md`, 구현 계획: `docs/plan.md`
- UI 참고: `C:\Claude\SongYUE2\app` (미니멀, 아이콘 중심, 좌측 메뉴 / 상단 메뉴 / 하단 시스템 메시지), LLM 선택 참고: `C:\Claude\MusicAutomation\server\services\llm.mjs`, `llm-cli.mjs`, 자동 주제: `auto-song.mjs`
- 포트(`C:\Claude\PORTS.md`): 백엔드 4314, Vite dev 5184

## Project Structure

- `src/`: React + TypeScript UI (Vite)
- `server/`: Node 백엔드 (REST + SSE, LLM 텍스트 호출, `server/engine/`의 ComfyUI·SongYUE2 클라이언트와 도구)
- `shared/`: 서버/클라이언트 공용 로직 (스키마, 설정 기본값)
- `docs/`: 설계 문서
- `data/`: 사용자 설정(커밋 금지)
- `memory-bank/`: 프로젝트 컨텍스트와 축적 지식

## Tech Stack

- UI: React + TypeScript + Vite, 한국어 UI, 아이콘은 lucide-react
- 백엔드: Node (웹 프레임워크 없이), `cross-spawn`으로 CLI 실행
- LLM: claude-cli(기본) → codex-cli → opencode-cli → ollama 폴백 체인, 텍스트 호출만(중립 폴더, stdin). MusicAutomation의 `llm.mjs`, `llm-cli.mjs` 참고
- 엔진 호출: Node가 ComfyUI REST/웹소켓과 SongYUE2 API를 직접 호출한다(Python 브릿지 없음). 그래프는 `server/engine/graphs.mjs`, 도구는 `server/engine/tools.mjs`, 설명은 `docs/engine.md`

## Commands

```bash
start.bat          # build, then run on http://127.0.0.1:4314 (frees the port first)
start.bat dev      # API with auto-restart (4314) + Vite dev server (5184)
stop.bat           # stop both ports and VideoStudioOM node windows
npm test           # backend tests
npm run build      # typecheck + production build
```

자동화에서 실행할 때는 끝의 `pause`를 건너뛰는 `start.bat prod nopause`, `start.bat dev nopause`, `stop.bat nopause`를 쓴다(출력은 파일로 리다이렉트하고 `< nul`).

## Rules

- 코드 주석은 영어만, UI 텍스트는 한국어 (전역 규칙 G-01, G-02).
- 새 포트는 `C:\Claude\PORTS.md`에서만 배정한다.

## Memory Bank

At the start of a session, read `memory-bank/active-context.md` and then `memory-bank/STATE.md`.

| 파일 | 용도 |
|------|------|
| `memory-bank/active-context.md` | 현재 작업 포커스 |
| `memory-bank/STATE.md` | Wave 진행 상태 |
| `memory-bank/CACHE.md` | 세션 중 임시 발견사항 |
| `memory-bank/knowledge/PATTERNS.md` | 재사용 코드 패턴 |
| `memory-bank/knowledge/RULES.md` | 프로젝트 규칙 |
| `memory-bank/knowledge/trouble-shooting.md` | 버그 해결 기록 |

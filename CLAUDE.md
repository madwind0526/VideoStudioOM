# VideoStudio

> Working directory: `C:\Claude\VideoStudio`

## Project Overview

OpenMontage(영상 제작 엔진)와 SongYUE2(음악) 위에 얹는 **영상 제작 GUI**. 주제/줄거리 → 시나리오 → 대본 → 장면 이미지 → 영상(+오디오/노래) → 라이브러리까지를 화면에서 조종하고, 중간 산출물(시나리오, 대본, 이미지, 오디오, 영상)을 폴더에 저장해 읽고 수정한다.

- **창작 판단(대본/장면 구성)은 에이전트 CLI(Claude/Codex/OpenCode)가 OpenMontage 지침대로 수행한다.** VideoStudio는 에이전트를 조종하고 결과를 검토/수정하는 GUI다 (`memory-bank/knowledge/RULES.md` P-01).
- 엔진: `G:\Claude-External\OpenMontage` (도구는 그 폴더의 `.venv`로 실행, 프로젝트 데이터는 `projects/<id>/`)
- 음악: SongYUE2 백엔드 `http://127.0.0.1:4311`
- 설계: `docs/design.md`
- UI 참고: `C:\Claude\SongYUE2\app` (미니멀, 아이콘 중심, 좌측 메뉴 / 상단 메뉴 / 하단 시스템 메시지), LLM 선택 참고: `C:\Claude\MusicAutomation\server\services\llm.mjs`, `llm-cli.mjs`, 자동 주제: `auto-song.mjs`
- 포트(`C:\Claude\PORTS.md`): 백엔드 4314, Vite dev 5184

## Project Structure

- `src/`: React + TypeScript UI (Vite)
- `server/`: Node 백엔드 (REST + SSE, 에이전트 실행, OpenMontage/SongYUE2 브릿지)
- `shared/`: 서버/클라이언트 공용 로직 (스키마, 설정 기본값)
- `docs/`: 설계 문서
- `data/`: 사용자 설정(커밋 금지)
- `memory-bank/`: 프로젝트 컨텍스트와 축적 지식

## Tech Stack

- UI: React + TypeScript + Vite, 한국어 UI, 아이콘은 lucide-react
- 백엔드: Node (웹 프레임워크 없이), `cross-spawn`으로 CLI 실행
- 에이전트/LLM: claude-cli, codex-cli, opencode-cli (OpenMontage 폴더에서 실행), ollama (단순 텍스트용)
- 엔진 호출: OpenMontage Python 도구(`tools.tool_registry`)를 얇은 Python 브릿지로 실행

## Commands

```bash
start.bat          # build, then run on http://127.0.0.1:4314 (frees the port first)
start.bat dev      # API with auto-restart (4314) + Vite dev server (5184)
stop.bat           # stop both ports and VideoStudio node windows
npm test           # backend tests
npm run build      # typecheck + production build
```

(P1 골격 구현 전에는 `npm` 스크립트가 아직 없다.)

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

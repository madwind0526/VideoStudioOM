# Rules

> 이 프로젝트의 규칙과 컨벤션. 모든 sub-agent가 반드시 따라야 함.

## G-01: 코드 주석은 영어만 사용 (MANDATORY)

**규칙:** 모든 코드 주석(`//`, `/* */`, `///`)은 영어로 작성. 한글 주석 금지.
**이유:** 소스 파일 내 한글은 인코딩 문제 및 빌드 오류를 유발할 수 있음.
**적용 시점:** 코드 작성 또는 수정 시 항상. UI 텍스트(사용자에게 보이는 문자열)는 한국어 유지.

<!-- 예시 형식:

## [규칙 이름]

**규칙:** [한 줄 요약]
**이유:** [왜 이 규칙이 필요한가]
**적용 시점:** [언제 이 규칙이 발동되나]

-->

## P-01: 창작 판단은 에이전트가, GUI는 조종/검토/수정만 (MANDATORY)

**규칙:** 대본, 장면 구성 등 창작 판단은 OpenMontage 지침을 따르는 에이전트 CLI(Claude/Codex/OpenCode)가 한다. VideoStudio 백엔드는 자체 LLM 로직으로 창작을 대신하지 않는다.
**이유:** 사용자 결정(2026-10-19). OpenMontage의 파이프라인과 승인 지점(gate)을 그대로 쓰기 위함.
**적용 시점:** 시나리오/스토리보드/영상 단계를 구현할 때 항상. Ollama는 도구 사용이 없어 주제 제안 같은 단순 텍스트 작업에만 쓴다.

## P-02: 에이전트 CLI 실행 시 cwd 규칙

**규칙:** 파이프라인 작업은 cwd를 OpenMontage 폴더로 해서 실행한다(그 폴더의 CLAUDE.md/AGENTS.md가 적용되어야 함). 반대로 주제 제안 같은 가벼운 텍스트 호출은 중립 디렉터리(os.tmpdir())에서 실행하고 프롬프트는 stdin으로 전달한다.
**이유:** 전역 KB `claude-cli-subprocess-context-bleed.md` - 프로젝트 CLAUDE.md의 페르소나가 답변을 오염시킴.

## P-03: Node가 Python을 spawn할 때

**규칙:** `PYTHONUTF8=1`, `PYTHONIOENCODING=utf-8`을 항상 설정한다.
**이유:** 전역 KB `python-subprocess-cp949-crash.md` - 한글 로케일에서 조용히 실패(종료코드 0).

## P-04: 포트와 프로세스

**규칙:** 포트는 `C:\Claude\PORTS.md`에서만 배정(백엔드 4314, 프론트엔드 5184). Vite는 `strictPort: true`. 백엔드는 dev에서 `node --watch`로 실행한다.
**이유:** 전역 KB `node-backend-no-hot-reload.md`, `windows-port-reclaim-so-reuseaddr.md`.

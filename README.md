# VideoStudioOM

주제 한 줄에서 시작해 **시나리오 → 대본 → 장면 이미지 → 영상(+노래/음성) → 최종 합성**까지 화면에서 조종하는 영상 제작 GUI.
영상 제작 엔진은 [OpenMontage](E:\Claude\OpenMontage), 음악은 SongYUE2를 그대로 쓰고, 이 프로젝트는 그 위의 **조종석**이다.

> 상태: 설계/계획 단계(Wave 0 완료). 아직 실행 가능한 코드는 없다. 다음 단계는 스파이크(Wave 1).

## 한눈에 보기

| 항목 | 내용 |
|---|---|
| 하는 일 | 주제에서 줄거리, 시나리오, 대본을 LLM으로 만들고, 단계마다 사람이 보고 고치고 승인한 뒤 이미지, 영상, 음악을 만들어 합성한다 |
| 하지 않는 일 | 도구 권한을 가진 에이전트에게 제작을 맡기는 것. LLM은 텍스트만 만들고, OpenMontage는 제작 도구로만 쓴다 |
| 비용 | 유료 API 없음. 로컬 모델(Krea, H3, RTX 확대, Qwen3-TTS, SongYUE2)과 CLI 구독만 사용 |
| 사용자 | 본인 1명, PC에서 실행하고 폰은 Tailscale로 접속 |
| 포트 | 백엔드 `4314`, Vite dev `5184` (`C:\Claude\PORTS.md`에서만 배정) |

## 핵심 원칙

1. **줄거리/시나리오/대본은 LLM 텍스트 호출로 만든다** (규칙 P-01, MusicAutomation이 주제로 가사를 만드는 방식). 도구 권한이 필요 없다.
2. **모든 중간 산출물은 폴더의 파일**이다. GUI와 파일 탐색기 어느 쪽에서 고쳐도 반영된다.
3. **저장 위치는 OpenMontage 프로젝트 폴더** (`projects/<id>/`). 정본은 `artifacts/*.json`이고 GUI 전용 파일은 `studio/`에 둔다.
4. **승인 지점마다 멈춘다.** 사람이 고치고 승인해야 다음 단계로 가고, 수정본이 다음 단계의 입력이 된다. 앞 단계를 바꾸면 뒤 단계는 다시 승인해야 한다.
5. 구조화 출력(시나리오, 대본)은 OpenMontage 스키마와 시간 규칙으로 검증하고, 어기면 이유를 알려 다시 요청한다.

## 작업 흐름

```
주제 ─▶ 줄거리 ─▶ 시나리오 ─▶ 대본 ─▶ 장면 이미지 ─▶ 영상 + 오디오 ─▶ 합성 ─▶ 라이브러리
(직접/제안/자동)  [승인]      [승인]    [승인]      [승인]          [승인]     renders/final.mp4
        └── LLM 텍스트 호출 ──┘          └──── OpenMontage 도구 / SongYUE2 ────┘
```

- 영상 모드: **T2V**(텍스트), **I2V**(첫 이미지), **FL2V**(첫+끝 이미지), **R2V**(참조 영상/이미지/오디오)
- 오디오 우선순위: 입력한 노래 > SongYUE2 생성 > H3 자체 오디오. 립싱크는 음성을 첫 프레임에 고정하는 방식.
- 기본 설정은 `data/settings.json`, 프로젝트별로 `studio/settings.json`이 덮어쓴다.

## 구성

```
브라우저 UI (React + TS + Vite, :5184 dev)
        │  REST + SSE
Node 백엔드 (:4314, 웹 프레임워크 없음)
   ├─ 설정 / 프로젝트 / 파일 저장소
   ├─ LLM 텍스트 호출   claude → codex → opencode → ollama (중립 폴더, stdin, 도구 권한 없음)
   ├─ OpenMontage 브릿지  bridge/om_tool.py (Python 도구 1회 실행)
   └─ SongYUE2 브릿지     http://127.0.0.1:4311
엔진: E:\Claude\OpenMontage  (tools/, pipeline_defs/, skills/, projects/<id>/)
```

## 폴더 구조

### 이 저장소

```
VideoStudioOM/
├─ README.md            이 문서
├─ CLAUDE.md            작업 지침(에이전트용)
├─ start.bat / stop.bat 실행과 중지 (포트 정리 포함)
├─ src/                 React + TypeScript UI (Vite)
├─ server/              Node 백엔드
│  └─ prompts/          에이전트 프롬프트 템플릿
├─ shared/              서버/클라이언트 공용 (설정 스키마, 기본값)
├─ bridge/              om_tool.py: OpenMontage 도구 실행 브릿지
├─ test/                node --test
├─ data/                사용자 설정 (git 제외)
├─ docs/                design.md(설계), plan.md(계획), 이후 spike-agent.md
└─ memory-bank/         프로젝트 컨텍스트와 축적 지식
```

### 프로젝트 데이터 (OpenMontage 쪽, 라이브러리의 실체)

```
E:\Claude\OpenMontage\projects\<id>\
├─ project.json                      OpenMontage 프로젝트 표식
├─ studio/                           GUI 전용
│  ├─ settings.json                  프로젝트 설정(전역 기본값 덮어쓰기)
│  ├─ topic.md, synopsis.md          주제, 전체 줄거리
│  └─ approvals.json                 단계별 승인 기록(시각, 입력 해시)
├─ artifacts/                        scene_plan.json(시나리오), script.json(대본)
├─ assets/
│  ├─ images/  video/  audio/  music/
└─ renders/final.mp4
```

## 계획

단계 하나가 Wave 하나다. 자세한 작업과 완료 기준은 [docs/plan.md](docs/plan.md).

| Wave | 단계 | 내용 | 상태 |
|---|---|---|---|
| 0 | 준비 | 초기화, 이름 변경, E: 이동, 설계/계획 | 완료 |
| 1 | S. 스파이크 | 에이전트 CLI 비대화형 실행 검증. 동작은 하나 허용 목록이 보호 장치가 되지 못해 비채택 ([결과](docs/spike-agent.md)) | 완료 |
| 2 | P1. 골격 | 백엔드, UI 틀(6개 메뉴), 설정/프로젝트 저장, SSE, **접근 보호** | 다음 |
| 3 | P2. 설정과 브릿지 | 설정 화면, 도구 브릿지, GPU 락, `h3_local_video` 확장 | 대기 |
| 4 | P3. 시나리오 | 주제→줄거리→시나리오→대본(LLM), 스키마/시간 검증, 검토/수정/승인 | 대기 |
| 5 | P4. 스토리보드 | 장면 카드, 프롬프트 수정, 장면별 재생성 | 대기 |
| 6 | P5. 영상/오디오 | 모드별 영상, SongYUE2, 립싱크 | 대기 |
| 7 | P6. 합성/라이브러리 | 최종 합성, 라이브러리, 마감 | 대기 |

가장 큰 위험은 LLM이 장면/대사 시간을 틀리는 것과 GPU 12GB 충돌이다. 전자는 스키마와 시간 검증 + 재요청으로, 후자는 락 파일 한 곳으로 다룬다.

### 구현 전에 정해 둔 안전 조건

- **접근 보호**: 모든 쓰기/실행 요청에 시작 시 생성한 토큰을 요구하고, `Origin`/`Host`가 앱 주소와 다르면 거부한다. 브라우저의 다른 페이지나 tailnet 내 다른 기기가 호출하지 못하게 한다.
- **LLM은 텍스트만**: 도구 권한이 없는 호출만 쓴다. 호출마다 타임아웃을 두고 종료할 때 자식 프로세스까지 `taskkill /T`로 끈다.
- **GPU 락**: 잠금은 백엔드 메모리가 아니라 `bridge/om_tool.py`의 락 파일로 두고, SongYUE2의 생성 상태(진행 중이면 409)도 함께 확인한다.
- **저장 충돌 방지**: 파일을 불러올 때의 수정 시각을 저장 때 비교해 다르면 거부한다.
- **승인 기록**: 승인할 때 입력 파일의 해시를 `studio/approvals.json`에 남기고, 앞 단계가 바뀌면 뒤 단계는 다시 승인해야 한다.
- **경로 검증**: 프로젝트 id는 `^[a-z0-9가-힣_-]{1,60}$`만 허용하고, 파일 경로는 `realpath`로 풀어 프로젝트 루트 안인지 대소문자 구분 없이 확인한다. `:`가 든 이름은 거부한다.

## 실행

```bash
start.bat          # 빌드 후 http://127.0.0.1:4314 로 실행 (포트를 먼저 비움)
start.bat dev      # API 자동 재시작(4314) + Vite dev(5184)
stop.bat           # 두 포트와 VideoStudioOM node 창 종료
npm test           # 백엔드 테스트
npm run build      # 타입 검사 + 프로덕션 빌드
```

자동화에서 실행할 때는 끝의 `pause`를 건너뛰는 `nopause` 인자를 붙인다(`start.bat prod nopause`, `stop.bat nopause`).

## 참고하는 기존 프로젝트

| 프로젝트 | 가져오는 것 |
|---|---|
| MusicAutomation (`C:\Claude\MusicAutomation`) | LLM 텍스트 호출 계층(`llm.mjs`, `llm-cli.mjs`)과 폴백 체인, 주제 풀(`direction-pool.mjs`). 코드는 복사하고 경로 import는 하지 않는다 |
| SongYUE2 (`C:\Claude\SongYUE2`) | 노래 생성 `POST /api/external/generate`, 가사 싱크 `/api/projects/:id/lyrics-sync`, 보컬 분리 `/stems`, 상태 `/api/generate/status`, `/api/system/stats`, UI 레이아웃 |

## 문서

| 문서 | 내용 |
|---|---|
| [docs/design.md](docs/design.md) | 구조, 요구사항 매핑, 위험 |
| [docs/plan.md](docs/plan.md) | Wave별 작업과 완료 기준 |
| [CLAUDE.md](CLAUDE.md) | 작업 지침 |
| [memory-bank/](memory-bank/) | 현재 상태, 규칙(P-01~P-04), 트러블슈팅 |

## 규칙

- 코드 주석은 영어, UI 문구는 한국어.
- 새 포트는 `C:\Claude\PORTS.md`에서만 배정한다. Vite는 `strictPort: true`.
- Node가 Python을 실행할 때는 `PYTHONUTF8=1`, `PYTHONIOENCODING=utf-8`.

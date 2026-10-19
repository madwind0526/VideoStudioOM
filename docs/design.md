# VideoStudioOM 설계서 (초안)

작성: 2026-10-19. 상태: 사용자 검토 대기. 사용자 요구 6가지를 그대로 따른다.

## 1. 목표와 원칙

- OpenMontage(영상 엔진)와 SongYUE2(음악) 위에 얹는 **영상 제작 GUI**. 둘을 최대한 그대로 쓴다.
- **창작 판단(주제 구체화, 시나리오, 대본, 장면 구성)은 에이전트 CLI가 OpenMontage 지침대로 수행**한다. 백엔드는 자체 LLM 로직으로 창작을 대신하지 않는다. GUI의 일은 설정 → 에이전트 실행 → 산출물 검토/수정 → 승인/재생성 → 라이브러리다.
- 중간 산출물은 모두 **폴더의 파일**로 남기고 GUI와 파일 탐색기 양쪽에서 읽고 고칠 수 있다(SongYUE2 라이브러리 방식).
- 유료 API 없음. 로컬 모델(Krea, H3, RTX, Qwen3-TTS, SongYUE2)과 Claude/Codex 구독만 쓴다.

## 2. 구성

```
브라우저 UI (React + TS + Vite, :5184 dev)  ── REST/SSE ──  Node 백엔드 (:4314)
                                                              ├ 설정/프로젝트/파일 저장소
                                                              ├ 에이전트 실행기 (claude / codex / opencode CLI)
                                                              ├ OpenMontage 브릿지 (Python 도구 1회 실행)
                                                              └ SongYUE2 브릿지 (:4311)
엔진: E:\Claude\OpenMontage (tools/, pipeline_defs/, skills/, projects/<id>/)
```

- **UI**: SongYUE2 스타일. 미니멀, 아이콘(lucide) 중심. 좌측 아이콘 메뉴 / 상단 메뉴(프로젝트, 단계 표시, LLM 선택) / 하단 시스템 메시지 줄(진행, 오류, 에이전트 로그 요약). 한국어 UI, 라이트/다크.
- **백엔드**: Node(웹 프레임워크 없음), MemoReader/MusicAutomation과 같은 구조(`server/`, `shared/`). 에이전트/LLM 선택 계층은 MusicAutomation의 `llm.mjs`, `llm-cli.mjs`를 재사용(순서: claude-cli, codex-cli, opencode-cli, ollama).
- **OpenMontage 브릿지**: `bridge/om_tool.py`(OpenMontage venv로 실행)가 `tools.tool_registry`에서 도구를 이름으로 찾아 JSON 입력으로 1회 실행하고 JSON을 돌려준다. GUI의 "이 장면만 다시 생성" 같은 직접 실행에 쓴다. 에이전트도 같은 도구를 쓴다.
- **진행 상황**: 에이전트와 도구가 `projects/<id>/`에 쓰는 파일(체크포인트, `events.jsonl`)을 백엔드가 감시해 SSE로 UI에 전달한다(Backlot과 같은 데이터 원천).

## 3. 프로젝트 폴더 (단일 진실 원천 = OpenMontage 프로젝트)

`E:\Claude\OpenMontage\projects\<id>\` 를 그대로 쓰고 GUI 전용 `studio/`만 추가한다. Backlot 보드와 에이전트 모두 같은 폴더를 본다.

```
projects/<id>/
  project.json, checkpoint_*.json      OpenMontage가 관리 (승인 상태 포함)
  studio/
    settings.json                      이 프로젝트의 설정(전역 기본값을 덮어씀)
    topic.md  synopsis.md              주제, 전체 줄거리 (사용자 편집 가능)
  artifacts/
    script.json  scene_plan.json ...   OpenMontage 스키마(schemas/*.json)의 시나리오/대본/장면 계획
  assets/
    images/ video/ audio/ music/       장면별 이미지, 클립, 음성, 노래
  renders/final.mp4
```

- 편집은 JSON 산출물의 필드 단위 폼이 기본이고, 저장 전에 OpenMontage 스키마로 검증한다. 읽기 쉬운 `.md` 보기는 파생 뷰로 제공한다(원본은 JSON).
- 전역 기본 설정은 `data/settings.json`.

## 4. 요구사항 매핑

### 4.1 UI 틀 (요구 1)
좌측 메뉴: 홈(새 프로젝트) / 시나리오 / 스토리보드 / 영상 / 라이브러리 / 설정. 상단: 프로젝트 이름, 6단계 진행 표시, LLM 선택. 하단: 시스템 메시지 줄.

### 4.2 기본 설정 (요구 2) — `data/settings.json`, 프로젝트별 덮어쓰기
| 항목 | 값 |
|---|---|
| 이미지 모델 | Krea 2 Turbo(기본), H3 스틸(5프레임 우회, 프롬프트 반영이 약함) |
| 이미지 크기 | 프리셋(16:9/9:16/1:1)과 직접 입력, 32의 배수 |
| 영상 모델 | MiniMax H3 Turbo(기본) |
| 영상 모드 | **T2V**, **I2V**(첫 이미지만, F2V), **FL2V**(첫+끝 이미지), **R2V**(참조 영상/이미지/오디오), 각 모드의 입력(텍스트/이미지/영상/오디오) |
| 생성 해상도, 최종 해상도 | 기본 736×416 생성 → 1920×1088 |
| 확대 | RTX 2pass(기본) / 없음 / Lanczos |
| 길이, FPS | 길이는 17k+5 프레임 격자(24fps)로 보정, 최종 FPS는 ffmpeg로 변환 |
| 오디오 | 입력 노래 / SongYUE2 생성 / H3 자체 오디오 / 립싱크 모드(오디오 고정) |
| 에이전트/LLM | claude-cli / codex-cli / opencode-cli / ollama |

### 4.3 시나리오 (요구 3)
1. **주제**: 직접 입력 / "주제 제안" / **자동**(MusicAutomation의 자동 곡 방식처럼 후보 풀에서 랜덤 선택).
2. **전체 줄거리**: 주제에서 에이전트가 작성하거나 직접 입력.
3. **상세 시나리오 + 시간별 대본**: 줄거리를 받아 에이전트가 OpenMontage의 research/proposal/script/scene_plan 단계를 수행. 단계마다 승인 지점(gate)에서 멈추고 GUI가 `script.json`, `scene_plan.json`을 보여 주며 수정/승인/반려를 받는다.
4. LLM 선택은 상단 메뉴. **에이전트 CLI 세 가지는 도구를 쓰는 파이프라인 실행이 가능**하고, **Ollama는 도구가 없어 주제 제안 같은 단순 텍스트 작업에만** 쓴다.

### 4.4 장면 이미지 (요구 4)
시나리오/대본의 장면 계획에서 장면별 이미지 프롬프트를 에이전트가 작성 → 스토리보드 화면에 카드로 표시. 카드마다 프롬프트 수정, 이미지 재생성(`comfyui_krea_image` 직접 실행), 교체(업로드)가 가능. 다음 단계로 넘기려면 에셋 단계 승인.

### 4.5 영상과 오디오 (요구 5)
- 장면 이미지 → `h3_local_video`(저해상도 생성 후 RTX 확대). 모드 T2V/I2V/FL2V/R2V.
- 오디오: 입력된 오디오가 있으면 그것을 사용. 없으면 SongYUE2로 노래 생성(`songyue_music`)하거나 H3 자체 오디오 사용.
- **립싱크**: H3의 `MiniMaxH3AddGuide`로 음성을 첫 프레임 위치에 고정하면 입 모양이 맞춰진다(사용자가 시험 영상으로 확인: "립싱크는 아주 잘 된다"). 뮤직비디오는 노래를 5~15초 구간으로 나눠 클립을 만들고 이어 붙인다. 보컬만 넣는 편이 유리할 것으로 예상하며(미확인), SongYUE2의 STEM 분리 사용을 검토한다.
- 최종 합성: OpenMontage compose(Remotion)로 자막, 음악을 얹어 `renders/final.mp4`.

### 4.6 폴더와 라이브러리 (요구 6)
위 3절의 폴더 구조가 곧 라이브러리. 라이브러리 화면은 프로젝트 목록(포스터, 길이, 단계 상태)과 파일 단위 보기/수정(주제, 줄거리, 시나리오, 대본 텍스트, 이미지, 오디오, 영상)을 제공한다. 파일 탐색기에서 직접 고쳐도 반영된다(파일 감시).

## 5. OpenMontage 쪽에서 해야 할 확장
- `h3_local_video`: 현재 T2V/I2V만 지원 → **FL2V(`last_frame`), R2V(참조 영상/이미지/오디오), 오디오 고정(`MiniMaxH3AddGuide`, 립싱크)** 입력 추가.
- 첫 프레임 이미지 비율이 달라서 약 3% 찌그러지는 문제 수정(생성 해상도에 맞춰 이미지 크기 보정).
- 설정 파일(`studio/settings.json`)을 에이전트가 읽도록 `CLAUDE.md` 지침에 추가.

## 6. 가장 큰 위험과 먼저 할 시험(스파이크)
1. **에이전트 CLI를 비대화형으로 실행했을 때 승인 지점에서 멈추는가, 같은 세션으로 이어 실행되는가.** 이 구조의 핵심 가정이다. claude/codex/opencode 각각 확인한다.
2. **권한 허용 목록**: 비대화형은 도구 사용 승인을 물을 수 없으므로 허용할 도구(Bash, 파일 읽기/쓰기, 웹 검색)를 미리 정한다.
3. **시간과 구독 사용량**: 한 편에 리서치부터 렌더링까지 에이전트가 길게 돈다.
4. 사용자가 JSON을 수정한 뒤 이후 단계가 수정본을 기준으로 다시 진행되는지 확인한다.
스파이크가 실패하면 대안: 에이전트를 대화형 세션으로 두고 GUI는 파일 편집/확인만 한다.

## 7. 구현 단계

| 단계 | 내용 |
|---|---|
| P0 | 프로젝트 초기화, 포트 배정, 설계서(이 문서) |
| P1 | 골격: 백엔드(설정, 프로젝트/파일 저장소, SSE), UI 틀(6개 메뉴, 상단/하단), start/stop |
| P2 | 설정 화면 + 도구 브릿지 + `h3_local_video` 확장(FL2V/R2V/오디오 고정) |
| P3 | 에이전트 실행기 + 시나리오 단계(주제/줄거리/시나리오/대본 검토·수정·승인). 스파이크가 선행 |
| P4 | 스토리보드 이미지(장면별 프롬프트 수정, 재생성) |
| P5 | 영상 + 오디오(SongYUE2 연동, 립싱크, 구간별 클립) |
| P6 | 합성(compose), 라이브러리 화면, 마감 |

## 8. 미결정 사항
- 시나리오 편집 UI의 상세(JSON 폼 vs 마크다운 뷰)는 P3에서 실제 산출물을 보고 결정한다.
- OpenCode CLI의 비대화형 실행 방식과 Codex의 세션 이어하기 방식은 스파이크에서 확인한다.

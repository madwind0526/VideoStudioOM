# 스파이크 결과: 에이전트 CLI 비대화형 실행

> **결정(2026-10-19)**: 이 결과를 근거로 에이전트가 OpenMontage 파이프라인을 돌리는 방식은 채택하지 않았다. 줄거리/시나리오/대본은 LLM 텍스트 호출로 만든다(`RULES.md` P-01). 이 문서는 나중에 에이전트 방식이 필요해질 때를 위한 기록이다.

실행일: 2026-10-19. 대상: Claude Code 2.1.303 (`claude -p`), 엔진: OpenMontage `framework-smoke` 파이프라인(research, script 두 단계, 둘 다 승인 지점, 도구 없음). 실행 위치(cwd)는 `E:\Claude\OpenMontage`.

## 결론

**채택 가능하다.** "설정 → 에이전트 실행 → 승인 지점에서 정지 → GUI가 수정/승인 → 같은 세션으로 재개" 흐름이 Claude CLI에서 동작한다. 단, 도구 허용 목록은 설계를 바꿔야 한다(아래 S3).

| 항목 | 결과 | 근거 |
|---|---|---|
| S1 비대화형 실행, 승인 지점에서 정지 | 통과 | 44초, 8턴. `checkpoint_research.json`이 `status: awaiting_human`으로 쓰이고, script 단계는 시작하지 않고 턴이 끝남 |
| S2 승인 후 같은 세션으로 재개 | 통과 | `claude -p --resume <session_id>`가 같은 `session_id`로 이어짐. 16초, 4턴 |
| S3 도구 허용 목록 | 부분 통과, **설계 변경 필요** | 아래 참조 |
| S4 사용자 수정이 다음 단계에 반영 | 통과 (조건부) | 연구 결과의 한 칸을 고친 뒤 승인하자 script 두 번째 섹션이 그 칸을 사용. 재개 프롬프트에 "디스크의 체크포인트를 다시 읽어라"를 명시했을 때의 결과이며, 명시하지 않았을 때는 시험하지 않음 |
| S5 Codex, OpenCode | 미실시 | P3로 미룸(기본 에이전트는 Claude) |
| S6 시간과 사용량 | 기록함 | S1: 44초, S2: 16초. CLI가 보고한 목록가 환산 비용은 S1 $0.43, S2 $0.49(캐시 읽기 약 49만 토큰 포함, 구독 한도 소모량의 지표로만 사용). `framework-smoke`는 가장 가벼운 파이프라인이므로 실제 파이프라인은 이보다 훨씬 길다 |

## 실행 방법(재현용)

```bash
cd E:\Claude\OpenMontage
# S1: first run, prompt on stdin, JSON result carries session_id
claude -p --output-format json --allowedTools "Read,Write,Edit,Bash(.venv/Scripts/python.exe:*)" < prompt.txt > out.json
# approve (GUI side): rewrite the checkpoint with status=completed, human_approved=True
.venv/Scripts/python.exe approve.py
# S2: resume the same session from the same cwd
claude -p --resume <session_id> --output-format json --allowedTools "..." < prompt2.txt
```

- 승인은 `lib.checkpoint.write_checkpoint(projects_dir, project_id, stage, "completed", artifacts, pipeline_type=..., human_approval_required=True, human_approved=True)`로 한다. 이전 `awaiting_human` 체크포인트는 `history/checkpoint_<stage>_<시각>.json`으로 자동 보관된다.
- 결과 JSON의 `permission_denials`로 거부된 호출을 확인할 수 있다.

## S3 상세: 허용 목록은 보호 장치가 되지 못했다

| 규칙 | 시험 | 결과 |
|---|---|---|
| `Bash(.venv/Scripts/python.exe:*)` | `python -c "import os; os.system('whoami')"` | **실행됨** (임의 코드 실행과 같다) |
| `Bash(.venv/Scripts/python.exe:*)` | `cat > file <<EOF` | 거부됨 |
| `Bash(.venv/Scripts/python.exe tools/__init__.py)` (명령 전체 지정) | 같은 명령 / `python -c "print(1)"` | 정확히 그 명령만 실행, `-c`는 거부 |
| `Write` (경로 제한 없음) | 프로젝트 밖 임의 경로에 쓰기 | **실행됨** |
| `Write(//e/...)`, `Write(//E:/...)`, `Write(E:/...)`, `Write(/projects/**)` | 허용 경로 안쪽에 쓰기 | **네 가지 표기 모두 안쪽도 거부됨**. Windows에서 맞는 경로 규칙 표기를 찾지 못함 |

의미: python을 접두사로 허용하면 허용 목록 전체가 무의미해진다. 명령 전체를 지정하는 방식만 믿을 수 있다.

## 설계에 미치는 영향

1. **에이전트에게 python 접두사를 허용하지 않는다.** 에이전트가 쓰는 쓰기 경로를 `bridge/om_tool.py` 하나로 모으고, `Bash(.venv/Scripts/python.exe bridge/om_tool.py:*)`처럼 그 스크립트만 허용한다. 브릿지가 하위 명령(`init`, `checkpoint`, `run-tool`)과 경로를 검증한다. `Write`/`Edit`는 허용하지 않는다(경로 규칙을 확인하지 못했으므로). 에이전트가 도구를 직접 실행하는 파이프라인 단계가 이 제약에서 동작하는지는 P3에서 다시 확인해야 한다.
2. **산출물은 체크포인트 안에 있다.** 두 단계를 거친 뒤에도 `artifacts/` 폴더는 비어 있었고, 정본은 `checkpoint_<stage>.json`의 `artifacts.<이름>`이다. 에이전트 파이프라인을 쓴다면 `docs/design.md`의 `artifacts/script.json` 가정을 바꿔야 했다(이후 결정: 에이전트를 쓰지 않으므로 `artifacts/*.json`을 정본으로 유지한다). GUI는 체크포인트의 `artifacts`를 읽고, 수정은 `write_checkpoint`로 저장한다. 이 함수가 스키마 검증과 승인 게이트 검사를 이미 하므로 Node쪽 AJV 검증은 필요 없다.
3. **게이트는 프로토콜이지 보안이 아니다.** `write_checkpoint`는 `human_approved=True` 없이 완료로 쓰는 것을 막지만, 에이전트가 직접 `True`를 넘길 수는 있다. GUI가 승인한 기록(시각, 단계)을 `studio/`에 따로 남기고 그것을 승인의 근거로 삼는다.
4. **재개 프롬프트에 "수정된 산출물을 디스크에서 다시 읽어라"를 넣는다.** 같은 세션이 이전 내용을 기억하고 있으므로 이 문구가 없을 때 수정본을 무시하는지는 시험하지 않았다.
5. **재개는 같은 cwd에서 한다.** `--resume`은 세션 ID로 이어지며, 세션 저장은 cwd 기준이라 OpenMontage 폴더에서 시작하고 같은 폴더에서 재개한다(`RULES.md` P-02와 일치).

## 시험하지 않은 것

- Codex, OpenCode의 실행/재개 방식.
- 실제 파이프라인(cinematic 등)의 긴 단계, 자동 진행 단계 연속 실행, 도구(이미지/영상/음성) 호출 중 재개.
- 세션이 만료되었거나 PC를 재시작한 뒤의 `--resume`.
- Windows에서 맞는 `Write(경로)` 규칙 표기.
- 승인 없이 재개했을 때(게이트 위반 시도)의 동작.

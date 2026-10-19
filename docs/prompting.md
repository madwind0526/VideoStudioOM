# 프롬프트 만들기

화면의 "프롬프트 만들기"와 "전체 만들기"는 LLM(설정의 LLM 제공자, 실패하면 폴백 순서)에게 짧은 설명을 모델이 좋아하는 프롬프트로 바꾸게 한다. 시스템 프롬프트는 `server/prompts/`에 있다.

| 대상 | 파일 | 근거 |
|---|---|---|
| 이미지(Krea 2) | `krea-image.md` | Krea 공식 `docs/prompting.md`, `docs/expansion.txt`(github.com/krea-ai/krea-2): 자연어 문단, 충실성 우선, 매체 존중, 글자는 큰따옴표 |
| 영상(MiniMax H3) | `h3-video.md` + `server/prompt-maker.mjs` | MiniMax 공식 Video Prompt Writing Guide(huggingface.co/MiniMaxAI/MiniMax-H3/docs): `integrated_multimodal_description`/`overall_soundscape`/`non_diegetic_music` 세 필드, `[Shot n]`, 카메라(종류+폭+속도), `(S1)`와 `<d>`, 정렬 문장(I2V/FL2V). Deno 워크플로 `minimax-h3-r2v-audio-reference`의 프롬프트 디렉터도 참고 |
| 효과음 | `sfx.md` | Stable Audio SFX는 영어 설명 |

- 정렬 문장(`For the target video, at 0.00 seconds ...`, `How the reference pictures align ...`)은 LLM이 아니라 코드가 붙인다(글자 그대로여야 하므로). 클립 길이는 H3 프레임 격자(17k+5)로 맞춘 초를 쓴다.
- H3 답이 세 필드 형식이 아니면 거부하고, 필드 뒤에 붙은 설명은 잘라 낸다. H3 형식 프롬프트에는 `No text, no subtitles` 접미사를 붙이지 않는다(공식 형식에 negative가 없음).
- 이미지 프롬프트는 한 문단만 쓴다. 장면 이미지끼리 모양이 같도록 프로젝트 제목을 맥락으로 준다.
- Claude CLI는 시스템 프롬프트를 파일(`--system-prompt-file`)로, 사용자 설정과 CLAUDE.md 없이(`--setting-sources project`, `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1`) 호출한다. 안 그러면 사용자 지침(작업 요약 등)이 답에 붙는다. 여러 줄 인자는 Windows `.cmd` 래퍼에서 첫 줄에서 잘린다.

## 소리 종류 (대본 구간)
구간마다 대화(TTS) / 효과음 / 연주곡 / 보컬을 고른다. 종류는 `studio/audio_kinds.json`에 저장한다(`script.json`은 OpenMontage 스키마가 고정). 효과음은 `songyue_sfx`, 연주곡과 보컬은 `songyue_music`(가사 있으면 보컬). 보컬의 음악 스타일은 구간의 `speaker_directions`에 적는다. "시간에 맞춰 합치기"는 각 소리를 구간의 시작 시간에 겹쳐 `narration.wav`로 만든다.

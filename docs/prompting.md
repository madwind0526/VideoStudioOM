# 프롬프트 만들기

화면의 "프롬프트 만들기"와 "빠진 ... 모두 만들기"는 LLM(설정의 LLM 제공자, 실패하면 폴백 순서)에게 짧은 설명을 모델이 좋아하는 프롬프트로 바꾸게 한다. 시스템 프롬프트는 `server/prompts/`에 있다.

| 대상 | 파일 | 근거 |
|---|---|---|
| 이미지(Krea 2) | `krea-image.md` | Krea 공식 `docs/prompting.md`, `docs/expansion.txt`(github.com/krea-ai/krea-2): 자연어 문단, 충실성 우선, 매체 존중, 글자는 큰따옴표 |
| 영상(MiniMax H3) | `h3-video.md` + `server/prompt-maker.mjs` | MiniMax 공식 Video Prompt Writing Guide(huggingface.co/MiniMaxAI/MiniMax-H3/docs): `integrated_multimodal_description`/`overall_soundscape`/`non_diegetic_music` 세 필드, `[Shot n]`, 카메라(종류+폭+속도), `(S1)`와 `<d>`, 정렬 문장(I2V/FL2V). Deno 워크플로 `minimax-h3-r2v-audio-reference`의 프롬프트 디렉터도 참고. deAPI의 "MiniMax H3 Prompting Guide"(2026-08-06)에서 컷 간격(약 3초에 한 컷, 샷당 3초 이상), 발화 속도(초당 약 2.5단어), 샷당 화자 1명, 보이스오버는 `says in an off-screen voiceover` + 입을 다문다는 문장, 화면 위치로 인물 고정, 반복되는 사건, 소리 칸 구분(인물이 내는/듣는 소리는 본문), 글자는 크고 대비 높게, 음악 칸은 악기로 쓰기를 가져옴 |
| 효과음 | `sfx.md` | Stable Audio SFX는 영어 설명 |

- 정렬 문장(`For the target video, at 0.00 seconds ...`, `How the reference pictures align ...`)은 LLM이 아니라 코드가 붙인다(글자 그대로여야 하므로). 클립 길이는 H3 프레임 격자(17k+5)로 맞춘 초를 쓴다.
- H3 답이 세 필드 형식이 아니면 거부하고, 필드 뒤에 붙은 설명은 잘라 낸다. H3 형식 프롬프트에는 `No text, no subtitles` 접미사를 붙이지 않는다(공식 형식에 negative가 없음).
- 이미지 프롬프트는 한 문단만 쓴다. 장면 이미지끼리 모양이 같도록 프로젝트 제목을 맥락으로 준다.
- Claude CLI는 시스템 프롬프트를 파일(`--system-prompt-file`)로, 사용자 설정과 CLAUDE.md 없이(`--setting-sources project`, `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1`) 호출한다. 안 그러면 사용자 지침(작업 요약 등)이 답에 붙는다. 여러 줄 인자는 Windows `.cmd` 래퍼에서 첫 줄에서 잘린다.

## 소리 종류 (대본 구간)
구간마다 대화(TTS) / 효과음 / 연주곡 / 보컬을 고른다. 종류는 `studio/audio_kinds.json`에 저장한다(`script.json`은 OpenMontage 스키마가 고정). 효과음은 `songyue_sfx`, 연주곡과 보컬은 `songyue_music`(가사 있으면 보컬). 보컬의 음악 스타일은 구간의 `speaker_directions`에 적는다. "시간에 맞춰 합치기"는 각 소리를 구간의 시작 시간에 겹쳐 `narration.wav`로 만든다.

## 등장인물과 캐릭터 시트
- **등장인물 탭**(대본 다음)에서 영상 전체의 화풍, 인물(이름+설명), 장소를 적는다. 저장 위치는 `studio/bible.json`.
- 인물마다 **자기 캐릭터 시트**(앞·옆·뒤 전신과 표정 얼굴 근접을 한 장에 담은 이미지)를 만든다: 설명 → 프롬프트 만들기(`character-sheet.md`) → 이미지 도구. 결과는 `assets/images/sheet-<인물id>.png`. 시트 만들기는 이미지와 같은 도구·모델·LoRA를 쓰고, 설정 > 고급에 **캐릭터 시트 워크플로** 칸만 따로 있다(비우면 기본 Krea 2).
- 프롬프트 만들기는 설명에 이름이 나온 인물과 장소의 글을 **글자 그대로** 설정집에서 가져와 맥락으로 준다(`server/bible.mjs`). 화풍은 항상 들어간다.
- 영상: 장면 설명에 인물 이름이 있고 시트가 있으면 **R2V**로 만든다(시트 인물당 한 장 최대 8장 + 장면 이미지 1장 = 참조 9장, H3의 한도). 없으면 첫·끝 이미지를 잇는 FL2V. 새로 만들기의 "자동"은 고른 것에 따라 R2V / S2V / FL2V / I2V를 정한다.
- 실측(736×416, 4초, 터보): 시트 2장(노란 스웨터 여자, 초록 재킷 안경 남자) + 벽돌 벽 자전거 장면 → 두 사람의 얼굴·머리·옷이 시트대로 나오고 배경도 장면 이미지를 따름.

## H3 연속 샷 규칙 (`h3-video.md`의 CONTINUITY)
joeygambino의 H3 Multishot `PROMPTING.md`와 Pat3dx Story Studio에서 가져온 규칙: 인물·장소 묘사를 샷마다 그대로 반복, 안정된 자세로 시작하고 끝남(대사 + 약 4초 여유가 샷 안에), 샷마다 되돌릴 수 없는 물리적 변화 하나, 부정·정지 표현 금지, 5초 샷에는 대사를 넣지 않음.

## 줄거리·시나리오·대본 생성 (`server/story.mjs`)
- 흐름: 아이디어 → **줄거리 4안**(고르기) → 줄거리에서 **등장인물·장소 뽑기**(설정집 초안) → **시나리오**(장면 목록) → **대본**(장면마다 대화/효과음/연주곡/보컬). 각 단계는 저장된 파일을 읽어 초안을 돌려주고, 사람이 고치고 저장한다(되돌리기 가능).
- 시스템 프롬프트: `story-synopsis.md`, `story-bible.md`, `story-scenario.md`, `story-script.md`. OpenMontage `skills/creative/storytelling.md`(but/therefore, 훅 유형, 시각적 원인으로 쓰기), `skills/pipelines/cinematic/scene-director.md`(주체·움직임·장면·프레이밍·카메라 5요소)를 요약해 넣었다.
- 연출 프리셋 13종(`shared/presets.mjs`, 영화풍/다큐/뮤직비디오/광고/액션/로맨스/스릴러/코미디/판타지/SF/공포/브이로그/스포츠)은 설정집에 저장되어 줄거리부터 모든 이미지·영상 프롬프트에 한 줄로 들어간다.
- LLM 출력은 JSON으로 받고(`parseJson`) 틀리면 이유를 알려 한 번 다시 묻는다. 장면 길이는 코드가 0.5초 단위, 2~15초로 고쳐 총 길이에 맞춘다.

## 설정집 확장
- 인물 **참고 사진**(내 사진 가져오기 또는 프로젝트 이미지 선택, 4장까지)은 시트와 함께 R2V 참조가 된다(시트 먼저, 남는 자리에 사진). **다른 옷차림**: 장면 설명에 옷차림 이름이 나오면 그 장면만 새 옷(얼굴·머리 유지).
- 장면별 LoRA(`studio/scene_opts.json`)는 그 장면의 이미지·영상에만 추가된다(`extra_loras`).

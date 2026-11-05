# TODO

작성: 2026-11-05. 내일 이어서 할 일. 위에서부터 순서대로.

## 0. 먼저 정리할 것 (어제까지 한 일)

아직 **커밋하지 않은** 변경이 많다. 이미지 메뉴 작업을 시작하기 전에 정리한다.

- [ ] `git status`로 변경을 확인하고, 아래처럼 나눠서 커밋할지 정한다 (이미 있던 변경과 섞여 있으니 파일별로 확인).
  - 그림 설명 (QwenVL 4B): `server/describe.mjs`, `server/engine/graphs.mjs`(qwenVl 그래프), `server/engine/tools.mjs`(`describe_image`, `describe_video`), `server/routes.mjs`(`/api/prompt`), `server/prompt-maker.mjs`, 화면(`GenerateForm`, `ScenarioSection`, `mediaJobs.ts`), `test/describe.test.mjs`
  - 참조 영상 선택 칸: `GenerateForm.tsx`, `mediaJobs.ts`, `MediaSections.tsx`
  - 이어붙이기 방식(모션 이어받기): `shared/settings.mjs`, `src/fields.ts`, `src/pages/SettingsPage.tsx`, `graphs.mjs`, `tools.mjs`, `mediaJobs.ts`, `docs/engine.md`, `test/engine-tools.test.mjs`
- [ ] 설정 → 영상 → **이어붙이기 방식**을 화면에서 직접 바꿔 보고, 실제 장면으로 R2V / I2V / S2V 클립을 이어 만들어 본다 (지금은 도구를 직접 불러서만 확인했다).
- [ ] **FL2V는 모션 이어받기 안 됨** (끝 그림을 고정하면 이어지는 클립이 다른 장면으로 시작, 이음새 변화량 약 65). 원인 미확인. 계속 팔지, 지금 상태로 둘지 결정. 시험 영상: `E:\Claude\chain-compare\fl2v\`
- [ ] 영상 눈으로 확인: `E:\Claude\chain-compare\` (`A_ours_joined.mp4` / `B_chain_joined.mp4`, `impl\`, `i2v\`, `s2v\`). 다 본 뒤 폴더를 지울지 정한다.
- [ ] `memory-bank` 갱신 (CACHE → knowledge로 flush). 적을 것:
  - `/api/prompt`가 그림을 먼저 설명해서 LLM에 넘긴다 (캐시는 `studio/descriptions.json`, 그림 경로 + 수정 시간 기준). 저장할 때 읽은 시점의 `mtimeMs`를 넘겨야 한다 (안 넘기면 두 번째부터 409).
  - QwenVL은 Rev0(8188)에만 있고 `ImageResize+`는 없음 (뺐다). 4B 4-bit, 처음 한 번 모델 내려받음.
  - 모션 이어받기는 Rev0의 `MiniMaxH3MotionContext*` 노드. 이어지는 클립은 39프레임 더 만들고 잘라 낸다 (17프레임 격자로 올림). latent는 `<클립>.latent`로 클립 옆에 저장 (4~6MB).
  - netstat 출력이 한글이라 `start.bat`/`stop.bat`의 `findstr "LISTENING"`이 안 맞는 듯 (확인 필요, 아래 참고).
- [ ] Rev0(8188)이 켜져 있다. 필요 없으면 끈다 (설정 화면의 "VRAM 비우기"는 모델만 내린다).
- [ ] `start.bat` / `stop.bat`이 4314 서버를 못 찾아서 못 끈다 (어제 확인). 원인 조사 (한글 netstat로 추정). 고치면 `C:\Claude\memory-bank\`에도 적을 만하다.
- [ ] `codereview.md`는 내가 만든 것이 아님 (이전부터 untracked). 그대로 두거나 사용자가 정리.

## 1. 이미지 메뉴 (새 기능)

### 방향
- VideoStudioOM 안에 **"이미지" 메뉴**를 만든다. 별도 앱은 만들지 않는다 (GPU 하나를 Krea 8190 / QwenVL Rev0 / H3가 번갈아 쓰는데, 그 교체 관리가 이 앱에 이미 있다).
- 나중에 떼어낼 수 있게 `server/images/`와 `/api/images/*`로 경계를 나눈다.
- 기본 저장소는 **프로젝트에 묶이지 않는 "이미지 보관함"**. 마음에 든 그림은 "프로젝트로 보내기".
- 만든 그림마다 기록(종류, 프롬프트, 시드, 뽑은 조합, 원본 그림)을 옆에 남겨 "다시 만들기"가 되게 한다 (지금의 Recipe/versions 방식 그대로).

### 먼저 확인할 것 (스파이크, 1~2시간)
- [x] (2026-11-06 확인: 됨) 보관함을 **숨은 프로젝트**(예: id `_images`)로 두는 게 가장 싸다: jobs, versions, 미디어 목록, 기록(record), `describePictures` 캐시를 전부 그대로 쓴다. 프로젝트 목록과 라이브러리에서 걸러 내는 곳이 몇 군데인지 센다 (`server/projects.mjs` 목록, `LibraryPage`, 최근 프로젝트).
  - 안 되면: `storage.outputDir/images/` 폴더를 따로 읽는 작은 저장소를 만든다.
- [ ] Krea 한 장이 이 GPU에서 몇 초인지 재 둔다 (N장 배치의 시간 기준). 같은 방식으로 Qwen 편집(25스텝)도.

### 단계

**1단계: 메뉴 + 보관함 + T2I N장**
- [x] 사이드바에 "이미지" 메뉴, 주소 `#/images`, `src/pages/ImagesPage.tsx` (탭은 아직 없음: 만들기 한 화면. 탭은 2단계부터)
- [x] 저장소는 숨은 프로젝트 `_images`(`projects.ensureHidden`, 목록에서 제외) + `POST /api/images/ensure`. 별도 `server/images/`는 2단계부터 필요하면 만든다.
- [x] 만들기: 프롬프트(+ "프롬프트 만들기", `krea-image.md` 재사용), 크기, **장수 N**, 시드(고정/무작위), 화풍·LoRA(설정의 `engine.image`). N장은 큐에 N개 작업으로 넣는다 (한 번에 GPU 하나).
- [~] 결과 격자: 삭제, 크게 보기, 프롬프트/버전 보기는 됨. 즐겨찾기는 아직.
- [x] 시험: 숨은 프로젝트(`test/projects.test.mjs`, `test/api.test.mjs`). 실제로 2장 만들어 확인(2026-11-06).

**2단계: 분석해서 변주**
- [x] (2026-11-06) `POST /api/images/analyze`: 그림 → `describe_image`(QwenVL 4B) → LLM이 Krea 프롬프트로 정리 (`server/prompts/image-vary.md`, 영어, 글자가 그림에 그려지지 않게)
- [x] 화면(`src/pages/ImageVary.tsx`): 분석 결과 프롬프트를 **직접 고칠 수 있게** 보여 준 뒤 변주를 N장 만든다
  - 시드만 바꾸기
  - 한 축만 바꾸기 (의상 / 배경 / 시간대 / 포즈): LLM이 문장을 다시 쓰거나, 3단계 풀에서 뽑는다
  - 화풍은 두고 주제만 바꾸기
- [~] 모델 교체를 줄인다 (분석은 한 번, 변주는 LLM 한 번 호출로 N개를 받음; 생성은 큐에서 이어서). 화풍은 두고 주제만 바꾸기는 아직 없음: 분석(Rev0) → 프롬프트(LLM) → 생성(8190) 순서로 **한 번만 갈아타게** 묶어 처리
- [ ] 4B의 설명에는 작은 추측이 섞인다 → 프롬프트를 고칠 수 있게 두는 것이 전제

**3단계: 랜덤 조합 (MusicAutomation 방식)**
- [ ] `data/image-pools.json`: 카테고리 = 인물 / 의상 / 화풍 / 배경(장소·시간·날씨) / 동작 / 소품. 한글로 쓰고 LLM이 영어 프롬프트로 바꾼다 (MusicAutomation `direction-pool.mjs`와 같은 방식, 가져올 때 출처 커밋을 주석에 남긴다).
- [ ] `server/images/pool.mjs`: 카테고리별로 뽑기, **고정(🔒) / 다시 뽑기(🎲)**, `random`을 주입할 수 있게 해서 시험 가능하게
- [ ] 화면: 카테고리 칩 + 합친 문장 미리보기 + "자동 N장". 풀 편집 화면. 처음 풀은 LLM에게 채우게 한 뒤 직접 다듬는다.
- [ ] 합친 문장 → LLM 확장(품질) 또는 템플릿 그대로(속도) 중 고르게 한다

**4단계: 참조로 만들기 (I2I / R2I) + 프로젝트로 보내기**
- [ ] 탭: 그림 1~9장을 고르고 "고쳐 그리기" 또는 "이 인물들의 새 그림" (`comfyui_image_edit`, `blank_canvas`)
- [ ] 설정집(bible)의 캐릭터 시트를 참조로 고를 수 있게
- [ ] "프로젝트로 보내기": 장면 첫 그림(`assets/images/N-1.png`), 참조 그림, 설정집 인물. 기존 `/api/projects/:id/import`와 `arrange`를 재사용.

### 공통
- [ ] 단계마다 시험을 같이 쓴다 (지금 149개 통과 상태를 유지).
- [ ] 단계가 끝날 때마다 `memory-bank` flush, `docs/`에 짧게 정리.
- [ ] 포트는 새로 필요 없음 (통합). 나중에 별도 앱으로 떼면 `C:\Claude\PORTS.md`에서 먼저 배정.

## 2. 정해야 할 것
- 이미지 보관함: 숨은 프로젝트 vs 별도 폴더 (스파이크 결과로 정한다)
- 랜덤 풀: 카테고리와 처음 문구를 누가 채울지 (LLM 초안 + 직접 편집 권장)
- 이미지 모델: Krea 2 Turbo만 쓸지, Qwen Image 2.1로 T2I도 할지 (Qwen 인물 유지 품질은 직접 써 본 경험을 알려 주세요)
- FL2V 모션 이어받기를 더 팔지 (위 0번)

## 3. 아직 확인하지 못한 것 (가정하지 말 것)
- Krea / Qwen 편집의 장당 시간
- 분석 → 변주 한 번에 모델을 몇 번 갈아타는지의 실제 시간
- 모션 이어받기가 사람 눈에 확실히 더 좋은지 (수치는 좋았지만 장면 내용이 달라져 단정 못 함. 4쌍 이상으로 비교하려던 계획은 하지 않았음)
- S2V 모션 이어받기에서 입 모양이 노래와 맞는지 (수치로는 못 잼, 눈으로 확인)

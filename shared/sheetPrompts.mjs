/**
 * The five character sheet prompts (one picture of a person in, one sheet picture out). `text` names the reference picture as
 * "the attached reference photo"; `sheetPromptFor` puts the wording of the model in its place. `size` is the sheet's shape.
 * `ref` is the example picture of the layout (kept in the image library as sheet-ref-<ref>).
 */
/** How captions under the tiles are asked for: short exact words in capitals; models spell those far better than sentences. */
const CAPTION = "Under every tile there is a caption of exactly one short English word or two, written in large, black, UPPERCASE letters, centred under the tile, perfectly sharp and spelled exactly as given below. Use only the Latin alphabet; no Chinese, Japanese or Korean characters, no other text anywhere on the picture.";

const SAME =
  "The person must be exactly the person of the attached reference photo in every tile: the same face, facial features, skin tone, age, hair colour, body proportions and clothing. Photorealistic photography, natural skin texture, soft even studio lighting, sharp focus. No watermark, no logo, no extra people, no text other than the captions asked for.";

export const SHEET_TYPES = [
  {
    id: "default",
    label: "1. 기본 (정면 상반신 + 측면·정면·뒷면 전신)",
    title: "캐릭터 시트 1 · 기본 (정면 상반신 + 측면·정면·뒷면 전신)",
    note: "기본형. 왼쪽에 정면 상반신, 오른쪽에 측면·정면·뒷면 전신. 참조 사진(얼굴이 잘 보이는 사진) 한 장과 함께 쓰세요. 참고 이미지: 얼굴 클로즈업 + 옆모습·앞모습·뒷모습.",
    ref: "4.png",
    size: [1248, 832],
    text: `Create one character reference sheet as a single 3:2 landscape photograph on a plain mid-grey seamless studio background, using the person in the attached reference photo as the only subject.
Layout: the left third is one large front-facing upper-body portrait (head to waist) of the person standing straight to the camera, calm neutral expression, arms relaxed, the face and hair fully visible, cropped at the waist. The right two thirds show three full-body standing photographs side by side at the same scale on the same ground line, from head to shoes: first the LEFT-SIDE profile view (the person faces left), then the FRONT view, then the BACK view. Arms relaxed at the sides, feet slightly apart, neutral standing posture, identical outfit and shoes in all three views, nothing held in the hands.
${SAME}`,
  },
  {
    id: "camera",
    label: "2. 카메라 뷰 20종 (정면 상반신 + 앵글별)",
    title: "캐릭터 시트 2 · 카메라 뷰 20종 (정면 상반신 + 앵글별)",
    note: "왼쪽 정면 상반신 + 오른쪽 20칸 앵글표. 칸 아래 이름표는 짧은 영어 대문자 단어로 지정해 두었습니다(글자가 깨지면 CAPTION 문장과 따옴표 안의 단어를 줄이거나 지우세요). 참고 이미지: Camera Angle 20. 로컬 모델(특히 Flux.2 klein)은 칸이 많으면 일부만 그리거나 이름표 글자가 깨질 수 있습니다. 칸이 많은 시트는 Qwen Image Edit이나 API 모델(Nano Banana 등)이 낫습니다.",
    ref: "1.jpg",
    size: [1344, 768],
    text: `Create one character sheet as a single 16:9 landscape image on a clean white background, using the person in the attached reference photo as the only subject.
Layout: the left fifth is one large front-facing upper-body portrait (head to waist) of the person standing straight to the camera, calm neutral expression, arms relaxed. The right four fifths are a tidy grid of 4 columns by 5 rows of equal 4:3 tiles with thin dark borders; every tile shows the SAME person in the SAME outfit in the SAME bright outdoor setting, each tile photographed with a different camera angle.
${CAPTION}
The 20 tiles in reading order, each with its exact caption in quotes: 1 eye-level shot "EYE LEVEL", 2 tilted horizon "DUTCH ANGLE", 3 seen from behind "REAR VIEW", 4 lines of the scene lead to the person "LEADING LINES", 5 camera above looking down "HIGH ANGLE", 6 first person with her hands in the foreground "POV", 7 symmetrical framing "SYMMETRY", 8 framed by foreground leaves or a doorway "FRAMED", 9 camera below looking up "LOW ANGLE", 10 over-the-shoulder shot "OVER SHOULDER", 11 asymmetrical framing "ASYMMETRY", 12 golden ratio composition "GOLDEN RATIO", 13 straight down from far above "BIRD'S EYE", 14 side profile "PROFILE", 15 rule of thirds "THIRDS", 16 small figure in a large empty scene "EMPTY SPACE", 17 from the ground up "WORM'S EYE", 18 three-quarter view "3/4 VIEW", 19 centred framing "CENTERED", 20 the face fills the whole tile "FILL FRAME".
${SAME}`,
  },
  {
    id: "hair",
    label: "3. 머리 모양 12종 (정면 상반신 + 헤어스타일별)",
    title: "캐릭터 시트 3 · 머리 모양 12종 (정면 상반신 + 헤어스타일별)",
    note: "왼쪽 정면 상반신 + 오른쪽 12칸. 대안 목록(스타일링 12종, 3번째 도감): Half-Up Curls, Low Ponytail, Loose Side Twist, Medium Waves, Braided Half-Up, Top Accessory Style, French Twist, Tucked Updo, Ribbon Half-Up, Side Chignon, Wavy Ponytail, Rope Braid. 참고 이미지: 한눈에 보는 헤어스타일 도감. 로컬 모델(특히 Flux.2 klein)은 칸이 많으면 일부만 그리거나 이름표 글자가 깨질 수 있습니다. 칸이 많은 시트는 Qwen Image Edit이나 API 모델(Nano Banana 등)이 낫습니다.",
    ref: "2.jpg",
    size: [1248, 832],
    text: `Create one hairstyle character sheet as a single 3:2 landscape photograph on a plain soft light-grey studio background, using the person in the attached reference photo as the only subject.
Layout: the left third is one large front-facing upper-body portrait (head to waist) of the person with her ORIGINAL hairstyle, standing straight to the camera, calm neutral expression. The right two thirds are a tidy grid of 4 columns by 3 rows of equal head-and-shoulders tiles, every tile the same crop, the same plain white top, the same lighting, the same neutral expression, only the hairstyle changes.
${CAPTION}
The 12 tiles in reading order, each with its exact caption in quotes: 1 very short hair "VERY SHORT", 2 short hair "SHORT", 3 short bob "SHORT BOB", 4 bob at the chin "BOB", 5 medium length hair "MEDIUM", 6 semi-long hair "SEMI-LONG", 7 long hair "LONG", 8 ponytail "PONYTAIL", 9 half up half down "HALF UP", 10 hair in a bun "BUN", 11 twin tails "TWIN TAIL", 12 three-strand braid "BRAID". Keep the hair colour and the face identical in every tile.
${SAME}`,
  },
  {
    id: "emotion",
    label: "4. 감정 12종 (정면 상반신 + 표정별)",
    title: "캐릭터 시트 4 · 감정 12종 (정면 상반신 + 표정별)",
    note: "왼쪽 정면 상반신 + 오른쪽 12칸 표정표. 참고 이미지가 없어 머리 모양 도감(2번째)의 레이아웃을 참고했습니다. 로컬 모델(특히 Flux.2 klein)은 칸이 많으면 일부만 그리거나 이름표 글자가 깨질 수 있습니다. 칸이 많은 시트는 Qwen Image Edit이나 API 모델(Nano Banana 등)이 낫습니다.",
    ref: "2.jpg",
    size: [1248, 832],
    text: `Create one facial-expression character sheet as a single 3:2 landscape photograph on a plain soft light-grey studio background, using the person in the attached reference photo as the only subject.
Layout: the left third is one large front-facing upper-body portrait (head to waist) of the person standing straight to the camera with a calm neutral expression. The right two thirds are a tidy grid of 4 columns by 3 rows of equal head-and-shoulders tiles, every tile the same crop, the same plain white top, the same lighting and the same hairstyle, only the emotion on the face changes.
${CAPTION}
The 12 tiles in reading order, each with its exact caption in quotes: 1 neutral calm face "NEUTRAL", 2 a gentle smile "SMILE", 3 laughing with open mouth "LAUGH", 4 sad "SAD", 5 crying with tears "CRY", 6 angry "ANGRY", 7 surprised "SURPRISE", 8 scared "SCARED", 9 disgusted "DISGUST", 10 shy and embarrassed "SHY", 11 tired and sleepy "SLEEPY", 12 smug and confident "SMUG". The expressions are natural and readable, shown with the eyes, eyebrows and mouth, not exaggerated like a cartoon.
${SAME}`,
  },
  {
    id: "profile",
    label: "5. 상세 캐릭터 프로필 (왼쪽 정면 상반신 + 설정집)",
    title: "캐릭터 시트 5 · 상세 캐릭터 프로필 (왼쪽 정면 상반신 + 설정집)",
    note: "왼쪽에 정면 상반신, 오른쪽에 설명이 많이 들어가는 프로필 패널들. [대괄호] 부분(이름, 역할, 나이, 나라, 키, 체형)을 짧은 영어로 채워 쓰세요. 글자는 이미지 모델이 깨뜨리기 쉬워서 제목과 짧은 값만 영어 대문자로 적게 했고, 긴 설명 문장은 넣지 않았습니다. 설명은 따로 붙이세요. 참고 이미지: 설정집 형식의 시트.",
    ref: "5.png",
    size: [1344, 768],
    text: `Create one detailed character profile sheet as a single 16:9 landscape infographic with a dark charcoal background and thin gold divider lines, using the person in the attached reference photo as the only subject, in a premium editorial design.
All writing on the sheet is in English, in large UPPERCASE letters, perfectly sharp and spelled exactly as given. Write only the words in quotes below and nothing else: no sentences, no paragraphs, no small print, no Chinese, Japanese or Korean characters. Everything else is shown with pictures, not words.
Top left: the title "CHARACTER SHEET" and a data block of six lines with these exact labels and values: "NAME: [name]", "ROLE: [role]", "AGE: [age]", "FROM: [country]", "HEIGHT: [height]", "BODY: [body type]". Left column: one large front-facing upper-body portrait (head to waist) of the person standing straight to the camera, calm neutral expression, arms relaxed, the full height of the sheet. All other panels are on the right of it.
Top right: a row titled "FACE" of four close-up photographs captioned "EYES", "NOSE", "LIPS", "PROFILE" (the profile one is a side view of the face).
Middle: four panels titled "FULL BODY" (front view and back view, head to shoes), "HAIR" (front, side and back views), "OUTFIT" (the clothing laid out piece by piece, without any text) and "POSES" (six small full-body poses: standing, walking, turning, looking back, sitting, hands in motion).
Bottom: a strip titled "COLORS" of five plain colour swatches without any text, taken from the skin, hair, eyes, clothing and an accent colour, and a strip titled "SAME FACE" of six head-and-shoulders portraits of the SAME face in a row.
The person must be exactly the person of the attached reference photo wherever she appears: the same face, skin tone, hair and clothing. Photorealistic photographs inside the panels, no watermark, no logo.`,
  },
];

/** The prompt of one sheet type with the wording the model uses for the reference picture ("<image2>", "the first picture", ...). */
export const sheetPromptFor = (id, reference = "the attached reference photo") => {
  const type = SHEET_TYPES.find((item) => item.id === id);
  if (!type) throw new Error(`알 수 없는 시트 종류입니다: ${id}`);
  return type.text.replaceAll("the attached reference photo", reference);
};

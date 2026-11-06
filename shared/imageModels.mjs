// The models of the image menu (the model list of every tab and the "고급" pop-up read this). `kinds` are the tabs that offer
// the model: t2i (text), i2i (edit pictures), r2i (new picture from reference pictures). `defaults` are the sampling values
// the model is made for; a value left at its default is not sent (the server's graph uses its own, the same).
export const SAMPLING_DEFAULTS = { steps: 8, cfg: 1, sampler_name: "euler", scheduler: "simple" };

const ALL_FIELDS = ["steps", "cfg", "sampler_name", "scheduler"];

export const IMAGE_MODELS = [
  {
    id: "krea2-turbo",
    label: "Krea 2 Turbo",
    kinds: ["t2i"],
    tool: "comfyui_krea_image",
    defaults: { ...SAMPLING_DEFAULTS },
    fields: ALL_FIELDS,
    note: "Turbo 모델은 8스텝, CFG 1에 맞춰져 있어서 값을 크게 바꾸면 그림이 깨지기 쉽습니다.",
  },
  {
    id: "zimage-turbo",
    label: "Z-Image Turbo",
    kinds: ["t2i"],
    tool: "comfyui_t2i",
    input: { model: "zimage-turbo" },
    defaults: { steps: 8, cfg: 1, sampler_name: "res_multistep", scheduler: "simple" },
    fields: ALL_FIELDS,
    note: "8스텝, CFG 1, res_multistep이 기본입니다(ComfyUI의 Z-Image Turbo 워크플로 값). Turbo 모델이라 CFG를 올리면 그림이 깨지기 쉽습니다.",
  },
  {
    id: "qwen-image-2512",
    label: "Qwen Image 2512 (Lightning 4스텝)",
    kinds: ["t2i"],
    tool: "comfyui_t2i",
    input: { model: "qwen-image-2512" },
    defaults: { steps: 4, cfg: 1, sampler_name: "euler", scheduler: "simple" },
    fields: ALL_FIELDS,
    note: "4스텝 Lightning LoRA가 붙어 있어서 4~8스텝, CFG 1에 맞춰져 있습니다. 한글과 영문 글자 표현이 강한 모델입니다.",
  },
  {
    id: "flux2-klein",
    label: "Flux.2 klein",
    kinds: ["t2i"],
    tool: "comfyui_t2i",
    input: { model: "flux2-klein" },
    defaults: { steps: 20, cfg: 5, sampler_name: "euler" },
    fields: ["steps", "cfg", "sampler_name"],
    note: "20스텝, CFG 5, euler가 기본입니다(ComfyUI의 Flux2 klein 워크플로 값). 스케줄러는 Flux.2 전용으로 고정되어 있습니다.",
  },
  {
    id: "qwen-edit-2.1",
    label: "Qwen Image Edit 2.1",
    kinds: ["i2i", "r2i"],
    maxPictures: 10,
    naming: "tokens",
    tool: "comfyui_image_edit",
    defaults: { ...SAMPLING_DEFAULTS, steps: 25 },
    fields: ALL_FIELDS,
    note: "25스텝, CFG 1이 기본입니다. 스텝을 줄이면 빨라지고 디테일이 거칠어집니다.",
  },
  {
    id: "krea2-identity",
    label: "Krea 2 + Identity Edit",
    kinds: ["i2i", "r2i"],
    tool: "comfyui_edit_model",
    input: { model: "krea2-identity" },
    maxPictures: 2,
    naming: "plain",
    defaults: { ...SAMPLING_DEFAULTS },
    fields: ALL_FIELDS,
    note: "첫 그림을 편집하고, 둘째 그림은 그 안에 넣을 인물이나 참조입니다(그림은 2장까지). 인물의 얼굴을 잘 유지합니다. 기본은 8스텝, CFG 1이고, 물건 지우기 같은 삭제 편집은 Turbo로는 잘 안 됩니다.",
  },
  {
    id: "flux2-klein-edit",
    label: "Flux.2 klein",
    kinds: ["i2i", "r2i"],
    tool: "comfyui_edit_model",
    input: { model: "flux2-klein" },
    maxPictures: 4,
    naming: "plain",
    defaults: { steps: 4, cfg: 1.3, sampler_name: "euler" },
    fields: ["steps", "cfg", "sampler_name"],
    note: "그림 4장까지 참조로 받아 첫 그림을 편집합니다. 4스텝, CFG 1.3이 기본입니다(ComfyUI의 Flux2 klein I2I 워크플로 값). 스케줄러는 고정입니다.",
  },
  {
    id: "krea2-pose",
    label: "Krea 2 + Pose (DWPose 뼈대)",
    kinds: ["r2i"],
    tool: "comfyui_krea_control",
    input: { control: "pose" },
    control: "pose",
    defaults: { ...SAMPLING_DEFAULTS, steps: 10 },
    fields: ALL_FIELDS,
    note: "포즈 그림에서 뼈대를 뽑아 그 자세대로 새로 그립니다. 모습, 옷, 배경은 프롬프트로 정합니다(참조 그림의 얼굴은 반영되지 않습니다). 결과는 포즈 그림과 비슷한 모양이고, 기본은 10스텝, CFG 1입니다.",
  },
  {
    id: "krea2-depth",
    label: "Krea 2 + Depth (깊이 지도)",
    kinds: ["r2i"],
    tool: "comfyui_krea_control",
    input: { control: "depth" },
    control: "depth",
    defaults: { ...SAMPLING_DEFAULTS },
    fields: ALL_FIELDS,
    note: "첫 참조 그림의 깊이 지도(Depth Anything V2)를 따라 구도와 입체감을 유지하면서 프롬프트대로 새로 그립니다. 처음 쓸 때 깊이 모델 파일을 내려받습니다.",
  },
];

export const modelsFor = (kind) => IMAGE_MODELS.filter((model) => model.kinds.includes(kind));

/** The sampling fields of the pop-up: key (the tool input), label, kind of input. */
export const SAMPLING_FIELDS = [
  { key: "steps", label: "스텝 수", type: "int", min: 1, max: 150, step: 1 },
  { key: "cfg", label: "CFG", type: "float", min: 0, max: 30, step: 0.1 },
  { key: "sampler_name", label: "샘플러", type: "sampler" },
  { key: "scheduler", label: "스케줄러", type: "scheduler" },
];

/** Only the values that differ from the model's defaults (what is worth sending and keeping with a picture). */
export function changedSampling(model, values) {
  const out = {};
  for (const { key } of SAMPLING_FIELDS.filter((field) => model.fields.includes(field.key))) {
    const value = values?.[key];
    if (value !== undefined && value !== "" && value !== model.defaults[key]) out[key] = value;
  }
  return out;
}

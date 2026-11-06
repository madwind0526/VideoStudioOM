// The ways a picture can be enlarged (server and pop-up share this list). `node` and `field` say where ComfyUI lists the
// choices of the "model" of a workflow; `fixed` is a workflow whose model is part of its node; `preferred` are the choices
// (first match) the pop-up starts with.
export const UPSCALE_WORKFLOWS = [
  { id: "rtx", label: "RTX 2패스 (Deblur → High Bitrate)", modelLabel: "사용할 모델", fixed: "RTX VFX (Deblur Ultra + High Bitrate High)" },
  { id: "srfp", label: "SRFPTyp 이미지 업스케일러 (RTX 복원)", modelLabel: "복원 방식", node: "SRFPTypImageUpscaler", field: "restore_mode", preferred: ["Deblur Low"] },
  { id: "seedvr2", label: "SeedVR2 (확산 모델 복원)", modelLabel: "SeedVR2 DiT 모델", node: "SeedVR2LoadDiTModel", field: "model", preferred: ["seedvr2_ema_3b_fp8", "seedvr2_ema_3b"] },
  { id: "model", label: "업스케일 모델 (ESRGAN 계열)", modelLabel: "사용할 모델", node: "UpscaleModelLoader", field: "model_name", preferred: ["4xUltrasharp", "4x_NMKD-Siax"] },
  { id: "zimage", label: "모델 확대 + Z-Image Turbo 다듬기", modelLabel: "확대 모델 (다듬기는 Z-Image Turbo)", node: "UpscaleModelLoader", field: "model_name", preferred: ["4xUltrasharp", "4x_NMKD-Siax"] },
];

export const UPSCALE_IDS = UPSCALE_WORKFLOWS.map((workflow) => workflow.id);

/** The choice a workflow starts with among the installed ones: the first preferred match, else the first one ("" for none). */
export function defaultUpscaleModel(workflowId, names) {
  const workflow = UPSCALE_WORKFLOWS.find((item) => item.id === workflowId);
  if (workflow?.fixed) return workflow.fixed;
  return (workflow?.preferred ?? []).map((part) => names.find((name) => name.includes(part))).find(Boolean) ?? names[0] ?? "";
}

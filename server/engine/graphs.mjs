/**
 * The built-in ComfyUI graphs (API format), as plain functions. They are the ones that were checked on this PC against
 * ComfyUI 0.39 core nodes: Krea 2 Turbo images, MiniMax H3 video (I2V, FL2V, S2V, R2V) and the RTX 2-pass upscale.
 * Files (images, video, audio) must already be uploaded: the functions take the names ComfyUI gave them.
 */

// MiniMax H3 model files (under the model library of SongYUE2's ComfyUI).
export const H3 = {
  unet: "MiniMaxH3\\minimax_h3_fl2va_pruned_int8_convrot.safetensors",
  lora: "MiniMaxH3\\minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors",
  clip: "MiniMaxH3\\qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
  videoVae: "MiniMaxH3\\minimax_h3_video_vae_fp16.safetensors",
  audioVae: "MiniMaxH3\\minimax_h3_audio_vae_fp32.safetensors",
  refUnets: {
    turbo: "MiniMaxH3\\10Eros_Max_h3_TURBO_ref2va_beta2_int8_convrot.safetensors",
    official: "MiniMaxH3\\minimax_h3_ref2va_pruned_int8_convrot.safetensors",
    // The model of the Deno R2V workflow (Singularity ref2va v1.3), run with its 8-step DMD LoRA and sigma shift 12/3.
    deno: "MiniMaxH3\\Minimax-h3_Singularity_ref2va_Pruned_v1.3_int8.safetensors",
  },
  denoClip: "MiniMaxH3\\qwen3vl_32b_minimax_h3_int8_convrot.safetensors",
  latentUpscaler: "MiniMaxH3\\minimax_h3_latent_upscaler_3d_fp16.safetensors",
  denoLora: "MiniMaxH3\\minimax_h3_dmd_ref2va_8step_turbo_pruned.safetensors",
};
export const NEGATIVE_SUFFIX = " No text, no subtitles, no watermark.";

/** H3 only accepts frame counts on the 17k+5 grid (24 fps): 124 = 5.17 s. */
export function h3Frames(seconds) {
  const frames = Math.max(5, Math.round(seconds * 24));
  return 17 * Math.ceil((frames - 5) / 17) + 5;
}

/**
 * A prompt already in the official three-field format is sent as written (that format has no negative prompt);
 * any other prompt gets the short "no text" ending.
 */
export const h3Prompt = (prompt) => {
  const text = prompt.trim();
  return text.includes("integrated_multimodal_description:") || text.includes("detailed_description:") || text.includes(NEGATIVE_SUFFIX.trim()) ? text : text + NEGATIVE_SUFFIX;
};

const KREA_PATTERNS = {
  unet: [/krea2[_-]turbo.*nvfp4/i, /krea2[_-]turbo.*fp8[_-]?scaled/i, /krea2[_-]turbo.*fp8/i],
  clip: [/qwen3vl[_-]4b[_-]fp8[_-]?scaled/i, /qwen3vl[_-]4b/i],
  vae: [/qwen_image_vae\.safetensors$/i],
};

/** The best installed file for each Krea model (best match first), or null when one is missing. */
export function pickKreaModels({ unets, clips, vaes }) {
  const pick = (names, patterns) => {
    for (const pattern of patterns) {
      const found = names.find((name) => pattern.test(name));
      if (found) return found;
    }
    return null;
  };
  const picked = { unet: pick(unets, KREA_PATTERNS.unet), clip: pick(clips, KREA_PATTERNS.clip), vae: pick(vaes, KREA_PATTERNS.vae) };
  return picked.unet && picked.clip && picked.vae ? picked : null;
}

/** Krea 2 Turbo text to image. The result is the PreviewImage node "10". */
export function kreaGraph({ prompt, width = 1536, height = 864, steps = 8, cfg = 1, sampler = "euler", scheduler = "simple", seed, models }) {
  return {
    1: { class_type: "UNETLoader", inputs: { unet_name: models.unet, weight_dtype: "default" } },
    2: { class_type: "CLIPLoader", inputs: { clip_name: models.clip, type: "krea2", device: "default" } },
    3: { class_type: "VAELoader", inputs: { vae_name: models.vae } },
    4: { class_type: "CLIPTextEncode", inputs: { text: prompt, clip: ["2", 0] } },
    5: { class_type: "ConditioningZeroOut", inputs: { conditioning: ["4", 0] } },
    7: { class_type: "EmptyLatentImage", inputs: { width, height, batch_size: 1 } },
    8: { class_type: "KSampler", inputs: { model: ["1", 0], seed, steps, cfg, sampler_name: sampler, scheduler, positive: ["4", 0], negative: ["5", 0], latent_image: ["7", 0], denoise: 1.0 } },
    9: { class_type: "VAEDecode", inputs: { samples: ["8", 0], vae: ["3", 0] } },
    10: { class_type: "PreviewImage", inputs: { images: ["9", 0] } },
  };
}

/** The best installed file for each Qwen Image 2512 model (with its 4-step Lightning LoRA), or null when one is missing. */
export function pickQwenImageModels({ unets, clips, vaes, loras }) {
  const pick = (names, patterns) => patterns.map((pattern) => names.find((name) => pattern.test(name))).find(Boolean) ?? null;
  const picked = {
    unet: pick(unets, [/qwen_image_2512_fp8_e4m3fn/i, /qwen_image_2512/i]),
    clip: pick(clips, [/qwen_2\.5_vl_7b_fp8_scaled/i]),
    vae: pick(vaes, [/(^|[\\/])qwen_image_vae\.safetensors$/i]),
    lora: pick(loras, [/Qwen-Image-2512-Lightning-4steps-V1\.0-bf16/i]),
  };
  return picked.unet && picked.clip && picked.vae && picked.lora ? picked : null;
}

/** The best installed file for each Flux.2 klein model, or null when one is missing. */
export function pickFlux2Models({ unets, clips, vaes }) {
  const pick = (names, patterns) => patterns.map((pattern) => names.find((name) => pattern.test(name))).find(Boolean) ?? null;
  const picked = { unet: pick(unets, [/flux-2-klein-9b\.safetensors$/i, /flux-2-klein-4b\.safetensors$/i]), clip: pick(clips, [/qwen_3_8b_fp8mixed/i]), vae: pick(vaes, [/flux2-vae/i]) };
  return picked.unet && picked.clip && picked.vae ? picked : null;
}

/** Z-Image Turbo text to image (the user's Z-Image-Turbo-T2I workflow). The result is the PreviewImage node "10". */
export function zimageGraph({ prompt, width = 1024, height = 1024, steps = 8, cfg = 1, sampler = "res_multistep", scheduler = "simple", seed, models }) {
  return {
    1: { class_type: "UNETLoader", inputs: { unet_name: models.unet, weight_dtype: "default" } },
    2: { class_type: "CLIPLoader", inputs: { clip_name: models.clip, type: "lumina2", device: "default" } },
    3: { class_type: "VAELoader", inputs: { vae_name: models.vae } },
    4: { class_type: "CLIPTextEncode", inputs: { text: prompt, clip: ["2", 0] } },
    5: { class_type: "ConditioningZeroOut", inputs: { conditioning: ["4", 0] } },
    6: { class_type: "ModelSamplingAuraFlow", inputs: { model: ["1", 0], shift: 3 } },
    7: { class_type: "EmptySD3LatentImage", inputs: { width, height, batch_size: 1 } },
    8: { class_type: "KSampler", inputs: { model: ["6", 0], seed, steps, cfg, sampler_name: sampler, scheduler, positive: ["4", 0], negative: ["5", 0], latent_image: ["7", 0], denoise: 1.0 } },
    9: { class_type: "VAEDecode", inputs: { samples: ["8", 0], vae: ["3", 0] } },
    10: { class_type: "PreviewImage", inputs: { images: ["9", 0] } },
  };
}

/** Qwen Image 2512 text to image with the 4-step Lightning LoRA (the user's Qwen-Image-T2I workflow). The result is PreviewImage "10". */
export function qwenImageGraph({ prompt, width = 1328, height = 1328, steps = 4, cfg = 1, sampler = "euler", scheduler = "simple", seed, models }) {
  return {
    1: { class_type: "UNETLoader", inputs: { unet_name: models.unet, weight_dtype: "default" } },
    2: { class_type: "CLIPLoader", inputs: { clip_name: models.clip, type: "qwen_image", device: "default" } },
    3: { class_type: "VAELoader", inputs: { vae_name: models.vae } },
    4: { class_type: "CLIPTextEncode", inputs: { text: prompt, clip: ["2", 0] } },
    5: { class_type: "ConditioningZeroOut", inputs: { conditioning: ["4", 0] } },
    6: { class_type: "LoraLoaderModelOnly", inputs: { model: ["1", 0], lora_name: models.lora, strength_model: 1 } },
    7: { class_type: "ModelSamplingAuraFlow", inputs: { model: ["6", 0], shift: 3.1 } },
    8: { class_type: "EmptySD3LatentImage", inputs: { width, height, batch_size: 1 } },
    9: { class_type: "KSampler", inputs: { model: ["7", 0], seed, steps, cfg, sampler_name: sampler, scheduler, positive: ["4", 0], negative: ["5", 0], latent_image: ["8", 0], denoise: 1.0 } },
    11: { class_type: "VAEDecode", inputs: { samples: ["9", 0], vae: ["3", 0] } },
    10: { class_type: "PreviewImage", inputs: { images: ["11", 0] } },
  };
}

/** Flux.2 klein text to image (the user's Flux2_klein_T2I workflow: custom sampler, CFG guider, Flux2 scheduler). The result is PreviewImage "10". */
export function flux2Graph({ prompt, width = 1024, height = 1024, steps = 20, cfg = 5, sampler = "euler", seed, models }) {
  return {
    1: { class_type: "UNETLoader", inputs: { unet_name: models.unet, weight_dtype: "default" } },
    2: { class_type: "CLIPLoader", inputs: { clip_name: models.clip, type: "flux2", device: "default" } },
    3: { class_type: "VAELoader", inputs: { vae_name: models.vae } },
    4: { class_type: "CLIPTextEncode", inputs: { text: prompt, clip: ["2", 0] } },
    5: { class_type: "CLIPTextEncode", inputs: { text: "", clip: ["2", 0] } },
    6: { class_type: "ModelSamplingAuraFlow", inputs: { model: ["1", 0], shift: 3 } },
    7: { class_type: "EmptyFlux2LatentImage", inputs: { width, height, batch_size: 1 } },
    8: { class_type: "Flux2Scheduler", inputs: { steps, width, height } },
    9: { class_type: "KSamplerSelect", inputs: { sampler_name: sampler } },
    11: { class_type: "RandomNoise", inputs: { noise_seed: seed } },
    12: { class_type: "CFGGuider", inputs: { model: ["6", 0], positive: ["4", 0], negative: ["5", 0], cfg } },
    13: { class_type: "SamplerCustomAdvanced", inputs: { noise: ["11", 0], guider: ["12", 0], sampler: ["9", 0], sigmas: ["8", 0], latent_image: ["7", 0] } },
    14: { class_type: "VAEDecode", inputs: { samples: ["13", 0], vae: ["3", 0] } },
    10: { class_type: "PreviewImage", inputs: { images: ["14", 0] } },
  };
}

/**
 * Krea 2 Turbo drawn along a pose: the OpenPose/DWPose skeleton of `image` is the control picture of the pose ControlNet-LoRA (the
 * workflow of the LoRA: ostris edit nodes, the skeleton is "image 1" of the text encoder). The result has the shape of the
 * control picture (scaled to the Kontext sizes). The result is PreviewImage "30".
 */
export function kreaPoseGraph({ image, prompt, steps = 10, cfg = 1, sampler = "euler", scheduler = "simple", seed, models, lora }) {
  const encode = (text) => ({ class_type: "TextEncodeKrea2OstrisEdit", inputs: { clip: ["2", 0], prompt: text, vae: ["3", 0], image1: ["6", 0] } });
  return {
    1: { class_type: "UNETLoader", inputs: { unet_name: models.unet, weight_dtype: "default" } },
    2: { class_type: "CLIPLoader", inputs: { clip_name: models.clip, type: "krea2", device: "default" } },
    3: { class_type: "VAELoader", inputs: { vae_name: models.vae } },
    4: { class_type: "LoadImage", inputs: { image } },
    5: { class_type: "DWPreprocessor", inputs: { image: ["4", 0], detect_hand: "enable", detect_body: "enable", detect_face: "enable", resolution: 512, bbox_detector: "yolox_l.onnx", pose_estimator: "dw-ll_ucoco_384.onnx", scale_stick_for_xinsr_cn: "disable" } },
    6: { class_type: "FluxKontextImageScale", inputs: { image: ["5", 0] } },
    7: { class_type: "Krea2OstrisEditModelPatch", inputs: { model: ["1", 0], kv_cache: true } },
    8: { class_type: "LoraLoaderModelOnly", inputs: { model: ["7", 0], lora_name: lora, strength_model: 1 } },
    9: encode(prompt),
    10: encode(""),
    11: { class_type: "FluxKontextMultiReferenceLatentMethod", inputs: { conditioning: ["9", 0], reference_latents_method: "index_timestep_zero" } },
    12: { class_type: "FluxKontextMultiReferenceLatentMethod", inputs: { conditioning: ["10", 0], reference_latents_method: "index_timestep_zero" } },
    13: { class_type: "GetImageSize", inputs: { image: ["6", 0] } },
    14: { class_type: "EmptyLatentImage", inputs: { width: ["13", 0], height: ["13", 1], batch_size: 1 } },
    15: { class_type: "KSampler", inputs: { model: ["8", 0], seed, steps, cfg, sampler_name: sampler, scheduler, positive: ["11", 0], negative: ["12", 0], latent_image: ["14", 0], denoise: 1.0 } },
    16: { class_type: "VAEDecode", inputs: { samples: ["15", 0], vae: ["3", 0] } },
    30: { class_type: "PreviewImage", inputs: { images: ["16", 0] } },
  };
}

/**
 * Krea 2 Turbo drawn along the depth of a picture (Depth Anything V2 map, the Krea2 Control LoRA nodes of facok): `image` is
 * scaled to about 1 megapixel, its depth map controls the layout and the prompt makes the picture. The result is PreviewImage "30".
 */
export function kreaDepthGraph({ image, prompt, steps = 8, cfg = 1, sampler = "euler", scheduler = "simple", seed, models, lora, depthModel = "depth_anything_v2_vitl.pth" }) {
  return {
    1: { class_type: "UNETLoader", inputs: { unet_name: models.unet, weight_dtype: "default" } },
    2: { class_type: "CLIPLoader", inputs: { clip_name: models.clip, type: "krea2", device: "default" } },
    3: { class_type: "VAELoader", inputs: { vae_name: models.vae } },
    4: { class_type: "LoadImage", inputs: { image } },
    5: { class_type: "ImageScaleToTotalPixels", inputs: { image: ["4", 0], upscale_method: "lanczos", megapixels: 1, resolution_steps: 16 } },
    6: { class_type: "DepthAnythingV2Preprocessor", inputs: { image: ["5", 0], ckpt_name: depthModel, resolution: 512 } },
    7: { class_type: "GetImageSize", inputs: { image: ["5", 0] } },
    8: { class_type: "EmptyLatentImage", inputs: { width: ["7", 0], height: ["7", 1], batch_size: 1 } },
    9: { class_type: "Krea2ControlImageEncode", inputs: { control_image: ["6", 0], vae: ["3", 0], resize: "match_latent_size", upscale_method: "lanczos", crop: "center", channel_mode: "grayscale", normalize: "per_image_minmax", invert: false, batch_mode: "independent_images", latent: ["8", 0] } },
    10: { class_type: "Krea2ControlLoRALoader", inputs: { model: ["1", 0], lora_name: lora, strength: 1 } },
    11: { class_type: "Krea2ControlApply", inputs: { model: ["10", 0], control_latent: ["9", 0] } },
    12: { class_type: "CLIPTextEncode", inputs: { text: prompt, clip: ["2", 0] } },
    13: { class_type: "ConditioningZeroOut", inputs: { conditioning: ["12", 0] } },
    14: { class_type: "KSampler", inputs: { model: ["11", 0], seed, steps, cfg, sampler_name: sampler, scheduler, positive: ["12", 0], negative: ["13", 0], latent_image: ["8", 0], denoise: 1.0 } },
    15: { class_type: "VAEDecode", inputs: { samples: ["14", 0], vae: ["3", 0] } },
    30: { class_type: "PreviewImage", inputs: { images: ["15", 0] } },
  };
}

/**
 * Flux.2 klein picture edit (the user's Flux2_klein_I2I workflow): every picture is scaled to 1 megapixel, VAE-encoded and attached
 * to the prompt as a reference latent, one after the other. The result has the shape of the first picture (or `width` x `height`
 * when given). The result is PreviewImage "30".
 */
export function flux2EditGraph({ images, prompt, width, height, steps = 4, cfg = 1.3, sampler = "euler", seed, models }) {
  const wf = {
    1: { class_type: "UNETLoader", inputs: { unet_name: models.unet, weight_dtype: "default" } },
    2: { class_type: "CLIPLoader", inputs: { clip_name: models.clip, type: "flux2", device: "default" } },
    3: { class_type: "VAELoader", inputs: { vae_name: models.vae } },
    4: { class_type: "CLIPTextEncode", inputs: { text: prompt, clip: ["2", 0] } },
    6: { class_type: "ModelSamplingAuraFlow", inputs: { model: ["1", 0], shift: 3 } },
  };
  let conditioning = ["4", 0];
  images.forEach((image, index) => {
    wf[20 + index * 3] = { class_type: "LoadImage", inputs: { image } };
    wf[21 + index * 3] = { class_type: "ImageScaleToTotalPixels", inputs: { image: [String(20 + index * 3), 0], upscale_method: "lanczos", megapixels: 1, resolution_steps: 1 } };
    wf[22 + index * 3] = { class_type: "VAEEncode", inputs: { pixels: [String(21 + index * 3), 0], vae: ["3", 0] } };
    wf[60 + index] = { class_type: "ReferenceLatent", inputs: { conditioning, latent: [String(22 + index * 3), 0] } };
    conditioning = [String(60 + index), 0];
  });
  let size = [width, height];
  if (!(width && height)) {
    wf[7] = { class_type: "GetImageSize", inputs: { image: ["21", 0] } };
    size = [["7", 0], ["7", 1]];
  }
  return {
    ...wf,
    5: { class_type: "ConditioningZeroOut", inputs: { conditioning: ["4", 0] } },
    8: { class_type: "Flux2Scheduler", inputs: { steps, width: size[0], height: size[1] } },
    9: { class_type: "KSamplerSelect", inputs: { sampler_name: sampler } },
    11: { class_type: "RandomNoise", inputs: { noise_seed: seed } },
    12: { class_type: "CFGGuider", inputs: { model: ["6", 0], positive: conditioning, negative: ["5", 0], cfg } },
    15: { class_type: "EmptyFlux2LatentImage", inputs: { width: size[0], height: size[1], batch_size: 1 } },
    13: { class_type: "SamplerCustomAdvanced", inputs: { noise: ["11", 0], guider: ["12", 0], sampler: ["9", 0], sigmas: ["8", 0], latent_image: ["15", 0] } },
    14: { class_type: "VAEDecode", inputs: { samples: ["13", 0], vae: ["3", 0] } },
    30: { class_type: "PreviewImage", inputs: { images: ["14", 0] } },
  };
}

/**
 * Krea 2 Identity Edit (the Krea 2 Edit nodes and the Identity Edit LoRA): the first picture is edited, an optional second one is
 * the subject to put into it (two-input edit). The pictures go in through the pixel path (`fit`), the instruction is read by the
 * text encoder together with the pictures. The result has the shape of the first picture (about 1 megapixel) or `width` x `height`
 * when given. The result is PreviewImage "30".
 */
export function kreaIdentityGraph({ images, prompt, width, height, steps = 8, cfg = 1, sampler = "euler", scheduler = "simple", seed, models, lora }) {
  const [first, second] = images;
  const wf = {
    1: { class_type: "UNETLoader", inputs: { unet_name: models.unet, weight_dtype: "default" } },
    2: { class_type: "CLIPLoader", inputs: { clip_name: models.clip, type: "krea2", device: "default" } },
    3: { class_type: "VAELoader", inputs: { vae_name: models.vae } },
    4: { class_type: "LoadImage", inputs: { image: first } },
    5: { class_type: "ImageScaleToTotalPixels", inputs: { image: ["4", 0], upscale_method: "lanczos", megapixels: 1, resolution_steps: 16 } },
    8: { class_type: "VAEEncode", inputs: { pixels: ["5", 0], vae: ["3", 0] } },
    10: { class_type: "LoraLoaderModelOnly", inputs: { model: ["1", 0], lora_name: lora, strength_model: 1 } },
  };
  if (width && height) {
    wf[9] = { class_type: "EmptyLatentImage", inputs: { width, height, batch_size: 1 } };
  } else {
    wf[7] = { class_type: "GetImageSize", inputs: { image: ["5", 0] } };
    wf[9] = { class_type: "EmptyLatentImage", inputs: { width: ["7", 0], height: ["7", 1], batch_size: 1 } };
  }
  const patch = { model: ["10", 0], source_latent: ["8", 0], vae: ["3", 0], source_image: ["5", 0], target_latent: ["9", 0], fit_mode: "fit", ref_boost: 1 };
  const encode = { clip: ["2", 0], image: ["5", 0], grounding_px: 768 };
  if (second) {
    wf[14] = { class_type: "LoadImage", inputs: { image: second } };
    wf[15] = { class_type: "ImageScaleToTotalPixels", inputs: { image: ["14", 0], upscale_method: "lanczos", megapixels: 1, resolution_steps: 16 } };
    wf[16] = { class_type: "VAEEncode", inputs: { pixels: ["15", 0], vae: ["3", 0] } };
    Object.assign(patch, { source_latent_b: ["16", 0], source_image_b: ["15", 0], ref_boost_a: 1 });
    encode.image_b = ["15", 0];
  }
  return {
    ...wf,
    11: { class_type: "Krea2EditModelPatch", inputs: patch },
    12: { class_type: "Krea2EditGroundedEncode", inputs: { ...encode, prompt } },
    13: { class_type: "Krea2EditGroundedEncode", inputs: { ...encode, prompt: "" } },
    17: { class_type: "KSampler", inputs: { model: ["11", 0], seed, steps, cfg, sampler_name: sampler, scheduler, positive: ["12", 0], negative: ["13", 0], latent_image: ["9", 0], denoise: 1.0 } },
    18: { class_type: "VAEDecode", inputs: { samples: ["17", 0], vae: ["3", 0] } },
    30: { class_type: "PreviewImage", inputs: { images: ["18", 0] } },
  };
}

/** The vision model that describes pictures (ComfyUI-QwenVL on the Rev0 server). */
export const QWENVL = { model: "Qwen3-VL-4B-Instruct", quantization: "4-bit (VRAM-friendly)", preset: "🖼️ Ultra Detailed Description", maxTokens: 1000 };

/** One picture in, its long English description out. The text is the "easy showAnything" node "6". */
export function qwenVlGraph({ image, seed, maxTokens = QWENVL.maxTokens }) {
  return {
    5: { class_type: "LoadImage", inputs: { image } },
    7: { class_type: "AILab_QwenVL", inputs: { model_name: QWENVL.model, quantization: QWENVL.quantization, attention_mode: "auto", preset_prompt: QWENVL.preset, custom_prompt: "", max_tokens: maxTokens, keep_model_loaded: false, seed, image: ["5", 0] } },
    6: { class_type: "easy showAnything", inputs: { anything: ["7", 0] } },
  };
}

/** A clip in, its summary out: two pictures per second (at most 32) go to QwenVL's video input. The text is node "6". */
export function qwenVlVideoGraph({ video, seed, maxTokens = QWENVL.maxTokens }) {
  return {
    5: { class_type: "VHS_LoadVideo", inputs: { video, force_rate: 2, custom_width: 0, custom_height: 0, frame_load_cap: 32, skip_first_frames: 0, select_every_nth: 1, format: "AnimateDiff" } },
    7: { class_type: "AILab_QwenVL", inputs: { model_name: QWENVL.model, quantization: QWENVL.quantization, attention_mode: "auto", preset_prompt: "📹 Video Summary", custom_prompt: "", max_tokens: maxTokens, keep_model_loaded: false, seed, video: ["5", 0] } },
    6: { class_type: "easy showAnything", inputs: { anything: ["7", 0] } },
  };
}

const QWEN_EDIT_PATTERNS = {
  unet: [/qwen_image_2\.1_int8/i, /qwen_image_2\.1(?!_turbo)/i],
  clip: [/qwen3vl_8b_int8/i, /qwen3vl_8b/i],
  vae: [/qwen_image_2\.1_vae/i],
};

/** The best installed file for each Qwen Image 2.1 model, or null when one is missing. */
export function pickQwenEditModels({ unets, clips, vaes }) {
  const pick = (names, patterns) => {
    for (const pattern of patterns) {
      const found = names.find((name) => pattern.test(name));
      if (found) return found;
    }
    return null;
  };
  const picked = { unet: pick(unets, QWEN_EDIT_PATTERNS.unet), clip: pick(clips, QWEN_EDIT_PATTERNS.clip), vae: pick(vaes, QWEN_EDIT_PATTERNS.vae) };
  return picked.unet && picked.clip && picked.vae ? picked : null;
}

/**
 * Qwen Image 2.1 image edit (ComfyUI's template "image_qwen_image_2_1_image_edit" without the prompt enhancer):
 * `images` are uploaded file names, the first is the picture to edit (the result has its shape), the others are references;
 * the prompt names them <image1>, <image2>, ... The result is the PreviewImage node "10".
 */
export function qwenEditGraph({ prompt, negative = "", images, seed, steps = 25, cfg = 1, sampler = "euler", scheduler = "simple", resolution = 1024, models }) {
  const wf = {
    1: { class_type: "UNETLoader", inputs: { unet_name: models.unet, weight_dtype: "default" } },
    2: { class_type: "CLIPLoader", inputs: { clip_name: models.clip, type: "qwen_image", device: "default" } },
    3: { class_type: "VAELoader", inputs: { vae_name: models.vae } },
    4: { class_type: "QwenImage21Cache", inputs: { model: ["1", 0], device: "auto", dtype: "default" } },
  };
  const encode = { clip: ["2", 0], vae: ["3", 0], prompt, negative_prompt: negative, resolution };
  images.forEach((image, index) => {
    wf[20 + index] = { class_type: "LoadImage", inputs: { image } };
    encode[`images.image_${index + 1}`] = [String(20 + index), 0];
  });
  wf[5] = { class_type: "TextEncodeQwenImage21", inputs: encode };
  wf[6] = { class_type: "KSampler", inputs: { model: ["4", 0], seed, steps, cfg, sampler_name: sampler, scheduler, positive: ["5", 0], negative: ["5", 1], latent_image: ["5", 2], denoise: 1.0 } };
  wf[7] = { class_type: "VAEDecode", inputs: { samples: ["6", 0], vae: ["3", 0] } };
  wf[10] = { class_type: "PreviewImage", inputs: { images: ["7", 0] } };
  return wf;
}

/**
 * H3 image to video. `image` is the first frame, `last` an optional last frame (FL2V) and `audio` an optional sound pinned
 * at frame 0 so the mouth follows it (S2V, MiniMaxH3AddGuide). The result is the SaveVideo node "15".
 */
export function h3Graph({ prompt, width = 736, height = 416, seconds = 5, steps = 4, seed, image, last, audio, motion, saveLatent }) {
  const cond = { clip: ["2", 0], vae: ["3", 0], prompt: h3Prompt(prompt), width, height, length: h3Frames(seconds) };
  const wf = {
    1: { class_type: "UNETLoader", inputs: { unet_name: H3.unet, weight_dtype: "default" } },
    16: { class_type: "LoraLoaderModelOnly", inputs: { model: ["1", 0], lora_name: H3.lora, strength_model: 1.0 } },
    2: { class_type: "CLIPLoader", inputs: { clip_name: H3.clip, type: "minimax", device: "default" } },
    3: { class_type: "VAELoader", inputs: { vae_name: H3.videoVae } },
    4: { class_type: "VAELoader", inputs: { vae_name: H3.audioVae } },
  };
  if (image) {
    wf[5] = { class_type: "LoadImage", inputs: { image } };
    cond.first_frame = ["5", 0];
  }
  if (last) {
    wf[17] = { class_type: "LoadImage", inputs: { image: last } };
    cond.last_frame = ["17", 0];
  }
  let positive = ["6", 0];
  if (audio) {
    wf[18] = { class_type: "LoadAudio", inputs: { audio } };
    wf[19] = { class_type: "MiniMaxH3AddGuide", inputs: { positive: ["6", 0], latent: ["6", 1], frame_idx: motion ? (motion.length ?? 39) : 0, audio_vae: ["4", 0], audio: ["18", 0] } };
    positive = ["19", 0];
  }
  if (motion) positive = addMotion(wf, motion, positive, width, height);
  Object.assign(wf, {
    6: { class_type: "MiniMaxH3ImageToVideo", inputs: cond },
    7: { class_type: "KSamplerSelect", inputs: { sampler_name: "res_multistep" } },
    8: { class_type: "BasicScheduler", inputs: { model: ["16", 0], scheduler: "simple", steps, denoise: 1.0 } },
    9: { class_type: "RandomNoise", inputs: { noise_seed: seed } },
    10: { class_type: "BasicGuider", inputs: { model: ["16", 0], conditioning: positive } },
    11: { class_type: "SamplerCustomAdvanced", inputs: { noise: ["9", 0], guider: ["10", 0], sampler: ["7", 0], sigmas: ["8", 0], latent_image: ["6", 1] } },
    12: { class_type: "VAEDecode", inputs: { samples: ["11", 0], vae: ["3", 0] } },
    13: { class_type: "VAEDecodeAudio", inputs: { samples: ["11", 0], vae: ["4", 0] } },
    14: { class_type: "CreateVideo", inputs: { images: ["12", 0], audio: ["13", 0], fps: 24 } },
    15: { class_type: "SaveVideo", inputs: { video: ["14", 0], filename_prefix: "video/vsom_h3", format: "mp4", codec: "h264" } },
  });
  finishMotion(wf, { motion, saveLatent, latent: ["11", 0] });
  return wf;
}

/**
 * Motion continuation (the all-in-one Chain): pin the last frames and the saved latent of the clip before. `motion` =
 * { video: its uploaded file, total: its frame count, latent: path of its saved latent, length: frames to pin }.
 * Adds nodes 70-75 to `wf` and returns the conditioning to sample with. The pinned frames lead the new clip and are cut off
 * after decoding (see cutMotion), so the clip starts where the other one ended.
 */
function addMotion(wf, motion, positive, width, height) {
  const length = motion.length ?? 39;
  wf[70] = { class_type: "LoadVideo", inputs: { file: motion.video } };
  wf[71] = { class_type: "GetVideoComponents", inputs: { video: ["70", 0] } };
  wf[72] = { class_type: "ImageScale", inputs: { image: ["71", 0], upscale_method: "lanczos", width, height, crop: "center" } };
  wf[73] = { class_type: "ImageFromBatch", inputs: { image: ["72", 0], batch_index: Math.max(0, motion.total - length), length } };
  const inputs = { conditioning: positive, vae: ["3", 0], latent: ["6", 1], context_frames: ["73", 0], context_length: length, encode_mode: "video", anchor_mode: "head", crop: "center", audio_context_length: length, audio_mode: "timeline", target_start: 0 };
  // Without a saved latent only the pictures are pinned (a clip that has its own sound, see h3Graph's audio guide).
  if (motion.latent) {
    wf[74] = { class_type: "MiniMaxH3MotionContextLoadLatent", inputs: { latent_path: motion.latent, clip_index: 0 } };
    inputs.context_latent = ["74", 0];
  }
  wf[75] = { class_type: "MiniMaxH3MotionContext", inputs };
  return ["75", 0];
}

/** Cuts the pinned frames off the decoded clip (node 76 feeds CreateVideo "14") and saves the final latent (node 80) for the next clip. */
function finishMotion(wf, { motion, saveLatent, latent }) {
  if (motion) {
    wf[76] = { class_type: "MiniMaxH3MotionContextTrim", inputs: { images: ["12", 0], trim_frames: ["75", 1], audio: ["13", 0], fps: 24, match_tail: true } };
    wf[14].inputs = { images: ["76", 0], audio: ["76", 1], fps: 24 };
  }
  // Slot 1 of its own file name: the tool knows where to find it.
  if (saveLatent) wf[80] = { class_type: "MiniMaxH3MotionContextSaveLatent", inputs: { latent, filename_prefix: saveLatent, clip_index: 1 } };
}

const REF_SAMPLERS = { turbo: ["euler", 8], official: ["res_multistep", 20], deno: ["euler", 8] };

/**
 * H3 reference to video: up to 9 reference pictures, a reference video (edit or restyle a clip) and reference audio.
 * Reference nodes use ids from 40 up so they never collide with the fixed ids below. The result is node "15".
 */
export function h3RefGraph({ prompt, width = 736, height = 416, seconds = 5, steps, seed, model = "turbo", twoStage = false, images = [], video, audio, useVideoAudio = false, first, last, guideAudio, motion, saveLatent }) {
  const frames = h3Frames(seconds);
  const [sampler, defaultSteps] = REF_SAMPLERS[model];
  const cond = { clip: ["2", 0], vae: ["3", 0], audio_vae: ["4", 0], prompt: h3Prompt(prompt), width, height, length: frames, ref_image_size: "match" };
  const deno = model === "deno";
  const wf = {
    1: { class_type: "UNETLoader", inputs: { unet_name: H3.refUnets[model], weight_dtype: "default" } },
    2: { class_type: "CLIPLoader", inputs: { clip_name: deno ? H3.denoClip : H3.clip, type: "minimax", device: "default" } },
    3: { class_type: "VAELoader", inputs: { vae_name: H3.videoVae } },
    4: { class_type: "VAELoader", inputs: { vae_name: H3.audioVae } },
  };
  // The Deno workflow's model chain (single stage): quantised attention, the 8-step DMD LoRA, then the H3 sigma shift 12/3.
  if (deno) {
    wf[21] = { class_type: "ModelAttentionBackend", inputs: { model: ["1", 0], attention: "comfy kitchen attention" } };
    wf[22] = { class_type: "LoraLoaderModelOnly", inputs: { model: ["21", 0], lora_name: H3.denoLora, strength_model: 1.0 } };
    wf[23] = { class_type: "MiniMaxH3SigmaShift", inputs: { model: ["22", 0], shift_video: 12, shift_audio: 3 } };
  }
  const sampled = deno ? ["23", 0] : ["1", 0];
  images.forEach((image, index) => {
    wf[String(40 + index)] = { class_type: "LoadImage", inputs: { image } };
    // Dynamic inputs of this node are named "<group>.<prefix><index>" in the API graph.
    cond[`ref_images.ref_image_${index}`] = [String(40 + index), 0];
  });
  if (video) {
    wf[30] = { class_type: "LoadVideo", inputs: { file: video } };
    wf[31] = { class_type: "GetVideoComponents", inputs: { video: ["30", 0] } };
    // Reference frames must match the generation size; cap them to the clip length.
    wf[32] = { class_type: "ImageScale", inputs: { image: ["31", 0], upscale_method: "lanczos", width, height, crop: "center" } };
    wf[33] = { class_type: "ImageFromBatch", inputs: { image: ["32", 0], batch_index: 0, length: frames } };
    cond["ref_videos.ref_video_0"] = ["33", 0];
    if (useVideoAudio) cond["ref_video_audios.ref_video_audio_0"] = ["31", 1];
  }
  if (audio) {
    wf[34] = { class_type: "LoadAudio", inputs: { audio } };
    cond["ref_audios.ref_audio_0"] = ["34", 0];
  }
  // Pinned frames next to the references: the first picture (and a song segment the mouth follows) at frame 0, the last picture at the end.
  let positive = ["6", 0];
  // The song gets its own guide node, the way the image-to-video graph pins it; one node for picture and sound did not lip-sync.
  if (guideAudio) {
    wf[61] = { class_type: "LoadAudio", inputs: { audio: guideAudio } };
    wf[62] = { class_type: "MiniMaxH3AddGuide", inputs: { positive, latent: ["6", 1], frame_idx: 0, audio_vae: ["4", 0], audio: ["61", 0] } };
    positive = ["62", 0];
  }
  if (first) {
    wf[60] = { class_type: "LoadImage", inputs: { image: first } };
    wf[65] = { class_type: "MiniMaxH3AddGuide", inputs: { positive, latent: ["6", 1], frame_idx: 0, vae: ["3", 0], image: ["60", 0] } };
    positive = ["65", 0];
  }
  if (last) {
    wf[63] = { class_type: "LoadImage", inputs: { image: last } };
    wf[64] = { class_type: "MiniMaxH3AddGuide", inputs: { positive, latent: ["6", 1], frame_idx: -1, vae: ["3", 0], image: ["63", 0] } };
    positive = ["64", 0];
  }
  if (motion) positive = addMotion(wf, motion, positive, width, height);
  // Deno two-stage: sample all but the last step small, enlarge the video latent 2x, then finish the last step at full size.
  let final = ["11", 0];
  if (twoStage) {
    final = ["53", 0];
    Object.assign(wf, {
      50: { class_type: "SplitSigmas", inputs: { sigmas: ["8", 0], step: (steps || defaultSteps) - 1 } },
      51: { class_type: "LTXVSeparateAVLatent", inputs: { av_latent: ["11", 1] } },
      52: { class_type: "MinimaxH3LatentUpscaler3D", inputs: { latent: ["51", 0], model_name: H3.latentUpscaler, mode: "scale by multiplier", "mode.scale": 2, align: 32, enable_temporal_chunking: true, force_unload: true, device: "cuda", precision: "fp16" } },
      54: { class_type: "LTXVConcatAVLatent", inputs: { video_latent: ["52", 0], audio_latent: ["51", 1] } },
      53: { class_type: "SamplerCustomAdvanced", inputs: { noise: ["9", 0], guider: ["20", 0], sampler: ["7", 0], sigmas: ["50", 1], latent_image: ["54", 0] } },
    });
  }
  Object.assign(wf, {
    6: { class_type: "MiniMaxH3ReferenceToVideo", inputs: cond },
    7: { class_type: "KSamplerSelect", inputs: { sampler_name: sampler } },
    8: { class_type: "BasicScheduler", inputs: { model: sampled, scheduler: "simple", steps: steps || defaultSteps, denoise: 1.0 } },
    9: { class_type: "RandomNoise", inputs: { noise_seed: seed } },
    20: { class_type: "BasicGuider", inputs: { model: sampled, conditioning: positive } },
    11: { class_type: "SamplerCustomAdvanced", inputs: { noise: ["9", 0], guider: ["20", 0], sampler: ["7", 0], sigmas: twoStage ? ["50", 0] : ["8", 0], latent_image: ["6", 1] } },
    12: { class_type: "VAEDecode", inputs: { samples: final, vae: ["3", 0] } },
    13: { class_type: "VAEDecodeAudio", inputs: { samples: final, vae: ["4", 0] } },
    14: { class_type: "CreateVideo", inputs: { images: ["12", 0], audio: ["13", 0], fps: 24 } },
    15: { class_type: "SaveVideo", inputs: { video: ["14", 0], filename_prefix: "video/vsom_h3_ref", format: "mp4", codec: "h264" } },
  });
  finishMotion(wf, { motion, saveLatent, latent: final });
  return wf;
}

/** The same two RTX passes on one picture: a picture in, the enlarged picture out (node "3"). */
export function rtxImageGraph({ image, scale, prefix }) {
  const { images: _video, ...passes } = rtxGraph({ video: "", scale, prefix })[2].inputs;
  return {
    1: { class_type: "LoadImage", inputs: { image } },
    2: { class_type: "DenoRTXVFXVideoFinisher", inputs: { images: ["1", 0], ...passes } },
    3: { class_type: "SaveImage", inputs: { images: ["2", 0], filename_prefix: prefix } },
  };
}

/**
 * An upscale-model enlargement of one picture: the model's own factor (4x, 8x, read from its name) and then a resize to
 * the wanted `scale`. The enlarged picture is the SaveImage node "5".
 */
export function modelUpscaleGraph({ image, model, scale, prefix }) {
  return {
    1: { class_type: "LoadImage", inputs: { image } },
    2: { class_type: "UpscaleModelLoader", inputs: { model_name: model } },
    3: { class_type: "ImageUpscaleWithModel", inputs: { upscale_model: ["2", 0], image: ["1", 0] } },
    4: { class_type: "ImageScaleBy", inputs: { image: ["3", 0], upscale_method: "lanczos", scale_by: scale / upscaleFactor(model) } },
    5: { class_type: "SaveImage", inputs: { images: ["4", 0], filename_prefix: prefix } },
  };
}

/** The SRFPTyp image upscaler (RTX restore); `mode` is its restore mode. The result is SaveImage "3". */
export function srfpGraph({ image, mode, scale, prefix }) {
  return {
    1: { class_type: "LoadImage", inputs: { image } },
    2: { class_type: "SRFPTypImageUpscaler", inputs: { image: ["1", 0], scale, upscale_quality: "Ultra", restore_mode: mode, restore_strength: 0.35, quality_target: "105% Master", color_treatment: "Auto Natural", subject_recovery: "Auto", enabled: true } },
    3: { class_type: "SaveImage", inputs: { images: ["2", 0], filename_prefix: prefix } },
  };
}

/**
 * SeedVR2 on one picture (the setup of the SeedVR2-Image-Upscale workflow, tiled VAE for 12 GB): `resolution` is the short
 * edge of the result in pixels. The result is SaveImage "5".
 */
export function seedvr2Graph({ image, dit, resolution, seed, prefix }) {
  return {
    1: { class_type: "LoadImage", inputs: { image } },
    2: { class_type: "SeedVR2LoadDiTModel", inputs: { model: dit, device: "cuda:0", blocks_to_swap: 0, swap_io_components: false, offload_device: "cpu", cache_model: false, attention_mode: "sdpa" } },
    3: { class_type: "SeedVR2LoadVAEModel", inputs: { model: "ema_vae_fp16.safetensors", device: "cuda:0", encode_tiled: true, encode_tile_size: 1024, encode_tile_overlap: 128, decode_tiled: true, decode_tile_size: 1024, decode_tile_overlap: 128, tile_debug: "false", offload_device: "cpu", cache_model: false } },
    4: { class_type: "SeedVR2VideoUpscaler", inputs: { image: ["1", 0], dit: ["2", 0], vae: ["3", 0], seed, resolution, max_resolution: 0, batch_size: 1, uniform_batch_size: false, color_correction: "lab", temporal_overlap: 0, prepend_frames: 0, input_noise_scale: 0, latent_noise_scale: 0, offload_device: "cpu", enable_debug: false } },
    5: { class_type: "SaveImage", inputs: { images: ["4", 0], filename_prefix: prefix } },
  };
}

/**
 * ComfyUI's "Image Upscale (Z-image-Turbo)": an upscale model enlarges the picture, then a light Z-Image Turbo pass
 * (denoise 0.33) redraws the detail. The wanted `scale` is reached by resizing after the model. The result is SaveImage "9".
 */
export function zimageUpscaleGraph({ image, upscaler, factor, scale, seed, prefix, models }) {
  return {
    1: { class_type: "LoadImage", inputs: { image } },
    2: { class_type: "UpscaleModelLoader", inputs: { model_name: upscaler } },
    3: { class_type: "ImageUpscaleWithModel", inputs: { upscale_model: ["2", 0], image: ["1", 0] } },
    4: { class_type: "ImageScaleBy", inputs: { image: ["3", 0], upscale_method: "lanczos", scale_by: scale / factor } },
    5: { class_type: "UNETLoader", inputs: { unet_name: models.unet, weight_dtype: "default" } },
    6: { class_type: "CLIPLoader", inputs: { clip_name: models.clip, type: "lumina2", device: "default" } },
    7: { class_type: "VAELoader", inputs: { vae_name: models.vae } },
    8: { class_type: "ModelSamplingAuraFlow", inputs: { model: ["5", 0], shift: 3 } },
    10: { class_type: "CLIPTextEncode", inputs: { clip: ["6", 0], text: "masterpiece, 8k" } },
    11: { class_type: "CLIPTextEncode", inputs: { clip: ["6", 0], text: "" } },
    12: { class_type: "VAEEncode", inputs: { pixels: ["4", 0], vae: ["7", 0] } },
    13: { class_type: "KSampler", inputs: { model: ["8", 0], seed, steps: 5, cfg: 1, sampler_name: "dpmpp_2m_sde", scheduler: "beta", positive: ["10", 0], negative: ["11", 0], latent_image: ["12", 0], denoise: 0.33 } },
    14: { class_type: "VAEDecode", inputs: { samples: ["13", 0], vae: ["7", 0] } },
    9: { class_type: "SaveImage", inputs: { images: ["14", 0], filename_prefix: prefix } },
  };
}

/** The best installed file for each Z-Image Turbo model, or null when one is missing. */
export function pickZimageModels({ unets, clips, vaes }) {
  const pick = (names, patterns) => patterns.map((pattern) => names.find((name) => pattern.test(name))).find(Boolean) ?? null;
  const picked = { unet: pick(unets, [/z_image_turbo_bf16/i, /z_image_turbo/i]), clip: pick(clips, [/qwen_3_4b\.safetensors$/i, /qwen_3_4b/i]), vae: pick(vaes, [/(^|[\/])ae\.safetensors$/i]) };
  return picked.unet && picked.clip && picked.vae ? picked : null;
}

/** The factor an upscale model enlarges by, read from its name (4x..., 8x..., x4plus), 4 when the name does not say. */
export const upscaleFactor = (model) => Number(/(\d+)x|x(\d+)/i.exec(model)?.slice(1).find(Boolean)) || 4;

/** The user's "RTX 2pass upscale workflow" (Deblur Ultra, then High Bitrate High): a clip in, the enlarged clip out (node "3"). */
export function rtxGraph({ video, scale, prefix }) {
  return {
    1: { class_type: "VHS_LoadVideo", inputs: { video, force_rate: 0, custom_width: 0, custom_height: 0, frame_load_cap: 0, skip_first_frames: 0, select_every_nth: 1, format: "LTXV" } },
    2: {
      class_type: "DenoRTXVFXVideoFinisher",
      inputs: { images: ["1", 0], first_pass: "Deblur", first_quality: "Ultra", upscale_pass: "High Bitrate", upscale_quality: "High", resize_type: "Scale", scale, megapixels: 4, width: 3840, height: 2160, divisible_by: "32", ratio_preset: "16:9", resize_method: "Center Crop (Fill)" },
    },
    3: {
      class_type: "VHS_VideoCombine",
      inputs: { images: ["2", 0], audio: ["1", 2], frame_rate: 24, loop_count: 0, filename_prefix: prefix, format: "video/h264-mp4", pix_fmt: "yuv420p", crf: 15, save_metadata: false, trim_to_audio: false, pingpong: false, save_output: true },
    },
  };
}

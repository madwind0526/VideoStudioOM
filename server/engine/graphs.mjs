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
export function kreaGraph({ prompt, width = 1536, height = 864, steps = 8, seed, models }) {
  return {
    1: { class_type: "UNETLoader", inputs: { unet_name: models.unet, weight_dtype: "default" } },
    2: { class_type: "CLIPLoader", inputs: { clip_name: models.clip, type: "krea2", device: "default" } },
    3: { class_type: "VAELoader", inputs: { vae_name: models.vae } },
    4: { class_type: "CLIPTextEncode", inputs: { text: prompt, clip: ["2", 0] } },
    5: { class_type: "ConditioningZeroOut", inputs: { conditioning: ["4", 0] } },
    7: { class_type: "EmptyLatentImage", inputs: { width, height, batch_size: 1 } },
    8: { class_type: "KSampler", inputs: { model: ["1", 0], seed, steps, cfg: 1.0, sampler_name: "euler", scheduler: "simple", positive: ["4", 0], negative: ["5", 0], latent_image: ["7", 0], denoise: 1.0 } },
    9: { class_type: "VAEDecode", inputs: { samples: ["8", 0], vae: ["3", 0] } },
    10: { class_type: "PreviewImage", inputs: { images: ["9", 0] } },
  };
}

/**
 * H3 image to video. `image` is the first frame, `last` an optional last frame (FL2V) and `audio` an optional sound pinned
 * at frame 0 so the mouth follows it (S2V, MiniMaxH3AddGuide). The result is the SaveVideo node "15".
 */
export function h3Graph({ prompt, width = 736, height = 416, seconds = 5, steps = 4, seed, image, last, audio }) {
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
    wf[19] = { class_type: "MiniMaxH3AddGuide", inputs: { positive: ["6", 0], latent: ["6", 1], frame_idx: 0, audio_vae: ["4", 0], audio: ["18", 0] } };
    positive = ["19", 0];
  }
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
  return wf;
}

const REF_SAMPLERS = { turbo: ["euler", 8], official: ["res_multistep", 20], deno: ["euler", 8] };

/**
 * H3 reference to video: up to 9 reference pictures, a reference video (edit or restyle a clip) and reference audio.
 * Reference nodes use ids from 40 up so they never collide with the fixed ids below. The result is node "15".
 */
export function h3RefGraph({ prompt, width = 736, height = 416, seconds = 5, steps, seed, model = "turbo", twoStage = false, images = [], video, audio, useVideoAudio = false, first, last, guideAudio }) {
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
  return wf;
}

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

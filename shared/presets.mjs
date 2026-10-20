/**
 * Direction presets: a look and a way of telling the story. The hint is written into the story prompts and into every
 * image and video prompt, so one choice shapes the whole video.
 */
export const DIRECTION_PRESETS = [
  { id: "cinematic", label: "영화풍", hint: "cinematic drama: motivated camera moves, shallow depth of field, warm and cool colour contrast, deliberate pacing" },
  { id: "documentary", label: "다큐멘터리", hint: "observational documentary: handheld-natural camera, available light, real locations, understated pacing" },
  { id: "music-video", label: "뮤직비디오", hint: "music video: rhythmic cuts on the beat, expressive lighting, stylised colour, performance and mood shots" },
  { id: "commercial", label: "광고·제품", hint: "polished commercial: clean composition, controlled studio-grade lighting, macro details, smooth slow camera moves" },
  { id: "action", label: "액션·격투", hint: "high-intensity action: causal choreography (attack, defence, counter), clear spatial geography, fast but readable camera, impact beats" },
  { id: "romance", label: "로맨스", hint: "romance: soft golden light, close two-shots, gentle camera drift, lingering glances, warm palette" },
  { id: "thriller", label: "스릴러", hint: "thriller: low-key lighting, tight framing, slow push-ins, cold desaturated palette, long held tension before release" },
  { id: "comedy", label: "코미디", hint: "comedy: bright even lighting, wide frames that show the gag, snappy timing, expressive reactions" },
  { id: "fantasy", label: "판타지·애니", hint: "fantasy illustration look: painterly colour, magical light, sweeping wide shots, stylised character design" },
  { id: "scifi", label: "SF", hint: "science fiction: neon and practical light, reflective surfaces, large-scale environments, slow reveal moves" },
  { id: "horror", label: "공포", hint: "horror: darkness with a single motivated light source, off-centre framing, slow creeping moves, sudden stillness replaced by sound cues" },
  { id: "vlog", label: "감성 브이로그", hint: "lifestyle vlog: natural window light, handheld close-ups, everyday details, soft warm grade" },
  { id: "sports", label: "스포츠 다큐", hint: "sports documentary: telephoto tracking shots, slow-motion peaks, crowd and ambient sound, dramatic backlight" },
];

export const presetHint = (id) => DIRECTION_PRESETS.find((preset) => preset.id === id)?.hint ?? "";

// Splits prompts into short, reusable phrases by category (gender, age, hair, outfit, action, expression, place, composition, camera gear,
// lighting, palette, mood). Rule based: the prompts are mostly "<grading block> , <shot>, <angle>, <subject>; <clauses>; <camera>" captions
// or plain paragraphs.

/** Words that mean the prompt (or phrase) is about a minor: such text is never taken into the pool. */
const MINOR = /\b(child|children|kid|kids|teen|teens|teenage|teenager|schoolgirl|schoolboy|school uniform|minor|toddler|baby|infant|underage|preteen|pre-teen|little girl|little boy|loli|shota|juvenile|adolescent|1[0-7][- ]?(?:year|yo)|aged? 1[0-7])\b/i;
export const hasMinor = (text) => MINOR.test(text);

const CP1252 = new Map([[0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84], [0x2026, 0x85], [0x2020, 0x86], [0x2021, 0x87], [0x02c6, 0x88], [0x2030, 0x89], [0x0160, 0x8a], [0x2039, 0x8b], [0x0152, 0x8c], [0x017d, 0x8e], [0x2018, 0x91], [0x2019, 0x92], [0x201c, 0x93], [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97], [0x02dc, 0x98], [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b], [0x0153, 0x9c], [0x017e, 0x9e], [0x0178, 0x9f]]);

/** Repairs UTF-8 text that was read as Windows-1252 ("â" + control characters, "Ã©"). */
export function fixMojibake(text) {
  if (!/[ÂÃâ][\u0080-¿ŒœŠšŸŽžƒˆ˜–—‘-„†-•…‰‹›€™]/.test(text)) return text;
  try {
    const bytes = Uint8Array.from([...text].map((ch) => CP1252.get(ch.codePointAt(0)) ?? ch.codePointAt(0)));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    // Mixed text (some parts fine, some broken): drop the broken sequences.
    return text.replace(/[ÂÃâ][\u0080-¿ŒœŠšŸŽžƒˆ˜–—‘-„†-•…‰‹›€™]+/g, " ");
  }
}

const EDGE = /^[\s,;:.\-–—]+|[\s,;:.\-–—]+$/g;
const clean = (text) => text.replace(/\s+/g, " ").replace(EDGE, "").replace(/\s+([,;.])/g, "$1").trim();

const SHOT_START = /^(?:extreme |medium |medium full |medium close[- ]?up|close[- ]?up|full|wide|long|over[- ]the[- ]shoulder|low|high|cowboy|waist|bust|head|three[- ]quarter|profile|overhead|aerial|dutch|establishing)\b[^,;]{0,50}?(?:shot|angle|view|close[- ]?up|framing|portrait)\b/i;
const FRAME_TOKEN = /\b(shot|angle|view|close[- ]?up|framing|eye[- ]level|low[- ]angle|high[- ]angle|three[- ]quarter|profile|centered|symmetr\w*|overhead|aerial|dutch|from (?:above|below|behind|the side)|vertical|horizontal|wide|medium|full[- ]body|full)\b/i;
const GEAR = /\b(?:Sony|Canon|Nikon|Fujifilm|Fuji|Leica|Hasselblad|Panasonic|Phase One|ARRI|Arri|RED|Pentax|Olympus|Kodak|Contax|Mamiya)\b[^.;]*?\b\d{2,3}\s?mm\b(?:[ ,]*f\/?\s?[\d.]+)?/;
const LENS = /\b\d{2,3}\s?mm\b(?:[ ,]*f\/?\s?[\d.]+)?(?: lens)?/;

const GRADE_WORDS = /\b(color grading|colour grading|tones?|film grain|palette|shadows?|highlights?|halation|vignette|contrast|saturat\w*|cinematic|grading|film look|film texture|analog|bloom|teal|cobalt|amber|desaturated)\b/gi;
const GRADE_START = /^(deep|natural|warm|cool|soft|rich|muted|vivid|moody|cinematic|direct|low-light|high-contrast|golden|cold|pastel)\b/i;
const CLOTHES = /\b(dress(?:ed)?|top|shirt|t-shirt|tee|blouse|jacket|coat|cardigan|sweater|hoodie|skirt|shorts|jeans|trousers|pants|denim|leggings|bikini|swimsuit|swimwear|bra|lingerie|robe|kimono|hanbok|uniform|suit|blazer|gown|tank|crop|halter|camisole|bodysuit|jumpsuit|overalls|stockings|socks|boots|sneakers|heels|loafers|scarf|hat|cap|beanie|gloves|apron|vest|poncho|cape|sarong|tunic|corset|bandana)\b/i;
const OUTFIT_LEAD = /\b(wearing|wears|wear|dressed in|dressed|clad in|outfit|attire|garment)\b/i;
const MOOD = /\b(mood|atmosphere|aesthetic|vibe|feeling|nostalgic|romantic|moody|dreamy|cozy|candid|intimate|serene|playful|mysterious|melancholic|film look|cinematic look|snapshot|editorial|ethereal|haunting)\b/i;
const SKIN_TEXTURE = /\b(vellus|micro-?pores?|pores|skin texture|skin surface|fine hair|baby hair|peach fuzz)\b/i;
const PLACE_WORDS = "beach|street|cafe|café|room|forest|city|studio|rooftop|terrace|kitchen|bedroom|bathroom|office|park|garden|pool|sea|ocean|mountain|field|desert|lobby|stairs|staircase|balcony|bar|restaurant|hotel|car|train|subway|bridge|market|shop|store|library|gym|hammock|dunes|lake|river|alley|corridor|stage|cabin|temple|castle|village|town|harbor|dock|deck|garage|elevator|hallway|classroom|theater|museum|mall|festival|snow|setting";
const WHERE = new RegExp(`\\b(?:in|at|on|inside|outside|along|against|beside|near|under)\\s+(?:an?|the)\\s+[^,;]{0,70}?\\b(?:${PLACE_WORDS})\\b[^,;]{0,25}`, "i");
const LIGHT_PHRASE = /\b(?:(?:soft|warm|cool|cold|harsh|bright|dim|natural|diffused|dramatic|golden|neon|direct|ambient|window|studio|strong|gentle|moody|low-key|high-key|flat|overcast|midday|evening|morning|even|rim|side|top|bounce|reflected|flickering|candle)[ ,-]+){1,3}(?:on-camera )?(?:lighting|light|sunlight|flash|glow|backlight\w*|shadows?|illumination)\b|\b(?:backlit|candlelight|spotlight|golden hour|blue hour|neon glow|direct on-camera flash|window light|softbox)\b/gi;
const POSE_PHRASE = /\b((?:posing|standing|stands|seated|sitting|sits|leaning|leans|reclining|reclines|lying|walking|kneeling|crouching|squatting|resting|sprawled|perched|crossing)\b[^;.]{0,90}?)(?=,? (?:wearing|dressed|while|and wearing|with her hair)|[;.]|$)/i;
const HANDS_PHRASE = /\b((?:her|his) (?:left |right )?(?:hand|hands|arm|arms)\b[^;.]{0,80}?)(?=[;.]|$)/i;
const LOOK_PHRASE = /\b((?:gazing|looking|glancing|smiling|staring|laughing|smirking|pouting|winking|peering)\b[^;.]{0,70}?)(?=[;.]|$)/i;
const EXPRESSION_NOUN = /\b((?:a |an )?(?:soft|gentle|slight|warm|calm|confident|serious|playful|shy|bright|subtle|natural|faint|sly|relaxed|serene|cool|dominant|intense) (?:smile|expression|gaze|look|grin|smirk)\b[^,;.]{0,35})/i;

/** Sentences that talk to the model (or to a reference picture) instead of describing the picture. */
const INSTRUCTION = /\b(reference (?:image|photo|picture)|described below|attached|create a|generate a|use the|do not|don't|must not|must be|must |should|ensure|avoid|no other|PG-13|keep the|preserve|make sure|image \d|picture \d|follow the|show her|show him|add subtle|add a|maintain|exactly the same|same person|same face)\b/i;

/** Normalised key for removing repeated phrases. */
export const keyOf = (text) => text.toLowerCase().replace(/[^a-z0-9가-힣]+/g, " ").trim();

const sentencesOf = (block) =>
  block
    .split(/(?<=[.!?])\s+(?=[A-Z])|;\s+/)
    .map(clean)
    .filter(Boolean);

/** Shortest phrase worth keeping, per category (a few words that stand alone). */
const MIN_LENGTH = { gender: 3, age: 3, hair: 9, expression: 12, action: 28, gear: 5 };

function addTo(out, category, phrase, max = 230) {
  const text = clean(phrase);
  if (text.length < (MIN_LENGTH[category] ?? 8) || text.length > max) return;
  if (category === "action" && text.split(" ").length < 5) return;
  if (hasMinor(text)) return;
  (out[category] ??= []).push(text);
}

/** "She wears a red dress" -> "wearing a red dress"; "dressed in ..." stays. */
function outfitPhrase(clause) {
  const start = clause.search(/\b(wearing|wears|dressed in|clad in|is wearing)\b/i);
  const from = start >= 0 && start < 160 ? clause.slice(start) : clause;
  return from.replace(/^(?:is )?wears\b/i, "wearing").replace(/^is wearing\b/i, "wearing");
}

/** The phrases of one prompt, by category. */
export function classifyPrompt(raw) {
  const text = fixMojibake(raw).replace(/\r\n/g, "\n");
  const out = {};
  // Blocks that were joined with " , " (grading block, caption, ...).
  const blocks = text.split(/\s+,\s+(?=[A-Z])/).map((block) => clean(block.replace(/\n+/g, " "))).filter(Boolean);
  for (const block of blocks) {
    const gradeHits = (block.match(GRADE_WORDS) ?? []).length;
    const subjectWords = /\b(woman|man|girl|boy|she|her|he|his|model|person)\b/i.test(block);
    const isCaption = SHOT_START.test(block);
    const isPreset = /\b(color grading|colour grading|color palette|colour palette|film grain|film look|film texture|tones)\b/i.test(block);
    if (!isCaption && isPreset && gradeHits >= 4 && block.length > 120 && (!subjectWords || GRADE_START.test(block))) {
      // A whole color / film-look preset is one phrase of the palette category; its short mood parts are phrases of the mood category.
      addTo(out, "palette", block, 1000);
      for (const part of block.split(/,\s*/)) if (MOOD.test(part) && part.length >= 10 && part.length <= 80 && !SKIN_TEXTURE.test(part)) addTo(out, "mood", part, 80);
      continue;
    }
    for (const sentence of sentencesOf(block)) classifyClause(sentence, out);
  }
  return out;
}

function classifyClause(clause, out) {
  let rest = clause;
  if (INSTRUCTION.test(rest)) return;

  // Composition: the leading shot / angle words of a caption ("Medium Full shot, eye-level angle, ...").
  if (SHOT_START.test(rest)) {
    const parts = rest.split(/,\s*/);
    const frame = [];
    while (parts.length && frame.length < 3 && parts[0].length <= 42 && FRAME_TOKEN.test(parts[0])) frame.push(parts.shift());
    if (frame.length) addTo(out, "composition", frame.join(", "), 90);
    rest = parts.join(", ");
  }

  // Camera gear and depth of field.
  const gear = rest.match(GEAR);
  if (gear) {
    addTo(out, "gear", gear[0], 90);
    rest = rest.replace(gear[0], " ");
  } else {
    const lens = rest.match(LENS);
    if (lens) addTo(out, "gear", lens[0], 70);
  }
  const dof = rest.match(/\b((?:very |extremely |ultra )?(?:shallow|deep) depth of field|creamy bokeh|soft bokeh|bokeh)\b/i);
  if (dof) addTo(out, "gear", dof[0], 60);
  rest = clean(rest);
  if (rest.length < 6) return;

  // Lighting words wherever they are.
  for (const match of rest.match(LIGHT_PHRASE) ?? []) addTo(out, "lighting", match, 60);

  // Subject: gender, age, hair.
  const subjectLike = /\b(woman|women|man|men|girl|female|male|lady|model|person|she|her|he|his)\b/i.test(rest);
  if (subjectLike) {
    const withoutFemale = rest.replace(/\b(?:woman|women|female|girl|lady)\b/gi, " ");
    const female = withoutFemale.length < rest.length;
    const male = /\b(?:man|men|male|boy|guy|gentleman)\b/i.test(withoutFemale);
    if (female && !male) addTo(out, "gender", "woman", 20);
    else if (male && !female) addTo(out, "gender", "man", 20);
    const age = rest.match(/\b(young adult|adult|middle[- ]aged|mature|elderly|senior|in (?:her|his) (?:early |mid[- ]?|late )?[2-9]0s|(?:early|mid|late)[- ][2-9]0s|aged? [2-9]\d|[2-9]\d[- ]year[- ]old|youthful)\b/i);
    if (age) addTo(out, "age", age[0], 40);
    const hair = rest.match(/\b((?:[a-z]+[- ]){0,4}hair(?:\s+(?:parted|styled|tied|pulled|tucked|worn|swept|pinned|falling|cascading|flowing|gathered|braided|curled|framing|draped)[^,;.]{0,50})?)/i);
    if (hair && !SKIN_TEXTURE.test(hair[1]) && hair[1].length >= 9 && hair[1].length <= 110) {
      addTo(out, "hair", hair[1].replace(/^(?:(?:a|an)\s+)?(?:(?:young|beautiful|adult)\s+)*(?:(?:korean|european|asian)\s+)?(?:woman|man|girl|model|female|male)\s+(?:with|having)\s+/i, "").replace(/^(?:with|has|having|and|her|his)\s+/i, ""), 110);
    }
  }

  // The clause itself, by what it talks about.
  if (OUTFIT_LEAD.test(rest) && CLOTHES.test(rest)) {
    addTo(out, "outfit", outfitPhrase(rest));
    return;
  }
  const background = rest.match(/\b(?:background|backdrop)\s*(?::|shows|features|includes|reveals|is|contains|has|consists of|with)\s*(.{12,})/i);
  if (background && !OUTFIT_LEAD.test(background[1])) addTo(out, "place", `background ${background[1].replace(/^[:\s]+/, "")}`, 200);
  else {
    const where = rest.match(WHERE);
    if (where && !CLOTHES.test(where[0])) addTo(out, "place", where[0], 130);
  }
  if (MOOD.test(rest) && !subjectLike && !CLOTHES.test(rest) && rest.length <= 90) addTo(out, "mood", rest, 90);
  if (subjectLike && !SKIN_TEXTURE.test(rest)) {
    const look = rest.match(LOOK_PHRASE) ?? rest.match(EXPRESSION_NOUN);
    if (look) addTo(out, "expression", look[1], 90);
    const pose = rest.match(POSE_PHRASE) ?? rest.match(HANDS_PHRASE);
    if (pose && !OUTFIT_LEAD.test(pose[1])) addTo(out, "action", pose[1], 130);
  }
}

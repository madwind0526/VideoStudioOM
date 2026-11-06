import { readFile } from "node:fs/promises";

import { writeFileAtomic } from "./fs-util.mjs";
import { HttpError } from "./http.mjs";

/** The categories of the built-in pool: the id (used by the screen and the file) and its name on the screen. */
export const POOL_CATEGORIES = [
  { id: "person", label: "인물" },
  { id: "outfit", label: "의상" },
  { id: "style", label: "화풍" },
  { id: "place", label: "배경" },
  { id: "action", label: "동작" },
  { id: "prop", label: "소품" },
];
const MAX_CATEGORIES = 30;
const MAX_PHRASES = 300;
const MAX_LENGTH = 200;

/** Used while the user has no data/image-pools.json; a saved file replaces it whole. */
export const DEFAULT_POOL = {
  person: ["20대 후반의 단발머리 여성", "30대 중반의 수염 난 남성", "백발이 성성한 노년의 여성", "10대 후반의 곱슬머리 소년", "긴 생머리의 40대 여성", "어깨가 넓은 체격 좋은 중년 남성", "안경을 쓴 20대 남성", "주근깨가 있는 붉은 머리 소녀"],
  outfit: ["낡은 가죽 재킷과 청바지", "깔끔한 네이비 정장", "흰 린넨 셔츠와 베이지 바지", "붉은 체크무늬 플란넬 셔츠", "검은 롱코트와 목도리", "꽃무늬 원피스", "노란 우비", "손으로 짠 두꺼운 아이보리 스웨터"],
  style: ["필름 사진 느낌의 따뜻한 색감", "수채화 일러스트", "시네마틱 영화 스틸, 얕은 심도", "부드러운 파스텔톤 애니메이션 배경 그림", "흑백 다큐멘터리 사진", "유화 질감의 고전 회화풍", "네온 빛이 번지는 사이버펑크 야경 사진", "고요한 미니멀 사진, 넓은 여백"],
  place: ["비 오는 밤의 좁은 골목", "해 질 녘의 한적한 바닷가", "오래된 도서관의 높은 서가 사이", "눈 덮인 숲속 오솔길", "새벽의 텅 빈 지하철 승강장", "햇살이 들어오는 작은 카페", "안개 낀 산 능선", "붐비는 시장 한가운데"],
  action: ["창밖을 바라보며 서 있다", "우산을 쓰고 천천히 걸어간다", "책을 펼쳐 읽고 있다", "카메라를 향해 살짝 웃는다", "멀리 있는 무언가를 가리킨다", "벤치에 앉아 따뜻한 차를 마신다", "뒤돌아보며 손을 흔든다", "눈을 감고 바람을 느낀다"],
  prop: ["낡은 우산", "빛바랜 사진 한 장", "작은 손전등", "김이 오르는 머그잔", "오래된 카메라", "접힌 종이 지도", "", ""],
};

const MAX_WEIGHT = 100;

/** Phrases as { text, weight }: a plain string is a phrase of weight 1; blank and repeated texts are dropped (the first one counts). */
function clean(list) {
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(list) ? list : []) {
    const text = (typeof item === "string" ? item : item?.text);
    if (typeof text !== "string" || !text.trim() || seen.has(text.trim())) continue;
    const weight = typeof item === "string" || item.weight === undefined ? 1 : Number(item.weight);
    if (!Number.isFinite(weight) || weight < 0 || weight > MAX_WEIGHT) throw new HttpError(400, `가중치는 0~${MAX_WEIGHT} 사이여야 합니다: ${text.trim().slice(0, 30)}`);
    seen.add(text.trim());
    out.push({ text: text.trim(), weight });
  }
  return out;
}

/** The built-in pool in the shape of a saved one. */
export const defaultPool = () => ({ categories: POOL_CATEGORIES.map(({ id, label }) => ({ id, label, phrases: clean(DEFAULT_POOL[id]) })) });

/**
 * Checks a pool from the screen or a file: { categories: [{ id?, label, phrases }] } in the order to show.
 * A category without an id gets one; an empty category is allowed (it is skipped when mixing). The old shape { person: [...], ... } is still read.
 */
export function checkPool(input) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) throw new HttpError(400, "풀은 항목별 문구 목록이어야 합니다.");
  const list = Array.isArray(input.categories) ? input.categories : POOL_CATEGORIES.filter(({ id }) => id in input).map(({ id, label }) => ({ id, label, phrases: input[id] }));
  if (!Array.isArray(input.categories) && Object.keys(input).some((key) => !POOL_CATEGORIES.some(({ id }) => id === key))) throw new HttpError(400, "알 수 없는 항목이 있습니다.");
  if (list.length > MAX_CATEGORIES) throw new HttpError(400, `항목은 ${MAX_CATEGORIES}개 이하여야 합니다.`);
  const used = new Set();
  const categories = list.map((item, index) => {
    if (item === null || typeof item !== "object") throw new HttpError(400, `${index + 1}번째 항목이 올바르지 않습니다.`);
    const label = typeof item.label === "string" ? item.label.trim() : "";
    if (!label || label.length > 20) throw new HttpError(400, `${index + 1}번째 항목의 이름은 1~20자여야 합니다.`);
    let id = typeof item.id === "string" && item.id ? item.id : "";
    if (id && !/^[a-z0-9_-]{1,30}$/.test(id)) throw new HttpError(400, `항목 id가 올바르지 않습니다: ${id}`);
    if (!id) for (let n = index + 1; !id; n += 1) if (!used.has(`c${n}`) && !list.some((other) => other?.id === `c${n}`)) id = `c${n}`;
    if (used.has(id)) throw new HttpError(400, `항목 id가 겹칩니다: ${id}`);
    used.add(id);
    const phrases = clean(item.phrases);
    if (phrases.length > MAX_PHRASES || phrases.some((phrase) => phrase.text.length > MAX_LENGTH)) throw new HttpError(400, `${label}: 문구는 ${MAX_PHRASES}개 이하, 각 ${MAX_LENGTH}자 이하여야 합니다.`);
    return { id, label, phrases };
  });
  if (categories.every((category) => category.phrases.every((phrase) => phrase.weight === 0))) throw new HttpError(400, "가중치가 0보다 큰 문구가 하나 이상 있어야 합니다.");
  return { categories };
}

export async function readPool(file) {
  try {
    return checkPool(JSON.parse((await readFile(file, "utf8")).replace(/^﻿/, "")));
  } catch (error) {
    if (error.code === "ENOENT") return defaultPool();
    throw new HttpError(500, `이미지 풀 파일을 읽지 못했습니다: ${error.message}`);
  }
}

export async function writePool(file, input) {
  const pool = checkPool(input);
  await writeFileAtomic(file, `${JSON.stringify(pool, null, 2)}\n`);
  return pool;
}

/** One phrase by weight (a weight of 0 is never drawn); null when nothing can be drawn. */
function draw(phrases, random) {
  const total = phrases.reduce((sum, phrase) => sum + phrase.weight, 0);
  if (total <= 0) return null;
  let at = random() * total;
  for (const phrase of phrases) {
    at -= phrase.weight;
    if (at < 0) return phrase;
  }
  return phrases.findLast((phrase) => phrase.weight > 0);
}

/**
 * `count` combinations, one phrase per category (a category without a drawable phrase is left out). `locked` = { category id: phrase } is kept in every one.
 * Phrases are drawn by weight; the phrases of one category differ between the combinations until the category runs out of them.
 */
export function pickCombinations(pool, { count = 1, locked = {}, random = Math.random } = {}) {
  const wanted = Math.min(24, Math.max(1, Math.floor(Number(count)) || 1));
  const left = Object.fromEntries(pool.categories.map(({ id, phrases }) => [id, [...phrases]]));
  const take = ({ id, phrases }) => {
    if (!left[id].some((phrase) => phrase.weight > 0)) left[id] = [...phrases];
    const phrase = draw(left[id], random);
    if (!phrase) return null;
    left[id] = left[id].filter((item) => item !== phrase);
    return phrase.text;
  };
  return Array.from({ length: wanted }, () =>
    Object.fromEntries(pool.categories.map((category) => [category.id, locked[category.id] || take(category)]).filter(([, text]) => text)),
  );
}

/** One category of one combination again (the screen's dice button), by weight. */
export function pickOne(pool, id, { avoid = "", random = Math.random } = {}) {
  const category = pool.categories.find((item) => item.id === id);
  if (!category) throw new HttpError(400, "알 수 없는 항목입니다.");
  const phrase = draw(category.phrases.filter((item) => item.text !== avoid), random) ?? draw(category.phrases, random);
  if (!phrase) throw new HttpError(400, "이 항목에는 뽑을 문구가 없습니다.");
  return phrase.text;
}

import { readFile } from "node:fs/promises";

import { writeFileAtomic } from "./fs-util.mjs";
import { HttpError } from "./http.mjs";

/** What is mixed: the id (used by the screen and the file) and its name on the screen. */
export const POOL_CATEGORIES = [
  { id: "person", label: "인물" },
  { id: "outfit", label: "의상" },
  { id: "style", label: "화풍" },
  { id: "place", label: "배경" },
  { id: "action", label: "동작" },
  { id: "prop", label: "소품" },
];
const IDS = POOL_CATEGORIES.map((category) => category.id);
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

const clean = (list) => [...new Set((Array.isArray(list) ? list : []).filter((item) => typeof item === "string").map((item) => item.trim()).filter(Boolean))];

/** Checks a pool from the screen or a file; unknown categories are refused, empty ones allowed (they are skipped when mixing). */
export function checkPool(input) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) throw new HttpError(400, "풀은 항목별 문구 목록이어야 합니다.");
  const pool = {};
  for (const key of Object.keys(input)) if (!IDS.includes(key)) throw new HttpError(400, `알 수 없는 항목입니다: ${key}`);
  for (const id of IDS) {
    const list = clean(input[id]);
    if (list.length > MAX_PHRASES || list.some((item) => item.length > MAX_LENGTH)) throw new HttpError(400, `${id}: 문구는 ${MAX_PHRASES}개 이하, 각 ${MAX_LENGTH}자 이하여야 합니다.`);
    pool[id] = list;
  }
  if (IDS.every((id) => pool[id].length === 0)) throw new HttpError(400, "문구가 하나 이상 있어야 합니다.");
  return pool;
}

export async function readPool(file) {
  try {
    return checkPool(JSON.parse((await readFile(file, "utf8")).replace(/^﻿/, "")));
  } catch (error) {
    if (error.code === "ENOENT") return checkPool(DEFAULT_POOL);
    throw new HttpError(500, `이미지 풀 파일을 읽지 못했습니다: ${error.message}`);
  }
}

export async function writePool(file, input) {
  const pool = checkPool(input);
  await writeFileAtomic(file, `${JSON.stringify(pool, null, 2)}\n`);
  return pool;
}

/**
 * `count` combinations, one phrase per category (a category without phrases is left out). `locked` = { category: phrase } is kept in every one.
 * The phrases of one category differ between the combinations as long as the pool has enough of them.
 */
export function pickCombinations(pool, { count = 1, locked = {}, random = Math.random } = {}) {
  const wanted = Math.min(24, Math.max(1, Math.floor(Number(count)) || 1));
  const bag = Object.fromEntries(IDS.map((id) => [id, []]));
  const take = (id) => {
    if (bag[id].length === 0) bag[id] = [...pool[id]].sort(() => random() - 0.5);
    return bag[id].pop();
  };
  return Array.from({ length: wanted }, () => Object.fromEntries(IDS.filter((id) => locked[id] || pool[id]?.length).map((id) => [id, locked[id] || take(id)])));
}

/** One category of one combination again (the screen's dice button). */
export function pickOne(pool, id, { avoid = "", random = Math.random } = {}) {
  if (!IDS.includes(id)) throw new HttpError(400, "알 수 없는 항목입니다.");
  const options = pool[id].filter((item) => item !== avoid);
  const list = options.length ? options : pool[id];
  if (list.length === 0) throw new HttpError(400, "이 항목에는 문구가 없습니다.");
  return list[Math.floor(random() * list.length)];
}

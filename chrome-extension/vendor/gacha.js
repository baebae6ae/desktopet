/**
 * gacha.js — 코인/가챠/장착 아이템 로직 (ES 모듈).
 * 팝업(popup.js)과 콘텐츠 스크립트(content/pet.js) 양쪽에서 그대로 불러 쓴다.
 * 데이터는 chrome.storage.local 에 저장한다: coins, inventory({[itemId]: count}), equipped({[slot]: itemId}).
 */

export const SLOTS = ["head", "face", "arm", "upperBody", "lowerBody", "legs"];
export const SLOT_LABELS = {
  head: "머리",
  face: "얼굴",
  arm: "팔",
  upperBody: "상체",
  lowerBody: "하체",
  legs: "다리",
};

export const RARITY = {
  common: { label: "일반", weight: 65, color: "#9aa4b5" },
  rare: { label: "레어", weight: 27, color: "#37d0ff" },
  epic: { label: "에픽", weight: 8, color: "#ffb03c" },
};

// swatch: 픽셀아트로 캐릭터 몸에 실제로 "박아 넣을" 때 쓰는 대표 색상.
export const ITEMS = [
  { id: "head_cap", slot: "head", name: "캡모자", icon: "🧢", rarity: "common", swatch: "#4a7dc7" },
  { id: "head_ribbon", slot: "head", name: "리본", icon: "🎀", rarity: "common", swatch: "#ff6fa5" },
  { id: "head_tophat", slot: "head", name: "실크햇", icon: "🎩", rarity: "rare", swatch: "#20242b" },
  { id: "head_crown", slot: "head", name: "왕관", icon: "👑", rarity: "epic", swatch: "#ffd23c" },

  { id: "face_glasses", slot: "face", name: "안경", icon: "👓", rarity: "common", swatch: "#3a4150" },
  { id: "face_mask", slot: "face", name: "마스크", icon: "😷", rarity: "common", swatch: "#dfe6ee" },
  { id: "face_shades", slot: "face", name: "선글라스", icon: "🕶️", rarity: "rare", swatch: "#111318" },
  { id: "face_monocle", slot: "face", name: "외알안경", icon: "🧐", rarity: "epic", swatch: "#c9a24b" },

  { id: "arm_band", slot: "arm", name: "밴드", icon: "🩹", rarity: "common", swatch: "#ff8a8a" },
  { id: "arm_glove", slot: "arm", name: "장갑", icon: "🧤", rarity: "common", swatch: "#3a3f4a" },
  { id: "arm_watch", slot: "arm", name: "손목시계", icon: "⌚", rarity: "rare", swatch: "#7d5a3a" },
  { id: "arm_ring", slot: "arm", name: "반지", icon: "💍", rarity: "epic", swatch: "#ffd23c" },

  { id: "body_vest", slot: "upperBody", name: "조끼", icon: "🦺", rarity: "common", swatch: "#f4b942" },
  { id: "body_tie", slot: "upperBody", name: "넥타이", icon: "👔", rarity: "common", swatch: "#7a2e2e" },
  { id: "body_scarf", slot: "upperBody", name: "목도리", icon: "🧣", rarity: "rare", swatch: "#c94f4f" },
  { id: "body_cape", slot: "upperBody", name: "망토", icon: "🦸", rarity: "epic", swatch: "#5b3fae" },

  { id: "lower_shorts", slot: "lowerBody", name: "반바지", icon: "🩳", rarity: "common", swatch: "#3a6ea5" },
  { id: "lower_belt", slot: "lowerBody", name: "벨트", icon: "👖", rarity: "common", swatch: "#5a3b25" },
  { id: "lower_skirt", slot: "lowerBody", name: "치마", icon: "👗", rarity: "rare", swatch: "#d16b9e" },
  { id: "lower_sash", slot: "lowerBody", name: "챔피언 띠", icon: "🎗️", rarity: "epic", swatch: "#c9a227" },

  { id: "legs_socks", slot: "legs", name: "양말", icon: "🧦", rarity: "common", swatch: "#e8e8ef" },
  { id: "legs_sandals", slot: "legs", name: "샌들", icon: "🩴", rarity: "common", swatch: "#8a5a3a" },
  { id: "legs_sneakers", slot: "legs", name: "운동화", icon: "👟", rarity: "rare", swatch: "#2e6fd6" },
  { id: "legs_boots", slot: "legs", name: "레인부츠", icon: "👢", rarity: "epic", swatch: "#4a3222" },
];

// ---- 몸에 "박아 넣는" 픽셀 배지 좌표 (32x32 그리드, sprites.js와 동일 단위) ----
// 머리/얼굴/상체/하체는 캐릭터 실루엣과 같은 SVG에 rect로 합성해서, 별도 스티커가
// 아니라 캐릭터 그림 자체의 일부처럼 보이게 한다(테두리도 실루엣과 같은 톤으로).
const GEAR_OUTLINE = "#2b2b2b";
export const GEAR_ANCHORS = {
  head: { x: 11, y: 1, w: 10, h: 3 },
  face: { x: 10, y: 11, w: 12, h: 2 },
  upperBody: { x: 12, y: 20, w: 8, h: 3 },
  lowerBody: { x: 12, y: 24, w: 8, h: 3 },
};

export function gearRects(slot, item) {
  const a = GEAR_ANCHORS[slot];
  if (!a || !item) return [];
  return [
    { x: a.x - 1, y: a.y - 1, w: a.w + 2, h: a.h + 2, color: GEAR_OUTLINE },
    { x: a.x, y: a.y, w: a.w, h: a.h, color: item.swatch },
  ];
}

export const PULL_COST = 50;
export const EARN_PER_PROMPT = 20;
export const STARTER_COINS = 50;
export const DAILY_BONUS = 30; // 하루 첫 방문 출석 보너스
export const LEVEL_REWARD = 20; // 애정도 레벨업 보상
export const AFFECTION_PER_LEVEL = 8; // 쓰다듬기 n번마다 레벨 1 상승

export function affectionLevel(points) {
  return Math.floor((points || 0) / AFFECTION_PER_LEVEL) + 1;
}

export function itemsBySlot(slot) {
  return ITEMS.filter((i) => i.slot === slot);
}
export function getItem(id) {
  return ITEMS.find((i) => i.id === id) || null;
}

function pickRarity() {
  const total = Object.values(RARITY).reduce((s, r) => s + r.weight, 0);
  let r = Math.random() * total;
  for (const [key, val] of Object.entries(RARITY)) {
    if (r < val.weight) return key;
    r -= val.weight;
  }
  return "common";
}

export function rollItem() {
  const rarity = pickRarity();
  const pool = ITEMS.filter((i) => i.rarity === rarity);
  return pool[Math.floor(Math.random() * pool.length)];
}

export async function getGachaState() {
  const { coins, inventory, equipped } = await chrome.storage.local.get([
    "coins",
    "inventory",
    "equipped",
  ]);
  return {
    coins: typeof coins === "number" ? coins : STARTER_COINS,
    inventory: inventory || {},
    equipped: equipped || {},
  };
}

export async function addCoins(amount) {
  const { coins } = await getGachaState();
  const next = Math.max(0, coins + amount);
  await chrome.storage.local.set({ coins: next });
  return next;
}

export async function pullGacha() {
  const state = await getGachaState();
  if (state.coins < PULL_COST) {
    return { ok: false, reason: "not-enough-coins", coins: state.coins };
  }
  const item = rollItem();
  const nextCoins = state.coins - PULL_COST;
  const isNew = !state.inventory[item.id];
  const nextInventory = { ...state.inventory, [item.id]: (state.inventory[item.id] || 0) + 1 };
  await chrome.storage.local.set({ coins: nextCoins, inventory: nextInventory });
  return { ok: true, item, coins: nextCoins, isNew };
}

export async function setEquipped(slot, itemId) {
  const state = await getGachaState();
  const next = { ...state.equipped, [slot]: itemId || null };
  await chrome.storage.local.set({ equipped: next });
  return next;
}

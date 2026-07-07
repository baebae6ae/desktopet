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

export const ITEMS = [
  { id: "head_cap", slot: "head", name: "캡모자", icon: "🧢", rarity: "common" },
  { id: "head_ribbon", slot: "head", name: "리본", icon: "🎀", rarity: "common" },
  { id: "head_tophat", slot: "head", name: "실크햇", icon: "🎩", rarity: "rare" },
  { id: "head_crown", slot: "head", name: "왕관", icon: "👑", rarity: "epic" },

  { id: "face_glasses", slot: "face", name: "안경", icon: "👓", rarity: "common" },
  { id: "face_mask", slot: "face", name: "마스크", icon: "😷", rarity: "common" },
  { id: "face_shades", slot: "face", name: "선글라스", icon: "🕶️", rarity: "rare" },
  { id: "face_monocle", slot: "face", name: "외알안경", icon: "🧐", rarity: "epic" },

  { id: "arm_band", slot: "arm", name: "밴드", icon: "🩹", rarity: "common" },
  { id: "arm_glove", slot: "arm", name: "장갑", icon: "🧤", rarity: "common" },
  { id: "arm_watch", slot: "arm", name: "손목시계", icon: "⌚", rarity: "rare" },
  { id: "arm_ring", slot: "arm", name: "반지", icon: "💍", rarity: "epic" },

  { id: "body_vest", slot: "upperBody", name: "조끼", icon: "🦺", rarity: "common" },
  { id: "body_tie", slot: "upperBody", name: "넥타이", icon: "👔", rarity: "common" },
  { id: "body_scarf", slot: "upperBody", name: "목도리", icon: "🧣", rarity: "rare" },
  { id: "body_cape", slot: "upperBody", name: "망토", icon: "🦸", rarity: "epic" },

  { id: "lower_shorts", slot: "lowerBody", name: "반바지", icon: "🩳", rarity: "common" },
  { id: "lower_belt", slot: "lowerBody", name: "벨트", icon: "👖", rarity: "common" },
  { id: "lower_skirt", slot: "lowerBody", name: "치마", icon: "👗", rarity: "rare" },
  { id: "lower_sash", slot: "lowerBody", name: "챔피언 띠", icon: "🎗️", rarity: "epic" },

  { id: "legs_socks", slot: "legs", name: "양말", icon: "🧦", rarity: "common" },
  { id: "legs_sandals", slot: "legs", name: "샌들", icon: "🩴", rarity: "common" },
  { id: "legs_sneakers", slot: "legs", name: "운동화", icon: "👟", rarity: "rare" },
  { id: "legs_boots", slot: "legs", name: "레인부츠", icon: "👢", rarity: "epic" },
];

export const PULL_COST = 50;
export const EARN_PER_PROMPT = 20;
export const STARTER_COINS = 50;

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

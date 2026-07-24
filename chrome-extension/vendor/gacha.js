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
// glyph: 머리/얼굴/상체/하체 아이템이 실제로 그 모양처럼 보이도록 그린 사각형
//   조각들(32x32 그리드, sprites.js와 동일 단위) — 하나의 색 블록이 아니라
//   왕관이면 뾰족한 산 모양, 리본이면 나비 모양처럼 실루엣 자체가 다르다.
// bandParts: 팔/다리 아이템은 limb div 위에 얹는 작은 조각 div들(퍼센트 좌표) —
//   시계면 줄+시계판, 운동화면 몸체+밑창처럼 실루엣을 나눠서 표현한다.
export const ITEMS = [
  {
    id: "head_cap", slot: "head", name: "캡모자", icon: "🧢", rarity: "common", swatch: "#4a7dc7",
    glyph: [{ x: 12, y: 0, w: 8, h: 3 }, { x: 17, y: 2, w: 6, h: 1 }],
  },
  {
    id: "head_ribbon", slot: "head", name: "리본", icon: "🎀", rarity: "common", swatch: "#ff6fa5",
    glyph: [{ x: 12, y: 0, w: 3, h: 3 }, { x: 17, y: 0, w: 3, h: 3 }, { x: 15, y: 1, w: 2, h: 2, color: "#e0528a" }],
  },
  {
    id: "head_tophat", slot: "head", name: "실크햇", icon: "🎩", rarity: "rare", swatch: "#20242b",
    glyph: [{ x: 13, y: 0, w: 6, h: 3 }, { x: 10, y: 3, w: 12, h: 1 }],
  },
  {
    id: "head_crown", slot: "head", name: "왕관", icon: "👑", rarity: "epic", swatch: "#ffd23c",
    glyph: [{ x: 11, y: 2, w: 10, h: 2 }, { x: 12, y: 0, w: 2, h: 2 }, { x: 15, y: 0, w: 2, h: 3 }, { x: 18, y: 0, w: 2, h: 2 }],
  },

  {
    id: "face_glasses", slot: "face", name: "안경", icon: "👓", rarity: "common", swatch: "#3a4150",
    glyph: [{ x: 10, y: 10, w: 5, h: 3 }, { x: 17, y: 10, w: 5, h: 3 }, { x: 15, y: 11, w: 2, h: 1 }],
  },
  {
    id: "face_mask", slot: "face", name: "마스크", icon: "😷", rarity: "common", swatch: "#dfe6ee",
    glyph: [{ x: 10, y: 15, w: 12, h: 3 }, { x: 9, y: 14, w: 1, h: 2 }, { x: 22, y: 14, w: 1, h: 2 }],
  },
  {
    id: "face_shades", slot: "face", name: "선글라스", icon: "🕶️", rarity: "rare", swatch: "#111318",
    glyph: [{ x: 9, y: 11, w: 6, h: 3 }, { x: 17, y: 11, w: 6, h: 3 }, { x: 15, y: 12, w: 2, h: 1 }],
  },
  {
    id: "face_monocle", slot: "face", name: "외알안경", icon: "🧐", rarity: "epic", swatch: "#c9a24b",
    glyph: [{ x: 17, y: 10, w: 4, h: 4 }, { x: 18.5, y: 14, w: 1, h: 3 }],
  },

  {
    id: "arm_band", slot: "arm", name: "밴드", icon: "🩹", rarity: "common", swatch: "#ff8a8a",
  },
  {
    id: "arm_glove", slot: "arm", name: "장갑", icon: "🧤", rarity: "common", swatch: "#3a3f4a",
  },
  {
    id: "arm_watch", slot: "arm", name: "손목시계", icon: "⌚", rarity: "rare", swatch: "#7d5a3a",
    bandParts: [
      { left: 20, top: 32, width: 60, height: 36, radius: "4px" },
      { left: 35, top: 18, width: 30, height: 30, radius: "50%", color: "#f2c14e" },
    ],
  },
  {
    id: "arm_ring", slot: "arm", name: "반지", icon: "💍", rarity: "epic", swatch: "#ffd23c",
    bandParts: [{ left: 32, top: 22, width: 34, height: 34, radius: "4px", rotate: 45 }],
  },

  {
    id: "body_vest", slot: "upperBody", name: "조끼", icon: "🦺", rarity: "common", swatch: "#f4b942",
    glyph: [{ x: 12, y: 20, w: 8, h: 5 }, { x: 13, y: 21, w: 1, h: 3, color: "#2b2b2b" }, { x: 18, y: 21, w: 1, h: 3, color: "#2b2b2b" }],
  },
  {
    id: "body_tie", slot: "upperBody", name: "넥타이", icon: "👔", rarity: "common", swatch: "#7a2e2e",
    glyph: [{ x: 15, y: 19, w: 2, h: 2 }, { x: 15, y: 21, w: 2, h: 5 }],
  },
  {
    id: "body_scarf", slot: "upperBody", name: "목도리", icon: "🧣", rarity: "rare", swatch: "#c94f4f",
    glyph: [{ x: 12, y: 19, w: 8, h: 2 }, { x: 14, y: 21, w: 2, h: 4 }],
  },
  {
    id: "body_cape", slot: "upperBody", name: "망토", icon: "🦸", rarity: "epic", swatch: "#5b3fae",
    glyph: [{ x: 12, y: 20, w: 8, h: 1 }, { x: 11, y: 21, w: 10, h: 2 }, { x: 10, y: 23, w: 12, h: 2 }],
  },

  {
    id: "lower_shorts", slot: "lowerBody", name: "반바지", icon: "🩳", rarity: "common", swatch: "#3a6ea5",
    glyph: [{ x: 12, y: 24, w: 3.5, h: 4 }, { x: 16.5, y: 24, w: 3.5, h: 4 }],
  },
  {
    id: "lower_belt", slot: "lowerBody", name: "벨트", icon: "👖", rarity: "common", swatch: "#5a3b25",
    glyph: [{ x: 12, y: 24, w: 8, h: 1.5 }, { x: 15, y: 23.7, w: 2, h: 2, color: "#ffd23c" }],
  },
  {
    id: "lower_skirt", slot: "lowerBody", name: "치마", icon: "👗", rarity: "rare", swatch: "#d16b9e",
    glyph: [{ x: 13, y: 24, w: 6, h: 1 }, { x: 12, y: 25, w: 8, h: 1.5 }, { x: 11, y: 26.5, w: 10, h: 1.5 }],
  },
  {
    id: "lower_sash", slot: "lowerBody", name: "챔피언 띠", icon: "🎗️", rarity: "epic", swatch: "#c9a227",
    glyph: [{ x: 12, y: 20, w: 2, h: 2 }, { x: 14, y: 22, w: 2, h: 2 }, { x: 16, y: 24, w: 2, h: 2 }, { x: 18, y: 26, w: 2, h: 2 }],
  },

  {
    id: "legs_socks", slot: "legs", name: "양말", icon: "🧦", rarity: "common", swatch: "#e8e8ef",
    bandParts: [
      { left: 10, top: 12, width: 80, height: 20, radius: "3px" },
      { left: 10, top: 46, width: 80, height: 20, radius: "3px" },
    ],
  },
  {
    id: "legs_sandals", slot: "legs", name: "샌들", icon: "🩴", rarity: "common", swatch: "#8a5a3a",
    bandParts: [
      { left: 32, top: 15, width: 36, height: 45, radius: "3px" },
      { left: 5, top: 58, width: 90, height: 30, radius: "6px" },
    ],
  },
  {
    id: "legs_sneakers", slot: "legs", name: "운동화", icon: "👟", rarity: "rare", swatch: "#2e6fd6",
    bandParts: [
      { left: 10, top: 8, width: 80, height: 48, radius: "8px" },
      { left: 5, top: 58, width: 90, height: 26, radius: "4px", color: "#22262c" },
    ],
  },
  {
    id: "legs_boots", slot: "legs", name: "레인부츠", icon: "👢", rarity: "epic", swatch: "#4a3222",
    bandParts: [
      { left: 14, top: 2, width: 72, height: 64, radius: "6px" },
      { left: 6, top: 66, width: 88, height: 24, radius: "4px", color: "#22262c" },
    ],
  },
];

// ---- 몸에 "박아 넣는" 픽셀 배지 (32x32 그리드, sprites.js와 동일 단위) ----
// 머리/얼굴/상체/하체는 캐릭터 실루엣과 같은 SVG에 rect로 합성해서, 별도 스티커가
// 아니라 캐릭터 그림 자체의 일부처럼 보이게 한다(테두리도 실루엣과 같은 톤으로).
const GEAR_OUTLINE = "#2b2b2b";

export function gearRects(slot, item) {
  if (!item || !item.glyph || item.glyph.length === 0) return [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of item.glyph) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  const outline = {
    x: Math.max(0, x0 - 1),
    y: Math.max(0, y0 - 1),
    w: x1 - Math.max(0, x0 - 1) + 1,
    h: y1 - Math.max(0, y0 - 1) + 1,
    color: GEAR_OUTLINE,
  };
  const fills = item.glyph.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h, color: r.color || item.swatch }));
  return [outline, ...fills];
}

// 팔/다리는 limb div 자식으로 붙는 작은 조각 div들 — glyph가 아니라 bandParts를
// 쓴다(퍼센트 좌표). bandParts가 없는 아이템(밴드/장갑처럼 단순한 것)은 limb 전체를
// 덮는 기본 블록 하나로 충분해 폴백을 그대로 쓴다.
const DEFAULT_BAND_PARTS = [{ left: 20, top: 30, width: 60, height: 40, radius: "3px" }];

export function bandPartsFor(item) {
  if (!item) return [];
  return item.bandParts || DEFAULT_BAND_PARTS;
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

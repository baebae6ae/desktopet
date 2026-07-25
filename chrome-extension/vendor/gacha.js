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

// ---- 몸에 "박아 넣는" 픽셀 배지 조각 만들기 ----
// 캐릭터 본체는 모서리를 둥글린 실루엣(roundedRect)인데, 초기 장착템은 각진
// 사각형 하나라 "귀엽지 않다"는 피드백을 받았다. 그래서 조각 하나하나도
// 본체와 같은 방식(위/아래 줄을 1칸씩 좁혀 모서리를 깎는 픽셀 라운딩)으로
// 둥글리고, 캐릭터의 볼터치 옆 하이라이트 스팟과 같은 원리로 작은 반짝임을
// 얹어 광택 있는 장난감처럼 보이게 한다.
const SHINE = "#ffffff";
function piece(x, y, w, h, color, opts = {}) {
  const round = opts.round !== false && w >= 3 && h >= 3;
  const shine = opts.shine !== false && w >= 2.4 && h >= 2.4;
  const rects = round
    ? [
        { x: x + 1, y, w: w - 2, h: 1, color },
        { x, y: y + 1, w, h: h - 2, color },
        { x: x + 1, y: y + h - 1, w: w - 2, h: 1, color },
      ]
    : [{ x, y, w, h, color }];
  if (shine) {
    rects.push({
      x: x + w * 0.16,
      y: y + h * 0.16,
      w: Math.max(0.7, w * 0.24),
      h: Math.max(0.6, h * 0.2),
      color: SHINE,
      noOutline: true,
    });
  }
  return rects;
}

// swatch: 픽셀아트로 캐릭터 몸에 실제로 "박아 넣을" 때 쓰는 대표 색상.
// glyph: 머리/얼굴/상체/하체 아이템이 실제로 그 모양처럼 보이도록 그린 사각형
//   조각들(32x32 그리드, sprites.js와 동일 단위) — 하나의 색 블록이 아니라
//   왕관이면 뾰족한 산 모양, 리본이면 나비 모양처럼 실루엣 자체가 다르다.
// bandParts: 팔/다리 아이템은 limb div 위에 얹는 작은 조각 div들(퍼센트 좌표) —
//   시계면 줄+시계판, 운동화면 몸체+밑창처럼 실루엣을 나눠서 표현한다.
export const ITEMS = [
  {
    id: "head_cap", slot: "head", name: "캡모자", icon: "🧢", rarity: "common", swatch: "#4a7dc7",
    glyph: [...piece(12, 0, 8, 3, "#4a7dc7"), ...piece(17, 2, 6, 1, "#4a7dc7", { round: false, shine: false })],
  },
  {
    id: "head_ribbon", slot: "head", name: "리본", icon: "🎀", rarity: "common", swatch: "#ff6fa5",
    glyph: [
      ...piece(12, 0, 3, 3, "#ff6fa5"),
      ...piece(17, 0, 3, 3, "#ff6fa5"),
      ...piece(15, 1, 2, 2, "#e0528a", { round: false, shine: false }),
    ],
  },
  {
    id: "head_tophat", slot: "head", name: "실크햇", icon: "🎩", rarity: "rare", swatch: "#20242b",
    glyph: [...piece(13, 0, 6, 3, "#20242b"), ...piece(10, 3, 12, 1, "#20242b", { round: false, shine: false })],
  },
  {
    id: "head_crown", slot: "head", name: "왕관", icon: "👑", rarity: "epic", swatch: "#ffd23c",
    glyph: [
      ...piece(11, 2, 10, 2, "#ffd23c", { round: false }),
      ...piece(12, 0, 2, 2, "#ffd23c", { round: false, shine: false }),
      ...piece(15, 0, 2, 3, "#ffd23c", { round: false, shine: false }),
      ...piece(18, 0, 2, 2, "#ffd23c", { round: false, shine: false }),
    ],
  },

  {
    id: "face_glasses", slot: "face", name: "안경", icon: "👓", rarity: "common", swatch: "#4a5568",
    glyph: [
      ...piece(10, 10, 5, 3, "#4a5568"),
      ...piece(17, 10, 5, 3, "#4a5568"),
      ...piece(15, 11, 2, 1, "#4a5568", { round: false, shine: false }),
    ],
  },
  {
    id: "face_mask", slot: "face", name: "마스크", icon: "😷", rarity: "common", swatch: "#dfe6ee",
    glyph: [
      ...piece(10, 15, 12, 3, "#dfe6ee"),
      ...piece(9, 14, 1, 2, "#dfe6ee", { round: false, shine: false }),
      ...piece(22, 14, 1, 2, "#dfe6ee", { round: false, shine: false }),
    ],
  },
  {
    id: "face_shades", slot: "face", name: "선글라스", icon: "🕶️", rarity: "rare", swatch: "#111318",
    glyph: [
      ...piece(9, 11, 6, 3, "#111318"),
      ...piece(17, 11, 6, 3, "#111318"),
      ...piece(15, 12, 2, 1, "#111318", { round: false, shine: false }),
    ],
  },
  {
    id: "face_monocle", slot: "face", name: "외알안경", icon: "🧐", rarity: "epic", swatch: "#c9a24b",
    glyph: [...piece(17, 10, 4, 4, "#c9a24b"), ...piece(18.5, 14, 1, 3, "#c9a24b", { round: false, shine: false })],
  },

  {
    id: "arm_band", slot: "arm", name: "밴드", icon: "🩹", rarity: "common", swatch: "#ff8a8a",
  },
  {
    id: "arm_glove", slot: "arm", name: "장갑", icon: "🧤", rarity: "common", swatch: "#7a89c2",
  },
  {
    id: "arm_watch", slot: "arm", name: "손목시계", icon: "⌚", rarity: "rare", swatch: "#7d5a3a",
    bandParts: [
      { left: 20, top: 32, width: 60, height: 36, radius: "6px" },
      { left: 35, top: 18, width: 30, height: 30, radius: "50%", color: "#f2c14e" },
      { left: 42, top: 23, width: 10, height: 8, radius: "50%", color: SHINE, noBorder: true },
    ],
  },
  {
    id: "arm_ring", slot: "arm", name: "반지", icon: "💍", rarity: "epic", swatch: "#ffd23c",
    bandParts: [
      { left: 32, top: 22, width: 34, height: 34, radius: "8px", rotate: 45 },
      { left: 40, top: 28, width: 10, height: 8, radius: "50%", color: SHINE, noBorder: true },
    ],
  },

  {
    id: "body_vest", slot: "upperBody", name: "조끼", icon: "🦺", rarity: "common", swatch: "#f4b942",
    glyph: [
      ...piece(12, 20, 8, 5, "#f4b942"),
      ...piece(13, 21, 1, 3, "#2b2b2b", { round: false, shine: false }),
      ...piece(18, 21, 1, 3, "#2b2b2b", { round: false, shine: false }),
    ],
  },
  {
    id: "body_tie", slot: "upperBody", name: "넥타이", icon: "👔", rarity: "common", swatch: "#c0435a",
    glyph: [
      ...piece(15, 19, 2, 2, "#c0435a", { round: false, shine: false }),
      ...piece(15, 21, 2, 5, "#c0435a", { round: false, shine: false }),
    ],
  },
  {
    id: "body_scarf", slot: "upperBody", name: "목도리", icon: "🧣", rarity: "rare", swatch: "#c94f4f",
    glyph: [...piece(12, 19, 8, 2, "#c94f4f"), ...piece(14, 21, 2, 4, "#c94f4f", { round: false, shine: false })],
  },
  {
    id: "body_cape", slot: "upperBody", name: "망토", icon: "🦸", rarity: "epic", swatch: "#5b3fae",
    glyph: [
      ...piece(12, 20, 8, 1, "#5b3fae", { round: false, shine: false }),
      ...piece(11, 21, 10, 2, "#5b3fae", { round: false, shine: false }),
      ...piece(10, 23, 12, 3, "#5b3fae"),
    ],
  },

  {
    id: "lower_shorts", slot: "lowerBody", name: "반바지", icon: "🩳", rarity: "common", swatch: "#3a6ea5",
    glyph: [...piece(12, 24, 3.5, 4, "#3a6ea5"), ...piece(16.5, 24, 3.5, 4, "#3a6ea5")],
  },
  {
    id: "lower_belt", slot: "lowerBody", name: "벨트", icon: "👖", rarity: "common", swatch: "#5a3b25",
    glyph: [
      ...piece(12, 24, 8, 1.5, "#5a3b25", { round: false, shine: false }),
      ...piece(15, 23.7, 2, 2, "#ffd23c", { round: false, shine: false }),
    ],
  },
  {
    id: "lower_skirt", slot: "lowerBody", name: "치마", icon: "👗", rarity: "rare", swatch: "#d16b9e",
    glyph: [
      ...piece(13, 24, 6, 1, "#d16b9e", { round: false, shine: false }),
      ...piece(12, 25, 8, 1.5, "#d16b9e", { round: false, shine: false }),
      ...piece(11, 26.5, 10, 2.5, "#d16b9e", { round: false }),
    ],
  },
  {
    id: "lower_sash", slot: "lowerBody", name: "챔피언 띠", icon: "🎗️", rarity: "epic", swatch: "#c9a227",
    glyph: [
      ...piece(12, 20, 2, 2, "#c9a227", { round: false, shine: false }),
      ...piece(14, 22, 2, 2, "#c9a227", { round: false, shine: false }),
      ...piece(16, 24, 2, 2, "#c9a227", { round: false, shine: false }),
      ...piece(18, 26, 2, 2, "#c9a227", { round: false, shine: false }),
    ],
  },

  {
    id: "legs_socks", slot: "legs", name: "양말", icon: "🧦", rarity: "common", swatch: "#e8e8ef",
    bandParts: [
      { left: 10, top: 12, width: 80, height: 20, radius: "6px" },
      { left: 10, top: 46, width: 80, height: 20, radius: "6px" },
    ],
  },
  {
    id: "legs_sandals", slot: "legs", name: "샌들", icon: "🩴", rarity: "common", swatch: "#8a5a3a",
    bandParts: [
      { left: 32, top: 15, width: 36, height: 45, radius: "5px" },
      { left: 5, top: 58, width: 90, height: 30, radius: "9px" },
    ],
  },
  {
    id: "legs_sneakers", slot: "legs", name: "운동화", icon: "👟", rarity: "rare", swatch: "#2e6fd6",
    bandParts: [
      { left: 10, top: 8, width: 80, height: 48, radius: "12px" },
      { left: 5, top: 58, width: 90, height: 26, radius: "8px", color: "#22262c" },
      { left: 20, top: 16, width: 22, height: 12, radius: "50%", color: SHINE, noBorder: true },
    ],
  },
  {
    id: "legs_boots", slot: "legs", name: "레인부츠", icon: "👢", rarity: "epic", swatch: "#3aa6a0",
    bandParts: [
      { left: 14, top: 2, width: 72, height: 64, radius: "10px" },
      { left: 6, top: 66, width: 88, height: 24, radius: "8px", color: "#22262c" },
      { left: 22, top: 10, width: 16, height: 24, radius: "6px", color: SHINE, noBorder: true },
    ],
  },
];

// ---- 몸에 "박아 넣는" 픽셀 배지 (32x32 그리드, sprites.js와 동일 단위) ----
// 머리/얼굴/상체/하체는 캐릭터 실루엣과 같은 SVG에 rect로 합성해서, 별도 스티커가
// 아니라 캐릭터 그림 자체의 일부처럼 보이게 한다(테두리도 실루엣과 같은 톤으로).
const GEAR_OUTLINE = "#2b2b2b";

export function gearRects(slot, item) {
  if (!item || !item.glyph || item.glyph.length === 0) return [];
  // 조각마다 각자 테두리를 두른다(전체를 감싸는 하나의 큰 사각형이 아니라) -
  // 챔피언 띠처럼 조각들이 대각선으로 뚝뚝 떨어져 있는 아이템의 경우, 하나의
  // bounding box로 테두리를 그리면 그 사이 빈 공간까지 전부 검게 칠해져서
  // 커다란 검은 덩어리로 보이는 문제가 있었다(조각별로 그려야 갭이 유지된다).
  // 반짝임(noOutline) 조각은 테두리 없이 순수 하이라이트로만 얹는다.
  const outlines = item.glyph
    .filter((r) => !r.noOutline)
    .map((r) => ({
      x: Math.max(0, r.x - 1),
      y: Math.max(0, r.y - 1),
      w: r.w + 2,
      h: r.h + 2,
      color: GEAR_OUTLINE,
    }));
  const fills = item.glyph.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h, color: r.color || item.swatch }));
  return [...outlines, ...fills];
}

// 팔/다리는 limb div 자식으로 붙는 작은 조각 div들 — glyph가 아니라 bandParts를
// 쓴다(퍼센트 좌표). bandParts가 없는 아이템(밴드/장갑처럼 단순한 것)은 limb 전체를
// 덮는 기본 블록 하나로 충분해 폴백을 그대로 쓴다.
const DEFAULT_BAND_PARTS = [{ left: 20, top: 30, width: 60, height: 40, radius: "8px" }];

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

"use strict";

/**
 * 캐릭터 픽셀아트 데이터 + 순수 계산 함수 모음.
 * Node(메인/프리로드 프로세스)와 브라우저(렌더러, contextBridge 경유) 양쪽에서
 * require()로 그대로 가져다 쓸 수 있도록 DOM에 의존하지 않는 순수 로직만 담는다.
 * (실제 <svg> DOM 생성은 여기서 하지 않는다 - Node 컨텍스트에는 document가 없어서
 * 렌더러 쪽 pet-renderer.js가 이 모듈의 순수 데이터(rects)를 받아 그린다.)
 * (desktopet 웹 버전의 script.js와 같은 그림 데이터를 쓰지만, 독립된 앱이라 파일은 복사해 둔다.)
 */

const PX = 4; // 픽셀 1칸의 실제 크기(px)
const COLS = 32;
const ROWS = 32;

const OUTLINE = "#2b2b2b";
const SCREEN_BG = "#0d1f17";
const BLUSH = "#ff9fb8";
const LIMB = PX * 4; // 팔다리 사각형 한 변 크기(px)

// ---------------------------------------------------------
// 도형 헬퍼 + 캐릭터별 실루엣을 좌표 기반으로 절차적으로 그린다.
// (손으로 그린 ASCII 격자 대신 원/타원 수식으로 둥근 실루엣을 만든다)
// ---------------------------------------------------------
function ellipse(cx, cy, rx, ry) {
  return (x, y) => {
    const nx = (x - cx + 0.5) / rx;
    const ny = (y - cy + 0.5) / ry;
    return nx * nx + ny * ny <= 1;
  };
}
function rect(x0, y0, x1, y1) {
  return (x, y) => x >= x0 && x < x1 && y >= y0 && y < y1;
}
function union(...fns) {
  return (x, y) => fns.some((fn) => fn(x, y));
}
function ghostSilhouette(cx, cy, rx, ry, waveY, waveCount) {
  const base = ellipse(cx, cy, rx, ry);
  return (x, y) => {
    if (y < waveY) return base(x, y);
    if (!base(x, waveY)) return false;
    const period = (rx * 2) / waveCount;
    const pos = (((x - (cx - rx)) % period) + period) % period;
    return pos < period * 0.62;
  };
}
function lighten(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255,
    g = (n >> 8) & 255,
    b = n & 255;
  const mix = (c) => Math.min(255, Math.round(c + (255 - c) * amt));
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}
// 모서리가 둥근 네모(디자인 가이드의 "머리는 크고 둥근 네모, 몸은 작고
// 네모난 모양" 요구사항용). x0<=x<x1, y0<=y<y1 사각형의 네 모서리를
// 반지름 r인 사분원으로 깎아낸다.
function roundedRect(x0, y0, x1, y1, r) {
  return (x, y) => {
    const px = x + 0.5;
    const py = y + 0.5;
    if (px < x0 || px > x1 || py < y0 || py > y1) return false;
    const cornerX = px < x0 + r || px > x1 - r;
    const cornerY = py < y0 + r || py > y1 - r;
    if (!cornerX || !cornerY) return true;
    const cx = px < x0 + r ? x0 + r : x1 - r;
    const cy = py < y0 + r ? y0 + r : y1 - r;
    const dx = px - cx;
    const dy = py - cy;
    return dx * dx + dy * dy <= r * r;
  };
}

const SCREEN = { x0: 9, y0: 12, x1: 23, y1: 19 };
const screenTest = rect(SCREEN.x0, SCREEN.y0, SCREEN.x1, SCREEN.y1);
const blushL = ellipse(9.5, 18, 1.8, 1.4);
const blushR = ellipse(22.5, 18, 1.8, 1.4);
const highlightSpot = ellipse(11, 8, 2.6, 2);

// 고양이/로봇/곰돌이가 공유하는 기본 실루엣: 크고 둥근 네모 머리 + 작고
// 네모난 몸. 이 셋은 이제 색깔과 귀 모양으로만 구분된다.
const HEAD = roundedRect(5, 2, 27, 21, 5);
const BODY = roundedRect(11, 19, 21, 28, 2);

const SPECIES = [
  {
    id: "cat",
    label: "고양이",
    colors: { b: "#ffcda3", e: "#ffb3c6" },
    hasLegs: true,
    armCenterPct: 61,
    legTopPct: 86,
    legOffset: 2.4,
    build(colors) {
      const earL = ellipse(9, 3.5, 3, 3.4);
      const earR = ellipse(23, 3.5, 3, 3.4);
      const earInL = ellipse(9, 4.6, 1.5, 1.6);
      const earInR = ellipse(23, 4.6, 1.5, 1.6);
      const tail = ellipse(23, 24, 2, 2.6);
      return {
        silhouette: union(HEAD, BODY, earL, earR, tail),
        layers: [
          { test: blushL, color: BLUSH },
          { test: blushR, color: BLUSH },
          { test: earInL, color: colors.e },
          { test: earInR, color: colors.e },
          { test: highlightSpot, color: lighten(colors.b, 0.45) },
        ],
      };
    },
  },
  {
    id: "robot",
    label: "로봇",
    colors: { b: "#b7c6ff", e: "#e2e9ff" },
    hasLegs: true,
    armCenterPct: 61,
    legTopPct: 86,
    legOffset: 2.4,
    build(colors) {
      const antStem = rect(15, 0, 17, 4);
      const antBall = ellipse(16, 1, 2, 1.8);
      const earL = rect(4, 9, 7, 14);
      const earR = rect(25, 9, 28, 14);
      return {
        silhouette: union(HEAD, BODY, antStem, antBall, earL, earR),
        layers: [
          { test: blushL, color: BLUSH },
          { test: blushR, color: BLUSH },
          { test: antBall, color: colors.e },
          { test: earL, color: colors.e },
          { test: earR, color: colors.e },
          { test: highlightSpot, color: lighten(colors.b, 0.45) },
        ],
      };
    },
  },
  {
    id: "ghost",
    label: "유령",
    colors: { b: "#efecff", e: "#ddd8f8" },
    hasLegs: false,
    armCenterPct: 64,
    build(colors) {
      const silhouette = ghostSilhouette(16, 13.5, 11.5, 13, 22, 4);
      const earL = ellipse(8, 5.5, 2, 2.2);
      const earR = ellipse(24, 5.5, 2, 2.2);
      return {
        silhouette: union(silhouette, earL, earR),
        layers: [
          { test: blushL, color: BLUSH },
          { test: blushR, color: BLUSH },
          { test: earL, color: colors.e },
          { test: earR, color: colors.e },
          { test: highlightSpot, color: lighten(colors.b, 0.35) },
        ],
      };
    },
  },
  {
    id: "slime",
    label: "슬라임",
    colors: { b: "#aeeab8", e: "#79c99a" },
    hasLegs: true,
    armCenterPct: 68,
    legTopPct: 92,
    legOffset: 2.8,
    build(colors) {
      const blob = ellipse(16, 17, 11.5, 11.5);
      const leafStem = rect(15, 3, 17, 7);
      const leaf = ellipse(19, 4, 3, 2);
      return {
        silhouette: union(blob, leafStem, leaf),
        layers: [
          { test: blushL, color: BLUSH },
          { test: blushR, color: BLUSH },
          { test: leaf, color: colors.e },
          { test: leafStem, color: colors.e },
          { test: highlightSpot, color: lighten(colors.b, 0.5) },
        ],
      };
    },
  },
  {
    id: "bear",
    label: "곰돌이",
    colors: { b: "#d9ad7c", e: "#f7ddc0" },
    hasLegs: true,
    armCenterPct: 61,
    legTopPct: 86,
    legOffset: 2.4,
    build(colors) {
      const earL = ellipse(8, 4.5, 2.7, 2.7);
      const earR = ellipse(24, 4.5, 2.7, 2.7);
      const earInL = ellipse(8, 5.1, 1.3, 1.3);
      const earInR = ellipse(24, 5.1, 1.3, 1.3);
      return {
        silhouette: union(HEAD, BODY, earL, earR),
        layers: [
          { test: blushL, color: BLUSH },
          { test: blushR, color: BLUSH },
          { test: earInL, color: colors.e },
          { test: earInR, color: colors.e },
          { test: highlightSpot, color: lighten(colors.b, 0.4) },
        ],
      };
    },
  },
];

const SPECIES_MAP = Object.fromEntries(SPECIES.map((s) => [s.id, s]));

// ---------------------------------------------------------
// 실루엣 + 색 레이어 -> 픽셀 사각형 목록(행 단위로 이어붙임) + 얼굴(화면) 위치(%)
// (box-shadow 수백 개를 쌓는 방식은 일부 Chromium 환경에서, 특히 모션 감소
// 설정과 겹쳤을 때 그림이 실제 위치와 어긋나 보이는 렌더링 버그가 있어서
// 렌더러가 SVG <rect>로 그리도록 데이터만 여기서 만든다.)
// ---------------------------------------------------------
function buildSprite(species) {
  const shape = species.build(species.colors);
  const isSolid = (x, y) => {
    if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return false;
    return shape.silhouette(x, y) || screenTest(x, y);
  };
  const resolveColor = (x, y) => {
    if (screenTest(x, y)) return SCREEN_BG;
    for (const layer of shape.layers) {
      if (layer.test(x, y)) return layer.color;
    }
    return species.colors.b;
  };
  const colorAt = (x, y) => {
    if (!isSolid(x, y)) return null;
    const edge =
      !isSolid(x - 1, y) || !isSolid(x + 1, y) || !isSolid(x, y - 1) || !isSolid(x, y + 1);
    return edge && !screenTest(x, y) ? OUTLINE : resolveColor(x, y);
  };

  const rects = [];
  for (let y = 0; y < ROWS; y++) {
    let runStart = -1;
    let runColor = null;
    for (let x = 0; x <= COLS; x++) {
      const color = x < COLS ? colorAt(x, y) : null;
      if (color !== runColor) {
        if (runColor !== null) {
          rects.push({ x: runStart, y, w: x - runStart, h: 1, color: runColor });
        }
        runStart = x;
        runColor = color;
      }
    }
  }

  const faceBox = {
    topPct: (SCREEN.y0 / ROWS) * 100,
    leftPct: (SCREEN.x0 / COLS) * 100,
    widthPct: ((SCREEN.x1 - SCREEN.x0) / COLS) * 100,
    heightPct: ((SCREEN.y1 - SCREEN.y0) / ROWS) * 100,
  };

  return {
    rects,
    width: COLS * PX,
    height: ROWS * PX,
    faceBox,
  };
}

SPECIES.forEach((s) => {
  s.sprite = buildSprite(s);
});

// 팔다리 4개(양팔/양다리)의 크기/위치를 몸통 크기에 대한 %로 계산한다.
// 실제 DOM 요소 생성은 렌더러가 하지만, 기하학 계산은 순수 함수라 여기 둔다.
function buildLimbs(species, sprite) {
  const pctW = (LIMB / sprite.width) * 100;
  const pctH = (LIMB / sprite.height) * 100;
  const armCenterPct = species.armCenterPct;

  const specs = [
    { part: "arm", side: "left", leftPct: -pctW / 2, topPct: armCenterPct - pctH / 2, widthPct: pctW, heightPct: pctH },
    { part: "arm", side: "right", leftPct: 100 - pctW / 2, topPct: armCenterPct - pctH / 2, widthPct: pctW, heightPct: pctH },
  ];

  if (species.hasLegs) {
    const legOffsetPct = (species.legOffset / COLS) * 100;
    specs.push(
      { part: "leg", side: "left", leftPct: 50 - legOffsetPct - pctW / 2, topPct: species.legTopPct - pctH / 2, widthPct: pctW, heightPct: pctH },
      { part: "leg", side: "right", leftPct: 50 + legOffsetPct - pctW / 2, topPct: species.legTopPct - pctH / 2, widthPct: pctW, heightPct: pctH }
    );
  }

  return specs;
}

const NAME_MAX_LEN = 10;
const NAME_ALLOWED = /[^0-9A-Za-z가-힣ㄱ-ㅎㅏ-ㅣ\s]/g;

function sanitizeName(raw) {
  if (typeof raw !== "string") return "";
  return raw.replace(NAME_ALLOWED, "").trim().slice(0, NAME_MAX_LEN);
}

function makeId() {
  if (
    typeof globalThis.crypto === "object" &&
    typeof globalThis.crypto.randomUUID === "function"
  ) {
    return globalThis.crypto.randomUUID();
  }
  return `pet-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const EXPRESSIONS = {
  happy: { left: ">", mouth: "_", right: "" },
  excited: { left: ">", mouth: "_", right: "<" },
  sleepy: { left: "-", mouth: "_", right: "-" },
  love: { left: ">", mouth: "♥", right: "" },
  surprised: { left: ">", mouth: "o", right: "" },
  crying: { left: "T", mouth: "_", right: "T" },
  embarrassed: { left: ">", mouth: "///", right: "<" },
  angry: { left: ">", mouth: ":[", right: "" },
};

module.exports = {
  PX,
  COLS,
  ROWS,
  LIMB,
  SPECIES,
  SPECIES_MAP,
  EXPRESSIONS,
  buildSprite,
  buildLimbs,
  sanitizeName,
  makeId,
  NAME_MAX_LEN,
};

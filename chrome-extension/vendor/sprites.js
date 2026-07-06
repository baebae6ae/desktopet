/**
 * sprites.js (Chrome 확장용 ES 모듈 포팅)
 * ------------------------------------------------------------------
 * 캐릭터 픽셀아트 데이터 + 순수 계산 함수. DOM에 의존하지 않는다.
 * 데스크톱 앱(desktop-app/shared/sprites.js)과 같은 그림/표정/팔다리 로직을
 * 쓰되, 콘텐츠 스크립트에서 dynamic import 로 불러올 수 있게 ES 모듈로 옮겼다.
 * ------------------------------------------------------------------
 */

export const PX = 4; // 픽셀 1칸의 실제 크기(px)
export const COLS = 32;
export const ROWS = 32;

const OUTLINE = "#2b2b2b";
const SCREEN_BG = "#0d1f17";
const BLUSH = "#ff9fb8";
export const LIMB = PX * 4; // 팔다리 사각형 한 변 크기(px)

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
// 모서리가 둥근 네모(큰 둥근 머리 / 작은 네모 몸통용)
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

const HEAD = roundedRect(5, 2, 27, 21, 5);
const BODY = roundedRect(11, 19, 21, 28, 2);

export const SPECIES = [
  {
    id: "cat",
    label: "고양이",
    colors: { b: "#ffcda3", e: "#ffb3c6" },
    hasLegs: true,
    armCenterPct: 73,
    legTopPct: 86,
    legOffset: 2.4,
    build(colors) {
      const earL = ellipse(9, 3.5, 3, 3.4);
      const earR = ellipse(23, 3.5, 3, 3.4);
      const earInL = ellipse(9, 4.6, 1.5, 1.6);
      const earInR = ellipse(23, 4.6, 1.5, 1.6);
      const tail = union(
              // 꼬리 뿌리 (몸통과 연결되는 부분)
              rect(21, 23, 2, 2),
              rect(22, 21, 2, 2),
              
              // 위로 올라가는 꼬리 줄기
              rect(23, 19, 2, 2),
              rect(23, 17, 2, 2),
              
              // 살짝 말려 들어가는 꼬리 끝점
              rect(22, 16, 2, 2)
            );
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
    armCenterPct: 73,
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
    armCenterPct: 75,
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
    armCenterPct: 76,
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
    armCenterPct: 73,
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

export const SPECIES_MAP = Object.fromEntries(SPECIES.map((s) => [s.id, s]));

export function buildSprite(species) {
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

  return { rects, width: COLS * PX, height: ROWS * PX, faceBox, silhouette: shape.silhouette };
}

SPECIES.forEach((s) => {
  s.sprite = buildSprite(s);
});

// 팔은 "젤리 캡슐" 모양(짧고 통통한 알약꼴)으로 몸통 옆구리에 거의 수평으로 붙인다.
// ARM_OUT은 캡슐 중 몸 밖으로 튀어나와 "보이는" 비율(나머지는 몸통 실루엣 뒤로 숨어
// 이어붙은 것처럼 보인다) - 몸통 쪽으로 더 파고들도록 낮게 잡았다.
const ARM_W_PCT = 18;
const ARM_H_PCT = 12;
const ARM_OUT = 0.6;

// 몸통 실루엣이 실제로 어디서 끝나는지, 고정된 상자 좌표가 아니라 해당 높이(row)를
// 픽셀 단위로 스캔해서 찾는다 - 고양이 꼬리처럼 종족마다 삐져나온 부분이 있어도
// 좌우 팔이 비대칭으로 숨어버리지 않는다.
function silhouetteEdgesAt(sprite, yUnit) {
  let left = null;
  let right = null;
  for (let x = 0; x < COLS; x++) {
    if (yUnit >= 20 && x >= 23) {
      continue; 
    }
    if (sprite.silhouette(x, yUnit) || screenTest(x, yUnit)) {
      if (left === null) left = x;
      right = x + 1;
    }
  }
  return { left, right };
}

export function buildLimbs(species, sprite) {
  const pctW = (LIMB / sprite.width) * 100;
  const pctH = (LIMB / sprite.height) * 100;
  const armCenterPct = species.armCenterPct;
  const armYUnit = Math.round((armCenterPct / 100) * ROWS);
  const edges = silhouetteEdgesAt(sprite, armYUnit);
  const edgeLeftPct = (edges.left / COLS) * 100;
  const edgeRightPct = (edges.right / COLS) * 100;

  const specs = [
    {
      part: "arm",
      side: "left",
      leftPct: edgeLeftPct - ARM_W_PCT * ARM_OUT,
      topPct: armCenterPct - ARM_H_PCT / 2,
      widthPct: ARM_W_PCT,
      heightPct: ARM_H_PCT,
    },
    {
      part: "arm",
      side: "right",
      leftPct: edgeRightPct - ARM_W_PCT * (1 - ARM_OUT),
      topPct: armCenterPct - ARM_H_PCT / 2,
      widthPct: ARM_W_PCT,
      heightPct: ARM_H_PCT,
    },
  ];

  // 다리는 처음 배포됐던 정사각형 모양·위치를 그대로 둔다(테두리만 CSS에서 추가).
  if (species.hasLegs) {
    const legOffsetPct = (species.legOffset / COLS) * 100;
    specs.push(
      { part: "leg", side: "left", leftPct: 50 - legOffsetPct - pctW / 2, topPct: species.legTopPct - pctH / 2, widthPct: pctW, heightPct: pctH },
      { part: "leg", side: "right", leftPct: 50 + legOffsetPct - pctW / 2, topPct: species.legTopPct - pctH / 2, widthPct: pctW, heightPct: pctH }
    );
  }

  return specs;
}

export const EXPRESSIONS = {
  happy: { left: ">", mouth: "_", right: "" },
  excited: { left: ">", mouth: "_", right: "<" },
  sleepy: { left: "-", mouth: "_", right: "-" },
  love: { left: ">", mouth: "♥", right: "" },
  surprised: { left: ">", mouth: "o", right: "" },
  crying: { left: "T", mouth: "_", right: "T" },
  embarrassed: { left: ">", mouth: "///", right: "<" },
  angry: { left: ">", mouth: ":[", right: "" },
  // 낙하 중 비명용 표정
  scared: { left: "O", mouth: "△", right: "O" },
};

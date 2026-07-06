"use strict";

/**
 * 데스크토펫 (DeskToPet)
 * - 순수 프론트엔드(HTML/CSS/JS)로만 동작하는 8비트 데스크탑 펫.
 * - 캐릭터 그림은 이미지 파일 없이 CSS box-shadow 픽셀아트 기법으로 그린다.
 * - 모든 캐릭터의 얼굴은 파워쉘 프롬프트 커서 모양 ">_" 로 통일한다.
 * - 데이터는 이 브라우저의 localStorage 에만 저장되며 서버로 전송되지 않는다.
 *   (다른 브라우저/기기에서는 보이지 않는다. 민감정보를 이름 등에 넣지 말 것.)
 */

(function () {
  // ---------------------------------------------------------
  // 1) 픽셀아트 그리드 상수 (32x32 캔버스)
  // ---------------------------------------------------------
  const PX = 4; // 픽셀 1칸의 실제 크기(px). style.css의 .pet__sprite 관련 값과 일치해야 함.
  const COLS = 32;
  const ROWS = 32;

  const OUTLINE = "#2b2b2b"; // 모든 캐릭터 공통 외곽선 색
  const SCREEN_BG = "#0d1f17"; // 얼굴이 표시되는 "화면" 배경(모든 캐릭터 공통)
  const BLUSH = "#ff9fb8"; // 볼터치 색(모든 캐릭터 공통)
  const LIMB = PX * 4; // 팔다리 사각형 한 변 크기(px)

  // ---------------------------------------------------------
  // 1.5) 도형 헬퍼 + 캐릭터별 실루엣을 좌표 기반으로 절차적으로 그린다.
  //    (손으로 한 칸씩 그린 ASCII 격자 대신, 원/타원 수식으로 둥근 실루엣을
  //    안정적으로 만든다 - 치비 비율의 둥근 얼굴/귀/몸통을 손으로 그리면
  //    좌우가 미묘하게 어긋나기 쉽기 때문)
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
  // 유령 전용: 위쪽은 둥글고 아래쪽은 치맛자락처럼 물결치는 실루엣
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

  // 화면(screen)은 모든 종에서 같은 자리: 얼굴은 머리 중앙보다 살짝 아래.
  const SCREEN = { x0: 9, y0: 12, x1: 23, y1: 19 };
  const screenTest = rect(SCREEN.x0, SCREEN.y0, SCREEN.x1, SCREEN.y1);
  const blushL = ellipse(9.5, 18, 1.8, 1.4);
  const blushR = ellipse(22.5, 18, 1.8, 1.4);
  // 반짝이는 하이라이트: 모든 캐릭터 머리 왼쪽 위에 살짝 밝은 광택을 준다
  const highlightSpot = ellipse(11, 8, 2.6, 2);

  // 고양이/로봇/곰돌이가 공유하는 기본 실루엣: 크고 둥근 네모 머리 + 작고
  // 네모난 몸. 이 셋은 이제 색깔과 귀 모양으로만 구분된다.
  const HEAD = roundedRect(5, 2, 27, 21, 5);
  const BODY = roundedRect(11, 19, 21, 28, 2);

  // 각 종의 실루엣(머리+귀/더듬이+몸통 등)과 색 레이어, 팔다리 위치를 정의한다.
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
  // 2) 실루엣 + 색 레이어 -> 픽셀 사각형 목록(행 단위로 이어붙임) + 얼굴(화면)
  //    위치(%) 계산.
  //    처음에는 이 픽셀아트를 하나의 요소에 수백 개의 box-shadow를 쌓아
  //    그렸는데, 32x32 해상도처럼 그림자 수가 많아지면 특정 브라우저에서
  //    (특히 모션 감소 설정과 겹쳤을 때) 그려진 그림이 실제 요소 위치와
  //    다른 곳에 어긋나 보이는 렌더링 버그가 있었다. 그래서 SVG의 <rect>
  //    여러 개로 그리는 방식으로 바꿨다 - 같은 색이 이어지는 구간은 폭이 넓은
  //    사각형 하나로 합쳐서 요소 개수를 줄인다.
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

  // 캐릭터별 스프라이트는 한 번만 계산해서 재사용
  SPECIES.forEach((s) => {
    s.sprite = buildSprite(s);
  });

  const SVG_NS = "http://www.w3.org/2000/svg";
  function buildSpriteSvg(sprite) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "pet__sprite");
    svg.setAttribute("viewBox", `0 0 ${COLS} ${ROWS}`);
    svg.setAttribute("shape-rendering", "crispEdges");
    // width/height는 style로 지정한다: 속성(attribute)으로 주면 스타일시트의
    // .pet__sprite 규칙(폭/높이)이 우선순위상 그걸 덮어써 버리기 때문.
    svg.style.width = `${sprite.width}px`;
    svg.style.height = `${sprite.height}px`;
    sprite.rects.forEach((r) => {
      const rect = document.createElementNS(SVG_NS, "rect");
      rect.setAttribute("x", r.x);
      rect.setAttribute("y", r.y);
      rect.setAttribute("width", r.w);
      rect.setAttribute("height", r.h);
      rect.setAttribute("fill", r.color);
      svg.appendChild(rect);
    });
    return svg;
  }

  // 팔다리는 픽셀 그리드가 아니라 별도의 작은 사각형 요소로 만든다. 그래야
  // 걸을 때 몸통과 별개로 흔들리는 모션을 줄 수 있다. 위치/크기는 모두 몸통
  // 크기에 대한 %로 계산해서, 화면 앱/데스크톱 앱에서 스케일 방식이 달라도
  // (하나는 바깥 래퍼를 확대, 하나는 body 자체를 확대) 그대로 맞는다.
  function buildLimbs(body, species, sprite, color) {
    const pctW = (LIMB / sprite.width) * 100;
    const pctH = (LIMB / sprite.height) * 100;
    const armCenterPct = species.armCenterPct;

    const specs = [
      { part: "arm", side: "left", leftPct: -pctW / 2, topPct: armCenterPct - pctH / 2 },
      { part: "arm", side: "right", leftPct: 100 - pctW / 2, topPct: armCenterPct - pctH / 2 },
    ];

    if (species.hasLegs) {
      const legOffsetPct = (species.legOffset / COLS) * 100;
      specs.push(
        { part: "leg", side: "left", leftPct: 50 - legOffsetPct - pctW / 2, topPct: species.legTopPct - pctH / 2 },
        { part: "leg", side: "right", leftPct: 50 + legOffsetPct - pctW / 2, topPct: species.legTopPct - pctH / 2 }
      );
    }

    specs.forEach((spec) => {
      const limb = document.createElement("div");
      limb.className = `pet__limb pet__limb--${spec.part} pet__limb--${spec.side}`;
      limb.style.width = `${pctW}%`;
      limb.style.height = `${pctH}%`;
      limb.style.left = `${spec.leftPct}%`;
      limb.style.top = `${spec.topPct}%`;
      limb.style.backgroundColor = color;
      body.appendChild(limb);
    });
  }

  // ---------------------------------------------------------
  // 3) 입력값 검증/이스케이프 (XSS 방지)
  //    - innerHTML을 사용하지 않고 항상 textContent로만 렌더링한다.
  //    - 이름은 한글/영문/숫자/공백만 허용하고 길이를 제한한다.
  // ---------------------------------------------------------
  const NAME_MAX_LEN = 10;
  const NAME_ALLOWED = /[^0-9A-Za-z가-힣ㄱ-ㅎㅏ-ㅣ\s]/g;

  function sanitizeName(raw) {
    if (typeof raw !== "string") return "";
    return raw.replace(NAME_ALLOWED, "").trim().slice(0, NAME_MAX_LEN);
  }

  // ---------------------------------------------------------
  // 4) localStorage 저장/불러오기
  //    주의: localStorage는 "이 브라우저"에만 남는다. 민감정보 저장 금지.
  // ---------------------------------------------------------
  const STORAGE_KEY = "desktopet.v1";

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { pets: [] };
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.pets)) {
        throw new Error("저장된 데이터 형식이 올바르지 않습니다.");
      }
      const validPets = parsed.pets.filter(
        (p) =>
          p &&
          typeof p.id === "string" &&
          SPECIES_MAP[p.species] &&
          typeof p.name === "string" &&
          Number.isFinite(p.affection)
      );
      return { pets: validPets };
    } catch (err) {
      // 조용히 삼키지 않고, 콘솔에 원인을 남기고 사용자에게도 알린다.
      console.error("[데스크펫] 저장된 데이터를 불러오지 못했습니다:", err);
      announce("저장된 데이터를 불러오지 못해 초기화되었습니다.");
      return { pets: [] };
    }
  }

  function saveState(pets) {
    try {
      const payload = {
        pets: pets.map((p) => ({
          id: p.id,
          species: p.species,
          name: p.name,
          affection: p.affection,
        })),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (err) {
      console.error("[데스크펫] 저장에 실패했습니다:", err);
      setFormStatus(
        "저장에 실패했습니다. 브라우저 저장공간(시크릿 모드 등)을 확인해주세요.",
        true
      );
    }
  }

  // ---------------------------------------------------------
  // 5) 공용 유틸
  // ---------------------------------------------------------
  const liveRegion = document.getElementById("live-region");
  function announce(msg) {
    liveRegion.textContent = msg;
  }

  const formStatusEl = document.getElementById("form-status");
  let formStatusTimer = null;
  function setFormStatus(msg, isError) {
    formStatusEl.textContent = msg;
    formStatusEl.dataset.error = isError ? "true" : "false";
    clearTimeout(formStatusTimer);
    formStatusTimer = setTimeout(() => {
      formStatusEl.textContent = "";
    }, 4000);
  }

  function makeId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return `pet-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  // 커서를 올리거나 클릭했을 때 뜨는 말풍선 대사. 대부분 코딩 소재로,
  // 귀엽고 위트있게 썼다(고정된 문자열이라 XSS 걱정 없이 textContent로 표시).
  const BUBBLE_MESSAGES = [
    "버그가 아니라 기능이에요!",
    "세미콜론 어디 갔지...?",
    "일단 되면 절대 건드리지 마세요",
    "커밋 메시지: 진짜 마지막 수정",
    "무한루프에 빠진 것 같아요",
    "console.log 좀 그만 지워주세요",
    "탭이냐 스페이스냐, 그것이 문제로다",
    "새로고침은 해보셨어요?",
    "제 코드는 대체로 완벽해요",
    "머지 전에 리뷰 부탁드려요!",
    "변수명 짓다가 하루가 갔어요",
    "빌드 중... 커피 한 잔 어때요?",
    "오늘도 초록 테스트를 기원해요",
    "깃 충돌 났어요, 도와주세요!",
    "쓰다듬어줘!",
    ">_ 다음 명령을 기다리는 중",
  ];
  function pickMessage() {
    return BUBBLE_MESSAGES[Math.floor(Math.random() * BUBBLE_MESSAGES.length)];
  }

  // ---------------------------------------------------------
  // 5.4) 얼굴 표정 - 터미널 화면에 뜨는 텍스트 자체가 표정이다.
  //    왼쪽눈/입/오른쪽눈, 세 칸으로 나눠서 고정된 자리에 넣는다. 문자열
  //    전체를 가운데 정렬하면 ">_"(2글자)와 ">_<"(3글자)의 눈 위치가 서로
  //    달라져 버리는 문제가 있었다. 오른쪽 눈이 없는 표정(happy 등)은 그
  //    칸을 그냥 비워 둬서 ">_<"에서 "<"만 지운 것처럼 보이게 한다.
  //    전부 고정 문자열이라 textContent로만 표시.
  // ---------------------------------------------------------
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

  // 쓰다듬었을 때(클릭/근접)는 살짝 다른 반응이 나오도록 무작위로 고른다
  const PET_REACTIONS = ["excited", "excited", "love", "embarrassed"];
  function pickReactionExpression() {
    return PET_REACTIONS[Math.floor(Math.random() * PET_REACTIONS.length)];
  }

  const prefersReducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  );

  // ---------------------------------------------------------
  // 5.5) 행동(behavior) 상태 목록
  //    걷기만 반복하지 않도록, 앉기/낮잠/점프/빙글돌기를 무작위로 오가게 한다.
  // ---------------------------------------------------------
  const ACTIVITY_CLASSES = [
    "pet--walking",
    "pet--sitting",
    "pet--sleeping",
    "pet--jumping",
    "pet--spinning",
  ];
  const ACTIVITIES = [
    { type: "walk", className: "pet--walking", weight: 6, minDur: 3, maxDur: 7, expression: "happy" },
    { type: "sit", className: "pet--sitting", weight: 2, minDur: 1.5, maxDur: 3, expression: "happy" },
    { type: "sleep", className: "pet--sleeping", weight: 1.4, minDur: 3.5, maxDur: 6, expression: "sleepy" },
    { type: "jump", className: "pet--jumping", weight: 1, minDur: 0.5, maxDur: 0.5, expression: "surprised" },
    { type: "spin", className: "pet--spinning", weight: 1, minDur: 0.6, maxDur: 0.6, expression: "excited" },
  ];

  function pickActivity() {
    const total = ACTIVITIES.reduce((sum, a) => sum + a.weight, 0);
    let r = Math.random() * total;
    for (const a of ACTIVITIES) {
      if (r < a.weight) return a;
      r -= a.weight;
    }
    return ACTIVITIES[0];
  }

  // ---------------------------------------------------------
  // 6) Pet 클래스: 캐릭터 한 마리
  // ---------------------------------------------------------
  class Pet {
    constructor(manager, data) {
      this.manager = manager;
      this.id = data.id || makeId();
      this.species = SPECIES_MAP[data.species] ? data.species : SPECIES[0].id;
      this.name = sanitizeName(data.name) || SPECIES_MAP[this.species].label;
      this.affection = Number.isFinite(data.affection) ? data.affection : 0;

      this.x = Math.random() * 200;
      this.y = Math.random() * 100;
      this.dx = 0;
      this.dy = 0;
      this.lastReactAt = 0;
      this.excitedTimer = null;
      this.activity = null;
      this.activityTimer = 0;
      this.activityDuration = 0;

      // 실제 스폰 위치가 있으면(스폰 직후 매니저가 넘겨줌) 그 값을 그대로 쓴다.
      // 생성 직후 바로 다시 옮기면(레이아웃 위치는 이동해도) 크롬 계열
      // 브라우저에서 이 캐릭터의 거대한 box-shadow 그림이 이전 위치에
      // 남아있는 렌더링 버그가 있었다. 그래서 DOM에 넣기 전에 최종 위치를
      // 한 번만 정하고 끝낸다(스폰 후 다시 setPosition을 부르지 않음).
      if (Number.isFinite(data.x)) this.x = data.x;
      if (Number.isFinite(data.y)) this.y = data.y;

      this._buildDom();
      // 처음에는 걷기부터 시작한다
      this._enterActivity({ type: "walk", className: "pet--walking", minDur: 3, maxDur: 7, expression: "happy" });
    }

    _buildDom() {
      const species = SPECIES_MAP[this.species];
      const sprite = species.sprite;

      const el = document.createElement("div");
      el.className = "pet";
      el.setAttribute("tabindex", "0");
      el.setAttribute("role", "button");
      el.dataset.petId = this.id;

      const body = document.createElement("div");
      body.className = "pet__body";
      body.style.width = `${sprite.width}px`;
      body.style.height = `${sprite.height}px`;

      // 그림자를 sprite보다 먼저 넣어야 항상 캐릭터 뒤에 깔린다
      const shadow = document.createElement("div");
      shadow.className = "pet__shadow";
      body.appendChild(shadow);

      // 팔다리도 sprite보다 먼저 넣는다: 몸통 실루엣과 겹치는 절반은 자연스럽게
      // 가려지고, 실루엣 밖으로 튀어나온 부분만 보여서 "붙어있는 팔다리"처럼 보인다.
      buildLimbs(body, species, sprite, species.colors.b);

      const spriteEl = buildSpriteSvg(sprite);
      body.appendChild(spriteEl);

      // 얼굴: 왼쪽눈/입/오른쪽눈 세 칸(고정 위치)에 표정 문자를 넣는다.
      // (">_", ">_<", "-_-" 등 - EXPRESSIONS 참고). textContent로만 표시.
      const face = document.createElement("div");
      face.className = "pet__face";
      face.style.top = `${sprite.faceBox.topPct}%`;
      face.style.left = `${sprite.faceBox.leftPct}%`;
      face.style.width = `${sprite.faceBox.widthPct}%`;
      face.style.height = `${sprite.faceBox.heightPct}%`;
      const faceHeightPx = (sprite.faceBox.heightPct / 100) * sprite.height;
      face.style.fontSize = `${Math.max(7, faceHeightPx * 0.62)}px`;

      const faceLeft = document.createElement("span");
      faceLeft.className = "pet__face-slot pet__face-slot--left";
      const faceMouth = document.createElement("span");
      faceMouth.className = "pet__face-slot pet__face-slot--mouth";
      const faceRight = document.createElement("span");
      faceRight.className = "pet__face-slot pet__face-slot--right";
      face.appendChild(faceLeft);
      face.appendChild(faceMouth);
      face.appendChild(faceRight);
      body.appendChild(face);

      this.faceLeftEl = faceLeft;
      this.faceMouthEl = faceMouth;
      this.faceRightEl = faceRight;
      this.setExpression("happy");

      const bubble = document.createElement("div");
      bubble.className = "pet__bubble";
      body.appendChild(bubble);

      const zzz = document.createElement("div");
      zzz.className = "pet__zzz";
      zzz.textContent = "Zzz";
      zzz.setAttribute("aria-hidden", "true");
      body.appendChild(zzz);

      const nameLabel = document.createElement("div");
      nameLabel.className = "pet__name";
      nameLabel.textContent = this.name; // textContent만 사용 (innerHTML 금지)
      body.appendChild(nameLabel);

      el.appendChild(body);

      el.addEventListener("click", () => this.onInteract());
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          this.onInteract();
        }
      });

      this.el = el;
      this.bodyEl = body;
      this.bubbleEl = bubble;
      this.nameEl = nameLabel;
      this.updateAriaLabel();
      this.setPosition(this.x, this.y); // DOM에 넣기 전에 최종 위치를 먼저 정한다

      this.manager.stage.appendChild(el);
    }

    updateAriaLabel() {
      this.el.setAttribute(
        "aria-label",
        `${this.name} (${SPECIES_MAP[this.species].label}) 쓰다듬기, 현재 애정도 ${this.affection}`
      );
    }

    setName(rawName) {
      const cleaned = sanitizeName(rawName);
      if (!cleaned) {
        setFormStatus(
          "이름은 한글/영문/숫자만 1~10자로 입력할 수 있어요.",
          true
        );
        return false;
      }
      this.name = cleaned;
      this.nameEl.textContent = this.name;
      this.updateAriaLabel();
      this.manager.persist();
      return true;
    }

    setPosition(x, y) {
      this.x = x;
      this.y = y;
      this.el.style.left = `${x}px`;
      this.el.style.top = `${y}px`;
    }

    _enterActivity(def) {
      this.activity = def.type;
      this.activityTimer = 0;
      this.activityDuration =
        def.minDur + Math.random() * (def.maxDur - def.minDur);

      this.el.classList.remove(...ACTIVITY_CLASSES);
      // 모션 감소 모드에서는 애니메이션 class를 아예 붙이지 않는다. 붙였다가
      // 다음 프레임에 바로 떼는(에니메이션을 시작하자마자 취소하는) 순간이
      // 생기면, 크롬 계열 브라우저에서 이 캐릭터의 거대한 box-shadow 그림이
      // 완전히 안 보이게 되는 렌더링 버그가 있었다.
      if (!prefersReducedMotion.matches) {
        this.el.classList.add(def.className);
      }

      if (def.type === "walk") {
        // 다시 걷기 시작할 때마다 새로운 방향으로 자연스럽게 방향을 정한다
        const speed = 18 + Math.random() * 22; // px/sec
        const angle = Math.random() * Math.PI * 2;
        this.dx = Math.cos(angle) * speed;
        this.dy = Math.sin(angle) * speed;
      }

      // 앉아있을 때 아주 가끔 시무룩한 표정을 보여준다. 그 외에는 상태에 맞는
      // 기본 표정으로 돌아간다(쓰다듬는 반응이 끝나면 이 표정으로 복귀).
      this.baseExpression =
        def.type === "sit" && Math.random() < 0.12 ? "crying" : def.expression || "happy";
      this.setExpression(this.baseExpression);
    }

    setExpression(name) {
      const expr = EXPRESSIONS[name] || EXPRESSIONS.happy;
      // textContent만 사용
      this.faceLeftEl.textContent = expr.left;
      this.faceMouthEl.textContent = expr.mouth;
      this.faceRightEl.textContent = expr.right;
    }

    onInteract() {
      this.affection += 1;

      // 아주 빠르게 여러 번 누르면(스팸) 화난 표정으로 반응한다
      const now = performance.now();
      this.clickTimestamps = (this.clickTimestamps || []).filter((t) => now - t < 1500);
      this.clickTimestamps.push(now);
      const isSpam = this.clickTimestamps.length >= 4;

      this.react(pickMessage(), isSpam ? "angry" : null);
      announce(`${this.name}이(가) 기뻐해요! 애정도 ${this.affection}`);
      this.updateAriaLabel();
      this.manager.updateAffectionDisplay(this.id, this.affection);
      this.manager.persist();
    }

    react(message, forceExpression) {
      const now = performance.now();
      if (now - this.lastReactAt < 600) return; // 너무 잦은 반응 방지
      this.lastReactAt = now;

      // 앉아있거나 자고 있었다면 깨워서 다시 움직이게 한다
      if (this.activity === "sleep" || this.activity === "sit") {
        this._enterActivity({ type: "walk", className: "pet--walking", minDur: 3, maxDur: 7, expression: "happy" });
      }

      this.setExpression(forceExpression || pickReactionExpression());
      this.bubbleEl.textContent = message; // textContent만 사용
      this.el.classList.add("pet--excited", "pet--talking");

      clearTimeout(this.excitedTimer);
      this.excitedTimer = setTimeout(() => {
        this.el.classList.remove("pet--excited", "pet--talking");
        this.setExpression(this.baseExpression);
      }, 1400);
    }

    update(dt, bounds, mouseClientX, mouseClientY) {
      if (!prefersReducedMotion.matches) {
        this.activityTimer += dt;
        if (this.activityTimer >= this.activityDuration) {
          this._enterActivity(pickActivity());
        }

        if (this.activity === "walk") {
          let nx = this.x + this.dx * dt;
          let ny = this.y + this.dy * dt;

          if (nx <= 0 || nx >= bounds.maxX) {
            this.dx *= -1;
            nx = Math.min(Math.max(nx, 0), bounds.maxX);
          }
          if (ny <= 0 || ny >= bounds.maxY) {
            this.dy *= -1;
            ny = Math.min(Math.max(ny, 0), bounds.maxY);
          }

          // 가끔 방향을 살짝 바꿔 자연스럽게 걷도록 함
          if (Math.random() < 0.01) {
            const angle = Math.random() * Math.PI * 2;
            const speed = Math.hypot(this.dx, this.dy);
            this.dx = Math.cos(angle) * speed;
            this.dy = Math.sin(angle) * speed;
          }

          this.setPosition(nx, ny);
          this.el.classList.toggle("pet--flip", this.dx < 0);
        }
      } else if (this.activity !== null) {
        // 모션 감소 모드에서는 activity를 더 이상 순환시키지 않는다. 이 class
        // 제거는 한 번만 하면 충분한데, 매 프레임 계속 호출하면(no-op이라도)
        // 크롬 계열 브라우저에서 이 캐릭터의 거대한 box-shadow 페인트가 끝없이
        // 무효화되어 화면에 그림이 아예 안 보이는 렌더링 버그가 있었다.
        this.el.classList.remove(...ACTIVITY_CLASSES);
        this.activity = null;
      }

      // 마우스 근접 감지 (뷰포트 좌표 기준)
      if (mouseClientX != null) {
        const rect = this.el.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const dist = Math.hypot(mouseClientX - cx, mouseClientY - cy);
        if (dist < 70) {
          this.react(pickMessage());
        }
      }
    }

    destroy() {
      clearTimeout(this.excitedTimer);
      this.el.remove();
    }
  }

  // ---------------------------------------------------------
  // 7) PetManager: 전체 캐릭터 관리 + 애니메이션 루프 + UI 연동
  // ---------------------------------------------------------
  class PetManager {
    constructor(stageEl, listEl, listEmptyEl) {
      this.stage = stageEl;
      this.listEl = listEl;
      this.listEmptyEl = listEmptyEl;
      this.pets = [];
      this.mouse = { x: null, y: null };
      this._lastTime = null;

      stageEl.addEventListener("pointermove", (e) => {
        this.mouse.x = e.clientX;
        this.mouse.y = e.clientY;
      });
      stageEl.addEventListener("pointerleave", () => {
        this.mouse.x = null;
        this.mouse.y = null;
      });

      window.addEventListener("resize", () => this._clampAllPositions());

      requestAnimationFrame((t) => this._loop(t));
    }

    _getScale() {
      const val = getComputedStyle(document.documentElement).getPropertyValue(
        "--pet-scale"
      );
      const num = parseFloat(val);
      return Number.isFinite(num) ? num : 1;
    }

    _getBounds() {
      const rect = this.stage.getBoundingClientRect();
      const scale = this._getScale();
      const petW = COLS * PX * scale;
      const petH = ROWS * PX * scale + 14; // 이름표 여유 공간
      return {
        maxX: Math.max(0, rect.width - petW),
        maxY: Math.max(0, rect.height - petH),
      };
    }

    _clampAllPositions() {
      const bounds = this._getBounds();
      this.pets.forEach((pet) => {
        pet.setPosition(
          Math.min(pet.x, bounds.maxX),
          Math.min(pet.y, bounds.maxY)
        );
      });
    }

    _loop(timestamp) {
      if (this._lastTime == null) this._lastTime = timestamp;
      const dt = Math.min(0.05, (timestamp - this._lastTime) / 1000);
      this._lastTime = timestamp;

      const bounds = this._getBounds();
      this.pets.forEach((pet) =>
        pet.update(dt, bounds, this.mouse.x, this.mouse.y)
      );

      requestAnimationFrame((t) => this._loop(t));
    }

    spawn(speciesId, data) {
      if (!SPECIES_MAP[speciesId]) return null;
      const bounds = this._getBounds();
      const pet = new Pet(this, {
        species: speciesId,
        name: (data && data.name) || SPECIES_MAP[speciesId].label,
        affection: (data && data.affection) || 0,
        id: data && data.id,
        x: Math.random() * bounds.maxX,
        y: Math.random() * bounds.maxY,
      });
      this.pets.push(pet);
      this.renderList();
      this.persist();
      return pet;
    }

    removePet(id) {
      const idx = this.pets.findIndex((p) => p.id === id);
      if (idx === -1) return;
      this.pets[idx].destroy();
      this.pets.splice(idx, 1);
      this.renderList();
      this.persist();
    }

    resetAll() {
      this.pets.slice().forEach((p) => this.removePet(p.id));
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch (err) {
        console.error("[데스크펫] 초기화 중 저장공간 접근 실패:", err);
      }
      announce("모든 캐릭터가 초기화되었습니다.");
    }

    persist() {
      saveState(this.pets);
    }

    updateAffectionDisplay(id, affection) {
      const row = this.listEl.querySelector(`[data-row-id="${cssEscape(id)}"]`);
      if (row) {
        const span = row.querySelector(".pet-row__affection");
        if (span) span.textContent = `애정도 ${affection}`;
      }
    }

    renderList() {
      // innerHTML을 쓰지 않고 DOM API로만 목록을 다시 그린다.
      while (this.listEl.firstChild) {
        this.listEl.removeChild(this.listEl.firstChild);
      }

      this.listEmptyEl.style.display = this.pets.length ? "none" : "block";

      this.pets.forEach((pet) => {
        const li = document.createElement("li");
        li.className = "pet-row";
        li.dataset.rowId = pet.id;

        const speciesLabel = document.createElement("span");
        speciesLabel.className = "pet-row__species";
        speciesLabel.textContent = SPECIES_MAP[pet.species].label;

        const nameInput = document.createElement("input");
        nameInput.className = "pet-row__name-input";
        nameInput.type = "text";
        nameInput.maxLength = NAME_MAX_LEN;
        nameInput.value = pet.name;
        nameInput.setAttribute(
          "aria-label",
          `${SPECIES_MAP[pet.species].label} 이름 변경`
        );
        nameInput.addEventListener("change", () => {
          const ok = pet.setName(nameInput.value);
          nameInput.value = pet.name; // 정리된 값으로 다시 표시
          if (ok) setFormStatus(`이름이 "${pet.name}"(으)로 변경되었습니다.`);
        });

        const affection = document.createElement("span");
        affection.className = "pet-row__affection";
        affection.textContent = `애정도 ${pet.affection}`;

        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "btn btn--small btn--danger";
        removeBtn.textContent = "삭제";
        removeBtn.setAttribute("aria-label", `${pet.name} 삭제`);
        removeBtn.addEventListener("click", () => {
          this.removePet(pet.id);
          announce(`${pet.name}을(를) 삭제했습니다.`);
        });

        li.appendChild(speciesLabel);
        li.appendChild(nameInput);
        li.appendChild(affection);
        li.appendChild(removeBtn);
        this.listEl.appendChild(li);
      });
    }
  }

  // CSS.escape 폴리필 (구형 브라우저 대비 아주 단순한 대체 구현)
  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") {
      return window.CSS.escape(value);
    }
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  // ---------------------------------------------------------
  // 8) 초기화
  // ---------------------------------------------------------
  document.addEventListener("DOMContentLoaded", () => {
    const stageEl = document.getElementById("stage");
    const listEl = document.getElementById("pet-list");
    const listEmptyEl = document.getElementById("pet-list-empty");
    const spawnButtonsEl = document.getElementById("spawn-buttons");
    const resetBtn = document.getElementById("reset-btn");
    const panelEl = document.getElementById("panel");
    const panelToggleBtn = document.getElementById("panel-toggle");

    const manager = new PetManager(stageEl, listEl, listEmptyEl);

    // 설정 패널은 캐릭터가 화면을 최대한 넓게 쓸 수 있도록 기본적으로 접어 둔다.
    panelToggleBtn.addEventListener("click", () => {
      const willOpen = panelEl.hidden;
      panelEl.hidden = !willOpen;
      panelToggleBtn.setAttribute("aria-expanded", String(willOpen));
    });

    // 종류별 추가 버튼 생성
    SPECIES.forEach((species) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn--spawn";
      btn.textContent = `+ ${species.label}`;
      btn.addEventListener("click", () => {
        manager.spawn(species.id);
        setFormStatus(`${species.label}을(를) 추가했어요.`);
      });
      spawnButtonsEl.appendChild(btn);
    });

    resetBtn.addEventListener("click", () => {
      if (manager.pets.length === 0) {
        setFormStatus("이미 비어 있어요.");
        return;
      }
      const confirmed = window.confirm(
        "모든 캐릭터와 저장된 이름/애정도를 지울까요? 이 작업은 되돌릴 수 없습니다."
      );
      if (confirmed) manager.resetAll();
    });

    // 저장된 상태 불러오기
    const saved = loadState();
    if (saved.pets.length > 0) {
      saved.pets.forEach((p) => manager.spawn(p.species, p));
    } else {
      // 처음 방문 시 기본 캐릭터 한 마리를 보여준다.
      manager.spawn("cat");
    }
  });
})();

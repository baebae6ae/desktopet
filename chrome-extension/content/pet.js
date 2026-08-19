"use strict";

/**
 * pet.js — Chrome 확장 콘텐츠 스크립트.
 * 모든 웹페이지 위(최상위 프레임)에 8비트 펫을 띄운다. 펫은 화면 아래쪽을
 * 좌우로 돌아다니고, 드래그로 옮길 수 있으며, 높은 곳에서 놓으면 "꺄아악"
 * 하고 떨어진다. 클릭하면 계속 돌아다니는 채로 작은 메뉴가 떠서 "뭐 만들지
 * 물어볼지 / 그냥 인사만 할지"를 고르게 하고, 위저드를 선택했을 때만 말풍선
 * 대화창이 열린다. 답을 다 하면 "무엇을 요청해야 하는지" 가이드를 보여준 뒤,
 * [더 정교하게 다듬기] 버튼으로 답변을 담아 nocalhostmore 사이트로 보낸다
 * (광고 퍼널의 목적지).
 */

(async () => {
  // 최상위 프레임에서 한 번만. (iframe/광고 프레임에는 띄우지 않는다)
  if (window.top !== window.self) return;
  if (window.__nchPetInjected) return;
  window.__nchPetInjected = true;

  const url = (p) => chrome.runtime.getURL(p);
  const SITE = "https://nocalhostmore.vercel.app";
  const APP_URL = SITE + "/app.html";

  // ---- 모듈/스타일 로드 (확장 리소스를 dynamic import) ----
  let sprites, questions, share, guide, gacha, categories, css;
  try {
    [sprites, questions, share, guide, gacha, categories, css] = await Promise.all([
      import(url("vendor/sprites.js")),
      import(url("vendor/questions.js")),
      import(url("vendor/share.js")),
      import(url("vendor/guideBuilder.js")),
      import(url("vendor/gacha.js")),
      import(url("vendor/categories.js")),
      fetch(url("content/pet.css")).then((r) => r.text()),
    ]);
  } catch (err) {
    console.warn("[데스크토펫] 리소스 로드 실패:", err);
    return;
  }

  // ---- 설정(켜짐 여부/종족) ----
  // 사이트별 허용 여부는 이제 우리 스토리지가 아니라 크롬의 실제 권한
  // 시스템(optional_host_permissions)이 관리한다: 이 스크립트가 실행되고
  // 있다는 것 자체가 이미 이 사이트에 대한 권한을 받았다는 뜻이라 별도
  // 허용목록 검사가 필요 없다. 팝업에서 권한을 회수하면 background.js가
  // 아래 onMessage로 "정리해"라고 알려준다.
  const store = await chrome.storage.local.get(["enabled", "species"]);
  if (store.enabled === false) return;

  const speciesDef = sprites.SPECIES_MAP[store.species] || sprites.SPECIES[0];

  const PET_SCALE = 0.55;
  const FLOOR_MARGIN = 4; // 화면 맨 아래에서 살짝 띄운다
  const DRAG_THRESHOLD = 5; // 이 픽셀 이상 움직이면 클릭이 아니라 드래그
  const GRAVITY = 2600; // 낙하 가속도(px/s^2)
  const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---- Shadow DOM 호스트 ----
  const host = document.createElement("div");
  host.id = "nch-pet-host";
  const shadow = host.attachShadow({ mode: "open" });
  const styleEl = document.createElement("style");
  styleEl.textContent = css;
  shadow.appendChild(styleEl);
  const layer = document.createElement("div");
  layer.className = "layer";
  shadow.appendChild(layer);
  document.documentElement.appendChild(host);

  // ---- 캐릭터 DOM ----
  const SVG_NS = "http://www.w3.org/2000/svg";
  function buildSpriteSvg(rects, width, height) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "pet__sprite");
    svg.setAttribute("viewBox", `0 0 ${sprites.COLS} ${sprites.ROWS}`);
    svg.setAttribute("shape-rendering", "crispEdges");
    svg.style.width = `${width}px`;
    svg.style.height = `${height}px`;
    for (const r of rects) {
      const rectEl = document.createElementNS(SVG_NS, "rect");
      rectEl.setAttribute("x", r.x);
      rectEl.setAttribute("y", r.y);
      rectEl.setAttribute("width", r.w);
      rectEl.setAttribute("height", r.h);
      rectEl.setAttribute("fill", r.color);
      svg.appendChild(rectEl);
    }
    return svg;
  }

  const sprite = speciesDef.sprite;
  const W = sprite.width * PET_SCALE;
  const H = sprite.height * PET_SCALE;

  const petEl = document.createElement("div");
  petEl.className = "pet";
  petEl.style.width = `${W}px`;
  petEl.style.height = `${H}px`;

  const bodyEl = document.createElement("div");
  bodyEl.className = "pet__body";
  petEl.appendChild(bodyEl);

  const shadowEl = document.createElement("div");
  shadowEl.className = "pet__shadow";
  bodyEl.appendChild(shadowEl);

  const limbEls = {}; // { armLeft, armRight, legLeft, legRight } — 가챠 장착템(팔/다리)을 붙일 자리
  for (const spec of sprites.buildLimbs(speciesDef, sprite)) {
    const limb = document.createElement("div");
    limb.className = `pet__limb pet__limb--${spec.part} pet__limb--${spec.side}`;
    limb.style.width = `${spec.widthPct}%`;
    limb.style.height = `${spec.heightPct}%`;
    limb.style.left = `${spec.leftPct}%`;
    limb.style.top = `${spec.topPct}%`;
    limb.style.backgroundColor = speciesDef.colors.b;
    bodyEl.appendChild(limb);
    limbEls[spec.part + spec.side[0].toUpperCase() + spec.side.slice(1)] = limb;
  }

  // 머리/얼굴/상체/하체 가챠 장착템은 별도 스티커가 아니라 이 SVG의 rect로
  // 같이 그려서 캐릭터 실루엣 자체의 일부처럼(테두리까지) 보이게 한다.
  const BODY_GEAR_SLOTS = ["head", "face", "upperBody", "lowerBody"];
  function gearRectsFor(equipped) {
    if (!equipped) return [];
    const rects = [];
    for (const slot of BODY_GEAR_SLOTS) {
      const item = equipped[slot] && gacha.getItem(equipped[slot]);
      if (item) rects.push(...gacha.gearRects(slot, item));
    }
    return rects;
  }
  let svgEl = null;
  function mountSprite(equipped) {
    const rects = sprite.rects.concat(gearRectsFor(equipped));
    const next = buildSpriteSvg(rects, sprite.width, sprite.height);
    next.style.setProperty("--sprite-scale", PET_SCALE);
    next.style.left = `${(sprite.width * (PET_SCALE - 1)) / 2}px`;
    next.style.top = `${(sprite.height * (PET_SCALE - 1)) / 2}px`;
    if (svgEl) bodyEl.replaceChild(next, svgEl);
    else bodyEl.appendChild(next);
    svgEl = next;
  }
  mountSprite(null);

  const faceEl = document.createElement("div");
  faceEl.className = "pet__face";
  faceEl.style.top = `${sprite.faceBox.topPct}%`;
  faceEl.style.left = `${sprite.faceBox.leftPct}%`;
  faceEl.style.width = `${sprite.faceBox.widthPct}%`;
  faceEl.style.height = `${sprite.faceBox.heightPct}%`;
  const faceHeightPx = (sprite.faceBox.heightPct / 100) * sprite.height * PET_SCALE;
  faceEl.style.fontSize = `${Math.max(6, faceHeightPx * 0.62)}px`;
  const faceLeft = document.createElement("span");
  faceLeft.className = "pet__face-slot";
  const faceMouth = document.createElement("span");
  faceMouth.className = "pet__face-slot";
  const faceRight = document.createElement("span");
  faceRight.className = "pet__face-slot";
  faceEl.append(faceLeft, faceMouth, faceRight);
  bodyEl.appendChild(faceEl);

  const zzzEl = document.createElement("div");
  zzzEl.className = "pet__zzz";
  zzzEl.textContent = "Zzz";
  bodyEl.appendChild(zzzEl);

  // 이미지 위에 올라갔을 때 그 이미지의 대표색을 잠깐 덧입히는 "카멜레온" 연출용
  const tintEl = document.createElement("div");
  tintEl.className = "pet__tint";
  bodyEl.appendChild(tintEl);

  // 미니게임용 장비/오라. 몸통(.pet__body) 애니메이션과 싸우지 않도록 각각
  // 독립된 자식 요소로 두고, 게임 클래스(pet--armed 등)로 보이기만 토글한다.
  // 총/카트는 부드러운 CSS 도형이 아니라 캐릭터 본체와 같은 픽셀아트 SVG로
  // 그려서(검은 테두리 + crispEdges) 뜬금없이 매끈한 UI 부품처럼 안 보이게 한다.
  const GEAR_OUTLINE_COLOR = "#2b2b2b";
  function buildPixelIcon(pieces, vw, vh) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${vw} ${vh}`);
    svg.setAttribute("shape-rendering", "crispEdges");
    svg.setAttribute("preserveAspectRatio", "none");
    svg.style.width = "100%";
    svg.style.height = "100%";
    svg.style.display = "block";
    const addRect = (x, y, w, h, color) => {
      const r = document.createElementNS(SVG_NS, "rect");
      r.setAttribute("x", x);
      r.setAttribute("y", y);
      r.setAttribute("width", w);
      r.setAttribute("height", h);
      r.setAttribute("fill", color);
      svg.appendChild(r);
    };
    for (const p of pieces) {
      if (!p.noOutline) addRect(p.x - 0.6, p.y - 0.6, p.w + 1.2, p.h + 1.2, GEAR_OUTLINE_COLOR);
    }
    for (const p of pieces) addRect(p.x, p.y, p.w, p.h, p.color);
    return svg;
  }
  const GUN_PIECES = [
    { x: 0, y: 3, w: 5, h: 5, color: "#55618a" },
    { x: 4, y: 1, w: 8, h: 4, color: "#8b9bc9" },
    { x: 11, y: 1.5, w: 3, h: 3, color: "#cfe9ff" },
    { x: 6, y: 1.6, w: 2, h: 1, color: "#ffffff", noOutline: true },
  ];
  const KART_PIECES = [
    { x: 1, y: 2, w: 24, h: 6, color: "#ff7a4a" },
    { x: 0, y: 6, w: 26, h: 3, color: "#d13c22" },
    { x: 9, y: 0, w: 7, h: 3, color: "#2e6fd6" },
    { x: 2, y: 8, w: 6, h: 5, color: "#23262c" },
    { x: 18, y: 8, w: 6, h: 5, color: "#23262c" },
    { x: 4, y: 3, w: 3, h: 1.4, color: "#ffffff", noOutline: true },
  ];
  const gunEl = document.createElement("div");
  gunEl.className = "pet__gun";
  gunEl.appendChild(buildPixelIcon(GUN_PIECES, 14, 8));
  bodyEl.appendChild(gunEl);
  const kartEl = document.createElement("div");
  kartEl.className = "pet__kart";
  kartEl.appendChild(buildPixelIcon(KART_PIECES, 26, 13));
  bodyEl.appendChild(kartEl);
  const auraEl = document.createElement("div");
  auraEl.className = "pet__aura";
  bodyEl.appendChild(auraEl);

  // ---- 가챠로 뽑은 팔/다리 장착템 표시 ----
  // 해당 limb div의 자식으로 붙여서 걷기/점프 등 회전·위치를 그대로 물려받고,
  // 단일 색 블록이 아니라 아이템마다 다른 조각 구성(bandParts)으로 그려서
  // 시계는 줄+시계판, 운동화는 몸체+밑창처럼 실루엣이 실제로 구별되게 한다.
  const GEAR_LIMB_KEYS = { arm: ["armLeft", "armRight"], legs: ["legLeft", "legRight"] };
  function renderLimbGear(equipped) {
    for (const el of Object.values(limbEls)) {
      el.querySelectorAll(".pet__gear-band").forEach((b) => b.remove());
    }
    if (!equipped) return;
    for (const [slot, keys] of Object.entries(GEAR_LIMB_KEYS)) {
      const itemId = equipped[slot];
      const item = itemId && gacha.getItem(itemId);
      if (!item) continue;
      for (const key of keys) {
        const limb = limbEls[key];
        if (!limb) continue;
        for (const part of gacha.bandPartsFor(item)) {
          const band = document.createElement("span");
          band.className = "pet__gear-band";
          band.style.left = `${part.left}%`;
          band.style.top = `${part.top}%`;
          band.style.width = `${part.width}%`;
          band.style.height = `${part.height}%`;
          band.style.borderRadius = part.radius || "3px";
          band.style.backgroundColor = part.color || item.swatch;
          if (part.noBorder) band.style.border = "none";
          if (part.rotate) band.style.rotate = `${part.rotate}deg`;
          limb.appendChild(band);
        }
      }
    }
  }
  function applyEquipped(equipped) {
    mountSprite(equipped);
    renderLimbGear(equipped);
  }
  gacha.getGachaState().then((s) => applyEquipped(s.equipped));

  const bubbleEl = document.createElement("div");
  bubbleEl.className = "pet__bubble";
  petEl.appendChild(bubbleEl);

  layer.appendChild(petEl);

  function setExpression(name) {
    const e = sprites.EXPRESSIONS[name] || sprites.EXPRESSIONS.happy;
    faceLeft.textContent = e.left;
    faceMouth.textContent = e.mouth;
    faceRight.textContent = e.right;
  }
  setExpression("happy");

  // ---- 위치/상태 ----
  const ACTIVITY_CLASSES = [
    "pet--walking",
    "pet--sitting",
    "pet--sleeping",
    "pet--jumping",
    "pet--spinning",
    "pet--dancing",
    "pet--stretching",
    "pet--waving",
    "pet--wiggling",
    "pet--tilting",
    "pet--sneezing",
    "pet--hopping",
    "pet--bowing",
    "pet--looking",
    "pet--falling",
    "pet--landing",
  ];
  const state = {
    mode: "roam", // roam | dragging | falling | dialog
    x: Math.random() * Math.max(1, window.innerWidth - W),
    y: 0,
    dx: 0,
    activity: "walk",
    activityTimer: 0,
    activityDuration: 3,
    lastFrame: null,
    vy: 0,
    baseExpression: "happy",
    reactTimer: null,
    fallFxTimer: null,
    climb: null, // 페이지 요소 위에 올라타 있는 동안의 진행 상태(stepClimb 참고)
    nibble: null, // 짧은 텍스트를 냠냠 깨무는 동안의 진행 상태(stepNibble 참고)
    watch: null, // 영상 앞에 앉아 구경하는 동안의 진행 상태(stepWatch 참고)
    typing: null, // 빈 입력창 앞에서 타이핑 흉내를 내는 동안의 진행 상태(stepTyping 참고)
    lastScrollY: window.scrollY,
  };

  function floorTop() {
    return Math.max(0, window.innerHeight - H - FLOOR_MARGIN);
  }
  state.y = floorTop();

  function place() {
    petEl.style.left = `${state.x}px`;
    petEl.style.top = `${state.y}px`;
  }
  place();

  function setActivityClass(cls) {
    petEl.classList.remove(...ACTIVITY_CLASSES);
    if (cls && !prefersReduced) petEl.classList.add(cls);
  }

  const ACTIVITIES = [
    { type: "walk", cls: "pet--walking", weight: 6, min: 3, max: 7, expr: "happy" },
    { type: "sit", cls: "pet--sitting", weight: 2, min: 1.5, max: 3, expr: "happy" },
    { type: "sleep", cls: "pet--sleeping", weight: 1.4, min: 3, max: 5.5, expr: "sleepy" },
    { type: "jump", cls: "pet--jumping", weight: 1, min: 0.5, max: 0.5, expr: "surprised" },
    { type: "spin", cls: "pet--spinning", weight: 1, min: 0.6, max: 0.6, expr: "excited" },
    { type: "dance", cls: "pet--dancing", weight: 1.2, min: 2, max: 3.5, expr: "excited" },
    { type: "stretch", cls: "pet--stretching", weight: 1.2, min: 2, max: 3, expr: "happy" },
    { type: "wave", cls: "pet--waving", weight: 1.4, min: 1.5, max: 2.5, expr: "love" },
    { type: "climb", cls: "pet--walking", weight: 1.6, min: 0, max: 0, expr: "excited" },
    { type: "nibble", cls: "pet--walking", weight: 1.3, min: 0, max: 0, expr: "excited" },
    { type: "watch", cls: "pet--walking", weight: 1.0, min: 0, max: 0, expr: "happy" },
    { type: "type", cls: "pet--walking", weight: 1.0, min: 0, max: 0, expr: "excited" },
    { type: "game", cls: "pet--walking", weight: 1.4, min: 0, max: 0, expr: "excited" },
    { type: "wiggle", cls: "pet--wiggling", weight: 1.2, min: 1.2, max: 2.2, expr: "excited" },
    { type: "tilt", cls: "pet--tilting", weight: 1.1, min: 1.6, max: 1.6, expr: "surprised" },
    { type: "sneeze", cls: "pet--sneezing", weight: 0.8, min: 0.9, max: 0.9, expr: "surprised" },
    { type: "hop", cls: "pet--hopping", weight: 1.2, min: 1.3, max: 2.3, expr: "excited" },
    { type: "bow", cls: "pet--bowing", weight: 0.9, min: 1.4, max: 1.4, expr: "love" },
    { type: "look", cls: "pet--looking", weight: 1.2, min: 2, max: 3, expr: "happy" },
  ];

  // ---- 페이지 요소 위에 잠깐 올라타기 ----
  // 페이지 전체를 자유롭게 기어다니는 건 아니고, 걷기 중간에 끼는 짧은 이벤트: 근처에
  // 보이는 큼직한 요소(버튼/이미지/구분선 등)로 걸어가 톡 뛰어올라 잠깐 그 위를
  // 걷다가 다시 바닥으로 내려온다. 스크롤/리사이즈처럼 좌표가 흔들릴 수 있는
  // 상황이 오면 복잡하게 재계산하지 않고 그냥 바닥으로 되돌린다(cancelClimb).
  //
  // maxLiftY는 원래 260(바닥에서 딱 그만큼 위)이었는데, 실제 사이트에서 재보니
  // sticky 헤더·히어로 이미지·본문 버튼의 liftY가 보통 300~700대라 거의 항상
  // 하나도 안 걸렸다(사실상 죽어있던 기능). 화면에 "지금 보이는" 요소면 얼마나
  // 높이 있든 다 후보로 인정하도록 상한을 없앴다 — 어차피 onscreen 검사가
  // window.innerHeight로 자연스럽게 상한을 잡아준다.
  const CLIMB = {
    selector: 'button, a, header, nav, footer, h1, h2, h3, hr, img, section, article, [role="button"], .btn',
    minWidth: 64,
    minLiftY: 20,
    maxLiftY: Infinity,
    maxReachX: 480,
    maxScan: 500, // 요소가 아주 많은 페이지에서도 한 번에 너무 많이 스캔하지 않도록
    walkSpeed: 30,
    hopSpeed: 640,
    standMin: 2,
    standMax: 4,
  };

  function findClimbTarget(opts = {}) {
    const exclude = opts.exclude;
    const floor = floorTop();
    const petCenterX = state.x + W / 2;
    const candidates = document.querySelectorAll(CLIMB.selector);
    let best = null;
    let bestDist = Infinity;
    let scanned = 0;
    for (const el of candidates) {
      if (scanned++ > CLIMB.maxScan) break;
      if (exclude && exclude.has(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < CLIMB.minWidth || r.height < 6) continue;
      if (r.top < 0 || r.bottom > window.innerHeight || r.left < 0 || r.right > window.innerWidth) continue;
      const liftY = floor - r.top;
      if (liftY < CLIMB.minLiftY || liftY > CLIMB.maxLiftY) continue;
      const cx = r.left + r.width / 2;
      const dist = Math.abs(cx - petCenterX);
      if (dist > CLIMB.maxReachX || dist >= bestDist) continue;
      // 다른 요소(모달, 사이드바 등)에 가려진 자리면 제외
      const probeX = Math.min(Math.max(cx, 0), window.innerWidth - 1);
      const topEl = document.elementFromPoint(probeX, r.top + 2);
      if (!topEl || !(topEl === el || el.contains(topEl))) continue;
      best = { el, rect: r };
      bestDist = dist;
    }
    return best;
  }

  // 이미지 위에 올라갔을 때 그 이미지 대표색을 뽑는다. 다른 도메인 이미지는
  // CORS 헤더가 없으면 캔버스가 "오염"돼 읽기가 막히는데, 그건 그냥 색
  // 연출을 건너뛰면 되는 문제라 실패해도 조용히 null만 돌려준다.
  function sampleDominantColor(imgEl) {
    try {
      const c = document.createElement("canvas");
      c.width = 8;
      c.height = 8;
      const ctx = c.getContext("2d");
      ctx.drawImage(imgEl, 0, 0, 8, 8);
      const data = ctx.getImageData(0, 0, 8, 8).data;
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 10) continue;
        r += data[i];
        g += data[i + 1];
        b += data[i + 2];
        n++;
      }
      if (!n) return null;
      return `rgb(${Math.round(r / n)}, ${Math.round(g / n)}, ${Math.round(b / n)})`;
    } catch (_) {
      return null;
    }
  }

  // ---- 짧은 텍스트를 냠냠 깨물기 / 영상 구경 / 빈 입력창에서 타이핑 흉내 ----
  // 셋 다 "화면에 보이는 대상 근처 바닥으로 걸어가서 뭔가 하고 돌아온다"는
  // climb과 같은 결의 짧은 이벤트라, 대상만 다르고 흐름은 비슷하다.
  function findTextTarget() {
    const petCenterX = state.x + W / 2;
    const candidates = document.querySelectorAll("p, li, a, span, strong, em, b, h1, h2, h3, h4");
    let best = null;
    let bestDist = Infinity;
    let scanned = 0;
    for (const el of candidates) {
      if (scanned++ > CLIMB.maxScan) break;
      if (el.children.length > 0) continue; // 자식 요소가 있는 큰 컨테이너 말고, 텍스트를 직접 담은 말단 요소만
      const text = el.textContent && el.textContent.trim();
      if (!text || text.length < 2 || text.length > 40) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 20 || r.height < 10) continue;
      if (r.top < 0 || r.bottom > window.innerHeight || r.left < 0 || r.right > window.innerWidth) continue;
      const cx = r.left + r.width / 2;
      const dist = Math.abs(cx - petCenterX);
      if (dist > CLIMB.maxReachX || dist >= bestDist) continue;
      best = { el, rect: r };
      bestDist = dist;
    }
    return best;
  }

  function findVideoTarget() {
    const petCenterX = state.x + W / 2;
    const candidates = document.querySelectorAll("video");
    let best = null;
    let bestDist = Infinity;
    for (const el of candidates) {
      const r = el.getBoundingClientRect();
      if (r.width < 120 || r.height < 80) continue;
      if (r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) continue;
      const cx = Math.min(Math.max(r.left + r.width / 2, 0), window.innerWidth);
      const dist = Math.abs(cx - petCenterX);
      if (dist > CLIMB.maxReachX * 1.5 || dist >= bestDist) continue;
      best = { el, rect: r };
      bestDist = dist;
    }
    return best;
  }

  function findEmptyInputTarget() {
    const petCenterX = state.x + W / 2;
    const candidates = document.querySelectorAll(
      'input[type="text"], input[type="search"], input:not([type]), textarea'
    );
    let best = null;
    let bestDist = Infinity;
    for (const el of candidates) {
      if (el.value || el.disabled || el.readOnly) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 60 || r.height < 16) continue;
      if (r.top < 0 || r.bottom > window.innerHeight || r.left < 0 || r.right > window.innerWidth) continue;
      const cx = r.left + r.width / 2;
      const dist = Math.abs(cx - petCenterX);
      if (dist > CLIMB.maxReachX || dist >= bestDist) continue;
      best = { el, rect: r };
      bestDist = dist;
    }
    return best;
  }

  function cancelClimb() {
    if (!state.climb) return;
    if (state.climb.tinted) tintEl.classList.remove("is-active");
    state.climb = null;
    state.y = floorTop();
  }

  // climb 말고도 페이지 요소를 대상으로 하는 짧은 이벤트가 셋(nibble/watch/type)
  // 더 늘어서, 좌표를 무효화하는 리사이즈/스크롤/드래그 지점에서 한 번에 정리한다.
  function cancelSideActivities() {
    cancelClimb();
    if (state.typing) petEl.classList.remove("pet--talking"); // stepTyping이 직접 켜둔 말풍선 정리
    state.nibble = null;
    state.watch = null;
    state.typing = null;
  }

  // 밟고 있는 실제 페이지 요소를 살짝 눌렀다 놓기 - Web Animations API라
  // 인라인 스타일을 건드리지 않고 끝나면 원상복구되며, composite:"add"로
  // 요소가 원래 갖고 있던 transform과도 충돌하지 않는다.
  function bouncePlatform(el, strength) {
    try {
      el.animate(
        [
          { transform: "translateY(0)" },
          { transform: `translateY(${strength}px)` },
          { transform: "translateY(0)" },
        ],
        { duration: 220, easing: "ease-out", composite: "add" }
      );
    } catch (_) {
      // 아주 오래된 브라우저 등에서 animate가 없어도 climb 자체는 계속되게
    }
  }

  // 올라간 다음 하는 행동: 서성이기 외에도 요소와 "상호작용"하는 동작들.
  // stomp(쿵쿵 발구르기)는 밟힌 요소가 실제로 들썩이고, peek(모서리에서
  // 아래 내려다보기)/nap(그 위에서 낮잠)은 요소를 무대 삼아 논다.
  const TOP_ACTIONS = ["pace", "pace", "stomp", "peek", "nap"];

  function stepClimb(dt) {
    const c = state.climb;
    if (!c) return;
    const { left: platformLeft, right: platformRight, top: platformTop } = c.rect;
    const platformY = Math.max(0, platformTop - H);
    const midX = clampX((platformLeft + platformRight) / 2 - W / 2);

    if (c.phase === "approach") {
      const dir = midX >= state.x ? 1 : -1;
      petEl.classList.toggle("pet--flip", dir > 0);
      let nx = state.x + dir * CLIMB.walkSpeed * dt;
      if ((dir > 0 && nx >= midX) || (dir < 0 && nx <= midX)) {
        nx = midX;
        c.phase = "rise";
        setActivityClass("pet--jumping");
        spawnFx("폴짝!");
      }
      state.x = nx;
      state.y = floorTop();
      place();
      return;
    }

    if (c.phase === "rise") {
      state.y -= CLIMB.hopSpeed * dt;
      if (state.y <= platformY) {
        state.y = platformY;
        c.phase = "onTop";
        c.standTimer = 0;
        bouncePlatform(c.el, 3); // 착지 반동: 밟힌 요소가 움찔

        // 이미지 위라면 대표색을 잠깐 몸에 입힌다("카멜레온")
        if (c.el.tagName === "IMG") {
          const color = sampleDominantColor(c.el);
          if (color) {
            tintEl.style.backgroundColor = color;
            tintEl.classList.add("is-active");
            c.tinted = true;
          }
        }

        // 가늘고 긴 요소(구분선, 내비게이션 바 등)는 서성이는 대신 팔을
        // 벌리고 휘청휘청 균형 잡는 "줄타기"를 하도록 우대한다.
        const isTightrope = platformRight - platformLeft > 220 && c.rect.height < 40;
        c.topAction =
          isTightrope && Math.random() < 0.7
            ? "balance"
            : TOP_ACTIONS[Math.floor(Math.random() * TOP_ACTIONS.length)];

        if (c.topAction === "stomp") {
          c.standDuration = 1.9;
          c.stompTimer = 0;
          setActivityClass("pet--hopping");
          setExpression("excited");
          spawnFx("쿵쿵!");
        } else if (c.topAction === "peek") {
          c.standDuration = Infinity; // 모서리 도착 후 리셋
          c.peekSide = Math.random() < 0.5 ? -1 : 1;
          c.peeking = false;
          setActivityClass("pet--walking");
        } else if (c.topAction === "nap") {
          c.standDuration = 3 + Math.random() * 1.5;
          setActivityClass("pet--sleeping");
          setExpression("sleepy");
        } else if (c.topAction === "balance") {
          c.standDuration = 2.4 + Math.random() * 1.3;
          c.dir = Math.random() < 0.5 ? -1 : 1;
          setActivityClass("pet--balancing");
          setExpression("surprised");
          spawnFx("휘청!");
        } else {
          c.standDuration = CLIMB.standMin + Math.random() * (CLIMB.standMax - CLIMB.standMin);
          c.dir = Math.random() < 0.5 ? -1 : 1;
          setActivityClass("pet--walking");
        }
      }
      place();
      return;
    }

    if (c.phase === "onTop") {
      c.standTimer += dt;
      const leftBound = clampX(platformLeft);
      const rightBound = clampX(Math.max(platformLeft, platformRight - W));

      if (c.topAction === "stomp") {
        // 제자리 쿵쿵: 발 구를 때마다 밟힌 요소가 실제로 들썩인다
        c.stompTimer += dt;
        if (c.stompTimer >= 0.45) {
          c.stompTimer -= 0.45;
          bouncePlatform(c.el, 3);
          if (Math.random() < 0.5) spawnFx("쿵!");
        }
        state.y = platformY;
        place();
      } else if (c.topAction === "peek") {
        if (!c.peeking) {
          // 골라둔 쪽 모서리까지 걸어간 뒤, 아래를 빼꼼 내려다본다
          const targetX = c.peekSide < 0 ? leftBound : rightBound;
          const dir = targetX >= state.x ? 1 : -1;
          petEl.classList.toggle("pet--flip", dir > 0);
          let nx = state.x + dir * CLIMB.walkSpeed * dt;
          if ((dir > 0 && nx >= targetX) || (dir < 0 && nx <= targetX)) {
            nx = targetX;
            c.peeking = true;
            c.standTimer = 0;
            c.standDuration = 1.8;
            setActivityClass("pet--tilting");
            setExpression("surprised");
            spawnFx("!");
          }
          state.x = nx;
        }
        state.y = platformY;
        place();
      } else if (c.topAction === "nap") {
        state.y = platformY;
        place();
      } else if (c.topAction === "balance") {
        // 줄타기: pace보다 느리게, CSS 흔들림 애니메이션(pet--balancing)과
        // 함께 왕복한다
        let nx = state.x + c.dir * CLIMB.walkSpeed * 0.45 * dt;
        if (nx <= leftBound) {
          nx = leftBound;
          c.dir = 1;
        } else if (nx >= rightBound) {
          nx = rightBound;
          c.dir = -1;
        }
        petEl.classList.toggle("pet--flip", c.dir > 0);
        state.x = nx;
        state.y = platformY;
        place();
      } else {
        // pace: 요소 폭 안에서 좌우로 서성인다
        let nx = state.x + c.dir * CLIMB.walkSpeed * 0.8 * dt;
        if (nx <= leftBound) {
          nx = leftBound;
          c.dir = 1;
        } else if (nx >= rightBound) {
          nx = rightBound;
          c.dir = -1;
        }
        petEl.classList.toggle("pet--flip", c.dir > 0);
        state.x = nx;
        state.y = platformY;
        place();
      }

      if (c.standTimer >= c.standDuration) {
        if (c.tinted) {
          tintEl.classList.remove("is-active");
          c.tinted = false;
        }
        // 징검다리 건너뛰기: 가끔(최대 2번) 근처의 다른 요소로 곧장
        // 이어서 뛰어넘는다 — 매번 바닥까지 안 내려오고 파쿠르하듯 이동
        const hopsSoFar = c.hopsSoFar || 0;
        const next = hopsSoFar < 2 && Math.random() < 0.45 ? findClimbTarget({ exclude: c.visited }) : null;
        if (next) {
          const leavingEl = c.el;
          c.visited = c.visited || new Set();
          c.visited.add(c.el);
          c.el = next.el;
          c.rect = next.rect;
          c.hopsSoFar = hopsSoFar + 1;
          c.phase = "approach"; // 다음 요소를 향해 다시 걸어간 뒤 rise부터 반복
          setActivityClass("pet--jumping");
          setExpression("excited");
          bouncePlatform(leavingEl, 2);
          spawnFx("폴짝폴짝!");
        } else {
          c.phase = "descend";
          setActivityClass("pet--jumping");
          setExpression("happy");
          bouncePlatform(c.el, 2); // 뛰어내리는 반동
        }
      }
      return;
    }

    if (c.phase === "descend") {
      state.y += CLIMB.hopSpeed * dt;
      const floor = floorTop();
      if (state.y >= floor) {
        state.y = floor;
        state.climb = null;
        place();
        enterActivity(pickActivity());
        return;
      }
      place();
    }
  }

  function stepNibble(dt) {
    const n = state.nibble;
    if (!n) return;
    const targetX = clampX(n.rect.left + n.rect.width / 2 - W / 2);
    if (n.phase === "approach") {
      const dir = targetX >= state.x ? 1 : -1;
      petEl.classList.toggle("pet--flip", dir > 0);
      let nx = state.x + dir * CLIMB.walkSpeed * dt;
      if ((dir > 0 && nx >= targetX) || (dir < 0 && nx <= targetX)) {
        nx = targetX;
        n.phase = "chomp";
        n.timer = 0;
        setActivityClass("pet--bowing");
        setExpression("excited");
        // 텍스트 자체는 안 바뀌고, 요소가 살짝 눌렸다 튀어오르는 "냠" 반응만 준다
        try {
          n.el.animate(
            [
              { transform: "scale(1)" },
              { transform: "scale(0.9)" },
              { transform: "scale(1.05)" },
              { transform: "scale(1)" },
            ],
            { duration: 380, easing: "ease-out" }
          );
        } catch (_) {}
        spawnFx("냠!");
      }
      state.x = nx;
      state.y = floorTop();
      place();
      return;
    }
    n.timer += dt;
    if (n.timer >= 0.6) {
      state.nibble = null;
      enterActivity(pickActivity());
    }
  }

  function stepWatch(dt) {
    const w = state.watch;
    if (!w) return;
    const cx = Math.min(Math.max(w.rect.left + w.rect.width / 2, 0), window.innerWidth);
    const targetX = clampX(cx - W / 2);
    if (w.phase === "approach") {
      const dir = targetX >= state.x ? 1 : -1;
      petEl.classList.toggle("pet--flip", dir > 0);
      let nx = state.x + dir * CLIMB.walkSpeed * dt;
      if ((dir > 0 && nx >= targetX) || (dir < 0 && nx <= targetX)) {
        nx = targetX;
        w.phase = "watching";
        w.timer = 0;
        w.duration = 3 + Math.random() * 2;
        w.nextReact = 1 + Math.random();
        setActivityClass("pet--sitting");
        setExpression("happy");
      }
      state.x = nx;
      state.y = floorTop();
      place();
      return;
    }
    w.timer += dt;
    if (w.timer >= w.nextReact) {
      w.nextReact = w.timer + 1.2 + Math.random() * 1.5;
      spawnFx(Math.random() < 0.5 ? "♥" : "!");
      setExpression("love");
      setTimeout(() => {
        if (state.activity === "watch") setExpression("happy");
      }, 500);
    }
    if (w.timer >= w.duration) {
      state.watch = null;
      enterActivity(pickActivity());
    }
  }

  const TYPE_CHARS = "abcdefghijklmnopqrstuvwxyz    ";
  function stepTyping(dt) {
    const t = state.typing;
    if (!t) return;
    const targetX = clampX(t.rect.left + t.rect.width / 2 - W / 2);
    if (t.phase === "approach") {
      const dir = targetX >= state.x ? 1 : -1;
      petEl.classList.toggle("pet--flip", dir > 0);
      let nx = state.x + dir * CLIMB.walkSpeed * dt;
      if ((dir > 0 && nx >= targetX) || (dir < 0 && nx <= targetX)) {
        nx = targetX;
        t.phase = "typing";
        t.timer = 0;
        t.duration = 2.4;
        t.buf = "";
        t.nextKey = 0;
        setActivityClass("pet--sitting");
        setExpression("excited");
        bubbleEl.textContent = "";
        petEl.classList.add("pet--talking");
      }
      state.x = nx;
      state.y = floorTop();
      place();
      return;
    }
    t.timer += dt;
    if (t.timer >= t.nextKey) {
      t.nextKey = t.timer + 0.08 + Math.random() * 0.09;
      t.buf += TYPE_CHARS[Math.floor(Math.random() * TYPE_CHARS.length)];
      if (t.buf.length > 10) t.buf = t.buf.slice(-10);
      bubbleEl.textContent = t.buf + "_";
    }
    if (t.timer >= t.duration) {
      petEl.classList.remove("pet--talking");
      state.typing = null;
      enterActivity(pickActivity());
    }
  }

  // ============================================================
  // ---- 미니게임 4종 (귀여운 외모 ↔ 액션 장르의 갭) ----
  // 공통 설계: 실패로 손해 보는 구조를 만들지 않는다. 가만히 둬도 펫이 알아서
  // 진행하고, 사용자가 끼어들면(표적 클릭 / 드래그 / 연타) 연출이 더 화려해지고
  // 코인을 더 받는 "참여할수록 이득" 구조다. 소리는 여전히 재생하지 않고
  // 텍스트+CSS로만 표현한다.
  // 랜덤으로도 뜨고(ACTIVITIES의 game), 펫 메뉴 → 같이 놀기에서 직접 고를 수도 있다.
  // ============================================================
  const GAMES = [
    { id: "bubble", label: "🫧 버블건 사격", desc: "떠오르는 표적을 눌러 조준!" },
    { id: "kart", label: "🏎️ 카트 드리프트", desc: "드래그해서 드리프트 궤적을!" },
    { id: "hero", label: "⚡ 히어로 변신", desc: "연타로 변신 게이지를 채워요" },
    { id: "survival", label: "⚔️ 서바이벌 웨이브", desc: "몰려오는 적을 같이 물리쳐요" },
  ];
  const GAME_BODY_CLASSES = ["pet--armed", "pet--kart", "pet--charging", "pet--hero", "pet--battle", "pet--recoil"];

  const game = { type: null, timer: 0, duration: 0, score: 0, coins: 0, entities: [], data: null };

  function gameActive() {
    return game.type !== null;
  }
  function addGameEntity(el) {
    game.entities.push(el);
    layer.appendChild(el);
    return el;
  }
  function clearGameEntities() {
    for (const el of game.entities) el.remove();
    game.entities.length = 0;
  }
  function liveEntities(cls) {
    return game.entities.filter((e) => e.isConnected && e.classList.contains(cls) && !e.dataset.dead);
  }
  function petCenter() {
    const b = petEl.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2, top: b.top, bottom: b.bottom };
  }

  // ---- 화려함 담당: 공용 이펙트 ----
  function fxBurst(cx, cy, color, count = 12, spread = 64) {
    if (prefersReduced) return;
    const wrap = document.createElement("div");
    wrap.className = "gfx gfx-burst";
    wrap.style.left = `${cx}px`;
    wrap.style.top = `${cy}px`;
    for (let i = 0; i < count; i++) {
      const p = document.createElement("span");
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.5;
      const dist = spread * (0.55 + Math.random() * 0.75);
      p.style.setProperty("--tx", `${Math.cos(angle) * dist}px`);
      p.style.setProperty("--ty", `${Math.sin(angle) * dist}px`);
      p.style.setProperty("--d", `${Math.random() * 0.09}s`);
      p.style.backgroundColor = color;
      wrap.appendChild(p);
    }
    layer.appendChild(wrap);
    setTimeout(() => wrap.remove(), 1000);
  }
  function fxRing(cx, cy, color, size = 90) {
    if (prefersReduced) return;
    const r = document.createElement("div");
    r.className = "gfx gfx-ring";
    r.style.left = `${cx}px`;
    r.style.top = `${cy}px`;
    r.style.borderColor = color;
    r.style.setProperty("--ring", `${size}px`);
    layer.appendChild(r);
    setTimeout(() => r.remove(), 640);
  }
  function fxFlash(color) {
    if (prefersReduced) return;
    const f = document.createElement("div");
    f.className = "gfx gfx-flash";
    f.style.backgroundColor = color;
    layer.appendChild(f);
    setTimeout(() => f.remove(), 440);
  }
  function fxScore(cx, cy, text, tone) {
    const t = document.createElement("div");
    t.className = `gfx gfx-score${tone ? ` gfx-score--${tone}` : ""}`;
    t.style.left = `${cx}px`;
    t.style.top = `${cy}px`;
    t.textContent = text;
    layer.appendChild(t);
    setTimeout(() => t.remove(), 1000);
  }
  function recoil() {
    petEl.classList.remove("pet--recoil");
    void petEl.offsetWidth; // 리플로우: 같은 클래스를 다시 넣어도 애니메이션이 재생되게
    petEl.classList.add("pet--recoil");
  }

  // ---- 1. 버블건 사격전 ----
  // 표적을 클릭하면 펫이 그쪽으로 홱 조준해 쏜다(사용자가 "포수" 역할).
  // 안 눌러도 펫이 가끔 알아서 쏘기 때문에 구경만 해도 굴러간다.
  const BUBBLE_GLYPHS = ["🎈", "⭐", "🫧", "💠", "🍬"];
  function startBubble() {
    game.duration = 11;
    game.data = { spawnTimer: 0, autoTimer: 0, maxTargets: 4 };
    petEl.classList.add("pet--armed");
    setActivityClass("pet--sitting");
    setExpression("excited");
    const pc = petCenter();
    spawnFx("버블건 장전!", { impact: true });
    fxRing(pc.x, pc.y, "#8fe9ff", 130);
  }
  function spawnBubbleTarget() {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "gtarget";
    el.textContent = BUBBLE_GLYPHS[Math.floor(Math.random() * BUBBLE_GLYPHS.length)];
    el.style.left = `${30 + Math.random() * Math.max(1, window.innerWidth - 100)}px`;
    el.style.top = `${60 + Math.random() * Math.max(1, window.innerHeight * 0.5)}px`;
    el.style.setProperty("--float", `${2 + Math.random() * 1.6}s`);
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      shootAt(el);
    });
    addGameEntity(el);
  }
  function shootAt(targetEl) {
    if (targetEl.dataset.dead) return;
    targetEl.dataset.dead = "1";
    const pc = petCenter();
    const tb = targetEl.getBoundingClientRect();
    const tx = tb.left + tb.width / 2;
    const ty = tb.top + tb.height / 2;
    const muzzleY = pc.top + 18;
    petEl.classList.toggle("pet--flip", tx > pc.x);
    recoil();
    fxRing(pc.x, muzzleY, "#8fe9ff", 58);

    const bullet = document.createElement("div");
    bullet.className = "gbullet";
    bullet.style.left = `${pc.x}px`;
    bullet.style.top = `${muzzleY}px`;
    bullet.style.setProperty("--dx", `${tx - pc.x}px`);
    bullet.style.setProperty("--dy", `${ty - muzzleY}px`);
    layer.appendChild(bullet);

    setTimeout(() => {
      bullet.remove();
      targetEl.classList.add("is-pop");
      fxBurst(tx, ty, "#8fe9ff", 14, 74);
      fxBurst(tx, ty, "#ffffff", 8, 46);
      fxRing(tx, ty, "#ffffff", 84);
      fxScore(tx, ty - 12, "+2 🪙", "cyan");
      game.score++;
      game.coins += 2;
      setTimeout(() => targetEl.remove(), 260);
    }, 240);
  }
  function stepBubble(dt) {
    const d = game.data;
    d.spawnTimer -= dt;
    if (d.spawnTimer <= 0 && liveEntities("gtarget").length < d.maxTargets) {
      d.spawnTimer = 0.75 + Math.random() * 0.6;
      spawnBubbleTarget();
    }
    d.autoTimer += dt;
    if (d.autoTimer > 2.6) {
      d.autoTimer = 0;
      const t = liveEntities("gtarget")[0];
      if (t) shootAt(t);
    }
  }

  // ---- 2. 카트 드리프트 ----
  // 평소보다 훨씬 빠르게 질주하며 궤적을 남긴다. 드래그하면 그 순간엔
  // 더 뜨거운 궤적이 그려지고, 놓을 때 속도가 빠를수록 화려한 스핀이 터진다.
  // 카트 몸체와 바퀴가 펫 발밑보다 아래로 튀어나오는 만큼, 카트 모드에서는
  // 펫을 살짝 띄워야 바퀴가 화면 밖으로 잘리지 않는다.
  const KART_LIFT = 14;
  function kartFloor() {
    return Math.max(0, floorTop() - KART_LIFT);
  }
  function startKart() {
    game.duration = 10;
    game.data = { trailTimer: 0 };
    petEl.classList.add("pet--kart");
    setActivityClass(null);
    setExpression("excited");
    state.dx = (Math.random() < 0.5 ? -1 : 1) * 190;
    spawnFx("부아아앙!!", { impact: true });
    fxFlash("rgba(255,176,60,0.22)");
  }
  function spawnKartTrail(hot) {
    if (prefersReduced) return;
    const pc = petCenter();
    const t = document.createElement("div");
    t.className = `gtrail${hot ? " gtrail--hot" : ""}`;
    t.style.left = `${pc.x}px`;
    t.style.top = `${pc.bottom - 8}px`;
    layer.appendChild(t);
    setTimeout(() => t.remove(), 620);
  }
  function kartSpin(power) {
    const pc = petCenter();
    fxBurst(pc.x, pc.y, "#ffb03c", 10 + Math.round(power * 14), 60 + power * 70);
    fxRing(pc.x, pc.y, "#ffb03c", 90 + power * 90);
    if (power > 0.55) {
      fxFlash("rgba(255,176,60,0.2)");
      fxRing(pc.x, pc.y, "#ffffff", 150);
      spawnFx("드리프트 대성공!!", { impact: true });
    } else {
      spawnFx("끼이익!");
    }
    const gain = 2 + Math.round(power * 6);
    game.coins += gain;
    fxScore(pc.x, pc.top - 10, `+${gain} 🪙`, "amber");
  }
  function stepKart(dt) {
    const d = game.data;
    let nx = state.x + state.dx * dt;
    if (nx <= 0 || nx >= window.innerWidth - W) {
      state.dx *= -1;
      nx = clampX(nx);
      const pc = petCenter();
      fxBurst(pc.x, pc.y, "#ffb03c", 12, 62);
      fxScore(pc.x, pc.top - 6, "+3 🪙", "amber");
      game.coins += 3;
      spawnFx("끼익!");
    }
    state.x = nx;
    state.y = kartFloor();
    place();
    petEl.classList.toggle("pet--flip", state.dx > 0);
    d.trailTimer += dt;
    if (d.trailTimer > 0.05) {
      d.trailTimer = 0;
      spawnKartTrail(false);
    }
  }

  // ---- 3. 히어로 변신 ----
  // 게이지가 저절로도 차지만, 펫을 연타하면 훨씬 빨리 차고 파티클이 터진다.
  // 다 차면 화면이 번쩍하며 변신 — 못 채워도 시간이 되면 알아서 변신한다.
  function startHero() {
    game.duration = 9;
    game.data = { charge: 0, done: false, pTimer: 0 };
    petEl.classList.add("pet--charging");
    setActivityClass("pet--sitting");
    setExpression("excited");
    spawnFx("변신... 준비...", { impact: true });
    const g = document.createElement("div");
    g.className = "ggauge";
    g.innerHTML = `<div class="ggauge__fill"></div><div class="ggauge__label">연타!</div>`;
    addGameEntity(g);
    game.data.gaugeEl = g;
    game.data.fillEl = g.querySelector(".ggauge__fill");
  }
  function heroTap() {
    const d = game.data;
    if (!d || d.done) return;
    d.charge = Math.min(1, d.charge + 0.12);
    const pc = petCenter();
    fxRing(pc.x, pc.y, "#ffd23c", 72);
    fxBurst(pc.x, pc.y, "#ffd23c", 6, 42);
    if (d.charge >= 1) heroTransform();
  }
  function heroTransform() {
    const d = game.data;
    if (d.done) return;
    d.done = true;
    d.charge = 1;
    petEl.classList.remove("pet--charging");
    petEl.classList.add("pet--hero");
    if (d.gaugeEl) d.gaugeEl.remove();
    const pc = petCenter();
    fxFlash("rgba(255,255,255,0.5)");
    fxRing(pc.x, pc.y, "#ffd23c", 210);
    fxRing(pc.x, pc.y, "#ffffff", 145);
    fxBurst(pc.x, pc.y, "#ffd23c", 22, 132);
    fxBurst(pc.x, pc.y, "#ffffff", 14, 92);
    spawnFx("변신 완료!!", { impact: true });
    game.coins += 12;
    fxScore(pc.x, pc.top - 14, "+12 🪙", "gold");
    game.timer = Math.max(game.timer, game.duration - 2.4); // 변신 후 잠깐 폼 잡고 종료
  }
  function stepHero(dt) {
    const d = game.data;
    const pc = petCenter();
    if (!d.done) {
      d.charge = Math.min(1, d.charge + dt * 0.1); // 안 눌러도 천천히 알아서 찬다
      if (d.fillEl) d.fillEl.style.width = `${Math.round(d.charge * 100)}%`;
      if (d.gaugeEl) {
        d.gaugeEl.style.left = `${pc.x}px`;
        d.gaugeEl.style.top = `${pc.top - 30}px`;
      }
      d.pTimer += dt;
      if (d.pTimer > 0.16 && !prefersReduced) {
        d.pTimer = 0;
        const s = document.createElement("div");
        s.className = "gspark";
        s.style.left = `${pc.x + (Math.random() - 0.5) * 48}px`;
        s.style.top = `${pc.bottom - 6}px`;
        layer.appendChild(s);
        setTimeout(() => s.remove(), 740);
      }
      if (d.charge >= 1) heroTransform();
    }
  }

  // ---- 4. 서바이벌 웨이브 ----
  // 적이 몰려오면 펫이 알아서 반격한다. 사용자가 직접 적을 클릭하면 즉시
  // 터지고 콤보가 쌓여 보너스가 커진다(안 눌러도 지는 일은 없다).
  const ENEMY_GLYPHS = ["👾", "🦠", "🐛", "👻"];
  function startSurvival() {
    game.duration = 13;
    game.data = { spawnTimer: 0, atkTimer: 0, combo: 0, comboTimer: 0 };
    petEl.classList.add("pet--battle");
    setActivityClass("pet--sitting");
    setExpression("excited");
    spawnFx("적이 몰려온다!", { impact: true });
    fxFlash("rgba(255,60,60,0.18)");
  }
  function spawnEnemy() {
    const fromLeft = Math.random() < 0.5;
    const x = fromLeft ? -34 : window.innerWidth + 12;
    const el = document.createElement("button");
    el.type = "button";
    el.className = "genemy";
    el.textContent = ENEMY_GLYPHS[Math.floor(Math.random() * ENEMY_GLYPHS.length)];
    el.style.left = `${x}px`;
    el.style.top = `${floorTop() + H * 0.3}px`;
    el.dataset.x = String(x);
    el.dataset.dir = fromLeft ? "1" : "-1";
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      killEnemy(el, true);
    });
    addGameEntity(el);
  }
  function killEnemy(el, byUser) {
    if (el.dataset.dead) return;
    el.dataset.dead = "1";
    const b = el.getBoundingClientRect();
    const cx = b.left + b.width / 2;
    const cy = b.top + b.height / 2;
    const d = game.data;
    fxBurst(cx, cy, byUser ? "#ff6fa5" : "#5cff8f", byUser ? 16 : 10, byUser ? 80 : 54);
    fxRing(cx, cy, byUser ? "#ff6fa5" : "#5cff8f", 72);
    let gain = byUser ? 3 : 1;
    if (byUser) {
      d.combo++;
      d.comboTimer = 0;
      if (d.combo >= 2) {
        gain += Math.min(4, d.combo - 1);
        fxScore(cx, cy - 24, `${d.combo} COMBO!`, "pink");
        fxRing(cx, cy, "#ffffff", 100);
      }
    }
    game.coins += gain;
    game.score++;
    fxScore(cx, cy, `+${gain} 🪙`, byUser ? "pink" : "green");
    el.classList.add("is-pop");
    setTimeout(() => el.remove(), 240);
  }
  function stepSurvival(dt) {
    const d = game.data;
    const pc = petCenter();
    d.spawnTimer -= dt;
    if (d.spawnTimer <= 0 && liveEntities("genemy").length < 6) {
      d.spawnTimer = 0.85 + Math.random() * 0.7;
      spawnEnemy();
    }
    d.comboTimer += dt;
    if (d.comboTimer > 1.6) d.combo = 0;

    // 적은 펫 쪽으로 걸어오다 일정 거리에서 멈춰 위협만 한다(피해는 없다)
    for (const el of liveEntities("genemy")) {
      const dir = Number(el.dataset.dir);
      const x = Number(el.dataset.x);
      if (Math.abs(x - pc.x) > 46) {
        const nx = x + dir * 64 * dt;
        el.dataset.x = String(nx);
        el.style.left = `${nx}px`;
      }
      el.classList.toggle("is-flip", dir < 0);
    }

    d.atkTimer += dt;
    if (d.atkTimer > 0.75) {
      d.atkTimer = 0;
      let nearest = null;
      let best = Infinity;
      for (const el of liveEntities("genemy")) {
        const dist = Math.abs(Number(el.dataset.x) - pc.x);
        if (dist < best) {
          best = dist;
          nearest = el;
        }
      }
      if (nearest && best < 280) {
        petEl.classList.toggle("pet--flip", Number(nearest.dataset.x) > pc.x);
        recoil();
        fxRing(pc.x, pc.y, "#5cff8f", 56);
        killEnemy(nearest, false);
      }
    }
  }

  // ---- 게임 공통 진행/종료 ----
  function startGame(type) {
    if (gameActive()) endGame({ quiet: true });
    closeMenu();
    cancelSideActivities();
    state.mode = "roam";
    state.activity = "game";
    state.activityTimer = 0;
    state.activityDuration = Infinity; // stepGame이 제한시간을 직접 센다
    state.baseExpression = "excited";
    game.type = type;
    game.timer = 0;
    game.score = 0;
    game.coins = 0;
    game.entities = [];
    game.data = null;
    petEl.classList.remove(...GAME_BODY_CLASSES);
    if (type === "bubble") startBubble();
    else if (type === "kart") startKart();
    else if (type === "hero") startHero();
    else startSurvival();
  }
  function stepGame(dt) {
    game.timer += dt;
    if (game.type === "bubble") stepBubble(dt);
    else if (game.type === "kart") stepKart(dt);
    else if (game.type === "hero") stepHero(dt);
    else if (game.type === "survival") stepSurvival(dt);
    game.entities = game.entities.filter((e) => e.isConnected);
    if (game.timer >= game.duration) endGame();
  }
  function endGame({ quiet = false } = {}) {
    if (!gameActive()) return;
    const earned = game.coins;
    clearGameEntities();
    petEl.classList.remove(...GAME_BODY_CLASSES);
    game.type = null;
    game.data = null;
    if (earned > 0) {
      gacha.addCoins(earned);
      const pc = petCenter();
      fxScore(pc.x, pc.top - 34, `합계 +${earned} 🪙`, "gold");
      fxRing(pc.x, pc.y, "#ffd23c", 120);
    }
    state.y = floorTop();
    place();
    if (!quiet && state.mode === "roam") enterActivity(pickActivity());
  }

  function pickActivity() {
    const total = ACTIVITIES.reduce((s, a) => s + a.weight, 0);
    let r = Math.random() * total;
    for (const a of ACTIVITIES) {
      if (r < a.weight) return a;
      r -= a.weight;
    }
    return ACTIVITIES[0];
  }
  function enterActivity(a) {
    if (a.type === "game") {
      startGame(GAMES[Math.floor(Math.random() * GAMES.length)].id);
      return;
    }
    if (a.type === "climb") {
      const target = findClimbTarget();
      if (!target) {
        enterActivity(ACTIVITIES[0]); // 근처에 밟을 만한 게 없으면 그냥 걷기
        return;
      }
      state.activity = "climb";
      state.activityTimer = 0;
      state.activityDuration = Infinity; // stepClimb가 다 끝나면 알아서 다음 행동을 고른다
      state.climb = { el: target.el, rect: target.rect, phase: "approach", visited: new Set([target.el]) };
      setActivityClass("pet--walking");
      state.baseExpression = "excited";
      setExpression("excited");
      return;
    }
    if (a.type === "nibble" || a.type === "watch" || a.type === "type") {
      const finder = a.type === "nibble" ? findTextTarget : a.type === "watch" ? findVideoTarget : findEmptyInputTarget;
      const target = finder();
      if (!target) {
        enterActivity(ACTIVITIES[0]); // 근처에 대상이 없으면 그냥 걷기
        return;
      }
      state.activity = a.type;
      state.activityTimer = 0;
      state.activityDuration = Infinity; // stepNibble/stepWatch/stepTyping이 끝나면 알아서 다음 행동을 고른다
      const payload = { el: target.el, rect: target.rect, phase: "approach" };
      if (a.type === "nibble") state.nibble = payload;
      else if (a.type === "watch") state.watch = payload;
      else state.typing = payload;
      setActivityClass("pet--walking");
      state.baseExpression = a.expr;
      setExpression(a.expr);
      return;
    }
    state.climb = null;
    state.nibble = null;
    state.watch = null;
    state.typing = null;
    state.activity = a.type;
    state.activityTimer = 0;
    state.activityDuration = a.min + Math.random() * (a.max - a.min);
    setActivityClass(a.cls);
    if (a.type === "walk") {
      const speed = 26 + Math.random() * 26;
      state.dx = (Math.random() < 0.5 ? -1 : 1) * speed;
    }
    // 몇몇 동작은 만화식 효과 텍스트를 곁들여 감정을 더 크게 보여준다
    if (a.type === "tilt") spawnFx("?");
    if (a.type === "bow") spawnFx("꾸벅");
    if (a.type === "sneeze") {
      setTimeout(() => {
        if (state.activity === "sneeze" && state.mode === "roam") spawnFx("에취!!", { impact: true });
      }, 450);
    }
    state.baseExpression = a.expr;
    setExpression(a.expr);
  }
  enterActivity(ACTIVITIES[0]);

  // ---- 짧은 대사(호버 반응) ----
  // 확장 전용 대사(사이트 유입 유도) + 데스크톱 앱 시절부터 쓰던 코딩 소재 대사.
  const BUBBLE_MESSAGES = [
    "뭐 만들지 같이 정해요!",
    "일단 뭘 만들지부터!",
    "막막할 땐 저를 눌러요",
    "프롬프트, 어렵지 않아요",
    "클릭하면 도와드려요 >_<",
    "오늘도 코딩 화이팅!",
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
  function react(message, expr) {
    if (state.mode !== "roam") return;
    setExpression(expr || "excited");
    bubbleEl.textContent = message;
    petEl.classList.add("pet--talking");
    clearTimeout(state.reactTimer);
    state.reactTimer = setTimeout(() => {
      petEl.classList.remove("pet--talking");
      setExpression(state.baseExpression);
    }, 1500);
  }

  petEl.addEventListener("pointerenter", () => {
    if (state.mode === "roam" && Math.random() < 0.85) {
      const pool = BUBBLE_MESSAGES.concat(
        bond.petName
          ? [`${bond.petName} 출동 준비 완료!`, `${bond.petName}(이)는 오늘도 열일 중`, `${bond.petName}라고 불러줘서 좋아!`]
          : []
      );
      react(pool[Math.floor(Math.random() * pool.length)], "love");
    }
  });

  // ---- 애착 시스템: 이름/애정도/출석 ----
  // 매일 처음 만나면 코인 보너스, 마우스로 문질러 쓰다듬으면 애정도가 쌓이고
  // 레벨업마다 코인을 준다. 이름을 지어주면 대사에 이름이 섞여 나온다.
  const bond = { petName: "", affection: 0 };
  const PETTING_LINES = [
    "헤헤, 간지러워!",
    "기분 최고야~",
    "더 쓰다듬어줘!",
    "충전 완료! 힘이 난다!",
    "이 맛에 데스크톱 사는 거지",
  ];

  async function onPetted() {
    for (let i = 0; i < 3; i++) {
      setTimeout(() => spawnFx("♥"), i * 130);
    }
    const prevLevel = gacha.affectionLevel(bond.affection);
    bond.affection += 1;
    const level = gacha.affectionLevel(bond.affection);
    const linePool = PETTING_LINES.concat(bond.petName ? [`${bond.petName}, 행복해!`] : []);
    setExpression("love");
    bubbleEl.textContent = linePool[Math.floor(Math.random() * linePool.length)];
    petEl.classList.add("pet--talking");
    clearTimeout(state.reactTimer);
    state.reactTimer = setTimeout(() => {
      petEl.classList.remove("pet--talking");
      setExpression(state.baseExpression);
    }, 1600);
    await chrome.storage.local.set({ affection: bond.affection });
    if (level > prevLevel) {
      spawnFx(`Lv.${level} 달성! +${gacha.LEVEL_REWARD} 🪙`, { impact: true });
      gacha.addCoins(gacha.LEVEL_REWARD);
    }
  }

  // 쓰다듬기 감지: 펫 위에서 마우스를 좌우로 문지르면(방향 전환 4회 이상 +
  // 일정 거리) 1회 쓰다듬은 것으로 친다. 드래그로 옮기는 중에는 무시.
  const rub = { dist: 0, flips: 0, lastX: null, lastSign: 0, lastMoveT: 0, cooldownUntil: 0 };
  petEl.addEventListener("pointermove", (e) => {
    if (drag || state.mode === "falling") return;
    const now = performance.now();
    if (now - rub.lastMoveT > 600) {
      rub.dist = 0;
      rub.flips = 0;
      rub.lastSign = 0;
      rub.lastX = e.clientX;
    }
    rub.lastMoveT = now;
    if (rub.lastX != null) {
      const dx = e.clientX - rub.lastX;
      rub.dist += Math.abs(dx);
      const sign = Math.sign(dx);
      if (sign !== 0 && rub.lastSign !== 0 && sign !== rub.lastSign) rub.flips++;
      if (sign !== 0) rub.lastSign = sign;
    }
    rub.lastX = e.clientX;
    if (now >= rub.cooldownUntil && rub.flips >= 4 && rub.dist >= 60) {
      rub.cooldownUntil = now + 2500;
      rub.dist = 0;
      rub.flips = 0;
      onPetted();
    }
  });

  (async () => {
    const b = await chrome.storage.local.get(["petName", "affection", "lastDailyBonus", "firstMet"]);
    bond.petName = typeof b.petName === "string" ? b.petName : "";
    bond.affection = typeof b.affection === "number" ? b.affection : 0;

    if (!b.firstMet) {
      await chrome.storage.local.set({ firstMet: Date.now() });
      setTimeout(() => {
        react(`처음 만나서 반가워! 잘 부탁해 >_<`, "love");
      }, 800);
    }

    const now = new Date();
    const todayKey = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
    if (b.lastDailyBonus !== todayKey) {
      await chrome.storage.local.set({ lastDailyBonus: todayKey });
      await gacha.addCoins(gacha.DAILY_BONUS);
      setTimeout(() => {
        spawnFx(`출석 보너스 +${gacha.DAILY_BONUS} 🪙`, { impact: true });
        react("오늘도 와줬네! 선물이야!", "love");
      }, b.firstMet ? 1200 : 3200);
    }
  })();

  // ---- 드래그 / 클릭 구분 ----
  let drag = null;
  petEl.addEventListener("pointerdown", (e) => {
    if (state.mode === "dialog" || state.mode === "falling") return;
    if (e.button !== 0) return;
    drag = {
      startX: e.clientX,
      startY: e.clientY,
      offX: e.clientX - state.x,
      offY: e.clientY - state.y,
      moved: false,
    };
    petEl.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  petEl.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dist = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY);
    if (!drag.moved && dist > DRAG_THRESHOLD) {
      drag.moved = true;
      state.mode = "dragging";
      cancelSideActivities();
      closeMenu();
      petEl.classList.add("pet--dragging");
      setActivityClass(null);
      clearTimeout(state.reactTimer);
      petEl.classList.remove("pet--talking");
      setExpression("surprised");
    }
    if (drag.moved) {
      state.x = clampX(e.clientX - drag.offX);
      state.y = Math.max(0, Math.min(e.clientY - drag.offY, window.innerHeight - H));
      place();
      // 카트 모드에서 끌고 다니는 동안엔 더 뜨거운 드리프트 궤적이 그려진다
      if (game.type === "kart") {
        const now = performance.now();
        if (!drag.lastTrail || now - drag.lastTrail > 28) {
          drag.lastTrail = now;
          drag.speed = Math.hypot(e.clientX - (drag.lastX ?? e.clientX), e.clientY - (drag.lastY ?? e.clientY));
          drag.lastX = e.clientX;
          drag.lastY = e.clientY;
          spawnKartTrail(true);
        }
      }
    }
  });

  function endDrag(e) {
    if (!drag) return;
    const wasMoved = drag.moved;
    const releaseSpeed = drag.speed || 0; // drag를 비우기 전에 챙겨둔다(카트 스핀 세기)
    try { petEl.releasePointerCapture(e.pointerId); } catch (_) {}
    drag = null;
    petEl.classList.remove("pet--dragging");

    if (!wasMoved) {
      // 히어로 변신 중엔 클릭이 곧 "연타 충전"이라 메뉴를 열지 않는다
      if (game.type === "hero") {
        heroTap();
        return;
      }
      // 순수 클릭 → 곧장 설문으로 끌고 가지 않고, 먼저 펫 메뉴로 "뭐 만들지
      // 물어볼지 / 그냥 인사만 할지"부터 고르게 한다(드래그였다면 여기로
      // 오지 않으므로 클릭-메뉴 오작동 방지).
      toggleMenu();
      return;
    }
    // 게임 중에는 떨어뜨려 놀라게 하지 않고 그대로 이어서 진행한다.
    // 카트라면 놓는 순간의 속도만큼 화려한 스핀이 터진다.
    if (gameActive()) {
      if (game.type === "kart") kartSpin(Math.min(1, releaseSpeed / 26));
      state.y = game.type === "kart" ? kartFloor() : floorTop();
      place();
      state.mode = "roam";
      return;
    }
    // 드래그로 놓음: 바닥보다 위면 낙하, 바닥이면 그대로 복귀
    if (state.y < floorTop() - 3) {
      startFall();
    } else {
      state.y = floorTop();
      place();
      state.mode = "roam";
      enterActivity(pickActivity());
    }
  }
  petEl.addEventListener("pointerup", endDrag);
  petEl.addEventListener("pointercancel", endDrag);

  function clampX(x) {
    return Math.max(0, Math.min(x, window.innerWidth - W));
  }

  // 코딩 외 카테고리는 완성 프롬프트를 사이트로 안 보내고 바로 클립보드에
  // 복사해준다. Clipboard API가 막힌 상황(포커스 등)을 대비해 execCommand
  // 폴백까지 시도한다.
  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        shadow.appendChild(ta);
        ta.focus();
        ta.select();
        const ok = document.execCommand("copy");
        ta.remove();
        return ok;
      } catch (_) {
        return false;
      }
    }
  }

  // ---- 만화식 효과 텍스트 ("!!", "쿵!!!" 등). 소리는 절대 재생하지 않는다 -
  // <audio>/Audio() 없이 순수 텍스트+CSS 애니메이션으로만 "효과음"을 표현한다.
  function spawnFx(text, { impact = false } = {}) {
    const box = petEl.getBoundingClientRect();
    const el = document.createElement("div");
    el.className = impact ? "pet__fx pet__fx--impact" : "pet__fx pet__fx--pop";
    el.textContent = text;
    const jitterX = (Math.random() - 0.5) * box.width * 0.8;
    el.style.left = `${box.left + box.width / 2 + jitterX}px`;
    el.style.top = `${impact ? box.top + box.height * 0.3 : box.top - 6}px`;
    layer.appendChild(el);
    el.addEventListener("animationend", () => el.remove());
    setTimeout(() => el.remove(), 900); // 안전망(애니메이션 스킵 등 대비)
  }

  const FALL_FX = ["!!", "?!", "@_@", "☆", "!?"];

  // ---- 낙하(꺄아악) ----
  function startFall() {
    state.mode = "falling";
    state.vy = 0;
    setActivityClass("pet--falling");
    setExpression("scared");
    bubbleEl.textContent = "꺄아아아아악!!";
    petEl.classList.add("pet--talking");
    spawnFx(FALL_FX[Math.floor(Math.random() * FALL_FX.length)]);
    clearInterval(state.fallFxTimer);
    state.fallFxTimer = setInterval(() => {
      spawnFx(FALL_FX[Math.floor(Math.random() * FALL_FX.length)]);
    }, 150);
  }
  function land() {
    clearInterval(state.fallFxTimer);
    state.fallFxTimer = null;
    state.y = floorTop();
    place();
    petEl.classList.remove("pet--talking");
    setActivityClass("pet--landing");
    setExpression("surprised");
    spawnFx("쿵!!!", { impact: true });
    state.mode = "roam";
    state.activity = "sit";
    state.activityTimer = 0;
    state.activityDuration = 0.5;
    setTimeout(() => {
      if (state.mode === "roam") enterActivity(pickActivity());
    }, 380);
  }

  // ---- 메인 루프 ----
  function loop(t) {
    if (state.lastFrame == null) state.lastFrame = t;
    const dt = Math.min(0.05, (t - state.lastFrame) / 1000);
    state.lastFrame = t;

    if (state.mode === "falling") {
      state.vy += GRAVITY * dt;
      state.y += state.vy * dt;
      if (state.y >= floorTop()) {
        land();
      } else {
        place();
      }
    } else if (state.mode === "roam" && !prefersReduced) {
      state.activityTimer += dt;
      if (state.activityTimer >= state.activityDuration) {
        enterActivity(pickActivity());
      }
      if (state.activity === "walk") {
        let nx = state.x + state.dx * dt;
        if (nx <= 0 || nx >= window.innerWidth - W) {
          state.dx *= -1;
          nx = clampX(nx);
        }
        if (Math.random() < 0.008) state.dx *= -1;
        state.x = nx;
        state.y = floorTop();
        place();
        // 기본 그림은 꼬리가 오른쪽(뒤)에 있는 "왼쪽을 향한" 자세라서, 오른쪽으로
        // 걸을 때만 좌우 반전해야 꼬리가 이동 방향 뒤쪽에 남아 앞으로 걷는 것처럼 보인다.
        petEl.classList.toggle("pet--flip", state.dx > 0);
      } else if (state.activity === "game") {
        // 게임이 어떤 이유로든 정리됐는데 activity만 남아있으면 평소 행동으로 복귀
        if (gameActive()) stepGame(dt);
        else enterActivity(pickActivity());
      } else if (state.activity === "climb") {
        stepClimb(dt);
      } else if (state.activity === "nibble") {
        stepNibble(dt);
      } else if (state.activity === "watch") {
        stepWatch(dt);
      } else if (state.activity === "type") {
        stepTyping(dt);
      } else if (state.activity === "look") {
        // 두리번: 0.6초마다 좌우 방향을 번갈아 본다 (CSS만으론 flip을 못 바꿔서 JS로)
        petEl.classList.toggle("pet--flip", Math.floor(state.activityTimer / 0.6) % 2 === 1);
      }
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // 창 크기 변경/스크롤 시 밟고 있던 요소의 좌표가 더 이상 안 맞을 수 있으니,
  // 복잡하게 다시 계산하지 않고 그냥 바닥으로 되돌린다.
  window.addEventListener("resize", () => {
    state.x = clampX(state.x);
    // 게임 요소들은 뷰포트 좌표로 배치돼 있어서 창 크기가 바뀌면 정리한다
    // (스크롤은 fixed 레이어라 영향이 없으므로 게임을 끊지 않는다)
    endGame({ quiet: true });
    cancelSideActivities();
    if (state.mode !== "falling" && state.mode !== "dragging") state.y = floorTop();
    place();
    if (dialogEl && dialogEl.classList.contains("dialog--open")) positionDialog();
    if (menuOpen) positionMenu();
  });
  // 스크롤 자체를 "어어!" 하고 휘청하는 반응으로 살려둔다 — 밟고 있던 요소가
  // 있었다면 좌표가 무효화되니 정리하되, 밋밋하게 뚝 떨어뜨리지 않는다.
  window.addEventListener(
    "scroll",
    () => {
      const dy = window.scrollY - state.lastScrollY;
      state.lastScrollY = window.scrollY;
      if (state.mode === "roam" && Math.abs(dy) > 4) {
        petEl.classList.remove("pet--scroll-wobble-up", "pet--scroll-wobble-down");
        void petEl.offsetWidth; // 리플로우: 같은 클래스를 다시 넣어도 애니메이션이 재생되게
        petEl.classList.add(dy > 0 ? "pet--scroll-wobble-down" : "pet--scroll-wobble-up");
      }
      const wasOnSomething = state.climb || state.nibble || state.watch || state.typing;
      if (!wasOnSomething) return;
      cancelSideActivities();
      place();
      enterActivity(pickActivity());
    },
    { passive: true, capture: true }
  );

  // ---- 펫 메뉴: 클릭하면 바로 설문(위저드)로 끌려가는 대신, 먼저 "뭐 만들지
  // 물어볼지 / 그냥 인사만 할지"부터 고르게 하는 가벼운 팝오버. 다이얼로그와
  // 달리 펫을 앉히거나 애니메이션을 멈추지 않고 roam 상태를 유지한 채 떠
  // 있다가, 아무 것도 안 고르면 몇 초 뒤 스스로 사라진다 — 프롬프트 설문이
  // 클릭의 "디폴트 결과"가 아니라 펫이 가끔 제안하는 선택지처럼 느껴지게 한다.
  let menuEl = null;
  let menuAutoCloseTimer = null;
  let menuOpen = false; // 여는 클래스는 다음 프레임에 붙으므로, 의도는 이 플래그로 따로 들고 있는다
  const MENU_GREETINGS = [
    "안녕! 오늘도 반가워 >_<",
    "그냥 놀러 왔구나, 좋아!",
    "심심할 때 또 눌러줘!",
    "네가 옆에 있으니 든든해",
  ];

  function renderMenuRoot() {
    menuEl.innerHTML = `
      <button type="button" class="pet-menu__btn pet-menu__btn--primary" data-action="wizard">💬 뭐 만들지 물어보기</button>
      <button type="button" class="pet-menu__btn pet-menu__btn--play" data-action="play">🎮 같이 놀기</button>
      <button type="button" class="pet-menu__btn" data-action="greet">👋 인사만 할래</button>`;
  }

  // 미니게임은 랜덤으로도 뜨지만, 하고 싶을 때 바로 고를 수 있어야 해서
  // 메뉴 안에 게임 목록을 따로 둔다.
  function renderMenuPlay() {
    const items = GAMES.map(
      (g) =>
        `<button type="button" class="pet-menu__btn pet-menu__btn--game" data-game="${g.id}">${g.label}<small>${g.desc}</small></button>`
    ).join("");
    menuEl.innerHTML = `<div class="pet-menu__title">뭐 하고 놀까?</div>${items}<button type="button" class="pet-menu__btn pet-menu__btn--back" data-action="back">← 뒤로</button>`;
  }

  function buildMenu() {
    menuEl = document.createElement("div");
    menuEl.className = "pet-menu";
    renderMenuRoot();
    menuEl.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      if (btn.dataset.game) {
        startGame(btn.dataset.game); // startGame이 메뉴를 닫는다
        return;
      }
      const action = btn.dataset.action;
      if (action === "play") {
        renderMenuPlay();
        positionMenu();
        bumpMenuAutoClose();
        return;
      }
      if (action === "back") {
        renderMenuRoot();
        positionMenu();
        bumpMenuAutoClose();
        return;
      }
      closeMenu();
      if (action === "wizard") {
        openDialog();
      } else {
        react(MENU_GREETINGS[Math.floor(Math.random() * MENU_GREETINGS.length)], "love");
      }
    });
    layer.appendChild(menuEl);
  }

  function positionMenu() {
    if (!menuEl) return;
    const MW = Math.min(230, window.innerWidth - 24);
    const centerX = state.x + W / 2;
    const left = Math.max(8, Math.min(centerX - MW / 2, window.innerWidth - MW - 8));
    menuEl.style.left = `${left}px`;
    menuEl.style.width = `${MW}px`;
    menuEl.style.bottom = `${window.innerHeight - state.y + 10}px`;
  }

  function bumpMenuAutoClose() {
    clearTimeout(menuAutoCloseTimer);
    menuAutoCloseTimer = setTimeout(closeMenu, 6000);
  }

  function openMenu() {
    if (!menuEl) buildMenu();
    else renderMenuRoot(); // 지난번에 게임 목록에서 닫혔더라도 항상 첫 화면부터
    positionMenu();
    menuOpen = true;
    // 같은 틱에 열고 바로 닫는 경우(예: 메뉴에서 곧장 게임 시작) 다음 프레임의
    // 이 콜백이 닫힌 메뉴를 되살리지 않도록 의도를 다시 확인한다.
    requestAnimationFrame(() => {
      if (menuOpen) menuEl.classList.add("pet-menu--open");
    });
    bumpMenuAutoClose();
  }

  function closeMenu() {
    menuOpen = false;
    clearTimeout(menuAutoCloseTimer);
    if (menuEl) menuEl.classList.remove("pet-menu--open");
  }

  function toggleMenu() {
    if (menuOpen) closeMenu();
    else openMenu();
  }

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && menuOpen) closeMenu();
  });

  // ---- 대화창(위저드) ----
  let dialogEl = null;
  let wiz = null;

  function openDialog() {
    closeMenu();
    state.mode = "dialog";
    endGame({ quiet: true });
    cancelSideActivities();
    place();
    setActivityClass("pet--sitting");
    state.baseExpression = "happy";
    setExpression("excited");
    petEl.classList.remove("pet--talking");
    if (!dialogEl) buildDialog();
    wiz.reset();
    positionDialog();
    requestAnimationFrame(() => dialogEl.classList.add("dialog--open"));
  }

  function closeDialog() {
    if (dialogEl) dialogEl.classList.remove("dialog--open");
    state.mode = "roam";
    enterActivity(pickActivity());
  }

  function positionDialog() {
    const DW = Math.min(320, window.innerWidth - 24);
    const centerX = state.x + W / 2;
    const left = Math.max(8, Math.min(centerX - DW / 2, window.innerWidth - DW - 8));
    dialogEl.style.left = `${left}px`;
    dialogEl.style.bottom = `${window.innerHeight - state.y + 10}px`;
  }

  function buildDialog() {
    dialogEl = document.createElement("div");
    dialogEl.className = "dialog";
    dialogEl.innerHTML = `
      <div class="dialog__head">
        <div class="dialog__title">무엇을 도와드릴까요?<small>질문에 답하면 무엇을 요청할지 알려드려요</small></div>
        <button class="dialog__close" title="닫기">✕</button>
      </div>
      <div class="dialog__progress"><div class="dialog__progress-bar"></div></div>
      <div class="dialog__body"></div>
      <div class="dialog__foot">
        <button class="btn-back" hidden>← 이전</button>
        <button class="btn-next">다음</button>
      </div>`;
    layer.appendChild(dialogEl);

    const bodyBox = dialogEl.querySelector(".dialog__body");
    const bar = dialogEl.querySelector(".dialog__progress-bar");
    const backBtn = dialogEl.querySelector(".btn-back");
    const nextBtn = dialogEl.querySelector(".btn-next");
    dialogEl.querySelector(".dialog__close").addEventListener("click", closeDialog);

    wiz = makeWizard({ bodyBox, bar, backBtn, nextBtn });

    // Esc로 닫기
    dialogEl.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeDialog();
    });
  }

  // 위저드 로직: nocalhostmore questions.js 를 그대로 사용
  function makeWizard({ bodyBox, bar, backBtn, nextBtn }) {
    let category = null; // "coding" | "writing" | "debug" | "summarize" | "image" | null(선택 전)
    let engine = null; // { QUESTIONS, START_ID, getQuestion, resolveNext } — coding이면 questions 모듈 자체
    let answers = {};
    let history = [];
    let currentId = null;
    let finished = false;

    function reset() {
      category = null;
      engine = null;
      answers = {};
      history = [];
      currentId = null;
      finished = false;
      render();
    }

    function selectCategory(cat) {
      category = cat.id;
      engine = cat.id === "coding" ? questions : categories.getLocalCategory(cat.id);
      answers = {};
      history = [];
      currentId = engine.START_ID;
      finished = false;
      render();
    }

    function updateProgress() {
      if (!engine) {
        bar.style.width = "0%";
        backBtn.hidden = true;
        return;
      }
      const pct = finished
        ? 100
        : Math.max(6, Math.min(95, (history.length / engine.QUESTIONS.length) * 100));
      bar.style.width = `${pct}%`;
      backBtn.hidden = false; // 카테고리 선택 화면으로라도 항상 돌아갈 수 있게
    }

    function goTo(id) {
      history.push(currentId);
      currentId = id;
      render();
    }
    function back() {
      if (finished) {
        finished = false;
        render();
        return;
      }
      if (history.length === 0) {
        reset(); // 첫 질문에서 뒤로가면 카테고리 선택으로
        return;
      }
      currentId = history.pop();
      render();
    }
    backBtn.onclick = back;

    function advanceFrom(q, value) {
      answers[q.id] = value;
      const nextId = engine.resolveNext(q, value, answers);
      if (nextId) {
        goTo(nextId);
      } else {
        finished = true;
        render();
      }
    }

    function renderCategoryPicker() {
      const title = document.createElement("h2");
      title.className = "q-title";
      title.textContent = "오늘은 뭘 도와드릴까요?";
      bodyBox.appendChild(title);
      const hint = document.createElement("p");
      hint.className = "q-hint";
      hint.textContent = "하나를 고르면 딱 맞는 질문으로 안내해드려요.";
      bodyBox.appendChild(hint);

      const wrap = document.createElement("div");
      wrap.className = "q-options";
      for (const cat of categories.CATEGORIES) {
        const b = document.createElement("button");
        b.className = "q-option";
        const label = document.createElement("div");
        label.className = "q-option__label";
        const span = document.createElement("span");
        span.textContent = `${cat.icon} ${cat.label}`;
        label.appendChild(span);
        b.appendChild(label);
        const d = document.createElement("div");
        d.className = "q-option__desc";
        d.textContent = cat.desc;
        b.appendChild(d);
        b.addEventListener("click", () => selectCategory(cat));
        wrap.appendChild(b);
      }
      bodyBox.appendChild(wrap);
      nextBtn.style.display = "none";
      backBtn.hidden = true;
      bar.style.width = "0%";
    }

    function render() {
      bodyBox.innerHTML = "";
      bodyBox.scrollTop = 0;

      if (!category) {
        renderCategoryPicker();
        return;
      }

      if (finished) {
        renderGuide();
        nextBtn.style.display = "none";
        updateProgress();
        return;
      }
      nextBtn.style.display = "";

      const q = engine.getQuestion(currentId);
      if (!q) return;

      const title = document.createElement("h2");
      title.className = "q-title";
      title.textContent = q.title;
      bodyBox.appendChild(title);
      if (q.hint) {
        const hint = document.createElement("p");
        hint.className = "q-hint";
        hint.textContent = q.hint;
        bodyBox.appendChild(hint);
      }

      if (q.type === "text") {
        const ta = document.createElement("textarea");
        ta.className = "q-textarea";
        if (q.placeholder) ta.placeholder = q.placeholder;
        ta.value = answers[q.id] || "";
        bodyBox.appendChild(ta);
        nextBtn.textContent = "다음";
        nextBtn.disabled = q.required ? ta.value.trim() === "" : false;
        ta.addEventListener("input", () => {
          nextBtn.disabled = q.required ? ta.value.trim() === "" : false;
        });
        nextBtn.onclick = () => {
          const v = ta.value.trim();
          if (q.required && !v) return;
          advanceFrom(q, v);
        };
        setTimeout(() => ta.focus(), 30);
      } else {
        // single: 옵션 클릭 즉시 다음으로
        nextBtn.style.display = "none";
        const wrap = document.createElement("div");
        wrap.className = "q-options";
        for (const opt of q.options) {
          const b = document.createElement("button");
          b.className = "q-option";
          const label = document.createElement("div");
          label.className = "q-option__label";
          const span = document.createElement("span");
          span.textContent = opt.label;
          label.appendChild(span);
          if (opt.tag) {
            const tag = document.createElement("span");
            tag.className = "q-option__tag";
            tag.textContent = opt.tag;
            label.appendChild(tag);
          }
          b.appendChild(label);
          if (opt.desc) {
            const d = document.createElement("div");
            d.className = "q-option__desc";
            d.textContent = opt.desc;
            b.appendChild(d);
          }
          b.addEventListener("click", () => advanceFrom(q, opt.value));
          wrap.appendChild(b);
        }
        bodyBox.appendChild(wrap);
      }
      updateProgress();
    }

    function renderGuideList(g) {
      const lead = document.createElement("p");
      lead.className = "guide__lead";
      lead.textContent = "AI에게 이런 걸 요청하면 돼요! 👇";
      bodyBox.appendChild(lead);

      if (g.idea) {
        const idea = document.createElement("div");
        idea.className = "guide__idea";
        idea.textContent = `💡 ${g.idea}`;
        bodyBox.appendChild(idea);
      }

      const ul = document.createElement("ul");
      ul.className = "guide__list";
      for (const item of g.items) {
        const li = document.createElement("li");
        li.className = "guide__item";
        const t = document.createElement("div");
        t.className = "guide__item-title";
        t.textContent = item.title;
        if (item.term) {
          const term = document.createElement("span");
          term.className = "guide__item-term";
          term.textContent = item.term;
          t.appendChild(term);
        }
        const d = document.createElement("div");
        d.className = "guide__item-detail";
        d.textContent = item.detail;
        li.append(t, d);
        ul.appendChild(li);
      }
      bodyBox.appendChild(ul);
    }

    function appendRestartButton() {
      const restart = document.createElement("button");
      restart.className = "guide__restart";
      restart.textContent = "처음부터 다시";
      restart.addEventListener("click", reset);
      bodyBox.appendChild(restart);
    }

    // 사이트로 넘기기 전에, 그 자리에서도 바로 쓸 수 있는 짧은 초안을 준다.
    // guideBuilder.js가 만드는 항목(term/detail)만 조합하는 순수 텍스트 가공이라
    // questions.js/guideBuilder.js/share.js — 즉 nocalhostmore 유입 퍼널 자체의
    // 로직·데이터는 전혀 건드리지 않는다.
    function buildQuickDraft(g) {
      const lines = [g.idea || "", "", "아래 조건을 지켜서 만들어줘:"];
      for (const item of g.items) lines.push(`- ${item.title}: ${item.detail}`);
      return lines.join("\n");
    }

    // 코딩 카테고리의 사이트 이동 로직은 절대 손대지 않는다: nocalhostmore가
    // 답변을 받아 완성 프롬프트(+광고)를 보여주는 유입 퍼널이라, [더 정교하게
    // 다듬기] 버튼이 답변을 그대로 담아 사이트로 넘기는 동작·보상은 기존과 동일하다.
    // 추가된 건 그 위에 놓인 "지금 바로 쓸 수 있는 간단 초안" 뿐이다.
    function renderCodingGuide() {
      const g = guide.buildGuide(answers);
      renderGuideList(g);

      const draft = buildQuickDraft(g);
      const box = document.createElement("pre");
      box.className = "guide__prompt";
      box.textContent = draft;
      bodyBox.appendChild(box);

      const copyBtn = document.createElement("button");
      copyBtn.className = "guide__copy";
      copyBtn.textContent = "간단 버전 복사하기";
      copyBtn.addEventListener("click", async () => {
        const ok = await copyToClipboard(draft);
        copyBtn.textContent = ok ? "복사 완료! ✓" : "복사 실패 😥";
        copyBtn.classList.toggle("is-copied", ok);
        setTimeout(() => {
          copyBtn.textContent = "간단 버전 복사하기";
          copyBtn.classList.remove("is-copied");
        }, 1600);
      });
      bodyBox.appendChild(copyBtn);

      const cta = document.createElement("button");
      cta.className = "guide__cta";
      cta.innerHTML = "더 정교하게 다듬기 →<small>답변을 그대로 담아 사이트에서 완성 프롬프트를 만들어요</small>";
      cta.addEventListener("click", () => {
        const frag = share.encodeAnswers(answers); // "s=..."
        window.open(`${APP_URL}#${frag}`, "_blank", "noopener");
        gacha.addCoins(gacha.EARN_PER_PROMPT);
        spawnFx(`+${gacha.EARN_PER_PROMPT} 코인 🪙`);
      });
      bodyBox.appendChild(cta);
      appendRestartButton();
    }

    // 코딩 외 카테고리(글쓰기/디버깅/요약/이미지): nocalhostmore가 이해 못 하는
    // 답변 모양이라 사이트로 안 보내고, 그 자리에서 완성 프롬프트를 만들어
    // 복사하게 한다.
    function renderLocalGuide() {
      renderGuideList(engine.buildGuide(answers));

      const promptText = engine.buildPrompt(answers);
      const box = document.createElement("pre");
      box.className = "guide__prompt";
      box.textContent = promptText;
      bodyBox.appendChild(box);

      const cta = document.createElement("button");
      cta.className = "guide__cta";
      cta.innerHTML = "프롬프트 복사하기 →<small>복사해서 ChatGPT · Claude 등에 붙여넣으세요</small>";
      cta.addEventListener("click", async () => {
        const ok = await copyToClipboard(promptText);
        if (ok) {
          cta.classList.add("is-copied");
          cta.innerHTML = "복사 완료! ✓<small>이제 붙여넣기(Ctrl/Cmd+V) 하시면 돼요</small>";
          gacha.addCoins(gacha.EARN_PER_PROMPT);
          spawnFx(`+${gacha.EARN_PER_PROMPT} 코인 🪙`);
        } else {
          cta.innerHTML = "복사 실패 😥<small>프롬프트 상자를 직접 선택해 복사해주세요</small>";
        }
      });
      bodyBox.appendChild(cta);
      appendRestartButton();
    }

    function renderGuide() {
      if (category === "coding") renderCodingGuide();
      else renderLocalGuide();
    }

    render();
    return { reset };
  }

  // 팝업에서 이 사이트의 권한을 회수하면 background.js가 이 메시지를 보낸다
  // (권한이 사라진 뒤라 스토리지 감시만으로는 스스로 알 방법이 없다).
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === "nch-permission-revoked") host.remove();
  });

  // 팝업(켜기/끄기 등)에서 상태 변경 시 반영
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.enabled && changes.enabled.newValue === false) {
      host.remove();
    }
    // 팝업에서 가챠로 새 아이템을 장착/해제하면 새로고침 없이 바로 반영
    if (changes.equipped) {
      applyEquipped(changes.equipped.newValue);
    }
    // 팝업에서 이름을 바꾸면 대사에 바로 반영
    if (changes.petName) {
      bond.petName = changes.petName.newValue || "";
    }
  });
})();

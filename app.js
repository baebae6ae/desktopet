"use strict";

/**
 * app.js — 데스크토펫 독립 웹앱 버전.
 * chrome-extension/ 폴더의 vendor 로직(sprites/questions/share/guideBuilder/gacha)과
 * pet.css / popup.css를 그대로 재사용한다(중복 구현 X). web-shim.js가 먼저 로드되어
 * chrome.storage.local을 localStorage로 흉내내주므로, 저장 관련 코드는 확장판과 동일하게 짠다.
 * 확장판과 다른 점은 "사이트별 켜기/끄기"가 없다는 것뿐 — 이 페이지 자체가 펫의 집이라
 * 항상 보여준다.
 */
(async () => {
  const SITE = "https://nocalhostmore.vercel.app";
  const APP_URL = SITE + "/app.html";
  const BASE = "./chrome-extension/";

  let sprites, questions, share, guide, gacha, categories, petCss;
  try {
    [sprites, questions, share, guide, gacha, categories, petCss] = await Promise.all([
      import(BASE + "vendor/sprites.js"),
      import(BASE + "vendor/questions.js"),
      import(BASE + "vendor/share.js"),
      import(BASE + "vendor/guideBuilder.js"),
      import(BASE + "vendor/gacha.js"),
      import(BASE + "vendor/categories.js"),
      fetch(BASE + "content/pet.css").then((r) => r.text()),
    ]);
  } catch (err) {
    console.warn("[데스크토펫] 리소스 로드 실패:", err);
    return;
  }

  const store = await chrome.storage.local.get(["species"]);
  const speciesDef = sprites.SPECIES_MAP[store.species] || sprites.SPECIES[0];

  const PET_SCALE = 0.85;
  const FLOOR_MARGIN = 4;
  const DRAG_THRESHOLD = 5;
  const GRAVITY = 2600;
  const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---- Shadow DOM 호스트 (pet.css를 그대로 주입해서 페이지 스타일과 안 섞이게) ----
  const stageEl = document.getElementById("stage");
  const host = document.createElement("div");
  host.id = "dtp-pet-host";
  const shadow = host.attachShadow({ mode: "open" });
  const styleEl = document.createElement("style");
  styleEl.textContent = petCss;
  shadow.appendChild(styleEl);
  const layer = document.createElement("div");
  layer.className = "layer";
  shadow.appendChild(layer);
  stageEl.appendChild(host);

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

  const limbEls = {};
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
    mode: "roam",
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
    { type: "wiggle", cls: "pet--wiggling", weight: 1.2, min: 1.2, max: 2.2, expr: "excited" },
    { type: "tilt", cls: "pet--tilting", weight: 1.1, min: 1.6, max: 1.6, expr: "surprised" },
    { type: "sneeze", cls: "pet--sneezing", weight: 0.8, min: 0.9, max: 0.9, expr: "surprised" },
    { type: "hop", cls: "pet--hopping", weight: 1.2, min: 1.3, max: 2.3, expr: "excited" },
    { type: "bow", cls: "pet--bowing", weight: 0.9, min: 1.4, max: 1.4, expr: "love" },
    { type: "look", cls: "pet--looking", weight: 1.2, min: 2, max: 3, expr: "happy" },
  ];
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

  // ---- 애착 시스템: 이름/애정도/출석 (확장판 pet.js와 동일 로직) ----
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
    }
  });

  function endDrag(e) {
    if (!drag) return;
    const wasMoved = drag.moved;
    try { petEl.releasePointerCapture(e.pointerId); } catch (_) {}
    drag = null;
    petEl.classList.remove("pet--dragging");

    if (!wasMoved) {
      openDialog();
      return;
    }
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
    setTimeout(() => el.remove(), 900);
  }

  const FALL_FX = ["!!", "?!", "@_@", "☆", "!?"];

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
        petEl.classList.toggle("pet--flip", state.dx > 0);
      } else if (state.activity === "look") {
        // 두리번: 0.6초마다 좌우 방향을 번갈아 본다 (CSS만으론 flip을 못 바꿔서 JS로)
        petEl.classList.toggle("pet--flip", Math.floor(state.activityTimer / 0.6) % 2 === 1);
      }
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  window.addEventListener("resize", () => {
    state.x = clampX(state.x);
    if (state.mode !== "falling" && state.mode !== "dragging") state.y = floorTop();
    place();
    if (dialogEl && dialogEl.classList.contains("dialog--open")) positionDialog();
  });

  // ---- 대화창(위저드) ----
  let dialogEl = null;
  let wiz = null;

  function openDialog() {
    state.mode = "dialog";
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

    dialogEl.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeDialog();
    });
  }

  function makeWizard({ bodyBox, bar, backBtn, nextBtn }) {
    let category = null;
    let engine = null;
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
      backBtn.hidden = false;
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
        reset();
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

    function renderCodingGuide() {
      renderGuideList(guide.buildGuide(answers));

      const cta = document.createElement("button");
      cta.className = "guide__cta";
      cta.innerHTML = "프롬프트 생성하기 →<small>답변을 그대로 담아 사이트에서 완성 프롬프트를 만들어요</small>";
      cta.addEventListener("click", () => {
        const frag = share.encodeAnswers(answers);
        window.open(`${APP_URL}#${frag}`, "_blank", "noopener");
        gacha.addCoins(gacha.EARN_PER_PROMPT);
        spawnFx(`+${gacha.EARN_PER_PROMPT} 코인 🪙`);
      });
      bodyBox.appendChild(cta);
      appendRestartButton();
    }

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

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.equipped) applyEquipped(changes.equipped.newValue);
  });

  // =========================================================
  // 설정/가챠 패널 (확장의 popup.js와 동일한 로직 — 별도 팝업 창이 아니라
  // 이 페이지의 슬라이드 패널 안에서 그대로 동작한다)
  // =========================================================
  const panelToggle = document.getElementById("panel-toggle");
  const panelEl = document.getElementById("panel");
  panelToggle.addEventListener("click", () => {
    const willShow = panelEl.hidden;
    panelEl.hidden = !willShow;
    panelToggle.setAttribute("aria-expanded", String(willShow));
  });

  const speciesEl = document.getElementById("species");
  const hintEl = document.getElementById("hint");
  speciesEl.value = speciesDef.id;
  speciesEl.addEventListener("change", () => {
    chrome.storage.local.set({ species: speciesEl.value });
    hintEl.textContent = "캐릭터 변경은 새로고침 후 적용돼요.";
  });

  const petNameEl = document.getElementById("pet-name");
  const affectionEl = document.getElementById("affection");
  function renderAffection(points) {
    const p = typeof points === "number" ? points : 0;
    affectionEl.textContent = `♥ ${p} · Lv.${gacha.affectionLevel(p)}`;
  }
  chrome.storage.local.get(["petName", "affection"]).then(({ petName, affection }) => {
    petNameEl.value = typeof petName === "string" ? petName : "";
    renderAffection(affection);
  });
  petNameEl.addEventListener("change", () => {
    const name = petNameEl.value.trim().slice(0, 12);
    petNameEl.value = name;
    chrome.storage.local.set({ petName: name });
    bond.petName = name;
    hintEl.textContent = name ? `이제 "${name}"(이)라고 불러요!` : "";
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.affection) renderAffection(changes.affection.newValue);
  });

  const tabButtons = document.querySelectorAll(".tab");
  const views = { settings: document.getElementById("view-settings"), gacha: document.getElementById("view-gacha") };
  for (const btn of tabButtons) {
    btn.addEventListener("click", () => {
      const key = btn.dataset.tab;
      for (const b of tabButtons) b.setAttribute("aria-selected", String(b === btn));
      for (const [k, el] of Object.entries(views)) el.hidden = k !== key;
    });
  }

  const coinBalanceEl = document.getElementById("coin-balance");
  const tabCoinsEl = document.getElementById("tab-coins");
  const pullBtn = document.getElementById("pull-btn");
  const gachaHintEl = document.getElementById("gacha-hint");
  const gachaViewEl = document.getElementById("view-gacha");
  const pullstageEl = document.getElementById("pullstage");
  const particlesEl = document.getElementById("particles");
  const pullIconEl = document.getElementById("pull-icon");
  const pullNameEl = document.getElementById("pull-name");
  const pullRarityEl = document.getElementById("pull-rarity");
  const slotsEl = document.getElementById("slots");

  function setCoinDisplay(coins) {
    coinBalanceEl.textContent = coins;
    tabCoinsEl.textContent = `🪙 ${coins}`;
    pullBtn.disabled = coins < gacha.PULL_COST;
  }

  function renderSlots(equipped) {
    slotsEl.innerHTML = "";
    for (const slot of gacha.SLOTS) {
      const itemId = equipped[slot];
      const item = itemId ? gacha.getItem(itemId) : null;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "slot";
      btn.innerHTML = `
        <div class="slot__icon ${item ? "" : "slot__icon--empty"}">${item ? item.icon : "＋"}</div>
        <div class="slot__label">${gacha.SLOT_LABELS[slot]}</div>`;
      btn.addEventListener("click", () => openPicker(slot));
      slotsEl.appendChild(btn);
    }
  }

  async function refreshGachaView() {
    const s = await gacha.getGachaState();
    setCoinDisplay(s.coins);
    renderSlots(s.equipped);
    return s;
  }
  refreshGachaView();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.coins || changes.inventory || changes.equipped) refreshGachaView();
  });

  function openPicker(slot) {
    gacha.getGachaState().then((s) => {
      const overlay = document.createElement("div");
      overlay.className = "picker";
      const items = gacha.itemsBySlot(slot);
      overlay.innerHTML = `
        <div class="picker__panel">
          <div class="picker__head">
            <h3>${gacha.SLOT_LABELS[slot]} 장착</h3>
            <button class="picker__close" type="button">✕</button>
          </div>
          <div class="picker__grid"></div>
          <button class="picker__unequip" type="button">해제하기</button>
        </div>`;
      document.body.appendChild(overlay);

      const grid = overlay.querySelector(".picker__grid");
      for (const item of items) {
        const owned = s.inventory[item.id] || 0;
        const locked = owned === 0;
        const equippedHere = s.equipped[slot] === item.id;
        const cell = document.createElement("button");
        cell.type = "button";
        cell.className = `picker__item ${locked ? "is-locked" : ""} ${equippedHere ? "is-equipped" : ""}`;
        cell.style.setProperty("--r-color", gacha.RARITY[item.rarity].color);
        cell.innerHTML = `
          <span class="icon">${locked ? "❔" : item.icon}</span>
          <span class="name">${locked ? "???" : item.name}</span>
          ${owned > 1 ? `<span class="count">x${owned}</span>` : ""}`;
        if (!locked) {
          cell.addEventListener("click", async () => {
            await gacha.setEquipped(slot, item.id);
            overlay.remove();
          });
        }
        grid.appendChild(cell);
      }

      overlay.querySelector(".picker__unequip").addEventListener("click", async () => {
        await gacha.setEquipped(slot, null);
        overlay.remove();
      });
      overlay.querySelector(".picker__close").addEventListener("click", () => overlay.remove());
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) overlay.remove();
      });
    });
  }

  const SPARK_GLYPHS = ["✦", "★", "✧", "✹", "•"];
  function buildParticles(color) {
    particlesEl.innerHTML = "";
    const count = 14;
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.4;
      const dist = 55 + Math.random() * 35;
      const span = document.createElement("span");
      span.className = "spark";
      span.textContent = SPARK_GLYPHS[Math.floor(Math.random() * SPARK_GLYPHS.length)];
      span.style.setProperty("--tx", `${Math.cos(angle) * dist}px`);
      span.style.setProperty("--ty", `${Math.sin(angle) * dist}px`);
      span.style.setProperty("--d", `${Math.random() * 0.15}s`);
      span.style.setProperty("--r-color", color);
      particlesEl.appendChild(span);
    }
  }

  function playPullFx(item, isNew) {
    return new Promise((resolve) => {
      const rarity = gacha.RARITY[item.rarity];
      pullstageEl.style.setProperty("--r-color", rarity.color);
      pullstageEl.classList.remove("is-live");
      pullIconEl.textContent = item.icon;
      pullNameEl.textContent = `${item.name}${isNew ? " (NEW!)" : ""}`;
      pullRarityEl.textContent = rarity.label;
      buildParticles(rarity.color);
      pullstageEl.hidden = false;

      void pullstageEl.offsetWidth;
      pullstageEl.classList.add("is-live");

      if (item.rarity === "rare" || item.rarity === "epic") {
        gachaViewEl.classList.remove("is-shaking");
        void gachaViewEl.offsetWidth;
        gachaViewEl.classList.add("is-shaking");
      }
      setTimeout(resolve, 1000);
    });
  }

  pullBtn.addEventListener("click", async () => {
    pullBtn.disabled = true;
    pullBtn.classList.add("is-spinning");
    gachaHintEl.textContent = "";
    pullstageEl.hidden = true;

    const result = await gacha.pullGacha();
    if (!result.ok) {
      pullBtn.classList.remove("is-spinning");
      gachaHintEl.textContent = "코인이 부족해요! 프롬프트를 생성하면 코인을 받아요.";
      setCoinDisplay(result.coins);
      return;
    }
    setCoinDisplay(result.coins);

    await new Promise((r) => setTimeout(r, 420));
    pullBtn.classList.remove("is-spinning");
    await playPullFx(result.item, result.isNew);
  });
})();

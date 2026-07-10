"use strict";

/**
 * pet.js — Chrome 확장 콘텐츠 스크립트.
 * 모든 웹페이지 위(최상위 프레임)에 8비트 펫을 띄운다. 펫은 화면 아래쪽을
 * 좌우로 돌아다니고, 드래그로 옮길 수 있으며, 높은 곳에서 놓으면 "꺄아악"
 * 하고 떨어진다. 클릭하면 그 자리에 멈춰 말풍선 대화창(질문 위저드)을 열고,
 * 답을 다 하면 "무엇을 요청해야 하는지" 가이드를 보여준 뒤, [프롬프트 생성하기]
 * 버튼으로 답변을 담아 nocalhostmore 사이트로 보낸다(광고 퍼널의 목적지).
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
  let sprites, questions, share, guide, gacha, css;
  try {
    [sprites, questions, share, guide, gacha, css] = await Promise.all([
      import(url("vendor/sprites.js")),
      import(url("vendor/questions.js")),
      import(url("vendor/share.js")),
      import(url("vendor/guideBuilder.js")),
      import(url("vendor/gacha.js")),
      fetch(url("content/pet.css")).then((r) => r.text()),
    ]);
  } catch (err) {
    console.warn("[데스크토펫] 리소스 로드 실패:", err);
    return;
  }

  // ---- 설정(켜짐 여부/허용 사이트/종족) ----
  const store = await chrome.storage.local.get(["enabled", "species", "allowedSites"]);
  if (store.enabled === false) return;

  // 매번 모든 사이트에 뜨면 부담스럽다는 피드백을 반영해, 팝업에서 직접 고른
  // 사이트에서만 나타난다. 목록이 비어있으면(기본값) 아무 데도 뜨지 않는다.
  const isSiteAllowed = (list) => Array.isArray(list) && list.includes(location.hostname);
  if (!isSiteAllowed(store.allowedSites)) {
    // 이 페이지가 열려있는 동안 팝업에서 "이 사이트에서 보이기"를 켜면
    // 새로고침 없이 바로 나타나도록 허용목록 변경을 기다린다.
    await new Promise((resolve) => {
      function onAllowedSitesChange(changes, area) {
        if (area !== "local" || !changes.allowedSites) return;
        if (isSiteAllowed(changes.allowedSites.newValue)) {
          chrome.storage.onChanged.removeListener(onAllowedSitesChange);
          resolve();
        }
      }
      chrome.storage.onChanged.addListener(onAllowedSitesChange);
    });
  }

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

  // ---- 가챠로 뽑은 팔/다리 장착템 표시 ----
  // 해당 limb div의 자식으로 붙여서 걷기/점프 등 회전·위치를 그대로 물려받고,
  // 이모티콘 스티커 대신 실루엣과 같은 톤의 테두리를 두른 색 밴드로 그려서
  // "얹은" 게 아니라 팔다리에 두른 것처럼 보이게 한다.
  const GEAR_LIMB_KEYS = { arm: ["armLeft", "armRight"], legs: ["legLeft", "legRight"] };
  function renderLimbGear(equipped) {
    for (const el of Object.values(limbEls)) {
      const band = el.querySelector(".pet__gear-band");
      if (band) band.remove();
    }
    if (!equipped) return;
    for (const [slot, keys] of Object.entries(GEAR_LIMB_KEYS)) {
      const itemId = equipped[slot];
      const item = itemId && gacha.getItem(itemId);
      if (!item) continue;
      for (const key of keys) {
        const limb = limbEls[key];
        if (!limb) continue;
        const band = document.createElement("span");
        band.className = "pet__gear-band";
        band.style.backgroundColor = item.swatch;
        limb.appendChild(band);
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
  ];

  // ---- 페이지 요소 위에 잠깐 올라타기 ----
  // 페이지 전체를 자유롭게 기어다니는 건 아니고, 걷기 중간에 끼는 짧은 이벤트: 근처에
  // 보이는 큼직한 요소(버튼/이미지/구분선 등)로 걸어가 톡 뛰어올라 잠깐 그 위를
  // 걷다가 다시 바닥으로 내려온다. 스크롤/리사이즈처럼 좌표가 흔들릴 수 있는
  // 상황이 오면 복잡하게 재계산하지 않고 그냥 바닥으로 되돌린다(cancelClimb).
  const CLIMB = {
    selector: 'button, a, header, nav, footer, h1, h2, h3, hr, img, section, article, [role="button"], .btn',
    minWidth: 64,
    minLiftY: 20,
    maxLiftY: 260,
    maxReachX: 380,
    maxScan: 500, // 요소가 아주 많은 페이지에서도 한 번에 너무 많이 스캔하지 않도록
    walkSpeed: 30,
    hopSpeed: 520,
    standMin: 2,
    standMax: 4,
  };

  function findClimbTarget() {
    const floor = floorTop();
    const petCenterX = state.x + W / 2;
    const candidates = document.querySelectorAll(CLIMB.selector);
    let best = null;
    let bestDist = Infinity;
    let scanned = 0;
    for (const el of candidates) {
      if (scanned++ > CLIMB.maxScan) break;
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

  function cancelClimb() {
    if (!state.climb) return;
    state.climb = null;
    state.y = floorTop();
  }

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
        c.standDuration = CLIMB.standMin + Math.random() * (CLIMB.standMax - CLIMB.standMin);
        c.dir = Math.random() < 0.5 ? -1 : 1;
        setActivityClass("pet--walking");
      }
      place();
      return;
    }

    if (c.phase === "onTop") {
      c.standTimer += dt;
      const leftBound = clampX(platformLeft);
      const rightBound = clampX(Math.max(platformLeft, platformRight - W));
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
      if (c.standTimer >= c.standDuration) {
        c.phase = "descend";
        setActivityClass("pet--jumping");
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
    if (a.type === "climb") {
      const target = findClimbTarget();
      if (!target) {
        enterActivity(ACTIVITIES[0]); // 근처에 밟을 만한 게 없으면 그냥 걷기
        return;
      }
      state.activity = "climb";
      state.activityTimer = 0;
      state.activityDuration = Infinity; // stepClimb가 다 끝나면 알아서 다음 행동을 고른다
      state.climb = { el: target.el, rect: target.rect, phase: "approach" };
      setActivityClass("pet--walking");
      state.baseExpression = "excited";
      setExpression("excited");
      return;
    }
    state.climb = null;
    state.activity = a.type;
    state.activityTimer = 0;
    state.activityDuration = a.min + Math.random() * (a.max - a.min);
    setActivityClass(a.cls);
    if (a.type === "walk") {
      const speed = 26 + Math.random() * 26;
      state.dx = (Math.random() < 0.5 ? -1 : 1) * speed;
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
      react(BUBBLE_MESSAGES[Math.floor(Math.random() * BUBBLE_MESSAGES.length)], "love");
    }
  });

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
      cancelClimb();
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
      // 순수 클릭 → 대화창 (드래그였다면 여기로 오지 않으므로 클릭-대화 오작동 방지)
      openDialog();
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
      } else if (state.activity === "climb") {
        stepClimb(dt);
      }
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // 창 크기 변경/스크롤 시 밟고 있던 요소의 좌표가 더 이상 안 맞을 수 있으니,
  // 복잡하게 다시 계산하지 않고 그냥 바닥으로 되돌린다.
  window.addEventListener("resize", () => {
    state.x = clampX(state.x);
    cancelClimb();
    if (state.mode !== "falling" && state.mode !== "dragging") state.y = floorTop();
    place();
    if (dialogEl && dialogEl.classList.contains("dialog--open")) positionDialog();
  });
  window.addEventListener(
    "scroll",
    () => {
      if (!state.climb) return;
      cancelClimb();
      place();
      enterActivity(pickActivity());
    },
    { passive: true, capture: true }
  );

  // ---- 대화창(위저드) ----
  let dialogEl = null;
  let wiz = null;

  function openDialog() {
    state.mode = "dialog";
    cancelClimb();
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
        <div class="dialog__title">무엇을 만들까요?<small>질문에 답하면 무엇을 요청할지 알려드려요</small></div>
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
    let answers = {};
    let history = [];
    let currentId = questions.START_ID;
    let finished = false;

    function reset() {
      answers = {};
      history = [];
      currentId = questions.START_ID;
      finished = false;
      render();
    }

    function updateProgress() {
      const pct = finished
        ? 100
        : Math.max(6, Math.min(95, (history.length / questions.QUESTIONS.length) * 100));
      bar.style.width = `${pct}%`;
      backBtn.hidden = history.length === 0 && !finished;
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
      if (history.length === 0) return;
      currentId = history.pop();
      render();
    }
    backBtn.onclick = back;

    function advanceFrom(q, value) {
      answers[q.id] = value;
      const nextId = questions.resolveNext(q, value, answers);
      if (nextId) {
        goTo(nextId);
      } else {
        finished = true;
        render();
      }
    }

    function render() {
      bodyBox.innerHTML = "";
      bodyBox.scrollTop = 0;

      if (finished) {
        renderGuide();
        nextBtn.style.display = "none";
        updateProgress();
        return;
      }
      nextBtn.style.display = "";

      const q = questions.getQuestion(currentId);
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

    function renderGuide() {
      const g = guide.buildGuide(answers);

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

      const cta = document.createElement("button");
      cta.className = "guide__cta";
      cta.innerHTML = "프롬프트 생성하기 →<small>답변을 그대로 담아 사이트에서 완성 프롬프트를 만들어요</small>";
      cta.addEventListener("click", () => {
        const frag = share.encodeAnswers(answers); // "s=..."
        window.open(`${APP_URL}#${frag}`, "_blank", "noopener");
        gacha.addCoins(gacha.EARN_PER_PROMPT);
        spawnFx(`+${gacha.EARN_PER_PROMPT} 코인 🪙`);
      });
      bodyBox.appendChild(cta);

      const restart = document.createElement("button");
      restart.className = "guide__restart";
      restart.textContent = "처음부터 다시";
      restart.addEventListener("click", reset);
      bodyBox.appendChild(restart);
    }

    render();
    return { reset };
  }

  // 팝업(켜기/끄기, 허용 사이트 목록)에서 상태 변경 시 반영
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.enabled && changes.enabled.newValue === false) {
      host.remove();
    }
    if (changes.allowedSites && !isSiteAllowed(changes.allowedSites.newValue)) {
      host.remove();
    }
    // 팝업에서 가챠로 새 아이템을 장착/해제하면 새로고침 없이 바로 반영
    if (changes.equipped) {
      applyEquipped(changes.equipped.newValue);
    }
  });
})();

"use strict";

/**
 * 캐릭터 한 마리를 담당하는 렌더러. 이 창 자체가 캐릭터이므로,
 * "이동"은 DOM 안에서가 아니라 실제 OS 창을 옮기는 것으로 구현한다
 * (window.desktopPet.moveWindow -> 메인 프로세스가 BrowserWindow.setPosition).
 */
(function () {
  const api = window.desktopPet;

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

  // 쓰다듬었을 때(클릭/근접)는 살짝 다른 반응이 나오도록 무작위로 고른다
  const PET_REACTIONS = ["excited", "excited", "love", "embarrassed"];
  function pickReactionExpression() {
    return PET_REACTIONS[Math.floor(Math.random() * PET_REACTIONS.length)];
  }

  const SVG_NS = "http://www.w3.org/2000/svg";
  function buildSpriteSvg(sprite) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "pet__sprite");
    svg.setAttribute("viewBox", `0 0 ${api.COLS} ${api.ROWS}`);
    svg.setAttribute("shape-rendering", "crispEdges");
    svg.style.width = `${sprite.width}px`;
    svg.style.height = `${sprite.height}px`;
    sprite.rects.forEach((r) => {
      const rectEl = document.createElementNS(SVG_NS, "rect");
      rectEl.setAttribute("x", r.x);
      rectEl.setAttribute("y", r.y);
      rectEl.setAttribute("width", r.w);
      rectEl.setAttribute("height", r.h);
      rectEl.setAttribute("fill", r.color);
      svg.appendChild(rectEl);
    });
    return svg;
  }

  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  class PetWindowController {
    constructor(root) {
      this.root = root;
      this.workArea = { x: 0, y: 0, width: 800, height: 600 };
      this.windowWidth = 140;
      this.windowHeight = 160;
      this.x = 0;
      this.y = 0;
      this.dx = 0;
      this.dy = 0;
      this.affection = 0;
      this.name = "";
      this.species = "cat";
      this.activity = null;
      this.activityTimer = 0;
      this.activityDuration = 0;
      this.lastReactAt = 0;
      this.excitedTimer = null;
      this._lastFrameTime = null;

      api.onInit((data) => this._init(data));
      api.onUpdate((data) => this._onUpdate(data));
      api.onWorkAreaChange((workArea) => {
        this.workArea = workArea;
        // 해상도/작업표시줄이 바뀌어도 계속 작업표시줄 바로 위에 붙어있게 한다.
        this.floorY = workArea.y + Math.max(0, workArea.height - this.windowHeight);
        this.y = this.floorY;
        api.moveWindow(this.x, this.y);
      });
      api.onProximityNear(() => this.react(pickMessage()));
      api.onPetMe(() => this.onInteract());
    }

    _init(data) {
      this.species = data.species;
      this.name = data.name;
      this.affection = data.affection;
      this.windowWidth = data.windowWidth;
      this.windowHeight = data.windowHeight;
      this.workArea = data.workArea;
      // 세로 위치는 항상 작업표시줄 바로 위(바닥)에 고정한다.
      this.floorY = this.workArea.y + Math.max(0, this.workArea.height - this.windowHeight);
      this.x = data.x;
      this.y = this.floorY;

      this._buildDom();
      this._enterActivity({ type: "walk", className: "pet--walking", minDur: 3, maxDur: 7, expression: "happy" });
      requestAnimationFrame((t) => this._loop(t));
    }

    _onUpdate(data) {
      if (typeof data.name === "string") {
        this.name = data.name;
        this.nameEl.textContent = this.name;
      }
    }

    _buildDom() {
      const speciesDef = api.SPECIES_MAP[this.species];
      const sprite = speciesDef.sprite;
      // 아이콘 크기 정도로 작게. main.js의 SPRITE_SCALE과 반드시 같아야 한다.
      const scale = 0.5;

      const body = document.createElement("div");
      body.className = "pet__body";
      body.style.width = `${sprite.width * scale}px`;
      body.style.height = `${sprite.height * scale}px`;

      const shadow = document.createElement("div");
      shadow.className = "pet__shadow";
      body.appendChild(shadow);

      // 팔다리도 sprite보다 먼저 넣는다: 몸통 실루엣과 겹치는 절반은 자연스럽게
      // 가려지고, 실루엣 밖으로 튀어나온 부분만 보여서 "붙어있는 팔다리"처럼 보인다.
      api.buildLimbs(speciesDef, sprite).forEach((spec) => {
        const limb = document.createElement("div");
        limb.className = `pet__limb pet__limb--${spec.part} pet__limb--${spec.side}`;
        limb.style.width = `${spec.widthPct}%`;
        limb.style.height = `${spec.heightPct}%`;
        limb.style.left = `${spec.leftPct}%`;
        limb.style.top = `${spec.topPct}%`;
        limb.style.backgroundColor = speciesDef.colors.b;
        body.appendChild(limb);
      });

      const spriteEl = buildSpriteSvg(sprite);
      // 확대는 CSS 변수로 넘긴다(직접 style.transform을 쓰면 .pet--flip의
      // scaleX(-1) 규칙이 인라인 스타일에 밀려 절대 적용되지 않기 때문).
      spriteEl.style.setProperty("--sprite-scale", scale);
      // 중앙 기준으로 확대되도록 body 안에서 가운데 정렬한다
      spriteEl.style.left = `${(sprite.width * (scale - 1)) / 2}px`;
      spriteEl.style.top = `${(sprite.height * (scale - 1)) / 2}px`;
      body.appendChild(spriteEl);

      // 얼굴: 왼쪽눈/입/오른쪽눈 세 칸(고정 위치)에 표정 문자를 넣는다.
      // (">_", ">_<", "-_-" 등 - EXPRESSIONS 참고). textContent로만 표시.
      const face = document.createElement("div");
      face.className = "pet__face";
      face.style.top = `${sprite.faceBox.topPct}%`;
      face.style.left = `${sprite.faceBox.leftPct}%`;
      face.style.width = `${sprite.faceBox.widthPct}%`;
      face.style.height = `${sprite.faceBox.heightPct}%`;
      const faceHeightPx = (sprite.faceBox.heightPct / 100) * sprite.height * scale;
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
      body.appendChild(zzz);

      const nameLabel = document.createElement("div");
      nameLabel.className = "pet__name";
      nameLabel.textContent = this.name;
      body.appendChild(nameLabel);

      body.addEventListener("click", () => this.onInteract());

      this.root.appendChild(body);
      this.bodyEl = body;
      this.bubbleEl = bubble;
      this.nameEl = nameLabel;
    }

    _enterActivity(def) {
      this.activity = def.type;
      this.activityTimer = 0;
      this.activityDuration = def.minDur + Math.random() * (def.maxDur - def.minDur);
      this.bodyEl.classList.remove(...ACTIVITY_CLASSES);
      // 모션 감소 모드에서는 애니메이션 class를 아예 붙이지 않는다.
      if (!prefersReducedMotion.matches) {
        this.bodyEl.classList.add(def.className);
      }

      if (def.type === "walk") {
        // 좌우로만 걷는다(위아래 X). 방향만 무작위로 고른다.
        const speed = 14 + Math.random() * 16;
        this.dx = (Math.random() < 0.5 ? -1 : 1) * speed;
        this.dy = 0;
      }

      // 앉아있을 때 아주 가끔 시무룩한 표정을 보여준다. 그 외에는 상태에 맞는
      // 기본 표정으로 돌아간다(쓰다듬는 반응이 끝나면 이 표정으로 복귀).
      this.baseExpression =
        def.type === "sit" && Math.random() < 0.12 ? "crying" : def.expression || "happy";
      this.setExpression(this.baseExpression);
    }

    setExpression(name) {
      const expr = api.EXPRESSIONS[name] || api.EXPRESSIONS.happy;
      // textContent만 사용
      this.faceLeftEl.textContent = expr.left;
      this.faceMouthEl.textContent = expr.mouth;
      this.faceRightEl.textContent = expr.right;
    }

    async onInteract() {
      // 펫을 클릭하면 프롬프트 생성기 미니 창을 연다(핵심 기능).
      // 창은 하나만 뜨므로(메인에서 단일 인스턴스 처리) 여러 번 눌러도 안전하다.
      api.openGenerator();

      const affection = await api.interact();
      if (typeof affection === "number") this.affection = affection;

      // 아주 빠르게 여러 번 누르면(스팸) 화난 표정으로 반응한다
      const now = performance.now();
      this.clickTimestamps = (this.clickTimestamps || []).filter((t) => now - t < 1500);
      this.clickTimestamps.push(now);
      const isSpam = this.clickTimestamps.length >= 4;

      this.react(pickMessage(), isSpam ? "angry" : null);
    }

    react(message, forceExpression) {
      const now = performance.now();
      if (now - this.lastReactAt < 600) return;
      this.lastReactAt = now;

      if (this.activity === "sleep" || this.activity === "sit") {
        this._enterActivity({ type: "walk", className: "pet--walking", minDur: 3, maxDur: 7, expression: "happy" });
      }

      this.setExpression(forceExpression || pickReactionExpression());
      this.bubbleEl.textContent = message;
      this.bodyEl.classList.add("pet--excited", "pet--talking");
      clearTimeout(this.excitedTimer);
      this.excitedTimer = setTimeout(() => {
        this.bodyEl.classList.remove("pet--excited", "pet--talking");
        this.setExpression(this.baseExpression);
      }, 1400);
    }

    _loop(timestamp) {
      if (this._lastFrameTime == null) this._lastFrameTime = timestamp;
      const dt = Math.min(0.05, (timestamp - this._lastFrameTime) / 1000);
      this._lastFrameTime = timestamp;

      if (!prefersReducedMotion.matches) {
        this.activityTimer += dt;
        if (this.activityTimer >= this.activityDuration) {
          this._enterActivity(pickActivity());
        }

        if (this.activity === "walk") {
          // 좌우로만 이동. 벽에 닿으면 방향을 뒤집는다.
          const minX = this.workArea.x;
          const maxX = this.workArea.x + Math.max(0, this.workArea.width - this.windowWidth);

          let nx = this.x + this.dx * dt;
          if (nx <= minX || nx >= maxX) {
            this.dx *= -1;
            nx = Math.min(Math.max(nx, minX), maxX);
          }
          // 가끔 변덕스럽게 방향만 바꾼다(속도는 유지).
          if (Math.random() < 0.008) this.dx *= -1;

          this.x = nx;
          this.y = this.floorY; // 세로는 항상 작업표시줄 바로 위에 고정
          api.moveWindow(this.x, this.y);
          this.bodyEl.classList.toggle("pet--flip", this.dx < 0);
        }
      }

      requestAnimationFrame((t) => this._loop(t));
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    new PetWindowController(document.getElementById("pet-root"));
  });
})();

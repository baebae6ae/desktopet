"use strict";

import * as gacha from "../vendor/gacha.js";

const enabledEl = document.getElementById("enabled");
const speciesEl = document.getElementById("species");
const hintEl = document.getElementById("hint");
const currentSiteRowEl = document.getElementById("current-site-row");
const currentSiteHostEl = document.getElementById("current-site-host");
const currentSiteToggleEl = document.getElementById("current-site-toggle");
const siteListEl = document.getElementById("site-list");
const siteListEmptyEl = document.getElementById("site-list-empty");

let initial = { enabled: true, species: "cat" };
let currentHost = null; // 지금 보고 있는 탭의 호스트명(chrome:// 등이면 null)

function showHint(msg) {
  hintEl.textContent = msg || "";
}

// 사이트별 권한은 이제 우리 스토리지가 아니라 크롬의 실제
// optional_host_permissions로 관리한다: 설치 시점엔 아무 권한도 없고,
// 사용자가 이 토글을 켠 사이트에만 그때그때 permissions.request로 권한을
// 받는다(스토어 설치 화면의 "모든 사이트" 경고 없이, 사이트 하나짜리 작은
// 확인창만 뜬다).
// optional_host_permissions에 "http://*/*"와 "https://*/*"를 각각 선언해뒀는데,
// 크롬은 permissions.request()에 넘긴 패턴이 그 선언과 스킴까지 정확히 겹쳐야
// 통과시킨다("*://호스트/*" 같은 스킴 와일드카드는 부분집합으로 안 쳐준다) —
// 그래서 항상 http/https 두 패턴을 한 쌍으로 요청/해제한다.
function toMatchPatterns(host) {
  return [`http://${host}/*`, `https://${host}/*`];
}

function hostFromPattern(pattern) {
  const m = /^https?:\/\/([^/]+)\/\*$/.exec(pattern);
  return m ? m[1] : pattern;
}

async function grantedHosts() {
  const { origins } = await chrome.permissions.getAll();
  return [...new Set((origins || []).map(hostFromPattern))];
}

function renderSiteList(hosts) {
  siteListEl.innerHTML = "";
  siteListEmptyEl.style.display = hosts.length ? "none" : "block";
  for (const host of hosts) {
    const li = document.createElement("li");
    li.className = "site-row";
    const span = document.createElement("span");
    span.textContent = host;
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.textContent = "✕";
    removeBtn.setAttribute("aria-label", `${host} 권한 해제`);
    removeBtn.addEventListener("click", () => setSiteAllowed(host, false));
    li.append(span, removeBtn);
    siteListEl.appendChild(li);
  }
  if (currentHost) {
    currentSiteToggleEl.checked = hosts.includes(currentHost);
  }
}

async function refreshSiteList() {
  renderSiteList(await grantedHosts());
}

// 권한 해제 전에(살아있는 동안) 그 사이트의 열린 탭들에 "정리해" 메시지를
// 먼저 보낸 뒤 권한을 회수한다 — 회수 후엔 그 탭들을 다시 찾을 방법이 없다.
async function setSiteAllowed(host, allow) {
  const patterns = toMatchPatterns(host);
  if (allow) {
    let granted = false;
    try {
      granted = await chrome.permissions.request({ origins: patterns });
    } catch (_) {
      granted = false;
    }
    await refreshSiteList();
    return granted;
  }
  try {
    const tabs = await chrome.tabs.query({ url: patterns });
    for (const tab of tabs) {
      if (tab.id) chrome.tabs.sendMessage(tab.id, { type: "nch-permission-revoked" }).catch(() => {});
    }
  } catch (_) {
    // 무시 — 메시지 전달은 최선 노력일 뿐, 다음 탐색부터는 등록 자체가 해제된다
  }
  await chrome.permissions.remove({ origins: patterns });
  await refreshSiteList();
  return true;
}

async function detectCurrentHost() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) return null;
    const u = new URL(tab.url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.hostname;
  } catch (_) {
    // chrome://, 웹스토어, PDF 뷰어 등 호스트가 없는 특수 페이지
    return null;
  }
}

const petNameEl = document.getElementById("pet-name");
const affectionEl = document.getElementById("affection");

function renderAffection(points) {
  const p = typeof points === "number" ? points : 0;
  affectionEl.textContent = `♥ ${p} · Lv.${gacha.affectionLevel(p)}`;
}

async function init() {
  const { enabled, species, petName, affection } = await chrome.storage.local.get([
    "enabled",
    "species",
    "petName",
    "affection",
  ]);
  initial = { enabled: enabled !== false, species: species || "cat" };
  enabledEl.checked = initial.enabled;
  speciesEl.value = initial.species;
  petNameEl.value = typeof petName === "string" ? petName : "";
  renderAffection(affection);

  currentHost = await detectCurrentHost();
  if (currentHost) {
    currentSiteRowEl.hidden = false;
    currentSiteHostEl.textContent = currentHost;
  }
  await refreshSiteList();
}
init();

petNameEl.addEventListener("change", () => {
  const name = petNameEl.value.trim().slice(0, 12);
  petNameEl.value = name;
  chrome.storage.local.set({ petName: name });
  showHint(name ? `이제 "${name}"(이)라고 불러요!` : "");
});

enabledEl.addEventListener("change", () => {
  chrome.storage.local.set({ enabled: enabledEl.checked });
  if (enabledEl.checked && !initial.enabled) {
    showHint("열려있는 탭은 새로고침하면 나타나요.");
  } else {
    showHint("");
  }
});

speciesEl.addEventListener("change", () => {
  chrome.storage.local.set({ species: speciesEl.value });
  showHint("캐릭터 변경은 새로고침 후 적용돼요.");
});

currentSiteToggleEl.addEventListener("change", async () => {
  if (!currentHost) return;
  const wantOn = currentSiteToggleEl.checked;
  if (wantOn) {
    showHint("허용 여부를 확인해주세요...");
    const granted = await setSiteAllowed(currentHost, true);
    if (granted) {
      showHint(`${currentHost}에서 펫이 보여요! (새로고침 없이 바로 나타나요)`);
    } else {
      currentSiteToggleEl.checked = false;
      showHint("권한을 허용해야 이 사이트에서 펫이 보여요.");
    }
  } else {
    await setSiteAllowed(currentHost, false);
    showHint(`${currentHost}에서 펫을 숨겼어요.`);
  }
});

/* ================= 탭 전환 ================= */
const tabButtons = document.querySelectorAll(".tab");
const views = { settings: document.getElementById("view-settings"), gacha: document.getElementById("view-gacha") };
for (const btn of tabButtons) {
  btn.addEventListener("click", () => {
    const key = btn.dataset.tab;
    for (const b of tabButtons) b.setAttribute("aria-selected", String(b === btn));
    for (const [k, el] of Object.entries(views)) el.hidden = k !== key;
  });
}

/* ================= 가챠 ================= */
const coinBalanceEl = document.getElementById("coin-balance");
const tabCoinsEl = document.getElementById("tab-coins");
const pullBtn = document.getElementById("pull-btn");
const gachaHintEl = document.getElementById("gacha-hint");
const pityMeterEl = document.getElementById("pity-meter");
const gachaViewEl = document.getElementById("view-gacha");
const pullstageEl = document.getElementById("pullstage");
const particlesEl = document.getElementById("particles");
const pullCardEl = document.getElementById("pullcard");
const pullIconEl = document.getElementById("pull-icon");
const pullNameEl = document.getElementById("pull-name");
const pullRarityEl = document.getElementById("pull-rarity");
const slotsEl = document.getElementById("slots");

function setCoinDisplay(coins) {
  coinBalanceEl.textContent = coins;
  tabCoinsEl.textContent = `🪙 ${coins}`;
  pullBtn.disabled = coins < gacha.PULL_COST;
}

function renderPityMeter(pity) {
  const left = Math.max(0, gacha.PITY_THRESHOLD - pity);
  pityMeterEl.innerHTML = `천장까지 <b>${left}</b>번 — 중복은 코인으로 환급돼요`;
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
  const state = await gacha.getGachaState();
  setCoinDisplay(state.coins);
  renderPityMeter(state.pity);
  renderSlots(state.equipped);
  return state;
}
refreshGachaView();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.coins || changes.inventory || changes.equipped) refreshGachaView();
  if (changes.affection) renderAffection(changes.affection.newValue);
});

/* ---- 아이템 픽커(슬롯 클릭 시 바텀시트) ---- */
function openPicker(slot) {
  gacha.getGachaState().then((state) => {
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
      const owned = state.inventory[item.id] || 0;
      const locked = owned === 0;
      const equippedHere = state.equipped[slot] === item.id;
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

/* ---- 뽑기 연출: 슬롯머신 릴이 아니라, 버튼을 누르면 잠깐 예열되다가
   화면 중앙에서 빛이 확 터지고 아이템이 튀어나오는 "상자 개봉" 연출 ---- */
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

    // 리플로우 후 클래스를 추가해야 애니메이션이 다시 처음부터 재생된다
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
  renderPityMeter(result.pity);

  // 결과는 이미 정해졌지만, 잠깐 예열 텀을 둬야 "짠!" 하고 터지는 느낌이 산다.
  await new Promise((r) => setTimeout(r, 420));
  pullBtn.classList.remove("is-spinning");
  await playPullFx(result.item, result.isNew);

  if (result.pityBroken) {
    gachaHintEl.textContent = "천장 발동! 에픽이 확정으로 나왔어요 ✨";
  } else if (result.refund > 0) {
    gachaHintEl.textContent = `중복 아이템이라 +${result.refund} 코인 환급했어요 🪙`;
  } else {
    gachaHintEl.textContent = "";
  }
});

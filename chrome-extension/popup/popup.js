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

function normalizeList(list) {
  return Array.isArray(list) ? list : [];
}

function renderSiteList(list) {
  const sites = normalizeList(list);
  siteListEl.innerHTML = "";
  siteListEmptyEl.style.display = sites.length ? "none" : "block";
  for (const host of sites) {
    const li = document.createElement("li");
    li.className = "site-row";
    const span = document.createElement("span");
    span.textContent = host;
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.textContent = "✕";
    removeBtn.setAttribute("aria-label", `${host} 제거`);
    removeBtn.addEventListener("click", () => toggleSite(host, false));
    li.append(span, removeBtn);
    siteListEl.appendChild(li);
  }
  if (currentHost) {
    currentSiteToggleEl.checked = sites.includes(currentHost);
  }
}

async function toggleSite(host, allow) {
  const { allowedSites } = await chrome.storage.local.get(["allowedSites"]);
  const sites = new Set(normalizeList(allowedSites));
  if (allow) sites.add(host);
  else sites.delete(host);
  const next = [...sites];
  await chrome.storage.local.set({ allowedSites: next });
  renderSiteList(next);
}

async function detectCurrentHost() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) return null;
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => location.hostname,
    });
    return result || null;
  } catch (err) {
    // chrome://, 웹스토어, PDF 뷰어 등 스크립트를 심을 수 없는 페이지
    return null;
  }
}

async function init() {
  const { enabled, species, allowedSites } = await chrome.storage.local.get([
    "enabled",
    "species",
    "allowedSites",
  ]);
  initial = { enabled: enabled !== false, species: species || "cat" };
  enabledEl.checked = initial.enabled;
  speciesEl.value = initial.species;

  currentHost = await detectCurrentHost();
  if (currentHost) {
    currentSiteRowEl.hidden = false;
    currentSiteHostEl.textContent = currentHost;
  }
  renderSiteList(allowedSites);
}
init();

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

currentSiteToggleEl.addEventListener("change", () => {
  if (!currentHost) return;
  toggleSite(currentHost, currentSiteToggleEl.checked);
  showHint(
    currentSiteToggleEl.checked
      ? `${currentHost}에서 펫이 보여요.`
      : `${currentHost}에서 펫을 껐어요.`
  );
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
const reelEl = document.getElementById("reel");
const reelTrackEl = document.getElementById("reel-track");
const revealEl = document.getElementById("reveal");
const revealBurstEl = document.getElementById("reveal-burst");
const revealIconEl = document.getElementById("reveal-icon");
const revealNameEl = document.getElementById("reveal-name");
const revealRarityEl = document.getElementById("reveal-rarity");
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
  const state = await gacha.getGachaState();
  setCoinDisplay(state.coins);
  renderSlots(state.equipped);
  return state;
}
refreshGachaView();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.coins || changes.inventory || changes.equipped) refreshGachaView();
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

/* ---- 뽑기 연출: 슬롯머신처럼 빠르게 돌다가 결과에서 딱 멈춘다 ---- */
const REEL_CELL_COUNT = 26;
const REEL_TARGET_INDEX = 20;

function buildReelCells(finalItem) {
  reelTrackEl.innerHTML = "";
  reelTrackEl.style.transition = "none";
  reelTrackEl.style.transform = "translateX(0)";
  for (let i = 0; i < REEL_CELL_COUNT; i++) {
    const item = i === REEL_TARGET_INDEX ? finalItem : gacha.ITEMS[Math.floor(Math.random() * gacha.ITEMS.length)];
    const cell = document.createElement("div");
    cell.className = "reel__cell";
    cell.style.setProperty("--r-color", gacha.RARITY[item.rarity].color);
    cell.textContent = item.icon;
    reelTrackEl.appendChild(cell);
  }
}

function spinReel(finalItem) {
  return new Promise((resolve) => {
    buildReelCells(finalItem);
    reelEl.hidden = false;
    revealEl.hidden = true;
    // 강제 리플로우 후 목표 칸의 실제 좌표를 측정해서 그 칸이 정확히 포인터(중앙) 아래 오도록 이동한다.
    // eslint-disable-next-line no-unused-expressions
    reelTrackEl.offsetHeight;
    const targetCell = reelTrackEl.children[REEL_TARGET_INDEX];
    const cellCenter = targetCell.offsetLeft + targetCell.offsetWidth / 2;
    requestAnimationFrame(() => {
      reelTrackEl.style.transition = "transform 1.9s cubic-bezier(0.1, 0.85, 0.15, 1)";
      reelTrackEl.style.transform = `translateX(-${cellCenter}px)`;
    });
    setTimeout(resolve, 1950);
  });
}

function showReveal(item, isNew) {
  reelEl.hidden = true;
  revealEl.hidden = false;
  revealEl.classList.remove("is-live");
  const rarity = gacha.RARITY[item.rarity];
  revealEl.style.setProperty("--r-color", rarity.color);
  revealIconEl.textContent = item.icon;
  revealNameEl.textContent = `${item.name}${isNew ? " (NEW!)" : ""}`;
  revealRarityEl.textContent = rarity.label;
  // reflow 후 클래스 추가해야 애니메이션이 다시 재생된다
  void revealEl.offsetWidth;
  revealEl.classList.add("is-live");
}

pullBtn.addEventListener("click", async () => {
  pullBtn.disabled = true;
  pullBtn.classList.add("is-spinning");
  gachaHintEl.textContent = "";
  revealEl.hidden = true;

  const result = await gacha.pullGacha();
  if (!result.ok) {
    pullBtn.classList.remove("is-spinning");
    gachaHintEl.textContent = "코인이 부족해요! 프롬프트를 생성하면 코인을 받아요.";
    setCoinDisplay(result.coins);
    return;
  }

  await spinReel(result.item);
  showReveal(result.item, result.isNew);
  pullBtn.classList.remove("is-spinning");
  setCoinDisplay(result.coins);
});

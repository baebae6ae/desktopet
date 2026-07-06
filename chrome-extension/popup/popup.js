"use strict";

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

"use strict";

/**
 * background.js — 서비스워커. 설치 시점엔 어떤 사이트 권한도 요구하지 않고
 * (host_permissions는 optional), 사용자가 팝업에서 "이 사이트에서 보이기"를
 * 켠 사이트에만 그때그때 chrome.permissions.request로 권한을 받는다.
 * 이 파일은 그렇게 허용된 사이트 목록과 실제 콘텐츠 스크립트 등록 상태를
 * 항상 일치시키는 역할만 한다 — 권한을 요청/해제하는 UI 로직은 popup.js에 있다.
 */

const SCRIPT_ID = "pet-content-script";

async function grantedOrigins() {
  const { origins } = await chrome.permissions.getAll();
  return origins || [];
}

// 지금 허용된 사이트 목록에 맞춰 동적 콘텐츠 스크립트 등록을 다시 맞춘다.
// (registerContentScripts는 "다음 탐색부터" 적용되고, 기존 등록을 자동으로
// 안 지워주므로 매번 통째로 다시 계산한다.)
async function syncRegisteredScript() {
  const origins = await grantedOrigins();
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
  if (origins.length === 0) {
    if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
    return;
  }
  const def = { id: SCRIPT_ID, js: ["content/pet.js"], matches: origins, runAt: "document_idle" };
  if (existing.length) await chrome.scripting.updateContentScripts([def]);
  else await chrome.scripting.registerContentScripts([def]);
}

// 방금 권한을 받은 사이트에 이미 열려 있는 탭이 있으면, 동적 등록은 다음
// 탐색부터만 적용되니 지금 열린 탭에는 바로 주입해서 새로고침 없이 나타나게 한다.
async function injectIntoOpenTabs(patterns) {
  if (!patterns.length) return;
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({ url: patterns });
  } catch (_) {
    return;
  }
  for (const tab of tabs) {
    if (!tab.id) continue;
    chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content/pet.js"] }).catch(() => {});
  }
}

chrome.runtime.onInstalled.addListener(syncRegisteredScript);
chrome.runtime.onStartup.addListener(syncRegisteredScript);
chrome.permissions.onAdded.addListener((delta) => {
  syncRegisteredScript();
  injectIntoOpenTabs(delta.origins || []);
});
chrome.permissions.onRemoved.addListener(syncRegisteredScript);

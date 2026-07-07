"use strict";

/**
 * web-shim.js — 크롬 확장 없이 이 페이지 단독으로 열었을 때, chrome-extension/
 * 폴더의 코드(vendor/gacha.js, vendor/sprites.js 등)를 그대로 재사용할 수 있도록
 * chrome.storage.local / chrome.storage.onChanged 의 최소 동작만 localStorage로
 * 흉내낸다. 실제 확장 안에서 이 페이지가 열릴 일은 없지만, 혹시를 대비해
 * 진짜 chrome.storage가 있으면 손대지 않는다.
 */
(function () {
  if (window.chrome && window.chrome.storage && window.chrome.storage.local) return;

  const PREFIX = "desktopet:";
  const listeners = new Set();

  function parse(raw) {
    if (raw == null) return undefined;
    try {
      return JSON.parse(raw);
    } catch (_) {
      return undefined;
    }
  }

  function notify(changes) {
    for (const fn of listeners) fn(changes, "local");
  }

  const local = {
    async get(keys) {
      const list = keys == null ? null : Array.isArray(keys) ? keys : [keys];
      const out = {};
      if (list) {
        for (const k of list) {
          const v = parse(localStorage.getItem(PREFIX + k));
          if (v !== undefined) out[k] = v;
        }
      } else {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k.startsWith(PREFIX)) out[k.slice(PREFIX.length)] = parse(localStorage.getItem(k));
        }
      }
      return out;
    },
    async set(obj) {
      const changes = {};
      for (const [k, newValue] of Object.entries(obj)) {
        const oldValue = parse(localStorage.getItem(PREFIX + k));
        localStorage.setItem(PREFIX + k, JSON.stringify(newValue));
        changes[k] = { oldValue, newValue };
      }
      notify(changes);
    },
    async remove(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      const changes = {};
      for (const k of list) {
        const oldValue = parse(localStorage.getItem(PREFIX + k));
        localStorage.removeItem(PREFIX + k);
        changes[k] = { oldValue, newValue: undefined };
      }
      notify(changes);
    },
  };

  window.chrome = window.chrome || {};
  window.chrome.storage = {
    local,
    onChanged: {
      addListener(fn) {
        listeners.add(fn);
      },
      removeListener(fn) {
        listeners.delete(fn);
      },
    },
  };

  // 같은 사이트를 여러 탭에서 열어놨을 때도(같은 브라우저 안에서) 반영되게.
  window.addEventListener("storage", (e) => {
    if (!e.key || !e.key.startsWith(PREFIX)) return;
    notify({ [e.key.slice(PREFIX.length)]: { oldValue: parse(e.oldValue), newValue: parse(e.newValue) } });
  });
})();

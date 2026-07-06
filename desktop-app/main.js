"use strict";

const { app, BrowserWindow, Tray, Menu, screen, ipcMain, dialog, nativeImage, shell } = require("electron");
const path = require("path");
const fs = require("fs");

const { SPECIES, SPECIES_MAP, sanitizeName, makeId } = require("./shared/sprites.js");
const { buildTrayIconPng } = require("./shared/tray-icon.js");

// macOS 메뉴바 트레이 앱처럼 동작시킨다. Dock 아이콘/메뉴바는 필요 없다.
if (process.platform === "darwin" && app.dock) {
  app.dock.hide();
}

const STORE_PATH = path.join(app.getPath("userData"), "pets.json");
const WINDOW_PADDING = 24; // 말풍선/이름표/Zzz가 창 밖으로 잘리지 않도록 주는 여백
const PROXIMITY_RADIUS = 64; // 마우스가 이 거리(px) 안으로 들어오면 캐릭터가 반응
const PROXIMITY_POLL_MS = 120;

// 펫을 클릭하면 뜨는 Nocalhostmore 프롬프트 생성기. popup.html은 크롬 확장용
// 컴팩트(단일 컬럼) 버전이라 작은 창에 그대로 띄우기 좋다.
const GENERATOR_URL = "https://nocalhostmore.vercel.app/popup.html";
// "브라우저에서 열기"로 여는 전체 사이트 주소.
const GENERATOR_SITE = "https://nocalhostmore.vercel.app/";

let tray = null;
let settingsWindow = null;
let generatorWindow = null;
/** @type {Map<string, { win: import('electron').BrowserWindow, data: any, width: number, height: number, wasNear: boolean }>} */
const pets = new Map();

// ---------------------------------------------------------
// 저장(로컬 파일) - 브라우저 버전의 localStorage에 해당.
// 이 컴퓨터에만 저장되며, 어떤 서버로도 전송되지 않는다.
// ---------------------------------------------------------
function loadStoredPets() {
  try {
    const raw = fs.readFileSync(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.pets)) {
      throw new Error("저장된 데이터 형식이 올바르지 않습니다.");
    }
    return parsed.pets.filter(
      (p) =>
        p &&
        typeof p.id === "string" &&
        SPECIES_MAP[p.species] &&
        typeof p.name === "string" &&
        Number.isFinite(p.affection)
    );
  } catch (err) {
    if (err.code !== "ENOENT") {
      console.error("[데스크토펫] 저장된 데이터를 불러오지 못했습니다:", err);
    }
    return null; // 파일이 없거나(최초 실행) 손상된 경우
  }
}

function persist() {
  const list = [...pets.values()].map((p) => ({
    id: p.data.id,
    species: p.data.species,
    name: p.data.name,
    affection: p.data.affection,
  }));
  try {
    fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
    fs.writeFileSync(STORE_PATH, JSON.stringify({ pets: list }, null, 2), "utf8");
  } catch (err) {
    console.error("[데스크토펫] 저장에 실패했습니다:", err);
  }
}

// ---------------------------------------------------------
// 화면 영역 / 창 크기
// ---------------------------------------------------------
function getWorkArea() {
  return screen.getPrimaryDisplay().workArea; // { x, y, width, height }
}

// 스프라이트 확대 배율. 아이콘 크기 정도로 작게 유지한다(업무 방해 최소화).
// pet-renderer.js의 _buildDom 안 scale 값과 반드시 같아야 한다.
const SPRITE_SCALE = 0.5;

function windowSizeFor(speciesId) {
  const sprite = SPECIES_MAP[speciesId].sprite;
  const scale = SPRITE_SCALE;
  return {
    width: Math.ceil(sprite.width * scale) + WINDOW_PADDING * 2,
    height: Math.ceil(sprite.height * scale) + WINDOW_PADDING * 2 + 28,
  };
}

// ---------------------------------------------------------
// 캐릭터(펫) 창 생성/제거
// ---------------------------------------------------------
function spawnPet(rawData) {
  const species = SPECIES_MAP[rawData.species] ? rawData.species : SPECIES[0].id;
  const id = rawData.id || makeId();
  const name = sanitizeName(rawData.name) || SPECIES_MAP[species].label;
  const affection = Number.isFinite(rawData.affection) ? rawData.affection : 0;

  const { width, height } = windowSizeFor(species);
  const area = getWorkArea();
  // x는 가로로 아무 데나, y는 작업표시줄 바로 위(작업영역 맨 아래)에 붙인다.
  // workArea는 작업표시줄을 제외한 영역이라, 아래 끝이 곧 "작업표시줄 위"다.
  const x = area.x + Math.random() * Math.max(1, area.width - width);
  const y = area.y + Math.max(0, area.height - height);

  const win = new BrowserWindow({
    width,
    height,
    x: Math.round(x),
    y: Math.round(y),
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    focusable: true,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload-pet.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload가 require("./shared/sprites.js")로 로컬 모듈을
      // 불러와야 해서 기본 샌드박스(require 제한)를 꺼야 한다.
      backgroundThrottling: false,
    },
  });

  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setMenu(null);
  win.loadFile(path.join(__dirname, "renderer", "pet.html"));

  const record = { id, species, name, affection };
  pets.set(id, { win, data: record, width, height, wasNear: false });

  win.once("ready-to-show", () => win.show());
  win.webContents.once("did-finish-load", () => {
    win.webContents.send("pet:init", {
      id,
      species,
      name,
      affection,
      windowWidth: width,
      windowHeight: height,
      workArea: getWorkArea(),
      x: Math.round(x),
      y: Math.round(y),
    });
  });

  win.on("closed", () => {
    pets.delete(id);
    persist();
    broadcastListToSettings();
  });

  win.webContents.on("context-menu", (event, params) => {
    showPetContextMenu(id, win);
  });

  return record;
}

function removePet(id) {
  const entry = pets.get(id);
  if (!entry) return;
  entry.win.close(); // 'closed' 핸들러가 정리+저장까지 담당
}

function resetAllPets() {
  [...pets.keys()].forEach(removePet);
  try {
    fs.rmSync(STORE_PATH, { force: true });
  } catch (err) {
    console.error("[데스크토펫] 초기화 중 저장 파일 삭제 실패:", err);
  }
}

function showPetContextMenu(id, win) {
  const entry = pets.get(id);
  if (!entry) return;
  const menu = Menu.buildFromTemplate([
    { label: "프롬프트 만들기", click: () => openGeneratorWindow() },
    { label: "브라우저에서 사이트 열기", click: () => shell.openExternal(GENERATOR_SITE) },
    { type: "separator" },
    { label: `${entry.data.name} 쓰다듬기`, click: () => win.webContents.send("pet:pet-me") },
    { type: "separator" },
    { label: "이 캐릭터 제거", click: () => removePet(id) },
    { label: "설정 창 열기", click: () => openSettingsWindow() },
  ]);
  menu.popup({ window: win });
}

// ---------------------------------------------------------
// 설정 창 (스폰/이름변경/삭제/초기화)
// ---------------------------------------------------------
function currentList() {
  return [...pets.values()].map((p) => ({ ...p.data }));
}

function broadcastListToSettings() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send("settings:list", currentList());
  }
}

function openSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 420,
    height: 560,
    title: "데스크토펫 설정",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload-settings.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload가 require("./shared/sprites.js")로 로컬 모듈을
      // 불러와야 해서 기본 샌드박스(require 제한)를 꺼야 한다.
    },
  });
  settingsWindow.setMenu(null);
  settingsWindow.loadFile(path.join(__dirname, "renderer", "settings.html"));
  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });
}

// ---------------------------------------------------------
// 프롬프트 생성기 미니 창 (펫을 클릭하면 열림).
// Nocalhostmore의 배포된 정적 페이지(popup.html)를 그대로 로드한다.
// 원격 페이지라서 우리 preload는 붙이지 않고 격리된 기본 설정으로 띄운다.
// 여러 번 눌러도 창은 하나만(있으면 앞으로 가져오기).
// ---------------------------------------------------------
function openGeneratorWindow() {
  if (generatorWindow && !generatorWindow.isDestroyed()) {
    generatorWindow.show();
    generatorWindow.focus();
    return;
  }
  generatorWindow = new BrowserWindow({
    width: 400,
    height: 640,
    title: "프롬프트 만들기 · Nocalhostmore",
    autoHideMenuBar: true,
    alwaysOnTop: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  generatorWindow.setMenu(null);
  generatorWindow.loadURL(GENERATOR_URL);
  // 페이지 안의 링크(새 탭 대상 등)는 창을 새로 열지 말고 기본 브라우저로 보낸다.
  generatorWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  generatorWindow.on("closed", () => {
    generatorWindow = null;
  });
}

// ---------------------------------------------------------
// IPC 핸들러
// ---------------------------------------------------------
ipcMain.on("pet:move", (event, { id, x, y }) => {
  const entry = pets.get(id);
  if (!entry || entry.win.isDestroyed()) return;
  entry.win.setPosition(Math.round(x), Math.round(y), false);
});

// 펫을 클릭하면 렌더러가 이 메시지를 보내 프롬프트 생성기 창을 연다.
ipcMain.on("pet:open-generator", () => openGeneratorWindow());

ipcMain.handle("pet:interact", (event, { id }) => {
  const entry = pets.get(id);
  if (!entry) return null;
  entry.data.affection += 1;
  persist();
  broadcastListToSettings();
  return entry.data.affection;
});

ipcMain.handle("settings:get-list", () => currentList());

ipcMain.handle("settings:spawn", (event, { species }) => {
  const record = spawnPet({ species });
  broadcastListToSettings();
  return record;
});

ipcMain.handle("settings:rename", (event, { id, name }) => {
  const entry = pets.get(id);
  if (!entry) return { ok: false };
  const cleaned = sanitizeName(name);
  if (!cleaned) return { ok: false, reason: "이름은 한글/영문/숫자만 1~10자로 입력할 수 있어요." };
  entry.data.name = cleaned;
  persist();
  if (!entry.win.isDestroyed()) {
    entry.win.webContents.send("pet:update", { name: cleaned });
  }
  broadcastListToSettings();
  return { ok: true, name: cleaned };
});

ipcMain.on("settings:remove", (event, { id }) => {
  removePet(id);
});

ipcMain.handle("settings:reset-all", async () => {
  const { response } = await dialog.showMessageBox(settingsWindow, {
    type: "warning",
    buttons: ["취소", "모두 삭제"],
    defaultId: 0,
    cancelId: 0,
    message: "모든 캐릭터와 저장된 이름/애정도를 지울까요?",
    detail: "이 작업은 되돌릴 수 없습니다.",
  });
  if (response !== 1) return { ok: false };
  resetAllPets();
  broadcastListToSettings();
  return { ok: true };
});

// ---------------------------------------------------------
// 마우스 근접 감지: 각 펫 창은 자기 창 범위에서만 마우스 이벤트를 받을 수
// 있으므로, 메인 프로세스가 전역 커서 좌표를 주기적으로 읽어 가까이 오면
// 알려준다(진짜 OS 바탕화면 위에서 동작하기 위한 핵심 트릭).
// ---------------------------------------------------------
function startProximityWatcher() {
  setInterval(() => {
    if (pets.size === 0) return;
    const cursor = screen.getCursorScreenPoint();
    for (const entry of pets.values()) {
      if (entry.win.isDestroyed()) continue;
      const b = entry.win.getBounds();
      const cx = b.x + b.width / 2;
      const cy = b.y + b.height / 2;
      const dist = Math.hypot(cursor.x - cx, cursor.y - cy);
      const near = dist < PROXIMITY_RADIUS;
      if (near !== entry.wasNear) {
        entry.wasNear = near;
        if (near) entry.win.webContents.send("pet:proximity-near");
      }
    }
  }, PROXIMITY_POLL_MS);
}

// ---------------------------------------------------------
// 트레이 아이콘 + 메뉴
// ---------------------------------------------------------
function createTray() {
  const icon = nativeImage.createFromBuffer(buildTrayIconPng());
  tray = new Tray(icon);
  tray.setToolTip("데스크토펫");
  rebuildTrayMenu();
}

function rebuildTrayMenu() {
  const spawnItems = SPECIES.map((s) => ({
    label: `+ ${s.label}`,
    click: () => {
      spawnPet({ species: s.id });
      broadcastListToSettings();
    },
  }));

  const menu = Menu.buildFromTemplate([
    { label: "프롬프트 만들기", click: openGeneratorWindow },
    { label: "브라우저에서 사이트 열기", click: () => shell.openExternal(GENERATOR_SITE) },
    { type: "separator" },
    { label: "캐릭터 추가", submenu: spawnItems },
    { label: "설정 창 열기", click: openSettingsWindow },
    { type: "separator" },
    {
      label: "모두 제거",
      click: async () => {
        const { response } = await dialog.showMessageBox({
          type: "warning",
          buttons: ["취소", "모두 삭제"],
          defaultId: 0,
          cancelId: 0,
          message: "모든 캐릭터를 지울까요?",
          detail: "이 작업은 되돌릴 수 없습니다.",
        });
        if (response === 1) {
          resetAllPets();
          broadcastListToSettings();
        }
      },
    },
    { type: "separator" },
    { label: "종료", click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
}

// ---------------------------------------------------------
// 앱 시작
// ---------------------------------------------------------
app.whenReady().then(() => {
  createTray();

  const saved = loadStoredPets();
  if (saved && saved.length > 0) {
    saved.forEach((p) => spawnPet(p));
  } else if (saved === null) {
    // 최초 실행: 기본 캐릭터 한 마리
    spawnPet({ species: "cat" });
  }
  persist();

  startProximityWatcher();

  screen.on("display-metrics-changed", () => {
    const workArea = getWorkArea();
    for (const entry of pets.values()) {
      if (!entry.win.isDestroyed()) {
        entry.win.webContents.send("pet:work-area", workArea);
      }
    }
  });
});

// 트레이 앱이므로 창이 다 닫혀도(펫이 하나도 없어도) 종료하지 않는다.
// 트레이 메뉴의 "종료"로만 끝낸다.
app.on("window-all-closed", (event) => {
  event?.preventDefault?.();
});

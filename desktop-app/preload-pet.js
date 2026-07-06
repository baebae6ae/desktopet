"use strict";

const { contextBridge, ipcRenderer } = require("electron");
const sprites = require("./shared/sprites.js");

let cachedId = null;

contextBridge.exposeInMainWorld("desktopPet", {
  // 픽셀아트 데이터/계산 함수 (순수 함수라 그대로 노출해도 안전함)
  SPECIES: sprites.SPECIES,
  SPECIES_MAP: sprites.SPECIES_MAP,
  EXPRESSIONS: sprites.EXPRESSIONS,
  COLS: sprites.COLS,
  ROWS: sprites.ROWS,
  buildSprite: sprites.buildSprite,
  buildLimbs: sprites.buildLimbs,
  sanitizeName: sprites.sanitizeName,

  onInit(callback) {
    ipcRenderer.once("pet:init", (event, data) => {
      cachedId = data.id;
      callback(data);
    });
  },

  onUpdate(callback) {
    ipcRenderer.on("pet:update", (event, data) => callback(data));
  },

  onWorkAreaChange(callback) {
    ipcRenderer.on("pet:work-area", (event, workArea) => callback(workArea));
  },

  onProximityNear(callback) {
    ipcRenderer.on("pet:proximity-near", () => callback());
  },

  onPetMe(callback) {
    ipcRenderer.on("pet:pet-me", () => callback());
  },

  moveWindow(x, y) {
    if (!cachedId) return;
    ipcRenderer.send("pet:move", { id: cachedId, x, y });
  },

  // 프롬프트 생성기 미니 창을 연다(펫 클릭 시 호출).
  openGenerator() {
    ipcRenderer.send("pet:open-generator");
  },

  async interact() {
    if (!cachedId) return null;
    return ipcRenderer.invoke("pet:interact", { id: cachedId });
  },
});

"use strict";

const { contextBridge, ipcRenderer } = require("electron");
const sprites = require("./shared/sprites.js");

contextBridge.exposeInMainWorld("desktopPetSettings", {
  SPECIES: sprites.SPECIES,
  NAME_MAX_LEN: sprites.NAME_MAX_LEN,

  getList() {
    return ipcRenderer.invoke("settings:get-list");
  },

  onListChanged(callback) {
    ipcRenderer.on("settings:list", (event, list) => callback(list));
  },

  spawn(species) {
    return ipcRenderer.invoke("settings:spawn", { species });
  },

  rename(id, name) {
    return ipcRenderer.invoke("settings:rename", { id, name });
  },

  remove(id) {
    ipcRenderer.send("settings:remove", { id });
  },

  resetAll() {
    return ipcRenderer.invoke("settings:reset-all");
  },
});

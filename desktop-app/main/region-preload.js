// region-preload.js — 区域截图遮罩窗口专用 preload
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('region', {
  selected: (rect) => ipcRenderer.invoke('region:selected', rect),
  cancel: () => ipcRenderer.invoke('region:cancel')
});

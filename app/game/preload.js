const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('game', {
  getCoins: () => ipcRenderer.invoke('get-coins'),
  spendCoin: () => ipcRenderer.invoke('spend-coin'),
  getBest: () => ipcRenderer.invoke('get-best'),
  saveBest: (best) => ipcRenderer.send('save-best', best),
  saveScore: (rec) => ipcRenderer.send('save-score', rec),
  getHistory: () => ipcRenderer.invoke('get-history'),
  shareCard: (dataUrl) => ipcRenderer.invoke('share-card', dataUrl),
  result: (r) => ipcRenderer.send('game-result', r),
  close: () => ipcRenderer.send('close-game'),
  onAlarm: (cb) => ipcRenderer.on('alarm', (_e, info) => cb(info)),
});

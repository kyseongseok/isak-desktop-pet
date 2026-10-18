const { contextBridge, ipcRenderer } = require('electron');
const kind = new URLSearchParams(location.search).get('kind') || 'orchard';
contextBridge.exposeInMainWorld('game', {
  kind,
  getWords: () => ipcRenderer.invoke('get-words'),
  getCoins: () => ipcRenderer.invoke('get-coins'),
  spendCoin: () => ipcRenderer.invoke('spend-coin'),
  getBest: () => ipcRenderer.invoke('get-best', kind),
  saveBest: (best) => ipcRenderer.send('save-best', { kind, best }),
  saveScore: (rec) => ipcRenderer.send('save-score', { kind, rec }),
  getHistory: () => ipcRenderer.invoke('get-history', kind),
  shareCard: (dataUrl) => ipcRenderer.invoke('share-card', dataUrl),
  result: (r) => ipcRenderer.send('game-result', { kind, ...r }),
  close: () => ipcRenderer.send('close-game'),
  onAlarm: (cb) => ipcRenderer.on('alarm', (_e, info) => cb(info)),
});

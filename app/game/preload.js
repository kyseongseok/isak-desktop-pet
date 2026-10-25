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
  getName: () => ipcRenderer.invoke('get-name'),
  setName: (name) => ipcRenderer.send('set-name', name),
  result: (r) => ipcRenderer.send('game-result', { kind, ...r }),
  close: () => ipcRenderer.send('close-game'),
  onAlarm: (cb) => ipcRenderer.on('alarm', (_e, info) => cb(info)),
});
// 게임만 모은 앱(app/arcade)의 게임 고르는 화면에서만 씀
contextBridge.exposeInMainWorld('arcade', {
  list: () => ipcRenderer.invoke('arcade-list'),
  open: (kind) => ipcRenderer.send('arcade-open', kind),
});

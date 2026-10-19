const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('isak', {
  getEnv: () => ipcRenderer.invoke('get-env'),
  saveState: (partial) => ipcRenderer.send('save-state', partial),
  setIgnoreMouse: (ignore) => ipcRenderer.send('set-ignore-mouse', ignore),
  hitRects: (rects) => ipcRenderer.send('hit-rects', rects),
  setOnTop: (onTop) => ipcRenderer.send('set-on-top', onTop),
  notify: (title, body) => ipcRenderer.send('notify', { title, body }),
  petDropped: () => ipcRenderer.send('pet-dropped'),
  quit: () => ipcRenderer.send('quit'),
  openGame: (kind) => ipcRenderer.send('open-game', kind),
  coinBonus: (reason) => ipcRenderer.send('coin-bonus', reason),
  getCoins: () => ipcRenderer.invoke('get-coins'),
  alarmStage: (info) => ipcRenderer.send('alarm-stage', info),
  on: (channel, cb) => {
    const ok = ['env', 'moved-display', 'user-return', 'command', 'coin', 'game-result', 'game-closed'];
    if (ok.includes(channel)) ipcRenderer.on(channel, (_e, data) => cb(data));
  },
});

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('isak', {
  getEnv: () => ipcRenderer.invoke('get-env'),
  saveState: (partial) => ipcRenderer.send('save-state', partial),
  setIgnoreMouse: (ignore) => ipcRenderer.send('set-ignore-mouse', ignore),
  setOnTop: (onTop) => ipcRenderer.send('set-on-top', onTop),
  notify: (title, body) => ipcRenderer.send('notify', { title, body }),
  petDropped: () => ipcRenderer.send('pet-dropped'),
  quit: () => ipcRenderer.send('quit'),
  on: (channel, cb) => {
    const ok = ['env', 'moved-display', 'user-return', 'command', 'coin'];
    if (ok.includes(channel)) ipcRenderer.on(channel, (_e, data) => cb(data));
  },
});

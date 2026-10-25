// 이삭이 미니게임 — 데스크톱 펫 없이 게임 5종만 모은 맥용 별도 앱
// 창 하나에 게임 고르는 화면을 띄우고, 고른 게임을 같은 창에 열었다가 닫으면 다시 고르는 화면으로
// 코인 없음(무료), 근무확인 알람 없음. 기록·이름은 이 앱 전용 저장 파일에
const { app, BrowserWindow, Menu, ipcMain, screen, clipboard, nativeImage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const APP_DIR = path.join(__dirname, '..');
const GAMES = {
  orchard: { title: '과수원을 지켜라', dir: 'game' },
  typing: { title: '이삭이 타자게임', dir: 'typing' },
  merge: { title: '이삭이 수확 합치기', dir: 'merge' },
  pang: { title: '이삭이 수확팡', dir: 'pang' },
  runner: { title: '이삭RUN', dir: 'runner' },
};

// 펫 앱과 저장 위치가 섞이지 않게 (개발 중 `electron app/arcade/main.js`로 띄워도)
app.setPath('userData', path.join(app.getPath('appData'), 'IsakGames'));
if (!app.requestSingleInstanceLock()) app.quit();

// ---------- 상태 저장 (userData/arcade.json) ----------
const statePath = () => path.join(app.getPath('userData'), 'arcade.json');
let state = { playerName: '', games: {} };
function loadState() { try { state = { ...state, ...JSON.parse(fs.readFileSync(statePath(), 'utf-8')) }; } catch (e) {} }
function saveState(partial = {}) {
  Object.assign(state, partial);
  try { fs.mkdirSync(path.dirname(statePath()), { recursive: true }); fs.writeFileSync(statePath(), JSON.stringify(state, null, 2)); } catch (e) {}
}
function gameRec(kind) {
  if (!state.games[kind]) state.games[kind] = { best: 0, history: [] };
  return state.games[kind];
}

// ---------- 창 ----------
let win = null;
const showMenu = () => win.loadFile(path.join(__dirname, 'index.html'));
function openGame(kind) {
  if (!GAMES[kind]) return;
  win.loadFile(path.join(APP_DIR, GAMES[kind].dir, 'index.html'), { query: { kind } });
}
function createWindow() {
  const a = screen.getPrimaryDisplay().workArea;
  const H = Math.min(800, a.height - 60), W = Math.round(H * 480 / 800);
  win = new BrowserWindow({
    width: W, height: H, useContentSize: true, resizable: false, maximizable: false, fullscreenable: false,
    title: '이삭이 미니게임', backgroundColor: '#9fd9ff',
    webPreferences: { preload: path.join(APP_DIR, 'game', 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  showMenu();
}

// ---------- 게임이 쓰는 것들 (펫 앱과 같은 이름의 통로) ----------
ipcMain.handle('arcade-list', () => Object.entries(GAMES).map(([kind, g]) => ({ kind, title: g.title, best: gameRec(kind).best })));
ipcMain.on('arcade-open', (_e, kind) => openGame(kind));
ipcMain.on('close-game', () => showMenu());
ipcMain.handle('get-coins', () => ({ coins: 99, cap: 99, daily: 0, free: true }));
ipcMain.handle('spend-coin', () => ({ ok: true, coins: 99, cap: 99, free: true }));
ipcMain.on('game-result', () => {});   // 펫이 없으니 축하 리액션도 없음
ipcMain.handle('get-words', () => {
  const dir = path.join(APP_DIR, 'game', 'words'), out = {};
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.txt') || f === 'README.txt') continue;
    out[f.replace('.txt', '')] = fs.readFileSync(path.join(dir, f), 'utf-8').split(/\r?\n/).map(w => w.trim()).filter(Boolean);
  }
  return out;
});
ipcMain.on('save-best', (_e, { kind, best }) => { const g = gameRec(kind); g.best = Math.max(g.best, best); saveState(); });
ipcMain.handle('get-best', (_e, kind) => gameRec(kind).best);
ipcMain.on('save-score', (_e, { kind, rec }) => { const g = gameRec(kind); g.history = [rec, ...g.history].slice(0, 20); saveState(); });
ipcMain.handle('get-history', (_e, kind) => gameRec(kind).history);
ipcMain.handle('get-name', () => state.playerName || '');
ipcMain.on('set-name', (_e, name) => saveState({ playerName: String(name || '').trim().slice(0, 10) }));
ipcMain.handle('share-card', async (_e, dataUrl) => {
  const img = nativeImage.createFromDataURL(dataUrl);
  clipboard.writeImage(img);
  const d = new Date(), stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const r = await dialog.showSaveDialog(win, {
    title: '점수 카드 저장', defaultPath: path.join(app.getPath('downloads'), `이삭이게임_${stamp}.png`),
    filters: [{ name: 'PNG 이미지', extensions: ['png'] }],
  });
  if (!r.canceled && r.filePath) fs.writeFileSync(r.filePath, img.toPNG());
  return { copied: true, saved: !r.canceled };
});

app.whenReady().then(() => {
  // 이름 칸에서 ⌘C·⌘V가 되려면 편집 메뉴가 있어야 함
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]));
  loadState();
  createWindow();
});
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => app.quit());

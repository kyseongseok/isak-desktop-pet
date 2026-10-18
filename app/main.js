// 이삭이 데스크톱 펫 — 메인 프로세스
// 창 관리(투명 오버레이, 모니터 이동), 트레이 메뉴, 상태 저장, 자리 비움 감지, 알림
const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, screen, powerMonitor, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const { isHoliday } = require('./holidays');

const IDLE_AWAY_SEC = 10 * 60;      // 이만큼 입력이 없으면 자리 비움
const COIN_INTERVAL_MS = 2 * 60 * 60 * 1000;
const COIN_CAP = 3;               // 보유 상한
const COIN_IDLE_SEC = 10 * 60;    // 이만큼 입력이 없으면 코인이 쌓이지 않음

if (!app.requestSingleInstanceLock()) app.quit();

// ---------- 상태 저장 (userData/state.json) ----------
const statePath = () => path.join(app.getPath('userData'), 'state.json');
// '근무일'은 새벽 5시에 바뀜 (자정 넘겨 일해도 같은 날)
const workDate = (t = Date.now()) => new Date(t - 5 * 60 * 60 * 1000).toDateString();
const defaultState = {
  size: 220,
  xRatio: 0.4,                      // 모니터 너비 대비 펫 위치
  displayId: null,
  autoplay: true,
  autostart: true,
  coins: 3,                         // 처음 설치 시 체험용 3개
  coinProgressMs: 0,
  ot: { status: 'none', base: null, date: null },   // 초과근무: 날짜가 바뀌면 초기화
  sound: { theme: 'quiet', volume: 40 },   // 알람 소리: 조용히 / 클럽 / 앰뷸런스 / 경찰차
};
let state = { ...defaultState };
function loadState() {
  try { state = { ...defaultState, ...JSON.parse(fs.readFileSync(statePath(), 'utf-8')) }; } catch (e) {}
  const today = workDate();
  if (state.ot.date !== today) state.ot = { status: 'none', base: null, date: today };
  state.coins = Math.min(COIN_CAP, state.coins);
}
function saveState(partial = {}) {
  Object.assign(state, partial);
  try { fs.writeFileSync(statePath(), JSON.stringify(state, null, 2)); } catch (e) {}
}

// ---------- 창 ----------
let win = null, tray = null;

function currentDisplay() {
  const all = screen.getAllDisplays();
  return all.find(d => d.id === state.displayId) || screen.getPrimaryDisplay();
}
function fitToDisplay(display) {
  state.displayId = display.id;
  const a = display.workArea;          // 작업표시줄을 뺀 영역: 아래 끝이 펫의 바닥
  win.setBounds({ x: a.x, y: a.y, width: a.width, height: a.height });
}

function createWindow() {
  win = new BrowserWindow({
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    focusable: false,
    alwaysOnTop: false,
    title: '이삭이',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  fitToDisplay(currentDisplay());
  win.setMenuBarVisibility(false);
  win.setIgnoreMouseEvents(true, { forward: true });   // 펫 위에 있을 때만 렌더러가 켬
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => { win = null; });

  screen.on('display-removed', () => { if (win) fitToDisplay(currentDisplay()); sendEnv(); });
  screen.on('display-metrics-changed', () => { if (win) fitToDisplay(currentDisplay()); sendEnv(); });
}

function isWorkday(d = new Date()) {
  const day = d.getDay();
  return day >= 1 && day <= 5 && !isHoliday(d);
}
function envForRenderer() {
  const a = currentDisplay().workArea;
  return { width: a.width, height: a.height, isWorkday: isWorkday(), state };
}
function sendEnv() { if (win) win.webContents.send('env', envForRenderer()); }
function send(channel, payload) { if (win) win.webContents.send(channel, payload); }

// ---------- 렌더러와의 통신 ----------
ipcMain.handle('get-env', () => envForRenderer());
ipcMain.on('save-state', (_e, partial) => { saveState(partial); updateTray(); });
ipcMain.on('set-ignore-mouse', (_e, ignore) => { if (win) win.setIgnoreMouseEvents(ignore, { forward: true }); });
ipcMain.on('set-on-top', (_e, onTop) => {
  if (!win) return;
  // 알림·말풍선이 떠 있는 동안만 맨 위로, 평소에는 다른 창 뒤로 내려감
  if (onTop) win.setAlwaysOnTop(true, 'screen-saver'); else win.setAlwaysOnTop(false);
});
ipcMain.on('notify', (_e, { title, body }) => {
  if (Notification.isSupported()) new Notification({ title, body, silent: false }).show();
});
// 펫을 놓았을 때 커서가 다른 모니터에 있으면 그 모니터로 창을 옮김
ipcMain.on('pet-dropped', () => {
  if (!win) return;
  const target = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  if (target.id === state.displayId) return;
  fitToDisplay(target);
  const cursor = screen.getCursorScreenPoint();
  state.xRatio = (cursor.x - target.workArea.x) / target.workArea.width;
  saveState();
  send('moved-display', { ...envForRenderer(), xRatio: state.xRatio });
});
ipcMain.on('quit', () => app.quit());

// ---------- 게임 창: 펫 창은 키보드를 못 받으므로 별도의 보통 창 ----------
let gameWin = null;
function openGame() {
  if (gameWin) { gameWin.focus(); return; }
  const a = currentDisplay().workArea;
  const W = 480, H = 800;
  gameWin = new BrowserWindow({
    width: W, height: H, x: Math.round(a.x + (a.width - W) / 2), y: Math.round(a.y + (a.height - H) / 2),
    resizable: false, maximizable: false, fullscreenable: false, title: '과수원을 지켜라',
    backgroundColor: '#9fd9ff', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'game', 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  gameWin.setMenuBarVisibility(false);
  gameWin.loadFile(path.join(__dirname, 'game', 'index.html'));
  gameWin.on('closed', () => { gameWin = null; send('game-closed'); });
}
ipcMain.on('open-game', openGame);
ipcMain.on('close-game', () => { if (gameWin) gameWin.close(); });
ipcMain.on('game-result', (_e, r) => { send('game-result', r); });      // 결과를 펫에게 전달 (축하 리액션)
ipcMain.on('alarm-stage', (_e, info) => { if (gameWin) gameWin.webContents.send('alarm', info); });   // 알람이 오면 게임 일시정지
ipcMain.on('save-best', (_e, best) => saveState({ gameBest: Math.max(state.gameBest || 0, best) }));
ipcMain.handle('get-best', () => state.gameBest || 0);

// ---------- 자리 비움 감지 ----------
let wasAway = false;
setInterval(() => {
  const idle = powerMonitor.getSystemIdleTime();
  if (idle >= IDLE_AWAY_SEC) wasAway = true;
  else if (wasAway) { wasAway = false; send('user-return', { awaySec: idle }); }
}, 5000);
powerMonitor.on('resume', () => send('user-return', { awaySec: IDLE_AWAY_SEC }));
powerMonitor.on('unlock-screen', () => send('user-return', { awaySec: IDLE_AWAY_SEC }));

// ---------- 날짜가 바뀌면 평일/휴일 정보를 다시 보냄 ----------
let lastDate = workDate();
setInterval(() => {
  const d = workDate();
  if (d !== lastDate) { lastDate = d; sendEnv(); updateTray(); }
}, 60 * 1000);

// ---------- 코인: 실제로 앉아서 일한 시간 2시간마다 1개, 최대 3개 ----------
// 자리 비움(10분 이상 입력 없음) 중에는 쌓이지 않음. 제때 근무확인을 누르면 보너스 +1
function addCoin(reason) {
  if (state.coins >= COIN_CAP) return false;
  state.coins += 1; saveState();
  send('coin', { coins: state.coins, cap: COIN_CAP, reason });
  updateTray();
  return true;
}
ipcMain.on('coin-bonus', () => addCoin('bonus'));
ipcMain.handle('spend-coin', () => {
  if (state.coins <= 0) return { ok: false, coins: 0, cap: COIN_CAP };
  state.coins -= 1; saveState(); updateTray();
  return { ok: true, coins: state.coins, cap: COIN_CAP };
});
ipcMain.handle('get-coins', () => ({ coins: state.coins, cap: COIN_CAP, progressMs: state.coinProgressMs, intervalMs: COIN_INTERVAL_MS }));
setInterval(() => {
  if (state.coins >= COIN_CAP) { state.coinProgressMs = 0; return; }
  if (powerMonitor.getSystemIdleTime() >= COIN_IDLE_SEC) return;      // 자리 비움: 적립 멈춤
  state.coinProgressMs += 60 * 1000;
  if (state.coinProgressMs >= COIN_INTERVAL_MS) {
    state.coinProgressMs -= COIN_INTERVAL_MS;
    addCoin('time');
  }
  saveState();
}, 60 * 1000);

// ---------- 트레이 메뉴 ----------
function trayIcon() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'renderer', 'img', 'idle.png'));
  return icon.resize({ width: 18, height: 18 });
}
function otLabel() {
  const ot = state.ot;
  if (ot.status === 'active' && ot.base) {
    const dl = new Date(ot.base + 60 * 60 * 1000);
    return `초과근무 중 · 다음 마감 ${String(dl.getHours()).padStart(2, '0')}:${String(dl.getMinutes()).padStart(2, '0')}`;
  }
  return { none: '초과근무: 아직 안 물어봄', asked: '초과근무: 답변 대기', excluded: '초과근무: 제외시간 ⏸',
           declined: '오늘은 초과근무 안 함', done: '초과근무 종료' }[ot.status] || '';
}
function updateTray() {
  if (!tray) return;
  const ot = state.ot.status;
  const menu = Menu.buildFromTemplate([
    { label: `🌾 이삭이 · 코인 ${state.coins}/${COIN_CAP}`, enabled: false },
    { label: '🎮 과수원을 지켜라', click: openGame },
    { label: otLabel(), enabled: false },
    { type: 'separator' },
    { label: '초과근무 시작 (지금 물어보기)', visible: ['none', 'asked', 'declined', 'done'].includes(ot), click: () => send('command', { type: 'ask' }) },
    { label: '근무확인 눌렀어요', visible: ot === 'active', click: () => send('command', { type: 'pressed' }) },
    { label: '제외시간 시작', visible: ot === 'active', click: () => send('command', { type: 'exclude' }) },
    { label: '복귀했어요', visible: ot === 'excluded', click: () => send('command', { type: 'resume' }) },
    { label: '초과근무 종료', visible: ['active', 'excluded'].includes(ot), click: () => send('command', { type: 'finish' }) },
    { type: 'separator' },
    { label: '크기', submenu: [
      { label: '작게', click: () => send('command', { type: 'size', value: 140 }) },
      { label: '보통', click: () => send('command', { type: 'size', value: 220 }) },
      { label: '크게', click: () => send('command', { type: 'size', value: 300 }) },
    ] },
    { label: '알람 소리', submenu: [
      ...[['quiet', '🔕 조용히'], ['club', '🪩 클럽'], ['ambulance', '🚑 앰뷸런스'], ['police', '🚓 경찰차']].map(([id, label]) => ({
        label, type: 'radio', checked: state.sound.theme === id,
        click: () => { saveState({ sound: { ...state.sound, theme: id } }); send('command', { type: 'sound', value: { theme: id } }); } })),
      { type: 'separator' },
      ...[[20, '소리 작게'], [40, '소리 보통'], [70, '소리 크게']].map(([v, label]) => ({
        label, type: 'radio', checked: state.sound.volume === v,
        click: () => { saveState({ sound: { ...state.sound, volume: v } }); send('command', { type: 'sound', value: { volume: v } }); } })),
      { type: 'separator' },
      { label: '지금 테스트 (4초)', click: () => send('command', { type: 'siren-test' }) },
    ] },
    { label: '자동 행동 (걷기·딴짓)', type: 'checkbox', checked: state.autoplay,
      click: (item) => { saveState({ autoplay: item.checked }); send('command', { type: 'autoplay', value: item.checked }); } },
    { label: '부팅 시 자동 실행', type: 'checkbox', checked: state.autostart,
      click: (item) => { saveState({ autostart: item.checked }); applyAutostart(); } },
    { type: 'separator' },
    { label: '종료', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
  tray.setToolTip(`이삭이 · ${otLabel()}`);
}
function createTray() {
  tray = new Tray(trayIcon());
  updateTray();
}

function applyAutostart() {
  if (!app.isPackaged) return;    // 개발 중에는 등록하지 않음
  app.setLoginItemSettings({ openAtLogin: state.autostart, args: ['--autostart'] });
}

app.whenReady().then(() => {
  loadState();
  createWindow();
  createTray();
  applyAutostart();
});
app.on('window-all-closed', () => app.quit());
app.on('second-instance', () => { if (win) win.show(); });

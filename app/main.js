// 이삭이 데스크톱 펫 — 메인 프로세스
// 창 관리(투명 오버레이, 모니터 이동), 트레이 메뉴, 상태 저장, 자리 비움 감지, 알림
const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, screen, powerMonitor, Notification, clipboard, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { isHoliday } = require('./holidays');

const IDLE_AWAY_SEC = 10 * 60;      // 이만큼 입력이 없으면 자리 비움
const COIN_CAP = 5;               // 보유 상한 (낮 3개 + 초과근무 보너스 이월)
const COIN_DAILY = 3;             // 매 근무일 시작 때 이만큼은 채워 줌

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
  hourlyEvery: 2,                   // 정시 스트레칭 알림 간격(시간), 0이면 끔
  focusMinutes: 50,                 // 집중 타이머 기본 길이
  focusOnTop: false,                // 집중 중 이삭이를 항상 위에 둘지
  autostart: true,
  coins: 5,                         // 처음 설치 시 체험용 5개
  ot: { status: 'none', base: null, date: null },   // 초과근무: 날짜가 바뀌면 초기화
  sound: { theme: 'quiet', volume: 40 },   // 알람 소리: 조용히 / 클럽 / 앰뷸런스 / 경찰차
};
let state = { ...defaultState };
function loadState() {
  try { state = { ...defaultState, ...JSON.parse(fs.readFileSync(statePath(), 'utf-8')) }; } catch (e) {}
  const today = workDate();
  if (state.ot.date !== today) state.ot = { status: 'none', base: null, date: today };
  if (state.coinDate !== today) { state.coins = Math.max(COIN_DAILY, state.coins); state.coinDate = today; }   // 새 근무일: 3개로 채움
  state.coins = Math.min(COIN_CAP, state.coins);
  if (process.env.ISAK_COINS) { state.coins = Math.min(COIN_CAP, +process.env.ISAK_COINS); saveState(); }   // 개발용: 코인 채우기
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
// 클릭 통과 판정: 렌더러가 보내 준 '마우스를 받을 영역'(펫·말풍선·메뉴)과 커서 위치를 50ms마다 비교
// 윈도우에서는 forward된 mousemove가 끊기는 경우가 있어 렌더러 쪽 판정만으로는 펫이 먹통이 됨
let hitRects = [], lastOver = null;
ipcMain.on('hit-rects', (_e, rects) => { hitRects = rects; });
setInterval(() => {
  if (!win || win.isDestroyed()) return;
  const c = screen.getCursorScreenPoint(), b = win.getBounds();
  const x = c.x - b.x, y = c.y - b.y;
  const over = hitRects.some(r => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
  if (over !== lastOver) { lastOver = over; win.setIgnoreMouseEvents(!over, { forward: true }); }
}, 50);
// 알림·말풍선이 떠 있는 동안만 맨 위로, 평소에는 다른 창 뒤로 내려감
// 전체화면 앱(한글·워드 전체화면 등)이 그 사이 맨 위를 차지하면 밀리므로, 켜져 있는 동안 0.5초마다 다시 끌어올림
let onTopTimer = null;
function raise() { if (!win || win.isDestroyed()) return; win.setAlwaysOnTop(true, 'screen-saver', 1); win.moveTop(); }
// mode: 'alarm' = 전체화면 앱 위로도 계속 끌어올림(근무확인 알람) / true = 한 번만 올림(질문·안내) / false = 내림
ipcMain.on('set-on-top', (_e, mode) => {
  if (!win) return;
  clearInterval(onTopTimer); onTopTimer = null;
  if (mode === 'alarm') { raise(); onTopTimer = setInterval(raise, 500); }
  else if (mode) raise();
  else win.setAlwaysOnTop(false);
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
// 게임 목록: 폴더 이름 = 종류. 기록은 state.games[kind]에 따로 저장
const GAMES = {
  orchard: { title: '과수원을 지켜라', dir: 'game' },
  typing: { title: '이삭이 타자게임', dir: 'typing' },
};
let gameWin = null;
function openGame(kind = 'orchard') {
  if (!GAMES[kind]) kind = 'orchard';
  if (gameWin) { gameWin.focus(); return; }
  const a = currentDisplay().workArea;
  const H = Math.min(800, a.height - 60), W = Math.round(H * 480 / 800);   // 작은 화면·배율 큰 PC에서도 다 보이게
  gameWin = new BrowserWindow({
    width: W, height: H, useContentSize: true, x: Math.round(a.x + (a.width - W) / 2), y: Math.round(a.y + (a.height - H) / 2),
    resizable: false, maximizable: false, fullscreenable: false, title: GAMES[kind].title,
    backgroundColor: '#9fd9ff', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'game', 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  gameWin.setMenuBarVisibility(false);
  gameWin.loadFile(path.join(__dirname, GAMES[kind].dir, 'index.html'), { query: { kind } });
  gameWin.on('closed', () => { gameWin = null; send('game-closed'); });
}
function gameRec(kind) {
  if (!state.games) state.games = {};
  if (!state.games[kind]) state.games[kind] = { best: kind === 'orchard' ? (state.gameBest || 0) : 0, history: kind === 'orchard' ? (state.gameHistory || []) : [] };
  return state.games[kind];
}
ipcMain.on('open-game', (_e, kind) => openGame(kind));
// 단어장: app/game/words/*.txt (한 줄에 하나). 샌드박스 렌더러는 파일을 못 읽으니 여기서 읽어 줌
ipcMain.handle('get-words', () => {
  const dir = path.join(__dirname, 'game', 'words'), out = {};
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.txt') || f === 'README.txt') continue;
    out[f.replace('.txt', '')] = fs.readFileSync(path.join(dir, f), 'utf-8').split(/\r?\n/).map(w => w.trim()).filter(Boolean);
  }
  return out;
});
ipcMain.on('close-game', () => { if (gameWin) gameWin.close(); });
ipcMain.on('game-result', (_e, r) => { send('game-result', r); });      // 결과를 펫에게 전달 (축하 리액션)
ipcMain.on('alarm-stage', (_e, info) => { if (gameWin) gameWin.webContents.send('alarm', info); });   // 알람이 오면 게임 일시정지
ipcMain.on('save-best', (_e, { kind, best }) => { const g = gameRec(kind); g.best = Math.max(g.best, best); saveState(); });
ipcMain.handle('get-best', (_e, kind) => gameRec(kind).best);
// 최근 기록 20개 (점수·스테이지·클리어 여부·날짜)
ipcMain.on('save-score', (_e, { kind, rec }) => { const g = gameRec(kind); g.history = [rec, ...g.history].slice(0, 20); saveState(); });
ipcMain.handle('get-history', (_e, kind) => gameRec(kind).history);
// 점수 인증 카드: 클립보드에 복사하고, 원하면 PNG로 저장
ipcMain.handle('share-card', async (_e, dataUrl) => {
  const img = nativeImage.createFromDataURL(dataUrl);
  clipboard.writeImage(img);
  const d = new Date(), stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const r = await dialog.showSaveDialog(gameWin, {
    title: '점수 카드 저장', defaultPath: path.join(app.getPath('downloads'), `이삭이게임_${stamp}.png`),
    filters: [{ name: 'PNG 이미지', extensions: ['png'] }],
  });
  if (!r.canceled && r.filePath) fs.writeFileSync(r.filePath, img.toPNG());
  return { copied: true, saved: !r.canceled };
});

// ---------- 자리 비움 감지 ----------
let wasAway = false, awayMax = 0;
setInterval(() => {
  const idle = powerMonitor.getSystemIdleTime();
  if (idle >= IDLE_AWAY_SEC) { wasAway = true; awayMax = Math.max(awayMax, idle); }
  else if (wasAway) { wasAway = false; send('user-return', { awaySec: awayMax }); awayMax = 0; }
}, 5000);
powerMonitor.on('resume', () => send('user-return', { awaySec: IDLE_AWAY_SEC }));
powerMonitor.on('unlock-screen', () => send('user-return', { awaySec: IDLE_AWAY_SEC }));

// ---------- 날짜가 바뀌면 평일/휴일 정보를 다시 보냄 ----------
let lastDate = workDate();
setInterval(() => {
  const d = workDate();
  if (d !== lastDate) {
    lastDate = d;
    if (state.coinDate !== d) { state.coins = Math.max(COIN_DAILY, state.coins); state.coinDate = d; saveState(); send('coin', { coins: state.coins, cap: COIN_CAP, reason: 'daily' }); }
    sendEnv(); updateTray();
  }
}, 60 * 1000);

// ---------- 코인: 매 근무일 3개로 채워 주고, 초과근무 중 제때 근무확인마다 +1 (최대 5) ----------
function addCoin(reason) {
  if (state.coins >= COIN_CAP) return false;
  state.coins += 1; saveState();
  send('coin', { coins: state.coins, cap: COIN_CAP, reason });
  updateTray();
  return true;
}
ipcMain.on('coin-bonus', (_e, reason) => addCoin(reason || 'bonus'));
ipcMain.handle('spend-coin', () => {
  if (state.coins <= 0) return { ok: false, coins: 0, cap: COIN_CAP };
  state.coins -= 1; saveState(); updateTray();
  return { ok: true, coins: state.coins, cap: COIN_CAP };
});
ipcMain.handle('get-coins', () => ({ coins: state.coins, cap: COIN_CAP, daily: COIN_DAILY }));

// ---------- 트레이 메뉴 ----------
function trayIcon() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'renderer', 'img', 'idle.png'));
  return icon.resize({ width: 18, height: 18 });
}
function otLabel() {
  const ot = state.ot;
  if (ot.status === 'active' && !ot.base) return '초과근무 대기 · 근무확인 누르면 시작';
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
    { label: '🎮 [미니게임] 과수원을 지켜라', click: () => openGame('orchard') },
    { label: '⌨️ [미니게임] 이삭이 타자게임', click: () => openGame('typing') },
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
      { label: '알람 흐름 테스트 (5·3·1분 전·초과, 1분)', click: () => send('command', { type: 'alarm-test' }) },
    ] },
    { label: '튜토리얼 다시 보기', click: () => send('command', { type: 'tutorial' }) },
    { label: '⏱ 집중 타이머 시작', click: () => send('command', { type: 'focus-start' }) },
    { label: '집중 중 항상 위에 두기', type: 'checkbox', checked: !!state.focusOnTop,
      click: (item) => { saveState({ focusOnTop: item.checked }); send('command', { type: 'focus-ontop', value: item.checked }); } },
    { label: '정시 스트레칭 알림', submenu: [[0, '끔'], [1, '1시간마다'], [2, '2시간마다'], [3, '3시간마다']].map(([n, label]) => ({
      label, type: 'radio', checked: (state.hourlyEvery ?? 2) === n,
      click: () => { saveState({ hourlyEvery: n }); send('command', { type: 'hourly', value: n }); } })) },
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
  if (process.platform === 'win32') app.setAppUserModelId('kr.go.rda.isak-pet');   // 윈도우 토스트 알림에 필요
  loadState();
  createWindow();
  createTray();
  applyAutostart();
  if (process.env.ISAK_OPEN_GAME) setTimeout(() => openGame(process.env.ISAK_OPEN_GAME), 1500);   // 개발용: 게임 창 바로 열기 (orchard|typing)
  if (process.env.ISAK_TEST_ALARM) setTimeout(() => send('command', { type: 'alarm-test' }), 4000);   // 개발용: 알람 흐름 자동 테스트
});
app.on('window-all-closed', () => app.quit());
app.on('second-instance', () => { if (win) win.show(); });

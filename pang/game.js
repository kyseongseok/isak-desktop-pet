// 이삭이 수확팡 — 같은 작물 3개를 한 줄로 맞춰 수확하는 3매치 퍼즐 (애니팡 방식)
// 60초 시간제, 연달아 맞추면 콤보, 4개·ㄱT자·5개로 트랙터·비료·황금 이삭 아이템
'use strict';

// Electron 밖(브라우저 미리보기)에서 열면 가짜 브리지로 동작
const bridge = window.game || {
  kind: 'pang',
  getCoins: async () => ({ coins: 3, cap: 5, daily: 3 }),
  spendCoin: async () => ({ ok: true, coins: 2, cap: 5 }),
  getBest: async () => 0, saveBest() {}, result() {}, close() { location.reload(); }, onAlarm() {},
  saveScore() {}, getHistory: async () => [],
  async shareCard(dataUrl) { const a = document.createElement('a'); a.href = dataUrl; a.download = 'score.png'; a.click(); return { copied: false, saved: true }; },
};

const W = 480, H = 800;
const N = 7, C = 62, BX = (W - N * C) / 2, BY = 212;   // 7×7 밭
const TIME = 60, COMBO_GAP = 2, HINT_AFTER = 5;
const MOVE = 620, GRAV = 3200, CLEAR_SEC = 0.2;          // 바꾸기 속도(px/s), 떨어지는 가속도, 터지는 시간
const BOMB_R = 2;                                        // 비료: 주변 5×5
// 시간 보너스: 아이템이 터지면(트랙터·비료 +2초, 황금 이삭 +4초), 10콤보마다 +2초
// 한 판에 더해지는 시간 상한: 지금은 테스트로 없앰 (다시 막으려면 숫자로, 예: 30)
const TIME_BONUS = { row: 2, col: 2, bomb: 2, drone: 2, gold: 4 }, COMBO_TIME = 2, TIME_BONUS_MAX = Infinity;

// ---------- 작물 ----------
// img: app/pang/img/<key>.png 가 있으면 그걸 쓰고, 없으면 fallback 그림, 그것도 없으면 직접 그림
const CROPS = [
  { key: 'apple',      name: '사과', color: '#e0413a', fallback: '../game/img/apple.png' },
  { key: 'pear',       name: '배',   color: '#e6c56a', fallback: '../game/img/pear.png' },
  { key: 'persimmon',  name: '감',   color: '#f08a24', fallback: '../game/img/persimmon.png' },
  { key: 'watermelon', name: '수박', color: '#2f9e44' },
  { key: 'grape',      name: '포도', color: '#8e4fc1' },
  { key: 'radish',     name: '무',   color: '#f4f1ea' },
];
const GOLD = -1;   // 황금 이삭은 어떤 작물과도 줄이 안 맞음
const ITEM = { row: '트랙터', col: '트랙터', bomb: '비료', drone: '드론', gold: '황금 이삭' };

// ---------- 이미지 ----------
const IMG = {};
function loadImg(name, src, fallback) {
  const i = new Image();
  i.onerror = () => { if (fallback && !i.dataset.fb) { i.dataset.fb = 1; i.src = fallback; } else IMG[name] = null; };
  i.src = src; IMG[name] = i;
}
['bg', 'isak_basket', 'isak_happy', 'isak_shout', 'isak_win', 'isak_over'].forEach(n => loadImg(n, `../game/img/${n}.png`));
CROPS.forEach(t => loadImg(t.key, `img/${t.key}.png`, t.fallback));
loadImg('golden', 'img/golden.png', '../game/img/item_golden_ear.png');
['item_tractor', 'item_fertilizer', 'item_drone'].forEach(n => loadImg(n, `img/${n}.png`));
// 아이템 그림 (없으면 이모지)
const ITEM_ICON = { row: ['item_tractor', '🚜'], col: ['item_tractor', '🚜'], bomb: ['item_fertilizer', '💥'], drone: ['item_drone', '🚁'] };
const ready = (im) => im && im.complete && im.naturalWidth;

// ---------- 소리 ----------
const sfx = (() => {
  let ctx = null, master = null, muted = false;
  const get = () => { if (!ctx) { ctx = new AudioContext(); master = ctx.createGain(); master.gain.value = 0.25; master.connect(ctx.destination); } if (ctx.state === 'suspended') ctx.resume(); return ctx; };
  function tone(f, dur, type = 'square', gain = 0.3, slide = 0, delay = 0) {
    if (muted) return;
    const c = get(), o = c.createOscillator(), g = c.createGain(), t = c.currentTime + delay;
    o.type = type; o.frequency.setValueAtTime(f, t); if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, f + slide), t + dur);
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
  }
  return {
    swap() { tone(520, 0.05, 'triangle', 0.15, 120); },
    fail() { tone(220, 0.08, 'square', 0.15, -60); tone(200, 0.08, 'square', 0.15, -60, 0.09); },
    pop(combo) { const f = 440 * Math.pow(1.06, Math.min(combo, 24)); tone(f, 0.09, 'square', 0.2, f * 0.6); },
    drone() { tone(180, 0.35, 'sawtooth', 0.12, 40); tone(186, 0.35, 'sawtooth', 0.12, 40); },
    made() { [660, 880, 1100].forEach((f, i) => tone(f, 0.08, 'square', 0.2, 0, i * 0.06)); },
    tractor() { tone(90, 0.35, 'sawtooth', 0.25, 60); tone(140, 0.3, 'square', 0.12, -40, 0.05); },
    bomb() { tone(120, 0.3, 'sawtooth', 0.32, -80); tone(60, 0.35, 'triangle', 0.35, -20); },
    gold() { [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => tone(f, 0.14, 'square', 0.25, 0, i * 0.06)); },
    time() { tone(988, 0.06, 'square', 0.18); tone(1319, 0.1, 'square', 0.18, 0, 0.06); },
    tick() { tone(1200, 0.03, 'square', 0.12); },
    timeup() { tone(880, 0.5, 'square', 0.25); },
    start() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.12, 'square', 0.25, 0, i * 0.09)); },
    over() { [392, 330, 262, 196].forEach((f, i) => tone(f, 0.25, 'triangle', 0.3, 0, i * 0.18)); },
    toggle() { muted = !muted; return muted; },
  };
})();
const bgm = (() => {
  let audio = null, on = true;
  for (const f of ['../game/music/bgm.m4a', '../game/music/bgm.ogg', '../game/music/bgm.mp3']) {
    if (audio) break;
    const a = new Audio(f); a.loop = true; a.volume = 0.18; a.addEventListener('error', () => {}, { once: true }); audio = a;
  }
  return {
    play() { if (audio && on) audio.play().catch(() => {}); },
    stop() { if (audio) { audio.pause(); audio.currentTime = 0; } },
    pause() { if (audio) audio.pause(); },
    toggle() { on = !on; if (!on) audio && audio.pause(); else if (S.screen === 'play') this.play(); return on; },
  };
})();

// ---------- 상태 ----------

// 무대 맞추기: 창이 480×800보다 작거나 비율이 다르면 축소해서 가운데 배치
(function fitStage() {
  const st = document.getElementById('stage');
  const apply = () => { const s = Math.min(innerWidth / 480, innerHeight / 800); st.style.transform = `translate(${Math.round((innerWidth - 480 * s) / 2)}px, ${Math.round((innerHeight - 800 * s) / 2)}px) scale(${s})`; };
  apply(); addEventListener('resize', apply);
})();
const canvas = document.getElementById('c'), ctx = canvas.getContext('2d');
const dpr = Math.min(2, devicePixelRatio || 1);
canvas.width = W * dpr; canvas.height = H * dpr; ctx.scale(dpr, dpr);
const $ = (id) => document.getElementById(id);

const S = {
  screen: 'intro', paused: false,
  t: 0, time: TIME, score: 0, grid: [], phase: 'idle',
  combo: 0, maxCombo: 0, lastMatch: -99, fx: [], toasts: [],
  sel: null, drag: null, swapping: null, pending: [], clearT: 0,
  idle: 0, hint: null, timeUp: false, bonusT: 0, bonusScore: 0, timeAdded: 0,
  harvested: 0, made: 0, used: 0, goldens: 0,
  say: null, mood: null, best: 0, coins: 0, cap: 3,
};
let nextId = 1;
function show(id) { document.querySelectorAll('.screen').forEach(e => e.classList.toggle('on', e.id === id)); }
const rnd = (a, b) => a + Math.random() * (b - a);
const cx = (c) => BX + c * C + C / 2, cy = (r) => BY + r * C + C / 2;
const key = (r, c) => r * N + c;
const at = (k) => S.grid[Math.floor(k / N)][k % N];
function toast(text, color = '#fffbe6') { S.toasts.push({ text, color, t: 0 }); if (S.toasts.length > 3) S.toasts.shift(); }
function say(text, sec = 1.6, mood = 'isak_happy') { S.say = { text, until: S.t + sec }; S.mood = { sprite: mood, until: S.t + sec }; }
function newTile(t, r, c, y = cy(r)) { return { id: nextId++, t, sp: null, x: cx(c), y, vy: 0, pop: 0, land: 0, dying: 0, used: false }; }

// ---------- 판 ----------
function makeBoard() {
  for (let tries = 0; tries < 50; tries++) {
    S.grid = [];
    for (let r = 0; r < N; r++) {
      S.grid.push([]);
      for (let c = 0; c < N; c++) {
        let t;
        do t = Math.floor(Math.random() * CROPS.length);
        while ((c >= 2 && S.grid[r][c - 1].t === t && S.grid[r][c - 2].t === t) || (r >= 2 && S.grid[r - 1][c].t === t && S.grid[r - 2][c].t === t) ||
               (r >= 1 && c >= 1 && S.grid[r - 1][c].t === t && S.grid[r][c - 1].t === t && S.grid[r - 1][c - 1].t === t));   // 줄 3개·네모 4개 없이 시작
        S.grid[r].push(newTile(t, r, c, cy(r) - (N + 1) * C));   // 시작할 때 위에서 우수수
      }
    }
    if (findMove()) return;
  }
}
// 가로·세로로 같은 작물 3개 이상 이어진 줄
function findRuns() {
  const out = [];
  const typeAt = (r, c) => { const t = S.grid[r][c]; return t && !t.dying && t.t !== GOLD ? t.t : null; };
  for (const dir of ['h', 'v']) {
    for (let i = 0; i < N; i++) {
      let j = 0;
      while (j < N) {
        const get = (k) => dir === 'h' ? typeAt(i, k) : typeAt(k, i);
        const t = get(j); let e = j + 1;
        if (t !== null) while (e < N && get(e) === t) e++;
        if (t !== null && e - j >= 3) {
          const cells = []; for (let k = j; k < e; k++) cells.push(dir === 'h' ? [i, k] : [k, i]);
          out.push({ dir, t, cells });
        }
        j = e;
      }
    }
  }
  // 네모 4개 (2×2)
  for (let r = 0; r < N - 1; r++) for (let c = 0; c < N - 1; c++) {
    const t = typeAt(r, c);
    if (t !== null && typeAt(r, c + 1) === t && typeAt(r + 1, c) === t && typeAt(r + 1, c + 1) === t)
      out.push({ dir: 'sq', t, cells: [[r, c], [r, c + 1], [r + 1, c], [r + 1, c + 1]] });
  }
  return out;
}
function swapGrid(a, b) { const t = S.grid[a[0]][a[1]]; S.grid[a[0]][a[1]] = S.grid[b[0]][b[1]]; S.grid[b[0]][b[1]] = t; }
// 둘 수 있는 수: 바꿔서 줄이 생기는 자리 → 없으면 누르기만 해도 터지는 아이템
function findMove() {
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    for (const [dr, dc] of [[0, 1], [1, 0]]) {
      const r2 = r + dr, c2 = c + dc; if (r2 >= N || c2 >= N) continue;
      const a = S.grid[r][c], b = S.grid[r2][c2];
      if (a.sp === 'gold' || b.sp === 'gold' || (a.sp && b.sp)) return [[r, c], [r2, c2]];
      swapGrid([r, c], [r2, c2]); const ok = findRuns().length > 0; swapGrid([r, c], [r2, c2]);
      if (ok) return [[r, c], [r2, c2]];
    }
  }
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (S.grid[r][c].sp) return [[r, c]];
  return null;
}
function shuffle() {
  const tiles = S.grid.flat();
  for (let tries = 0; tries < 100; tries++) {
    for (let i = tiles.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [tiles[i], tiles[j]] = [tiles[j], tiles[i]]; }
    tiles.forEach((t, i) => { S.grid[Math.floor(i / N)][i % N] = t; });
    if (!findRuns().length && findMove()) break;
    if (tries === 99) { makeBoard(); return; }
  }
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) { const t = S.grid[r][c]; t.x = cx(c); t.y = cy(r); t.pop = 1; }
  toast('판을 섞을게요!');
}

// ---------- 화면 전환 ----------
async function refreshIntro() {
  const c = await bridge.getCoins(); S.coins = c.coins; S.cap = c.cap;
  S.best = await bridge.getBest();
  $('introCoins').textContent = coinText(c);
  $('introBest').textContent = S.best ? `BEST ${S.best.toLocaleString()}` : 'BEST —';
  const hist = await bridge.getHistory();
  const top = [...hist].sort((a, b) => b.score - a.score).slice(0, 3);
  $('introRanks').textContent = top.length ? 'TOP 3 · ' + top.map(h => h.score.toLocaleString()).join(' · ') : '';
  $('pressStart').textContent = S.coins > 0 ? 'PRESS SPACE' : '코인이 없어요';
  $('pressStart').classList.toggle('blink', S.coins > 0);
}
async function startGame() {
  const r = await bridge.spendCoin();
  if (!r.ok) { refreshIntro(); return; }
  S.coins = r.coins;
  Object.assign(S, { t: 0, time: TIME, score: 0, phase: 'fall', combo: 0, maxCombo: 0, lastMatch: -99, fx: [], toasts: [],
    sel: null, drag: null, swapping: null, pending: [], idle: 0, hint: null, timeUp: false, bonusT: 0, bonusScore: 0, timeAdded: 0,
    harvested: 0, made: 0, used: 0, goldens: 0, say: null, mood: null, paused: false });
  makeBoard();
  S.screen = 'play'; show(''); sfx.start(); bgm.play();
  say('같은 작물 3개를 맞춰요!', 2.5);
}
// ---------- 게임 방법: 처음 시작할 때 한 번, 인트로의 ❓ 버튼으로 다시 보기 ----------
// 본 적 있는지는 이 게임 창의 localStorage에만 기억 (못 읽으면 그냥 다시 보여줌)
const HOWTO_KEY = 'pang.howtoSeen';
const howtoSeen = () => { try { return localStorage.getItem(HOWTO_KEY) === '1'; } catch { return false; } };
const pages = [...document.querySelectorAll('#howto .page')];
let howtoPage = 0, howtoThenStart = false;
function openHowto(thenStart) {
  S.screen = 'howto'; howtoThenStart = thenStart; howtoPage = 0; renderHowto(); show('howto');
}
function renderHowto() {
  pages.forEach((p, i) => p.classList.toggle('on', i === howtoPage));
  $('dots').innerHTML = pages.map((_, i) => `<span class="${i === howtoPage ? 'cur' : ''}">●</span>`).join('');
  const lastPage = howtoPage === pages.length - 1;
  $('nextBtn').textContent = lastPage ? (howtoThenStart ? '시작하기' : '닫기') : '다음';
  $('skipBtn').textContent = howtoThenStart ? '건너뛰고 시작' : '닫기';
}
function closeHowto() {
  try { localStorage.setItem(HOWTO_KEY, '1'); } catch {}
  if (howtoThenStart) startGame();
  else { S.screen = 'intro'; show('intro'); }
}
function howtoNext() { if (howtoPage < pages.length - 1) { howtoPage++; renderHowto(); } else closeHowto(); }
// 인트로에서 시작: 처음이면 게임 방법부터
function requestStart() {
  if (!howtoSeen() && S.coins > 0) openHowto(true); else startGame();
}

function endGame() {
  if (S.screen !== 'play') return;
  S.screen = 'result'; show('result'); bgm.stop();
  const isBest = S.score > S.best;
  if (isBest) { S.best = S.score; bridge.saveBest(S.score); }
  $('resultTitle').textContent = 'TIME UP';
  $('resultScore').textContent = S.score.toLocaleString();
  $('resultBest').textContent = isBest ? '🏆 최고 기록 갱신!' : `BEST ${S.best.toLocaleString()}`;
  $('resultStats').innerHTML = `<span>수확한 작물 <b>${S.harvested}개</b></span><span>최대 콤보 <b>${S.maxCombo}</b></span>` +
    `<span>만든 아이템 <b>${S.made}개</b></span><span>황금 이삭 <b>${S.goldens}개</b></span>` +
    `<span>막판 보너스 <b>${S.bonusScore.toLocaleString()}</b></span><span>보너스 시간 <b>+${S.timeAdded}초</b></span>`;
  bridge.saveScore({ score: S.score, cleared: false, harvested: S.harvested, maxCombo: S.maxCombo, made: S.made, date: new Date().toISOString() });
  bridge.getCoins().then(c => { S.coins = c.coins; S.cap = c.cap; $('retryBtn').textContent = retryText(c); $('retryBtn').disabled = S.coins <= 0; });
  $('shareBtn').textContent = '📸 점수 카드 복사·저장';
  sfx.over();
  bridge.result({ score: S.score, best: isBest, cleared: false });
}
function pause(reason) {
  if (S.screen !== 'play') return;
  S.paused = true; bgm.pause(); S.drag = null;
  $('pauseTitle').textContent = reason ? '⏰ 근무확인!' : '일시정지';
  $('pauseText').innerHTML = reason ? `${reason}<br>이삭이를 확인하고 돌아오세요` : 'ESC로 계속';
  show('pause');
}
function resume() { if (S.screen === 'play') { S.paused = false; show(''); bgm.play(); } }

// ---------- 바꾸기 ----------
const canAct = () => S.screen === 'play' && !S.paused && S.phase === 'idle' && !S.timeUp;
function trySwap(a, b) {
  if (!canAct()) return;
  S.sel = null; S.idle = 0; S.hint = null;
  swapGrid(a, b); S.swapping = { a, b }; S.phase = 'swap'; sfx.swap();
}
function afterSwap() {
  const { a, b } = S.swapping, ta = S.grid[a[0]][a[1]], tb = S.grid[b[0]][b[1]];
  // 황금 이삭이 끼거나 아이템끼리 바꾸면 줄이 없어도 바로 터짐
  if (ta.sp === 'gold' || tb.sp === 'gold' || (ta.sp && tb.sp)) { itemCombo(a, b); return; }
  const runs = findRuns();
  if (!runs.length) { swapGrid(a, b); S.phase = 'unswap'; sfx.fail(); return; }
  resolve(runs, [b, a]);   // 끌어 옮긴 작물 자리에 아이템이 생기게
}
// 아이템을 그냥 클릭
function tapItem(r, c) {
  if (!canAct()) return;
  S.sel = null; S.idle = 0; S.hint = null;
  startClear(expand([key(r, c)]), []);
}

// ---------- 수확 ----------
// 맞은 줄들 → 수확할 칸 + 새로 생길 아이템
// 아이템 우선순위: 5개 줄 황금 이삭 > ㄱ·T자 비료 > 4개 줄 트랙터 > 네모 드론
function resolve(runs, prefer) {
  // 칸을 공유하는 줄끼리 한 묶음 (ㄱ·T자, 줄에 붙은 네모)
  const groups = [];
  for (const run of runs) {
    const hit = groups.filter(g => g.runs.some(o => o.cells.some(p => run.cells.some(q => p[0] === q[0] && p[1] === q[1]))));
    const g = { runs: [run] };
    for (const h of hit) { g.runs.push(...h.runs); groups.splice(groups.indexOf(h), 1); }
    groups.push(g);
  }
  const seed = new Set(), specials = [];
  for (const g of groups) {
    const cells = new Map();
    for (const run of g.runs) for (const [r, c] of run.cells) { const k = key(r, c); seed.add(k); cells.set(k, (cells.get(k) || 0) + 1); }
    const lines = g.runs.filter(x => x.dir !== 'sq'), square = g.runs.find(x => x.dir === 'sq');
    const longest = lines.length ? lines.reduce((m, run) => run.cells.length > m.cells.length ? run : m) : null;
    const len = longest ? longest.cells.length : 0;
    const cross = lines.some(x => x.dir === 'h') && lines.some(x => x.dir === 'v');
    const sp = len >= 5 ? 'gold' : cross ? 'bomb' : len === 4 ? (longest.dir === 'h' ? 'row' : 'col') : square ? 'drone' : null;
    if (!sp) continue;
    const mine = prefer.find(p => cells.has(key(p[0], p[1])));
    let pos = mine ? key(mine[0], mine[1]) : null;
    if (pos === null && sp === 'bomb') pos = [...cells].find(([, n]) => n > 1)[0];
    if (pos === null) { const base = sp === 'drone' ? square : longest, m = base.cells[Math.floor(base.cells.length / 2)]; pos = key(m[0], m[1]); }
    specials.push({ k: pos, t: sp === 'gold' ? GOLD : (longest || square).t, sp });
  }
  startClear(expand([...seed]), specials);
}
// 수확할 칸 중 아이템이 있으면 그 효과까지 이어서 퍼뜨림
function expand(seed) {
  const set = new Set(seed), queue = [...seed];
  const add = (r, c) => { if (r < 0 || c < 0 || r >= N || c >= N) return; const k = key(r, c); if (!set.has(k)) { set.add(k); queue.push(k); } };
  while (queue.length) {
    const k = queue.shift(), t = at(k), r = Math.floor(k / N), c = k % N;
    if (!t || !t.sp || t.used) continue;
    t.used = true; S.used++; S.score += 20; addTime(TIME_BONUS[t.sp], t.x, t.y);
    if (t.sp === 'row' || t.sp === 'col') {
      for (let i = 0; i < N; i++) t.sp === 'row' ? add(r, i) : add(i, c);
      S.fx.push({ kind: 'sweep', dir: t.sp, r, c, t: 0, life: 0.45 }); sfx.tractor();
    } else if (t.sp === 'bomb') {
      for (let i = -BOMB_R; i <= BOMB_R; i++) for (let j = -BOMB_R; j <= BOMB_R; j++) add(r + i, c + j);
      S.fx.push({ kind: 'ring', x: cx(c), y: cy(r), R: C * (BOMB_R + 0.5), t: 0, life: 0.4 }); sfx.bomb();
    } else if (t.sp === 'gold') {   // 다른 아이템에 맞으면: 판에 가장 많은 작물을 전부
      const count = new Array(CROPS.length).fill(0);
      for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) { const o = S.grid[i][j]; if (o && o.t !== GOLD && !set.has(key(i, j))) count[o.t]++; }
      goldBeams(r, c, count.indexOf(Math.max(...count)), add);
    } else if (t.sp === 'drone') {   // 드론: 판 여기저기 세 곳으로 날아가 + 모양으로 수확
      for (const [tr, tc] of droneTargets(3, set)) { dronePlus(tr, tc, add); droneFx(r, c, tr, tc); }
      sfx.drone();
    }
  }
  return set;
}
// 드론이 갈 곳: 아직 수확 안 할 칸 중 무작위
function droneTargets(n, exclude) {
  const pool = [];
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) if (S.grid[i][j] && !S.grid[i][j].dying && !exclude.has(key(i, j))) pool.push([i, j]);
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  return pool.slice(0, n);
}
function dronePlus(r, c, add) { add(r, c); for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) add(r + dr, c + dc); }
function droneFx(r, c, tr, tc) { S.fx.push({ kind: 'drone', x1: cx(c), y1: cy(r), x2: cx(tc), y2: cy(tr), t: 0, life: 0.45 }); }
function goldBeams(r, c, type, add) {
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const o = S.grid[i][j];
    if (o && o.t === type) { add(i, j); S.fx.push({ kind: 'beam', x1: cx(c), y1: cy(r), x2: cx(j), y2: cy(i), t: 0, life: 0.45 }); }
  }
  sfx.gold();
}
// 아이템끼리(또는 황금 이삭과) 바꿨을 때
function itemCombo(a, b) {
  const ta = S.grid[a[0]][a[1]], tb = S.grid[b[0]][b[1]];
  const seed = new Set([key(...a), key(...b)]);
  const add = (r, c) => { if (r >= 0 && c >= 0 && r < N && c < N) seed.add(key(r, c)); };
  const [r, c] = b;
  if (ta.sp === 'gold' && tb.sp === 'gold') {          // 황금 이삭 둘: 판 전체
    ta.used = tb.used = true; addTime(TIME_BONUS.gold * 2, cx(c), cy(r));
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) add(i, j);
    S.fx.push({ kind: 'flash', t: 0, life: 0.5 }); sfx.gold();
    toast('대풍년!!', '#ffd93c');
  } else if (ta.sp === 'gold' || tb.sp === 'gold') {
    const [g, gp, o] = ta.sp === 'gold' ? [ta, a, tb] : [tb, b, ta];
    g.used = true; S.used++; addTime(TIME_BONUS.gold, g.x, g.y);
    if (o.sp) {   // 황금 이삭 + 아이템: 그 작물이 전부 같은 아이템으로 변해서 터짐
      for (const row of S.grid) for (const x of row) if (x.t === o.t && !x.sp) x.sp = o.sp === 'row' || o.sp === 'col' ? (Math.random() < 0.5 ? 'row' : 'col') : o.sp;
      toast(`${CROPS[o.t].name}이 전부 ${ITEM[o.sp]}로!`, '#ffd93c');
    }
    goldBeams(gp[0], gp[1], o.t, add);
  } else {
    ta.used = tb.used = true; S.used += 2; S.score += 40; addTime(TIME_BONUS[ta.sp] + TIME_BONUS[tb.sp], cx(c), cy(r));
    const kinds = [ta.sp, tb.sp].map(s => s === 'bomb' ? 'bomb' : s === 'drone' ? 'drone' : 'line');
    if (kinds.includes('drone')) {   // 드론 + 아이템: 그 아이템을 실어 세 곳에 떨어뜨림 (드론 둘이면 여섯 곳을 + 모양으로)
      const other = kinds[0] === 'drone' ? tb : ta, both = kinds[0] === 'drone' && kinds[1] === 'drone';
      for (const [tr, tc] of droneTargets(both ? 6 : 3, seed)) {
        if (both) dronePlus(tr, tc, add);
        else { const x = S.grid[tr][tc]; x.sp = other.sp === 'bomb' ? 'bomb' : (Math.random() < 0.5 ? 'row' : 'col'); x.used = false; add(tr, tc); }
        droneFx(r, c, tr, tc);
      }
      sfx.drone();
    } else if (kinds[0] === 'line' && kinds[1] === 'line') {   // 트랙터 둘: 십자
      for (let i = 0; i < N; i++) { add(r, i); add(i, c); }
      S.fx.push({ kind: 'sweep', dir: 'row', r, c, t: 0, life: 0.45 }, { kind: 'sweep', dir: 'col', r, c, t: 0, life: 0.45 }); sfx.tractor();
    } else if (kinds[0] === 'bomb' && kinds[1] === 'bomb') {   // 비료 둘: 7×7
      for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) add(r + i, c + j);
      S.fx.push({ kind: 'ring', x: cx(c), y: cy(r), R: C * 3.5, t: 0, life: 0.5 }); sfx.bomb();
    } else {   // 트랙터 + 비료: 굵은 십자 (3줄씩)
      for (let d = -1; d <= 1; d++) for (let i = 0; i < N; i++) { add(r + d, i); add(i, c + d); }
      for (let d = -1; d <= 1; d++) S.fx.push({ kind: 'sweep', dir: 'row', r: r + d, c, t: 0, life: 0.45 }, { kind: 'sweep', dir: 'col', r, c: c + d, t: 0, life: 0.45 });
      sfx.tractor(); sfx.bomb();
    }
  }
  startClear(expand([...seed]), []);
}
// 남은 시간 늘리기 (시간이 끝난 뒤 막판 보너스 중에는 안 늘어남)
function addTime(sec, x, y) {
  sec = Math.min(sec, TIME_BONUS_MAX - S.timeAdded);
  if (S.timeUp || sec <= 0) return;
  S.time += sec; S.timeAdded += sec; S.timeFlash = 1;
  popText(x, y - 26, `+${sec}초`, '#9ff07a', 20);
  sfx.time();
}
function burst(x, y, color, n = 8, speed = 160) {
  for (let i = 0; i < n; i++) { const a = rnd(0, 6.28), s = rnd(speed * 0.4, speed); S.fx.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 60, color, size: rnd(4, 8), t: 0, life: rnd(0.35, 0.6) }); }
}
function popText(x, y, text, color = '#ffd93c', size = 18) { S.fx.push({ x, y, text, color, size, t: 0, life: 0.9 }); }
function startClear(set, specials) {
  // 콤보: 마지막으로 판이 멈춘 뒤 COMBO_GAP초 안에 또 맞추면 이어짐 (떨어져서 저절로 맞은 것도)
  S.combo = S.t - S.lastMatch <= COMBO_GAP ? S.combo + 1 : 1;
  S.lastMatch = S.t; S.maxCombo = Math.max(S.maxCombo, S.combo);
  if (S.combo % 10 === 0) addTime(COMBO_TIME, W / 2, BY + 20);
  const mult = 1 + Math.min(S.combo - 1, 20) * 0.1;
  let n = 0, sx = 0, sy = 0;
  for (const k of set) {
    const t = at(k); if (!t || t.dying) continue;
    t.dying = 0.001; n++; sx += t.x; sy += t.y;
    burst(t.x, t.y, t.t === GOLD ? '#ffd93c' : CROPS[t.t].color, 5);
  }
  S.harvested += n;
  const gain = Math.round(n * 10 * mult);
  S.score += gain; if (S.timeUp) S.bonusScore += gain;
  if (n) popText(sx / n, sy / n - 10, `+${gain}`);
  sfx.pop(S.combo);
  if ([5, 10, 15, 20, 30].includes(S.combo)) say(`${S.combo} 콤보! ${S.combo >= 15 ? '대단해요!!' : S.combo >= 10 ? '멈추지 마요!' : '신나요!'}`, 1.4);
  S.pending = specials; S.phase = 'clear'; S.clearT = 0;
}
function finishClear() {
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (S.grid[r][c] && S.grid[r][c].dying) S.grid[r][c] = null;
  for (const p of S.pending) {
    const r = Math.floor(p.k / N), c = p.k % N, t = newTile(p.t, r, c);
    t.sp = p.sp; t.pop = 1; S.grid[r][c] = t; S.made++;
    if (p.sp === 'gold') S.goldens++;
    burst(t.x, t.y, '#fffbe6', 12, 200);
    say({ row: '트랙터 출동 준비!', col: '트랙터 출동 준비!', bomb: '비료 한 포대!', drone: '드론 띄울 준비!', gold: '황금 이삭이다!!' }[p.sp], 1.6, p.sp === 'gold' ? 'isak_win' : 'isak_happy');
  }
  if (S.pending.length) sfx.made();
  S.pending = [];
  // 아래로 채우고 위에서 새 작물
  for (let c = 0; c < N; c++) {
    let w = N - 1;
    for (let r = N - 1; r >= 0; r--) { const t = S.grid[r][c]; if (t) { S.grid[r][c] = null; S.grid[w][c] = t; w--; } }
    for (let r = w; r >= 0; r--) S.grid[r][c] = newTile(Math.floor(Math.random() * CROPS.length), r, c, cy(r) - (w + 1) * C - 8);
  }
  S.phase = 'fall';
}
// 판이 멈추면: 또 맞은 줄이 있으면 연쇄, 없으면 다음 수를 기다림
function settled() {
  const runs = findRuns();
  if (runs.length) { resolve(runs, []); return; }
  S.phase = 'idle'; S.lastMatch = S.combo ? S.t : S.lastMatch; S.idle = 0; S.hint = null;
  if (!S.timeUp && !findMove()) shuffle();
}

// ---------- 입력 ----------
// 마우스: 끌어서 바꾸기, 또는 하나 누르고 옆 칸 누르기. 아이템은 클릭만 해도 터짐
$('howtoBtn').addEventListener('pointerup', () => { if (S.screen === 'intro') openHowto(false); });
$('nextBtn').onclick = howtoNext;
$('skipBtn').onclick = closeHowto;
function cellAt(e) {
  const b = canvas.getBoundingClientRect(), x = (e.clientX - b.left) * W / b.width, y = (e.clientY - b.top) * H / b.height;
  const c = Math.floor((x - BX) / C), r = Math.floor((y - BY) / C);
  return { r, c, x, y, in: r >= 0 && c >= 0 && r < N && c < N };
}
canvas.addEventListener('pointerdown', (e) => {
  if (!canAct()) return;
  const p = cellAt(e); if (!p.in) { S.sel = null; return; }
  S.drag = p; S.idle = 0;
});
addEventListener('pointermove', (e) => {
  const d = S.drag; if (!d || !canAct()) return;
  const p = cellAt(e), dx = p.x - d.x, dy = p.y - d.y;
  if (Math.hypot(dx, dy) < C * 0.35) return;
  S.drag = null;
  const [r2, c2] = Math.abs(dx) > Math.abs(dy) ? [d.r, d.c + Math.sign(dx)] : [d.r + Math.sign(dy), d.c];
  if (r2 >= 0 && c2 >= 0 && r2 < N && c2 < N) trySwap([d.r, d.c], [r2, c2]);
});
addEventListener('pointerup', () => {
  const d = S.drag; S.drag = null;
  if (!d || !canAct()) return;
  const t = S.grid[d.r][d.c], s = S.sel;
  if (s && Math.abs(s.r - d.r) + Math.abs(s.c - d.c) === 1) trySwap([s.r, s.c], [d.r, d.c]);
  else if (t.sp && (!s || (s.r === d.r && s.c === d.c))) tapItem(d.r, d.c);
  else S.sel = s && s.r === d.r && s.c === d.c ? null : { r: d.r, c: d.c };
});
addEventListener('keydown', (e) => {
  if (S.screen === 'howto') {
    if (e.code === 'Space' || e.code === 'Enter' || e.code === 'ArrowRight') { e.preventDefault(); if (!e.repeat) howtoNext(); }
    else if (e.code === 'ArrowLeft' && howtoPage > 0) { howtoPage--; renderHowto(); }
    else if (e.code === 'Escape') closeHowto();
    return;
  }
  if (e.code === 'Space') {
    e.preventDefault();
    if (S.screen === 'intro') requestStart();
    else if (S.screen === 'result' && !$('retryBtn').disabled) startGame();
  }
  if (e.code === 'Escape') { if (S.screen === 'play') (S.paused ? resume : pause)(); else if (S.screen === 'result') bridge.close(); }
  if (e.code === 'KeyM') $('mute').textContent = sfx.toggle() ? '🔇' : '🔊';
  if (e.code === 'KeyB') $('bgm').classList.toggle('off', !bgm.toggle());
});
addEventListener('blur', () => { S.drag = null; if (S.screen === 'play' && !S.paused) pause(); });

// ---------- 게임 루프 ----------
// 모든 작물을 제자리로: 떨어질 땐 중력, 바꿀 땐 일정한 속도. 다 멈췄으면 true
function moveTiles(dt, linear) {
  let still = true;
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    const t = S.grid[r][c]; if (!t) continue;
    const tx = cx(c), ty = cy(r);
    if (!linear && ty - t.y > 0.5) {
      t.vy += GRAV * dt; t.y = Math.min(ty, t.y + t.vy * dt);
      if (t.y === ty) { t.vy = 0; t.land = 1; }
    } else {
      const step = MOVE * dt;
      t.x += Math.max(-step, Math.min(step, tx - t.x)); t.y += Math.max(-step, Math.min(step, ty - t.y));
    }
    if (Math.abs(t.x - tx) > 0.5 || Math.abs(t.y - ty) > 0.5) still = false; else { t.x = tx; t.y = ty; }
  }
  return still;
}
function update(dt) {
  S.t += dt;
  if (!S.timeUp) {
    const before = Math.ceil(S.time);
    S.time -= dt;
    if (S.time <= 10 && Math.ceil(S.time) < before && S.time > 0) { sfx.tick(); if (before === 11) say('10초 남았어요!', 1.5, 'isak_shout'); }
    if (S.time <= 0) { S.time = 0; S.timeUp = true; S.sel = null; S.drag = null; S.hint = null; sfx.timeup(); toast('TIME UP!', '#ffd93c'); }
  }
  for (const row of S.grid) for (const t of row) if (t) { t.pop = Math.max(0, t.pop - dt * 3); t.land = Math.max(0, t.land - dt * 6); if (t.dying) t.dying = Math.min(1, t.dying + dt / CLEAR_SEC); }

  if (S.phase === 'swap') { if (moveTiles(dt, true)) afterSwap(); }
  else if (S.phase === 'unswap') { if (moveTiles(dt, true)) S.phase = 'idle'; }
  else if (S.phase === 'clear') { S.clearT += dt; if (S.clearT >= CLEAR_SEC) finishClear(); }
  else if (S.phase === 'fall') { if (moveTiles(dt, false)) settled(); }
  else if (S.phase === 'idle') {
    moveTiles(dt, true);
    if (S.combo && S.t - S.lastMatch > COMBO_GAP) S.combo = 0;
    if (S.timeUp) { S.phase = 'bonus'; S.bonusT = 0.8; }
    else if ((S.idle += dt) > HINT_AFTER && !S.hint) { S.hint = findMove(); if (S.hint) say('여기를 바꿔 보세요!', 1.6, 'isak_basket'); }
  } else if (S.phase === 'bonus') {
    // 막판 보너스: 남은 아이템을 하나씩 터뜨리고, 없으면 끝
    if ((S.bonusT -= dt) <= 0) {
      let k = null;
      for (let r = 0; r < N && k === null; r++) for (let c = 0; c < N; c++) if (S.grid[r][c].sp) { k = key(r, c); break; }
      if (k === null) { endGame(); return; }
      if (!S.bonusScore) { toast('막판 보너스!', '#ffd93c'); say('남은 아이템도 수확!', 1.5, 'isak_win'); }
      startClear(expand([k]), []); S.bonusT = 0.35;
    }
  }

  for (const f of S.fx) { f.t += dt; if (f.vx !== undefined) { f.x += f.vx * dt; f.y += f.vy * dt; f.vy += 500 * dt; } else if (f.text) f.y -= 40 * dt; }
  S.fx = S.fx.filter(f => f.t < f.life);
  for (const tt of S.toasts) tt.t += dt;
  S.toasts = S.toasts.filter(tt => tt.t < 1.8);
  S.timeFlash = Math.max(0, (S.timeFlash || 0) - dt * 2.5);
}

// ---------- 그리기 ----------
function drawImg(name, x, y, size, alpha = 1) {
  const im = IMG[name]; if (!ready(im)) return false;
  ctx.save(); ctx.globalAlpha = alpha; ctx.drawImage(im, x - size / 2, y - size / 2, size, size); ctx.restore();
  return true;
}
function text(str, x, y, { size = 16, color = '#fff', align = 'left', font = 'Galmuri11', outline = '#2b3a2e' } = {}) {
  ctx.font = `${size}px ${font}`; ctx.textAlign = align; ctx.textBaseline = 'top';
  if (outline) { ctx.lineWidth = 4; ctx.strokeStyle = outline; ctx.lineJoin = 'round'; ctx.strokeText(str, x, y); }
  ctx.fillStyle = color; ctx.fillText(str, x, y);
}
const EMOJI = '"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
function drawImgAt(name, x, y, size) { const im = IMG[name]; if (!ready(im)) return false; ctx.drawImage(im, x - size / 2, y - size / 2, size, size); return true; }
function itemIcon(sp, x, y, size) { const [name, ch] = ITEM_ICON[sp]; if (!drawImgAt(name, x, y, size)) emoji(ch, x, y, size * 0.75); }
function emoji(ch, x, y, size) { ctx.font = `${size}px ${EMOJI}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(ch, x, y); }
function shade(hex, k) {   // k>0 밝게, k<0 어둡게
  const n = parseInt(hex.slice(1), 16), f = (c) => Math.max(0, Math.min(255, Math.round(k > 0 ? c + (255 - c) * k : c * (1 + k))));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}
function ball(r, color, x = 0, y = 0) {
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
  g.addColorStop(0, shade(color, 0.45)); g.addColorStop(0.6, color); g.addColorStop(1, shade(color, -0.25));
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.29); ctx.fill();
}
function leaf(x, y, w, h, rot, color = '#5fae3c') {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.fillStyle = color;
  ctx.beginPath(); ctx.ellipse(0, 0, w, h, 0, 0, 6.29); ctx.fill(); ctx.restore();
}
// 이미지가 없는 작물은 직접 그림 (점토 느낌 그라데이션)
function drawCropShape(t, r) {
  switch (t.key) {
    case 'watermelon':
      ball(r, t.color); ctx.strokeStyle = '#174d22'; ctx.lineWidth = 3.5;
      for (const k of [-0.66, -0.22, 0.22, 0.66]) {
        ctx.beginPath();
        for (let y = -r; y <= r; y += 4) { const half = Math.sqrt(Math.max(0, r * r - y * y)); const x = k * half + Math.sin(y * 0.5) * 2; y === -r ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
        ctx.stroke();
      }
      break;
    case 'grape':
      leaf(r * 0.3, -r * 0.85, r * 0.35, r * 0.18, -0.4);
      ctx.fillStyle = '#6b4a2a'; ctx.fillRect(-1.5, -r, 3, r * 0.35);
      for (const [x, y] of [[-0.45, -0.45], [0, -0.5], [0.45, -0.45], [-0.25, -0.02], [0.25, -0.02], [-0.55, 0.0], [0.55, 0.0], [0, 0.38], [-0.28, 0.42], [0.28, 0.42], [0, 0.78]])
        ball(r * 0.27, t.color, x * r, y * r);
      break;
    case 'radish':
      for (const a of [-0.5, 0, 0.5]) leaf(a * r * 0.5, -r * 0.7, r * 0.18, r * 0.42, a, '#4f9e34');
      ctx.save(); ctx.translate(0, r * 0.12);
      { const g = ctx.createLinearGradient(-r, 0, r, 0); g.addColorStop(0, '#d8d3c6'); g.addColorStop(0.4, '#fffdf6'); g.addColorStop(1, '#cfc9ba'); ctx.fillStyle = g; }
      ctx.beginPath(); ctx.moveTo(-r * 0.55, -r * 0.45); ctx.quadraticCurveTo(-r * 0.6, r * 0.5, 0, r * 0.85); ctx.quadraticCurveTo(r * 0.6, r * 0.5, r * 0.55, -r * 0.45); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(140,200,90,.5)'; ctx.fillRect(-r * 0.55, -r * 0.45, r * 1.1, r * 0.25);
      ctx.restore();
      break;
    default: ball(r, t.color);
  }
}
function drawCrop(type, x, y, size, alpha = 1) {
  const r = size / 2;
  ctx.save(); ctx.globalAlpha = alpha; ctx.translate(x, y);
  if (type === GOLD) {
    const g = ctx.createRadialGradient(0, 0, r * 0.2, 0, 0, r);
    g.addColorStop(0, '#fff6c8'); g.addColorStop(0.7, '#ffd23c'); g.addColorStop(1, '#e0a412');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r * 0.95, 0, 6.29); ctx.fill();
    if (ready(IMG.golden)) ctx.drawImage(IMG.golden, -r * 0.9, -r * 0.9, r * 1.8, r * 1.8);
  } else {
    const t = CROPS[type], im = IMG[t.key];
    if (ready(im)) ctx.drawImage(im, -r * 1.05, -r * 1.05, r * 2.1, r * 2.1);
    else drawCropShape(t, r * 0.82);
  }
  ctx.restore();
}
function drawTile(t, r, c) {
  let x = t.x, y = t.y;
  if (S.hint && S.hint.some(([hr, hc]) => hr === r && hc === c)) y += Math.sin(S.t * 10) * 3;
  const grow = t.dying ? 1 - t.dying : 1 - t.pop * 0.5 + (t.sp && t.pop ? t.pop * 0.6 : 0);
  const size = 52 * grow, alpha = t.dying ? 1 - t.dying * 0.7 : 1;
  ctx.save(); ctx.translate(x, y); ctx.scale(1 + t.land * 0.1, 1 - t.land * 0.12); ctx.translate(-x, -y);
  if (t.sp === 'bomb') {   // 비료: 두근거리는 주황 테두리
    const k = 0.5 + 0.5 * Math.sin(S.t * 6);
    ctx.fillStyle = `rgba(255,140,40,${0.25 + 0.2 * k})`; ctx.beginPath(); ctx.arc(x, y, size * 0.58, 0, 6.29); ctx.fill();
  }
  if (t.sp === 'row' || t.sp === 'col') {   // 트랙터: 가는 방향으로 줄무늬
    ctx.fillStyle = 'rgba(255,255,255,.45)';
    for (const d of [-1, 1]) t.sp === 'row' ? ctx.fillRect(x - size * 0.55, y + d * size * 0.22 - 2, size * 1.1, 4) : ctx.fillRect(x + d * size * 0.22 - 2, y - size * 0.55, 4, size * 1.1);
  }
  drawCrop(t.t, x, y, size, alpha);
  if (t.sp && !t.dying) {
    if (ITEM_ICON[t.sp]) {
      ctx.fillStyle = '#fffbe6'; ctx.strokeStyle = '#2b3a2e'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x + 16, y + 16, 13, 0, 6.29); ctx.fill(); ctx.stroke();
      itemIcon(t.sp, x + 16, y + 16, 24);
      text(t.sp === 'row' ? '↔' : t.sp === 'col' ? '↕' : '', x - 17, y + 7, { size: 14, align: 'center', color: '#fff' });
    } else {   // 황금 이삭: 반짝이
      const a = S.t * 3;
      ctx.fillStyle = '#fff'; for (let i = 0; i < 3; i++) { const ang = a + i * 2.1; ctx.fillRect(x + Math.cos(ang) * 24 - 2, y + Math.sin(ang) * 24 - 2, 4, 4); }
    }
  }
  ctx.restore();
}
function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
function drawBoard() {
  ctx.fillStyle = '#9b6a3c'; roundRect(BX - 12, BY - 12, N * C + 24, N * C + 24, 12); ctx.fill();
  ctx.strokeStyle = '#2b3a2e'; ctx.lineWidth = 3; ctx.stroke();
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    ctx.fillStyle = (r + c) % 2 ? '#bddb9a' : '#cfe8b0'; ctx.fillRect(BX + c * C, BY + r * C, C, C);
  }
  if (S.sel) {
    const k = 0.6 + 0.4 * Math.sin(S.t * 8);
    ctx.strokeStyle = `rgba(255,255,255,${k})`; ctx.lineWidth = 4; roundRect(BX + S.sel.c * C + 3, BY + S.sel.r * C + 3, C - 6, C - 6, 8); ctx.stroke();
  }
  ctx.save(); ctx.beginPath(); ctx.rect(BX, BY, N * C, N * C); ctx.clip();   // 위에서 떨어지는 작물은 판 안에서만 보이게
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) { const t = S.grid[r][c]; if (t) drawTile(t, r, c); }
  ctx.restore();
}
function drawFx() {
  for (const f of S.fx) {
    const k = f.t / f.life;
    if (f.kind === 'sweep') {   // 트랙터가 그 줄을 양쪽 끝까지 달림
      ctx.globalAlpha = 1 - k;
      ctx.fillStyle = 'rgba(255,240,170,.7)';
      if (f.dir === 'row') ctx.fillRect(BX, BY + f.r * C + 8, N * C, C - 16); else ctx.fillRect(BX + f.c * C + 8, BY, C - 16, N * C);
      ctx.globalAlpha = 1;
      const d = k * N * C;
      for (const s of [-1, 1]) {
        const x = f.dir === 'row' ? cx(f.c) + s * d : cx(f.c), y = f.dir === 'row' ? cy(f.r) : cy(f.r) + s * d;
        if (x < BX - 20 || x > BX + N * C + 20 || y < BY - 20 || y > BY + N * C + 20) continue;
        ctx.save(); ctx.translate(x, y); if (f.dir === 'row' && s > 0) ctx.scale(-1, 1); if (f.dir === 'col') ctx.rotate(-s * Math.PI / 2);   // 그림은 왼쪽을 보고 있음
        itemIcon('row', 0, 0, 44); ctx.restore();
      }
    } else if (f.kind === 'ring') {
      ctx.globalAlpha = 1 - k; ctx.strokeStyle = '#ff8c28'; ctx.lineWidth = 10 * (1 - k) + 2;
      ctx.beginPath(); ctx.arc(f.x, f.y, f.R * (0.3 + 0.7 * k), 0, 6.29); ctx.stroke();
      ctx.fillStyle = 'rgba(255,220,120,.35)'; ctx.fill();
    } else if (f.kind === 'drone') {   // 드론이 날아가 도착하면 + 모양으로 번쩍
      const m = Math.min(1, k * 1.6), x = f.x1 + (f.x2 - f.x1) * m, y = f.y1 + (f.y2 - f.y1) * m - Math.sin(m * Math.PI) * 40;
      if (m >= 1) { ctx.globalAlpha = 1 - (k - 0.625) / 0.375; ctx.fillStyle = 'rgba(180,240,255,.8)'; ctx.fillRect(f.x2 - C * 1.5, f.y2 - C / 2 + 8, C * 3, C - 16); ctx.fillRect(f.x2 - C / 2 + 8, f.y2 - C * 1.5, C - 16, C * 3); }
      ctx.globalAlpha = 1; itemIcon('drone', x, y, 44);
    } else if (f.kind === 'beam') {
      ctx.globalAlpha = 1 - k; ctx.strokeStyle = '#ffe680'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(f.x1, f.y1); ctx.lineTo(f.x1 + (f.x2 - f.x1) * Math.min(1, k * 3), f.y1 + (f.y2 - f.y1) * Math.min(1, k * 3)); ctx.stroke();
    } else if (f.kind === 'flash') {
      ctx.globalAlpha = 0.6 * (1 - k); ctx.fillStyle = '#fff6c8'; ctx.fillRect(0, 0, W, H);
    } else if (f.text) {
      ctx.globalAlpha = Math.min(1, (1 - k) * 2); text(f.text, f.x, f.y, { size: f.size, align: 'center', color: f.color, font: 'Galmuri14' });
    } else {
      ctx.globalAlpha = 1 - k; ctx.fillStyle = f.color; ctx.fillRect(f.x - f.size / 2, f.y - f.size / 2, f.size, f.size);
    }
    ctx.globalAlpha = 1;
  }
}
function drawIsak() {
  const mood = S.mood && S.t < S.mood.until ? S.mood.sprite : S.combo >= 5 ? 'isak_happy' : S.timeUp ? 'isak_win' : 'isak_basket';
  const bob = Math.sin(S.t * 4) * 2;
  drawImg(mood, 78, 146 + bob, 120);
  // 말풍선: 할 말이 있으면 그 말, 없으면 콤보
  let msg = S.say && S.t < S.say.until ? S.say.text : null;
  if (!msg && S.combo >= 2) msg = `🔥 ${S.combo} COMBO`;
  if (!msg) return;
  ctx.fillStyle = '#fffbe6'; ctx.strokeStyle = '#2b3a2e'; ctx.lineWidth = 3;
  roundRect(150, 112, 300, 60, 10); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(152, 132); ctx.lineTo(136, 146); ctx.lineTo(152, 150); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(151, 132); ctx.lineTo(136, 146); ctx.lineTo(151, 150); ctx.stroke();
  const comboLine = msg.startsWith('🔥');
  text(msg, 300, comboLine ? 128 : 132, { size: comboLine ? 26 : 18, align: 'center', font: 'Galmuri14', outline: null, color: comboLine && S.combo >= 10 ? '#d7451d' : '#2b3a2e' });
}
function draw() {
  ctx.clearRect(0, 0, W, H);
  const bg = IMG.bg;
  if (ready(bg)) { const s = Math.max(W / bg.naturalWidth, H / bg.naturalHeight), w = bg.naturalWidth * s, h = bg.naturalHeight * s; ctx.drawImage(bg, (W - w) / 2, (H - h) / 2, w, h); }
  else { ctx.fillStyle = '#9fd9ff'; ctx.fillRect(0, 0, W, H); }
  if (S.screen === 'intro' || !S.grid.length) return;

  drawIsak();
  drawBoard();
  drawFx();

  S.toasts.forEach((tt, i) => { ctx.globalAlpha = tt.t < 1.4 ? 1 : 1 - (tt.t - 1.4) / 0.4; text(tt.text, W / 2, 400 + i * 30 - tt.t * 16, { size: 28, color: tt.color, align: 'center', font: 'Galmuri14' }); });
  ctx.globalAlpha = 1;

  // HUD: 수확 수 · 점수 · 최고 기록
  ctx.fillStyle = 'rgba(43,58,46,.75)'; ctx.fillRect(0, 0, W, 46);
  text(`수확 ${S.harvested}`, 12, 14, { size: 15, outline: null, color: '#cfe9df' });
  text(`${S.score.toLocaleString()}`, W / 2, 10, { size: 24, align: 'center', font: 'Galmuri14', outline: null, color: '#fffbe6' });
  text(`BEST ${Math.max(S.best, S.score).toLocaleString()}`, W - 12, 14, { size: 14, align: 'right', outline: null, color: '#cfe9df' });

  // 시간 막대
  const TY = BY + N * C + 26, low = S.time <= 10, k = Math.min(1, S.time / TIME);
  emoji('⏱', 34, TY + 12, 22);
  ctx.fillStyle = 'rgba(0,0,0,.35)'; roundRect(54, TY, 360, 24, 6); ctx.fill();
  ctx.fillStyle = low ? (Math.floor(S.t * 4) % 2 ? '#ff6a4d' : '#ff9a6d') : '#7cd35a'; roundRect(54, TY, Math.max(0, 360 * k), 24, 6); ctx.fill();
  if (S.timeFlash) { ctx.fillStyle = `rgba(255,255,255,${0.7 * S.timeFlash})`; roundRect(54, TY, 360, 24, 6); ctx.fill(); }
  ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fillRect(58, TY + 3, Math.max(0, 352 * k), 5);
  ctx.strokeStyle = '#2b3a2e'; ctx.lineWidth = 3; roundRect(54, TY, 360, 24, 6); ctx.stroke();
  text(`${Math.ceil(S.time)}`, 446, TY + 2, { size: 20, align: 'center', font: 'Galmuri14', color: low ? '#ff8a65' : '#fff' });

  // 아이템 안내
  ctx.fillStyle = 'rgba(255,251,230,.88)'; roundRect(30, TY + 40, W - 60, 52, 8); ctx.fill();
  ctx.strokeStyle = '#2b3a2e'; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = '#2b3a2e';
  [['row', '4개 줄'], ['bomb', 'ㄱ·T자'], ['drone', '네모'], ['gold', '5개 줄']].forEach(([sp, s], i) => {
    const x = 50 + i * 104;
    if (sp === 'gold') { if (!drawImgAt('golden', x, TY + 58, 24)) emoji('🌾', x, TY + 58, 18); } else itemIcon(sp, x, TY + 58, 26);
    text(s, x + 15, TY + 50, { size: 13, outline: null, color: '#2b3a2e' });
  });
  text('눌러도 터짐 · 터지면 +2초 (황금 이삭 +4초)', W / 2, TY + 72, { size: 12, align: 'center', outline: null, color: '#556' });
}

// ---------- 점수 카드 ----------
async function shareCard() {
  const dataUrl = scoreCard({ title: '이삭이 수확팡', score: S.score, best: S.best, bg: IMG.bg,
    line: `수확 ${S.harvested}개  ·  최대 ${S.maxCombo}콤보  ·  아이템 ${S.made}개` });
  const r = await bridge.shareCard(dataUrl);
  $('shareBtn').textContent = r.copied ? '✅ 복사했어요 · 메신저에 붙여넣기' : '✅ 저장했어요';
}

// ---------- 시작 ----------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.033, (now - last) / 1000); last = now;
  if (S.screen === 'play' && !S.paused) update(dt);
  draw();
  requestAnimationFrame(frame);
}
$('resumeBtn').onclick = resume;
$('retryBtn').onclick = startGame;
$('closeBtn').onclick = () => bridge.close();
$('x').onclick = () => bridge.close();
$('mute').onclick = () => { $('mute').textContent = sfx.toggle() ? '🔇' : '🔊'; };
$('bgm').onclick = () => $('bgm').classList.toggle('off', !bgm.toggle());
$('shareBtn').onclick = shareCard;
bridge.onAlarm((info) => { if (S.screen === 'play') pause(info.text); });

(async () => {
  show('intro'); await refreshIntro();
  requestAnimationFrame(frame);
})();

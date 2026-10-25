// 이삭이 수확 합치기 — 같은 작물끼리 부딪히면 다음 단계로 자라는 물리 퍼즐 (수박게임 방식)
// 판이 끝없이 길어지지 않게: 물 게이지가 계속 줄고(합치면 보충), 돌·잡초 장애물이 떨어진다
'use strict';

// Electron 밖(브라우저 미리보기)에서 열면 가짜 브리지로 동작
const bridge = window.game || {
  kind: 'merge',
  getCoins: async () => ({ coins: 3, cap: 5, daily: 3 }),
  spendCoin: async () => ({ ok: true, coins: 2, cap: 5 }),
  getBest: async () => 0, saveBest() {}, result() {}, close() { location.reload(); }, onAlarm() {},
  saveScore() {}, getHistory: async () => [],
  async shareCard(dataUrl) { const a = document.createElement('a'); a.href = dataUrl; a.download = 'score.png'; a.click(); return { copied: false, saved: true }; },
};

const W = 480, H = 800;
const BOX = { l: 40, r: 440, top: 200, floor: 772 };   // 나무 상자 안쪽
const LINE = 222;                                       // 이 선 위로 작물이 2.5초 넘게 있으면 넘침
const DROP_Y = 160, DROP_COOLDOWN = 0.5;
// 키보드 조준: 살짝 누르면 조금, 길게 누르면 점점 빨라짐
const AIM_MIN = 160, AIM_MAX = 520, AIM_RAMP = 0.4;
const G = 1500, SUB = 8, ITER = 2, RESTITUTION = 0.05;
const STAGE_SEC = 45;   // 스테이지 상한 없음: 물이 계속 빨리 말라서 판이 언젠가는 끝남
// 물: 계속 줄고, 합칠 때 보충. 스테이지가 오를수록 빨리 마름
const WATER_MAX = 100, DRAIN_BASE = 1.6, DRAIN_STEP = 0.4;
// 장애물 간격(초): 처음 OBSTACLE_FIRST초 뒤, 이후 BASE - 스테이지×STEP (최소 MIN)
const OBSTACLE_FIRST = 25, OBSTACLE_BASE = 24, OBSTACLE_STEP = 2, OBSTACLE_MIN = 8;

// ---------- 작물 사다리 ----------
// img: app/merge/img/<key>.png 가 있으면 그걸 쓰고, 없으면 fallback 그림, 그것도 없으면 직접 그림
const TIERS = [
  { key: 'seed',       name: '씨앗',     r: 13, color: '#a0703c', water: 0,   score: 0 },
  { key: 'sprout',     name: '새싹',     r: 18, color: '#8fd16a', water: 1.5, score: 10,  fallback: '../game/img/item_sprout.png', k: 3 },
  { key: 'bean',       name: '콩',       r: 24, color: '#7cbf4a', water: 2,   score: 30 },
  { key: 'strawberry', name: '딸기',     r: 30, color: '#e8434b', water: 3,   score: 60 },
  { key: 'persimmon',  name: '감',       r: 36, color: '#f08a24', water: 4,   score: 100, fallback: '../game/img/persimmon.png' },
  { key: 'apple',      name: '사과',     r: 43, color: '#e0413a', water: 5.5, score: 150, fallback: '../game/img/apple.png' },
  { key: 'pear',       name: '배',       r: 51, color: '#e6c56a', water: 7,   score: 210, fallback: '../game/img/pear.png' },
  { key: 'melon',      name: '참외',     r: 60, color: '#f5c518', water: 9,   score: 280 },
  { key: 'watermelon', name: '수박',     r: 70, color: '#2f9e44', water: 12,  score: 360 },
  { key: 'golden',     name: '황금 이삭', r: 82, color: '#ffd23c', water: 100, score: 450, fallback: '../game/img/item_golden_ear.png' },
];
const TOP = TIERS.length - 1;
const DROP_WEIGHTS = [30, 28, 22, 13, 7];                // 떨어뜨리는 건 씨앗~딸기만

// ---------- 이미지 ----------
const IMG = {};
function loadImg(name, src, fallback) {
  const i = new Image();
  i.onerror = () => { if (fallback && !i.dataset.fb) { i.dataset.fb = 1; i.src = fallback; } else IMG[name] = null; };
  i.src = src; IMG[name] = i;
}
['bg', 'isak_basket', 'isak_happy', 'isak_hit', 'isak_win', 'isak_over'].forEach(n => loadImg(n, `../game/img/${n}.png`));
TIERS.forEach(t => loadImg(t.key, `img/${t.key}.png`, t.fallback));
loadImg('stone', 'img/stone.png'); loadImg('weed', 'img/weed.png'); loadImg('bug', 'img/bug.png', '../game/img/bug.png');
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
    drop() { tone(330, 0.07, 'triangle', 0.2, -120); },
    merge(tier) { const f = 330 * Math.pow(1.12, tier); tone(f, 0.1, 'square', 0.22, f * 0.5); },
    golden() { [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => tone(f, 0.14, 'square', 0.25, 0, i * 0.08)); },
    thud() { tone(110, 0.2, 'sawtooth', 0.3, -50); },
    crack() { tone(240, 0.08, 'sawtooth', 0.25, -150); tone(180, 0.1, 'square', 0.2, -100, 0.05); },
    warn() { tone(880, 0.08, 'square', 0.15); tone(880, 0.08, 'square', 0.15, 0, 0.14); },
    stage() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.12, 'square', 0.25, 0, i * 0.09)); },
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
  t: 0, stage: 1, score: 0, water: WATER_MAX,
  bodies: [], fx: [], toasts: [], warnings: [],
  aimX: W / 2, aimHold: 0, hold: 0, next: 0, cooldown: 0, keys: {},
  danger: 0, combo: 0, lastMerge: -9, obstacleAt: OBSTACLE_FIRST,
  merges: 0, cleared: 0, topTier: 0, goldens: 0,
  happyUntil: 0, best: 0, coins: 0, cap: 3,
};
let nextId = 1;
function show(id) { document.querySelectorAll('.screen').forEach(e => e.classList.toggle('on', e.id === id)); }
const rnd = (a, b) => a + Math.random() * (b - a);
function toast(text, color = '#fffbe6') { S.toasts.push({ text, color, t: 0 }); if (S.toasts.length > 4) S.toasts.shift(); }
function randomTier() {
  // 지금 상자에 있는 가장 큰 작물보다 크게는 안 나오게 (초반에 딸기만 쏟아지는 것 방지)
  const cap = Math.min(DROP_WEIGHTS.length - 1, Math.max(2, S.topTier));
  const w = DROP_WEIGHTS.slice(0, cap + 1), sum = w.reduce((a, b) => a + b, 0);
  let r = Math.random() * sum;
  for (let i = 0; i < w.length; i++) { r -= w[i]; if (r < 0) return i; }
  return 0;
}
const drain = () => DRAIN_BASE + DRAIN_STEP * (S.stage - 1);

// ---------- 화면 전환 ----------
async function refreshIntro() {
  const c = await bridge.getCoins(); S.coins = c.coins; S.cap = c.cap;
  S.best = await bridge.getBest();
  $('introCoins').textContent = coinText(c);
  $('introBest').textContent = S.best ? `BEST ${S.best.toLocaleString()}` : 'BEST —';
  const hist = await bridge.getHistory();
  const top = [...hist].sort((a, b) => b.score - a.score).slice(0, 3);
  $('introRanks').textContent = top.length ? 'TOP 3 · ' + top.map(h => `${h.score.toLocaleString()}${h.cleared ? '★' : ''}`).join(' · ') : '';
  $('pressStart').textContent = S.coins > 0 ? 'PRESS SPACE' : '코인이 없어요';
  $('pressStart').classList.toggle('blink', S.coins > 0);
}
async function startGame() {
  const r = await bridge.spendCoin();
  if (!r.ok) { refreshIntro(); return; }
  S.coins = r.coins;
  Object.assign(S, { t: 0, stage: 1, score: 0, water: WATER_MAX, bodies: [], fx: [], toasts: [], warnings: [],
    aimX: W / 2, aimHold: 0, cooldown: 0, keys: {}, danger: 0, combo: 0, lastMerge: -9, obstacleAt: OBSTACLE_FIRST,
    merges: 0, cleared: 0, topTier: 0, goldens: 0, happyUntil: 0, paused: false });
  S.hold = randomTier(); S.next = randomTier();
  S.screen = 'play'; show(''); sfx.stage(); bgm.play();
  toast('같은 작물끼리 합쳐요!', '#fff');
}
// ---------- 게임 방법: 처음 시작할 때 한 번, 인트로의 ❓ 버튼으로 다시 보기 ----------
// 본 적 있는지는 이 게임 창의 localStorage에만 기억 (못 읽으면 그냥 다시 보여줌)
const HOWTO_KEY = 'merge.howtoSeen';
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

function endGame(reason) {
  if (S.screen !== 'play') return;
  S.screen = 'result'; show('result'); bgm.stop();
  const cleared = S.goldens > 0;
  const isBest = S.score > S.best;
  if (isBest) { S.best = S.score; bridge.saveBest(S.score); }
  $('resultTitle').textContent = reason === 'dry' ? '물이 말랐어요' : '상자가 넘쳤어요';
  $('resultScore').textContent = S.score.toLocaleString();
  $('resultBest').textContent = isBest ? '🏆 최고 기록 갱신!' : `BEST ${S.best.toLocaleString()}`;
  const sec = Math.floor(S.t);
  $('resultStats').innerHTML = `<span>최고 작물 <b>${TIERS[S.topTier].name}</b></span><span>황금 이삭 <b>${S.goldens}개</b></span>` +
    `<span>합친 횟수 <b>${S.merges}번</b></span><span>치운 장애물 <b>${S.cleared}개</b></span>` +
    `<span>버틴 시간 <b>${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}</b></span><span>스테이지 <b>${S.stage}</b></span>`;
  S.lastReason = reason;
  bridge.saveScore({ score: S.score, stage: S.stage, cleared, topTier: S.topTier, goldens: S.goldens, merges: S.merges, sec, date: new Date().toISOString() });
  bridge.getCoins().then(c => { S.coins = c.coins; S.cap = c.cap; $('retryBtn').textContent = retryText(c); $('retryBtn').disabled = S.coins <= 0; });
  $('shareBtn').textContent = '📸 점수 카드 복사·저장';
  sfx.over();
  bridge.result({ score: S.score, best: isBest, cleared });
}
function pause(reason) {
  if (S.screen !== 'play') return;
  S.paused = true; bgm.pause(); S.keys = {};
  $('pauseTitle').textContent = reason ? '⏰ 근무확인!' : '일시정지';
  $('pauseText').innerHTML = reason ? `${reason}<br>이삭이를 확인하고 돌아오세요` : 'ESC로 계속';
  show('pause');
}
function resume() { if (S.screen === 'play') { S.paused = false; show(''); bgm.play(); } }

// ---------- 몸체 ----------
function addFruit(tier, x, y, vx = 0, vy = 0) {
  const r = TIERS[tier].r;
  const b = { id: nextId++, kind: 'fruit', tier, x, y, vx, vy, r, m: r * r, age: 0, angle: rnd(-0.3, 0.3), pop: 0 };
  S.bodies.push(b); S.topTier = Math.max(S.topTier, tier);
  return b;
}
// 돌: 2번에 깨짐 · 잡초: 점점 자람, 1번 · 벌레: 1번, 벌레끼리 만나면 큰 벌레(2번)
const BUG_R = 20, BIG_BUG_R = 34;
function addObstacle(type, x, y = BOX.top - 26, big = false) {
  const r = type === 'stone' ? 26 : type === 'bug' ? (big ? BIG_BUG_R : BUG_R) : 16;
  const b = { id: nextId++, kind: type, x, y, vx: 0, vy: 120, r, m: r * r * (type === 'stone' ? 4 : 1),
    hp: type === 'stone' || big ? 2 : 1, big, age: 0, angle: 0, pop: 0, hit: 0, crawlAt: rnd(0.8, 1.6), face: 1 };
  S.bodies.push(b); return b;
}
function drop() {
  if (S.cooldown > 0) return;
  const r = TIERS[S.hold].r, x = Math.max(BOX.l + r, Math.min(BOX.r - r, S.aimX));
  addFruit(S.hold, x, DROP_Y, 0, 60);
  S.hold = S.next; S.next = randomTier(); S.cooldown = DROP_COOLDOWN; sfx.drop();
}

// ---------- 물리 ----------
function collide(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, rs = a.r + b.r, d2 = dx * dx + dy * dy;
  if (d2 >= rs * rs) return;
  const d = Math.sqrt(d2) || 0.001, nx = dx / d, ny = dy / d, pen = rs - d;
  const ia = 1 / a.m, ib = 1 / b.m, sum = ia + ib;
  a.x -= nx * pen * ia / sum; a.y -= ny * pen * ia / sum;
  b.x += nx * pen * ib / sum; b.y += ny * pen * ib / sum;
  const rvx = b.vx - a.vx, rvy = b.vy - a.vy, vn = rvx * nx + rvy * ny;
  if (vn < 0) {
    const j = -(1 + RESTITUTION) * vn / sum;
    a.vx -= j * nx * ia; a.vy -= j * ny * ia; b.vx += j * nx * ib; b.vy += j * ny * ib;
    const vt = rvx * -ny + rvy * nx, jt = -vt / sum * 0.15;     // 살짝 마찰: 굴러다니다 멈추게
    a.vx -= jt * -ny * ia; a.vy -= jt * nx * ia; b.vx += jt * -ny * ib; b.vy += jt * nx * ib;
  }
}
function walls(b) {
  if (b.x - b.r < BOX.l) { b.x = BOX.l + b.r; if (b.vx < 0) b.vx *= -0.2; }
  if (b.x + b.r > BOX.r) { b.x = BOX.r - b.r; if (b.vx > 0) b.vx *= -0.2; }
  if (b.y + b.r > BOX.floor) { b.y = BOX.floor - b.r; if (b.vy > 0) b.vy *= -0.1; b.vx *= 0.985; }
}
function physics(dt) {
  const h = dt / SUB, list = S.bodies, n = list.length;
  for (let s = 0; s < SUB; s++) {
    for (const b of list) { b.vy += G * h; b.vx *= 0.9995; b.x += b.vx * h; b.y += b.vy * h; }
    for (let k = 0; k < ITER; k++) {
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) collide(list[i], list[j]);
      for (const b of list) walls(b);
    }
  }
  for (const b of list) { b.angle += b.vx * dt / b.r; b.vx = Math.max(-900, Math.min(900, b.vx)); b.vy = Math.max(-900, Math.min(1400, b.vy)); }
}

// ---------- 합치기 ----------
function burst(x, y, color, n = 10, speed = 180) {
  for (let i = 0; i < n; i++) { const a = rnd(0, 6.28), v = rnd(speed * 0.4, speed); S.fx.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60, color, t: 0, life: rnd(0.35, 0.6), size: rnd(3, 6) }); }
}
function popText(x, y, text, color = '#ffd93c') { S.fx.push({ x, y, text, color, t: 0, life: 0.9 }); }
function checkMerges() {
  const gone = new Set(), born = [];
  const list = S.bodies;
  for (let i = 0; i < list.length; i++) {
    const a = list[i]; if (a.kind !== 'fruit' || gone.has(a.id)) continue;
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j]; if (b.kind !== 'fruit' || b.tier !== a.tier || gone.has(b.id)) continue;
      const dx = b.x - a.x, dy = b.y - a.y, rs = a.r + b.r + 0.5;
      if (dx * dx + dy * dy > rs * rs) continue;
      gone.add(a.id); gone.add(b.id);
      born.push({ tier: a.tier + 1, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, vx: (a.vx + b.vx) / 2, vy: Math.min((a.vy + b.vy) / 2, -40) });
      break;
    }
  }
  // 작은 벌레끼리 닿으면 큰 벌레 한 마리로 (점수·물 없음, 나쁜 일)
  const bugs = [];
  for (let i = 0; i < list.length; i++) {
    const a = list[i]; if (a.kind !== 'bug' || a.big || gone.has(a.id)) continue;
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j]; if (b.kind !== 'bug' || b.big || gone.has(b.id)) continue;
      const dx = b.x - a.x, dy = b.y - a.y, rs = a.r + b.r + 0.5;
      if (dx * dx + dy * dy > rs * rs) continue;
      gone.add(a.id); gone.add(b.id); bugs.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      break;
    }
  }
  if (!gone.size) return;
  S.bodies = S.bodies.filter(b => !gone.has(b.id));
  for (const nb of born) onMerge(nb);
  for (const p of bugs) {
    const b = addObstacle('bug', p.x, p.y, true); b.vy = -40; b.pop = 1;
    burst(p.x, p.y, '#8fd16a', 10, 140); popText(p.x, p.y - 20, '벌레가 커졌어요!', '#ff8a65'); sfx.thud();
  }
}
function onMerge(nb) {
  S.merges++;
  S.combo = S.t - S.lastMerge < 1.2 ? S.combo + 1 : 0; S.lastMerge = S.t;
  const mult = 1 + Math.min(1, S.combo * 0.1);
  if (nb.tier > TOP) {
    // 황금 이삭 둘 → 대풍년: 둘 다 사라지고 큰 점수
    const gain = Math.round(1000 * mult); S.score += gain; S.water = WATER_MAX;
    burst(nb.x, nb.y, '#ffd23c', 40, 360); popText(nb.x, nb.y, `대풍년! +${gain}`); sfx.golden(); toast('🌾 대풍년! 🌾', '#ffd93c');
    S.happyUntil = S.t + 2; return;
  }
  const t = TIERS[nb.tier], b = addFruit(nb.tier, nb.x, nb.y, nb.vx, nb.vy);
  b.pop = 1;
  const gain = Math.round(t.score * mult); S.score += gain;
  S.water = Math.min(WATER_MAX, S.water + t.water + Math.min(3, S.combo * 0.5));
  burst(nb.x, nb.y, t.color, 8 + nb.tier * 2, 140 + nb.tier * 20);
  popText(nb.x, nb.y - t.r * 0.4, `+${gain}${S.combo >= 2 ? ` ×${mult.toFixed(1)}` : ''}`);
  sfx.merge(nb.tier);
  if (nb.tier >= 6) S.happyUntil = S.t + 1;
  // 합쳐진 자리 옆의 장애물을 깬다
  for (const o of S.bodies) {
    if (o.kind === 'fruit') continue;
    const dx = o.x - b.x, dy = o.y - b.y, rr = o.r + b.r + 10;
    if (dx * dx + dy * dy < rr * rr) hitObstacle(o);
  }
  if (nb.tier === TOP) {
    S.goldens++; S.water = WATER_MAX; sfx.golden();
    S.bodies.filter(o => o.kind !== 'fruit').forEach(o => { o.hp = 0; burst(o.x, o.y, o.kind === 'bug' ? '#8fd16a' : '#9a8f80', 10); S.cleared++; });
    toast('황금 이삭! 물 가득 · 장애물 싹 💛', '#ffd93c');
  } else if (nb.tier >= 7 && S.topTier === nb.tier && !S['seen' + nb.tier]) { S['seen' + nb.tier] = true; toast(`${t.name} 수확!`, '#fff'); }
  S.bodies = S.bodies.filter(o => o.kind === 'fruit' || o.hp > 0);
}
function hitObstacle(o) {
  o.hp--; o.hit = 0.25;
  if (o.hp > 0) { sfx.crack(); burst(o.x, o.y, o.kind === 'bug' ? '#8fd16a' : '#9a8f80', 6, 120); return; }
  S.cleared++; S.score += 30; S.water = Math.min(WATER_MAX, S.water + 3);
  const big = o.kind === 'bug' && o.big, gain = big ? 60 : 30;
  if (big) { S.score += 30; S.water = Math.min(WATER_MAX, S.water + 2); }
  burst(o.x, o.y, o.kind === 'stone' ? '#9a8f80' : o.kind === 'bug' ? '#8fd16a' : '#8a6d45', 14, 200);
  popText(o.x, o.y, `${o.kind === 'stone' ? '돌 치움!' : o.kind === 'bug' ? (big ? '큰 벌레 퇴치!' : '벌레 퇴치!') : '덩굴 걷어냄!'} +${gain}`, '#fff');
  sfx.crack();
}

// ---------- 장애물 ----------
function scheduleObstacle() {
  // 스테이지 1: 돌 · 2부터 벌레 · 3부터 덩굴. 4부터 벌레는 두 마리씩 오기도 함. 올라갈수록 자주
  const pool = ['stone', 'stone'];
  if (S.stage >= 2) pool.push('bug', 'bug');
  if (S.stage >= 3) pool.push('weed', 'weed');
  const type = pool[Math.floor(Math.random() * pool.length)];
  const x = rnd(BOX.l + 40, BOX.r - 40);
  S.warnings.push({ type, x, t: 0 });
  if (type === 'bug' && S.stage >= 4 && Math.random() < 0.4) S.warnings.push({ type, x: Math.max(BOX.l + 40, Math.min(BOX.r - 40, x + rnd(-120, 120))), t: -0.3 });
  sfx.warn();
  S.obstacleAt = S.t + Math.max(OBSTACLE_MIN, OBSTACLE_BASE - S.stage * OBSTACLE_STEP) * rnd(0.8, 1.2);
}

// ---------- 입력 ----------
// 게임 조작은 키보드만 (← → 조준, Space 떨어뜨리기). 마우스는 버튼 누를 때만
$('howtoBtn').addEventListener('pointerup', () => { if (S.screen === 'intro') openHowto(false); });
$('nextBtn').onclick = howtoNext;
$('skipBtn').onclick = closeHowto;
addEventListener('keydown', (e) => {
  S.keys[e.code] = true;
  if (S.screen === 'howto') {
    if (e.code === 'Space' || e.code === 'Enter' || e.code === 'ArrowRight') { e.preventDefault(); if (!e.repeat) howtoNext(); }
    else if (e.code === 'ArrowLeft' && howtoPage > 0) { howtoPage--; renderHowto(); }
    else if (e.code === 'Escape') closeHowto();
    return;
  }
  // 톡 치면 조금씩 (누르자마자 떼면 프레임 사이에 끝나서 안 움직이므로)
  if ((e.code === 'ArrowLeft' || e.code === 'ArrowRight') && !e.repeat && S.screen === 'play' && !S.paused) {
    S.aimX = Math.max(BOX.l, Math.min(BOX.r, S.aimX + (e.code === 'ArrowLeft' ? -8 : 8)));
  }
  if (e.code === 'Space' || e.code === 'ArrowDown') {
    e.preventDefault();
    if (S.screen === 'play' && !S.paused && !e.repeat) drop();
    else if (e.code === 'Space' && S.screen === 'intro') requestStart();
    else if (e.code === 'Space' && S.screen === 'result' && !$('retryBtn').disabled) startGame();
  }
  if (e.code === 'Escape') { if (S.screen === 'play') (S.paused ? resume : pause)(); else if (S.screen === 'result') bridge.close(); }
  if (e.code === 'KeyM') $('mute').textContent = sfx.toggle() ? '🔇' : '🔊';
  if (e.code === 'KeyB') $('bgm').classList.toggle('off', !bgm.toggle());
});
addEventListener('keyup', (e) => { S.keys[e.code] = false; });
addEventListener('blur', () => { S.keys = {}; if (S.screen === 'play' && !S.paused) pause(); });

// ---------- 게임 루프 ----------
function update(dt) {
  S.t += dt;
  const stage = Math.floor(S.t / STAGE_SEC) + 1;
  if (stage !== S.stage) {
    S.stage = stage; sfx.stage(); toast(`STAGE ${stage} · 물이 더 빨리 말라요`, '#fff');
    if (stage === 2) toast('벌레 등장! 벌레끼리 만나면 커져요', '#fff');
    if (stage === 3) toast('가시 덩굴 등장! 점점 커져요', '#fff');
  }
  const dir = (S.keys.ArrowRight ? 1 : 0) - (S.keys.ArrowLeft ? 1 : 0);
  if (dir) { S.aimHold += dt; S.aimX += dir * (AIM_MIN + (AIM_MAX - AIM_MIN) * Math.min(1, S.aimHold / AIM_RAMP)) * dt; } else S.aimHold = 0;
  S.aimX = Math.max(BOX.l, Math.min(BOX.r, S.aimX));
  S.cooldown = Math.max(0, S.cooldown - dt);

  // 물
  S.water -= drain() * dt;
  if (S.water <= 0) { S.water = 0; endGame('dry'); return; }

  // 장애물: 경고 1.2초 뒤 떨어짐. 잡초는 점점 자람
  if (S.t >= S.obstacleAt) scheduleObstacle();
  for (const w of S.warnings) { w.t += dt; if (w.t >= 1.2) { addObstacle(w.type, w.x); sfx.thud(); } }
  S.warnings = S.warnings.filter(w => w.t < 1.2);
  for (const b of S.bodies) {
    b.age += dt; b.pop = Math.max(0, b.pop - dt * 4); if (b.hit) b.hit = Math.max(0, b.hit - dt);
    if (b.kind === 'weed' && b.r < 46) { const nr = Math.min(46, b.r + 0.9 * dt); b.m = nr * nr; b.r = nr; }
    if (b.kind === 'bug' && b.age > 1 && (b.crawlAt -= dt) <= 0) {
      // 작은 벌레는 가까운 작은 벌레 쪽으로 기어감 (만나면 커짐), 큰 벌레는 아무 데로나
      const mate = b.big ? null : S.bodies.filter(o => o.kind === 'bug' && !o.big && o !== b).sort((p, q) => Math.abs(p.x - b.x) - Math.abs(q.x - b.x))[0];
      const dir = mate ? Math.sign(mate.x - b.x) || 1 : (Math.random() < 0.5 ? -1 : 1);
      b.vx += dir * rnd(50, 90); b.vy -= 40; b.face = dir; b.crawlAt = rnd(1, 1.8);
    }
  }

  physics(dt);
  checkMerges();

  // 넘침: 떨어진 지 1.2초 지난 작물이 선 위에 있으면 위험 시간이 쌓임
  const over = S.bodies.some(b => b.kind === 'fruit' && b.age > 1.2 && b.y - b.r < LINE);
  if (over) { if (S.danger === 0) sfx.warn(); S.danger += dt; } else S.danger = Math.max(0, S.danger - dt * 2);
  if (S.danger >= 2.5) { endGame('overflow'); return; }

  for (const f of S.fx) { f.t += dt; if (!f.text) { f.x += f.vx * dt; f.y += f.vy * dt; f.vy += 600 * dt; } else f.y -= 40 * dt; }
  S.fx = S.fx.filter(f => f.t < f.life);
  for (const tt of S.toasts) tt.t += dt; S.toasts = S.toasts.filter(tt => tt.t < 1.8);
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
function shade(hex, k) {   // k>0 밝게, k<0 어둡게
  const n = parseInt(hex.slice(1), 16), f = (c) => Math.max(0, Math.min(255, Math.round(k > 0 ? c + (255 - c) * k : c * (1 + k))));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}
function ball(r, color) {
  const g = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r);
  g.addColorStop(0, shade(color, 0.45)); g.addColorStop(0.6, color); g.addColorStop(1, shade(color, -0.25));
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r, 0, 6.29); ctx.fill();
}
function leaf(x, y, w, h, rot, color = '#5fae3c') {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.fillStyle = color;
  ctx.beginPath(); ctx.ellipse(0, 0, w, h, 0, 0, 6.29); ctx.fill(); ctx.restore();
}
// 이미지가 없는 작물은 둥글게 직접 그림 (점토 느낌 그라데이션)
function drawFruitShape(t, r) {
  switch (t.key) {
    case 'seed': ball(r, t.color); ctx.strokeStyle = shade(t.color, -0.35); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(0, -r * 0.6); ctx.quadraticCurveTo(r * 0.2, 0, 0, r * 0.6); ctx.stroke(); break;
    case 'bean': ball(r, t.color); ctx.strokeStyle = shade(t.color, -0.3); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(r * 0.15, 0, r * 0.55, 2.2, 4.1); ctx.stroke(); break;
    case 'strawberry':
      ball(r, t.color); ctx.fillStyle = '#ffe58a';
      for (let i = 0; i < 9; i++) { const a = i * 2.4, d = r * (0.3 + (i % 3) * 0.2); ctx.beginPath(); ctx.ellipse(Math.cos(a) * d, Math.sin(a) * d + r * 0.1, 1.6, 2.4, a, 0, 6.29); ctx.fill(); }
      for (let i = -2; i <= 2; i++) leaf(i * r * 0.22, -r * 0.82, r * 0.22, r * 0.1, i * 0.5);
      break;
    case 'melon':
      ball(r, t.color); ctx.strokeStyle = 'rgba(255,255,240,.85)'; ctx.lineWidth = 3;
      for (const k of [-0.6, -0.2, 0.2, 0.6]) { ctx.beginPath(); ctx.ellipse(k * r * 0.6, 0, r * (1 - Math.abs(k)) * 0.45, r * 0.95, 0, -1.4, 1.4); ctx.stroke(); }
      ctx.fillStyle = '#7a5a2a'; ctx.fillRect(-2, -r - 4, 4, 8);
      break;
    case 'watermelon':
      ball(r, t.color); ctx.strokeStyle = '#174d22'; ctx.lineWidth = 5;
      for (const k of [-0.66, -0.22, 0.22, 0.66]) {
        ctx.beginPath();
        for (let y = -r; y <= r; y += 6) { const half = Math.sqrt(Math.max(0, r * r - y * y)); const x = k * half + Math.sin(y * 0.4) * 3; y === -r ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
        ctx.stroke();
      }
      break;
    default: ball(r, t.color);
  }
}
function drawFruit(tier, x, y, r, angle = 0, pop = 0, alpha = 1) {
  const t = TIERS[tier], s = 1 + pop * 0.18;
  ctx.save(); ctx.globalAlpha = alpha; ctx.translate(x, y); ctx.rotate(angle); ctx.scale(s, s);
  if (t.key === 'golden') {      // 황금 이삭은 빛나는 원 위에
    const g = ctx.createRadialGradient(0, 0, r * 0.2, 0, 0, r);
    g.addColorStop(0, '#fff6c8'); g.addColorStop(0.7, '#ffd23c'); g.addColorStop(1, '#e0a412');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r, 0, 6.29); ctx.fill();
  }
  const im = IMG[t.key];
  if (ready(im)) { const k = t.k || (t.key === 'golden' ? 1.9 : 2.3); ctx.drawImage(im, -r * k / 2, -r * k / 2, r * k, r * k); }
  else drawFruitShape(t, r);
  ctx.restore();
}
// 벌레는 굴러도 늘 똑바로, 기어가는 쪽을 봄. 큰 벌레는 붉게 + 남은 횟수 점
function drawBug(o) {
  const s = 1 + o.pop * 0.2, size = o.r * 2.5 * s, im = IMG.bug;
  ctx.save(); ctx.scale(o.face < 0 ? 1 : -1, 1);
  if (o.big) { ctx.fillStyle = 'rgba(215,69,29,.25)'; ctx.beginPath(); ctx.arc(0, 0, o.r * 1.05, 0, 6.29); ctx.fill(); }
  if (ready(im)) ctx.drawImage(im, -size / 2, -size / 2, size, size); else ball(o.r, '#8fd16a');
  ctx.restore();
  if (o.big) for (let i = 0; i < 2; i++) {
    ctx.fillStyle = i < o.hp ? '#d7451d' : 'rgba(0,0,0,.25)'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc((i - 0.5) * 14, -o.r - 8, 5, 0, 6.29); ctx.fill(); ctx.stroke();
  }
}
function drawObstacle(o) {
  ctx.save(); ctx.translate(o.x, o.y);
  if (o.hit) ctx.translate(Math.sin(o.hit * 80) * 3, 0);
  if (o.kind === 'bug') { drawBug(o); ctx.restore(); return; }
  ctx.rotate(o.angle);
  const im = IMG[o.kind];
  if (ready(im)) ctx.drawImage(im, -o.r * 1.15, -o.r * 1.15, o.r * 2.3, o.r * 2.3);
  else if (o.kind === 'stone') {
    ball(o.r, '#8d8478');
    ctx.fillStyle = 'rgba(60,50,40,.35)'; ctx.beginPath(); ctx.arc(o.r * 0.3, o.r * 0.2, o.r * 0.18, 0, 6.29); ctx.arc(-o.r * 0.35, o.r * 0.35, o.r * 0.12, 0, 6.29); ctx.fill();
    if (o.hp < 2) { ctx.strokeStyle = '#3b332b'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(-o.r * 0.6, -o.r * 0.5); ctx.lineTo(-o.r * 0.1, -o.r * 0.05); ctx.lineTo(-o.r * 0.25, o.r * 0.3); ctx.lineTo(o.r * 0.3, o.r * 0.7); ctx.stroke(); }
  } else {
    // 가시 덩굴 뭉치: 갈색 덩굴이 엉키고 가시가 삐죽 (초록 둥근 작물과 확실히 다르게)
    const r = o.r;
    ball(r * 0.8, '#6e5638');
    ctx.lineCap = 'round';
    const cols = ['#4a3a24', '#8a6d45', '#5e7a3a'];
    for (let i = 0; i < 7; i++) {
      ctx.strokeStyle = cols[i % 3]; ctx.lineWidth = Math.max(2, r * 0.11);
      ctx.beginPath(); ctx.ellipse(Math.cos(i * 2.1) * r * 0.18, Math.sin(i * 2.1) * r * 0.18, r * 0.78, r * 0.38, i * 0.9, 0, 6.29); ctx.stroke();
    }
    ctx.strokeStyle = '#2e2416'; ctx.lineWidth = 1.5;
    for (let i = 0; i < 12; i++) {
      const a = i * 0.52, rr = r * (0.82 + (i % 2) * 0.1);
      ctx.beginPath(); ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); ctx.lineTo(Math.cos(a) * (rr + r * 0.2), Math.sin(a) * (rr + r * 0.2)); ctx.stroke();
    }
    for (let i = 0; i < 3; i++) leaf(Math.cos(i * 2.2 + 0.5) * r * 0.6, Math.sin(i * 2.2 + 0.5) * r * 0.6, r * 0.2, r * 0.09, i * 2.2, '#6fa83e');
    ctx.lineCap = 'butt';
  }
  ctx.restore();
}
function drawBox() {
  // 상자 안쪽 (반투명 흙빛) + 나무 테두리
  ctx.fillStyle = 'rgba(255,248,225,.55)'; ctx.fillRect(BOX.l, BOX.top, BOX.r - BOX.l, BOX.floor - BOX.top);
  ctx.fillStyle = '#9b6a3c';
  ctx.fillRect(BOX.l - 14, BOX.top, 14, BOX.floor - BOX.top + 14); ctx.fillRect(BOX.r, BOX.top, 14, BOX.floor - BOX.top + 14);
  ctx.fillRect(BOX.l - 14, BOX.floor, BOX.r - BOX.l + 28, 14);
  ctx.fillStyle = '#7a4f2a'; for (let y = BOX.top + 40; y < BOX.floor; y += 80) { ctx.fillRect(BOX.l - 14, y, 14, 3); ctx.fillRect(BOX.r, y, 14, 3); }
  ctx.strokeStyle = '#2b3a2e'; ctx.lineWidth = 3; ctx.strokeRect(BOX.l - 14, BOX.top, BOX.r - BOX.l + 28, BOX.floor - BOX.top + 14);
}
function draw() {
  ctx.clearRect(0, 0, W, H);
  const bg = IMG.bg;
  if (ready(bg)) { const s = Math.max(W / bg.naturalWidth, H / bg.naturalHeight), w = bg.naturalWidth * s, h = bg.naturalHeight * s; ctx.drawImage(bg, (W - w) / 2, (H - h) / 2, w, h); }
  else { ctx.fillStyle = '#9fd9ff'; ctx.fillRect(0, 0, W, H); }
  if (S.screen === 'intro') return;

  drawBox();
  // 넘침 선: 위험할 때 깜빡임
  const blink = S.danger > 0 && Math.floor(S.t * 8) % 2 === 0;
  ctx.setLineDash([8, 8]); ctx.strokeStyle = blink ? 'rgba(215,69,29,.95)' : 'rgba(215,69,29,.45)'; ctx.lineWidth = blink ? 3 : 2;
  ctx.beginPath(); ctx.moveTo(BOX.l, LINE); ctx.lineTo(BOX.r, LINE); ctx.stroke(); ctx.setLineDash([]);

  // 장애물 경고 그림자
  for (const w of S.warnings) {
    const a = 0.4 + 0.4 * Math.abs(Math.sin(w.t * 10));
    ctx.fillStyle = `rgba(215,69,29,${a})`; ctx.beginPath(); ctx.moveTo(w.x - 12, BOX.top + 4); ctx.lineTo(w.x + 12, BOX.top + 4); ctx.lineTo(w.x, BOX.top + 22); ctx.fill();
    text({ stone: '돌!', weed: '덩굴!', bug: '벌레!' }[w.type], w.x, BOX.top + 26, { size: 13, align: 'center', color: '#ffd93c' });
  }

  // 조준선 + 들고 있는 작물
  if (S.screen === 'play') {
    const r = TIERS[S.hold].r, x = Math.max(BOX.l + r, Math.min(BOX.r - r, S.aimX));
    ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = 2; ctx.setLineDash([4, 8]);
    ctx.beginPath(); ctx.moveTo(x, DROP_Y + r); ctx.lineTo(x, BOX.floor); ctx.stroke(); ctx.setLineDash([]);
    const hurt = S.water < 20 && Math.floor(S.t * 3) % 2 === 0;
    const sprite = S.t < S.happyUntil ? 'isak_happy' : hurt ? 'isak_hit' : 'isak_basket';
    drawImg(sprite, x, DROP_Y - 64, 104);
    if (S.cooldown <= 0) drawFruit(S.hold, x, DROP_Y, r, 0, 0);
  }

  for (const b of S.bodies) b.kind === 'fruit' ? drawFruit(b.tier, b.x, b.y, b.r, b.angle, b.pop) : drawObstacle(b);

  for (const f of S.fx) {
    const k = 1 - f.t / f.life;
    if (f.text) { ctx.globalAlpha = Math.min(1, k * 2); text(f.text, f.x, f.y, { size: 16, align: 'center', color: f.color, font: 'Galmuri14' }); }
    else { ctx.globalAlpha = k; ctx.fillStyle = f.color; ctx.fillRect(f.x - f.size / 2, f.y - f.size / 2, f.size, f.size); }
  }
  ctx.globalAlpha = 1;

  S.toasts.forEach((tt, i) => { ctx.globalAlpha = tt.t < 1.4 ? 1 : 1 - (tt.t - 1.4) / 0.4; text(tt.text, W / 2, 330 + i * 26 - tt.t * 16, { size: 20, color: tt.color, align: 'center', font: 'Galmuri14' }); });
  ctx.globalAlpha = 1;

  // HUD: 물 게이지 · 점수 · 스테이지/시간
  ctx.fillStyle = 'rgba(43,58,46,.75)'; ctx.fillRect(0, 0, W, 46);
  const low = S.water < 25, wk = S.water / WATER_MAX;
  text('물', 10, 14, { size: 15, outline: null, color: low && Math.floor(S.t * 4) % 2 ? '#ff8a65' : '#9fd9ff' });
  ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.fillRect(32, 15, 110, 16);
  ctx.fillStyle = low ? '#ff8a65' : '#4fb6f0'; ctx.fillRect(32, 15, 110 * wk, 16);
  ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fillRect(32, 15, 110 * wk, 5);
  ctx.strokeStyle = '#fffbe6'; ctx.lineWidth = 2; ctx.strokeRect(32, 15, 110, 16);
  text(`${S.score.toLocaleString()}`, W / 2 + 10, 10, { size: 24, align: 'center', font: 'Galmuri14', outline: null, color: '#fffbe6' });
  const sec = Math.floor(S.t);
  text(`ST ${S.stage}`, W - 12, 6, { size: 14, align: 'right', outline: null, color: '#cfe9df' });
  text(`${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`, W - 12, 24, { size: 16, align: 'right', outline: null, color: '#fff' });
  if (S.combo >= 2 && S.t - S.lastMerge < 1.2) text(`${S.combo + 1} COMBO`, W / 2, 52, { size: 16, align: 'center', color: S.combo >= 5 ? '#ffd93c' : '#fff' });

  // 다음 작물 미리보기
  ctx.fillStyle = 'rgba(255,251,230,.9)'; ctx.fillRect(10, 54, 56, 70); ctx.strokeStyle = '#2b3a2e'; ctx.lineWidth = 2; ctx.strokeRect(10, 54, 56, 70);
  text('NEXT', 38, 58, { size: 11, align: 'center', outline: null, color: '#2b3a2e' });
  drawFruit(S.next, 38, 98, Math.min(20, TIERS[S.next].r));
}

// ---------- 점수 카드 ----------
async function shareCard() {
  const sec = Math.floor(S.t);
  const dataUrl = scoreCard({ title: '이삭이 수확 합치기', score: S.score, best: S.best, bg: IMG.bg,
    line: `최고 작물 ${TIERS[S.topTier].name}${S.goldens ? ` ★${S.goldens}` : ''}  ·  합치기 ${S.merges}번  ·  ${Math.floor(sec / 60)}분 ${sec % 60}초` });
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

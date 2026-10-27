// 이삭RUN (논두렁 달리기) — 이삭이가 혼자 달리고, 점프로 장애물을 넘는 러너 (한 버튼)
// 30초마다 봄 → 여름 → 가을 → 겨울, 갈수록 빨라짐. 하트 3개가 다 없어지면 끝
'use strict';

// Electron 밖(브라우저 미리보기)에서 열면 가짜 브리지로 동작
const bridge = window.game || {
  kind: 'runner',
  getCoins: async () => ({ coins: 3, cap: 5, daily: 3 }),
  spendCoin: async () => ({ ok: true, coins: 2, cap: 5 }),
  getBest: async () => 0, saveBest() {}, result() {}, close() { location.reload(); }, onAlarm() {},
  saveScore() {}, getHistory: async () => [],
  async shareCard(dataUrl) { const a = document.createElement('a'); a.href = dataUrl; a.download = 'score.png'; a.click(); return { copied: false, saved: true }; },
};

const W = 480, H = 800;
const GROUND = 648;            // 이삭이 발이 닿는 높이 (배경의 논두렁 길 가운데)
const ISAK_X = 110, ISAK_H = 96;
const G = 2400, JUMP_V = -760, DOUBLE_V = -640, HOLD_SEC = 0.22, HOLD_G = 0.45, DIVE_G = 3;
const SPEED0 = 300, SPEED_UP = 4, SPEED_MAX = 800;   // px/s, 초당 가속, 최고 속도
const SEASON_SEC = 30, HEARTS = 3, PX_PER_M = 12;
const BG_PARALLAX = 0.4;
const MAGNET_SEC = 8, GOLDEN_SEC = 5, GOLDEN_BOOST = 1.35, ITEM_EVERY = 14;

// ---------- 계절 ----------
// dy: 배경을 위아래로 옮겨서 계절마다 논두렁 길이 GROUND에 오게 (원본 그림마다 길 높이가 조금씩 다름)
const SEASONS = [
  { key: 'spring', name: '봄',   icon: '🌸', dy: -30, tuft: '#8f9a4a', crop: 'strawberry', pool: { rock: 3, jar: 2, fence: 2, scarecrow: 2, frog: 2 } },
  { key: 'summer', name: '여름', icon: '☀️', dy: -29, tuft: '#6f8f3a', crop: 'watermelon', pool: { rock: 3, puddle: 3, jar: 2, fence: 2, scarecrow: 2, boar: 1 } },
  { key: 'autumn', name: '가을', icon: '🍂', dy: -15, tuft: '#a07a3a', crop: 'persimmon',  pool: { bale: 3, scarecrow: 2, rock: 2, fence: 2, jar: 1, boar: 1.5, bird: 1.5 } },
  { key: 'winter', name: '겨울', icon: '❄️', dy: -5,  tuft: '#b8c6d0', crop: 'sweetpotato', pool: { snowman: 3, rock: 2, fence: 2, jar: 1, boar: 2, bird: 2 } },
];
// 장애물: h 화면 높이(이삭이 키 96 기준으로 실제 크기 느낌), hx·hy 맞는 범위(가로·세로 비율), low 낮아서 겹쳐 놓기 좋은 것
// 점프 높이: 톡 ≈ 120, 길게 ≈ 200, 2단 점프 ≈ 300+ → 낮은 건 톡, 허수아비·눈사람은 길게, 곤포는 2단 점프로만
const OBST = {
  rock:      { h: 40,  hx: 0.75, hy: 0.8, low: true, color: '#9a9a9a' },
  puddle:    { h: 30,  hx: 0.8,  hy: 0.6, low: true, sink: 8, wide: [1.5, 2.3], color: '#b08a60' },   // 폭이 매번 달라짐
  frog:      { h: 44,  hx: 0.6,  hy: 0.8, color: '#5fae3c' },
  fence:     { h: 64,  hx: 0.8,  hy: 0.85, color: '#a0603a' },
  jar:       { h: 70,  hx: 0.7,  hy: 0.9, color: '#7a4a2a' },
  boar:      { h: 66,  hx: 0.7,  hy: 0.75, color: '#7a4a2a' },
  snowman:   { h: 110, hx: 0.55, hy: 0.9, outline: true, color: '#f4f6f8' },
  scarecrow: { h: 140, hx: 0.3,  hy: 0.92, color: '#c8a060' },
  bale:      { h: 172, hx: 0.78, hy: 0.88, color: '#e8e2d0' },   // 볏짚 곤포: 길게 누르거나 2단 점프
};

// ---------- 이미지 ----------
// img/<이름>.png 이 있으면 그걸 쓰고, 없으면 fallback(과수원 게임 그림), 그것도 없으면 직접 그림
const IMG = {};
function loadImg(name, src, fallback) {
  const i = new Image();
  i.onerror = () => { if (fallback && !i.dataset.fb) { i.dataset.fb = 1; i.src = fallback; } else IMG[name] = null; };
  i.src = src; IMG[name] = i;
}
SEASONS.forEach(s => loadImg('bg_' + s.key, `img/bg_${s.key}.jpg`));
Object.keys(OBST).filter(k => k !== 'boar').forEach(k => loadImg(k, `img/${k}.png`));
loadImg('boarA', 'img/boar_runA.png'); loadImg('boarB', 'img/boar_runB.png');
// 이삭이 옆모습이 생기면 img/isak_side_*.png 로 넣기만 하면 바뀜 (지금은 정면 그림을 좌우로 뒤집어 씀)
loadImg('runA', 'img/isak_side_runA.png', '../game/img/isak_runA.png');
loadImg('runB', 'img/isak_side_runB.png', '../game/img/isak_runB.png');
loadImg('jump', 'img/isak_side_jump.png', '../game/img/isak_runA.png');
loadImg('fall', 'img/isak_side_fall.png', '../game/img/isak_hit.png');
['isak_win', 'isak_over', 'bird_up', 'bird_down', 'apple', 'persimmon', 'item_umbrella', 'item_magnet', 'item_golden_ear', 'isak_umbrella']
  .forEach(n => loadImg(n, `../game/img/${n}.png`));
loadImg('strawberry', 'img/strawberry.png'); loadImg('watermelon', 'img/watermelon.png'); loadImg('sweetpotato', 'img/sweetpotato.png');
loadImg('coin', 'img/coin.png');
const ready = (im) => im && im.complete && im.naturalWidth;
const flipped = (im) => im && im.dataset.fb;   // 정면 그림으로 대신 쓸 땐 망토가 뒤로 가게 뒤집음

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
    jump() { tone(420, 0.1, 'square', 0.15, 300); },
    double() { tone(620, 0.1, 'square', 0.15, 400); },
    coin() { tone(1320, 0.05, 'square', 0.12); tone(1760, 0.07, 'square', 0.12, 0, 0.05); },
    crop() { [784, 988, 1175].forEach((f, i) => tone(f, 0.08, 'square', 0.18, 0, i * 0.05)); },
    item() { [523, 784, 1047, 1319].forEach((f, i) => tone(f, 0.1, 'square', 0.2, 0, i * 0.06)); },
    hit() { tone(160, 0.25, 'sawtooth', 0.3, -80); },
    block() { tone(300, 0.15, 'triangle', 0.3, 200); },
    goldenEnd() { [1047, 784, 523].forEach((f, i) => tone(f, 0.08, 'triangle', 0.18, 0, i * 0.07)); },
    smash() { tone(200, 0.15, 'square', 0.25, 400); },
    warn() { tone(880, 0.08, 'square', 0.15); tone(880, 0.08, 'square', 0.15, 0, 0.14); },
    season() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.12, 'square', 0.25, 0, i * 0.09)); },
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
  t: 0, speed: SPEED0, dist: 0, bonus: 0, hearts: HEARTS, season: 0, prevSeason: 0, fade: 1, year: 1,
  y: GROUND, vy: 0, jumps: 0, holding: false, holdT: 0, diving: false, spin: 0,
  invuln: 0, hurt: 0, shield: false, magnet: 0, golden: 0, dying: 0,
  things: [], fx: [], weather: [], toasts: [],
  gapLeft: 500, itemT: ITEM_EVERY, bgX: 0, groundX: 0,
  coinsGot: 0, cropsGot: 0, jumpsMade: 0, smashed: 0, cleared: false,
  best: 0, coins: 0, cap: 3,
};
function show(id) { document.querySelectorAll('.screen').forEach(e => e.classList.toggle('on', e.id === id)); }
const rnd = (a, b) => a + Math.random() * (b - a);
const score = () => Math.floor(S.dist) + S.bonus;
function toast(text, color = '#fffbe6', size = 26) { S.toasts.push({ text, color, size, t: 0 }); if (S.toasts.length > 3) S.toasts.shift(); }
function pick(pool) {
  const ent = Object.entries(pool), sum = ent.reduce((a, [, w]) => a + w, 0);
  let r = Math.random() * sum;
  for (const [k, w] of ent) { r -= w; if (r < 0) return k; }
  return ent[0][0];
}
function obstWidth(type) {
  const o = OBST[type], im = type === 'boar' ? IMG.boarA : IMG[type];
  return ready(im) ? o.h * im.naturalWidth / im.naturalHeight : o.h * 1.1;
}

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
  Object.assign(S, { t: 0, speed: SPEED0, dist: 0, bonus: 0, hearts: HEARTS, season: 0, prevSeason: 0, fade: 1, year: 1,
    y: GROUND, vy: 0, jumps: 0, holding: false, holdT: 0, diving: false, spin: 0,
    invuln: 0, hurt: 0, shield: false, magnet: 0, golden: 0, dying: 0,
    things: [], fx: [], weather: [], toasts: [], gapLeft: 500, itemT: ITEM_EVERY, bgX: 0, groundX: 0,
    coinsGot: 0, cropsGot: 0, jumpsMade: 0, smashed: 0, cleared: false, paused: false });
  S.screen = 'play'; show(''); sfx.season(); bgm.play();
  toast('🌸 봄, 출발!');
}
// ---------- 게임 방법: 처음 시작할 때 한 번, 인트로의 ❓ 버튼으로 다시 보기 ----------
// 본 적 있는지는 이 게임 창의 localStorage에만 기억 (못 읽으면 그냥 다시 보여줌)
const HOWTO_KEY = 'runner.howtoSeen';
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

const seasonLabel = () => `${S.year}년차 ${SEASONS[S.season].name}`;
function endGame() {
  if (S.screen !== 'play') return;
  S.screen = 'result'; show('result'); bgm.stop();
  const sc = score(), isBest = sc > S.best;
  if (isBest) { S.best = sc; bridge.saveBest(sc); }
  $('resultTitle').textContent = S.cleared ? '한 해 농사 완주!' : '넘어졌어요';
  $('resultScore').textContent = sc.toLocaleString();
  $('resultBest').textContent = isBest ? '🏆 최고 기록 갱신!' : `BEST ${S.best.toLocaleString()}`;
  const sec = Math.floor(S.t);
  $('resultStats').innerHTML = `<span>달린 거리 <b>${Math.floor(S.dist).toLocaleString()}m</b></span><span>도착한 계절 <b>${seasonLabel()}</b></span>` +
    `<span>볍씨 코인 <b>${S.coinsGot}개</b></span><span>계절 작물 <b>${S.cropsGot}개</b></span>` +
    `<span>달린 시간 <b>${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}</b></span><span>날려 버린 장애물 <b>${S.smashed}개</b></span>`;
  bridge.saveScore({ score: sc, cleared: S.cleared, dist: Math.floor(S.dist), year: S.year, season: S.season, coins: S.coinsGot, sec, date: new Date().toISOString() });
  bridge.getCoins().then(c => { S.coins = c.coins; S.cap = c.cap; $('retryBtn').textContent = retryText(c); $('retryBtn').disabled = S.coins <= 0; });
  $('shareBtn').textContent = '📸 점수 카드 복사·저장';
  sfx.over();
  bridge.result({ score: sc, best: isBest, cleared: S.cleared });
}
function pause(reason) {
  if (S.screen !== 'play') return;
  S.paused = true; S.holding = false; bgm.pause();
  $('pauseTitle').textContent = reason ? '⏰ 근무확인!' : '일시정지';
  $('pauseText').innerHTML = reason ? `${reason}<br>이삭이를 확인하고 돌아오세요` : 'ESC로 계속';
  show('pause');
}
function resume() { if (S.screen === 'play') { S.paused = false; show(''); bgm.play(); } }

// ---------- 점프 ----------
const onGround = () => S.y >= GROUND && S.vy >= 0;
function press() {
  if (S.screen !== 'play' || S.paused || S.dying) return;
  if (onGround()) { S.vy = JUMP_V; S.jumps = 1; S.holding = true; S.holdT = 0; S.diving = false; S.jumpsMade++; sfx.jump(); dust(ISAK_X, GROUND, 5); }
  else if (S.jumps < 2) { S.vy = DOUBLE_V; S.jumps = 2; S.holding = true; S.holdT = 0; S.diving = false; S.spin = 1; sfx.double(); }
}
function release() { S.holding = false; }

// ---------- 나오는 것들 ----------
function spawnObstacle(type, x = W + 40) {
  if (type === 'bird') { S.things.push({ kind: 'bird', x, y: GROUND - 150, w: 54, h: 46, t: 0 }); coinRow(x - 40, 5, GROUND - 40); return; }
  if (type === 'boar') { S.things.push({ kind: 'warn', x: W - 26, t: 0, life: 0.9 }); sfx.warn(); return; }
  const wide = OBST[type].wide ? rnd(...OBST[type].wide) : 1;
  const o = { kind: 'obst', type, x, w: obstWidth(type) * wide, h: OBST[type].h, t: rnd(0, 6), hop: 0 };
  S.things.push(o);
  return o;
}
function coinRow(x, n, y) { for (let i = 0; i < n; i++) S.things.push({ kind: 'coin', x: x + i * 34, y, r: 11 }); }
function coinArc(cx, n, top) {   // 장애물 위로 점프 궤적을 따라
  for (let i = 0; i < n; i++) { const k = i / (n - 1) - 0.5; S.things.push({ kind: 'coin', x: cx + k * 170, y: top + k * k * 260, r: 11 }); }
}
function spawnNext() {
  const se = SEASONS[S.season], minGap = S.speed * 0.9 + 80;
  // 아이템: 일정 시간마다 점프해야 닿는 높이에
  if (S.itemT <= 0) {
    S.itemT = ITEM_EVERY + rnd(-3, 3);
    const type = pick({ umbrella: S.shield ? 0 : 3, magnet: 3, golden: 2 });
    S.things.push({ kind: 'item', type, x: W + 40, y: GROUND - 130, t: 0 });
    S.gapLeft = minGap * 0.8; return;
  }
  const r = Math.random();
  if (r < 0.12) {   // 쉬어 가는 코인 줄
    coinRow(W + 40, 6, GROUND - 30); S.gapLeft = minGap; return;
  }
  if (r < 0.2) {    // 계절 작물: 점프해서 먹기
    S.things.push({ kind: 'crop', type: se.crop, x: W + 40, y: GROUND - 150, t: 0 });
    S.gapLeft = minGap * 0.7; return;
  }
  if (r < 0.28) {   // 하늘 코인: 2단 점프로만 닿는 높이 (한 번 점프로는 이삭이 머리가 ~280까지)
    const n = 7, top = GROUND - rnd(315, 340);
    for (let i = 0; i < n; i++) { const k = i / (n - 1) - 0.5; S.things.push({ kind: 'coin', x: W + 40 + i * 30, y: top + k * k * 80, r: 11 }); }
    S.gapLeft = minGap + n * 30; return;
  }
  const type = pick(se.pool);
  const o = spawnObstacle(type);
  if (o && OBST[type].low && S.t > 20 && Math.random() < 0.35) {   // 낮은 것 둘 연달아: 길게 눌러 멀리
    const o2 = spawnObstacle(pick({ rock: 1, puddle: S.season === 1 ? 1 : 0, jar: 0.5 }), o.x + o.w + 60);
    S.gapLeft = minGap + (o2.x - o.x); return;
  }
  if (o && Math.random() < 0.4) coinArc(o.x + o.w / 2, 5, GROUND - o.h - 45);
  // 장애물 폭만큼 더 띄우고, 2단 점프가 필요한 곤포 뒤엔 내려올 시간을 더
  S.gapLeft = rnd(minGap, minGap * 1.7) + (o ? o.w : 0) + (type === 'bale' ? S.speed * 0.5 : 0);
}

// ---------- 효과 ----------
function dust(x, y, n) { for (let i = 0; i < n; i++) S.fx.push({ x: x + rnd(-10, 10), y: y - 4, vx: rnd(-140, -40), vy: rnd(-60, -10), color: 'rgba(255,250,235,.8)', size: rnd(4, 8), t: 0, life: rnd(0.3, 0.5) }); }
function burst(x, y, color, n = 8, speed = 160) {
  for (let i = 0; i < n; i++) { const a = rnd(0, 6.28), s = rnd(speed * 0.4, speed); S.fx.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 60, color, size: rnd(4, 8), t: 0, life: rnd(0.35, 0.6), grav: 500 }); }
}
function popText(x, y, text, color = '#ffd93c', size = 16) { S.fx.push({ x, y, text, color, size, t: 0, life: 0.8 }); }
function weatherTick(dt) {
  const k = SEASONS[S.season].key;
  if (k !== 'summer' && S.weather.length < (k === 'winter' ? 70 : 26) && Math.random() < dt * (k === 'winter' ? 40 : 10))
    S.weather.push({ x: rnd(0, W + 120), y: -10, vx: rnd(-60, -20), vy: rnd(40, 90), r: rnd(2, 5), rot: rnd(0, 6), kind: k });
  for (const p of S.weather) { p.x += (p.vx - S.speed * 0.15) * dt; p.y += p.vy * dt; p.rot += dt * 2; }
  S.weather = S.weather.filter(p => p.y < H && p.x > -20);
}

// ---------- 게임 루프 ----------
function isakBox() { return { l: ISAK_X - 18, r: ISAK_X + 18, t: S.y - 72, b: S.y - 6 }; }
function hitBox(o) {
  if (o.kind === 'bird') return { l: o.x - 20, r: o.x + 20, t: o.y - 16, b: o.y + 16 };
  const d = OBST[o.type], base = GROUND - o.hop;
  return { l: o.x + o.w * (1 - d.hx) / 2, r: o.x + o.w * (1 + d.hx) / 2, t: base - o.h * d.hy, b: base };
}
const overlap = (a, b) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
function hurt(o) {
  if (S.golden > 0) {   // 황금 질주: 장애물을 날려 버림
    o.flying = { vx: rnd(200, 360), vy: -520, rot: 0 }; S.smashed++; S.bonus += 30; popText(o.x + o.w / 2, GROUND - o.h - 10, '+30'); sfx.smash(); return;
  }
  if (S.invuln > 0) return;
  if (S.shield) { S.shield = false; S.invuln = 1; sfx.block(); burst(ISAK_X, S.y - 50, '#e8434b', 12); toast('우산이 막아 줬어요!', '#fff', 20); return; }
  S.hearts--; S.invuln = 1.4; S.hurt = 0.5; sfx.hit(); burst(ISAK_X, S.y - 40, '#fff', 10);
  if (S.hearts <= 0) { S.dying = 1.2; S.vy = -600; S.holding = false; }
}
function collect(o) {
  o.gone = true;
  if (o.kind === 'coin') { S.coinsGot++; S.bonus += 10; sfx.coin(); burst(o.x, o.y, '#ffd93c', 4, 90); }
  else if (o.kind === 'crop') { S.cropsGot++; S.bonus += 50; sfx.crop(); popText(o.x, o.y - 30, '+50'); burst(o.x, o.y, '#ff8a65', 10); }
  else if (o.kind === 'item') {
    sfx.item(); burst(o.x, o.y, '#fffbe6', 14, 200);
    if (o.type === 'umbrella') { S.shield = true; toast('☂ 우산! 한 번 막아 줘요', '#fff', 20); }
    if (o.type === 'magnet') { S.magnet = MAGNET_SEC; toast('🧲 자석! 코인이 날아와요', '#fff', 20); }
    if (o.type === 'golden') { S.golden = GOLDEN_SEC; toast('🌾 황금 질주!', '#ffd93c'); }
  }
}
function update(dt) {
  S.t += dt;
  // 죽는 중: 이삭이가 튀어 오르며 쓰러지고 화면이 멈춤
  if (S.dying) {
    S.dying -= dt; S.speed = Math.max(0, S.speed - 900 * dt);
    S.vy += G * dt; S.y = Math.min(GROUND + 30, S.y + S.vy * dt);
    if (S.dying <= 0) { endGame(); return; }
  } else {
    S.speed = Math.min(SPEED_MAX, SPEED0 + SPEED_UP * S.t);
    // 계절·해 바뀜
    const total = Math.floor(S.t / SEASON_SEC), season = total % 4, year = Math.floor(total / 4) + 1;
    if (season !== S.season) {
      S.prevSeason = S.season; S.season = season; S.fade = 0; sfx.season();
      if (year > S.year) { S.year = year; S.cleared = true; S.hearts = Math.min(HEARTS, S.hearts + 1); toast(`🎉 ${year}년차! 하트 +1`, '#ffd93c'); }
      else toast(`${SEASONS[season].icon} ${SEASONS[season].name}이 왔어요!`, '#fff');
    }
    // 점프: 누르고 있는 동안은 덜 떨어짐(더 높이), ↓는 빨리 내려옴
    if (S.holding) S.holdT += dt;
    const g = S.vy < 0 && S.holding && S.holdT < HOLD_SEC ? G * HOLD_G : S.diving ? G * DIVE_G : G;
    S.vy += g * dt; S.y += S.vy * dt;
    if (S.y >= GROUND) { if (S.jumps) dust(ISAK_X, GROUND, 4); S.y = GROUND; S.vy = 0; S.jumps = 0; S.diving = false; }
    S.spin = Math.max(0, S.spin - dt * 2.5);
  }
  const fast = S.golden > 0 ? GOLDEN_BOOST : 1, v = S.speed * fast;
  S.dist += v * dt / PX_PER_M;
  S.bgX += v * BG_PARALLAX * dt; S.groundX += v * dt;
  S.fade = Math.min(1, S.fade + dt / 1.5);
  const wasGolden = S.golden > 0;
  for (const k of ['invuln', 'hurt', 'magnet', 'golden']) S[k] = Math.max(0, S[k] - dt);
  if (S.golden > 0 && Math.random() < dt * 30)   // 황금 가루가 뒤로 흩날림
    S.fx.push({ x: ISAK_X + rnd(-20, 10), y: S.y - rnd(10, 80), vx: rnd(-260, -120), vy: rnd(-40, 40), color: Math.random() < 0.5 ? '#ffd93c' : '#fff6c8', size: rnd(3, 6), t: 0, life: rnd(0.4, 0.7) });
  if (wasGolden && !S.golden) { popText(ISAK_X, S.y - 110, '질주 끝!', '#fff', 16); sfx.goldenEnd(); }
  if (!S.dying) {
    S.itemT -= dt;
    S.gapLeft -= v * dt;
    if (S.gapLeft <= 0) spawnNext();
  }
  if (!S.dying && S.y >= GROUND && Math.random() < dt * 8) dust(ISAK_X - 14, GROUND, 1);

  const me = isakBox();
  for (const o of S.things) {
    o.t = (o.t || 0) + dt;
    if (o.flying) { o.x += o.flying.vx * dt; o.y0 = (o.y0 || 0) - o.flying.vy * dt; o.flying.vy += G * dt; o.flying.rot += dt * 8; if (o.y0 < -300) o.gone = true; continue; }
    o.x -= v * dt;
    if (o.kind === 'warn') {   // 경고가 끝나면 멧돼지가 화면 밖에서 돌진
      if (o.t >= o.life) { o.gone = true; S.things.push({ kind: 'obst', type: 'boar', x: W + 20, w: obstWidth('boar'), h: OBST.boar.h, t: 0, hop: 0, run: 170 }); }
      o.x += v * dt; continue;
    }
    if (o.run) o.x -= o.run * dt;
    if (o.kind === 'bird') o.x -= 50 * dt;
    if (o.type === 'frog') o.hop = Math.max(0, Math.sin(o.t * 4.2)) * 70;   // 개구리는 폴짝폴짝
    if (o.kind === 'coin' && S.magnet > 0) {
      const dx = ISAK_X - o.x, dy = S.y - 40 - o.y, d = Math.hypot(dx, dy);
      if (d < 280) { o.x += dx / d * 700 * dt + v * dt * 0.5; o.y += dy / d * 700 * dt; }
    }
    if (o.gone || S.dying) continue;
    if (o.kind === 'obst' || o.kind === 'bird') { if (overlap(me, hitBox(o))) hurt(o); }
    else if (o.kind === 'coin' || o.kind === 'crop' || o.kind === 'item') {
      const rr = o.kind === 'coin' ? 14 : 26;
      if (o.x + rr > me.l && o.x - rr < me.r && o.y + rr > me.t && o.y - rr < me.b) collect(o);
    }
  }
  S.things = S.things.filter(o => !o.gone && o.x > -200);

  for (const f of S.fx) { f.t += dt; if (f.vx !== undefined) { f.x += f.vx * dt; f.y += f.vy * dt; f.vy += (f.grav || 0) * dt; } else if (f.text) f.y -= 40 * dt; }
  S.fx = S.fx.filter(f => f.t < f.life);
  for (const tt of S.toasts) tt.t += dt;
  S.toasts = S.toasts.filter(tt => tt.t < 2);
  weatherTick(dt);
}

// ---------- 그리기 ----------
function text(str, x, y, { size = 16, color = '#fff', align = 'left', font = 'Galmuri11', outline = '#2b3a2e' } = {}) {
  ctx.font = `${size}px ${font}`; ctx.textAlign = align; ctx.textBaseline = 'top';
  if (outline) { ctx.lineWidth = 4; ctx.strokeStyle = outline; ctx.lineJoin = 'round'; ctx.strokeText(str, x, y); }
  ctx.fillStyle = color; ctx.fillText(str, x, y);
}
const EMOJI = '"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
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
// 배경: 한 장을 좌우로 번갈아 뒤집어 이어 붙여서 끝없이 흐르게
function drawBg(idx, alpha) {
  const se = SEASONS[idx], im = IMG['bg_' + se.key];
  ctx.save(); ctx.globalAlpha = alpha;
  if (ready(im)) {
    const tw = W, th = im.naturalHeight * W / im.naturalWidth, off = S.bgX % (tw * 2);
    for (let i = -1; i < 3; i++) {
      const x = i * tw - off;
      if (x > W || x + tw < 0) continue;
      ctx.save();
      if (((i % 2) + 2) % 2) { ctx.translate(x + tw, se.dy); ctx.scale(-1, 1); ctx.drawImage(im, 0, 0, tw, th); }
      else ctx.drawImage(im, x, se.dy, tw, th);
      ctx.restore();
    }
  } else {
    ctx.fillStyle = ['#bfe6ff', '#8fd0ff', '#bfe0f5', '#dfe7ee'][idx]; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = ['#a8d88a', '#7cc35a', '#e0b860', '#f0f4f7'][idx]; ctx.fillRect(0, GROUND - 10, W, H);
  }
  ctx.restore();
}
function drawGround() {
  // 길 위 작은 풀·자갈이 빠르게 흘러서 속도감
  const se = SEASONS[S.season], step = 46, off = S.groundX % step;
  ctx.fillStyle = se.tuft;
  for (let x = -off; x < W + step; x += step) {
    const k = Math.floor((x + S.groundX) / step) * 9301 % 7;
    ctx.globalAlpha = 0.55;
    if (k < 3) { ctx.fillRect(x, GROUND + 10 + k * 3, 6, 3); ctx.fillRect(x + 9, GROUND + 12 + k * 2, 3, 2); }
    else if (k < 5) { ctx.beginPath(); ctx.moveTo(x, GROUND + 18); ctx.lineTo(x + 3, GROUND + 9); ctx.lineTo(x + 6, GROUND + 18); ctx.fill(); }
  }
  ctx.globalAlpha = 1;
}
function shadow(x, w, lift = 0) {
  const k = Math.max(0.3, 1 - lift / 200);
  ctx.fillStyle = `rgba(40,50,40,${0.22 * k})`; ctx.beginPath(); ctx.ellipse(x, GROUND + 2, w * 0.45 * k, 6 * k, 0, 0, 6.29); ctx.fill();
}
function drawObstacle(o) {
  const d = OBST[o.type], base = GROUND - o.hop + (d.sink || 0) - (o.y0 || 0);
  const im = o.type === 'boar' ? (Math.floor(o.t * 10) % 2 ? IMG.boarB : IMG.boarA) : IMG[o.type];
  if (!o.flying) shadow(o.x + o.w / 2, o.w, o.hop);
  ctx.save();
  const bob = o.type === 'boar' ? Math.abs(Math.sin(o.t * 14)) * 4 : 0;
  ctx.translate(o.x + o.w / 2, base - o.h / 2 - bob);
  if (o.flying) ctx.rotate(o.flying.rot);
  if (ready(im)) {
    if (d.outline) {   // 눈밭에서도 보이게 그림자 테두리
      ctx.shadowColor = 'rgba(40,60,80,.65)'; ctx.shadowBlur = 6;
    }
    ctx.drawImage(im, -o.w / 2, -o.h / 2, o.w, o.h);
  } else { ctx.fillStyle = d.color; ctx.fillRect(-o.w / 2, -o.h / 2, o.w, o.h); }
  ctx.restore();
  if (o.type === 'boar' && Math.floor(o.t * 6) % 3 === 0) { ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.beginPath(); ctx.arc(o.x - 8, base - o.h * 0.45, 6, 0, 6.29); ctx.fill(); }   // 콧김
  if (o.type === 'puddle' && S.season === 1) {   // 여름 장마 물빛
    ctx.fillStyle = 'rgba(120,190,240,.45)'; ctx.beginPath(); ctx.ellipse(o.x + o.w / 2, base - o.h * 0.45, o.w * 0.36, o.h * 0.2, 0, 0, 6.29); ctx.fill();
  }
}
function drawCoin(o) {
  const im = IMG.coin, sq = Math.abs(Math.cos(S.t * 4 + o.x * 0.02));
  if (ready(im)) { ctx.drawImage(im, o.x - 13 * sq, o.y - 13, 26 * sq, 26); return; }
  ctx.save(); ctx.translate(o.x, o.y); ctx.scale(Math.max(0.15, sq), 1);
  ball(o.r, '#f5c518'); ctx.strokeStyle = '#c89310'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, o.r - 2, 0, 6.29); ctx.stroke();
  ctx.fillStyle = '#fff6c8'; ctx.beginPath(); ctx.ellipse(0, 0, 3, 6, 0.3, 0, 6.29); ctx.fill();   // 볍씨
  ctx.restore();
}
function drawCrop(o) {
  const y = o.y + Math.sin(o.t * 4) * 5, im = IMG[o.type];
  ctx.fillStyle = 'rgba(255,255,220,.5)'; ctx.beginPath(); ctx.arc(o.x, y, 24, 0, 6.29); ctx.fill();
  if (ready(im)) { ctx.drawImage(im, o.x - 22, y - 22, 44, 44); return; }
  ctx.save(); ctx.translate(o.x, y);
  if (o.type === 'strawberry') { ball(15, '#e8434b', 0, 3); ctx.fillStyle = '#5fae3c'; ctx.fillRect(-9, -14, 18, 5); ctx.fillStyle = '#ffe58a'; for (let i = 0; i < 6; i++) ctx.fillRect(Math.cos(i * 2.3) * 8 - 1, Math.sin(i * 2.3) * 7 + 4, 2, 3); }
  else if (o.type === 'watermelon') { ball(17, '#2f9e44'); ctx.strokeStyle = '#174d22'; ctx.lineWidth = 3; for (const k of [-8, 0, 8]) { ctx.beginPath(); ctx.moveTo(k, -15); ctx.quadraticCurveTo(k * 1.6, 0, k, 15); ctx.stroke(); } }
  else if (o.type === 'sweetpotato') { ctx.rotate(-0.4); ctx.fillStyle = '#9b3d5a'; ctx.beginPath(); ctx.ellipse(0, 0, 20, 11, 0, 0, 6.29); ctx.fill(); ctx.fillStyle = '#f5c542'; ctx.beginPath(); ctx.ellipse(6, -2, 9, 6, 0, 0, 6.29); ctx.fill(); }
  else if (ready(IMG.persimmon)) ctx.drawImage(IMG.persimmon, -22, -22, 44, 44);
  else ball(16, '#f08a24');
  ctx.restore();
}
function drawItem(o) {
  const y = o.y + Math.sin(o.t * 5) * 6, im = IMG['item_' + { umbrella: 'umbrella', magnet: 'magnet', golden: 'golden_ear' }[o.type]];
  ctx.fillStyle = `rgba(255,255,255,${0.35 + 0.2 * Math.sin(o.t * 8)})`; ctx.beginPath(); ctx.arc(o.x, y, 28, 0, 6.29); ctx.fill();
  if (ready(im)) ctx.drawImage(im, o.x - 26, y - 26, 52, 52);
  else emoji({ umbrella: '☂️', magnet: '🧲', golden: '🌾' }[o.type], o.x, y, 34);
}
function drawBird(o) {
  const im = Math.floor(o.t * 7) % 2 ? IMG.bird_down : IMG.bird_up;
  if (ready(im)) ctx.drawImage(im, o.x - 30, o.y - 30, 60, 60); else emoji('🐦', o.x, o.y, 40);
}
// 황금 질주: 빛·회전하는 햇살·잔상 + 남은 시간 고리. 끝나기 1.5초 전부터 빠르게 깜빡임
function drawGoldenAura(im) {
  const cx = ISAK_X, cy = S.y - 45, k = S.golden / GOLDEN_SEC;
  const ending = S.golden < 1.5, blinkOff = ending && Math.floor(S.t * (S.golden < 0.7 ? 14 : 8)) % 2;
  const pulse = 1 + Math.sin(S.t * 10) * 0.08;
  ctx.save();
  if (!blinkOff) {
    // 잔상: 뒤로 두 개, 옅게
    if (ready(im)) for (const [dx, a] of [[-34, 0.18], [-18, 0.3]]) {
      ctx.save(); ctx.globalAlpha = a; ctx.translate(cx + dx, S.y - ISAK_H / 2); if (flipped(im)) ctx.scale(-1, 1);
      ctx.drawImage(im, -ISAK_H / 2, -ISAK_H / 2, ISAK_H, ISAK_H); ctx.restore();
    }
    // 큰 빛
    const g = ctx.createRadialGradient(cx, cy, 10, cx, cy, 95 * pulse);
    g.addColorStop(0, 'rgba(255,240,150,.85)'); g.addColorStop(0.5, 'rgba(255,215,70,.45)'); g.addColorStop(1, 'rgba(255,200,40,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, 95 * pulse, 0, 6.29); ctx.fill();
    // 회전하는 햇살
    ctx.translate(cx, cy); ctx.rotate(S.t * 2.5);
    ctx.fillStyle = 'rgba(255,236,140,.55)';
    for (let i = 0; i < 8; i++) { ctx.rotate(Math.PI / 4); ctx.beginPath(); ctx.moveTo(-5, 40); ctx.lineTo(0, 92 * pulse); ctx.lineTo(5, 40); ctx.fill(); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  // 남은 시간 고리 (깜빡여도 고리는 계속 보이게)
  ctx.lineWidth = 5; ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(80,60,0,.35)'; ctx.beginPath(); ctx.arc(cx, cy, 62, 0, 6.29); ctx.stroke();
  ctx.strokeStyle = ending ? '#ff8a3c' : '#ffd23c';
  ctx.beginPath(); ctx.arc(cx, cy, 62, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k); ctx.stroke();
  ctx.restore();
}
function drawIsak() {
  if (S.invuln > 0 && !S.dying && Math.floor(S.t * 14) % 2) return;   // 다친 직후 깜빡임
  const air = S.y < GROUND - 1;
  let im = S.dying || S.hurt > 0 ? IMG.fall : air ? IMG.jump : Math.floor(S.t * (6 + S.speed / 80)) % 2 ? IMG.runB : IMG.runA;
  if (!ready(im)) im = IMG.runA;
  shadow(ISAK_X, 50, GROUND - S.y);
  if (S.golden > 0) drawGoldenAura(im);
  ctx.save();
  ctx.translate(ISAK_X, S.y - ISAK_H / 2);
  if (S.dying) ctx.rotate(-(1.2 - S.dying) * 3);
  else if (S.spin) ctx.rotate((1 - S.spin) * Math.PI * 2);   // 2단 점프: 달리는 쪽(오른쪽)으로 앞구르기 = 시계 방향
  else if (air) ctx.rotate(S.vy < 0 ? -0.12 : 0.1);
  else ctx.translate(0, -Math.abs(Math.sin(S.t * 14)) * 3);   // 통통 뛰기
  const umbrella = S.shield && !S.dying;
  if (umbrella) drawUmbrella(air, 'back');                // 자루·우산은 이삭이 뒤로 (얼굴을 가리지 않게)
  ctx.save();
  if (flipped(im)) ctx.scale(-1, 1);
  if (ready(im)) ctx.drawImage(im, -ISAK_H / 2, -ISAK_H / 2, ISAK_H, ISAK_H); else { ctx.fillStyle = '#5ec4a5'; ctx.fillRect(-20, -40, 40, 80); }
  ctx.restore();
  if (umbrella) drawUmbrella(air, 'front');               // 손에 쥔 손잡이만 앞으로
  ctx.restore();
}
// 우산: 이삭이 몸과 같이 움직이게 같은 좌표계에서, 어깨 뒤로 걸쳐 쥐고 바람에 뒤로 젖혀진 모양
function drawUmbrella(air, part) {
  ctx.save();
  ctx.translate(20, 20);                                   // 손 위치 (오른쪽을 보고 달릴 때 앞쪽 손)
  ctx.rotate(-0.4 + (air ? -0.15 : Math.sin(S.t * 14) * 0.05));
  const top = -98, r = 46;
  ctx.strokeStyle = '#4a3a2a'; ctx.lineWidth = 3; ctx.lineCap = 'round';
  if (part === 'front') { ctx.beginPath(); ctx.arc(-5, 6, 5, 0, Math.PI); ctx.moveTo(0, 6); ctx.lineTo(0, -2); ctx.stroke(); ctx.restore(); return; }   // 손잡이 고리
  ctx.beginPath(); ctx.moveTo(0, 6); ctx.lineTo(0, top); ctx.stroke();                 // 자루
  const g = ctx.createLinearGradient(0, top - r * 0.6, 0, top + 6);
  g.addColorStop(0, '#f06a5a'); g.addColorStop(1, '#c8443a');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.moveTo(-r, top + 6);
  ctx.quadraticCurveTo(-r * 0.9, top - r * 0.75, 0, top - r * 0.75);
  ctx.quadraticCurveTo(r * 0.9, top - r * 0.75, r, top + 6);
  for (let i = 4; i >= 0; i--) { const x0 = -r + (i + 1) * r * 0.4, x1 = -r + i * r * 0.4; ctx.quadraticCurveTo((x0 + x1) / 2, top - 4, x1, top + 6); }   // 우산 살 사이 물결
  ctx.fill();
  ctx.strokeStyle = 'rgba(120,30,25,.5)'; ctx.lineWidth = 1.5;
  for (const k of [-0.6, -0.2, 0.2, 0.6]) { ctx.beginPath(); ctx.moveTo(0, top - r * 0.72); ctx.quadraticCurveTo(k * r * 0.8, top - r * 0.5, k * r * 1.2, top + 4); ctx.stroke(); }
  ctx.fillStyle = '#4a3a2a'; ctx.beginPath(); ctx.arc(0, top - r * 0.78, 3, 0, 6.29); ctx.fill();   // 꼭지
  ctx.restore();
}
function drawWeather() {
  for (const p of S.weather) {
    if (p.kind === 'winter') { ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 0.7, 0, 6.29); ctx.fill(); continue; }
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
    ctx.fillStyle = p.kind === 'spring' ? 'rgba(255,190,210,.9)' : 'rgba(230,120,40,.9)';
    ctx.beginPath(); ctx.ellipse(0, 0, p.r * 1.4, p.r * 0.8, 0, 0, 6.29); ctx.fill(); ctx.restore();
  }
}
function heart(x, y, full) {
  ctx.fillStyle = full ? '#ff5a6e' : 'rgba(255,255,255,.25)';
  ctx.beginPath(); ctx.moveTo(x, y + 5); ctx.bezierCurveTo(x, y, x - 9, y - 2, x - 9, y + 5); ctx.bezierCurveTo(x - 9, y + 11, x, y + 15, x, y + 18);
  ctx.bezierCurveTo(x, y + 15, x + 9, y + 11, x + 9, y + 5); ctx.bezierCurveTo(x + 9, y - 2, x, y, x, y + 5); ctx.fill();
}
function draw() {
  ctx.clearRect(0, 0, W, H);
  if (S.screen === 'intro') { drawBg(0, 1); return; }
  if (S.fade < 1) drawBg(S.prevSeason, 1);
  drawBg(S.season, S.fade);
  drawGround();

  for (const o of S.things) if (o.kind === 'coin') drawCoin(o);
  for (const o of S.things) {
    if (o.kind === 'obst') drawObstacle(o);
    else if (o.kind === 'crop') drawCrop(o);
    else if (o.kind === 'item') drawItem(o);
    else if (o.kind === 'bird') drawBird(o);
    else if (o.kind === 'warn') {   // 멧돼지 경고
      const a = Math.floor(o.t * 8) % 2;
      ctx.fillStyle = a ? '#d7451d' : '#ff8a65'; ctx.beginPath(); ctx.arc(o.x, GROUND - 40, 18, 0, 6.29); ctx.fill();
      text('!', o.x, GROUND - 54, { size: 24, align: 'center', font: 'Galmuri14', color: '#fff', outline: null });
      text('멧돼지!', o.x - 6, GROUND - 86, { size: 13, align: 'center', color: '#ffd93c' });
    }
  }
  drawIsak();
  drawWeather();

  for (const f of S.fx) {
    const k = f.t / f.life;
    if (f.text) { ctx.globalAlpha = Math.min(1, (1 - k) * 2); text(f.text, f.x, f.y, { size: f.size, align: 'center', color: f.color, font: 'Galmuri14' }); }
    else { ctx.globalAlpha = 1 - k; ctx.fillStyle = f.color; ctx.fillRect(f.x - f.size / 2, f.y - f.size / 2, f.size, f.size); }
  }
  ctx.globalAlpha = 1;
  S.toasts.forEach((tt, i) => { ctx.globalAlpha = tt.t < 1.5 ? 1 : 1 - (tt.t - 1.5) / 0.5; text(tt.text, W / 2, 250 + i * 34 - tt.t * 10, { size: tt.size, color: tt.color, align: 'center', font: 'Galmuri14' }); });
  ctx.globalAlpha = 1;

  // HUD: 하트 · 점수 · 거리
  ctx.fillStyle = 'rgba(43,58,46,.75)'; ctx.fillRect(0, 0, W, 46);
  for (let i = 0; i < HEARTS; i++) heart(22 + i * 24, 13, i < S.hearts);
  text(score().toLocaleString(), W / 2, 10, { size: 24, align: 'center', font: 'Galmuri14', outline: null, color: '#fffbe6' });
  text(`${Math.floor(S.dist).toLocaleString()}m`, W - 12, 14, { size: 15, align: 'right', outline: null, color: '#cfe9df' });
  // 계절 · 아이템 남은 시간
  const se = SEASONS[S.season];
  ctx.fillStyle = 'rgba(255,251,230,.9)'; ctx.beginPath(); ctx.roundRect(10, 54, 118, 28, 6); ctx.fill();
  ctx.strokeStyle = '#2b3a2e'; ctx.lineWidth = 2; ctx.stroke();
  emoji(se.icon, 26, 69, 16); text(seasonLabel(), 40, 60, { size: 14, outline: null, color: '#2b3a2e' });
  const sk = (S.t % SEASON_SEC) / SEASON_SEC;
  ctx.fillStyle = '#2a8c6e'; ctx.fillRect(14, 78, 110 * sk, 2);
  let ix = 140;
  for (const [on, ic, left] of [[S.shield, '☂️', ''], [S.magnet > 0, '🧲', Math.ceil(S.magnet)], [S.golden > 0, '🌾', Math.ceil(S.golden)]]) {
    if (!on) continue;
    ctx.fillStyle = 'rgba(255,251,230,.9)'; ctx.beginPath(); ctx.roundRect(ix, 54, left ? 52 : 30, 28, 6); ctx.fill(); ctx.stroke();
    emoji(ic, ix + 15, 69, 16); if (left) text(`${left}`, ix + 30, 60, { size: 14, outline: null, color: '#2b3a2e' });
    ix += (left ? 52 : 30) + 6;
  }
}

// ---------- 점수 카드 ----------
async function shareCard() {
  const dataUrl = scoreCard({ title: '이삭RUN', score: score(), best: S.best, bg: IMG['bg_' + SEASONS[S.season].key], bgY: 0.6,
    line: `${Math.floor(S.dist).toLocaleString()}m  ·  ${seasonLabel()}까지  ·  볍씨 ${S.coinsGot}개` });
  const r = await bridge.shareCard(dataUrl);
  $('shareBtn').textContent = r.copied ? '✅ 복사했어요 · 메신저에 붙여넣기' : '✅ 저장했어요';
}

// ---------- 입력 ----------
// Space·↑·W 또는 마우스로 점프 (길게 누르면 더 높이), ↓로 빨리 내려오기
$('howtoBtn').addEventListener('pointerup', () => { if (S.screen === 'intro') openHowto(false); });
$('nextBtn').onclick = howtoNext;
$('skipBtn').onclick = closeHowto;
const JUMP_KEYS = ['Space', 'ArrowUp', 'KeyW'];
addEventListener('keydown', (e) => {
  if (S.screen === 'howto') {
    if (e.code === 'Space' || e.code === 'Enter' || e.code === 'ArrowRight') { e.preventDefault(); if (!e.repeat) howtoNext(); }
    else if (e.code === 'ArrowLeft' && howtoPage > 0) { howtoPage--; renderHowto(); }
    else if (e.code === 'Escape') closeHowto();
    return;
  }
  if (JUMP_KEYS.includes(e.code)) {
    e.preventDefault();
    if (e.repeat) return;
    if (S.screen === 'play') press();
    else if (e.code === 'Space' && S.screen === 'intro') requestStart();
    else if (e.code === 'Space' && S.screen === 'result' && !$('retryBtn').disabled) startGame();
  }
  if (e.code === 'ArrowDown' && S.screen === 'play' && S.y < GROUND) { S.diving = true; S.holding = false; }
  if (e.code === 'Escape') { if (S.screen === 'play') (S.paused ? resume : pause)(); else if (S.screen === 'result') bridge.close(); }
  if (e.code === 'KeyM') $('mute').textContent = sfx.toggle() ? '🔇' : '🔊';
  if (e.code === 'KeyB') $('bgm').classList.toggle('off', !bgm.toggle());
});
addEventListener('keyup', (e) => { if (JUMP_KEYS.includes(e.code)) release(); });
canvas.addEventListener('pointerdown', press);
addEventListener('pointerup', release);
addEventListener('blur', () => { S.holding = false; if (S.screen === 'play' && !S.paused) pause(); });

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

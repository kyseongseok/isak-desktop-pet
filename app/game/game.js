// 과수원을 지켜라 — 떨어지는 과일은 받고, 새똥·우박·벌레·가지는 피하는 게임
'use strict';

// Electron 밖(브라우저 미리보기)에서 열면 가짜 브리지로 동작
// (contextBridge가 만든 window.game은 전역 선언으로 취급되므로 다른 이름으로 받음)
const bridge = window.game || {
  getCoins: async () => ({ coins: 3, cap: 5, daily: 3 }),
  spendCoin: async () => ({ ok: true, coins: 2, cap: 5 }),
  getBest: async () => 0, saveBest() {}, result() {}, close() { location.reload(); }, onAlarm() {},
  saveScore() {}, getHistory: async () => [],
  async shareCard(dataUrl) { const a = document.createElement('a'); a.href = dataUrl; a.download = 'score.png'; a.click(); return { copied: false, saved: true }; },
};

const W = 480, H = 800, GROUND = H - 28;
const LIMIT = 180;                       // 초: 이만큼 버티면 클리어
const STAGE_SEC = 30;
const MAX_HEARTS = 5;

// ---------- 이미지 ----------
const IMG = {};
const NAMES = ['bg', 'apple', 'pear', 'persimmon', 'poop', 'hail', 'bug', 'branch', 'bird_up', 'bird_down',
  'item_lightning', 'item_umbrella', 'item_golden_ear', 'item_magnet', 'item_sprout', 'item_turtle',
  'isak_basket', 'isak_hit', 'isak_umbrella', 'isak_over', 'isak_win', 'isak_happy'];
let loaded = 0;
NAMES.forEach(n => { const i = new Image(); i.src = `img/${n}.png`; i.onload = () => loaded++; IMG[n] = i; });

// ---------- 떨어지는 것들 정의 ----------
// 과일: 점수 / 위험물: 하트 -1 / 아이템: 효과
const FRUITS = { apple: { score: 10, size: 46, stage: 1 }, pear: { score: 15, size: 48, stage: 2 }, persimmon: { score: 20, size: 48, stage: 4 } };
const HAZARDS = { poop: { size: 44, stage: 1, speed: 1 }, hail: { size: 42, stage: 3, speed: 1.7 }, bug: { size: 46, stage: 4, speed: 0.9, zigzag: true }, branch: { size: 70, stage: 6, speed: 0.75 } };
const ITEMS = {
  lightning: { label: '번개', dur: 10 }, umbrella: { label: '우산', dur: 0 }, golden_ear: { label: '2배', dur: 10 },
  magnet: { label: '자석', dur: 10 }, sprout: { label: '하트', dur: 0 }, turtle: { label: '느리게', dur: 5 },
};

// ---------- 소리 (Web Audio 합성) ----------
const sfx = (() => {
  let ctx = null, master = null, muted = false;
  const get = () => { if (!ctx) { ctx = new AudioContext(); master = ctx.createGain(); master.gain.value = 0.25; master.connect(ctx.destination); } if (ctx.state === 'suspended') ctx.resume(); return ctx; };
  function tone(f, dur, type = 'square', gain = 0.3, slide = 0) {
    if (muted) return;
    const c = get(), o = c.createOscillator(), g = c.createGain(), t = c.currentTime;
    o.type = type; o.frequency.setValueAtTime(f, t); if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, f + slide), t + dur);
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
  }
  return {
    catch() { tone(880, 0.08, 'square', 0.25); setTimeout(() => tone(1320, 0.1, 'square', 0.2), 60); },
    hit() { tone(160, 0.25, 'sawtooth', 0.35, -120); },
    item() { [660, 880, 1100, 1320].forEach((f, i) => setTimeout(() => tone(f, 0.09, 'triangle', 0.3), i * 60)); },
    stage() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.12, 'square', 0.25), i * 90)); },
    over() { [392, 330, 262, 196].forEach((f, i) => setTimeout(() => tone(f, 0.25, 'triangle', 0.3), i * 180)); },
    win() { [523, 659, 784, 1047, 1319].forEach((f, i) => setTimeout(() => tone(f, 0.15, 'square', 0.25), i * 100)); },
    shield() { tone(440, 0.12, 'triangle', 0.3, 200); },
    toggle() { muted = !muted; return muted; },
  };
})();

// ---------- 배경음악 (music/bgm.ogg 또는 bgm.mp3가 있을 때만) ----------
const bgm = (() => {
  let audio = null, on = true, available = false;
  for (const f of ['music/bgm.m4a', 'music/bgm.ogg', 'music/bgm.mp3']) {
    if (audio) break;
    const a = new Audio(f); a.loop = true; a.volume = 0.18;
    a.addEventListener('canplaythrough', () => { available = true; }, { once: true });
    a.addEventListener('error', () => {}, { once: true });
    audio = a;
  }
  return {
    play() { if (audio && on) audio.play().catch(() => {}); },
    stop() { if (audio) { audio.pause(); audio.currentTime = 0; } },
    pause() { if (audio) audio.pause(); },
    toggle() { on = !on; if (!on) audio && audio.pause(); else if (S.screen === 'play') this.play(); return on; },
    get available() { return available; },
  };
})();

// ---------- 상태 ----------
const canvas = document.getElementById('c'), ctx = canvas.getContext('2d');
const dpr = Math.min(2, devicePixelRatio || 1);
canvas.width = W * dpr; canvas.height = H * dpr; ctx.scale(dpr, dpr);

const S = {
  screen: 'intro',            // intro | play | pause | result
  paused: false, pauseReason: '',
  t: 0, stage: 1, score: 0, hearts: MAX_HEARTS, hurtUntil: 0,
  player: { x: W / 2, dir: 1, speed: 320 },
  objs: [], bird: { x: -60, dir: 1, y: 110, flap: 0, nextPoop: 2 },
  spawnAt: 0, itemAt: 8, wind: 0, windAt: 0,
  fx: { lightning: 0, golden_ear: 0, magnet: 0, turtle: 0, shield: 0 },
  particles: [], toasts: [], caught: 0, dodged: 0, leaves: [], windT: 0, happyUntil: 0, windTarget: 0,
  keys: {}, best: 0, coins: 0, cap: 3,
};

// ---------- 화면 전환 ----------
const $ = (id) => document.getElementById(id);
function show(id) { document.querySelectorAll('.screen').forEach(e => e.classList.toggle('on', e.id === id)); }

async function refreshIntro() {
  const c = await bridge.getCoins(); S.coins = c.coins; S.cap = c.cap;
  S.best = await bridge.getBest();
  $('introCoins').textContent = `🪙 코인 ${S.coins}/${S.cap} · 1판 = 1코인`;
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
  Object.assign(S, { t: 0, stage: 1, score: 0, hearts: MAX_HEARTS, hurtUntil: 0, objs: [], particles: [], toasts: [],
    spawnAt: 1, itemAt: 8, wind: 0, windAt: 0, windTarget: 0, caught: 0, dodged: 0, paused: false, leaves: [], windT: 0, happyUntil: 0,
    fx: { lightning: 0, golden_ear: 0, magnet: 0, turtle: 0, shield: 0 } });
  S.player.x = W / 2; S.bird = { x: -60, dir: 1, y: 110, flap: 0, nextPoop: 2 };
  S.screen = 'play'; show(''); sfx.stage(); bgm.play();
  toast(`STAGE 1`, '#fff');
}

function endGame(cleared) {
  S.screen = 'result';
  const isBest = S.score > S.best;
  if (isBest) { S.best = S.score; bridge.saveBest(S.score); }
  $('resultTitle').textContent = cleared ? 'CLEAR!' : 'GAME OVER';
  $('resultScore').textContent = S.score.toLocaleString();
  $('resultBest').textContent = isBest ? '🏆 최고 기록 갱신!' : `BEST ${S.best.toLocaleString()}`;
  $('resultStats').textContent = `스테이지 ${S.stage} · 과일 ${S.caught}개 · ${Math.floor(S.t)}초`;
  bridge.saveScore({ score: S.score, stage: S.stage, cleared, caught: S.caught, date: new Date().toISOString() });
  bgm.stop();
  $('shareBtn').textContent = '📸 점수 카드 복사·저장';
  bridge.getCoins().then(c => { S.coins = c.coins; S.cap = c.cap;
    $('retryBtn').textContent = `다시 하기 (🪙 ${S.coins}/${S.cap})`; $('retryBtn').disabled = S.coins <= 0; });
  show('result');
  (cleared ? sfx.win : sfx.over)();
  bridge.result({ score: S.score, best: isBest, cleared });
}

function pause(reason) {
  if (S.screen !== 'play') return;
  bgm.pause();
  S.paused = true; S.pauseReason = reason || '';
  $('pauseTitle').textContent = reason ? '⏰ 근무확인!' : '일시정지';
  $('pauseText').innerHTML = reason ? `${reason}<br>이삭이를 확인하고 돌아오세요` : 'P 또는 ESC로 계속';
  show('pause');
}
function resume() { if (S.screen === 'play') { S.paused = false; show(''); bgm.play(); } }

// ---------- 게임 루프 ----------
const rnd = (a, b) => a + Math.random() * (b - a);
function toast(text, color = '#fffbe6') { S.toasts.push({ text, color, t: 0 }); }
function puff(x, y, color, n = 8) { for (let i = 0; i < n; i++) S.particles.push({ x, y, vx: rnd(-120, 120), vy: rnd(-200, -40), t: 0, color }); }

function spawn() {
  const st = S.stage;
  const pool = [];
  for (const [k, v] of Object.entries(FRUITS)) if (st >= v.stage) pool.push({ kind: 'fruit', name: k, w: 3 });
  // 초반엔 과일이 많고, 스테이지가 오를수록 위험물 비중이 늘어남
  for (const [k, v] of Object.entries(HAZARDS)) if (st >= v.stage) pool.push({ kind: 'hazard', name: k, w: (k === 'poop' ? 2.4 : 1.6) + st * 0.25 });
  const total = pool.reduce((s, p) => s + p.w, 0);
  let r = Math.random() * total, pick = pool[0];
  for (const p of pool) { r -= p.w; if (r <= 0) { pick = p; break; } }
  const def = pick.kind === 'fruit' ? FRUITS[pick.name] : HAZARDS[pick.name];
  const base = 215 + st * 38;
  S.objs.push({ kind: pick.kind, name: pick.name, size: def.size, x: rnd(40, W - 40), y: -50,
    vy: base * (def.speed || 1) * rnd(0.9, 1.15), vx: 0, phase: rnd(0, 6.28), zigzag: !!def.zigzag, score: def.score || 0 });
}
function spawnItem() {
  const names = Object.keys(ITEMS);
  const name = names[Math.floor(Math.random() * names.length)];
  S.objs.push({ kind: 'item', name, size: 56, x: rnd(50, W - 50), y: -50, vy: 150, vx: 0, phase: 0 });
}
function birdPoop() {
  S.objs.push({ kind: 'hazard', name: 'poop', size: 44, x: S.bird.x, y: S.bird.y + 20, vy: 180 + S.stage * 25, vx: 0, phase: 0, score: 0 });
}

function applyItem(name) {
  sfx.item();
  const now = S.t;
  if (name === 'sprout') { if (S.hearts < MAX_HEARTS) { S.hearts++; toast('하트 +1 💚'); } else { S.score += 50; toast('하트 가득! +50'); } return; }
  if (name === 'umbrella') { S.fx.shield = 2; toast('우산! 2번 막아요 ☂'); return; }
  S.fx[name] = now + ITEMS[name].dur;
  toast({ lightning: '번개! 빨라졌어요 ⚡', golden_ear: '점수 2배! ⭐', magnet: '자석! 과일이 끌려와요 🧲', turtle: '느리게~ 🐢' }[name]);
}

function hurt() {
  if (S.t < S.hurtUntil) return;
  if (S.fx.shield > 0) { S.fx.shield--; sfx.shield(); toast(S.fx.shield ? `우산 ${S.fx.shield}번 남음` : '우산이 망가졌어요'); S.hurtUntil = S.t + 0.3; return; }
  S.hearts--; S.hurtUntil = S.t + 1.5; sfx.hit();
  puff(S.player.x, GROUND - 60, '#d7451d', 10);
  if (S.hearts <= 0) endGame(false);
}

function update(dt) {
  const slow = S.t < S.fx.turtle ? 0.5 : 1;
  S.t += dt;
  // 스테이지
  const stage = Math.min(12, Math.floor(S.t / STAGE_SEC) + 1);
  if (stage !== S.stage) { S.stage = stage; S.score += 100; sfx.stage(); toast(`STAGE ${stage}`, '#fff'); if (stage === 3) toast('바람이 불어요 🌬', '#fff'); if (stage === 4) toast('돌풍 주의! 🌪', '#fff'); }
  if (S.t >= LIMIT) { endGame(true); return; }
  // 바람 (5스테이지부터, 8초마다 방향 바뀜)
  if (S.stage >= 3 && S.t > S.windAt) {
    // 3스테이지: 한 방향으로 10초씩 / 4스테이지부터: 3~5초마다 새 목표, 돌풍처럼 세기·방향이 계속 바뀜
    const strength = 40 + S.stage * 14;
    S.windTarget = (Math.random() < 0.5 ? -1 : 1) * rnd(strength * 0.5, strength);
    if (S.stage >= 4 && Math.random() < 0.25) S.windTarget *= 1.6;        // 가끔 돌풍
    S.windAt = S.t + (S.stage >= 4 ? rnd(3, 5) : 10);
  }
  if (S.stage < 3) { S.wind = 0; S.windTarget = 0; }
  S.wind += (S.windTarget - S.wind) * Math.min(1, dt * (S.stage >= 4 ? 1.5 : 4));   // 부드럽게 변함
  if (Math.abs(S.windTarget) < 8 && Math.abs(S.wind) < 8) S.wind = 0;   // 목표가 0일 때만 완전히 멈춤
  if (S.wind) { S.windT += dt; if (Math.random() < dt * 6) S.leaves.push({ x: S.wind > 0 ? -20 : W + 20, y: rnd(60, H - 120), vy: rnd(20, 60), ph: rnd(0, 6.28), age: 0 }); }
  for (const l of S.leaves) { l.age += dt; l.x += S.wind * 2.2 * dt; l.y += l.vy * dt + Math.sin(l.ph += dt * 5) * 0.8; }
  S.leaves = S.leaves.filter(l => l.age < 6 && l.x > -40 && l.x < W + 40 && l.y < H);

  // 플레이어
  const p = S.player;
  const spd = p.speed * (S.t < S.fx.lightning ? 1.6 : 1);
  let mv = 0;
  if (S.keys.ArrowLeft || S.keys.KeyA) mv -= 1;
  if (S.keys.ArrowRight || S.keys.KeyD) mv += 1;
  if (mv) { p.x += mv * spd * dt; p.dir = mv; }
  p.x = Math.max(55, Math.min(W - 55, p.x));

  // 새
  const b = S.bird;
  b.x += b.dir * (70 + S.stage * 8) * dt * slow;
  if (b.x > W + 60) b.dir = -1; if (b.x < -60) b.dir = 1;
  b.flap += dt * 8;
  b.nextPoop -= dt * slow;
  if (b.nextPoop <= 0 && b.x > 30 && b.x < W - 30) { birdPoop(); b.nextPoop = rnd(2.5, 5) - Math.min(1.8, S.stage * 0.22); }

  // 스폰
  S.spawnAt -= dt * slow;
  if (S.spawnAt <= 0) { spawn(); S.spawnAt = Math.max(0.3, 0.85 - S.stage * 0.065) * rnd(0.8, 1.2); }
  S.itemAt -= dt;
  if (S.itemAt <= 0) { spawnItem(); S.itemAt = rnd(11, 17); }

  // 오브젝트 이동·충돌
  const px = p.x, py = GROUND - 62;
  const CATCH_R = 44, HIT_R = 26;        // 과일은 넉넉하게 받고, 위험물은 몸통에 닿아야 맞음
  const magnet = S.t < S.fx.magnet;
  for (const o of S.objs) {
    o.phase += dt * 4;
    let vx = o.vx + S.wind * (o.kind === 'item' ? 0.5 : 1);
    if (o.zigzag) vx += Math.sin(o.phase) * 140;
    if (magnet && o.kind === 'fruit') { const dx = px - o.x, dy = py - o.y, d = Math.hypot(dx, dy); if (d < 220) { vx += dx / d * 260; o.y += dy / d * 120 * dt; } }
    o.x += vx * dt * slow; o.y += o.vy * dt * slow;
    if (o.x < 20) o.x = 20; if (o.x > W - 20) o.x = W - 20;
    const d = Math.hypot(o.x - px, o.y - py);
    const r = o.kind === 'hazard' ? HIT_R + o.size * 0.3 : CATCH_R + o.size * 0.38;
    if (d < r) {
      o.dead = true;
      if (o.kind === 'fruit') { const mult = S.t < S.fx.golden_ear ? 2 : 1; S.score += o.score * mult; S.caught++; S.happyUntil = S.t + 0.4; sfx.catch(); puff(o.x, o.y, '#ffd93c', 6); if (mult > 1) toast(`+${o.score * mult}`, '#ffd93c'); }
      else if (o.kind === 'item') applyItem(o.name);
      else hurt();
    } else if (o.y > GROUND + 30) { o.dead = true; if (o.kind === 'hazard') S.dodged++; }
  }
  S.objs = S.objs.filter(o => !o.dead);
  for (const q of S.particles) { q.t += dt; q.x += q.vx * dt; q.y += q.vy * dt; q.vy += 500 * dt; }
  S.particles = S.particles.filter(q => q.t < 0.7);
  for (const tt of S.toasts) tt.t += dt;
  S.toasts = S.toasts.filter(tt => tt.t < 1.6);
}

// ---------- 그리기 ----------
function drawImg(name, x, y, size, flip = false, alpha = 1) {
  const im = IMG[name]; if (!im || !im.complete) return;
  ctx.save(); ctx.globalAlpha = alpha; ctx.translate(x, y); if (flip) ctx.scale(-1, 1);
  ctx.drawImage(im, -size / 2, -size / 2, size, size); ctx.restore();
}
function text(str, x, y, { size = 16, color = '#fff', align = 'left', font = 'Galmuri11', outline = '#2b3a2e', bold = false } = {}) {
  ctx.font = `${bold ? '700 ' : ''}${size}px ${font}`; ctx.textAlign = align; ctx.textBaseline = 'top';
  if (outline) { ctx.lineWidth = 4; ctx.strokeStyle = outline; ctx.lineJoin = 'round'; ctx.strokeText(str, x, y); }
  ctx.fillStyle = color; ctx.fillText(str, x, y);
}

// 바람: 흐르는 줄기 + 날리는 잎
function drawWind() {
  const dir = Math.sign(S.wind), speed = Math.abs(S.wind);
  ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 3; ctx.lineCap = 'round';
  for (let i = 0; i < 9; i++) {
    const y = 110 + i * 72 + Math.sin(S.windT * 2 + i) * 10;
    const len = 60 + (i % 3) * 30;
    const off = ((S.windT * speed * 2.5 + i * 140) % (W + 200)) - 100;
    const x = dir > 0 ? off : W - off;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + dir * len / 2, y - 8, x + dir * len, y); ctx.stroke();
  }
  for (const l of S.leaves) { ctx.save(); ctx.translate(l.x, l.y); ctx.rotate(l.ph); ctx.fillStyle = '#7ac142'; ctx.beginPath(); ctx.ellipse(0, 0, 9, 5, 0, 0, 6.28); ctx.fill(); ctx.restore(); }
  ctx.restore();
  const arrows = (dir > 0 ? '→' : '←').repeat(Math.min(3, Math.ceil(speed / 50)));
  text(dir > 0 ? `바람 ${arrows}` : `${arrows} 바람`, W / 2, 54, { size: 15, align: 'center', color: '#e8f6ff' });
}

function draw() {
  // 배경 (9:16 이미지를 높이에 맞춰 가운데 잘라 그림)
  ctx.clearRect(0, 0, W, H);
  const bg = IMG.bg;
  if (bg.complete && bg.naturalWidth) {
    const s = Math.max(W / bg.naturalWidth, H / bg.naturalHeight), w = bg.naturalWidth * s, h = bg.naturalHeight * s;
    ctx.drawImage(bg, (W - w) / 2, (H - h) / 2, w, h);
  } else { ctx.fillStyle = '#9fd9ff'; ctx.fillRect(0, 0, W, H); }
  if (S.screen === 'intro') return;

  // 새
  const b = S.bird;
  drawImg(Math.sin(b.flap) > 0 ? 'bird_up' : 'bird_down', b.x, b.y + Math.sin(b.flap / 2) * 4, 64, b.dir > 0);
  // 바람 표시
  if (S.wind) drawWind();

  // 오브젝트
  for (const o of S.objs) {
    const name = o.kind === 'item' ? `item_${o.name}` : o.name;
    const wob = o.kind === 'item' ? Math.sin(o.phase * 2) * 0.15 : 0;
    ctx.save(); ctx.translate(o.x, o.y); ctx.rotate(o.kind === 'hazard' && o.name !== 'poop' ? o.phase * 0.5 : wob);
    const im = IMG[name]; if (im && im.complete) ctx.drawImage(im, -o.size / 2, -o.size / 2, o.size, o.size);
    ctx.restore();
    if (o.kind === 'item') { ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(o.x, o.y, o.size / 2 + 4 + Math.sin(o.phase * 3) * 2, 0, 6.28); ctx.stroke(); }
  }

  // 플레이어
  const p = S.player, hurt = S.t < S.hurtUntil, hurtRecent = S.t < S.hurtUntil - 0.6;
  const shield = S.fx.shield > 0;
  const happy = S.t < S.happyUntil && !shield;
  const sprite = hurtRecent ? 'isak_hit' : shield ? 'isak_umbrella' : happy ? 'isak_happy' : 'isak_basket';
  const bob = Math.abs(Math.sin(S.t * 9)) * ((S.keys.ArrowLeft || S.keys.ArrowRight || S.keys.KeyA || S.keys.KeyD) ? 6 : 0);
  const blink = hurt && Math.floor(S.t * 12) % 2 === 0;
  // 그림자
  ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.beginPath(); ctx.ellipse(p.x, GROUND + 2, 44, 9, 0, 0, 6.28); ctx.fill();
  drawImg(sprite, p.x, GROUND - 62 - bob - (happy ? 10 : 0), 130, false, blink ? 0.4 : 1);
  if (S.t < S.fx.lightning) { ctx.strokeStyle = '#ffd93c'; ctx.lineWidth = 3; ctx.setLineDash([6, 6]); ctx.beginPath(); ctx.arc(p.x, GROUND - 62, 70, 0, 6.28); ctx.stroke(); ctx.setLineDash([]); }
  if (S.t < S.fx.magnet) { ctx.strokeStyle = 'rgba(80,120,255,.5)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, GROUND - 62, 220, 0, 6.28); ctx.stroke(); }

  // 파티클·토스트
  for (const q of S.particles) { ctx.globalAlpha = 1 - q.t / 0.7; ctx.fillStyle = q.color; ctx.fillRect(q.x - 3, q.y - 3, 6, 6); }
  ctx.globalAlpha = 1;
  S.toasts.forEach((tt, i) => { const a = tt.t < 1.2 ? 1 : 1 - (tt.t - 1.2) / 0.4; ctx.globalAlpha = a; text(tt.text, W / 2, 230 + i * 26 - tt.t * 20, { size: 20, color: tt.color, align: 'center', font: 'Galmuri14' }); });
  ctx.globalAlpha = 1;

  // HUD
  ctx.fillStyle = 'rgba(43,58,46,.75)'; ctx.fillRect(0, 0, W, 46);
  for (let i = 0; i < MAX_HEARTS; i++) text(i < S.hearts ? '♥' : '♡', 12 + i * 22, 12, { size: 20, color: i < S.hearts ? '#ff5a5a' : '#888', outline: null });
  text(`${S.score.toLocaleString()}`, W / 2, 10, { size: 24, align: 'center', font: 'Galmuri14', outline: null, color: '#fffbe6' });
  const left = Math.max(0, LIMIT - S.t);
  text(`ST ${S.stage}`, W - 12, 6, { size: 14, align: 'right', outline: null, color: '#cfe9df' });
  text(`${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`, W - 12, 24, { size: 16, align: 'right', outline: null, color: left < 20 ? '#ffd93c' : '#fff' });
  // 효과 아이콘 + 남은 시간 바
  let ix = 12;
  for (const [k, until] of Object.entries(S.fx)) {
    if (k === 'shield') { if (until > 0) { drawImg('item_umbrella', ix + 14, 68, 32); text(`×${until}`, ix + 30, 60, { size: 12, outline: null }); ix += 52; } continue; }
    const rem = until - S.t; if (rem <= 0) continue;
    drawImg(`item_${k}`, ix + 14, 68, 32);
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(ix, 86, 28, 4); ctx.fillStyle = '#ffd93c'; ctx.fillRect(ix, 86, 28 * rem / ITEMS[k].dur, 4);
    ix += 40;
  }
}

// ---------- 점수 인증 카드 ----------
async function shareCard() {
  const cw = 640, ch = 360, c = document.createElement('canvas'); c.width = cw * 2; c.height = ch * 2;
  const g = c.getContext('2d'); g.scale(2, 2);
  const bg = IMG.bg; const s = cw / bg.naturalWidth; g.drawImage(bg, 0, -(bg.naturalHeight * s - ch) * 0.55, cw, bg.naturalHeight * s);
  g.fillStyle = 'rgba(43,58,46,.72)'; g.fillRect(0, 0, cw, ch);
  g.strokeStyle = '#fffbe6'; g.lineWidth = 6; g.strokeRect(14, 14, cw - 28, ch - 28);
  const t = (str, x, y, size, color = '#fffbe6', font = 'Galmuri14', align = 'left') => { g.font = `${size}px ${font}`; g.textAlign = align; g.textBaseline = 'top'; g.lineWidth = 5; g.strokeStyle = '#2b3a2e'; g.lineJoin = 'round'; g.strokeText(str, x, y); g.fillStyle = color; g.fillText(str, x, y); };
  const im = IMG[S.hearts > 0 ? 'isak_win' : 'isak_over']; if (im.complete) g.drawImage(im, cw - 230, 110, 220, 220);
  t('과수원을 지켜라!', 36, 34, 34);
  t('SCORE', 36, 96, 20, '#cfe9df');
  t(S.score.toLocaleString(), 36, 118, 58, '#ffd93c');
  t(`${S.hearts > 0 ? 'CLEAR ★' : 'GAME OVER'}  ·  스테이지 ${S.stage}  ·  과일 ${S.caught}개`, 36, 196, 18, '#fff', 'Galmuri11');
  const d = new Date();
  t(`${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`, 36, 226, 16, '#cfe9df', 'Galmuri11');
  t(S.score >= S.best ? '🏆 개인 최고 기록' : `BEST ${S.best.toLocaleString()}`, 36, 262, 16, '#ffd93c', 'Galmuri11');
  t('이삭이 데스크톱 펫 · 농촌진흥청', 36, ch - 44, 13, '#cfe9df', 'Galmuri11');
  const r = await bridge.shareCard(c.toDataURL('image/png'));
  $('shareBtn').textContent = r.copied ? '✅ 복사했어요 · 메신저에 붙여넣기' : '✅ 저장했어요';
}
$('shareBtn').onclick = shareCard;

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.033, (now - last) / 1000); last = now;
  if (S.screen === 'play' && !S.paused) update(dt);
  draw();
  requestAnimationFrame(frame);
}

// ---------- 입력 ----------
addEventListener('keydown', (e) => {
  if (['ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  S.keys[e.code] = true;
  if (e.code === 'Space') { if (S.screen === 'intro') startGame(); else if (S.screen === 'result' && !$('retryBtn').disabled) startGame(); else if (S.screen === 'play' && S.paused && !S.pauseReason) resume(); }
  if (e.code === 'KeyP' || e.code === 'Escape') {
    if (S.screen === 'play') (S.paused ? resume : pause)();
    else if (S.screen === 'result' && e.code === 'Escape') bridge.close();
  }
  if (e.code === 'KeyM') { const m = sfx.toggle(); $('mute').textContent = m ? '🔇' : '🔊'; }
  if (e.code === 'KeyB') $('bgm').classList.toggle('off', !bgm.toggle());
});
addEventListener('keyup', (e) => { S.keys[e.code] = false; });
addEventListener('blur', () => { S.keys = {}; if (S.screen === 'play' && !S.paused) pause(); });
$('resumeBtn').onclick = resume;
$('retryBtn').onclick = startGame;
$('closeBtn').onclick = () => bridge.close();
$('x').onclick = () => bridge.close();
$('mute').onclick = () => { $('mute').textContent = sfx.toggle() ? '🔇' : '🔊'; };
$('bgm').onclick = () => $('bgm').classList.toggle('off', !bgm.toggle());
bridge.onAlarm((info) => { if (S.screen === 'play') pause(info.text); });

// ---------- 시작 ----------
show('intro'); refreshIntro().then(() => console.log('[game] intro ready, coins', S.coins, 'best', S.best));
requestAnimationFrame(frame);

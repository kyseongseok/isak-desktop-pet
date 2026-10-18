// 이삭이 타자게임 — 새가 물고 오는 단어 풍선을 치고 Enter, 이삭이가 확성기로 외쳐 새를 쫓는다
'use strict';

// Electron 밖(브라우저 미리보기)에서 열면 가짜 브리지로 동작
const bridge = window.game || {
  kind: 'typing',
  getCoins: async () => ({ coins: 3, cap: 3, progressMs: 0, intervalMs: 7200000 }),
  spendCoin: async () => ({ ok: true, coins: 2, cap: 3 }),
  getBest: async () => 0, saveBest() {}, result() {}, close() { location.reload(); }, onAlarm() {},
  saveScore() {}, getHistory: async () => [],
  async shareCard(dataUrl) { const a = document.createElement('a'); a.href = dataUrl; a.download = 'score.png'; a.click(); return { copied: false, saved: true }; },
  async getWords() {
    const out = {};
    for (const f of ['rda', 'plan', 'agri', 'english', 'proverbs']) {
      const t = await fetch(`../game/words/${f}.txt`).then(r => r.text());
      out[f] = t.split(/\r?\n/).map(w => w.trim()).filter(Boolean);
    }
    return out;
  },
};

const W = 480, H = 800;
const GROUND = 600;                      // 여기까지 내려오면 하트 -1
const LIMIT = 180, STAGE_SEC = 30, MAX_HEARTS = 5;

// ---------- 이미지 ----------
const IMG = {};
['bg', 'bird_up', 'bird_down', 'isak_shout', 'isak_hit', 'isak_over', 'isak_win', 'isak_happy',
 'item_turtle', 'item_sprout', 'apple'].forEach(n => { const i = new Image(); i.src = `../game/img/${n}.png`; IMG[n] = i; });

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
    shout() { tone(440, 0.12, 'square', 0.3, 300); tone(660, 0.12, 'square', 0.25, 300, 0.08); },
    wrong() { tone(200, 0.18, 'sawtooth', 0.3, -80); },
    hit() { tone(160, 0.3, 'sawtooth', 0.35, -120); },
    combo() { [660, 880, 1100].forEach((f, i) => tone(f, 0.08, 'triangle', 0.25, 0, i * 0.06)); },
    stage() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.12, 'square', 0.25, 0, i * 0.09)); },
    boss() { [196, 196, 196, 147].forEach((f, i) => tone(f, 0.25, 'sawtooth', 0.3, 0, i * 0.2)); },
    over() { [392, 330, 262, 196].forEach((f, i) => tone(f, 0.25, 'triangle', 0.3, 0, i * 0.18)); },
    win() { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.15, 'square', 0.25, 0, i * 0.1)); },
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

// ---------- 한글 도우미 ----------
const isHangul = (ch) => /[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(ch);
// 타수: 한글 음절은 초성+중성(+종성), 복합 모음·겹받침은 2타로 셈. 그 외 글자는 1타
function strokes(str) {
  let n = 0;
  for (const ch of str) {
    const code = ch.charCodeAt(0) - 0xAC00;
    if (code >= 0 && code < 11172) {
      const jung = Math.floor(code / 28) % 21, jong = code % 28;
      n += 1 + ([9, 10, 11, 14, 15, 16, 19].includes(jung) ? 2 : 1) + (jong ? ([3, 5, 6, 9, 10, 11, 12, 13, 14, 15, 18].includes(jong) ? 2 : 1) : 0);
    } else if (ch !== ' ') n += 1;
  }
  return n;
}

// ---------- 상태 ----------
const canvas = document.getElementById('c'), ctx = canvas.getContext('2d');
const dpr = Math.min(2, devicePixelRatio || 1);
canvas.width = W * dpr; canvas.height = H * dpr; ctx.scale(dpr, dpr);
const $ = (id) => document.getElementById(id);
const input = $('typed');

let WORDS = { rda: [], plan: [], agri: [], english: [], proverbs: [] };
const S = {
  screen: 'intro', paused: false, pauseReason: '',
  t: 0, stage: 1, score: 0, hearts: MAX_HEARTS,
  birds: [], spawnAt: 1.5, bossDone: {},
  combo: 0, maxCombo: 0, submits: 0, corrects: 0, typedStrokes: 0, scared: 0,
  fx: { slow: 0 }, stormReady: false,
  shouts: [], toasts: [], hurtUntil: 0, happyUntil: 0, isakState: 'idle',
  best: 0, coins: 0, cap: 3, hintText: '',
};
function show(id) { document.querySelectorAll('.screen').forEach(e => e.classList.toggle('on', e.id === id)); $('inputBox').classList.toggle('on', id === ''); }
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
function toast(text, color = '#fffbe6') { S.toasts.push({ text, color, t: 0 }); }

// ---------- 화면 전환 ----------
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
  Object.assign(S, { t: 0, stage: 1, score: 0, hearts: MAX_HEARTS, birds: [], spawnAt: 1.2, bossDone: {}, combo: 0, maxCombo: 0,
    submits: 0, corrects: 0, typedStrokes: 0, scared: 0, fx: { slow: 0 }, stormReady: false, shouts: [], toasts: [], hurtUntil: 0, happyUntil: 0, isakState: 'idle', paused: false, hintText: '' });
  S.screen = 'play'; show(''); input.value = ''; input.focus(); sfx.stage(); bgm.play();
  toast('STAGE 1', '#fff');
}
function endGame(cleared) {
  S.screen = 'result'; show('result'); bgm.stop();
  const isBest = S.score > S.best;
  if (isBest) { S.best = S.score; bridge.saveBest(S.score); }
  const min = Math.max(S.t, 1) / 60, spm = Math.round(S.typedStrokes / min);
  const acc = S.submits ? Math.round(S.corrects / S.submits * 100) : 100;
  $('resultTitle').textContent = cleared ? 'CLEAR!' : 'GAME OVER';
  $('resultScore').textContent = S.score.toLocaleString();
  $('resultBest').textContent = isBest ? '🏆 최고 기록 갱신!' : `BEST ${S.best.toLocaleString()}`;
  $('resultStats').innerHTML = `<span>타수 <b>${spm}타/분</b></span><span>정확도 <b>${acc}%</b></span><span>최대 콤보 <b>${S.maxCombo}</b></span><span>쫓은 새 <b>${S.scared}마리</b></span>`;
  S.lastStats = { spm, acc };
  bridge.saveScore({ score: S.score, stage: S.stage, cleared, spm, acc, maxCombo: S.maxCombo, date: new Date().toISOString() });
  bridge.getCoins().then(c => { S.coins = c.coins; S.cap = c.cap; $('retryBtn').textContent = `다시 하기 (🪙 ${S.coins}/${S.cap})`; $('retryBtn').disabled = S.coins <= 0; });
  $('shareBtn').textContent = '📸 점수 카드 복사·저장';
  (cleared ? sfx.win : sfx.over)();
  bridge.result({ score: S.score, best: isBest, cleared });
}
function pause(reason) {
  if (S.screen !== 'play') return;
  S.paused = true; S.pauseReason = reason || ''; bgm.pause();
  $('pauseTitle').textContent = reason ? '⏰ 근무확인!' : '일시정지';
  $('pauseText').innerHTML = reason ? `${reason}<br>이삭이를 확인하고 돌아오세요` : 'ESC로 계속';
  show('pause');
}
function resume() { if (S.screen === 'play') { S.paused = false; show(''); input.focus(); bgm.play(); } }

// ---------- 단어 고르기 ----------
function pickWord() {
  const st = S.stage;
  // 가끔 아이템 새: 거북이(느리게) / 새싹이(하트)
  if (Math.random() < (st >= 3 ? 0.06 : 0.02)) return pick([{ word: '거북이', kind: 'turtle' }, { word: '새싹이', kind: 'sprout' }]);
  if (st >= 5 && WORDS.english.length && Math.random() < 0.3) return { word: pick(WORDS.english), kind: 'en' };
  // 스테이지별 선호 길이: 1~2는 짧게, 올라갈수록 길게. 후보가 없으면 전체에서
  const korean = [...WORDS.rda, ...WORDS.plan, ...WORDS.agri];
  const [lo, hi] = st <= 1 ? [2, 3] : st === 2 ? [2, 4] : st === 3 ? [3, 5] : st === 4 ? [3, 6] : st <= 6 ? [4, 8] : [5, 12];
  let pool = korean.filter(w => w.length >= lo && w.length <= hi);
  if (pool.length < 20) pool = korean;
  return { word: pick(pool), kind: 'ko' };
}
function spawnBird(spec, boss = false) {
  const w = boss ? Math.min(W - 40, 40 + spec.word.length * 15) : 36 + [...spec.word].length * (spec.kind === 'en' ? 12 : 18);
  const speed = (boss ? 16 : 24 + S.stage * 5) * rnd(0.9, 1.15);
  S.birds.push({ ...spec, boss, w, x: rnd(30 + w / 2, W - 30 - w / 2), y: boss ? 150 : rnd(130, 170), /* 풍선이 HUD에 가리지 않는 높이 */ vy: speed, flap: rnd(0, 6), state: 'fly', t: 0, dir: Math.random() < 0.5 ? 1 : -1 });
}

// ---------- 입력 처리 ----------
function submit() {
  const v = input.value.trim(); input.value = '';
  if (!v) return;
  S.submits++;
  const target = S.birds.find(b => b.state === 'fly' && b.word.toLowerCase() === v.toLowerCase());
  if (!target) {
    S.combo = 0; sfx.wrong(); input.classList.remove('wrong'); void input.offsetWidth; input.classList.add('wrong');
    toast('아쉬워요!', '#ffb3a7'); return;
  }
  S.corrects++; S.typedStrokes += strokes(target.word); S.scared++;
  S.combo++; S.maxCombo = Math.max(S.maxCombo, S.combo);
  const mult = Math.min(3, 1 + Math.floor(S.combo / 5) * 0.5);
  let gain = Math.round(strokes(target.word) * 5 * mult);
  if (target.boss) gain += 300;
  if (target.kind === 'storm') { gain = 100; S.birds.forEach(b => { if (b.state === 'fly') b.state = 'scared'; }); toast('태풍! 새들이 다 날아갔어요 🌪', '#fff'); }
  if (target.kind === 'turtle') { S.fx.slow = S.t + 5; toast('느리게~ 🐢'); }
  if (target.kind === 'sprout') { if (S.hearts < MAX_HEARTS) { S.hearts++; toast('하트 +1 💚'); } else { gain += 50; toast('하트 가득! +50'); } }
  S.score += gain;
  target.state = 'scared'; target.t = 0;
  S.shouts.push({ x1: W / 2, y1: GROUND + 60, x2: target.x, y2: target.y, t: 0 });
  S.happyUntil = S.t + 0.5;
  if (S.combo % 5 === 0) sfx.combo(); else sfx.shout();
  toast(`+${gain}${mult > 1 ? ` ×${mult}` : ''}`, '#ffd93c');
  if (S.combo === 10 && !S.stormReady) { S.stormReady = true; spawnBird({ word: '태풍', kind: 'storm' }); toast('콤보 10! "태풍"을 치면 전부 날려요', '#fff'); }
}
input.addEventListener('keydown', (e) => {
  if (e.isComposing || e.keyCode === 229) return;          // 한글 조합 중에는 Enter를 무시
  if (e.key === 'Enter') { e.preventDefault(); if (S.screen === 'play' && !S.paused) submit(); }
});
input.addEventListener('input', () => {
  // 한/영 전환 힌트: 영어 단어만 떠 있는데 한글을 치고 있거나, 그 반대
  const v = input.value;
  const targets = S.birds.filter(b => b.state === 'fly');
  const anyKo = targets.some(b => b.kind !== 'en'), anyEn = targets.some(b => b.kind === 'en');
  const typingKo = [...v].some(isHangul), typingEn = /[a-zA-Z]/.test(v);
  S.hintText = (typingKo && !anyKo && anyEn) ? '한/영 키를 눌러 영어로!' : (typingEn && !anyEn && anyKo) ? '한/영 키를 눌러 한글로!' : '';
  $('hint').textContent = S.hintText;
});
addEventListener('keydown', (e) => {
  if (e.code === 'Space' && S.screen !== 'play') { e.preventDefault(); if (S.screen === 'intro' || (S.screen === 'result' && !$('retryBtn').disabled)) startGame(); }
  if (e.code === 'Escape') { if (S.screen === 'play') (S.paused ? resume : pause)(); else if (S.screen === 'result') bridge.close(); }
  if (e.code === 'KeyM' && document.activeElement !== input) $('mute').textContent = sfx.toggle() ? '🔇' : '🔊';
  if (e.code === 'KeyB' && document.activeElement !== input) $('bgm').classList.toggle('off', !bgm.toggle());
});
addEventListener('blur', () => { if (S.screen === 'play' && !S.paused) pause(); });
addEventListener('click', () => { if (S.screen === 'play' && !S.paused) input.focus(); });

// ---------- 게임 루프 ----------
function update(dt) {
  const slow = S.t < S.fx.slow ? 0.45 : 1;
  S.t += dt;
  const stage = Math.min(12, Math.floor(S.t / STAGE_SEC) + 1);
  if (stage !== S.stage) {
    S.stage = stage; S.score += 100; sfx.stage(); toast(`STAGE ${stage}`, '#fff');
    if (stage === 5) toast('영어 단어 등장! 한/영 전환 주의', '#fff');
  }
  if (S.t >= LIMIT) { endGame(true); return; }
  // 보스: 3·6·9스테이지 시작 때 속담 한 문장
  if ([3, 6, 9].includes(S.stage) && !S.bossDone[S.stage] && WORDS.proverbs.length) {
    S.bossDone[S.stage] = true; spawnBird({ word: pick(WORDS.proverbs), kind: 'boss' }, true); sfx.boss(); toast('BOSS! 문장을 통째로 치세요', '#ff8a65');
  }
  // 스폰: 동시 마리 수 제한
  const maxBirds = Math.min(8, 3 + Math.floor(S.stage / 2));
  S.spawnAt -= dt * slow;
  if (S.spawnAt <= 0) {
    if (S.birds.filter(b => b.state === 'fly' && !b.boss).length < maxBirds) spawnBird(pickWord());
    S.spawnAt = Math.max(0.7, 1.7 - S.stage * 0.12) * rnd(0.8, 1.2);
  }
  for (const b of S.birds) {
    b.flap += dt * 9; b.t += dt;
    if (b.state === 'fly') {
      b.y += b.vy * dt * slow;
      b.x += Math.sin(b.flap / 3) * 12 * dt;
      if (b.y >= GROUND) {                                   // 땅에 닿음
        b.state = 'fled'; b.t = 0;
        if (b.kind === 'storm' || b.kind === 'turtle' || b.kind === 'sprout') continue;   // 아이템 새는 놓쳐도 피해 없음
        S.hearts--; S.combo = 0; S.hurtUntil = S.t + 1; sfx.hit();
        if (S.hearts <= 0) { endGame(false); return; }
      }
    } else {
      b.y -= 420 * dt; b.x += b.dir * 260 * dt;              // 쫓겨 날아감
    }
  }
  S.birds = S.birds.filter(b => !(b.state !== 'fly' && b.t > 1.2));
  for (const s of S.shouts) s.t += dt; S.shouts = S.shouts.filter(s => s.t < 0.35);
  for (const tt of S.toasts) tt.t += dt; S.toasts = S.toasts.filter(tt => tt.t < 1.6);
}

// ---------- 그리기 ----------
function drawImg(name, x, y, size, flip = false, alpha = 1) {
  const im = IMG[name]; if (!im || !im.complete || !im.naturalWidth) return;
  ctx.save(); ctx.globalAlpha = alpha; ctx.translate(x, y); if (flip) ctx.scale(-1, 1);
  ctx.drawImage(im, -size / 2, -size / 2, size, size); ctx.restore();
}
function text(str, x, y, { size = 16, color = '#fff', align = 'left', font = 'Galmuri11', outline = '#2b3a2e', bold = false } = {}) {
  ctx.font = `${bold ? '700 ' : ''}${size}px ${font}`; ctx.textAlign = align; ctx.textBaseline = 'top';
  if (outline) { ctx.lineWidth = 4; ctx.strokeStyle = outline; ctx.lineJoin = 'round'; ctx.strokeText(str, x, y); }
  ctx.fillStyle = color; ctx.fillText(str, x, y);
}
function balloon(b, typed) {
  const colors = { ko: '#fffbe6', en: '#e3f2ff', boss: '#ffe0d6', storm: '#ffeaa0', turtle: '#dff5d8', sprout: '#dff5d8' }[b.kind] || '#fffbe6';
  const size = b.boss ? 15 : 17, pad = 10;
  ctx.font = `${size}px Galmuri11`;
  const lines = b.boss ? wrap(b.word, W - 80, size) : [b.word];
  const tw = Math.max(...lines.map(l => ctx.measureText(l).width)), bw = tw + pad * 2, bh = lines.length * (size + 4) + pad;
  const bx = b.x - bw / 2, by = b.y - 46 - bh;
  ctx.fillStyle = colors; ctx.strokeStyle = typed ? '#f0a030' : '#2b3a2e'; ctx.lineWidth = typed ? 4 : 3;
  ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 8); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(b.x - 6, by + bh); ctx.lineTo(b.x, by + bh + 8); ctx.lineTo(b.x + 6, by + bh); ctx.fill();
  // 입력 중인 앞부분은 주황으로
  lines.forEach((l, i) => {
    const lx = b.x - ctx.measureText(l).width / 2, ly = by + pad / 2 + i * (size + 4);
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    if (typed && i === 0) {
      const done = l.slice(0, typed.length), rest = l.slice(typed.length);
      ctx.fillStyle = '#d7451d'; ctx.fillText(done, lx, ly);
      ctx.fillStyle = '#2b3a2e'; ctx.fillText(rest, lx + ctx.measureText(done).width, ly);
    } else { ctx.fillStyle = '#2b3a2e'; ctx.fillText(l, lx, ly); }
  });
}
function wrap(str, maxW, size) {
  ctx.font = `${size}px Galmuri11`;
  const words = str.split(' '), lines = []; let cur = '';
  for (const w of words) { const t = cur ? cur + ' ' + w : w; if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }
  if (cur) lines.push(cur); return lines;
}
function draw() {
  ctx.clearRect(0, 0, W, H);
  const bg = IMG.bg;
  if (bg.complete && bg.naturalWidth) { const s = Math.max(W / bg.naturalWidth, H / bg.naturalHeight), w = bg.naturalWidth * s, h = bg.naturalHeight * s; ctx.drawImage(bg, (W - w) / 2, (H - h) / 2, w, h); }
  else { ctx.fillStyle = '#9fd9ff'; ctx.fillRect(0, 0, W, H); }
  if (S.screen === 'intro') return;

  // 위험선
  ctx.setLineDash([8, 8]); ctx.strokeStyle = 'rgba(215,69,29,.55)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(20, GROUND + 20); ctx.lineTo(W - 20, GROUND + 20); ctx.stroke(); ctx.setLineDash([]);

  // 외침 (확성기 → 새)
  for (const s of S.shouts) {
    const k = s.t / 0.35; ctx.strokeStyle = `rgba(255,217,60,${1 - k})`; ctx.lineWidth = 6 - k * 4;
    ctx.beginPath(); ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x1 + (s.x2 - s.x1) * k, s.y1 + (s.y2 - s.y1) * k); ctx.stroke();
  }
  // 새 + 풍선 (아래쪽 새가 위에 그려지게)
  const typed = input.value.trim().toLowerCase();
  const sorted = [...S.birds].sort((a, b) => a.y - b.y);
  for (const b of sorted) {
    const alpha = b.state === 'fly' ? 1 : Math.max(0, 1 - b.t);
    ctx.globalAlpha = alpha;
    drawImg(Math.sin(b.flap) > 0 ? 'bird_up' : 'bird_down', b.x, b.y + Math.sin(b.flap / 2) * 3, b.boss ? 84 : 60, b.dir > 0);
    if (b.state === 'fly') {
      const match = typed && b.word.toLowerCase().startsWith(typed) ? typed : '';
      balloon(b, match);
      if (b.kind === 'turtle' || b.kind === 'sprout') drawImg(b.kind === 'turtle' ? 'item_turtle' : 'item_sprout', b.x + 34, b.y - 30, 30);
    }
    ctx.globalAlpha = 1;
  }

  // 이삭이 (확성기)
  const hurt = S.t < S.hurtUntil, happy = S.t < S.happyUntil;
  const sprite = hurt ? 'isak_hit' : happy ? 'isak_shout' : 'isak_shout';
  const pulse = happy ? 1 + Math.sin(S.t * 30) * 0.05 : 1;
  ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.beginPath(); ctx.ellipse(W / 2, GROUND + 120, 44, 9, 0, 0, 6.28); ctx.fill();
  drawImg(sprite, W / 2, GROUND + 60, 130 * pulse, false, hurt && Math.floor(S.t * 12) % 2 === 0 ? 0.4 : 1);

  // 토스트
  S.toasts.forEach((tt, i) => { ctx.globalAlpha = tt.t < 1.2 ? 1 : 1 - (tt.t - 1.2) / 0.4; text(tt.text, W / 2, 300 + i * 26 - tt.t * 20, { size: 20, color: tt.color, align: 'center', font: 'Galmuri14' }); });
  ctx.globalAlpha = 1;

  // HUD
  ctx.fillStyle = 'rgba(43,58,46,.75)'; ctx.fillRect(0, 0, W, 46);
  for (let i = 0; i < MAX_HEARTS; i++) text(i < S.hearts ? '♥' : '♡', 12 + i * 22, 12, { size: 20, color: i < S.hearts ? '#ff5a5a' : '#888', outline: null });
  text(`${S.score.toLocaleString()}`, W / 2, 10, { size: 24, align: 'center', font: 'Galmuri14', outline: null, color: '#fffbe6' });
  const left = Math.max(0, LIMIT - S.t);
  text(`ST ${S.stage}`, W - 12, 6, { size: 14, align: 'right', outline: null, color: '#cfe9df' });
  text(`${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`, W - 12, 24, { size: 16, align: 'right', outline: null, color: left < 20 ? '#ffd93c' : '#fff' });
  if (S.combo >= 2) text(`${S.combo} COMBO`, W / 2, 52, { size: 16, align: 'center', color: S.combo >= 10 ? '#ffd93c' : '#fff' });
  if (S.t < S.fx.slow) { drawImg('item_turtle', 26, 68, 32); ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(12, 86, 28, 4); ctx.fillStyle = '#ffd93c'; ctx.fillRect(12, 86, 28 * (S.fx.slow - S.t) / 5, 4); }
}

// ---------- 점수 카드 ----------
async function shareCard() {
  const cw = 640, ch = 360, c = document.createElement('canvas'); c.width = cw * 2; c.height = ch * 2;
  const g = c.getContext('2d'); g.scale(2, 2);
  const bg = IMG.bg; const s = cw / bg.naturalWidth; g.drawImage(bg, 0, -(bg.naturalHeight * s - ch) * 0.55, cw, bg.naturalHeight * s);
  g.fillStyle = 'rgba(43,58,46,.72)'; g.fillRect(0, 0, cw, ch);
  g.strokeStyle = '#fffbe6'; g.lineWidth = 6; g.strokeRect(14, 14, cw - 28, ch - 28);
  const t = (str, x, y, size, color = '#fffbe6', font = 'Galmuri14') => { g.font = `${size}px ${font}`; g.textAlign = 'left'; g.textBaseline = 'top'; g.lineWidth = 5; g.strokeStyle = '#2b3a2e'; g.lineJoin = 'round'; g.strokeText(str, x, y); g.fillStyle = color; g.fillText(str, x, y); };
  const im = IMG[S.hearts > 0 ? 'isak_win' : 'isak_over']; if (im.complete) g.drawImage(im, cw - 230, 110, 220, 220);
  t('이삭이 타자게임', 36, 34, 34);
  t('SCORE', 36, 96, 20, '#cfe9df');
  t(S.score.toLocaleString(), 36, 118, 58, '#ffd93c');
  const st = S.lastStats || { spm: 0, acc: 100 };
  t(`${S.hearts > 0 ? 'CLEAR ★' : 'GAME OVER'}  ·  ${st.spm}타/분  ·  정확도 ${st.acc}%  ·  콤보 ${S.maxCombo}`, 36, 196, 17, '#fff', 'Galmuri11');
  const d = new Date();
  t(`${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`, 36, 226, 16, '#cfe9df', 'Galmuri11');
  t(S.score >= S.best ? '🏆 개인 최고 기록' : `BEST ${S.best.toLocaleString()}`, 36, 262, 16, '#ffd93c', 'Galmuri11');
  t('이삭이 데스크톱 펫 · 농촌진흥청', 36, ch - 44, 13, '#cfe9df', 'Galmuri11');
  const r = await bridge.shareCard(c.toDataURL('image/png'));
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
  WORDS = { ...WORDS, ...(await bridge.getWords()) };
  show('intro'); await refreshIntro();
  console.log('[typing] intro ready, words', JSON.stringify(Object.fromEntries(Object.entries(WORDS).map(([k, v]) => [k, v.length]))));
  requestAnimationFrame(frame);
})();

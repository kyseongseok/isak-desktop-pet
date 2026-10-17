// 이삭이 데스크톱 펫 — 렌더러
// 펫 물리(말랑·던지기·걷기), 말풍선, 우클릭 메뉴, 초과근무 알람 로직
'use strict';

// ---------- 설정 ----------
let SIZE = 220;
const SIZE_MIN = 100, SIZE_MAX = 360;
const FOOT = 0.95;           // 이미지 안에서 발끝의 세로 위치 비율
const GRAVITY = 2400;        // px/s^2
const BOUNCE = 0.62;
const FRICTION = 0.86;
const WALK_SPEED = 70;       // px/s
const FACES_LEFT = { runA: true, runB: true, fly: true };   // 원본이 왼쪽을 보는 이미지
const MIN = 60 * 1000;
const ASK_AT = 17 * 60 + 55;          // 평일 질문 시각 (분)
const AWAY_REASK_SEC = 10 * 60;       // 이만큼 비웠다 돌아오면 다시 물어봄

const IMAGES = ['idle','blink','sleep','tired','research','runA','runB','curious','produce',
                'cheer','hello','farm','fly','think','alarm','best','surprise','angry'];
IMAGES.forEach(n => { const i = new Image(); i.src = `img/${n}.png`; });

const pet = document.getElementById('pet');
const img = document.getElementById('petImg');
const shadow = document.getElementById('shadow');
const bubble = document.getElementById('bubble');
const menu = document.getElementById('ctxMenu');

// ---------- 환경 (메인 프로세스에서 받음) ----------
const env = { width: innerWidth, height: innerHeight, isWorkday: true };
let autoplay = true;
let obstacles = [];          // 바탕화면 아이콘 사각형 (윈도우 전용 기능, 3단계에서 채움)

// ---------- 상태 ----------
const s = {
  x: innerWidth * 0.4, y: innerHeight,
  vx: 0, vy: 0,
  mode: 'idle',              // idle | walk | drag | fly | emote
  dir: 1, frame: 'idle',
  sq: 0, sqV: 0, tilt: 0, tiltV: 0, tiltTarget: 0,
  emoteUntil: 0, emoteName: null,
  nextAuto: performance.now() + 4000,
  nextBlink: performance.now() + 2500, blinkUntil: 0,
  walkUntil: 0, shake: 0, clicks: [],
};
const ground = () => env.height;
function setFrame(name) { if (s.frame !== name) { s.frame = name; img.src = `img/${name}.png`; } }
function poke(amount) { s.sqV += amount; }
const fmt = (ms) => new Date(ms).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
const minuteOfDay = (ms) => { const d = new Date(ms); return d.getHours() * 60 + d.getMinutes(); };
const todayAt = (h, m) => { const d = new Date(); d.setHours(h, m, 0, 0); return d.getTime(); };

// ---------- 말풍선 ----------
let bubbleTimer = null;
function say(html, { ms = 3500, alarm = false, choices = null } = {}) {
  bubble.innerHTML = html;
  bubble.className = alarm ? 'alarm' : '';
  bubble.style.display = 'block';
  if (choices) {
    const box = document.createElement('div');
    box.className = 'choices';
    choices.forEach(c => {
      const b = document.createElement('button');
      b.textContent = c.label;
      if (c.secondary) b.className = 'secondary';
      b.onclick = (e) => { e.stopPropagation(); c.onClick(); };
      box.appendChild(b);
    });
    bubble.appendChild(box);
  }
  clearTimeout(bubbleTimer);
  if (ms) bubbleTimer = setTimeout(hush, ms);
  isak.setOnTop(true);                       // 말할 때만 다른 창 위로
}
function hush() { bubble.style.display = 'none'; clearTimeout(bubbleTimer); isak.setOnTop(false); }
const bubbleBusy = () => bubble.style.display === 'block' && !!bubble.querySelector('.choices, input');

// ---------- 감정 표현 ----------
function emote(name, ms, opts = {}) {
  if (s.mode === 'drag' || s.mode === 'fly') return;
  s.mode = 'emote'; s.emoteName = name;
  s.emoteUntil = ms ? performance.now() + ms : Infinity;
  s.tiltTarget = 0;
  setFrame(opts.frame || name);
  if (opts.poke) poke(opts.poke);
}
function endEmote() {
  s.mode = 'idle'; s.emoteName = null; s.tiltTarget = 0; s.shake = 0;
  setFrame('idle');
  s.nextAuto = performance.now() + 2500 + Math.random() * 3000;
}
function interrupt() { hush(); if (s.mode === 'emote') endEmote(); }

// 케어 메시지: [문구, 표정]
const CARE = [
  ['물 한 잔 마시고 올까요? 💧', 'hello'],
  ['잠깐 일어나서 기지개 쭉~ 🙆', 'cheer'],
  ['허리 쭉 펴고 앉아 볼까요?', 'best'],
  ['모니터에서 눈 떼고 먼 곳 20초 보기 👀', 'curious'],
  ['어깨 한 바퀴 돌려 볼까요?', 'hello'],
  ['소중한 연구 자료, 지식보관소에 차곡차곡 모아 주세요 📚', 'research'],
  ['…지켜보고 있다 👀', 'angry'],
  ['이번 주 랩미팅은 하셨나요?', 'think'],
  ['실험실 안전 점검, 오늘도 잘 챙기셨죠? 🧪', 'research'],
  ['퇴근 전에 책상 정리 한 번 할까요?', 'farm'],
  ['오늘 구내식당 메뉴는 뭘까요? 🍚', 'curious'],
  ['회의랑 출장 일정, 놓친 건 없으시죠? 📅', 'think'],
  ['오늘은 가족에게 안부 전화 한 통 어때요? 📞', 'hello'],
  ['옆자리 동료에게 "파이팅!" 한마디 건네 볼까요?', 'cheer'],
  ['커피 한 잔 하고 올까요? ☕', 'produce'],
];
let lastCare = -Infinity;                 // 0이면 켠 뒤 40분 동안 한 번도 못 말함
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const scene = () => 15000 + Math.random() * 10000;
const actions = {
  hello() { emote('hello', 2500, { poke: 3 }); s.tiltTarget = 0.12; say('안녕하세요! 오늘도 파이팅 🌾'); },
  care() {
    if (performance.now() - lastCare < 25 * MIN) return;     // 너무 자주 말하지 않기
    lastCare = performance.now();
    const [text, face] = CARE[Math.floor(Math.random() * CARE.length)];
    emote(face, 4500, { poke: 3 }); say(text, { ms: 4500 });
  },
  sleep() { emote('sleep', 20000); say('Zzz…', { ms: 4000 }); },
  curious() { emote('curious', 6000, { poke: 2 }); say(pick(['이건 뭐지…? 🤔', '흠… 뭔가 수상한데', '저기 뭐가 있는 것 같아요'])); },
  // 딴짓 장면: 15~25초 동안 이어지고, 말풍선은 처음 4초만
  research() { emote('research', scene(), { poke: 2 }); say(pick(['새싹이 잘 자라고 있나 볼까요 🌱', '오늘의 연구, 열심히! 🔬', '흠… 이 품종은 흥미롭군요']), { ms: 4000 }); },
  farm() { emote('farm', scene(), { poke: 2 }); say(pick(['밭 좀 갈고 올게요 🌾', '흙 냄새가 좋네요~', '농사는 타이밍이죠!']), { ms: 4000 }); },
  produce() { emote('produce', scene(), { poke: 3 }); say(pick(['수확 완료! 🥕', '올해 농사 풍년이에요 🍎', '싱싱한 채소 드실래요?']), { ms: 4000 }); },
};

function startWalk() {
  if (s.mode === 'drag' || s.mode === 'fly') return;
  s.mode = 'walk';
  s.dir = Math.random() < 0.5 ? -1 : 1;
  if (s.x < 200) s.dir = 1;
  if (s.x > env.width - 320) s.dir = -1;
  s.walkUntil = performance.now() + 2500 + Math.random() * 3500;
}

// ---------- 초과근무 로직 ----------
// 규칙: 기준 시각(마지막 근무확인) + 60분 = 마감, 마감 5·3·1분 전 알림, 지나면 초과 안내
// 일찍 눌러도 누른 시각이 새 기준, 제외시간 후 복귀하면 복귀 시 근무확인 누른 시각이 새 기준
const OT = { status: 'none', base: null, stage: 0, pendingPress: false, snoozeUntil: 0 };
const deadline = () => OT.base + 60 * MIN;
function otSave() { isak.saveState({ ot: { status: OT.status, base: OT.base, date: new Date().toDateString() } }); }

function otTick() {
  const t = Date.now();
  if (OT.status === 'none' && t >= OT.snoozeUntil && (!env.isWorkday || minuteOfDay(t) >= ASK_AT)) otAsk();
  if (OT.status !== 'active' || OT.pendingPress) return;
  const remain = deadline() - t;
  const stage = remain <= 0 ? 4 : remain <= MIN ? 3 : remain <= 3 * MIN ? 2 : remain <= 5 * MIN ? 1 : 0;
  if (stage > OT.stage) { OT.stage = stage; otAlarm(stage); }
}

function otAsk(greeting = '') {
  OT.status = 'asked'; otSave();
  interrupt();
  emote('think', 0, { poke: 3 });
  say(`${greeting}오늘 초과 근무 하시나요?`, { ms: 0, choices: [
    { label: '예', onClick: otChooseBase },
    { label: '아니오', secondary: true, onClick: () => {
        OT.status = 'declined'; otSave(); interrupt();
        emote('hello', 2500); say('오늘도 수고하셨어요! 👋'); } },
    { label: '30분 뒤', secondary: true, onClick: () => {
        OT.status = 'none'; OT.snoozeUntil = Date.now() + 30 * MIN; otSave(); interrupt();
        say(`${fmt(OT.snoozeUntil)}에 다시 여쭤볼게요`, { ms: 2500 }); } },
  ]});
}

function otChooseBase() {
  say('근무확인 알람 기준을 골라 주세요', { ms: 0, choices: [
    { label: '18:00 기본', onClick: () => otStart(todayAt(18, 0)) },
    { label: '방금 눌렀어요', onClick: () => otStart(Date.now()) },
    { label: '시각 입력', secondary: true, onClick: () =>
        askTime('근무확인을 누른 시각을 알려 주세요', Date.now(), otStart) },
  ]});
}

function askTime(html, defMs, cb) {
  say(html, { ms: 0, choices: [
    { label: '확인', onClick: () => {
        const v = bubble.querySelector('input').value;
        if (!v) return;
        const [h, m] = v.split(':').map(Number);
        cb(todayAt(h, m));
    } },
    { label: '취소', secondary: true, onClick: interrupt },
  ]});
  const input = document.createElement('input');
  input.type = 'time'; input.value = fmt(defMs);
  bubble.insertBefore(input, bubble.querySelector('.choices'));
}

const nextInfo = () => `다음 마감 <b>${fmt(deadline())}</b> · ${fmt(deadline() - 5 * MIN)}에 알려드릴게요 ⏰`;

function otStart(base) {
  OT.status = 'active'; OT.base = base; OT.stage = 0; OT.pendingPress = false; otSave();
  interrupt();
  emote('best', 2500, { poke: 4 });
  say(`초과근무 알람 시작! (기준 ${fmt(base)})<br>${nextInfo()}`, { ms: 5000 });
}

function otAlarm(stage) {
  interrupt();
  const dl = fmt(deadline());
  if (stage === 4) {
    emote('tired', 0);
    say(`앗… ${dl} 마감이 지났어요 ㅠ<br>사유 적고 근무확인 눌러 주세요`, { ms: 0, choices: [
      { label: '지금 눌렀어요', onClick: otPressed } ] });
    isak.notify('이삭이', `${dl} 근무확인 마감이 지났어요. 사유 적고 눌러 주세요`);
    return;
  }
  const text = { 1: '근무확인 누를 시간이에요! 🔔', 2: '3분 남았어요! ⏳', 3: '1분 남았어요!! 🚨' }[stage];
  emote('alarm', 0, { poke: 4 + stage });
  s.shake = stage;
  say(`${text}<br><small>${dl}까지 · 누르고 저를 클릭해 주세요</small>`, { ms: 0, alarm: true });
  if (stage === 1) isak.notify('이삭이', `근무확인 누를 시간이에요! (${dl}까지)`);
}

function otPressed() {
  interrupt();
  if (OT.status === 'excluded') return otResume();
  if (OT.status !== 'active') { say('지금은 초과근무 알람이 꺼져 있어요', { ms: 2500 }); return; }
  const late = OT.stage === 4;
  OT.base = Date.now(); OT.stage = 0; OT.pendingPress = false; otSave();
  if (late) { emote('hello', 4500, { poke: 4 }); say(`괜찮아요, 그럴 수 있죠! 🙂<br>${nextInfo()}`, { ms: 5000 }); }
  else { emote('best', 2500, { poke: 5 }); say(`근무확인 완료! 최고예요 👍<br>${nextInfo()}`, { ms: 5000 }); }
}

function otFixTime() {
  if (OT.status !== 'active') return;
  askTime('실제로 근무확인을 누른 시각을 알려 주세요', OT.base, (ms) => {
    OT.base = ms; OT.stage = 0; OT.pendingPress = false; otSave();
    interrupt(); say(`기준 시각을 ${fmt(ms)}로 고쳤어요<br>${nextInfo()}`, { ms: 4500 });
  });
}

function otExclude() {
  if (OT.status !== 'active') return;
  OT.status = 'excluded'; otSave();
  interrupt();
  emote('sleep', 0);
  say('다녀오세요! 그동안 알람은 쉴게요 🙂<br><small>돌아오면 저를 클릭해 주세요</small>', { ms: 0, choices: [
    { label: '복귀했어요', onClick: otResume } ] });
}

function otResume() {
  OT.status = 'active'; OT.stage = 0; OT.pendingPress = true; otSave();
  interrupt();
  emote('hello', 0, { poke: 3 });
  say('어서 오세요! 복귀하면서 근무확인 누르셨나요?', { ms: 0, choices: [
    { label: '눌렀어요', onClick: otPressed },
    { label: '지금 누를게요', secondary: true, onClick: () => {
        interrupt(); emote('alarm', 0, { poke: 3 });
        say('근무확인 누르고 저를 클릭해 주세요! 🔔', { ms: 0, alarm: true }); } },
  ]});
}

function otFinish() {
  OT.status = 'done'; otSave();
  interrupt();
  emote('hello', 4000, { poke: 3 }); say('오늘도 정말 수고하셨어요! 조심히 들어가세요 👋', { ms: 4000 });
}

// 자리 비움 후 복귀 (메인 프로세스가 10분 이상 입력 없음 → 입력 재개를 감지)
function onUserReturn({ awaySec }) {
  if (OT.status === 'asked') {
    otAsk(minuteOfDay(Date.now()) >= 18 * 60 ? '식사 맛있게 하셨어요? 🍚<br>' : '다시 오셨네요! ');
  } else if (awaySec >= AWAY_REASK_SEC && !bubbleBusy()) {
    interrupt(); emote('hello', 2500, { poke: 3 }); say('다시 오셨네요! 🙂');
  }
}

// ---------- 드래그 & 던지기 ----------
let drag = null;
pet.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || resizing) return;
  pet.setPointerCapture(e.pointerId);
  drag = { startX: e.clientX, startY: e.clientY, offX: s.x - e.clientX, offY: s.y - e.clientY,
           moved: false, hist: [{ x: e.clientX, y: e.clientY, t: performance.now() }] };
});
pet.addEventListener('pointermove', (e) => {
  if (!drag) {
    const sp = Math.hypot(e.movementX, e.movementY);      // 문지르기
    if (sp > 6 && s.mode !== 'fly') { poke(Math.min(sp, 30) * 0.08); s.tiltV += e.movementX * 0.004; }
    return;
  }
  if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 6) {
    drag.moved = true;
    if (!bubbleBusy()) hush();
    s.mode = 'drag'; s.emoteName = null; s.shake = 0;
    setFrame('surprise');
    pet.classList.add('dragging');
  }
  if (drag.moved) {
    s.x = e.clientX + drag.offX; s.y = e.clientY + drag.offY;
    drag.hist.push({ x: e.clientX, y: e.clientY, t: performance.now() });
    if (drag.hist.length > 6) drag.hist.shift();
  }
});
pet.addEventListener('pointerup', () => {
  if (!drag) return;
  pet.classList.remove('dragging');
  if (!drag.moved) onClickPet();
  else {
    const h = drag.hist, a = h[0], b = h[h.length - 1];
    const dt = Math.max((b.t - a.t) / 1000, 0.016);
    s.vx = (b.x - a.x) / dt; s.vy = (b.y - a.y) / dt;
    const max = 3200, sp = Math.hypot(s.vx, s.vy);
    if (sp > max) { s.vx *= max / sp; s.vy *= max / sp; }
    s.mode = 'fly';
    isak.petDropped();                                     // 다른 모니터에 놓았는지 확인
  }
  drag = null;
});

function onClickPet() {
  const now = performance.now();
  s.clicks = s.clicks.filter(t => now - t < 1500); s.clicks.push(now);
  poke(9);
  if (OT.status === 'excluded') { otResume(); return; }
  if (OT.status === 'active' && (OT.stage > 0 || OT.pendingPress)) { otPressed(); return; }
  if (s.clicks.length >= 5) {
    s.clicks = [];
    emote('surprise', 1400, { poke: 6 }); say('으앗! 그만 눌러요~');
  } else if (s.mode === 'idle' || s.mode === 'walk') {
    if (s.mode === 'walk') s.mode = 'idle';
    setFrame('idle');
    s.nextAuto = now + 3000;
  }
}

// ---------- 크기 조절 ----------
function setSize(n, save = true) {
  SIZE = Math.round(Math.max(SIZE_MIN, Math.min(SIZE_MAX, n)));
  pet.style.width = pet.style.height = `${SIZE}px`;
  shadow.style.width = `${SIZE * 0.55}px`;
  shadow.style.height = `${SIZE * 0.08}px`;
  if (save) { poke(2); isak.saveState({ size: SIZE }); }
}
pet.addEventListener('wheel', (e) => {
  if (!resizing) return;
  e.preventDefault(); setSize(SIZE - Math.sign(e.deltaY) * 10);
}, { passive: false });

let resizing = false, hidden = false;
function startResize() {
  interrupt();
  s.mode = 'idle'; s.vx = s.vy = 0; s.y = ground();
  resizing = true;
  pet.classList.add('resizing');
  say('크기 조정 모드예요 📏<br><small>· 제 위에서 <b>마우스 휠</b>을 굴리거나<br>· 오른쪽 위 <b>초록 점</b>을 끌어 주세요</small>', { ms: 0, choices: [
    { label: '완료', onClick: endResize },
    { label: '원래대로', secondary: true, onClick: () => { setSize(220); endResize(); } },
  ]});
}
function endResize() {
  resizing = false;
  pet.classList.remove('resizing');
  setSize(SIZE);
  emote('best', 1800, { poke: 4 });
  say('이 크기로 고정할게요 🔒<br><small>다시 바꾸려면 우클릭 → 크기 조정</small>', { ms: 2800 });
}
const handle = pet.querySelector('.handle');
let hDrag = null;
handle.addEventListener('pointerdown', (e) => {
  e.stopPropagation(); handle.setPointerCapture(e.pointerId);
  hDrag = { x: e.clientX, y: e.clientY, size: SIZE };
});
handle.addEventListener('pointermove', (e) => {
  if (!hDrag) return;
  setSize(hDrag.size + ((e.clientX - hDrag.x) * 2 - (e.clientY - hDrag.y)) / 2, false);
});
handle.addEventListener('pointerup', () => { hDrag = null; });

function hideForAWhile() {
  hush(); hidden = true;
  pet.style.visibility = shadow.style.visibility = 'hidden';
  setTimeout(() => { hidden = false; pet.style.visibility = shadow.style.visibility = ''; actions.hello(); }, 10 * MIN);
}

// ---------- 우클릭 메뉴 ----------
pet.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (resizing) return;
  menu.querySelectorAll('[data-ot]').forEach(el => {
    el.style.display = el.dataset.ot.split(' ').includes(OT.status) ? '' : 'none';
  });
  menu.style.display = 'block';
  const w = menu.offsetWidth, h = menu.offsetHeight;
  menu.style.left = `${Math.max(0, Math.min(e.clientX, env.width - w - 8))}px`;
  menu.style.top = `${Math.max(0, Math.min(e.clientY, env.height - h - 8))}px`;
});
addEventListener('pointerdown', (e) => { if (!menu.contains(e.target)) menu.style.display = 'none'; });
const menuActions = {
  resize: startResize, ask: () => otAsk(), checked: otPressed, fixtime: otFixTime, exclude: otExclude,
  resume: otResume, finish: otFinish, hide: hideForAWhile, quit: () => isak.quit(),
};
menu.addEventListener('click', (e) => {
  const item = e.target.closest('[data-menu]');
  if (!item) return;
  menu.style.display = 'none';
  menuActions[item.dataset.menu]();
});

// ---------- 클릭 통과: 펫·말풍선·메뉴 위에서만 마우스를 받음 ----------
let ignoring = true;
addEventListener('mousemove', (e) => {
  const over = !!(e.target.closest && e.target.closest('#pet, #bubble, #ctxMenu'));
  const want = !over && !drag && !hDrag;
  if (want !== ignoring) { ignoring = want; isak.setIgnoreMouse(want); }
});

// ---------- 메인 루프 ----------
let last = performance.now();
function tick(now) {
  const dt = Math.min((now - last) / 1000, 0.033); last = now;
  const G = ground();
  const L = SIZE * 0.32, R = env.width - SIZE * 0.32;

  if (s.mode === 'fly') {
    s.vy += GRAVITY * dt;
    s.x += s.vx * dt; s.y += s.vy * dt;
    if (s.x < L) { s.x = L; s.vx = -s.vx * BOUNCE; poke(Math.abs(s.vx) * 0.004); s.tiltV += 2; }
    if (s.x > R) { s.x = R; s.vx = -s.vx * BOUNCE; poke(Math.abs(s.vx) * 0.004); s.tiltV -= 2; }
    if (s.y < SIZE * 0.9) { s.y = SIZE * 0.9; s.vy = -s.vy * BOUNCE; poke(-Math.abs(s.vy) * 0.003); }
    bounceOffObstacles();
    if (s.y >= G) {
      s.y = G;
      const impact = s.vy;
      poke(impact * 0.006);
      if (impact > 420) { s.vy = -impact * BOUNCE; s.vx *= FRICTION; }
      else {
        s.vy = 0; s.vx = 0; s.mode = 'idle'; setFrame(impact > 200 ? 'surprise' : 'idle');
        if (impact > 200) emote('surprise', 700);
        isak.saveState({ xRatio: s.x / env.width });
      }
    }
    if (s.mode === 'fly') {
      const sp = Math.hypot(s.vx, s.vy);
      setFrame(sp > 350 ? 'fly' : 'surprise');
      if (Math.abs(s.vx) > 30) s.dir = s.vx > 0 ? 1 : -1;
      s.tiltTarget = s.frame === 'fly' ? Math.max(-0.5, Math.min(0.5, s.vy / 3000)) * s.dir : 0;
    }
  }

  if (s.mode === 'walk') {
    s.x += s.dir * WALK_SPEED * dt;
    if (s.x < L + 20) s.dir = 1;
    if (s.x > R - 20) s.dir = -1;
    setFrame(Math.floor(now / 170) % 2 ? 'runA' : 'runB');
    if (now > s.walkUntil) {
      s.mode = 'idle'; setFrame('idle'); s.nextAuto = now + 3000 + Math.random() * 3000;
      isak.saveState({ xRatio: s.x / env.width });
    }
  }

  if (s.mode === 'emote' && now > s.emoteUntil) endEmote();
  otTick();

  if (s.mode === 'idle') {
    if (now > s.nextBlink) { s.blinkUntil = now + 130; s.nextBlink = now + 2200 + Math.random() * 3500; }
    setFrame(now < s.blinkUntil ? 'blink' : 'idle');
  }

  if (autoplay && !resizing && !hidden && !bubbleBusy() && s.mode === 'idle' && now > s.nextAuto) {
    const r = Math.random();
    if (r < 0.5) startWalk();
    else if (r < 0.62) actions.research();
    else if (r < 0.72) actions.farm();
    else if (r < 0.8) actions.curious();
    else if (r < 0.93) actions.care();
    else actions.sleep();
    if (s.mode === 'idle') s.nextAuto = now + 12000;
  }

  // 말랑 스프링
  const k = 260, damp = 9;
  s.sqV += (-k * s.sq - damp * s.sqV) * dt;
  s.sq += s.sqV * dt;
  s.sq = Math.max(-0.45, Math.min(0.45, s.sq));
  let tiltGoal = s.tiltTarget;
  if (s.emoteName === 'sleep') tiltGoal = 0.12 + Math.sin(now / 900) * 0.1;
  if (s.emoteName === 'hello') tiltGoal = Math.sin(now / 160) * 0.08;
  if (s.emoteName === 'think') tiltGoal = Math.sin(now / 700) * 0.07;
  s.tiltV += (-140 * (s.tilt - tiltGoal) - 10 * s.tiltV) * dt;
  s.tilt += s.tiltV * dt;

  let hop = 0;
  if (s.mode === 'walk') hop = Math.abs(Math.sin(now / 170 * Math.PI)) * 10;
  if (s.emoteName === 'cheer' || s.emoteName === 'best') hop = Math.abs(Math.sin(now / 200 * Math.PI)) * 26;
  if (s.emoteName === 'alarm') hop = Math.abs(Math.sin(now / 130 * Math.PI)) * 8;
  const breathe = (s.mode === 'idle' || s.mode === 'emote') ? Math.sin(now / 600) * 0.015 : 0;
  const shakeX = s.shake ? Math.sin(now / 30) * 4 : 0;

  const sx = 1 + s.sq * 0.9 - breathe, sy = 1 - s.sq + breathe;
  const flip = FACES_LEFT[s.frame] ? -s.dir : 1;
  pet.style.transform = `translate(${s.x - SIZE / 2 + shakeX}px, ${s.y - SIZE * FOOT - hop}px)`;
  img.style.transform = `rotate(${s.tilt}rad) scale(${sx * flip}, ${sy})`;

  const height = Math.max(0, G - s.y + hop);
  const shScale = Math.max(0.35, 1 - height / 500);
  shadow.style.transform = `translate(${s.x - SIZE * 0.275}px, ${G - SIZE * 0.04}px) scale(${shScale * (1 + s.sq * 0.6)}, ${shScale})`;
  shadow.style.opacity = shScale;

  if (bubble.style.display === 'block') {
    const bw = bubble.offsetWidth / 2 + 8;
    bubble.style.left = `${Math.max(bw, Math.min(env.width - bw, s.x))}px`;
    bubble.style.top = `${Math.max(bubble.offsetHeight + 12, s.y - SIZE * 0.92 - hop)}px`;
  }
  requestAnimationFrame(tick);
}

// 바탕화면 아이콘 충돌 (obstacles가 비어 있으면 아무 일도 없음)
function bounceOffObstacles() {
  const BODY_R = SIZE * 0.27, cx0 = s.x, cy0 = s.y - SIZE * 0.42;
  for (const r of obstacles) {
    const nx = Math.max(r.left, Math.min(cx0, r.right)), ny = Math.max(r.top, Math.min(cy0, r.bottom));
    let dx = cx0 - nx, dy = cy0 - ny;
    const dist = Math.hypot(dx, dy);
    if (dist >= BODY_R) continue;
    if (dist === 0) { dx = 0; dy = -1; } else { dx /= dist; dy /= dist; }
    const push = BODY_R - dist;
    s.x += dx * push; s.y += dy * push;
    const vn = s.vx * dx + s.vy * dy;
    if (vn < 0) { s.vx -= 1.9 * vn * dx; s.vy -= 1.9 * vn * dy; poke(Math.min(Math.abs(vn) * 0.004, 0.35)); }
  }
}

// ---------- 시작 ----------
function applyEnv(e) {
  env.width = e.width; env.height = e.height; env.isWorkday = e.isWorkday;
  if (e.xRatio != null) s.x = e.xRatio * env.width;
  s.x = Math.max(SIZE * 0.32, Math.min(env.width - SIZE * 0.32, s.x));
  if (s.mode !== 'fly' && s.mode !== 'drag') s.y = ground();
}
(async () => {
  const e = await isak.getEnv();
  const st = e.state;
  autoplay = st.autoplay;
  setSize(st.size, false);
  applyEnv({ ...e, xRatio: st.xRatio });
  if (st.ot && st.ot.status) {              // 앱을 껐다 켜도 초과근무 상태 이어가기
    OT.status = st.ot.status; OT.base = st.ot.base;
    if (OT.status === 'asked') OT.status = 'none';
  }
  requestAnimationFrame(tick);
  setTimeout(() => { if (!bubbleBusy()) actions.hello(); }, 600);
})();

isak.on('env', (e) => applyEnv(e));
isak.on('moved-display', (e) => { applyEnv(e); s.vx *= 0.3; });
isak.on('user-return', onUserReturn);
isak.on('coin', ({ coins }) => { interrupt(); emote('cheer', 2600, { poke: 6 }); say(`코인 +1 🪙 (보유 ${coins}/5)`); });
isak.on('command', (c) => {
  if (c.type === 'ask') otAsk();
  else if (c.type === 'pressed') otPressed();
  else if (c.type === 'exclude') otExclude();
  else if (c.type === 'resume') otResume();
  else if (c.type === 'finish') otFinish();
  else if (c.type === 'size') setSize(c.value);
  else if (c.type === 'autoplay') autoplay = c.value;
});

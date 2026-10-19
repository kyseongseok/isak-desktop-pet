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
function say(html, { ms = 3500, alarm = false, choices = null, top = false } = {}) {
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
      onTap(b, () => c.onClick());
      box.appendChild(b);
    });
    bubble.appendChild(box);
  }
  clearTimeout(bubbleTimer);
  if (ms) bubbleTimer = setTimeout(hush, ms);
  // 근무확인 알람은 전체화면 앱 위로도 계속 끌어올림, 답이 필요한 질문은 한 번만 올림, 케어 메시지·딴짓 대사는 평소 자리에서 조용히
  isak.setOnTop(alarm ? 'alarm' : (!!choices || top));
}
// 비활성(포커스 없는) 창에서는 윈도우가 click 이벤트를 안 만들어 주기도 함 → pointerup과 click 중 먼저 오는 것 하나로 실행
function onTap(el, fn) {
  let last = 0;
  const run = (e) => { e.stopPropagation(); const now = performance.now(); if (now - last < 300) return; last = now; fn(e); };
  el.addEventListener('pointerup', (e) => { if (e.button === 0) run(e); });
  el.addEventListener('click', run);
}
function hush() { bubble.style.display = 'none'; bubble.classList.remove('wide'); clearTimeout(bubbleTimer); isak.setOnTop(false); }
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
function interrupt() { hush(); siren.stop(); if (s.mode === 'emote') endEmote(); }

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
// 정시 스트레칭: N시간마다 정각에 한 번, 화면 위로 올라와서 몸 풀기 권유 (09~20시, 알람·질문 중엔 건너뜀)
let hourlyEvery = 2, lastHourly = -1;
const HOURLY = [
  ['정각이에요! 잠깐 기지개 쭉 펴 볼까요? 🙆', 'cheer'],
  ['물 한 잔 하고 오시는 게 어때요? 💧', 'hello'],
  ['어깨랑 목을 살살 돌려 볼까요? 🔄', 'best'],
  ['허리 펴고 먼 곳 한 번 바라봐요 👀', 'curious'],
  ['잠깐 일어나서 두어 걸음 걸어 볼까요? 🚶', 'run'],
];
function hourlyTick() {
  if (!hourlyEvery || tutorial.active || bubbleBusy() || FOCUS.status !== 'off') return;
  const d = new Date(), h = d.getHours();
  if (d.getMinutes() !== 0 || h < 9 || h > 20 || h % hourlyEvery !== 0 || lastHourly === h) return;
  lastHourly = h;
  const [text, face] = HOURLY[Math.floor(Math.random() * HOURLY.length)];
  interrupt(); emote(face === 'run' ? 'hello' : face, 6000, { poke: 4 });
  say(`<small>${String(h).padStart(2, '0')}:00</small><br>${text}`, { ms: 8000, top: true });
}
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const scene = () => 15000 + Math.random() * 10000;
const actions = {
  hello() { emote('hello', 2500, { poke: 3 }); s.tiltTarget = 0.12; say('안녕하세요! 오늘도 파이팅 🌾'); },
  care() {
    if (performance.now() - lastCare < 25 * MIN || FOCUS.status !== 'off') return;     // 너무 자주 말하지 않기
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
// '근무일'은 새벽 5시에 바뀜: 자정 넘겨 일해도 같은 날의 초과근무로 이어짐
const workDate = (t = Date.now()) => new Date(t - 5 * 60 * MIN).toDateString();
const OT = { status: 'none', base: null, stage: 0, pendingPress: false, snoozeUntil: 0, date: workDate(), planAt: 0, planReminded: false };
const STALE_MS = 90 * MIN;            // 마감 후 이만큼 응답이 없으면 퇴근한 것으로 보고 알람을 끔
const deadline = () => OT.base + 60 * MIN;
function otSave() { isak.saveState({ ot: { status: OT.status, base: OT.base, date: OT.date, snoozeUntil: OT.snoozeUntil, pendingPress: OT.pendingPress, planAt: OT.planAt } }); }
function otReset() {
  OT.status = 'none'; OT.base = null; OT.stage = 0; OT.pendingPress = false; OT.snoozeUntil = 0; OT.planAt = 0; OT.planReminded = false;
  OT.date = workDate(); otSave();
}

let bootDone = false;                          // 시작 인사·튜토리얼을 먼저 정한 뒤에 질문·알람이 돌기 시작
function otTick() {
  hourlyTick();
  if (!bootDone || tutorial.active) return;    // 튜토리얼이 끝날 때까지 질문·알람 보류
  const t = Date.now();
  // 앱을 켜 둔 채 근무일이 바뀌면(새벽 5시 지남) 어제 기록은 버리고 새로 시작
  if (OT.date !== workDate()) { interrupt(); otReset(); }
  // 마감이 한참 지났는데 응답이 없으면 퇴근한 것으로 보고 조용히 종료 (어제 알람이 아침까지 남지 않게)
  if (OT.status === 'active' && OT.base && !OT.pendingPress && t - deadline() > STALE_MS) {
    OT.status = 'done'; otSave(); interrupt();
    say('한참 응답이 없어서 초과근무 알람을 껐어요 🙂<br><small>다시 하려면 우클릭 → 초과근무 시작</small>', { ms: 8000 });
  }
  if (OT.status === 'none' && t >= OT.snoozeUntil && (!env.isWorkday || minuteOfDay(t) >= ASK_AT) && FOCUS.status === 'off') otAsk();   // 집중 중엔 끝난 뒤에
  if (OT.status === 'active' && OT.pendingPress && OT.planAt && !OT.planReminded && t >= OT.planAt) {
    OT.planReminded = true; interrupt(); emote('alarm', 0, { poke: 4 }); siren.play(1);
    say(`${fmt(OT.planAt)}이에요! 근무확인 누르셨나요? 🔔`, { ms: 0, alarm: true, choices: [
      { label: '눌렀어요', onClick: otPressed },
      { label: '10분 뒤', secondary: true, onClick: () => { OT.planAt = Date.now() + 10 * MIN; OT.planReminded = false; otSave(); interrupt(); } },
    ]});
    isak.notify('이삭이', '근무확인 누르셨나요?');
  }
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
    { label: '예', onClick: otAskPressed },
    { label: '아니오', secondary: true, onClick: () => {
        OT.status = 'declined'; otSave(); interrupt();
        emote('hello', 2500); say('오늘도 수고하셨어요! 👋'); } },
    { label: '30분 뒤', secondary: true, onClick: () => {
        OT.status = 'none'; OT.snoozeUntil = Date.now() + 30 * MIN; otSave(); interrupt();
        say(`${fmt(OT.snoozeUntil)}에 다시 여쭤볼게요`, { ms: 2500 }); } },
  ]});
}

// 예 → 근무확인을 이미 눌렀는지. 아직이면 누를 때까지 알람 없이 대기 (누른 시각이 첫 기준)
function otAskPressed() {
  say('근무확인은 누르셨어요?', { ms: 0, choices: [
    { label: '이미 눌렀어요', onClick: otChooseBase },
    { label: '아직이에요', onClick: otAskPlan },
    { label: '← 돌아가기', secondary: true, onClick: () => otAsk() },
  ]});
}
function otAskPlan() {
  const h = new Date().getHours(), opts = [];
  for (let i = 1; i <= 2; i++) { const d = new Date(); d.setHours(h + i, 0, 0, 0); opts.push(d.getTime()); }
  say('몇 시쯤 누르실 거예요?<br><small>그때 한 번 여쭤볼게요</small>', { ms: 0, choices: [
    ...opts.map(ms => ({ label: fmt(ms), onClick: () => otWait(ms) })),
    { label: '직접 입력', secondary: true, onClick: () => askTime('누를 예정 시각', opts[0], otWait, otAskPlan) },
    { label: '알림 없이', secondary: true, onClick: () => otWait(0) },
  ]});
  bubble.querySelector('.choices').classList.add('wrap');
}
function otWait(planAt) {
  OT.status = 'active'; OT.base = null; OT.stage = 0; OT.pendingPress = true; OT.planAt = planAt; OT.planReminded = false; otSave();
  interrupt();
  emote('best', 3000, { poke: 3 });
  say(`알겠어요! 근무확인을 누르면 <b>저를 클릭하거나 아래 버튼</b>을 눌러 주세요<br><small>그 시각부터 1시간씩 셀게요${planAt ? ` · <b>${fmt(planAt)}</b>에 "누르셨어요?" 하고 여쭤볼게요` : ''}</small>`, { ms: 0, choices: [
    { label: '근무확인 눌렀어요', onClick: otPressed },
    { label: '알겠어요', secondary: true, onClick: interrupt },
  ]});
}
// 기본 기준 시각: 평일 18시 전이면 18:00, 그 외엔 가장 최근 정시 (정시마다 눌렀다고 보고)
function defaultBase() {
  const now = new Date();
  if (env.isWorkday && now.getHours() < 18) return todayAt(18, 0);
  now.setMinutes(0, 0, 0); return now.getTime();
}
function otChooseBase() {
  say('근무확인 알람 기준을 골라 주세요', { ms: 0, choices: [
    { label: `정시 기본 (${fmt(defaultBase())})`, onClick: () => otStart(defaultBase()) },
    { label: '방금 눌렀어요', onClick: () => otStart(Date.now()) },
    { label: '시각 입력', secondary: true, onClick: () =>
        askTime('근무확인을 누른 시각을 알려 주세요', Date.now(), otStartOrPlan, () => otAsk()) },
    { label: '← 돌아가기', secondary: true, onClick: () => otAsk() },
  ]});
}

// 시각 고르기: 이삭이 창은 키보드를 받지 않으므로 마우스 버튼만으로 조절 (시 ±1, 분 ±5)
function askTime(html, defMs, cb, onCancel = interrupt) {
  const d = new Date(defMs); d.setSeconds(0, 0); d.setMinutes(Math.round(d.getMinutes() / 5) * 5);
  const render = () => {
    const h = String(d.getHours()).padStart(2, '0'), m = String(d.getMinutes()).padStart(2, '0');
    const now = Date.now(), diff = Math.round((d.getTime() - now) / MIN);
    const rel = diff === 0 ? '지금' : diff > 0 ? `${diff}분 뒤` : `${-diff}분 전`;
    bubble.querySelector('.tp-h').textContent = h; bubble.querySelector('.tp-m').textContent = m;
    bubble.querySelector('.tp-rel').textContent = rel;
  };
  say(html, { ms: 0, choices: [
    { label: '확인', onClick: () => cb(d.getTime()) },
    { label: '취소', secondary: true, onClick: onCancel },
  ]});
  const box = document.createElement('div');
  box.className = 'timepick';
  box.innerHTML = `
    <div class="tp-col"><button data-d="60">▲</button><div class="tp-h">00</div><button data-d="-60">▼</button></div>
    <div class="tp-sep">:</div>
    <div class="tp-col"><button data-d="5">▲</button><div class="tp-m">00</div><button data-d="-5">▼</button></div>
    <div class="tp-side"><div class="tp-rel"></div><button data-zero>정시로</button></div>`;
  let lastTap = 0;
  const tap = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    e.stopPropagation(); const now = performance.now(); if (now - lastTap < 250) return; lastTap = now;
    if (b.dataset.zero !== undefined) d.setMinutes(0);
    else d.setTime(d.getTime() + (+b.dataset.d) * MIN);
    render();
  };
  box.addEventListener('pointerup', tap); box.addEventListener('click', tap);
  bubble.insertBefore(box, bubble.querySelector('.choices'));
  render();
}

const nextInfo = () => `다음 마감 <b>${fmt(deadline())}</b> · ${fmt(deadline() - 5 * MIN)}에 알려드릴게요 ⏰`;

// 누른 시각으로 미래를 넣으면 "그때 누를 예정"으로 보고, 그 시각에 한 번 물어봄 (기준은 실제로 누른 뒤에 잡힘)
function otStartOrPlan(ms) {
  if (ms > Date.now() + 30 * 1000) { otWait(ms); return; }
  otStart(ms);
}
function otStart(base) {
  OT.status = 'active'; OT.base = base; OT.stage = 0; OT.pendingPress = false; otSave();
  interrupt();
  emote('best', 2500, { poke: 4 });
  say(`초과근무 알람 시작! (기준 ${fmt(base)})<br>${nextInfo()}`, { ms: 5000 });
}

function otAlarm(stage) {
  console.log(`[alarm] stage ${stage}`);
  interrupt();
  const dl = fmt(deadline());
  if (stage === 4) {
    emote('tired', 0);
    otAlarmSay(4);
    isak.notify('이삭이', `${dl} 근무확인 마감이 지났어요. 사유 적고 눌러 주세요`);
    siren.play(4);
    isak.alarmStage({ stage: 4, text: `${dl} 마감이 지났어요`, deadline: dl });
    setTimeout(() => siren.stop(), 20000);          // 초과 상태는 20초만 울리고 말풍선만 남김
    return;
  }
  const text = { 1: '근무확인 누를 시간이에요! 🔔', 2: '3분 남았어요! ⏳', 3: '1분 남았어요!! 🚨' }[stage];
  siren.play(stage);
  isak.alarmStage({ stage, text, deadline: dl });
  emote('alarm', 0, { poke: 4 + stage });
  s.shake = stage;
  otAlarmSay(stage);
  if (stage === 1) isak.notify('이삭이', `근무확인 누를 시간이에요! (${dl}까지)`);
}

// 알람 말풍선만 (소리·알림 없이) — 확인 질문에서 "아니요"를 누르면 이걸로 되돌림
function otAlarmSay(stage) {
  const dl = fmt(deadline());
  if (stage === 4) {
    say(`앗… ${dl} 마감이 지났어요 ㅠ<br>사유 적고 근무확인 눌러 주세요`, { ms: 0, choices: [
      { label: '지금 눌렀어요', onClick: otPressed } ] });
    return;
  }
  const text = { 1: '근무확인 누를 시간이에요! 🔔', 2: '3분 남았어요! ⏳', 3: '1분 남았어요!! 🚨' }[stage];
  say(`${text}<br><small>${dl}까지 · 누르고 저를 클릭하거나 ↓</small>`, { ms: 0, alarm: true, choices: [{ label: '근무확인 눌렀어요', onClick: otPressed }] });
}

// 이삭이를 클릭했다고 바로 근무확인으로 기록하지 않고 한 번 물어봄 (던지기·메뉴 열기 등 실수 클릭이 기준 시각이 되는 걸 막음)
function otConfirmPress() {
  const alarm = OT.stage > 0 && OT.stage < 4;   // 초과 상태는 원래 말풍선처럼 한 번만 올림
  say('근무확인 누르셨어요?', { ms: alarm ? 0 : 12000, alarm, choices: [
    { label: '네, 눌렀어요', onClick: otPressed },
    { label: '아니요', secondary: true, onClick: () => {
        if (OT.stage > 0) otAlarmSay(OT.stage);
        else { hush(); say('알겠어요, 누르면 알려 주세요 🙂', { ms: 2500 }); } } },
  ]});
}
function otConfirmResume() {
  say('복귀하셨어요?', { ms: 12000, choices: [
    { label: '네, 복귀했어요', onClick: otResume },
    { label: '아니요', secondary: true, onClick: () => { hush(); say('그럼 더 쉬다 오세요 🙂', { ms: 2500 }); } },
  ]});
}

function otPressed() {
  interrupt();
  if (OT.status === 'excluded') return otResume();
  if (OT.status !== 'active') { say('지금은 초과근무 알람이 꺼져 있어요', { ms: 2500 }); return; }
  const late = OT.stage === 4;
  const first = OT.pendingPress && !OT.base;
  OT.base = Date.now(); OT.stage = 0; OT.pendingPress = false; OT.planAt = 0; otSave();
  if (first) { emote('best', 2500, { poke: 5 }); say(`초과근무 시작! (기준 ${fmt(OT.base)})<br>${nextInfo()}`, { ms: 5000 }); return; }
  if (late) { emote('hello', 4500, { poke: 4 }); say(`괜찮아요, 그럴 수 있죠! 🙂<br>${nextInfo()}`, { ms: 5000 }); }
  else { emote('best', 2500, { poke: 5 }); say(`근무확인 완료! 최고예요 👍<br>${nextInfo()}`, { ms: 5000 }); isak.coinBonus(); }
  if (FOCUS.status === 'focus') setTimeout(() => { if (FOCUS.status === 'focus' && s.mode !== 'emote') emote('research', 0); }, 5200);   // 집중 중이면 조용한 포즈로 복귀
}

function otFixTime() {
  if (OT.status !== 'active' || !OT.base) { say('아직 기준 시각이 없어요. 근무확인을 누르면 저를 클릭해 주세요', { ms: 3000 }); return; }
  askTime('실제로 근무확인을 누른 시각을 알려 주세요', OT.base, (ms) => {
    if (ms > Date.now() + 30 * 1000) { otWait(ms); return; }       // 미래 시각 = 그때 누를 예정
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
        say('근무확인 누르고 저를 클릭해 주세요! 🔔', { ms: 0, alarm: true, choices: [{ label: '근무확인 눌렀어요', onClick: otPressed }] }); } },
  ]});
}

// 개발·확인용: 알람 4단계를 15초 간격으로 차례로 울림 (기준 시각을 뒤로 옮겨 가며)
function otAlarmTest() {
  interrupt();
  OT.status = 'active'; OT.pendingPress = false; OT.planAt = 0; OT.stage = 0; OT.base = Date.now() + 10 * MIN - 60 * MIN;
  const steps = [5 * MIN + 2000, 3 * MIN + 2000, MIN + 2000, -2000];     // 남은 시간
  say('알람 테스트: 15초마다 5분 전 → 3분 전 → 1분 전 → 초과 순서로 울려요', { ms: 4000 });
  steps.forEach((remain, i) => setTimeout(() => {
    OT.base = Date.now() + remain - 60 * MIN; OT.stage = i; otSave();
    console.log(`[alarm-test] step ${i + 1}, remain ${Math.round(remain / 1000)}s`);
  }, 3000 + i * 15000));
  setTimeout(() => { interrupt(); otReset(); say('알람 테스트 끝! 원래 상태로 돌아왔어요', { ms: 4000 }); }, 3000 + 4 * 15000 + 12000);
}

function otFinish() {
  OT.status = 'done'; otSave();
  interrupt();
  emote('hello', 4000, { poke: 3 }); say('오늘도 정말 수고하셨어요! 조심히 들어가세요 👋', { ms: 4000 });
}

// 자리 비움 후 복귀 (메인 프로세스가 10분 이상 입력 없음 → 입력 재개를 감지)
function onUserReturn({ awaySec }) {
  if (tutorial.active) return;
  if (FOCUS.status === 'focus' && awaySec >= AWAY_REASK_SEC) { focusPause(awaySec * 1000); return; }
  if (OT.status === 'asked') {
    otAsk(minuteOfDay(Date.now()) >= 18 * 60 ? '식사 맛있게 하셨어요? 🍚<br>' : '다시 오셨네요! ');
  } else if (awaySec >= AWAY_REASK_SEC && !bubbleBusy()) {
    interrupt(); emote('hello', 2500, { poke: 3 }); say('다시 오셨네요! 🙂');
  }
}

// ---------- 튜토리얼: 처음 설치했을 때 한 바퀴 안내 (트레이에서 다시 볼 수 있음) ----------
const tutorial = (() => {
  // [표정, 내용, 추가 버튼(선택)]
  const steps = [
    ['hello', '안녕하세요, 저는 <b>이삭이</b>예요! 🌾<br>바탕화면에서 같이 지낼게요. 잠깐 소개해 드릴게요'],
    ['curious', '저를 <b>클릭</b>하면 말랑하고, <b>끌어서 던지면</b> 튕겨요.<br>작업할 땐 조용히 걸어 다니기만 해요'],
    ['think', '평일 <b>17:55</b>에 "오늘 초과 근무 하시나요?" 하고 여쭤봐요.<br>주말·공휴일엔 켜질 때 바로 여쭤보고요.<br>예라고 하면 <b>근무확인 1시간 마감</b>을 챙겨드려요'],
    ['alarm', '마감 <b>5·3·1분 전</b>에 알려드려요.<br>근무확인을 누르면 <b>저를 클릭하거나 버튼</b>을 눌러 주세요. 그 시각부터 다시 1시간이에요'],
    ['alarm', '알람 소리는 네 가지 중 고를 수 있어요. 눌러서 들어보세요 👇<br><small>스피커를 켜거나 음소거를 해제해 두시면 좋아요. 기본은 "조용히"고, 우클릭 → 알람 소리 설정에서 바꿔요</small>',
      [['🔕', () => siren.preview('quiet')], ['🪩 클럽', () => siren.preview('club')], ['🚑 앰뷸런스', () => siren.preview('ambulance')], ['🚓 경찰차', () => siren.preview('police')]]],
    ['angry', '저는 버튼을 <b>대신 누르진 않아요</b>. 알림만! 🙂<br>개인 용무로 자리를 비울 땐 우클릭 → <b>제외시간 시작</b>, 돌아오면 저를 클릭해 주세요'],
    ['curious', '<b>우클릭</b>하면 메뉴가 나와요.<br>초과근무 시작 · 알람 소리 설정 · 크기 조정 · 미니게임 · 숨기기'],
    ['best', '<b>코인</b>은 매일 아침 <b>3개</b>로 채워져요 🪙<br>초과근무 중 근무확인을 제때 누르면 <b>1시간마다 +1</b>, 최대 5개까지 모여요<br><small>첫날엔 체험용으로 5개 드렸어요!</small>'],
    ['cheer', '코인 1개로 <b>미니게임</b> 한 판!<br>🎮 <b>과수원을 지켜라</b>: ← →로 과일은 받고 새똥은 피하기<br>⌨️ <b>이삭이 타자게임</b>: 새가 물고 온 단어를 치고 Enter<br>점수 카드를 복사해서 동료와 겨뤄 보세요'],
    ['hello', '설정은 <b>트레이 아이콘</b>에서도 바꿀 수 있어요.<br><small>윈도우: 작업표시줄 오른쪽 알림 영역 · 맥: 화면 위 메뉴 막대</small><br>이 안내는 우클릭 → "튜토리얼 다시 보기". 그럼 잘 부탁해요! 👋'],
  ];
  let i = 0, active = false;
  function showStep() {
    active = true;
    const [face, html, extra = []] = steps[i];
    interrupt(); emote(face, 0, { poke: 2 });
    say(`<small>${i + 1}/${steps.length}</small><br>${html}`, { ms: 0, choices: [
      ...extra.map(([label, fn]) => ({ label, secondary: true, onClick: fn })),
      { label: i === steps.length - 1 ? '시작!' : '다음', onClick: () => { siren.stop(); i++; i < steps.length ? showStep() : finish(); } },
      ...(i > 0 ? [{ label: '이전', secondary: true, onClick: () => { siren.stop(); i--; showStep(); } }] : []),
      { label: '건너뛰기', secondary: true, onClick: finish },
    ]});
    bubble.classList.add('wide');
    if (extra.length) bubble.querySelector('.choices').classList.add('wrap');
  }
  function finish() { active = false; siren.stop(); interrupt(); isak.saveState({ tutorialDone: true }); emote('hello', 2500, { poke: 3 }); say('오늘도 파이팅! 🌾', { ms: 2500 }); }
  return { start() { interrupt(); i = 0; showStep(); }, get active() { return active; } };
})();

// ---------- 드래그 & 던지기 ----------
let drag = null;
pet.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || resizing) return;
  if (FOCUS.status === 'focus' || FOCUS.status === 'paused') { poke(4); focusBubble(); return; }   // 집중 중엔 던지기 없음
  // 포인터 캡처는 쓰지 않음: 윈도우는 비활성 창의 마우스 캡처를 거부해 드래그·클릭이 끊김. 대신 문서 전체에서 추적
  drag = { startX: e.clientX, startY: e.clientY, offX: s.x - e.clientX, offY: s.y - e.clientY,
           moved: false, hist: [{ x: e.clientX, y: e.clientY, t: performance.now() }] };
  sendHitRects();
});
pet.addEventListener('pointermove', (e) => {
  if (drag) return;
  const sp = Math.hypot(e.movementX, e.movementY);      // 문지르기
  if (sp > 6 && s.mode !== 'fly') { poke(Math.min(sp, 30) * 0.08); s.tiltV += e.movementX * 0.004; }
});
addEventListener('pointermove', (e) => {
  if (!drag) return;
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
function endDrag(e) {
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
  drag = null; sendHitRects();
}
addEventListener('pointerup', (e) => { if (e.button === 0) endDrag(e); });
addEventListener('pointercancel', endDrag);
addEventListener('blur', () => { if (drag) endDrag(); });

function onClickPet() {
  const now = performance.now();
  s.clicks = s.clicks.filter(t => now - t < 1500); s.clicks.push(now);
  poke(9);
  if (OT.status === 'excluded') { otConfirmResume(); return; }
  if (OT.status === 'active' && (OT.stage > 0 || OT.pendingPress)) { otConfirmPress(); return; }
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
  e.stopPropagation();
  hDrag = { x: e.clientX, y: e.clientY, size: SIZE }; sendHitRects();
});
addEventListener('pointermove', (e) => {
  if (!hDrag) return;
  setSize(hDrag.size + ((e.clientX - hDrag.x) * 2 - (e.clientY - hDrag.y)) / 2, false);
});
addEventListener('pointerup', () => { if (hDrag) { hDrag = null; sendHitRects(); } });

// ---------- 집중 타이머 (Time Timer 원판 + 뽀모도로) ----------
// 집중 중엔 걷기·딴짓·케어·정시 알림·던지기 멈춤. 근무확인 알람만 그대로. 창은 평소대로 뒤에 (설정으로 항상 위)
const FOCUS = { status: 'off', endAt: 0, total: 0, remain: 0, minutesSet: 50, onTop: false, sessions: 0, minutes: 0, coinGiven: false, lastTickMin: -1 };
const ring = document.getElementById('ring');
const focusRemainMin = () => Math.max(0, Math.ceil((FOCUS.status === 'paused' ? FOCUS.remain : FOCUS.endAt - Date.now()) / MIN));
const breakFor = (m) => (m >= 45 ? 10 : 5);
function focusSave() { isak.saveState({ focusMinutes: FOCUS.minutesSet, focus: { date: workDate(), sessions: FOCUS.sessions, minutes: FOCUS.minutes, coinGiven: FOCUS.coinGiven } }); }

const alarmActive = () => OT.status === 'active' && OT.stage > 0;
function focusChoose() {
  if (alarmActive()) { say('근무확인부터 눌러 주세요! 그다음 집중해요 🔔', { ms: 3000 }); return; }
  interrupt();
  emote('think', 0, { poke: 2 });
  say(`집중 타이머 ⏱ 몇 분 할까요?<br><small>끝나면 ${breakFor(FOCUS.minutesSet)}분 쉬고, 집중 중엔 조용히 있을게요</small>`, { ms: 0, choices: [
    { label: `${FOCUS.minutesSet}분 시작`, onClick: () => focusStart(FOCUS.minutesSet) },
    { label: '25분', secondary: true, onClick: () => focusStart(25) },
    { label: '45분', secondary: true, onClick: () => focusStart(45) },
    { label: '직접 설정', secondary: true, onClick: focusPickMinutes },
    { label: '취소', secondary: true, onClick: interrupt },
  ]});
  bubble.querySelector('.choices').classList.add('wrap');
}
function focusPickMinutes() {
  let m = FOCUS.minutesSet;
  say('집중 시간 (분)', { ms: 0, choices: [
    { label: '시작', onClick: () => focusStart(m) },
    { label: '취소', secondary: true, onClick: interrupt },
  ]});
  const box = document.createElement('div');
  box.className = 'timepick';
  box.innerHTML = `<div class="tp-col"><button data-d="5">▲</button><div class="tp-m">${m}</div><button data-d="-5">▼</button></div><div class="tp-side"><div class="tp-rel">분</div></div>`;
  let lastTap = 0;
  const tap = (e) => { const b = e.target.closest('button'); if (!b) return; e.stopPropagation(); const now = performance.now(); if (now - lastTap < 250) return; lastTap = now; m = Math.max(5, Math.min(180, m + (+b.dataset.d))); box.querySelector('.tp-m').textContent = m; };
  box.addEventListener('pointerup', tap); box.addEventListener('click', tap);
  bubble.insertBefore(box, bubble.querySelector('.choices'));
}
function focusStart(minutes) {
  FOCUS.minutesSet = minutes; FOCUS.status = 'focus'; FOCUS.total = minutes * MIN; FOCUS.endAt = Date.now() + FOCUS.total; FOCUS.lastTickMin = -1;
  focusSave(); interrupt();
  if (s.mode === 'walk') s.mode = 'idle';
  emote('research', 0);                       // 집중 포즈로 조용히
  ring.hidden = false;
  say(`${minutes}분 집중 시작! 조용히 있을게요 🤫<br><small>클릭하면 남은 시간 · 일시정지</small>`, { ms: 3500 });
  if (FOCUS.onTop) setTimeout(() => isak.setOnTop('alarm'), 3600);
}
function focusPause(giveBackMs = 0) {
  if (FOCUS.status !== 'focus') return;
  FOCUS.remain = Math.max(0, FOCUS.endAt - Date.now()) + giveBackMs;   // 자리 비운 시간은 집중으로 안 세고 돌려줌
  FOCUS.status = 'paused'; interrupt(); isak.setOnTop(false);
  emote('think', 0);
  say(`${giveBackMs ? '자리를 비우셨네요. ' : ''}집중을 잠시 멈췄어요 (${focusRemainMin()}분 남음)`, { ms: 0, choices: [
    { label: '이어서', onClick: focusResume }, { label: '그만', secondary: true, onClick: () => focusStop(true) } ] });
}
function focusResume() { FOCUS.status = 'focus'; FOCUS.endAt = Date.now() + FOCUS.remain; interrupt(); emote('research', 0); say('다시 집중! 💪', { ms: 2000 }); if (FOCUS.onTop) setTimeout(() => isak.setOnTop('alarm'), 2100); }
function focusStop(quiet = false) {
  FOCUS.status = 'off'; ring.hidden = true; interrupt(); isak.setOnTop(false);
  if (!quiet) return;
  emote('hello', 2500); say('집중 타이머를 껐어요', { ms: 2500 });
}
function focusBubble() {
  if (FOCUS.status === 'paused') return focusPause();
  if (FOCUS.status === 'break') { interrupt(); say(`휴식 중 ☕ ${focusRemainMin()}분 남음`, { ms: 0, choices: [{ label: '바로 다시 집중', onClick: () => focusStart(FOCUS.minutesSet) }, { label: '오늘은 그만', secondary: true, onClick: () => focusStop(true) }] }); return; }
  interrupt(); emote('research', 0);
  say(`집중 중 ⏱ ${focusRemainMin()}분 남음`, { ms: 0, choices: [
    { label: '일시정지', onClick: () => focusPause() }, { label: '그만', secondary: true, onClick: () => focusStop(true) }, { label: '계속', secondary: true, onClick: () => { hush(); } } ] });
}
function focusTick() {
  if (FOCUS.status === 'off' || FOCUS.status === 'paused') return;
  const remain = FOCUS.endAt - Date.now();
  // 원판 갱신 (1초에 한 번이면 충분)
  const frac = Math.max(0, Math.min(1, remain / FOCUS.total));
  const color = FOCUS.status === 'break' ? '#f0a030' : '#2a8c6e';
  ring.style.background = `conic-gradient(${color} ${frac * 360}deg, #e4ece9 ${frac * 360}deg)`;
  ring.querySelector('span').textContent = focusRemainMin();
  if (remain > 0) return;
  if (alarmActive()) { FOCUS.endAt = Date.now() + MIN; return; }   // 알람 처리가 끝난 뒤에 종료 안내
  if (FOCUS.status === 'focus') {
    FOCUS.sessions++; FOCUS.minutes += Math.round(FOCUS.total / MIN);
    const longBreak = FOCUS.sessions % 4 === 0, bm = longBreak ? 15 : breakFor(FOCUS.minutesSet);
    if (FOCUS.sessions === 4 && !FOCUS.coinGiven) { FOCUS.coinGiven = true; setTimeout(() => isak.coinBonus('focus'), 9000); }
    focusSave();
    FOCUS.status = 'break'; FOCUS.total = bm * MIN; FOCUS.endAt = Date.now() + FOCUS.total;
    interrupt(); siren.bell(); emote('cheer', 8000, { poke: 5 });
    const [stretch] = HOURLY[Math.floor(Math.random() * HOURLY.length)];
    say(`${FOCUS.minutesSet}분 집중 완료! ${bm}분 쉬어요 ☕<br><small>${stretch} · 오늘 ${FOCUS.sessions}회</small>`, { ms: 12000, top: true });
    isak.setOnTop('alarm'); setTimeout(() => { if (FOCUS.status === 'break') isak.setOnTop(false); }, 15000);   // 끝났을 땐 전체화면 위로도 15초
  } else {
    FOCUS.status = 'off'; ring.hidden = true; interrupt(); siren.bell();
    emote('best', 0, { poke: 4 });
    say('휴식 끝! 다시 집중할까요?', { ms: 0, choices: [
      { label: `${FOCUS.minutesSet}분 시작`, onClick: () => focusStart(FOCUS.minutesSet) },
      { label: '오늘은 그만', secondary: true, onClick: () => { interrupt(); emote('hello', 2500); say(`오늘 집중 ${FOCUS.sessions}회 · ${FOCUS.minutes}분, 수고했어요 👏`, { ms: 4000 }); } },
    ]});
  }
}

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
  // 지금 어떤 상태인지 맨 위에 표시: 초과근무 중일 때만 근무확인 관련 메뉴가 나옴
  const st = document.getElementById('ctxStatus');
  st.className = (OT.status === 'active' || OT.status === 'excluded') ? 'on' : '';
  const focusLine = FOCUS.status !== 'off' ? `<br>⏱ ${FOCUS.status === 'break' ? '휴식' : FOCUS.status === 'paused' ? '집중 일시정지' : '집중 중'} · ${focusRemainMin()}분 남음` : FOCUS.sessions ? `<br>🍅 오늘 집중 ${FOCUS.sessions}회 · ${FOCUS.minutes}분` : '';
  st.innerHTML = focusLine + {
    active: OT.base ? `🟢 <b>초과근무 중</b> · 기준 ${fmt(OT.base)}<br>다음 마감 <b>${fmt(deadline())}</b>${OT.pendingPress ? ' (근무확인 대기)' : ''}` : `🟡 <b>초과근무 대기</b> · 근무확인 누르면 시작${OT.planAt ? `<br>${fmt(OT.planAt)}에 여쭤볼게요` : ''}`,
    excluded: `⏸ <b>제외시간</b> · 알람 쉬는 중`,
    none: env.isWorkday ? '평일 근무 중 · 17:55에 초과근무 여부를 여쭤볼게요' : '휴일이에요 · 초과근무 알람 꺼짐',
    asked: '초과근무 여부 답변 기다리는 중',
    declined: '오늘은 초과근무 안 함',
    done: '오늘 초과근무 종료함',
  }[OT.status];
  menu.style.display = 'block';
  const w = menu.offsetWidth, h = menu.offsetHeight;
  menu.style.left = `${Math.max(0, Math.min(e.clientX, env.width - w - 8))}px`;
  menu.style.top = `${Math.max(0, Math.min(e.clientY, env.height - h - 8))}px`;
});
addEventListener('pointerdown', (e) => { if (!menu.contains(e.target)) menu.style.display = 'none'; });
// 바깥 클릭은 아래 창으로 통과돼 여기 닿지 않으므로, 마우스가 메뉴를 벗어나 0.7초 지나면 닫음
let menuLeaveTimer = null;
menu.addEventListener('mouseleave', () => { clearTimeout(menuLeaveTimer); menuLeaveTimer = setTimeout(() => { menu.style.display = 'none'; }, 700); });
menu.addEventListener('mouseenter', () => clearTimeout(menuLeaveTimer));
pet.addEventListener('mouseenter', () => clearTimeout(menuLeaveTimer));
// 알람 소리 설정: 테마 → 볼륨, 고를 때마다 3초 미리 듣기
const THEMES = [['quiet', '🔕 조용히'], ['club', '🪩 클럽'], ['ambulance', '🚑 앰뷸런스'], ['police', '🚓 경찰차']];
function saveSound(partial) { siren.configure(partial); isak.saveState({ sound: { ...siren.settings } }); }
function sirenSettings() {
  interrupt();
  const cur = (k, v) => siren.settings[k] === v ? ' ✓' : '';
  const pickVolume = () => say('소리 크기', { ms: 0, choices: [
    { label: `작게${cur('volume', 20)}`, onClick: () => { saveSound({ volume: 20 }); siren.preview(siren.settings.theme); done(); } },
    { label: `보통${cur('volume', 40)}`, onClick: () => { saveSound({ volume: 40 }); siren.preview(siren.settings.theme); done(); } },
    { label: `크게${cur('volume', 70)}`, onClick: () => { saveSound({ volume: 70 }); siren.preview(siren.settings.theme); done(); } },
  ]});
  const done = () => { const t = THEMES.find(x => x[0] === siren.settings.theme)[1];
    say(`저장했어요 🔒 ${t} · 소리 ${siren.settings.volume}%<br><small>5분 전엔 작게, 가까워질수록 커져요</small>`, { ms: 4000 }); };
  say('알람 소리 테마를 골라 주세요<br><small>고르면 3초 미리 들려드려요</small>', { ms: 0, choices:
    THEMES.map(([id, label]) => ({ label: label + cur('theme', id), onClick: () => {
      saveSound({ theme: id }); siren.preview(id);
      if (id === 'quiet') { setTimeout(() => { siren.stop(); done(); }, 1200); } else pickVolume();
    } })) });
  bubble.querySelector('.choices').classList.add('wrap');
}

async function openGame(kind = 'orchard') {
  interrupt();
  const c = await isak.getCoins();
  if (c.coins <= 0) {
    emote('think', 3500); say(`코인이 없어요 🪙<br><small>내일 아침에 ${c.daily}개로 채워져요 · 초과근무 중 근무확인을 제때 누르면 +1</small>`, { ms: 4500 });
    return;
  }
  isak.openGame(kind);
}
const menuActions = {
  focus: () => FOCUS.status === 'off' ? focusChoose() : focusBubble(),
  game: () => openGame('orchard'),
  typing: () => openGame('typing'),
  siren: sirenSettings,
  resize: startResize, ask: () => otAsk(), checked: otPressed, fixtime: otFixTime, exclude: otExclude,
  resume: otResume, finish: otFinish, hide: hideForAWhile, quit: () => isak.quit(), tutorial: () => tutorial.start(),
};
let menuLastTap = 0;
const menuTap = (e) => {
  const now = performance.now(); if (now - menuLastTap < 300) return; menuLastTap = now;
  const item = e.target.closest('[data-menu]');
  if (!item) return;
  menu.style.display = 'none';
  menuActions[item.dataset.menu]();
};
menu.addEventListener('pointerup', (e) => { if (e.button === 0) menuTap(e); }); menu.addEventListener('click', menuTap);

// ---------- 클릭 통과: 펫·말풍선·메뉴 위에서만 마우스를 받음 ----------
// 판정은 메인 프로세스가 커서 위치로 함. 여기서는 마우스를 받아야 할 영역을 10번/초 보내 줌
function sendHitRects() {
  if (drag || hDrag) { isak.hitRects([{ x: -1e5, y: -1e5, w: 2e5, h: 2e5 }]); return; }   // 끌고 있는 동안은 전부 받음
  const rects = [];
  const add = (el, pad = 0) => { if (!el || (el !== pet && getComputedStyle(el).display === 'none') || hidden && el === pet) return;
    const r = el.getBoundingClientRect(); rects.push({ x: r.left - pad, y: r.top - pad, w: r.width + pad * 2, h: r.height + pad * 2 }); };
  add(pet, 4); add(bubble, 6); add(menu, 6);
  isak.hitRects(rects);
}
setInterval(sendHitRects, 100);

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

  if (s.mode === 'idle') {
    if (now > s.nextBlink) { s.blinkUntil = now + 130; s.nextBlink = now + 2200 + Math.random() * 3500; }
    setFrame(now < s.blinkUntil ? 'blink' : 'idle');
  }

  if (autoplay && !resizing && !hidden && !bubbleBusy() && FOCUS.status === 'off' && s.mode === 'idle' && now > s.nextAuto) {
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
  if (s.emoteName === 'cheer' || s.emoteName === 'best') hop = Math.abs(Math.sin(now / (tutorial.active ? 700 : 200) * Math.PI)) * (tutorial.active ? 6 : 26);
  if (s.emoteName === 'alarm' && !tutorial.active) hop = Math.abs(Math.sin(now / 130 * Math.PI)) * 8;
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

  if (!ring.hidden) ring.style.transform = `translate(${s.x - 34}px, ${s.y - SIZE * FOOT - hop - 76}px)`;
  if (bubble.style.display === 'block') {
    const bw = bubble.offsetWidth / 2 + 8;
    bubble.style.left = `${Math.max(bw, Math.min(env.width - bw, s.x))}px`;
    bubble.style.top = `${Math.max(bubble.offsetHeight + 12, s.y - SIZE * 0.92 - hop)}px`;
  }
}
function loop(now) { tick(now); requestAnimationFrame(loop); }
// 알람·집중 타이머 체크는 그리기 루프와 따로 1초마다 (창이 가려져 그리기가 멈춰도 알람은 울려야 함)
setInterval(() => { otTick(); focusTick(); }, 1000);
// 그리기 루프가 0.5초 넘게 멈추면 타이머로 대신 돌림 (가려진 창에서 requestAnimationFrame이 서는 경우 대비)
setInterval(() => { const now = performance.now(); if (now - last > 500) tick(now); }, 250);

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
let resumedSession = false;
(async () => {
  const e = await isak.getEnv();
  const st = e.state;
  autoplay = st.autoplay;
  if (st.hourlyEvery !== undefined) hourlyEvery = st.hourlyEvery;
  if (st.focusMinutes) FOCUS.minutesSet = st.focusMinutes;
  FOCUS.onTop = !!st.focusOnTop;
  if (st.focus && st.focus.date === workDate()) { FOCUS.sessions = st.focus.sessions || 0; FOCUS.minutes = st.focus.minutes || 0; FOCUS.coinGiven = !!st.focus.coinGiven; }
  if (st.sound) siren.configure(st.sound);
  setSize(st.size, false);
  applyEnv({ ...e, xRatio: st.xRatio });
  if (st.ot && st.ot.status) {              // 앱을 껐다 켜도 초과근무 상태 이어가기
    OT.status = st.ot.status; OT.base = st.ot.base; OT.date = st.ot.date || OT.date; OT.snoozeUntil = st.ot.snoozeUntil || 0;
    OT.pendingPress = !!st.ot.pendingPress; OT.planAt = st.ot.planAt || 0;
    if (OT.status === 'asked') OT.status = 'none';
    if (OT.date !== workDate()) otReset();                                                 // 다른 근무일의 기록은 버림
    else if (OT.status === 'active' && OT.base && !OT.pendingPress && Date.now() - deadline() > STALE_MS) OT.status = 'done';   // 마감이 한참 지난 기록은 이어가지 않음
    else if (OT.status === 'active' || OT.status === 'excluded') resumedSession = true;
  }
  requestAnimationFrame(loop);
  setTimeout(() => {
    bootDone = true;
    if (!st.tutorialDone) { tutorial.start(); return; }   // 처음 설치: 안내가 가장 먼저
    if (bubbleBusy()) return;
    if (resumedSession && OT.status === 'active') {       // 재부팅·재시작 뒤 이어가기
      emote('hello', 3000, { poke: 3 }); say(OT.base ? `다시 켜졌네요! 초과근무 이어서 할게요 🙂<br>${nextInfo()}` : '다시 켜졌네요! 근무확인을 누르면 저를 클릭해 주세요 🙂', { ms: 6000 });
    } else if (resumedSession) {
      emote('sleep', 0); say('제외시간 중이었죠? 돌아오셨으면 저를 클릭해 주세요', { ms: 0, choices: [{ label: '복귀했어요', onClick: otResume }] });
    } else actions.hello();
  }, 600);
})();

isak.on('env', (e) => applyEnv(e));
isak.on('moved-display', (e) => { applyEnv(e); s.vx *= 0.3; });
isak.on('user-return', onUserReturn);
isak.on('coin', ({ coins, cap, reason }) => {
  if (bubbleBusy()) return;
  interrupt(); emote('cheer', 2600, { poke: 6 });
  say(reason === 'focus' ? `오늘 4번 집중! 코인 +1 🪙 (${coins}/${cap})` : reason === 'bonus' ? `제때 눌러서 코인 +1 🪙 (${coins}/${cap})` : reason === 'daily' ? `새 근무일! 코인을 채워 뒀어요 🪙 (${coins}/${cap})` : `코인 +1 🪙 (보유 ${coins}/${cap})`);
});
isak.on('game-result', ({ kind, score, best, cleared }) => {
  interrupt();
  if (cleared) { emote('cheer', 4000, { poke: 6 }); say(kind === 'typing' ? `새들을 다 쫓았어요! ${score.toLocaleString()}점 📣` : `과수원을 지켰어요! ${score.toLocaleString()}점 🍎`, { ms: 4000 }); }
  else if (best) { emote('best', 4000, { poke: 5 }); say(`최고 기록! ${score.toLocaleString()}점 👍`, { ms: 4000 }); }
  else { emote('hello', 3000, { poke: 3 }); say(`${score.toLocaleString()}점! 다음엔 더 잘할 수 있어요`, { ms: 3500 }); }
});
isak.on('command', (c) => {
  if (c.type === 'ask') otAsk();
  else if (c.type === 'pressed') otPressed();
  else if (c.type === 'exclude') otExclude();
  else if (c.type === 'resume') otResume();
  else if (c.type === 'finish') otFinish();
  else if (c.type === 'size') setSize(c.value);
  else if (c.type === 'autoplay') autoplay = c.value;
  else if (c.type === 'hourly') hourlyEvery = c.value;
  else if (c.type === 'focus-start') (FOCUS.status === 'off' ? focusChoose() : focusBubble());
  else if (c.type === 'focus-ontop') { FOCUS.onTop = c.value; if (FOCUS.status === 'focus') isak.setOnTop(FOCUS.onTop ? 'alarm' : false); }
  else if (c.type === 'sound') { siren.configure(c.value); if (c.value.theme) siren.preview(c.value.theme); }
  else if (c.type === 'siren-test') { siren.play(3); setTimeout(() => siren.stop(), 4000); }
  else if (c.type === 'alarm-test') otAlarmTest();
  else if (c.type === 'tutorial') tutorial.start();
});

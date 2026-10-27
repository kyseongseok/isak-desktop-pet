// 이삭이 미니게임 공개 순위표 — 구글 앱스 스크립트 (구글 시트에 붙여 넣어 '웹 앱'으로 배포)
// 설정 방법은 docs/순위표-설정.md
// 시트 '기록'에 한 줄씩 쌓임: 시간 | 게임 | 이름 | 점수 | 기기 | 기록 | 확인
// - '확인' 칸에 글자가 있으면 순위표에서 빠짐 (이상해 보이는 기록은 스크립트가 '확인 필요'를 적어 둠 → 괜찮으면 지우기)
// - 이상한 기록은 그 줄을 지우면 끝
// 점수 조작을 완전히 막을 수는 없음 (휴대폰이 계산해서 보내는 구조). 가족·지인용이라 가벼운 검사만

const SHEET = '기록';
const HEAD = ['시간', '게임', '이름', '점수', '기기', '기록', '확인'];
const GAMES = { orchard: '과수원을 지켜라', merge: '이삭이 쑥쑥', pang: '이삭이 수확팡', runner: '이삭RUN' };
const TOP = 10;              // 게임별로 보여 줄 사람 수 (이름마다 최고 점수 하나)
const GAP_SEC = 15;          // 같은 휴대폰에서 연달아 보내기 막기 (초)

const num = (v) => typeof v === 'number' && isFinite(v) && v >= 0;
// 나올 수 없는 기록 → 받지 않음
const HARD = {
  orchard: (r) => r.score <= 100000 && num(r.caught),
  merge: (r) => r.score <= 1000000 && num(r.merges) && num(r.sec),
  pang: (r) => r.score <= 1000000 && num(r.harvested),
  runner: (r) => r.score <= 500000 && num(r.dist) && num(r.sec),
};
// 점수와 플레이 기록이 잘 안 맞음 → 받되 '확인 필요'로 숨겨 둠
const SOFT = {
  orchard: (r) => r.score <= r.caught * 150 + 5000,
  merge: (r) => r.goldens <= r.merges && r.sec <= 4 * 3600 && r.score <= (r.merges + 1) * 3000,
  pang: (r) => r.score <= (r.harvested + 10) * 400,
  runner: (r) => r.dist <= r.sec * 70 + 30 && r.score >= r.dist,   // 최고 속도 800px/s = 약 67m/s, 점수 = 거리 + 보너스
};

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET);
  if (!sh) { sh = ss.insertSheet(SHEET); sh.appendRow(HEAD); sh.setFrozenRows(1); }
  return sh;
}
const json_ = (o) => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);

// 게임별 순위: 이름마다 최고 점수 하나, '확인' 칸이 빈 것만
function board_(rows) {
  const out = {};
  for (const g of Object.keys(GAMES)) {
    const best = {};
    for (const [time, game, name, score, , , flag] of rows) {
      if (game !== g || flag) continue;
      if (!best[name] || score > best[name].score) best[name] = { name, score, time };
    }
    out[g] = Object.values(best).sort((a, b) => b.score - a.score || (a.time < b.time ? -1 : 1));
  }
  return out;
}
const rows_ = () => { const sh = sheet_(); const n = sh.getLastRow(); return n < 2 ? [] : sh.getRange(2, 1, n - 1, HEAD.length).getValues(); };
const iso_ = (t) => (t instanceof Date ? t.toISOString() : String(t));

// 순위표 보기: GET → { ok, games: { runner: [{ name, score, date }], ... } }
function doGet() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('top');
  if (hit) return json_(JSON.parse(hit));
  const b = board_(rows_()), games = {};
  for (const g of Object.keys(b)) games[g] = b[g].slice(0, TOP).map((x) => ({ name: x.name, score: x.score, date: iso_(x.time).slice(0, 10) }));
  const res = { ok: true, games };
  cache.put('top', JSON.stringify(res), 20);   // 20초 동안은 같은 답 (여럿이 동시에 열어도 가볍게)
  return json_(res);
}

// 점수 올리기: POST { game, name, score, rec, device } → { ok, rank, total } 또는 { ok: false, why }
function doPost(e) {
  let d;
  try { d = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, why: '형식 오류' }); }
  const game = String(d.game || ''), rec = d.rec || {}, device = String(d.device || '').slice(0, 40);
  const name = String(d.name || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 10);
  const score = rec.score;
  if (!GAMES[game]) return json_({ ok: false, why: '없는 게임' });
  if (!name) return json_({ ok: false, why: '이름(별명)을 적어 주세요' });
  if (!device || !num(score) || score !== d.score) return json_({ ok: false, why: '형식 오류' });
  if (!HARD[game](rec)) return json_({ ok: false, why: '나올 수 없는 점수예요' });

  const cache = CacheService.getScriptCache();
  if (cache.get('dev:' + device)) return json_({ ok: false, why: `잠시 뒤에 다시 올려 주세요 (${GAP_SEC}초)` });
  const dupKey = ['dup', device, game, score].join(':');
  if (cache.get(dupKey)) return json_({ ok: false, why: '이미 올린 기록이에요' });

  const flag = SOFT[game](rec) ? '' : '확인 필요';
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    sheet_().appendRow([new Date(), game, name, score, device, JSON.stringify(rec).slice(0, 500), flag]);
  } finally { lock.releaseLock(); }
  cache.put('dev:' + device, '1', GAP_SEC);
  cache.put(dupKey, '1', 600);
  cache.remove('top');

  if (flag) return json_({ ok: true, held: true });   // 사용자가 시트에서 확인한 뒤에 보임
  const list = board_(rows_())[game];
  const rank = list.findIndex((x) => x.name === name) + 1;
  const mine = list[rank - 1];
  return json_({ ok: true, rank, total: list.length, best: mine ? mine.score : score });
}

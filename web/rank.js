// 휴대폰 웹앱 공개 순위표: 결과 화면의 '순위표에 올리기' + 고르는 화면의 '순위표' 보기
// 서버는 구글 시트 + 앱스 스크립트 (web/rank-server.gs, 설정은 docs/순위표-설정.md)
// RANK_URL이 비어 있으면 순위표 버튼이 나오지 않음
'use strict';
(() => {
  // 앱스 스크립트 '웹 앱' 주소 (구글 시트 '이삭이 순위표', 2026-10-27 배포). 비우면 순위표가 꺼짐
  const RANK_URL = 'https://script.google.com/macros/s/AKfycbzPFreRLdZ5t6yua_-f2rg-Ohj_BNEtKObrD7tjKANy_Y_PbdwhhXa5Uq0PgfY5YvD_6g/exec';
  if (!RANK_URL) return;
  const GAMES = { orchard: '과수원', merge: '쑥쑥', pang: '수확팡', runner: '이삭RUN' };
  const kind = window.game && window.game.kind;
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  // 이 휴대폰 구분용 아무 번호 (연달아 보내기 막기용, 개인 정보 아님)
  const device = (() => {
    try {
      let d = localStorage.getItem('isak.device');
      if (!d) { d = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('isak.device', d); }
      return d;
    } catch { return 'unknown'; }
  })();

  // ---------- 결과 화면: 순위표에 올리기 ----------
  const share = document.getElementById('shareBtn');
  if (kind && GAMES[kind] && share) {
    const btn = el('button', 'btn web-rank-btn', '🏆 순위표에 올리기');
    const note = el('div', 'web-rank-note', '이름은 누구나 볼 수 있어요. 별명을 써 주세요');
    share.after(btn, note);
    let last = null;
    const ready = () => { btn.disabled = false; btn.textContent = '🏆 순위표에 올리기'; };
    addEventListener('isak-score', (e) => { last = e.detail; ready(); });   // 새 판이 끝날 때마다 다시 올릴 수 있게
    btn.addEventListener('click', async () => {
      const input = document.getElementById('playerName');
      const name = (input ? input.value : '').trim().slice(0, 10);
      if (!name) { note.textContent = '👆 카드에 넣을 이름(별명)을 먼저 적어 주세요'; if (input) input.focus(); return; }
      if (!last) return;
      btn.disabled = true; btn.textContent = '올리는 중…';
      try {
        // text/plain으로 보내야 앱스 스크립트가 받음 (사전 확인 요청 없이)
        const r = await (await fetch(RANK_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify({ game: kind, name, score: last.score, rec: last, device }) })).json();
        if (r.ok && r.held) btn.textContent = '✅ 올렸어요 (확인 뒤 순위표에 나와요)';
        else if (r.ok) btn.textContent = `✅ ${r.total}명 중 ${r.rank}위 (최고 ${Number(r.best).toLocaleString()})`;
        else { btn.textContent = `⚠️ ${r.why || '올리지 못했어요'}`; setTimeout(ready, 3000); }
      } catch {
        btn.textContent = '⚠️ 인터넷 연결을 확인해 주세요'; setTimeout(ready, 3000);
      }
    });
  }

  // ---------- 고르는 화면: 순위표 보기 ----------
  const box = document.querySelector('.web-vibe');
  if (!kind && box) {
    const open = el('button', 'web-rank-open', '🏆 순위표');
    open.type = 'button';
    box.prepend(open);
    const layer = el('div', 'screen overlay web-rank');
    const panel = el('div', 'panel');
    const tabs = el('div', 'web-rank-tabs'), list = el('ol', 'web-rank-list'), msg = el('div', 'panel-text small');
    const close = el('button', 'btn secondary', '닫기');
    panel.append(el('div', 'panel-title', '🏆 순위표'), tabs, list, msg, close);
    layer.append(panel);
    document.getElementById('stage').append(layer);

    // 서버가 보낸 시각을 이 휴대폰 시간대 날짜(월/일)로. 예전 서버는 'YYYY-MM-DD'(세계 표준시 날짜)만 보냄
    const day = (d) => { const t = new Date(d); return d.length > 10 && !isNaN(t) ? `${String(t.getMonth() + 1).padStart(2, '0')}/${String(t.getDate()).padStart(2, '0')}` : d.slice(5).replace('-', '/'); };
    let data = null, cur = 'orchard';
    try { const saved = localStorage.getItem('isak.rankTab'); if (GAMES[saved]) cur = saved; } catch {}
    const render = () => {
      tabs.replaceChildren(...Object.entries(GAMES).map(([g, label]) => {
        const t = el('button', g === cur ? 'on' : '', label); t.type = 'button';
        t.onclick = () => { cur = g; try { localStorage.setItem('isak.rankTab', g); } catch {} render(); };
        return t;
      }));
      const rows = data ? data[cur] || [] : [];
      list.replaceChildren(...rows.map((x, i) => {
        const li = el('li'); li.append(el('span', 'r', `${i + 1}`), el('span', 'n', x.name), el('span', 's', x.score.toLocaleString()), el('span', 'd', day(x.date)));
        return li;
      }));
      msg.textContent = !data ? '불러오는 중…' : rows.length ? '이름마다 최고 점수 하나씩 · 매번 새로 불러와요' : '아직 기록이 없어요. 첫 번째가 되어 보세요!';
    };
    const show = async () => {
      layer.classList.add('on'); data = null; render();
      try {
        const r = await (await fetch(RANK_URL)).json();
        data = r.games || {}; render();
      } catch { msg.textContent = '인터넷에 연결되면 볼 수 있어요'; }
    };
    open.addEventListener('click', show);
    close.addEventListener('click', () => layer.classList.remove('on'));
  }
})();

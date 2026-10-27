// 휴대폰 웹앱용 브리지: Electron의 app/game/preload.js 대신 window.game / window.arcade를 넣어 줌
// tools/build-web.mjs가 각 게임 페이지에서 game.js보다 먼저 불러오게 끼워 넣음
// 기록·이름은 이 휴대폰의 브라우저 저장소(localStorage)에, 코인은 없음(무료)
'use strict';
(() => {
  // 웹앱에 넣는 게임 (타자게임은 휴대폰 자판 때문에 뺌)
  const GAMES = {
    orchard: { title: '과수원을 지켜라', dir: 'game' },
    merge: { title: '이삭이 쑥쑥', dir: 'merge' },
    pang: { title: '이삭이 수확팡', dir: 'pang' },
    runner: { title: '이삭RUN', dir: 'runner' },
  };
  const dir = location.pathname.split('/').slice(-2)[0];   // .../merge/index.html → merge
  const kind = Object.keys(GAMES).find((k) => GAMES[k].dir === dir) || null;   // null이면 고르는 화면

  const KEY = 'isak.';
  const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(KEY + k)); return v == null ? d : v; } catch { return d; } };
  const save = (k, v) => { try { localStorage.setItem(KEY + k, JSON.stringify(v)); } catch {} };
  const rec = (k) => load('game.' + k, { best: 0, history: [] });
  const FREE = { coins: 99, cap: 99, daily: 0, free: true };

  window.game = {
    kind,
    getWords: async () => [],
    getCoins: async () => FREE,
    spendCoin: async () => ({ ok: true, ...FREE }),
    getBest: async () => rec(kind).best,
    saveBest(best) { const r = rec(kind); r.best = Math.max(r.best, best); save('game.' + kind, r); },
    saveScore(one) {   // 최근 기록 20개 + 방금 판은 순위표에 올릴 수 있게 (web-rank.js)
      const r = rec(kind); r.history = [one, ...r.history].slice(0, 20); save('game.' + kind, r);
      window.dispatchEvent(new CustomEvent('isak-score', { detail: one }));
    },
    getHistory: async () => rec(kind).history,
    // 점수 카드: 휴대폰 공유 시트(카톡 등)로, 안 되면 이미지 내려받기. 결과는 window.lastShare에 (mobile.js가 버튼 문구에 씀)
    async shareCard(dataUrl) {
      const d = new Date(), p = (n) => String(n).padStart(2, '0');
      const name = `이삭이게임_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}.png`;
      // 버튼을 누른 그 순간에 share를 불러야 해서(아이폰) 그림 변환은 기다리지 않고 바로
      const bin = atob(dataUrl.split(',')[1]), bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const file = new File([bytes], name, { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file] }); window.lastShare = 'shared'; }
        catch (e) { window.lastShare = e.name === 'AbortError' ? 'cancel' : 'fail'; }
        if (window.lastShare !== 'fail') return { copied: false, saved: false };
      }
      const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      window.lastShare = 'saved';
      return { copied: false, saved: true };
    },
    getName: async () => load('name', ''),
    setName(name) { save('name', String(name || '').trim().slice(0, 10)); },
    result() {},
    close() { if (kind) location.href = '../arcade/index.html'; },   // 게임 × → 고르는 화면
    onAlarm() {},
  };
  window.arcade = {
    list: async () => Object.entries(GAMES).map(([k, g]) => ({ kind: k, title: g.title, best: rec(k).best })),
    open(k) { if (GAMES[k]) location.href = `../${GAMES[k].dir}/index.html`; },
  };
})();

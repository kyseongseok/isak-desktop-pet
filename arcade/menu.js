// 게임 고르는 화면: 다섯 게임 버튼 + 최고 기록
'use strict';

// 아이콘: 각 게임 속 그림
const INFO = {
  orchard: { img: '../game/img/apple.png', ds: '누른 쪽으로 가서 과일 받고, 새똥은 피하기' },
  typing: { img: '../game/img/bird_up.png', ds: '새가 물고 온 단어를 치고 Enter' },
  merge: { img: '../game/img/item_golden_ear.png', ds: '같은 작물끼리 합쳐 황금 이삭까지' },
  pang: { img: '../pang/img/item_tractor.png', ds: '같은 작물 3개를 맞춰 60초 콤보' },
  runner: { img: '../game/img/isak_runA.png', flip: true, ds: '눌러서 점프, 사계절 논두렁 달리기' },   // 달리는 이삭이, 게임 속처럼 오른쪽으로
};

(function fitStage() {
  const st = document.getElementById('stage');
  const apply = () => { const s = Math.min(innerWidth / 480, innerHeight / 800); st.style.transform = `translate(${Math.round((innerWidth - 480 * s) / 2)}px, ${Math.round((innerHeight - 800 * s) / 2)}px) scale(${s})`; };
  apply(); addEventListener('resize', apply);
})();

let sel = 0, games = [];
const buttons = () => [...document.querySelectorAll('.game')];
function mark() { buttons().forEach((b, i) => b.classList.toggle('sel', i === sel)); }
document.getElementById('x').onclick = () => window.game.close();
(async () => {
  // 펫 앱에선 코인을 보여 주고, 게임만 모은 앱(무료)에선 숨김
  const c = await window.game.getCoins();
  if (!c.free) document.getElementById('coins').innerHTML = `<span>🪙 코인 ${c.coins}/${c.cap} · 1판 = 1코인</span>`;
  games = await window.arcade.list();
  document.getElementById('list').innerHTML = games.map((g, i) =>
    `<button class="game" data-i="${i}"><span class="ic"><img src="${INFO[g.kind].img}" alt=""${INFO[g.kind].flip ? ' class="flip"' : ''}></span>` +
    `<span><div class="nm">${g.title}</div><div class="ds">${INFO[g.kind].ds}</div></span>` +
    `<span class="bs">${g.best ? 'BEST<br>' + g.best.toLocaleString() : ''}</span></button>`).join('');
  buttons().forEach((b) => {
    b.addEventListener('click', () => window.arcade.open(games[+b.dataset.i].kind));
    b.addEventListener('mouseenter', () => { sel = +b.dataset.i; mark(); });
  });
  mark();
})();
addEventListener('keydown', (e) => {
  if (e.code === 'ArrowDown') { sel = (sel + 1) % games.length; mark(); }
  if (e.code === 'ArrowUp') { sel = (sel + games.length - 1) % games.length; mark(); }
  if ((e.code === 'Enter' || e.code === 'Space') && games[sel]) { e.preventDefault(); window.arcade.open(games[sel].kind); }
  if (e.code === 'Escape') window.game.close();
});

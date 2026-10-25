// 게임 고르는 화면: 다섯 게임 버튼 + 최고 기록
'use strict';

const INFO = {
  orchard: { ic: '🍎', ds: '← → 로 과일 받고, 새똥은 피하기' },
  typing: { ic: '⌨️', ds: '새가 물고 온 단어를 치고 Enter' },
  merge: { ic: '🍉', ds: '같은 작물끼리 합쳐 황금 이삭까지' },
  pang: { ic: '🧺', ds: '같은 작물 3개를 맞춰 60초 콤보' },
  runner: { ic: '🏃', ds: 'Space로 점프, 사계절 논두렁 달리기' },
};

(function fitStage() {
  const st = document.getElementById('stage');
  const apply = () => { const s = Math.min(innerWidth / 480, innerHeight / 800); st.style.transform = `translate(${Math.round((innerWidth - 480 * s) / 2)}px, ${Math.round((innerHeight - 800 * s) / 2)}px) scale(${s})`; };
  apply(); addEventListener('resize', apply);
})();

let sel = 0, games = [];
const buttons = () => [...document.querySelectorAll('.game')];
function mark() { buttons().forEach((b, i) => b.classList.toggle('sel', i === sel)); }
(async () => {
  games = await window.arcade.list();
  document.getElementById('list').innerHTML = games.map((g, i) =>
    `<button class="game" data-i="${i}"><span class="ic">${INFO[g.kind].ic}</span>` +
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
});

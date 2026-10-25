// 다섯 게임 공용: 점수 카드(결과 화면 이름 칸 + 카드 그림), 코인 문구
// 각 게임의 game.js보다 먼저 불러옴. 이름은 앱 설정에 저장돼서 다른 게임에서도 그대로 채워짐
'use strict';

// 코인 문구: 게임만 모은 앱(arcade)은 코인 없이 무료 (getCoins가 free: true)
const coinText = (c) => c.free ? '🎮 무료로 마음껏 플레이' : `🪙 코인 ${c.coins}/${c.cap} · 1판 = 1코인`;
const retryText = (c) => c.free ? '다시 하기' : `다시 하기 (🪙 ${c.coins}/${c.cap})`;

// 오른쪽 이삭이: 펫 포즈 중 하나를 무작위로 (app/renderer/img)
const CARD_POSES = ['best', 'cheer', 'hello', 'fly', 'produce', 'farm', 'research', 'curious', 'idle', 'surprise'];
const cardPoses = CARD_POSES.map(n => { const i = new Image(); i.src = `../renderer/img/${n}.png`; return i; });

const cardName = (() => {
  const NAME_KEY = 'card.playerName';   // 브라우저 미리보기(브리지 없음)일 때만 씀
  let name = '';
  const css = document.createElement('style');
  css.textContent = `
    .name-row { display: flex; align-items: center; gap: 8px; margin-top: 10px; font-size: 13px; text-align: left; }
    .name-row input { flex: 1; min-width: 0; padding: 7px 8px; border: 3px solid #2b3a2e; background: #fff; font-family: 'Galmuri11', sans-serif; font-size: 15px; color: #2b3a2e; }
    .name-row input:focus { outline: none; border-color: #f0a030; }`;
  document.head.appendChild(css);
  const row = document.createElement('label');
  row.className = 'name-row';
  row.innerHTML = '<span>카드에 넣을 이름</span><input id="playerName" maxlength="10" placeholder="(비워 두면 이름 없이)" autocomplete="off">';
  const share = document.getElementById('shareBtn');
  share.parentNode.insertBefore(row, share);
  const input = row.querySelector('input');
  // 입력 중엔 게임 단축키(Space 다시 하기, M 소리 등)가 먹지 않게
  input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' || e.key === 'Escape') input.blur(); });
  input.addEventListener('keyup', (e) => e.stopPropagation());
  input.addEventListener('input', () => {
    name = input.value.trim().slice(0, 10);
    if (window.game && window.game.setName) window.game.setName(name);
    else try { localStorage.setItem(NAME_KEY, name); } catch {}
    share.textContent = '📸 점수 카드 복사·저장';
  });
  (async () => {
    try { name = window.game && window.game.getName ? await window.game.getName() : (localStorage.getItem(NAME_KEY) || ''); } catch {}
    input.value = name;
  })();
  return () => name;
})();

// title·score·line(한 줄 기록)·best, bg 배경 그림(bgY: 위아래 어디를 보여 줄지 0~1)
function scoreCard({ title, score, line, best, bg, bgY = 0.55 }) {
  const cw = 640, ch = 360, c = document.createElement('canvas'); c.width = cw * 2; c.height = ch * 2;
  const g = c.getContext('2d'); g.scale(2, 2);
  if (bg && bg.complete && bg.naturalWidth) { const s = cw / bg.naturalWidth; g.drawImage(bg, 0, -(bg.naturalHeight * s - ch) * bgY, cw, bg.naturalHeight * s); }
  g.fillStyle = 'rgba(43,58,46,.72)'; g.fillRect(0, 0, cw, ch);
  g.strokeStyle = '#fffbe6'; g.lineWidth = 6; g.strokeRect(14, 14, cw - 28, ch - 28);
  const t = (str, x, y, size, color = '#fffbe6', font = 'Galmuri14') => { g.font = `${size}px ${font}`; g.textAlign = 'left'; g.textBaseline = 'top'; g.lineWidth = 5; g.strokeStyle = '#2b3a2e'; g.lineJoin = 'round'; g.strokeText(str, x, y); g.fillStyle = color; g.fillText(str, x, y); };
  const poses = cardPoses.filter(i => i.complete && i.naturalWidth);
  if (poses.length) g.drawImage(poses[Math.floor(Math.random() * poses.length)], cw - 236, 104, 220, 220);
  t(title, 36, 32, 34);
  const name = cardName();
  if (name) t(`${name}의 기록`, 36, 76, 18, '#ffd93c', 'Galmuri11');
  t('SCORE', 36, 104, 20, '#cfe9df');
  t(score.toLocaleString(), 36, 134, 58, '#ffd93c');   // SCORE 글자와 겹치지 않게 간격
  t(line, 36, 210, 17, '#fff', 'Galmuri11');
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  t(`${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`, 36, 238, 16, '#cfe9df', 'Galmuri11');
  t(score >= best ? '🏆 개인 최고 기록' : `BEST ${best.toLocaleString()}`, 36, 268, 16, '#ffd93c', 'Galmuri11');
  t('이삭이 데스크톱 펫 · 농촌진흥청', 36, ch - 44, 13, '#cfe9df', 'Galmuri11');
  return c.toDataURL('image/png');
}

// 휴대폰 웹앱 공통: tools/build-web.mjs가 각 페이지에서 game.js보다 먼저 불러오게 끼워 넣음
// 게임 규칙은 건드리지 않고, 키보드로만 되던 것을 터치로도 되게 이어 줌
'use strict';
(() => {
  // 첫 화면: 아무 데나 누르면 Space를 누른 것처럼 (게임 방법 등 버튼은 그대로)
  const intro = document.getElementById('intro');
  const press = document.getElementById('pressStart');
  if (intro && press) {
    intro.addEventListener('click', (e) => {
      if (e.target.closest('button, input, a')) return;
      dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ' }));
      dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', key: ' ' }));
    });
    // 게임이 'PRESS SPACE'를 적을 때마다 휴대폰 문구로
    const fix = () => { if (press.textContent === 'PRESS SPACE') press.textContent = 'TAP TO START'; };
    new MutationObserver(fix).observe(press, { childList: true, characterData: true, subtree: true });
    fix();
  }
  // 오프라인 실행: 게임 파일을 휴대폰에 받아 두는 서비스 워커 (https 또는 localhost에서만 동작)
  // 새 버전을 다 받아서 갈아 끼우면(controllerchange) 고르는 화면은 바로 한 번 새로 고침.
  // 게임 중엔 끊지 않음 → 게임을 닫고 고르는 화면으로 갈 때 새 파일로 열림
  if ('serviceWorker' in navigator) {
    const hadOld = !!navigator.serviceWorker.controller;   // 처음 설치할 땐 새로 고칠 필요 없음
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadOld || window.game.kind) return;
      try {   // 혹시 모를 연속 새로 고침 막기 (10초 안에 두 번은 안 함)
        if (Date.now() - (+sessionStorage.getItem('isak.reloadedAt') || 0) < 10000) return;
        sessionStorage.setItem('isak.reloadedAt', String(Date.now()));
      } catch {}
      location.reload();
    });
    navigator.serviceWorker.register('../sw.js').catch(() => {});
  }

  // 점수 카드 버튼: 게임이 적는 '복사·저장' 문구를 휴대폰에 맞게 (공유 결과는 web-bridge.js의 lastShare)
  const shareBtn = document.getElementById('shareBtn');
  if (shareBtn) {
    const READY = '📸 점수 카드 공유·저장';
    const DONE = { shared: '✅ 공유했어요', saved: '✅ 사진으로 저장했어요', cancel: READY };
    const fix = () => {
      const t = shareBtn.textContent;
      if (t.includes('복사·저장')) shareBtn.textContent = READY;
      else if (t.startsWith('✅') && DONE[window.lastShare] && t !== DONE[window.lastShare]) shareBtn.textContent = DONE[window.lastShare];
    };
    new MutationObserver(fix).observe(shareBtn, { childList: true, characterData: true, subtree: true });
    fix();
  }

  // 길게 누를 때 뜨는 메뉴, 아이폰 두 손가락 확대 막기
  addEventListener('contextmenu', (e) => e.preventDefault());
  addEventListener('gesturestart', (e) => e.preventDefault());
  // 아이폰: 빠르게 두 번 누르면(2단 점프 등) 화면을 확대해 버림. 확대 금지 설정도 무시해서 직접 막음
  // (점프·조준은 pointer 이벤트라 그대로 되고, 막히는 건 두 번째 누름의 확대·click뿐)
  let lastEnd = 0;
  addEventListener('touchend', (e) => {
    const now = Date.now();
    if (now - lastEnd < 350 && !e.target.closest('input')) e.preventDefault();
    lastEnd = now;
  }, { passive: false });
  addEventListener('touchstart', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });   // 두 손가락 확대

  // ---------- 게임별 터치 조작 ----------
  // 게임 상태(S)와 함수는 각 game.js의 것을 그대로 씀 (이 파일이 먼저 불려도 누를 때는 이미 있음)
  const kind = window.game && window.game.kind;
  const canvas = document.getElementById('c');
  const playing = () => typeof S !== 'undefined' && S.screen === 'play' && !S.paused;
  const onGame = (e) => !e.target.closest('button, input, a, .screen');   // 버튼·겹친 화면 위는 빼고
  const stageX = (e) => { const r = canvas.getBoundingClientRect(); return (e.clientX - r.left) / r.width * canvas.offsetWidth; };   // 무대 좌표(0~480): 화면 배율·고해상도와 무관

  // ---------- 자동 일시정지 ----------
  // 게임은 창이 포커스를 잃을 때(blur)만 멈추는데, 아이폰은 다른 앱으로 가거나 전화가 와도 blur를 거의 안 보냄.
  // 그래서 화면이 가려질 때, 아이폰이 소리를 끊을 때(통화 띠 등) 게임 자신의 blur 처리를 대신 불러 줌
  if (kind) {
    const stop = () => { if (playing()) dispatchEvent(new Event('blur')); };
    document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
    addEventListener('pagehide', stop);
    // 효과음(AudioContext): 아이폰은 통화 중 'interrupted'로 바꾸고, 게임은 'suspended'만 깨우므로 누를 때 다시 깨움
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctxs = [];
    if (AC) {
      window.AudioContext = class extends AC {
        constructor(...a) {
          super(...a); ctxs.push(this);
          this.addEventListener('statechange', () => { if (this.state === 'interrupted') stop(); });
        }
      };
    }
    const wake = () => { if (document.hidden) return; for (const c of ctxs) if (c.state !== 'running' && c.state !== 'closed') c.resume().catch(() => {}); };
    addEventListener('pointerdown', wake, true);
    // 배경음악(Audio): 게임이 직접 멈춘 게 아닌데 멈췄으면 아이폰이 끊은 것 (계속하기를 누르면 게임이 다시 틂)
    const NativeAudio = window.Audio;
    window.Audio = function (...a) {
      const el = new NativeAudio(...a), pause = el.pause;
      let mine = false, sounding = false;   // sounding: 실제로 소리가 났었는지 (자동 재생이 막혀 바로 멈춘 건 끊김이 아님)
      el.pause = function () { if (!this.paused) mine = true; return pause.call(this); };   // 이미 멈춘 걸 또 멈추면 pause 이벤트가 안 오니 표시도 안 함
      el.addEventListener('playing', () => { sounding = true; });
      el.addEventListener('pause', () => { if (!mine && sounding) stop(); mine = sounding = false; });
      return el;
    };
    window.Audio.prototype = NativeAudio.prototype;
  }

  // 과수원을 지켜라: 누르고 있는 곳까지 이삭이가 걸어감 (← → 키를 대신 눌러 줌, 속도는 키보드와 같음)
  if (kind === 'orchard' && canvas) {
    let target = null;
    const set = (e) => { if (onGame(e) && playing()) target = stageX(e); };
    addEventListener('pointerdown', set);
    addEventListener('pointermove', (e) => { if (target != null) target = stageX(e); });
    const end = () => { if (target == null) return; target = null; S.keys.ArrowLeft = S.keys.ArrowRight = false; };
    addEventListener('pointerup', end); addEventListener('pointercancel', end);
    (function steer() {
      if (target != null && playing()) {
        const dx = target - S.player.x;
        S.keys.ArrowLeft = dx < -6; S.keys.ArrowRight = dx > 6;
      }
      requestAnimationFrame(steer);
    })();
  }

  // ---------- 진동 (안드로이드만, 아이폰 사파리는 navigator.vibrate가 없음) ----------
  // 게임의 효과음(sfx)이 날 때 같이 떨림. 켜기/끄기는 게임 고르는 화면에서, 저장은 이 휴대폰에
  const VIBE_KEY = 'isak.vibrate';
  const vibeOn = () => { try { return localStorage.getItem(VIBE_KEY) !== 'false'; } catch { return true; } };
  // 2026-10-26에 정한 느낌: 트랙터 짧게 두 번, 비료 묵직하게, 황금 이삭 톡톡톡, 부딪힘 강하게, 우산 약하게, 게임 오버 길게
  const OVER = 300, TAPS = [20, 40, 20, 40, 20];
  const VIBES = {
    orchard: { hit: 80, shield: 25 },
    merge: { golden: TAPS, crack: 20, over: OVER },
    pang: { tractor: [25, 40, 25], bomb: 70, drone: 30, gold: TAPS, timeup: OVER },
    runner: { hit: 80, block: 25, smash: 40, over: OVER },
  }[kind];
  if (VIBES && navigator.vibrate) {
    addEventListener('DOMContentLoaded', () => {   // game.js까지 다 불린 뒤
      if (typeof sfx === 'undefined') return;
      for (const [name, pattern] of Object.entries(VIBES)) {
        const play = sfx[name];
        if (typeof play !== 'function') continue;
        sfx[name] = (...args) => { if (vibeOn()) navigator.vibrate(pattern); return play.apply(sfx, args); };
      }
    });
  }

  // ---------- 화면 비율 ----------
  // 게임: 480×800 무대는 그대로 두고(규칙·난이도가 같게) 남는 양옆·위아래를 그 게임 배경을 흐리게 깔아 채움
  // (경로는 이 값을 쓰는 web-mobile.css 기준 = dist-web 맨 위)
  const BACKDROP = { orchard: 'game/img/bg.png', merge: 'game/img/bg.png', pang: 'game/img/bg.png' }[kind] || 'runner/img/bg_spring.jpg';
  document.documentElement.style.setProperty('--web-bg', `url('${BACKDROP}')`);

  // 게임 고르는 화면: 무대를 화면 비율대로 늘려 빈틈 없이 (글자 크기는 그대로, 넓으면 두 줄로)
  const menu = document.getElementById('menu');
  if (menu && !kind) {
    document.documentElement.classList.add('web-arcade');
    const fit = () => {
      const s = Math.min(innerWidth / 480, innerHeight / 800), w = innerWidth / s, h = innerHeight / s;
      const st = document.documentElement.style;
      st.setProperty('--fit', `scale(${s})`); st.setProperty('--w', w + 'px'); st.setProperty('--h', h + 'px');
      document.documentElement.classList.toggle('web-wide', w >= 760);
    };
    fit(); addEventListener('resize', fit);
  }

  // 게임 고르는 화면: 진동 켜기/끄기 (숨긴 키보드 안내 자리에)
  if (menu && !kind) {
    const box = document.createElement('div');
    box.className = 'web-vibe';
    // 배경음악은 CC-BY 3.0이라 저작자 표시가 필요함 (app/game/music/CREDITS.txt)
    box.innerHTML = '<button type="button"></button><small>아이폰은 기기 특성상 진동이 지원되지 않을 수 있어요</small>' +
      '<a class="credit" href="https://opengameart.org/content/cpu-showdown" target="_blank" rel="noopener">♪ 배경음악 \'CPU Showdown\' by MegaPixel Music · CC-BY 3.0</a>';
    const btn = box.querySelector('button');
    const render = () => { btn.textContent = vibeOn() ? '📳 진동 켜짐' : '📴 진동 꺼짐'; };
    btn.addEventListener('click', () => {
      try { localStorage.setItem(VIBE_KEY, String(!vibeOn())); } catch {}
      render();
      if (vibeOn() && navigator.vibrate) navigator.vibrate(40);
    });
    render();
    menu.appendChild(box);
  }

  // 이삭이 쑥쑥: 손가락을 대고 끌어서 조준, 떼면 떨어뜨림
  if (kind === 'merge' && canvas) {
    let aiming = false;
    const aim = (e) => { S.aimX = Math.max(BOX.l, Math.min(BOX.r, stageX(e))); };
    addEventListener('pointerdown', (e) => { if (onGame(e) && playing()) { aiming = true; aim(e); } });
    addEventListener('pointermove', (e) => { if (aiming && playing()) aim(e); });
    addEventListener('pointerup', (e) => { if (!aiming) return; aiming = false; if (playing()) { aim(e); drop(); } });
    addEventListener('pointercancel', () => { aiming = false; });
  }
})();

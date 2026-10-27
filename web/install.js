// 휴대폰 웹앱 '홈 화면에 추가' 돕기 (tools/build-web.mjs가 모든 페이지에 끼워 넣음)
// - 안드로이드 크롬·삼성 인터넷: 버튼 → 휴대폰의 진짜 설치 창 (beforeinstallprompt)
// - 아이폰: 웹에서 설치 창을 띄울 방법이 없어서 공유 → '홈 화면에 추가' 순서를 안내
// - 카톡 안 브라우저: 홈 화면에 추가가 안 되므로 바깥 브라우저(크롬·사파리)로 바로 넘김
// - 이미 홈 화면 앱으로 열었으면 아무것도 안 보임
'use strict';
(() => {
  const ua = navigator.userAgent;
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if (standalone) return;
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const android = /Android/.test(ua);
  const kakao = /KAKAOTALK/i.test(ua);
  const inApp = kakao || /NAVER\(inapp|Instagram|FBAN|FBAV|Line\/|DaumApps|everytimeApp|BAND\//i.test(ua);

  // 카톡으로 받은 링크: 카톡이 열어 주는 바깥 브라우저로 (한 번만)
  if (kakao) {
    try {
      if (!sessionStorage.getItem('isak.openedOut')) {
        sessionStorage.setItem('isak.openedOut', '1');
        location.href = 'kakaotalk://web/openExternal?url=' + encodeURIComponent(location.href);
      }
    } catch {}
  }

  // 안드로이드: 휴대폰이 '설치할 수 있어요' 하고 알려 주면 받아 뒀다가 버튼을 누를 때 띄움
  let deferred = null;
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; show(); });
  addEventListener('appinstalled', () => { deferred = null; const b = document.querySelector('.web-install'); if (b) b.remove(); });

  // 버튼과 안내는 게임 고르는 화면에만
  const menu = document.getElementById('menu');
  if (!menu || (window.game && window.game.kind)) return;
  const LATER = 'isak.installLater';
  const later = () => { try { return Date.now() - (+localStorage.getItem(LATER) || 0) < 3 * 86400000; } catch { return false; } };

  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  let bar = null;
  function show() {
    if (bar || later()) return;
    if (!deferred && !ios && !android && !inApp) return;   // 컴퓨터 브라우저 등은 안 보임
    // 화면 맨 위 띠 (제목 위 빈자리, 게임 목록과 겹치지 않게)
    bar = el('div', 'web-install');
    const btn = el('button', 'go', inApp ? '🌐 크롬·사파리로 열기 <small>(여기선 설치가 안 돼요)</small>' : '📲 홈 화면에 추가하기 <small>앱처럼 바로 열기</small>');
    const no = el('button', 'no', '✕');
    no.setAttribute('aria-label', '다음에');
    btn.type = no.type = 'button';
    bar.append(btn, no);
    menu.append(bar);
    btn.addEventListener('click', async () => {
      if (deferred) {
        deferred.prompt();
        const r = await deferred.userChoice;
        deferred = null;
        if (r.outcome === 'accepted') bar.remove();
        return;
      }
      guide();
    });
    no.addEventListener('click', () => { try { localStorage.setItem(LATER, String(Date.now())); } catch {} bar.remove(); });
  }

  // 순서 안내 (아이폰, 설치 창을 못 띄우는 안드로이드 브라우저, 카톡 외 앱 안 브라우저)
  function guide() {
    const steps = inApp
      ? ['화면 오른쪽 위(또는 아래)의 <b>⋯</b> · <b>⋮</b> 메뉴를 눌러요',
         '<b>다른 브라우저로 열기</b>(크롬·사파리)를 골라요', '열린 화면에서 다시 <b>📲 홈 화면에 추가하기</b>를 눌러요']
      : ios
        ? ['사파리 아래쪽의 <b>공유 버튼</b> <span class="ico">⬆️</span>을 눌러요<br><small>(안 보이면 <b>⋯</b>를 먼저 누르고 <b>공유</b>)</small>',
           '목록을 올려서 <b>홈 화면에 추가</b> <span class="ico">➕</span>를 눌러요', '오른쪽 위 <b>추가</b>를 누르면 끝!']
        : ['오른쪽 위 <b>⋮</b> 메뉴를 눌러요', '<b>홈 화면에 추가</b> 또는 <b>앱 설치</b>를 눌러요', '<b>설치</b>(추가)를 누르면 끝!'];
    const layer = el('div', 'screen overlay web-guide on');
    const panel = el('div', 'panel');
    panel.append(el('div', 'panel-title', '📲 홈 화면에 추가'),
      el('ol', 'steps', steps.map((s) => `<li>${s}</li>`).join('')),
      el('div', 'panel-text small', '홈 화면의 이삭이 아이콘으로 열면 주소창 없이 전체 화면이고, 인터넷이 없어도 돼요'));
    const ok = el('button', 'btn', '알겠어요');
    ok.addEventListener('click', () => layer.remove());
    panel.append(ok);
    layer.append(panel);
    if (ios && !inApp) layer.append(el('div', 'web-guide-arrow', '⬇️'));   // 사파리 공유 버튼은 보통 아래쪽
    document.getElementById('stage').append(layer);
  }

  show();
})();

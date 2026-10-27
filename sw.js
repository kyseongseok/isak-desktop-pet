// 휴대폰 웹앱 서비스 워커: 한 번 열면 게임 파일을 전부 휴대폰에 받아 두고, 그 뒤엔 인터넷 없이도 실행
// tools/build-web.mjs가 __VERSION__(내용 해시)과 __FILES__(전체 파일 목록)를 채워 dist-web/sw.js로 씀
'use strict';
const VERSION = "ea361fdb74";
const FILES = ["./","arcade/index.html","arcade/menu.js","game/card.js","game/font/Galmuri11-Bold.woff2","game/font/Galmuri11.woff2","game/font/Galmuri14.woff2","game/game.js","game/img/apple.png","game/img/bg.png","game/img/bird_down.png","game/img/bird_up.png","game/img/branch.png","game/img/bug.png","game/img/hail.png","game/img/intro.png","game/img/isak_basket.png","game/img/isak_happy.png","game/img/isak_hit.png","game/img/isak_over.png","game/img/isak_runA.png","game/img/isak_runB.png","game/img/isak_shout.png","game/img/isak_umbrella.png","game/img/isak_win.png","game/img/item_golden_ear.png","game/img/item_lightning.png","game/img/item_magnet.png","game/img/item_sprout.png","game/img/item_turtle.png","game/img/item_umbrella.png","game/img/pear.png","game/img/persimmon.png","game/img/poop.png","game/index.html","game/music/CREDITS.txt","game/music/README.txt","game/music/bgm.m4a","game/style.css","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon-maskable-512.png","index.html","manifest.webmanifest","merge/game.js","merge/index.html","merge/style.css","pang/game.js","pang/img/item_drone.png","pang/img/item_fertilizer.png","pang/img/item_tractor.png","pang/index.html","pang/style.css","renderer/img/best.png","renderer/img/cheer.png","renderer/img/curious.png","renderer/img/farm.png","renderer/img/fly.png","renderer/img/hello.png","renderer/img/idle.png","renderer/img/produce.png","renderer/img/research.png","renderer/img/surprise.png","runner/game.js","runner/img/bale.png","runner/img/bg_autumn.jpg","runner/img/bg_spring.jpg","runner/img/bg_summer.jpg","runner/img/bg_winter.jpg","runner/img/boar_runA.png","runner/img/boar_runB.png","runner/img/fence.png","runner/img/frog.png","runner/img/jar.png","runner/img/puddle.png","runner/img/rock.png","runner/img/scarecrow.png","runner/img/snowman.png","runner/index.html","runner/style.css","web-bridge.js","web-mobile.css","web-mobile.js"];
const CACHE = 'isak-' + VERSION;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {   // 예전 버전 지우기
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('isak-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// 받아 둔 게 있으면 그걸로, 없으면 인터넷에서 (없는 그림 파일을 찾는 요청 등)
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith((async () => {
    const hit = await caches.match(e.request, { cacheName: CACHE, ignoreSearch: true });
    if (!hit) return fetch(e.request);
    const range = e.request.headers.get('range');
    return range ? partial(hit, range) : hit;
  })());
});

// 아이폰 사파리는 배경음악을 '몇 바이트부터 몇 바이트까지'(Range)로 나눠 달라고 함 → 받아 둔 파일에서 잘라 줌
async function partial(res, range) {
  const buf = await res.arrayBuffer();
  const m = /bytes=(\d*)-(\d*)/.exec(range);
  let start = m && m[1] ? +m[1] : 0, end = m && m[2] ? +m[2] : buf.byteLength - 1;
  if (m && !m[1] && m[2]) { start = buf.byteLength - +m[2]; end = buf.byteLength - 1; }   // bytes=-500 (끝에서 500)
  end = Math.min(end, buf.byteLength - 1);
  return new Response(buf.slice(start, end + 1), {
    status: 206,
    headers: {
      'Content-Type': res.headers.get('Content-Type') || 'application/octet-stream',
      'Content-Range': `bytes ${start}-${end}/${buf.byteLength}`,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes',
    },
  });
}

// 휴대폰 웹앱 서비스 워커: 한 번 열면 게임 파일을 전부 휴대폰에 받아 두고, 그 뒤엔 인터넷 없이도 실행
// tools/build-web.mjs가 __VERSION__(내용 해시)과 __FILES__(전체 파일 목록)를 채워 dist-web/sw.js로 씀
'use strict';
const VERSION = '__VERSION__';
const FILES = '__FILES__';
const CACHE = 'isak-' + VERSION;

// 받을 땐 브라우저가 들고 있던 사본(GitHub Pages는 10분 보관)을 건너뛰고 서버에서 새로 받음 → 옛 파일이 섞이지 않게
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE)
    .then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
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

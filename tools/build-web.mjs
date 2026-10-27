// 휴대폰 웹앱 만들기: app/의 게임 폴더를 dist-web/에 복사하면서 웹용 파일을 끼워 넣음
// app/은 그대로 두므로 펫 앱·맥용 IsakGames에는 영향 없음
// 사용: node tools/build-web.mjs  →  dist-web/ (index.html이 게임 고르는 화면으로 넘겨 줌)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'app'), WEB = path.join(ROOT, 'web'), OUT = path.join(ROOT, 'dist-web');

// 복사할 폴더와 뺄 것 (게임끼리 ../game/img 처럼 서로 참조하므로 폴더 구조는 그대로)
const DIRS = ['arcade', 'game', 'merge', 'pang', 'runner'];
const SKIP = new Set(['arcade/main.js', 'game/preload.js', 'game/words']);   // Electron 전용, 타자게임 단어
// 점수 카드의 이삭이 포즈만 (renderer/img 전체는 펫 그림이라 큼)
const poses = fs.readFileSync(path.join(APP, 'game', 'card.js'), 'utf8').match(/CARD_POSES = \[([^\]]*)\]/)[1].match(/[\w-]+/g);

fs.rmSync(OUT, { recursive: true, force: true });
for (const d of DIRS) {
  fs.cpSync(path.join(APP, d), path.join(OUT, d), {
    recursive: true,
    filter: (src) => !SKIP.has(path.relative(APP, src).split(path.sep).join('/')) && !src.endsWith('.DS_Store'),
  });
}
fs.mkdirSync(path.join(OUT, 'renderer', 'img'), { recursive: true });
for (const p of poses) fs.copyFileSync(path.join(APP, 'renderer', 'img', p + '.png'), path.join(OUT, 'renderer', 'img', p + '.png'));
for (const f of ['bridge.js', 'mobile.js', 'mobile.css', 'rank.js', 'install.js']) fs.copyFileSync(path.join(WEB, f), path.join(OUT, 'web-' + f));
fs.cpSync(path.join(WEB, 'icons'), path.join(OUT, 'icons'), { recursive: true });   // tools/make-web-icons.py로 만든 것

// 배경음악(5MB)을 휴대폰용으로 줄이기: HE-AAC 32kbps (맥의 afconvert가 있을 때만, 없으면 원본 그대로)
const BGM = path.join(OUT, 'game', 'music', 'bgm.m4a');
try {
  execFileSync('afconvert', ['-f', 'm4af', '-d', 'aach', '-b', '32000', path.join(APP, 'game', 'music', 'bgm.m4a'), BGM]);
} catch { console.log('afconvert가 없어 배경음악은 원본 크기로 넣음'); }

// 홈 화면 앱 정보: 이름·아이콘·전체 화면·세로
const COLOR = '#9fd9ff';   // 게임 창 배경과 같은 하늘색
fs.writeFileSync(path.join(OUT, 'manifest.webmanifest'), JSON.stringify({
  name: '이삭이 미니게임', short_name: '이삭이게임', lang: 'ko',
  start_url: 'arcade/index.html', scope: './', display: 'standalone', orientation: 'portrait',
  background_color: COLOR, theme_color: COLOR,
  icons: [
    { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
}, null, 2));

// 각 페이지: 휴대폰 화면 크기(viewport) + 홈 화면 앱 정보 + 공통 스타일 + 웹 브리지·터치 보조를 첫 스크립트보다 먼저
// (viewport-fit=cover를 안 쓰면 아이폰이 노치·홈 바 영역을 비워 둠)
const HEAD = [
  '<meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">',
  `<meta name="theme-color" content="${COLOR}">`,
  '<meta name="mobile-web-app-capable" content="yes">',
  '<meta name="apple-mobile-web-app-capable" content="yes">',
  '<meta name="apple-mobile-web-app-title" content="이삭이게임">',
  '<link rel="manifest" href="../manifest.webmanifest">',
  '<link rel="apple-touch-icon" href="../icons/apple-touch-icon.png">',
].join('\n');
for (const d of DIRS) {
  const f = path.join(OUT, d, 'index.html');
  let html = fs.readFileSync(f, 'utf8');
  html = html.replace('<meta charset="utf-8">', `<meta charset="utf-8">\n${HEAD}`);
  html = html.replace('</head>', '<link rel="stylesheet" href="../web-mobile.css">\n</head>');
  html = html.replace('<script ', '<script src="../web-bridge.js"></script>\n<script src="../web-mobile.js"></script>\n<script src="../web-rank.js"></script>\n<script src="../web-install.js"></script>\n<script ');
  // 공개 순위표(구글 앱스 스크립트)에 요청할 수 있게 (펫 앱 쪽 app/은 그대로 'self'만)
  html = html.replace("default-src 'self';", "default-src 'self'; connect-src 'self' https://script.google.com https://script.googleusercontent.com;");
  if (!html.includes('web-bridge.js') || !html.includes('web-mobile.css') || !html.includes('name="viewport"') || !html.includes('connect-src')) throw new Error(`${d}/index.html에 끼워 넣지 못함`);
  fs.writeFileSync(f, html);
}
// 게임 안 키보드·마우스 안내를 휴대폰 말로 (원문이 바뀌어 못 찾으면 빌드를 멈춰 알려 줌)
const WORDING = {
  'arcade/menu.js': [['← → 로 과일 받고', '누른 쪽으로 가서 과일 받고'], ['Space로 점프', '눌러서 점프']],
  'game/index.html': [['← → 이동', '누른 쪽으로 이동']],
  'merge/index.html': [
    ['← → 로 옮기고 Space로 떨어뜨리기', '끌어서 옮기고 손을 떼면 떨어뜨리기'],
    ['<b>← →</b>로 옮기고 <b>Space</b>로 떨어뜨려요. (↓ 키도 돼요)', '손가락으로 <b>끌어서</b> 옮기고 <b>손을 떼면</b> 떨어뜨려요.'],
  ],
  'pang/index.html': [['<b>마우스로 끌어서</b>', '<b>손가락으로 끌어서</b>'], ['<b>클릭만 해도</b>', '<b>누르기만 해도</b>']],
  'pang/game.js': [['클릭해도 터짐', '눌러도 터짐']],
  'runner/index.html': [
    ['Space(또는 클릭)로 점프', '화면을 눌러 점프'],
    ['<b>Space</b>(또는 ↑, 마우스 클릭)로 점프!', '<b>화면을 누르면</b> 점프!'],
  ],
};
for (const [file, pairs] of Object.entries(WORDING)) {
  const f = path.join(OUT, file);
  let s = fs.readFileSync(f, 'utf8');
  for (const [from, to] of pairs) {
    if (!s.includes(from)) throw new Error(`${file}에서 '${from}'을 찾지 못함 (게임 문구가 바뀌었는지 확인)`);
    s = s.replaceAll(from, to);
  }
  fs.writeFileSync(f, s);
}

fs.writeFileSync(path.join(OUT, '.nojekyll'), '');   // GitHub Pages가 파일을 손대지 않고 그대로 내보내게
fs.writeFileSync(path.join(OUT, 'index.html'),
  `<!doctype html>\n<meta charset="utf-8">\n<meta http-equiv="refresh" content="0; url=arcade/index.html">\n<title>이삭이 미니게임</title>\n`);

// 오프라인 실행: 서비스 워커가 처음 열 때 파일을 전부 받아 두게 목록을 넣어 줌
// 내용이 바뀌면 버전(해시)이 바뀌어서 다음에 열 때 새 파일로 갈아 끼움
const files = [];
const walk = (dir) => { for (const n of fs.readdirSync(dir).sort()) { if (n.startsWith('.')) continue; const p = path.join(dir, n); if (fs.statSync(p).isDirectory()) walk(p); else files.push(path.relative(OUT, p).split(path.sep).join('/')); } };
walk(OUT);
const hash = crypto.createHash('sha1');
for (const f of files) hash.update(f).update(fs.readFileSync(path.join(OUT, f)));
const sw = fs.readFileSync(path.join(WEB, 'sw.js'), 'utf8')
  .replace("'__VERSION__'", JSON.stringify(hash.digest('hex').slice(0, 10)))
  .replace("'__FILES__'", JSON.stringify(['./', ...files]));
fs.writeFileSync(path.join(OUT, 'sw.js'), sw);

const size = (p) => fs.statSync(p).isDirectory() ? fs.readdirSync(p).reduce((s, n) => s + size(path.join(p, n)), 0) : fs.statSync(p).size;
console.log(`dist-web/ 완성 (${(size(OUT) / 1048576).toFixed(1)}MB)`);

// 카드뉴스 HTML의 각 .card 를 1080×1080 PNG로 저장
// 사용법: npx electron tools/render-cards.js <html 파일> <출력 폴더>
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const [, , htmlPath, outDir] = process.argv;
if (!htmlPath || !outDir) { console.error('usage: render-cards.js <html> <outDir>'); process.exit(1); }
fs.mkdirSync(outDir, { recursive: true });

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1080, height: 1080, useContentSize: true, webPreferences: { offscreen: false } });
  await win.loadFile(path.resolve(htmlPath));
  const count = await win.webContents.executeJavaScript(`document.querySelectorAll('.card').length`);
  await win.webContents.executeJavaScript(`document.fonts.ready.then(() => true)`);
  for (let i = 1; i <= count; i++) {
    await win.webContents.executeJavaScript(`
      (() => {
        if (!window.__orig) window.__orig = document.body.innerHTML;
        document.body.innerHTML = window.__orig;
        const card = document.getElementById('card${i}');
        const shot = document.createElement('div');
        shot.style.cssText = 'position:fixed;left:0;top:0;width:1080px;height:1080px;overflow:hidden;background:#fff';
        card.style.transform = 'none';
        shot.appendChild(card);
        document.body.innerHTML = '';
        document.body.style.margin = '0';
        document.body.appendChild(shot);
        return true;
      })()
    `);
    await new Promise(r => setTimeout(r, 400));
    const img = await win.webContents.capturePage({ x: 0, y: 0, width: 1080, height: 1080 });
    const file = path.join(outDir, `${String(i).padStart(2, '0')}.png`);
    fs.writeFileSync(file, img.toPNG());
    console.log('saved', file, img.getSize());
  }
  app.quit();
}).catch(e => { console.error(e); app.exit(1); });

// node render_video.js <outdir> <w> <h> <fps> <workers> [startFrame endFrame]
let pw; try { pw = require('playwright'); } catch (e) { pw = require('/opt/node22/lib/node_modules/playwright'); }
const { chromium } = pw;
const fs = require('fs'), path = require('path');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png' };
(async () => {
  const [outDir, w, h, fps, workers, s0, s1] = process.argv.slice(2);
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  async function openPage() {
    const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
    page.on('pageerror', e => console.log('[pageerror]', e.message));
    await page.route('http://local/**', async route => {
      const f = path.join(__dirname, decodeURIComponent(new URL(route.request().url()).pathname));
      if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: 'nf' });
      route.fulfill({ status: 200, body: fs.readFileSync(f), headers: { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' } });
    });
    await page.goto(`http://local/viewer/cinema.html?w=${w}&h=${h}&fps=${fps}`);
    await page.waitForFunction(() => window.api && window.api.ready);
    await page.evaluate(() => window.api.ready);
    return page;
  }
  const first = await openPage();
  const total = await first.evaluate(() => window.api.frames());
  const a = s0 ? parseInt(s0) : 0, b = s1 ? parseInt(s1) : total;
  const n = parseInt(workers);
  const pages = [first];
  for (let i = 1; i < n; i++) pages.push(await openPage());
  // contiguous chunks per worker keep environments cached
  const per = Math.ceil((b - a) / n);
  const t0 = Date.now();
  let done = 0;
  await Promise.all(pages.map(async (page, wi) => {
    for (let f = a + wi * per; f < Math.min(b, a + (wi + 1) * per); f++) {
      const file = path.join(outDir, `f_${String(f).padStart(5, '0')}.png`);
      if (fs.existsSync(file)) { done++; continue; }
      const d = await page.evaluate(i => window.api.frame(i), f);
      fs.writeFileSync(file, Buffer.from(d.split(',')[1], 'base64'));
      done++;
      if (done % 50 === 0) console.log(`${done}/${b - a} frames, ${((Date.now() - t0) / done).toFixed(0)} ms/frame avg`);
    }
  }));
  console.log('done', total, 'frames in', ((Date.now() - t0) / 1000).toFixed(0), 's');
  await browser.close();
})();

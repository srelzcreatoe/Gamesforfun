// Usage: node shoot.js <page> <jobs.json> <outdir> [w] [h]
// Serves the work dir to Chromium via request interception and saves each job's PNG.
let pw; try { pw = require('playwright'); } catch (e) { pw = require('/opt/node22/lib/node_modules/playwright'); }
const { chromium } = pw;
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.ttf': 'font/ttf', '.otf': 'font/otf', '.css': 'text/css' };

(async () => {
  const [page_, jobsFile, outDir, w = '800', h = '1000', extra = ''] = process.argv.slice(2);
  const jobs = JSON.parse(fs.readFileSync(jobsFile, 'utf8'));
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: parseInt(w), height: parseInt(h) }, deviceScaleFactor: 1 });
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.type(), m.text()); });
  page.on('pageerror', e => console.log('[pageerror]', e.message));
  await page.route('http://local/**', async route => {
    const u = new URL(route.request().url());
    const f = path.join(ROOT, decodeURIComponent(u.pathname));
    if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: 'nf' });
    route.fulfill({ status: 200, body: fs.readFileSync(f), headers: { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' } });
  });
  await page.goto(`http://local/${page_}?w=${w}&h=${h}${extra}`);
  await page.waitForFunction(() => window.api && window.api.ready);
  await page.evaluate(() => window.api.ready);
  for (const job of jobs) {
    const t0 = Date.now();
    const data = await page.evaluate(j => window.api.render(j), job);
    fs.writeFileSync(path.join(outDir, job.name + '.png'), Buffer.from(data.split(',')[1], 'base64'));
    console.log(job.name, (Date.now() - t0) + 'ms');
  }
  await browser.close();
})();

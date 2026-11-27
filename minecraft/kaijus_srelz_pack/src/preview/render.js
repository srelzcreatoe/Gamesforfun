// Usage: node render.js <job.json>
// job: { geo, tex, out_prefix, views:[{name,pos,look,fov}], pose, posePos, size, dark }
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png' };

(async () => {
  const job = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') console.error('PAGE:', m.text()); });
  page.on('pageerror', e => console.error('PAGEERR:', e.message));
  await page.route('http://local/**', async route => {
    const rel = decodeURIComponent(new URL(route.request().url()).pathname);
    const fp = path.join(ROOT, rel);
    const real = fs.realpathSync(fp);
    route.fulfill({ status: 200, body: fs.readFileSync(real), contentType: MIME[path.extname(fp)] || 'application/octet-stream' });
  });
  await page.goto('http://local/index.html');
  await page.waitForFunction('window.ready === true');
  const jobs = Array.isArray(job) ? job : [job];
  for (const j of jobs) {
    const geo = JSON.parse(fs.readFileSync(j.geo, 'utf8'));
    const tex = 'data:image/png;base64,' + fs.readFileSync(j.tex).toString('base64');
    const res = await page.evaluate(o => window.renderModel(o), {
      geo, tex, pose: j.pose || {}, posePos: j.posePos || {}, views: j.views, size: j.size || [900, 900],
      dark: !!j.dark, bg: j.bg || '#8fa3b8', ground: j.ground !== false, transparent: !!j.transparent,
    });
    res.images.forEach((d, i) => {
      const f = `${j.out_prefix}_${j.views[i].name}.png`;
      fs.writeFileSync(f, Buffer.from(d.split(',')[1], 'base64'));
      console.log('wrote', f);
    });
    console.log('cubes', res.ncubes);
  }
  await browser.close();
})();

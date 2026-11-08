// usage: node render.js job.json
const fs = require('fs'), path = require('path'), http = require('http');
const { chromium } = require('playwright');
const job = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const root = __dirname;
const mime = { '.js': 'text/javascript', '.html': 'text/html', '.png': 'image/png', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  let u = decodeURIComponent(req.url.split('?')[0]);
  let f = u.startsWith('/abs/') ? u.slice(4) : path.join(root, u);
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type': mime[path.extname(f)] || 'application/octet-stream' }); res.end(d); });
});
server.listen(0, async () => {
  const port = server.address().port;
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'warning' || m.type() === 'error') console.log('[page]', m.text()); });
  await page.goto(`http://127.0.0.1:${port}/index.html`);
  await page.waitForFunction(() => window.__ready && window.loadAll);
  const geo = JSON.parse(fs.readFileSync(job.geo, 'utf8'));
  const anims = (job.animations || []).map(f => JSON.parse(fs.readFileSync(f, 'utf8')));
  const names = await page.evaluate(([g, t, a, w, h, o]) => window.loadAll(g, t, a, w, h, o), [geo, '/abs' + path.resolve(job.texture), anims, job.cellW || 360, job.cellH || 480, job.opts || {}]);
  if (job.listAnims) console.log(names.join('\n'));
  const url = await page.evaluate(([f, c, w, h]) => window.renderSheet(f, c, w, h), [job.frames, job.cols || 4, job.cellW || 360, job.cellH || 480]);
  fs.writeFileSync(job.out, Buffer.from(url.split(',')[1], 'base64'));
  await browser.close(); server.close();
  console.log('wrote', job.out);
});

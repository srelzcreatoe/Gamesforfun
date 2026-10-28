// Usage: import { withRenderer } from './render.mjs'; await withRenderer(async (render) => { await render(scene, 'out.png'); });
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.png': 'image/png', '.tga': 'application/octet-stream' };

/** mounts: { '/prefix': '/abs/dir' } in addition to the render dir at '/'. page: html file in this dir. */
export async function withRenderer(fn, { mounts = {}, page: pageFile = 'page.html' } = {}) {
  const server = http.createServer((req, res) => {
    const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = null;
    for (const [pre, dir] of Object.entries(mounts)) if (u.startsWith(pre + '/')) file = path.join(dir, u.slice(pre.length));
    if (!file && u.startsWith('/node_modules/')) file = path.join(HERE, '..', u);
    if (!file) file = path.join(HERE, u);
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
      res.end(data);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage();
  page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !/GPU stall due to ReadPixels/.test(m.text())) console.log('[page]', m.text()); });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(`http://127.0.0.1:${port}/${pageFile}`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
  const render = async (scene, out) => {
    const url = await page.evaluate(async (S) => { document.body.innerHTML = ''; return window.renderScene(S); }, scene);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, Buffer.from(url.split(',')[1], 'base64'));
    return out;
  };
  try { return await fn(render, page); } finally { await browser.close(); server.close(); }
}

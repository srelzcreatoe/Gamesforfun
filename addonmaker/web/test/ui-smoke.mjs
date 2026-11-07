// End-to-end smoke test of the built UI (src/main/assets/www) in headless Chromium.
// Creates one entity from every preset, opens every tab for each, exports the
// add-on and checks the download. Fails on any page error.
//   npm run build && npm run test:ui
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readZip } from '../src/core/zip.js';
import { DWELLER_PRESETS } from '../src/core/dwellers.js';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { console.log('playwright not installed; skipping UI smoke test'); process.exit(0); }

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/main/assets/www');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html'));
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const url = `http://localhost:${server.address().port}/index.html`;

const PRESETS = ['Blank mob', 'Farm animal', 'Tameable pet', 'Melee monster', 'Ranged shooter', 'Rideable mount', 'Flying critter', 'Water creature', 'Village dweller', 'Village guard', 'Boss', 'Projectile',
  ...DWELLER_PRESETS.map((d) => d.label)];
const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 412, height: 900 }, acceptDownloads: true, hasTouch: true })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
let failed = false;
try {
  await page.goto(url);
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('mobsmith.settings', JSON.stringify({ mode: 'advanced', music: false })); });
  await page.reload();
  // Dweller creator wizard, from the Dwellers home tab.
  await page.getByRole('tab', { name: 'Dwellers' }).click();
  await page.getByRole('button', { name: 'Create your own dweller' }).click();
  await page.locator('.modal input').fill('Wizard Test');
  await page.getByRole('button', { name: 'OK' }).click();
  await page.locator('.wizard .pcard', { hasText: 'Hollow Grinner' }).click();
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Next' }).click();
  await page.locator('.modal input.txt').fill('Cave Grin');
  await page.getByRole('button', { name: 'Create dweller' }).click();
  await page.locator('.tab', { hasText: 'Node board' }).click();
  await page.getByRole('button', { name: 'Fit' }).click();
  await page.locator('[data-node="seen"]').click();
  await page.locator('.modal').getByRole('button', { name: /Freeze/ }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  // Tap-to-connect: tap the "You hit it" port, then the Hunt block.
  await page.locator('[data-port="hit"]').click({ force: true });
  await page.locator('[data-node="hunt"]').click();
  await page.waitForTimeout(1500);
  const ent0 = () => page.evaluate(() => { const k = Object.keys(localStorage).find((x) => x.startsWith('mobsmith.p.')); return JSON.parse(localStorage.getItem(k)).entities[0]; });
  const h = (await ent0()).horror;
  if (h.senses.seen !== 'freeze' || !h.hunt.onHurt) throw new Error('node board edits did not reach the dweller settings');
  // "How many at once" on the Spawning tab.
  if (!(await ent0()).limit?.on) throw new Error('wizard dweller should be limited to one');
  await page.locator('nav.tabs .tab', { hasText: 'Spawning' }).click();
  await page.getByRole('button', { name: '3', exact: true }).click();
  await page.waitForTimeout(700);
  const lim = (await ent0()).limit;
  if (!lim.on || lim.max !== 3) throw new Error('limit picker did not save: ' + JSON.stringify(lim));
  await page.getByRole('button', { name: 'Only 1' }).click();
  while (await page.locator('.top .btn[aria-label="Back"]').count()) await page.locator('.top .btn[aria-label="Back"]').click();
  await page.getByRole('tab', { name: 'Creator' }).click();
  await page.locator('.pcard', { hasText: /^New/ }).first().click();
  await page.locator('.modal input').fill('Smoke Test');
  await page.getByRole('button', { name: 'OK' }).click();
  for (const pr of PRESETS) {
    await page.getByRole('button', { name: 'New', exact: true }).click();
    await page.locator('.modal input').first().fill(`${pr} one`);
    await page.locator('.preset', { has: page.locator('strong', { hasText: new RegExp(`^${esc(pr)}$`) }) }).click();
    await page.getByRole('button', { name: 'Create' }).click();
    const TABS = await page.locator('nav.tabs .tab:not(.mode-tab)').allInnerTexts();
    for (const t of TABS) {
      await page.locator('nav.tabs .tab:not(.mode-tab)', { hasText: t.replace(/\d+$/, '') }).first().click();
      await page.waitForTimeout(120);
      if (t === 'Node board') {
        await page.getByRole('button', { name: 'Fit' }).click();
        await page.locator('[data-node="notice"]').click();
        await page.getByRole('button', { name: 'Done' }).click();
      }
      if (t === 'Dweller') {
        // Visit both dweller modes.
        const wasHorror = await page.locator('.seg button.horror.on').count();
        await page.locator('.seg button', { hasText: 'Horror dweller' }).click();
        await page.waitForTimeout(150);
        await page.locator('.seg button', { hasText: 'Village dweller' }).click();
        await page.waitForTimeout(100);
        if (wasHorror) await page.locator('.seg button', { hasText: 'Horror dweller' }).click();
        await page.waitForTimeout(100);
      }
    }
    await page.locator('.top .btn[aria-label="Back"]').click();
    await page.waitForTimeout(100);
    process.stdout.write('.');
  }
  console.log('');
  const count = await page.locator('.ent').count();
  if (count !== PRESETS.length) throw new Error(`expected ${PRESETS.length} entities, found ${count}`);
  await page.locator('.top .btn[aria-label="Export"]').click();
  const banner = await page.locator('.banner').first().innerText();
  if (!/no errors/i.test(banner)) throw new Error('validator reported errors: ' + banner);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save .mcaddon' }).click()]);
  const tmp = path.join(os.tmpdir(), `smoke-${process.pid}.mcaddon`);
  await dl.saveAs(tmp);
  const entries = await readZip(new Uint8Array(fs.readFileSync(tmp)));
  fs.rmSync(tmp, { force: true });
  const ents = entries.filter((e) => /BP\/entities\/.+\.json$/.test(e.path));
  if (ents.length !== PRESETS.length) throw new Error(`zip has ${ents.length} entity files`);
  for (const e of entries.filter((x) => x.path.endsWith('.json'))) JSON.parse(new TextDecoder().decode(e.data));
  console.log(`exported ${entries.length} files, ${ents.length} entities`);
} catch (e) {
  failed = true;
  console.error('FAILED:', e.message);
}
await browser.close();
server.close();
if (errors.length) { console.error('Page errors:\n' + errors.join('\n')); failed = true; }
console.log(failed ? 'UI smoke test FAILED' : 'UI smoke test passed');
process.exit(failed ? 1 : 0);

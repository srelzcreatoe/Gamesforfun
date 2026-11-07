// High-detail textures: size, compression, glowing eyes and materials.
import test from 'node:test';
import assert from 'node:assert/strict';
import { unzlibSync } from 'fflate';
import { newProject } from '../src/core/model.js';
import { DWELLER_PRESETS, dwellerFromPreset } from '../src/core/dwellers.js';
import { entityFromPreset } from '../src/core/presets.js';
import { autoPaint, faceRects } from '../src/core/geo.js';
import { hdScale, GLOW_ALPHA, eyesGlow } from '../src/core/paint.js';
import { buildPacks } from '../src/core/packgen.js';

/** Minimal PNG decoder (8-bit RGBA, filters 0-4) to check what we write. */
function decodePNG(png) {
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let p = 8, w = 0, h = 0;
  const idat = [];
  while (p < png.length) {
    const len = dv.getUint32(p), type = String.fromCharCode(...png.subarray(p + 4, p + 8));
    const data = png.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = dv.getUint32(p + 8); h = dv.getUint32(p + 12); assert.equal(data[8], 8); assert.equal(data[9], 6); }
    if (type === 'IDAT') idat.push(data);
    p += 12 + len;
  }
  const z = new Uint8Array(idat.reduce((a, b) => a + b.length, 0));
  let o = 0; for (const d of idat) { z.set(d, o); o += d.length; }
  const raw = unzlibSync(z), out = new Uint8Array(w * h * 4), stride = w * 4;
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    for (let i = 0; i < stride; i++) {
      const x = raw[y * (stride + 1) + 1 + i], a = i >= 4 ? out[y * stride + i - 4] : 0, b = y ? out[(y - 1) * stride + i] : 0, c = y && i >= 4 ? out[(y - 1) * stride + i - 4] : 0;
      const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
      const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f];
      out[y * stride + i] = (x + pred) & 255;
    }
  }
  return { w, h, px: out };
}

test('auto-paint is high resolution and the PNG round-trips', () => {
  const e = dwellerFromPreset({ namespace: 'x' }, 'hollow_grinner');
  const R = autoPaint(e.model, e.autoPaint);
  const k = hdScale(e.model);
  assert.ok(k >= 2, 'at least 2 pixels per texel');
  assert.equal(R.w, e.model.texW * k);
  const png = R.toPNG();
  assert.ok(png.length < R.w * R.h * 4 * 0.5, `compressed (${png.length} bytes)`);
  const d = decodePNG(png);
  assert.equal(d.w, R.w);
  assert.deepEqual(d.px, R.px);
});

test('glowing eyes: low-alpha pixels only on the face, emissive material exported', () => {
  const p = newProject('Glow');
  for (const d of DWELLER_PRESETS) {
    const e = dwellerFromPreset(p, d.id);
    const R = autoPaint(e.model, e.autoPaint), k = R.w / e.model.texW;
    const head = e.model.bones.find((b) => b.role === 'head');
    const f = faceRects(head.cubes[0]).north;
    let inFace = 0, outside = 0;
    for (let y = 0; y < R.h; y++) for (let x = 0; x < R.w; x++) {
      const a = R.px[(y * R.w + x) * 4 + 3];
      if (a === 0 || a === 255) continue;
      const tx = x / k, ty = y / k;
      if (tx >= f.x && tx < f.x + f.w && ty >= f.y && ty < f.y + f.h) { inFace++; assert.equal(a, GLOW_ALPHA); } else outside++;
    }
    assert.equal(outside, 0, `${d.id}: glow pixels outside the face`);
    if (eyesGlow(e.autoPaint)) {
      assert.ok(inFace > 0, `${d.id}: glowing eyes painted`);
      assert.equal(e.model.material, 'entity_emissive_alpha');
    } else {
      assert.equal(inFace, 0, `${d.id}: no glow without glowing eyes`);
      assert.equal(e.model.material, 'entity_alphatest');
    }
  }
  const e = dwellerFromPreset(p, 'night_grinner', 'ng');
  p.entities.push(e, entityFromPreset(p, 'pet', 'dog'));
  const { rp } = buildPacks(p);
  const ce = (n) => JSON.parse(rp.files.find((x) => x.path === `entity/${n}.entity.json`).data)['minecraft:client_entity'].description;
  assert.equal(ce('ng').materials.default, 'entity_emissive_alpha');
  assert.equal(ce('dog').materials.default, 'entity_alphatest');
});

test('dweller bodies have jointed limbs and hands that follow the arm', () => {
  for (const d of DWELLER_PRESETS) {
    const e = dwellerFromPreset({ namespace: 'x' }, d.id);
    const bones = e.model.bones, byName = Object.fromEntries(bones.map((b) => [b.name, b]));
    for (const b of bones) if (b.parent) assert.ok(byName[b.parent], `${d.id}: ${b.name} parent ${b.parent} exists`);
    const chain = (n) => { const out = []; let b = byName[n]; while (b) { out.push(b.name); b = byName[b.parent]; } return out; };
    const hand = bones.find((b) => /^rightArmHand$/.test(b.name));
    if (hand) assert.deepEqual(chain(hand.name).slice(0, 3), ['rightArmHand', 'rightArmFore', 'rightArm']);
    const legs = bones.filter((b) => /Lower$/.test(b.name));
    if (!['wraith'].includes(d.body)) assert.ok(legs.length >= 2, `${d.id}: knees`);
    // Feet reach the ground (y = 0) unless it floats.
    if (d.body !== 'wraith') assert.ok(bones.some((b) => b.cubes.some((c) => c.origin[1] <= 0.01)), `${d.id}: stands on the ground`);
  }
});

#!/usr/bin/env node
// The Seam Lance in a player's hand, in the offline viewer, with the pack's own hold (tools/kit/out/lance_hold.json):
//   left   first person: the player's right arm as the game poses it for a held item, seen from the eye
//   middle third person, from behind the right shoulder
//   right  third person, from the right side
// The player is drawn with the townsperson model (the same 64x64 humanoid layout and pivots as the player's).
// How the attachable is bound (its root pivot on the hand's item bone, then the hold) is the rule worked out in
// tools/kit/gen_lance.py from the vanilla trident; it has not been seen in the game.
//   node tools/preview/lance_hold.cjs [out.png] [--size 1920x640]
const { open, ROOT, arg } = require('./render.cjs');
const fs = require('fs');
const path = require('path');
(async () => {
  const out = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : path.join(ROOT, 'previews/seam_lance_held.png');
  const [W, H] = arg(process.argv, 'size', '1920x640').split('x').map(Number);
  const hold = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/kit/out/lance_hold.json'), 'utf8'));
  const s = await open();
  const url = await s.page.evaluate(async ({ W, H, hold }) => {
    const BK = window.BK, THREE = BK.THREE;
    const ARM_P = [-5, 22, 0], ITEM_P = [-6, 15, 1], EYE = 27.6;
    const views = [];
    // one player and one lance per view, posed for that view
    async function rig(key, firstPerson) {
      await BK.loadForm(key + '_p', { geo: '/packs/RP/models/entity/basiliskra_civilian.geo.json', tex: '/packs/RP/textures/entity/basiliskra/civilian/civilian_3.png', glow: null });
      await BK.loadForm(key + '_g', { geo: '/packs/RP/models/entity/basiliskra_seam_lance.geo.json', tex: '/packs/RP/textures/entity/basiliskra/seam_lance.png', glow: null });
      const P = BK.models[key + '_p'], G = BK.models[key + '_g'];
      const arm = P.bones.get('arm_r');
      // the player's arm: animation.player.first_person.empty_hand, or animation.player.holding
      BK.setPose(key + '_p', firstPerson ? { arm_r: { rot: [95, -45, 115], pos: [13.5, -10, 12] } } : { arm_r: { rot: [-18, 0, 0] } });
      if (firstPerson) for (const [n, b] of P.bones) if (n !== 'arm_r') for (const c of b.group.children) if (c.isMesh) c.visible = false;
      // the hand's item bone, then the lance's own root bone on its pivot, then the hold
      const item = new THREE.Group();
      item.position.set(-(ITEM_P[0] - ARM_P[0]), ITEM_P[1] - ARM_P[1], ITEM_P[2] - ARM_P[2] + (firstPerson ? -1 : 0));
      arm.group.add(item);
      const lance = G.bones.get('lance');
      item.add(lance.group);
      lance.group.position.set(0, 0, 0);
      const h = firstPerson ? hold.fp : hold.tp;
      lance.group.rotation.set(-h.rot[0] * Math.PI / 180, -h.rot[1] * Math.PI / 180, h.rot[2] * Math.PI / 180);
      lance.group.position.set(-h.pos[0], h.pos[1], h.pos[2]);
      return P;
    }
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    const panes = [
      { key: 'fp', fp: true, cam: { pos: [0, EYE / 16, 0], target: [0, EYE / 16, 10], fov: 70 }, label: 'first person' },
      { key: 'tp1', fp: false, cam: { pos: [1.5, 2.3, 2.9], target: [-0.2, 1.2, -1.2], fov: 50 }, label: 'third person, behind the right shoulder' },
      { key: 'tp2', fp: false, cam: { pos: [3.6, 1.3, 0.2], target: [0, 1.1, 0.4], fov: 42 }, label: 'third person, from the right' },
    ];
    for (const p of panes) await rig(p.key, p.fp);
    for (let i = 0; i < panes.length; i++) {
      const p = panes[i];
      for (const [k, m] of Object.entries(BK.models)) m.holder.visible = k.startsWith(p.key + '_');
      const u = BK.shot(W / panes.length, H, p.cam, '#8fb4e8');
      const img = new Image(); await new Promise((r) => { img.onload = r; img.src = u; });
      g.drawImage(img, i * W / panes.length, 0);
      if (p.fp) { g.strokeStyle = '#fff'; g.lineWidth = 2; const cx = W / panes.length / 2, cy = H / 2; g.beginPath(); g.moveTo(cx - 9, cy); g.lineTo(cx + 9, cy); g.moveTo(cx, cy - 9); g.lineTo(cx, cy + 9); g.stroke(); }
      g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(i * W / panes.length, H - 34, W / panes.length, 34);
      g.fillStyle = '#fff'; g.font = '20px sans-serif'; g.fillText(p.label, i * W / panes.length + 12, H - 11);
    }
    return cv.toDataURL('image/png');
  }, { W, H, hold });
  fs.writeFileSync(out, Buffer.from(url.split(',')[1], 'base64'));
  console.log(out);
  await s.close();
})().catch((e) => { console.error(e); process.exit(1); });

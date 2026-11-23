// Renders transparent portraits of the animatronics for poster art, from the models as the game has them
// (packs/RP: run tools/entities/build_entities.py first).
//
//   node tools/render/portraits.mjs                  all seven
//   node tools/render/portraits.mjs golden_dog cat   only these
//
// Every model is drawn at the size it has in its own source pack, so a portrait frames its character the
// same way whatever its render scale is (the Golden Dog is the bigger animal in the game, not on his poster).
// Output: assets/portraits/<id>_<shot>.png. The four standard shots exist for everyone; the Golden Dog has a
// few more (three-quarter, side, powered down, the held jumpscare frame).
import { withRenderer } from './render.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RP = path.join(ROOT, 'packs/RP');
const OUT = path.join(ROOT, 'assets/portraits');
const IDS = ['rustgrin', 'mirehop', 'noxbriar', 'purple_rat', 'cat', 'top_hat_rat', 'golden_dog'];
// [name, animation, time, yaw, camera position, camera target, fov, [width, height]]
const BODY = [[0, 1.45, 5.0], [0, 1.35, 0], 36, [512, 768]];
const SHOTS = [
  ['idle_front', 'idle', 0.4, 0, ...BODY],
  ['perform', 'perform_1', 1.1, 20, ...BODY],
  ['pose', 'pose_1', 0.5, -15, ...BODY],
  ['head', 'idle', 0.4, 10, [0, 2.1, 2.3], [0, 2.05, 0], 30, [512, 512]],
];
// The Golden Dog stands taller in his own pixels (44 against 40.5) and his ears hang wide: his camera is a
// step back, and he has more shots.
const DOG_BODY = [[0, 1.55, 5.5], [0, 1.45, 0], 36, [512, 768]];
const MORE = {
  golden_dog: [
    ['idle_front', 'idle', 0.4, 0, ...DOG_BODY],
    ['perform', 'perform_1', 1.0, 20, ...DOG_BODY],
    ['pose', 'pose_1', 0.5, -15, ...DOG_BODY],
    ['head', 'idle', 0.4, 10, [0, 2.36, 3.25], [0, 2.3, 0], 30, [512, 512]],
    ['q3', 'idle', 0.4, 35, ...DOG_BODY],
    ['side', 'idle', 0.4, 90, ...DOG_BODY],
    ['back', 'idle', 0.4, 180, ...DOG_BODY],
    ['listening', 'idle', 3.5, 8, [0, 2.36, 3.25], [0, 2.3, 0], 30, [512, 512]],
    ['slump', 'pose_2', 0.5, -20, ...DOG_BODY],
    ['jumpscare', 'jumpscare', 1.6, 0, [0, 1.75, 4.6], [0, 1.6, -0.3], 40, [512, 768]],
    ['walk', 'walk', 0.6, 30, ...DOG_BODY],
  ],
};
const want = process.argv.slice(2);
const ids = want.length ? IDS.filter((i) => want.includes(i)) : IDS;
await withRenderer(async (render) => {
  for (const id of ids) {
    for (const [name, anim, t, yaw, cpos, ctarget, fov, [width, height]] of MORE[id] ?? SHOTS) {
      await render({
        width, height, background: 'transparent', exposure: 1.15,
        hemi: { sky: '#ffffff', ground: '#555555', intensity: 1.4 },
        lights: [{ type: 'dir', color: '#ffffff', intensity: 2.4, pos: [2.5, 5, 6], target: [0, 1.4, 0] }, { type: 'dir', color: '#9fb0ff', intensity: 0.7, pos: [-4, 3, -3] }],
        models: [{ geo: `/R/models/entity/fnar_${id}.geo.json`, texture: `/R/textures/entity/fnar/${id}.png`, anim: `/R/animations/fnar_${id}.animation.json`, animName: `animation.fnar.${id}.${anim}`, t, yaw }],
        camera: { pos: cpos, target: ctarget, fov },
      }, path.join(OUT, `${id}_${name}.png`));
    }
  }
}, { mounts: { '/R': RP } });
console.log(`portraits done: ${ids.join(', ')}`);

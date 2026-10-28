// Renders transparent portraits of the six animatronics for poster art.
import { withRenderer } from './render.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = path.join(ROOT, 'assets/source_models');
const OUT = path.join(ROOT, 'assets/portraits');
const chars = [['rustgrin', 'FNAF_Animatronics_RP'], ['mirehop', 'FNAF_Animatronics_RP'], ['noxbriar', 'FNAF_Animatronics_RP'], ['purple_rat', 'FNAF_Animatronics_2_RP'], ['cat', 'FNAF_Animatronics_2_RP'], ['top_hat_rat', 'FNAF_Animatronics_2_RP']];
const shots = [['idle_front', 'idle', 0.4, 0, [0, 1.45, 5.0], [0, 1.35, 0]], ['perform', 'perform_1', 1.1, 20, [0, 1.45, 5.0], [0, 1.35, 0]], ['pose', 'pose_1', 0.5, -15, [0, 1.45, 5.0], [0, 1.35, 0]], ['head', 'idle', 0.4, 10, [0, 2.1, 2.3], [0, 2.05, 0]]];
await withRenderer(async (render) => {
  for (const [id, pack] of chars) {
    for (const [name, anim, t, yaw, cpos, ctarget] of shots) {
      await render({
        width: 512, height: name === 'head' ? 512 : 768, background: 'transparent', exposure: 1.15,
        hemi: { sky: '#ffffff', ground: '#555555', intensity: 1.4 },
        lights: [{ type: 'dir', color: '#ffffff', intensity: 2.4, pos: [2.5, 5, 6], target: [0, 1.4, 0] }, { type: 'dir', color: '#9fb0ff', intensity: 0.7, pos: [-4, 3, -3] }],
        models: [{ geo: `/S/${pack}/models/entity/${id}.geo.json`, texture: `/S/${pack}/textures/entity/${id}.png`, anim: `/S/${pack}/animations/${id}.animation.json`, animName: `animation.${id}.${anim}`, t, yaw }],
        camera: { pos: cpos, target: ctarget, fov: name === 'head' ? 30 : 36 },
      }, path.join(OUT, `${id}_${name}.png`));
    }
  }
}, { mounts: { '/S': SRC } });
console.log('portraits done');

// Turning an animatronic's head AT a point. The head turn is two angles added on top of whatever pose is
// playing (fnar:look_yaw / fnar:look_pitch), so the pose's own head direction and eye position
// (data/head_aim.js, measured from the models by tools/entities/head_aim.mjs) are taken out first:
// otherwise a head that the stage pose already tilts would look past the camera.
import { HEAD_AIM } from '../data/head_aim.js';

const DEG = 180 / Math.PI;

/**
 * The look angles that point a head at `target`.
 * @param {string} model the model worn (a cast id; 'rusted' is Rustgrin's model)
 * @param {string} anim the fnar:anim value playing
 * @param {{ x: number, y: number, z: number }} pos the entity's feet
 * @param {number} yaw the entity's facing (Minecraft yaw, degrees)
 * @param {{ x: number, y: number, z: number }} target in the same coordinates as pos
 * @returns {{ yaw: number, pitch: number }} for Puppets.look (yaw + = to its right, pitch + = down)
 */
export function aimHead(model, anim, pos, yaw, target) {
  const table = HEAD_AIM[model === 'rusted' ? 'rustgrin' : model] ?? HEAD_AIM.rustgrin;
  const [y0, p0, right, up, fwd] = table[anim] ?? table.idle;
  const r = yaw / DEG;
  // facing: forward (-sin, cos), right hand (-cos, -sin)
  const eye = { x: pos.x - Math.cos(r) * right - Math.sin(r) * fwd, y: pos.y + up, z: pos.z - Math.sin(r) * right + Math.cos(r) * fwd };
  const dx = target.x - eye.x;
  const dy = target.y - eye.y;
  const dz = target.z - eye.z;
  let rel = Math.atan2(-dx, dz) * DEG - yaw - y0;
  while (rel > 180) rel -= 360;
  while (rel < -180) rel += 360;
  const pitch = -Math.atan2(dy, Math.hypot(dx, dz)) * DEG - p0;
  return { yaw: rel, pitch };
}

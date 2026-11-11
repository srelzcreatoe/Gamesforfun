// Where the Brinesleeper's world is: the Stillwater Caves biome, and every great hall the add-on has placed
// (halls can stand where world generation put another biome, e.g. the one near spawn).
// Also the small shared state other modules read: what each player's music should be doing.
import { world } from '@minecraft/server';

export const BIOME = 'brine:stillwater_caves';
export const HALL = { W: 80, H: 44, D: 14 };      // biome_shapes.GH_W, GH_H, GH_D

/** @type {{x:number,y:number,z:number,dx:number,dz:number,filled:boolean,starter?:boolean,well?:boolean,wellAt?:{x:number,y:number,z:number}}[]} */
export const halls = [];
export function loadHalls() {
  halls.length = 0;
  try { const raw = world.getDynamicProperty('brine:halls'); if (typeof raw === 'string') halls.push(...JSON.parse(raw)); } catch (e) { /* none */ }
}
export function saveHalls() {
  while (halls.length > 100) halls.splice(halls.findIndex((h) => !h.starter), 1);
  try { world.setDynamicProperty('brine:halls', JSON.stringify(halls)); } catch (e) { /* keep in memory */ }
}
export function hallAt(pos) {
  return halls.find((h) => Math.abs(pos.x - h.x) < HALL.W / 2 && Math.abs(pos.z - h.z) < HALL.W / 2 &&
    pos.y > h.y - HALL.D - 1 && pos.y < h.y - HALL.D + HALL.H + 1);
}
export function biomeAt(dim, pos) {
  try { return dim.getBiome(pos).id; } catch (e) { return ''; }
}
/** inside the Stillwater Caves or one of the great halls */
export function inStillwater(dim, pos) {
  if (dim.id !== 'minecraft:overworld') return false;
  return biomeAt(dim, pos) === BIOME || !!hallAt(pos);
}

// what the creature is doing to each player, for the music: 'near' or 'chase', with an expiry tick
export const pressure = new Map();
export function press(playerId, level, until) {
  const p = pressure.get(playerId);
  if (!p || level === 'chase' || p.level !== 'chase' || p.until < until) pressure.set(playerId, { level, until });
}

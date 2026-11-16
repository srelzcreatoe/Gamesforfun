// Where the animatronics stand to lean in at the office doors and the right window (shared by the
// game's placement and the dread director's lean-in).
import { NODES } from '../data/nodes.js';
import { OFFICE } from '../data/layout.js';

/** Leaning in at an office door or window, each animatronic plants its feet this far behind the opening's outer face
 *  (blocks): bent forward, its face stops about half a block outside, so a closed shutter never cuts through it. */
export const LEAN_BACK = Object.freeze({ rustgrin: 1.61, mirehop: 1.49, noxbriar: 1.61, purple_rat: 1.65, cat: 1.76, top_hat_rat: 1.7 });
/** Standing at the office doors and the window, they bend down so their face fills the opening. */
export const LEAN_NODES = new Set(['DOOR_L', 'DOOR_R', 'WIN_R']);
/** Where a character stands to lean in at a lean node: straight out from the opening, LEAN_BACK behind its outer face. */
export function leanSpot(id, node) {
  const n = NODES[node];
  const d = OFFICE.doors[n.door === 'L' ? 'L' : 'R'];
  const back = LEAN_BACK[id] ?? 1.65;
  // the left opening's outer face is the west side of its wall cell, the right one's the east side
  return { x: n.door === 'L' ? d.x - back : d.x + 1 + back, y: n.y, z: n.z };
}

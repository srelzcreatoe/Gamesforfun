// Encounter openings.  Pure data + a picker.
// Every setup runs the same brain; a setup only changes where it spawns, its posture,
// how it opens and which escalation stage unlocks it.

export const SETUPS = {
  // it stalks, freezes when seen, and moves only while you are not looking
  statue_hunt: { stage: 0, weight: 3, spawnBand: [18, 30], needsHeadroom: 3, posture: "hunch", standoff: true },
  // it peeks around corners, hides when stared at, comes back closer
  corner_peek: { stage: 0, weight: 2, spawnBand: [14, 24], needsHeadroom: 3, posture: "hunch", standoff: true, peeks: [2, 3] },
  // it comes through a tunnel on its belly
  tunnel_crawler: { stage: 0, weight: 1.5, spawnBand: [12, 22], needsHeadroom: 2, maxHeadroom: 3, posture: "crawl", standoff: true },
  // a silhouette at the edge of the dark, watching; leaves if you come closer
  distant_watcher: { stage: 0, weight: 1.5, spawnBand: [26, 42], needsHeadroom: 5, posture: "tall", standoff: false, watcher: true },
  // it opens by doing something you did in an earlier encounter
  the_rehearsal: { stage: 1, weight: 2.5, spawnBand: [16, 26], needsHeadroom: 5, posture: "tall", standoff: true, rehearsal: true },
  // folded small in a big cavern, it unfolds to its full height when you notice it
  cavern_reveal: { stage: 1, weight: 2, spawnBand: [18, 30], needsHeadroom: 7, posture: "hunch", standoff: true, reveal: true },
  // it is standing behind you when you turn around
  behind_you: { stage: 2, weight: 1.5, spawnBand: [7, 11], needsHeadroom: 4, posture: "tall", standoff: true, behind: true },
  // no stand-off: a scream from far away, then it comes running
  the_hunter: { stage: 3, weight: 1, spawnBand: [26, 38], needsHeadroom: 3, posture: "hunch", standoff: false, hunter: true },
};

export const SETUP_IDS = Object.keys(SETUPS);

/** Setups a player at this escalation stage may see. */
export function setupsForStage(stage) {
  return SETUP_IDS.filter((id) => SETUPS[id].stage <= stage);
}

export function fitsTerrain(id, headroom) {
  const s = SETUPS[id];
  if (!s) return false;
  if (headroom < s.needsHeadroom) return false;
  if (s.maxHeadroom !== undefined && headroom > s.maxHeadroom) return false;
  return true;
}

/**
 * @param {Array<[string, number]>} weights  [setup, weight] pairs (memory novelty applied)
 * @param {{headroom:number}} terrain measured at the spawn site
 */
export function pickSetup(weights, terrain, rng, forced) {
  if (forced && SETUPS[forced]) return forced;
  const ok = weights.filter(([id, w]) => w > 0 && fitsTerrain(id, terrain.headroom));
  if (!ok.length) return null;
  return rng.weighted(ok);
}

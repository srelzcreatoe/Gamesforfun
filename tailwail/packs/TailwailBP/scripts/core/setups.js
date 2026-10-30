// Encounter openings.  Pure data + a picker.
// Every setup runs the same brain; a setup only changes where it spawns, its posture,
// how it opens and which escalation stage unlocks it.
//   where: "cave" (underground), "surface" (outside at night) or "any"
//   opener: stalk | cling | huddle | behind | hunt

export const SETUPS = {
  // caves -------------------------------------------------------------------------------
  // it shows itself in the dark (watching, peeking, crossing), then comes for you
  stalker: { stage: 0, weight: 3, where: "cave", spawnBand: [16, 28], needsHeadroom: 3, posture: "hunch", opener: "stalk" },
  // it peeks around corners and ducks back, closer each time
  corner_peek: { stage: 0, weight: 2, where: "cave", spawnBand: [14, 24], needsHeadroom: 3, posture: "hunch", opener: "stalk", firstBeat: "peek" },
  // it comes through a tunnel on its belly
  tunnel_crawler: { stage: 0, weight: 1.2, where: "cave", spawnBand: [12, 22], needsHeadroom: 2, maxHeadroom: 3, posture: "crawl", opener: "stalk" },
  // spread on the ceiling ahead of you; it lets go when you pass underneath
  ceiling: { stage: 1, weight: 2, where: "cave", spawnBand: [10, 20], needsHeadroom: 3, posture: "crawl", opener: "cling" },
  // balled up in a corner facing the wall, like a heap of rock and hair
  huddle: { stage: 1, weight: 1.5, where: "cave", spawnBand: [10, 18], needsHeadroom: 3, posture: "hunch", opener: "huddle" },
  // anywhere ------------------------------------------------------------------------------
  // it opens by doing something you did in an earlier encounter
  the_rehearsal: { stage: 1, weight: 1.5, where: "any", spawnBand: [16, 26], needsHeadroom: 5, posture: "tall", opener: "stalk", rehearsal: true, firstBeat: "tall" },
  // it is crouched right behind you when you turn around
  behind_you: { stage: 2, weight: 1.2, where: "any", spawnBand: [6, 9], needsHeadroom: 4, posture: "tall", opener: "behind" },
  // no warning: a scream from somewhere out there, then it comes running
  the_hunter: { stage: 2, weight: 1.2, where: "any", spawnBand: [26, 38], needsHeadroom: 3, posture: "hunch", opener: "hunt" },
  // surface (night) -------------------------------------------------------------------------
  // standing at full height at the edge of the dark, watching
  treeline: { stage: 0, weight: 3, where: "surface", spawnBand: [26, 44], needsHeadroom: 5, posture: "tall", opener: "stalk", firstBeat: "tall" },
  // something big runs across the field in the dark
  runner: { stage: 0, weight: 2, where: "surface", spawnBand: [22, 34], needsHeadroom: 3, posture: "hunch", opener: "stalk", firstBeat: "cross" },
  // internal: it pretended to leave and comes back running
  the_return: { stage: 99, weight: 0, where: "any", spawnBand: [18, 28], needsHeadroom: 3, posture: "hunch", opener: "hunt", internal: true },
};

export const SETUP_IDS = Object.keys(SETUPS);

/** Setups a player at this escalation stage may see in this kind of place. */
export function setupsForStage(stage, where = "cave") {
  return SETUP_IDS.filter((id) => {
    const s = SETUPS[id];
    return !s.internal && s.stage <= stage && (s.where === "any" || s.where === where);
  });
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

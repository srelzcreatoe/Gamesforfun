// The six encounter setups.  Pure data + a picker.
// Each setup uses the same core rules; it only changes entry conditions, cues, timing
// and the outcomes it steers toward.

export const SETUPS = {
  distant_silhouette: {
    spawnBand: [22, 28],
    needsHeadroom: 5, // stands tall at the edge of the dark
    posture: "tall",
    approach: false, // only escalates if the player walks toward it
    escalateWithin: 14,
    outcomes: ["observed", "interrupted", "calm", "escaped", "caught"],
    cues: ["breath_far"],
  },
  corner_peek: {
    spawnBand: [16, 24],
    needsHeadroom: 3,
    posture: "tall",
    approach: true,
    peeks: [2, 3],
    outcomes: ["observed", "calm", "escaped", "caught"],
    cues: ["nail_scrape"],
  },
  delayed_imitation: {
    spawnBand: [18, 26],
    needsHeadroom: 3,
    posture: "tall",
    approach: true,
    outcomes: ["calm", "interrupted", "escaped", "caught"],
    cues: ["breath_far", "tail_scrape"],
  },
  low_tunnel_observation: {
    spawnBand: [16, 24],
    needsHeadroom: 2,
    maxHeadroom: 3, // must be a genuinely low passage
    posture: "crawl",
    approach: false,
    escalateWithin: 7,
    outcomes: ["observed", "interrupted", "escaped", "caught"],
    cues: ["nail_scrape"],
  },
  full_height_reveal: {
    spawnBand: [18, 28],
    needsHeadroom: 7, // a cavern big enough to unfold in
    posture: "tall",
    approach: true,
    reveal: true,
    outcomes: ["calm", "escaped", "caught"],
    cues: ["breath_far"],
  },
  voluntary_withdrawal: {
    spawnBand: [18, 28],
    needsHeadroom: 3,
    posture: "tall",
    approach: false,
    withdrawAfterNotice: true,
    outcomes: ["observed"],
    cues: ["tail_scrape", "retreat"],
  },
};

export const SETUP_IDS = Object.keys(SETUPS);

/**
 * @param {Array<[string, number]>} weights from memory.setupWeights
 * @param {{headroom: number}} terrain measured at the chosen spawn site
 */
export function pickSetup(weights, terrain, rng, forced) {
  if (forced && SETUPS[forced]) return forced;
  const ok = weights.filter(([id]) => {
    const s = SETUPS[id];
    if (terrain.headroom < s.needsHeadroom) return false;
    if (s.maxHeadroom !== undefined && terrain.headroom > s.maxHeadroom) return false;
    return true;
  });
  if (!ok.length) return null;
  return rng.weighted(ok);
}

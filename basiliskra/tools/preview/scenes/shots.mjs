// Camera scripts for the encounter previews.  Times are seconds from the start of the replay.
// pos / tgt are world points, or {at: bone-or-locator, up?} on the animal, or {rel: [dx,dy,dz]}
// from his origin.  "cut: true" jumps to that key instead of travelling to it.
const NOTE = 'Model views: the shipped geometry, textures and client animations, posed by scripted property values (no behaviour script). Offline reference render, not in-game capture.';

export const SHOTS = {
  arrival: {
    title: 'Basiliskra I — the rift opens', sub: 'one continuous take: three knocks, the seam, three rams, the gill that sticks',
    bounds: { x0: -70, x1: 112, y0: 44, y1: 70, z0: -8, z1: 122 }, waterY: 62.9, fog: [34, 118], home: [-18.5, 57.5, 37.5],
    // the pier is the terrain's; everything under water is placed from the seam and the way he came through it
    keys: [
      { t: 0, pos: [-4.4, 66.0, 19.5], tgt: [-9.5, 63.3, 26.4], fov: 50 },
      { t: 3.3, pos: [-4.4, 66.0, 19.5], tgt: [-9.5, 63.3, 26.4], fov: 50 },
      { t: 5.6, pos: [-4.0, 66.3, 24.4], tgt: { rift: [0, 5.2, 0] }, fov: 44 },
      { t: 8.5, pos: [-4.0, 66.3, 24.4], tgt: { rift: [0, 5.2, 0] }, fov: 44 },
      { t: 10.5, pos: { rift: [-3, 3.2, -18] }, tgt: { rift: [5, 1.2, 0] }, fov: 70 },
      { t: 14.8, pos: { rift: [12, 2.4, -21] }, tgt: { at: 'seg3' }, fov: 72 },
      { t: 34.6, pos: { rift: [12, 2.4, -21] }, tgt: { at: 'seg3' }, fov: 72 },
      { t: 38.4, pos: { rift: [8, 3.4, -15] }, tgt: { at: 'seg2' }, fov: 66 },
      { t: 41.0, pos: [-4.4, 66.0, 19.5], tgt: [-9.5, 63.4, 26.4], fov: 50 },
      { t: 43.0, pos: [-4.4, 66.0, 19.5], tgt: [-9.5, 63.4, 26.4], fov: 50 },
    ],
  },
  window: {
    title: 'Basiliskra III — four footfalls', sub: 'the village at night: four evenly spaced steps, then one small eye level with the window',
    bounds: { x0: -44, x1: 104, y0: 59, y1: 70, z0: -64, z1: 44 }, fog: [26, 104], home: [68, 64, 6],
    keys: [
      // outside, in the rain: he comes down the street
      { t: 0, pos: [12, 65.3, -10], tgt: { at: 'chest' }, fov: 46 },
      { t: 15.5, pos: [13, 65.3, -11], tgt: { at: 'chest' }, fov: 46 },
      // inside, at the player's eye: the pause, the four footfalls with the head coming down, the eye
      { t: 15.7, cut: true, pos: [1.25, 65.72, 0.95], tgt: [4.0, 65.9, 1.0], fov: 74 },
      { t: 22.0, pos: [1.25, 65.72, 0.95], tgt: [4.0, 65.9, 1.0], fov: 74 },
      { t: 28.4, pos: [1.6, 65.7, 0.95], tgt: [4.0, 65.75, 0.95], fov: 60 },
      // outside again: what that looks like from the street
      { t: 28.6, cut: true, pos: [13.5, 65.9, -13], tgt: [8.5, 66.6, 0.5], fov: 56 },
      { t: 34.8, pos: [15.5, 66.1, -15], tgt: [9.5, 67, 0.5], fov: 56 },
      { t: 41.0, pos: [20, 66.6, -24], tgt: { at: 'chest' }, fov: 56 },
    ],
  },
  beam: {
    title: 'Basiliskra III — the red beam, and the charge grounded', sub: 'the hide lights tail to head; the second charge is led into a lightning rod, and he roars',
    bounds: { x0: -24, x1: 116, y0: 59, y1: 70, z0: -70, z1: 40 }, fog: [40, 135], home: [62, 64, -8],
    keys: [
      { t: 0, pos: [34, 68.6, -30], tgt: [62, 69, -8], fov: 62 },
      { t: 3.9, pos: [30, 68.2, -34], tgt: [52, 68.5, -8], fov: 64 },
      { t: 4.7, pos: [25, 69.2, -42], tgt: [36, 66.5, -8], fov: 70 },
      { t: 7.4, pos: [25, 69.2, -42], tgt: [36, 66.5, -8], fov: 70 },
      { t: 8.6, pos: [35, 70.5, -20], tgt: { at: 'head' }, fov: 50 },
      { t: 11.6, pos: [35, 70.5, -20], tgt: { at: 'head' }, fov: 50 },
      { t: 13.6, pos: [97, 68.5, -31], tgt: { at: 'club' }, fov: 56 },
      { t: 19.3, pos: [96, 68, -30], tgt: [86, 66.5, -10], fov: 56 },
      // robbed of the charge, he roars
      { t: 19.5, cut: true, pos: [36, 67.6, -25], tgt: { at: 'head' }, fov: 48 },
      { t: 22.9, pos: [33, 68.2, -29], tgt: { at: 'head' }, fov: 52 },
      { t: 25.0, pos: [30, 70, -38], tgt: { at: 'chest' }, fov: 60 },
    ],
  },
  // ---- model views: front, side, back and eye detail of each form (scripted properties, see model_replays.mjs) ----
  model_i: {
    title: 'Basiliskra I \u2014 the water', sub: 'about thirty blocks nose to tail; the pale notch is on the left of the tail fin',
    note: NOTE, bounds: { x0: -50, x1: 50, y0: 38, y1: 64, z0: -52, z1: 112 }, waterY: 62.9, fog: [60, 160], home: [0, 52, 0],
    labels: [
      { from: 0.3, to: 3.2, text: 'left side' }, { from: 3.6, to: 6.0, text: 'front' }, { from: 6.4, to: 8.6, text: 'right side' }, { from: 9.0, to: 10.6, text: 'back' },
      { from: 10.8, to: 14.1, text: 'eye detail' }, { from: 14.3, to: 17.5, text: 'three knocks: the gills pulse (readable without sound)' },
      { from: 17.7, to: 20.4, text: 'the spasm runs down his back' },
    ],
    keys: [
      { t: 0, pos: { rel: [28, 3, -9] }, tgt: { rel: [0, 2.2, -9] }, fov: 50 },
      { t: 2.8, pos: { rel: [28, 3, -9] }, tgt: { rel: [0, 2.2, -9] }, fov: 50 },
      { t: 3.6, pos: { rel: [3, 3, 22] }, tgt: { rel: [0, 2.2, 0] }, fov: 50 },
      { t: 5.6, pos: { rel: [3, 3, 22] }, tgt: { rel: [0, 2.2, 0] }, fov: 50 },
      { t: 6.4, pos: { rel: [-28, 3, -9] }, tgt: { rel: [0, 2.2, -9] }, fov: 50 },
      { t: 8.2, pos: { rel: [-28, 3, -9] }, tgt: { rel: [0, 2.2, -9] }, fov: 50 },
      { t: 9.0, pos: { rel: [0, 4, -46] }, tgt: { rel: [0, 2.2, -14] }, fov: 50 },
      { t: 10.5, pos: { rel: [0, 4, -46] }, tgt: { rel: [0, 2.2, -14] }, fov: 50 },
      { t: 10.7, cut: true, pos: { at: 'eye_l', off: [3.0, 0.3, 2.2] }, tgt: { at: 'eye_l' }, fov: 26 },
      { t: 14.1, pos: { at: 'eye_l', off: [2.6, 0.3, 2.6] }, tgt: { at: 'eye_l' }, fov: 26 },
      { t: 14.2, cut: true, pos: { at: 'gill_l', off: [8, 1.5, 4] }, tgt: { at: 'gill_l' }, fov: 40 },
      { t: 17.5, pos: { at: 'gill_l', off: [8, 1.5, 4] }, tgt: { at: 'gill_l' }, fov: 40 },
      { t: 17.6, cut: true, pos: { rel: [26, 6, -10] }, tgt: { rel: [0, 2.2, -10] }, fov: 52 },
      { t: 23.1, pos: { rel: [28, 5, -6] }, tgt: { rel: [0, 2.2, -10] }, fov: 52 },
    ],
  },
  model_ii: {
    title: 'Basiliskra II \u2014 the shore', sub: 'heavy armoured front, small webbed hind legs, the oval tail knob with its horn buds',
    note: NOTE, bounds: { x0: -56, x1: 56, y0: 60, y1: 70, z0: -56, z1: 76 }, fog: [60, 160], home: [0, 64, 0],
    lights: [{ from: 12.3, to: 16.0, pos: { at: 'eye_l', off: [3.4, 1.6, 0.6] }, color: [1.0, 0.78, 0.42], power: 1.5, range: 14 }],
    labels: [
      { from: 0.3, to: 3.4, text: 'left side: the dragging gait (reach, pull, rest)' }, { from: 3.8, to: 6.4, text: 'front' }, { from: 6.8, to: 9.4, text: 'right side' }, { from: 9.8, to: 12.1, text: 'back' },
      { from: 12.4, to: 15.9, text: 'eye detail, by the light of a torch held three blocks off' }, { from: 16.1, to: 19.2, text: 'the first discharge: the knob and horn buds flash three times' },
      { from: 20.0, to: 23.0, text: 'the roar (the same voice, younger)' },
    ],
    keys: [
      { t: 0, pos: { rel: [28, 5, -5] }, tgt: { rel: [0, 3.5, -5] }, fov: 50 },
      { t: 3.0, pos: { rel: [28, 5, -5] }, tgt: { rel: [0, 3.5, -5] }, fov: 50 },
      { t: 3.8, pos: { rel: [3, 4, 28] }, tgt: { rel: [0, 4, 2] }, fov: 50 },
      { t: 6.0, pos: { rel: [3, 4, 28] }, tgt: { rel: [0, 4, 2] }, fov: 50 },
      { t: 6.8, pos: { rel: [-28, 5, -5] }, tgt: { rel: [0, 3.5, -5] }, fov: 50 },
      { t: 9.0, pos: { rel: [-28, 5, -5] }, tgt: { rel: [0, 3.5, -5] }, fov: 50 },
      { t: 9.8, pos: { rel: [0, 6, -40] }, tgt: { rel: [0, 3.5, -10] }, fov: 50 },
      { t: 12.0, pos: { rel: [0, 6, -40] }, tgt: { rel: [0, 3.5, -10] }, fov: 50 },
      { t: 12.3, cut: true, pos: { at: 'eye_l', off: [3.0, 0.3, 2.2] }, tgt: { at: 'eye_l' }, fov: 26 },
      { t: 15.9, pos: { at: 'eye_l', off: [2.6, 0.3, 2.6] }, tgt: { at: 'eye_l' }, fov: 26 },
      { t: 16.0, cut: true, pos: { rel: [16, 6, -34] }, tgt: { at: 'knob' }, fov: 45 },
      { t: 19.2, pos: { rel: [16, 6, -34] }, tgt: { at: 'knob' }, fov: 45 },
      { t: 19.9, cut: true, pos: { rel: [13, 3.2, 24] }, tgt: { at: 'head' }, fov: 44 },
      { t: 23.0, pos: { rel: [14, 3.4, 26] }, tgt: { at: 'head' }, fov: 46 },
      { t: 26.1, pos: { rel: [30, 7, -6] }, tgt: { rel: [0, 3.5, -5] }, fov: 50 },
    ],
  },
  model_iii: {
    title: 'Basiliskra III \u2014 four footfalls', sub: 'long-necked quadruped, crimson dorsal plates, the spiked tail club; the same pale notch on the left of the tail',
    note: NOTE, bounds: { x0: -64, x1: 64, y0: 60, y1: 72, z0: -64, z1: 96 }, fog: [70, 180], home: [0, 64, 0],
    lights: [{ from: 11.0, to: 15.0, pos: { at: 'eye_l', off: [3.6, 1.4, 0.4] }, color: [1.0, 0.78, 0.42], power: 1.5, range: 14 }],
    labels: [
      { from: 0.3, to: 3.0, text: 'left side: each foot plants before the next lifts' }, { from: 3.4, to: 6.0, text: 'front' }, { from: 6.4, to: 8.4, text: 'right side' }, { from: 8.8, to: 10.8, text: 'back' },
      { from: 11.1, to: 14.9, text: 'eye detail by torchlight: the look travels eye, skull, neck, shoulders' }, { from: 15.1, to: 17.5, text: 'silhouette against a rainy sky' },
      { from: 17.7, to: 22.2, text: 'charge: the hide lights from the tail club to the head' }, { from: 22.3, to: 23.6, text: 'fire' }, { from: 23.7, to: 26.4, text: 'vent: three knocks at the old gill slits' }, { from: 27.6, to: 35.0, text: 'the roar' },
    ],
    keys: [
      { t: 0, pos: { rel: [40, 8, -2] }, tgt: { rel: [0, 6.5, -3] }, fov: 50 },
      { t: 2.6, pos: { rel: [40, 8, -2] }, tgt: { rel: [0, 6.5, -3] }, fov: 50 },
      { t: 3.4, pos: { rel: [4, 7, 46] }, tgt: { rel: [0, 7, 6] }, fov: 50 },
      { t: 5.6, pos: { rel: [4, 7, 46] }, tgt: { rel: [0, 7, 6] }, fov: 50 },
      { t: 6.4, pos: { rel: [-40, 8, -2] }, tgt: { rel: [0, 6.5, -3] }, fov: 50 },
      { t: 8.0, pos: { rel: [-40, 8, -2] }, tgt: { rel: [0, 6.5, -3] }, fov: 50 },
      { t: 8.8, pos: { rel: [0, 9, -54] }, tgt: { rel: [0, 7, -8] }, fov: 50 },
      { t: 10.8, pos: { rel: [0, 9, -54] }, tgt: { rel: [0, 7, -8] }, fov: 50 },
      { t: 11.0, cut: true, pos: { at: 'eye_l', off: [3.4, 0.2, 2.6] }, tgt: { at: 'eye_l' }, fov: 26 },
      { t: 14.9, pos: { at: 'eye_l', off: [3.0, 0.2, 3.0] }, tgt: { at: 'eye_l' }, fov: 26 },
      { t: 15.0, cut: true, pos: { rel: [18, 1.2, 46] }, tgt: { at: 'neck3' }, fov: 55 },
      { t: 17.5, pos: { rel: [20, 1.2, 44] }, tgt: { at: 'neck3' }, fov: 55 },
      { t: 17.6, cut: true, pos: { rel: [42, 9, 2] }, tgt: { rel: [0, 7, -3] }, fov: 52 },
      { t: 22.2, pos: { rel: [42, 9, 2] }, tgt: { rel: [0, 7, -3] }, fov: 52 },
      { t: 23.6, pos: { rel: [30, 8, 24] }, tgt: { at: 'head' }, fov: 50 },
      { t: 27.2, pos: { rel: [30, 8, 24] }, tgt: { at: 'head' }, fov: 50 },
      { t: 28.6, pos: { rel: [17, 2.6, 36] }, tgt: { at: 'head' }, fov: 46 },
      { t: 34.6, pos: { rel: [19, 2.8, 39] }, tgt: { at: 'head' }, fov: 48 },
      { t: 39.1, pos: { rel: [40, 8, 10] }, tgt: { rel: [0, 7, -3] }, fov: 52 },
    ],
  },
};

// Camera scripts for the encounter previews.  Times are seconds from the start of the replay.
// pos / tgt are world points, or {at: bone-or-locator, up?} on the animal, or {rel: [dx,dy,dz]}
// from his origin.  "cut: true" jumps to that key instead of travelling to it.
export const SHOTS = {
  arrival: {
    title: 'Basiliskra I — the rift opens', sub: 'one continuous take: three knocks, the seam, three rams, the gill that sticks',
    bounds: { x0: -64, x1: 60, y0: 44, y1: 70, z0: -8, z1: 96 }, waterY: 62.9, fog: [34, 118], home: [-18.5, 57.5, 37.5],
    keys: [
      { t: 0, pos: [-3.2, 65.9, 21.0], tgt: [-10.2, 63.3, 26.0], fov: 52 },
      { t: 3.2, pos: [-3.2, 65.9, 21.0], tgt: [-10.2, 63.3, 26.0], fov: 52 },
      { t: 5.6, pos: [-6.4, 65.8, 28.6], tgt: [-18.5, 62.8, 37.5], fov: 54 },
      { t: 8.4, pos: [-6.4, 65.8, 28.6], tgt: [-18.5, 62.8, 37.5], fov: 54 },
      { t: 10.4, pos: [-13, 60.6, 54], tgt: [-13, 58.6, 37.5], fov: 70 },
      { t: 14.6, pos: [-5, 59.6, 58], tgt: { at: 'seg3' }, fov: 72 },
      { t: 34.8, pos: [-5, 59.6, 58], tgt: { at: 'seg3' }, fov: 72 },
      { t: 38.6, pos: [-7, 60.6, 52], tgt: { at: 'seg2' }, fov: 66 },
      { t: 41.0, pos: [-6.4, 65.8, 23.0], tgt: [-10.2, 63.4, 29.4], fov: 54 },
      { t: 43.0, pos: [-6.4, 65.8, 23.0], tgt: [-10.2, 63.4, 29.4], fov: 54 },
    ],
  },
  window: {
    title: 'Basiliskra III — four footfalls', sub: 'the village at night: four evenly spaced steps, then one small eye level with the window',
    bounds: { x0: -44, x1: 104, y0: 59, y1: 70, z0: -64, z1: 44 }, fog: [26, 104], home: [68, 64, 6],
    keys: [
      { t: 0, pos: [12, 65.3, -10], tgt: { at: 'chest' }, fov: 46 },
      { t: 11.0, pos: [14, 65.3, -12], tgt: { at: 'chest' }, fov: 46 },
      { t: 11.2, cut: true, pos: [-3.3, 65.55, 0.95], tgt: [3, 65.9, 0.75], fov: 58 },
      { t: 24.0, pos: [-2.2, 65.6, 0.95], tgt: [3, 65.9, 0.8], fov: 52 },
      { t: 24.2, cut: true, pos: [15, 66.2, -17], tgt: [11, 66.5, 0.5], fov: 60 },
      { t: 30.5, pos: [18, 66.4, -19], tgt: [12, 67, 0.5], fov: 60 },
      { t: 36.6, pos: [22, 66.6, -24], tgt: { at: 'chest' }, fov: 58 },
    ],
  },
  beam: {
    title: 'Basiliskra III — the red beam, and the charge grounded', sub: 'the hide lights tail to head; the second charge is led into a lightning rod',
    bounds: { x0: -24, x1: 116, y0: 59, y1: 70, z0: -70, z1: 40 }, fog: [40, 135], home: [62, 64, -8],
    keys: [
      { t: 0, pos: [34, 68.6, -30], tgt: [62, 69, -8], fov: 62 },
      { t: 3.9, pos: [30, 68.2, -34], tgt: [52, 68.5, -8], fov: 64 },
      { t: 4.7, pos: [25, 69.2, -42], tgt: [36, 66.5, -8], fov: 70 },
      { t: 7.4, pos: [25, 69.2, -42], tgt: [36, 66.5, -8], fov: 70 },
      { t: 8.6, pos: [35, 70.5, -20], tgt: { at: 'head' }, fov: 50 },
      { t: 11.6, pos: [35, 70.5, -20], tgt: { at: 'head' }, fov: 50 },
      { t: 13.6, pos: [97, 68.5, -31], tgt: { at: 'club' }, fov: 56 },
      { t: 20.0, pos: [96, 68, -30], tgt: [86, 66.5, -10], fov: 56 },
      { t: 21.8, pos: [70, 73, -50], tgt: [64, 68, -8], fov: 62 },
      { t: 25.7, pos: [66, 73, -52], tgt: { at: 'chest' }, fov: 62 },
    ],
  },
};

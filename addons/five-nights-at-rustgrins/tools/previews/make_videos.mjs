// Renders short preview videos from the real build plan and the real models.
//
//   node tools/previews/make_videos.mjs [--only=name,name] [--size=1280x720] [--fps=15] [--test]
//
// Every clip is a function of time that returns a scene for tools/render (the same scene format as
// make_previews.mjs); the frames go to tools/.cache/videos/<clip>/ and ffmpeg turns them into
// previews/videos/<clip>.mp4. `--test` renders only three frames of each clip (first, middle, last) so the
// framing can be checked before a full render.
//
// Clips:
//   golden_dog_turntable   the Golden Dog on his stage under the ghost light, the camera circling him
//   golden_dog_walk        the Other Office: he comes down the Long Hall to the desk, and takes you
//   golden_dog_visit       the security office: he is standing behind you. Do not turn around
//   cellar_walkthrough     down the stairs in Parts & Service and through the cellar to the Gold Room
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildVoxels } from '../map/export_voxels.mjs';
import { renderWorld } from '../render/render_world.mjs';
import { NODES } from '../../packs/BP/scripts/data/nodes.js';
import { CELLAR } from '../../packs/BP/scripts/data/cellar.js';
import { OFFICE } from '../../packs/BP/scripts/data/layout.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CACHE = path.join(ROOT, 'tools/.cache/videos');
const OUT = path.join(ROOT, 'previews/videos');
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const [W, H] = arg('size', '1280x720').split('x').map(Number);
const FPS = Number(arg('fps', '15'));
const ONLY = arg('only', '') ? arg('only', '').split(',') : null;
const TEST = process.argv.includes('--test');

const VARIANTS = { night: { mode: 'night' }, day: { mode: 'day' }, day_open: { mode: 'day', cleanWalls: true, dayDoors: true } };
const point = (pos, color, intensity, distance) => ({ type: 'point', pos, color, intensity, distance, decay: 1.6 });
const ambient = (color, intensity) => ({ type: 'ambient', color, intensity });
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (t) => Math.max(0, Math.min(1, t));
const ease = (t) => { const u = clamp01(t); return u * u * (3 - 2 * u); };
const DOG = 'fnar:golden_dog';
const JUMPSCARE = 1.6; // seconds; it holds its last frame
/** The Golden Dog standing at a point (feet), facing `yaw` (0 = south, 180 = north). */
const dogAt = (pos, yaw, anim, t, extra = {}) => ({ id: DOG, pos, yaw, anim, t, eyes: true, eyeIntensity: 12, ...extra });
const node = (id) => [NODES[id].x, NODES[id].y, NODES[id].z];
const spot = (pos, target, color, intensity) => ({ type: 'spot', pos, target, color, intensity, distance: 26, angle: 24, penumbra: 0.55, shadow: true });
/** One of the cast standing on a route node, facing the way the node faces. */
const castAt = (id, n, anim, t) => ({ id: `fnar:${id}`, pos: node(n), yaw: NODES[n].yaw, anim, t, eyes: false });
/**
 * A jumpscare framed the way the game frames it (mc/game.js jumpscareShot with mc/golden.js GOLDEN_BODY): the
 * lens half a block in front of the eyes, him 2.13 blocks beyond it, set so that his eyes on the held frame
 * (2.34 above his feet) are level with the lens. `dz`: -1 when the guard faces north, 1 facing south.
 */
const jumpscareShot = (eye, dz) => {
  const cam = [eye[0], eye[1], eye[2] + dz * 0.5];
  return { cam, pos: [cam[0], cam[1] - 2.34, cam[2] + dz * 2.13], target: [cam[0], cam[1], cam[2] + dz * 2.13] };
};
const STAGE = node(CELLAR.stage);
const GHOST = [34.5, STAGE[1] + 1.5, 19.0]; // the ghost light on his stage (data/cellar_plan.js)

// ---------------------------------------------------------------- a walked path through the built map
/** Cells a body passes through (thin things and light). Everything else is solid. */
const PASS = /^(minecraft:(air|light_block_\d+|short_grass|.*_carpet|.*wall_sign|.*_button|cobweb|web)|fnar:(floor_decal|poster_.*|drawing.*|sign_.*|wall_writing.*|lot_tag|neon_sign.*|bunting|light_button|door_button|dead_button|paws_.*|gild_.*|puddle.*|wall_sconce.*|hanging_.*|pipe.*))$/;
/** The pack's own blocks that have no collision box (wall decor, lamps, flat things): a body walks through them. */
const NO_COLLISION = new Set(fs.readdirSync(path.join(ROOT, 'packs/BP/blocks')).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'packs/BP/blocks', f), 'utf8'))['minecraft:block'])
  .filter((b) => b.components?.['minecraft:collision_box'] === false).map((b) => b.description.identifier));
function gridFns(grid) {
  const name = (x, y, z) => {
    const ix = x - grid.x0, iy = y - grid.y0, iz = z - grid.z0;
    if (ix < 0 || iy < 0 || iz < 0 || ix >= grid.sx || iy >= grid.sy || iz >= grid.sz) return 'minecraft:bedrock';
    return grid.palette[grid.data[ix + grid.sx * (iz + grid.sz * iy)]].name;
  };
  const open = (x, y, z) => { const n = name(x, y, z); return PASS.test(n) || NO_COLLISION.has(n); };
  const stand = (x, y, z) => open(x, y, z) && open(x, y + 1, z) && !open(x, y - 1, z);
  return { name, open, stand };
}
/** A walk through several points in turn (each must be a cell a body can stand in). */
function tourPath(grid, points) {
  const { stand } = gridFns(grid);
  for (const q of points) if (!stand(...q)) throw new Error(`the tour's point ${q} is not a cell to stand in`);
  const out = [];
  for (let i = 1; i < points.length; i++) out.push(...roomyPath(grid, points[i - 1], points[i]).slice(i === 1 ? 0 : 1));
  return out;
}
/**
 * Like walkPath, but the way a person walks a room: down the middle of the aisles. Each cell costs more the
 * more of its eight neighbours are furniture or wall, so the walk only squeezes past things where it must
 * (a doorway), and the smoothed line does not cut through a table's corner.
 */
function roomyPath(grid, from, to) {
  const { open, stand } = gridFns(grid);
  const key = (p) => p.join(',');
  const cost = (x, y, z) => {
    let c = 1;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if ((dx || dz) && !(open(x + dx, y, z + dz) && open(x + dx, y + 1, z + dz))) c += 2.5;
    return c;
  };
  const best = new Map([[key(from), 0]]);
  const prev = new Map([[key(from), null]]);
  const heap = [[0, from]]; // a small binary heap on the cost so far
  const push = (e) => { heap.push(e); for (let i = heap.length - 1; i > 0;) { const j = (i - 1) >> 1; if (heap[j][0] <= heap[i][0]) break; [heap[i], heap[j]] = [heap[j], heap[i]]; i = j; } };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[i], heap[m]] = [heap[m], heap[i]]; i = m; }
    }
    return top;
  };
  while (heap.length) {
    const [d, [x, y, z]] = pop();
    if (d > best.get(key([x, y, z]))) continue;
    if (x === to[0] && y === to[1] && z === to[2]) break;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      for (const dy of [0, -1, 1]) {
        const q = [x + dx, y + dy, z + dz];
        if (!stand(...q)) continue;
        if (dy === 1 && !open(x, y + 2, z)) continue;
        if (dy === -1 && !open(q[0], y + 1, q[2])) continue;
        const nd = d + cost(...q);
        if (nd < (best.get(key(q)) ?? Infinity)) { best.set(key(q), nd); prev.set(key(q), [x, y, z]); push([nd, q]); }
        break;
      }
    }
  }
  if (!prev.has(key(to))) throw new Error(`no walkable path from ${from} to ${to}`);
  const cells = [];
  for (let p = to; p; p = prev.get(key(p))) cells.push(p);
  return cells.reverse().map(([x, y, z]) => [x + 0.5, y, z + 0.5]);
}
function walkPath(grid, from, to) {
  const { open, stand } = gridFns(grid);
  const key = (p) => p.join(',');
  const prev = new Map([[key(from), null]]);
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    const [x, y, z] = queue[i];
    if (x === to[0] && y === to[1] && z === to[2]) break;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      for (const dy of [0, -1, 1]) {
        const q = [x + dx, y + dy, z + dz];
        if (prev.has(key(q)) || !stand(...q)) continue;
        if (dy === 1 && !open(x, y + 2, z)) continue; // head room for the step up
        if (dy === -1 && !open(q[0], y + 1, q[2])) continue; // and for the step down
        prev.set(key(q), [x, y, z]);
        queue.push(q);
        break;
      }
    }
  }
  if (!prev.has(key(to))) throw new Error(`no walkable path from ${from} to ${to}`);
  const cells = [];
  for (let p = to; p; p = prev.get(key(p))) cells.push(p);
  return cells.reverse().map(([x, y, z]) => [x + 0.5, y, z + 0.5]);
}
/** Smooth a polyline (moving average, ends kept) and index it by distance walked. */
function smoothPath(pts, passes = 6) {
  let p = pts.map((q) => [...q]);
  for (let k = 0; k < passes; k++) {
    p = p.map((q, i) => (i === 0 || i === p.length - 1 ? q : [0, 1, 2].map((a) => (p[i - 1][a] + 2 * q[a] + p[i + 1][a]) / 4)));
  }
  const dist = [0];
  for (let i = 1; i < p.length; i++) dist.push(dist[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1], p[i][2] - p[i - 1][2]));
  const at = (d) => {
    const dd = Math.max(0, Math.min(dist[dist.length - 1], d));
    let i = 1;
    while (i < p.length - 1 && dist[i] < dd) i++;
    const t = (dd - dist[i - 1]) / Math.max(1e-6, dist[i] - dist[i - 1]);
    return [0, 1, 2].map((a) => lerp(p[i - 1][a], p[i][a], t));
  };
  return { length: dist[dist.length - 1], at };
}

// ---------------------------------------------------------------- the clips
function clips(grids) {
  const seat = [OFFICE.spawn.x, OFFICE.spawn.y + 1.62, OFFICE.spawn.z];
  const oo = CELLAR.otherOffice.spawn;
  const otherSeat = [oo.x, oo.y + 1.62, oo.z];
  const desk = node('CEL_DESK');
  const visit = node(CELLAR.visit);
  // the walk through the cellar: from the Parts & Service door to the foot of the stage
  const walk = smoothPath(walkPath(grids.day, [60, 0, 64], [36, STAGE[1], 26]));
  const WALK_SPEED = 3.4; // blocks a second
  const walkTime = walk.length / WALK_SPEED;
  // the walk through the reworked pizzeria: in at the front doors, the lobby, a turn through the Game Room, the
  // showroom, up to the stage
  const tour = smoothPath(tourPath(grids.day_open, [[107, 0, 36], [96, 0, 35], [80, 0, 34], [72, 0, 46], [63, 0, 51], [57, 0, 40], [53, 0, 33], [47, 0, 24], [39, 0, 17]]), 10);
  const TOUR_SPEED = 3.6;
  const tourTime = tour.length / TOUR_SPEED;
  const BAND = [38.5, 3.1, 7.0]; // the middle of the band, at chest height
  return [
    {
      name: 'pizzeria_walkthrough', voxels: 'day_open', seconds: tourTime + 4.5,
      caption: 'Free Roam: in at the front doors, through the Entrance Hall and the Game Room, into the showroom and up to the stage',
      frame(t) {
        const d = Math.min(tour.length, t * TOUR_SPEED);
        const p = tour.at(d);
        const ahead = tour.at(d + 5.0);
        const eye = [p[0], p[1] + 1.62, p[2]];
        // at the end of the walk the eyes come up to the band
        const arrive = ease((t - tourTime + 2.0) / 3.0);
        const target = [0, 1, 2].map((a) => lerp([ahead[0], ahead[1] + 1.5, ahead[2]][a], BAND[a], arrive));
        const outside = p[0] > 99.5;
        return {
          time: 'day', camera: { pos: eye, target, fov: 74 }, exposure: outside ? 1.0 : 1.25,
          entities: [castAt('rustgrin', 'ST_R', 'perform_1', t + 0.8), castAt('mirehop', 'ST_M', 'perform_1', t + 0.4), castAt('noxbriar', 'ST_N', 'perform_2', t + 1.1)],
          extra_lights: [
            ambient('#fff4e0', outside ? 0.5 : 0.9), point([eye[0], eye[1] + 1.2, eye[2]], '#ffe7c0', outside ? 0 : 6, 12),
            spot([38.5, 6.4, 13.5], [38.5, 1.6, 6.0], '#ffdcae', 240), spot([32.5, 6.4, 13.5], [32.5, 1.6, 7.0], '#ffc2d6', 180), spot([44.5, 6.4, 13.5], [44.5, 1.6, 7.0], '#c6d6ff', 180),
          ],
        };
      },
    },
    {
      name: 'golden_dog_turntable', voxels: 'night', seconds: 8,
      caption: 'The Golden Dog on his stage in the cellar, under the ghost light',
      frame(t) {
        const a = lerp(-1.15, 1.15, ease(t / 8)); // radians either side of straight in front of him (south)
        const r = lerp(7.4, 6.2, Math.sin((Math.PI * t) / 8));
        const c = [STAGE[0], STAGE[1] + 2.0, STAGE[2]];
        return {
          camera: { pos: [c[0] + r * Math.sin(a), c[1] + 0.4, c[2] + r * Math.cos(a)], target: c, fov: 52 }, exposure: 1.8, fog: { density: 0.02 },
          entities: [dogAt(STAGE, 0, 'idle', t)],
          extra_lights: [ambient('#0c1018', 0.7), point(GHOST, '#ffd08a', 26, 13)],
        };
      },
    },
    {
      name: 'golden_dog_walk', voxels: 'night', seconds: 10.5,
      caption: 'The Other Office: he walks while you watch him. Watch him all the way to the desk and he takes you',
      frame(t) {
        const lights = [ambient('#1c2434', 7), point(GHOST, '#ffd08a', 34, 14), point([otherSeat[0], otherSeat[1] + 1.6, otherSeat[2] + 0.5], '#c8b890', 1.4, 7)];
        const T_WALK = 8.4; // seconds from the hall's mouth to the desk
        if (t < T_WALK) {
          // he comes down the hall towards the desk (the game moves him 3.2 blocks a second while he is watched)
          const z = lerp(desk[2] - 3.2 * T_WALK, desk[2], t / T_WALK);
          return {
            camera: { pos: otherSeat, target: [otherSeat[0], otherSeat[1] + 0.25, 49.0], fov: 50 }, exposure: 2.2, fog: { density: 0.004 },
            entities: [dogAt([desk[0], desk[1], z], 0, 'walk', t, { eyeIntensity: 18 })],
            extra_lights: [...lights, point([desk[0], desk[1] + 4.2, z + 0.6], '#fff0d0', 5, 8)],
          };
        }
        // and takes you: he is over the desk, in your face (framed as the game frames a jumpscare)
        const j = t - T_WALK;
        const shot = jumpscareShot(otherSeat, -1);
        return {
          camera: { pos: shot.cam, target: shot.target, fov: 66 }, exposure: 2.0,
          entities: [dogAt(shot.pos, 0, 'jumpscare', Math.min(j, JUMPSCARE - 0.01), { eyeIntensity: 7 })],
          extra_lights: [...lights, point([shot.cam[0], shot.cam[1] + 0.9, shot.cam[2] - 0.2], '#fff0d0', 3.5, 6)],
        };
      },
    },
    {
      name: 'golden_dog_visit', voxels: 'night', seconds: 9,
      caption: 'The visit: he is standing in the office behind you. Do not turn around',
      frame(t) {
        // the guard sits facing the desk (north), then turns round
        const turn = ease((t - 1.5) / 3.2) * Math.PI; // 0 = north, pi = south
        const lookAt = [seat[0] + 6 * Math.sin(turn), seat[1] + lerp(-0.1, 0.9, ease((t - 1.5) / 3.2)), seat[2] - 6 * Math.cos(turn)];
        const lights = [ambient('#141a26', 3.2), point([36.5, 3.6, 62.0], '#9fb3ff', 0.9, 7)];
        if (t < 6.6) {
          return {
            camera: { pos: seat, target: lookAt, fov: 70 }, exposure: 1.6,
            entities: [dogAt(visit, 180, 'idle', t, { eyeIntensity: 20 })],
            extra_lights: [...lights, point([visit[0], visit[1] + 3.9, visit[2] - 0.8], '#fff0d0', 1.6, 6)],
          };
        }
        const j = t - 6.6;
        const shot = jumpscareShot(seat, 1);
        return {
          camera: { pos: shot.cam, target: shot.target, fov: 66 }, exposure: 1.9,
          entities: [dogAt(shot.pos, 180, 'jumpscare', Math.min(j, JUMPSCARE - 0.01), { eyeIntensity: 7 })],
          extra_lights: [...lights, point([shot.cam[0], shot.cam[1] + 0.9, shot.cam[2] + 0.2], '#fff0d0', 3.5, 6)],
        };
      },
    },
    {
      name: 'cellar_walkthrough', voxels: 'day', seconds: walkTime + 4,
      caption: 'Free Roam: down the stairs in Parts & Service and through the cellar to the Gold Room',
      frame(t) {
        const d = Math.min(walk.length, t * WALK_SPEED);
        const p = walk.at(d);
        const ahead = walk.at(d + 4.0);
        const eye = [p[0], p[1] + 1.62, p[2]];
        // at the end of the walk the eyes come up to him on his stage
        const arrive = ease((t - walkTime + 1.5) / 2.5);
        const target = [0, 1, 2].map((a) => lerp([ahead[0], ahead[1] + 1.45, ahead[2]][a], [STAGE[0], STAGE[1] + 2.3, STAGE[2]][a], arrive));
        // his head follows whoever looks at him
        const yawTo = (Math.atan2(-(eye[0] - STAGE[0]), eye[2] - STAGE[2]) * 180) / Math.PI;
        const below = p[1] < -1;
        return {
          camera: { pos: eye, target, fov: 74 }, exposure: below ? 2.3 : 1.25, fog: below ? { density: 0.012 } : undefined,
          entities: [dogAt(STAGE, 0, 'idle', t, { eyes: below, headYaw: -Math.max(-55, Math.min(55, yawTo)), eyeIntensity: 9 })],
          extra_lights: below
            ? [ambient('#3a3020', 1.3), point(GHOST, '#ffd08a', 16, 14), point([eye[0], eye[1] + 0.3, eye[2]], '#ffe2b0', 4.5, 9)]
            : [ambient('#ffffff', 1.0), point([eye[0], eye[1] + 1.2, eye[2]], '#ffe7c0', 6, 12)],
        };
      },
    },
  ];
}

async function main() {
  const snaps = {};
  const grids = {};
  fs.mkdirSync(CACHE, { recursive: true });
  for (const key of Object.keys(VARIANTS)) {
    const { snapshot, grid } = buildVoxels(1991, VARIANTS[key]);
    snaps[key] = path.join(CACHE, `${key}.json`);
    grids[key] = grid;
    fs.writeFileSync(snaps[key], JSON.stringify(snapshot));
  }
  const all = clips(grids).filter((c) => !ONLY || ONLY.includes(c.name));
  fs.mkdirSync(OUT, { recursive: true });
  for (const c of all) {
    const n = Math.round(c.seconds * FPS);
    const dir = path.join(CACHE, c.name);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const frames = TEST ? [0, Math.floor(n / 2), n - 1] : Array.from({ length: n }, (_, i) => i);
    const jobs = frames.map((i) => ({
      scene: { width: W, height: H, style: 'vibrant', ...c.frame(i / FPS), voxels: snaps[c.voxels] },
      out: path.join(dir, TEST ? `test_${String(i).padStart(4, '0')}.png` : `f_${String(i).padStart(4, '0')}.png`),
    }));
    const t0 = Date.now();
    // in batches, so a long clip does not hold every frame's scene in the page at once
    for (let i = 0; i < jobs.length; i += 30) await renderWorld(jobs.slice(i, i + 30), { quiet: true });
    console.log(`${c.name}: ${frames.length} frame(s) of ${n} in ${((Date.now() - t0) / 1000).toFixed(0)} s (${c.seconds.toFixed(1)} s at ${FPS} fps)`);
    if (TEST) continue;
    const mp4 = path.join(OUT, `${c.name}.mp4`);
    const ff = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(dir, 'f_%04d.png'), '-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-crf', '21', '-preset', 'slow', '-movflags', '+faststart', mp4], { stdio: 'inherit' });
    if (ff.status !== 0) throw new Error(`ffmpeg failed for ${c.name}`);
    console.log(`  -> ${path.relative(ROOT, mp4)} (${(fs.statSync(mp4).size / 1e6).toFixed(1)} MB)`);
  }
  fs.writeFileSync(path.join(OUT, 'README.md'), `# Preview videos\n\nRendered by \`tools/previews/make_videos.mjs\` from the real build plan and models (not recorded in the game).\n\n${clips(grids).map((c) => `- \`${c.name}.mp4\`: ${c.caption}`).join('\n')}\n`);
}

await main();

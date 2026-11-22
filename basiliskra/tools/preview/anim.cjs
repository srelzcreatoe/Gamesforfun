#!/usr/bin/env node
// An animation reel: every form played through its phases in the offline viewer, from the shipped geometry,
// textures, client entity and pose animations, with the pack's own sounds laid in where the script would play
// them.  Nothing here is the game: the ground, the scale figure, the camera and the drawn beam are this tool's.
//   node anim.cjs [--forms i,ii,iii,iv] [--size 1280x720] [--fps 30] [--out previews/animations.mp4] [--only seconds]
const { open, ROOT, arg } = require('./render.cjs');
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const POSE = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/kit/out/pose.json'), 'utf8'));
const PH = POSE.phase, SCALE = POSE.scale, KNOCK = POSE.knock_gap;
const SOUNDS = JSON.parse(fs.readFileSync(path.join(ROOT, 'packs/RP/sounds/sound_definitions.json'), 'utf8')).sound_definitions;
const CLIENT = {
  entity: '/packs/RP/entity/basiliskra.entity.json',
  animations: ['/packs/RP/animations/basiliskra.animation.json'],
  controllers: ['/packs/RP/animation_controllers/basiliskra.animation_controllers.json'],
  renderControllers: ['/packs/RP/render_controllers/basiliskra.render_controllers.json'],
};
const ROMAN = { i: 'I', ii: 'II', iii: 'III', iv: 'IV' };
const lerp = (a, b, u) => a + (b - a) * u;

// ---- what each form is shown doing ---------------------------------------------------------------------------
// A segment: seconds, a label, the phase the script would set, and optionally: speed (blocks a second), charge
// (a number or [from, to]), look [yaw, pitch], bend, night, beam, the camera (yaw may be [from, to]; 0 is his
// left side, 90 in front of him), and things that happen at a moment within it: {at, sound, pitch, vol} and {at, fx}.
const CAM = (yaw, pitch = 8, dist = 1.0, at = 0.5) => ({ yaw, pitch, dist, at });
const knocks = (id, t0 = 0.08) => [0, 1, 2].map((k) => ({ at: t0 + k * KNOCK, sound: id, vol: 0.9 }));
const REEL = {
  i: [
    { t: 5, label: 'Swimming', phase: 'move', speed: 3.2, cam: CAM([20, 70], 14, 1.0), sounds: [{ at: 0.3, sound: 'basiliskra.i.swim', vol: 0.6 }] },
    { t: 3.2, label: 'Three knocks on the gills, 0.9 seconds apart', phase: 'knock', gill: 1, cam: CAM([70, 50], 10, 0.8), sounds: knocks('basiliskra.knock.gill') },
    { t: 2.2, label: 'The bite', phase: 'bite', cam: CAM(60, 6, 0.75), sounds: [{ at: 0.1, sound: 'basiliskra.i.bite' }] },
    { t: 3.5, label: 'A spasm runs down his spine (what moves him toward his next form)', phase: 'spasm', cam: CAM([30, -10], 16, 1.0), sounds: [{ at: 0.1, sound: 'basiliskra.i.spasm' }] },
    { t: 9.3, label: 'His voice, through the water: the jaw follows the recording', phase: 'idle', cam: CAM([75, 55], 6, 0.7), fx: [{ at: 0.2, kind: 10 }], sounds: [{ at: 0.2, sound: 'basiliskra.roar_under' }] },
  ],
  ii: [
    { t: 3, label: 'On the shore', phase: 'idle', cam: CAM([30, 60], 10, 1.0) },
    { t: 10.7, label: 'He drags himself: reach, pull, rest', phase: 'move', drag: true, cam: CAM([10, 40], 12, 1.05) },
    { t: 3, label: 'Lightning between the horns', phase: 'arc', cam: CAM([60, 80], 8, 0.8), fx: [{ at: 0.1, kind: 2 }, { at: 0.7, kind: 2 }, { at: 1.35, kind: 2 }],
      sounds: [{ at: 0.1, sound: 'basiliskra.ii.arc' }, { at: 0.7, sound: 'basiliskra.ii.arc' }, { at: 1.35, sound: 'basiliskra.ii.arc' }] },
    { t: 4.2, label: 'The same roar, younger: played 1.18 times as fast, and the jaw with it', phase: 'roar', cam: CAM([70, 50], 6, 0.75), fx: [{ at: 0.1, kind: 9 }],
      sounds: [{ at: 0.1, sound: 'basiliskra.roar_short', pitch: 1.18 }] },
  ],
  iii: [
    { t: 3, label: 'Standing', phase: 'idle', cam: CAM([35, 60], 9, 1.0) },
    { t: 9, label: 'Four footfalls: each foot stays where it is planted', phase: 'move', speed: 2.7, steps: 'basiliskra.iii.step', cam: CAM([0, 40], 10, 1.05, 0.35) },
    { t: 2.6, label: 'A growl', phase: 'idle', cam: CAM(65, 6, 0.6, 0.6), fx: [{ at: 0.3, kind: 5 }], sounds: [{ at: 0.3, sound: 'basiliskra.iii.growl' }] },
    { t: 6.86, label: 'The charge lasts exactly as long as its sound: the plates light from tail to head', phase: 'charge', charge: [0, 18], night: true, cam: CAM([330, 20], 12, 1.05),
      sounds: [{ at: 0, sound: 'basiliskra.iii.club_plant' }, { at: 0, sound: 'basiliskra.iii.charge' }] },
    { t: 5.5, label: 'The breath (the beam here is drawn by the preview tool)', phase: 'fire', charge: 20, night: true, beam: true, cam: CAM([20, 60], 8, 1.1), sounds: [{ at: 0, sound: 'basiliskra.iii.beam', cut: 5.5 }] },
    { t: 3, label: 'He vents through the old gills: the same three knocks', phase: 'vent', charge: [8, 0], night: true, cam: CAM([60, 75], 6, 0.7, 0.6), sounds: knocks('basiliskra.knock.vent') },
    { t: 4.6, label: 'The roar after the breath', phase: 'roar', cam: CAM([75, 50], 5, 0.8, 0.55), fx: [{ at: 0.1, kind: 9 }], sounds: [{ at: 0.1, sound: 'basiliskra.roar_short' }] },
  ],
  iv: [
    { t: 4, label: 'Standing, wings folded', phase: 'idle', cam: CAM([30, 75], 8, 1.0) },
    { t: 10, label: 'Two feet: left, right, each planted where it lands', phase: 'move', speed: 3.2, steps: 'basiliskra.iii.step', stepPitch: 0.68, cam: CAM([0, 50], 9, 1.05, 0.4) },
    { t: 3.5, label: 'The stare', phase: 'stare', look: [25, 18], cam: CAM([80, 70], 4, 0.75, 0.62), sounds: [{ at: 0.1, sound: 'basiliskra.iii.neck_turn' }, { at: 1.6, sound: 'basiliskra.iii.growl', pitch: 0.8 }], fx: [{ at: 1.6, kind: 5 }] },
    { t: 6.86, label: 'The charge: the club goes into the ground, the plates light', phase: 'charge', charge: [0, 18], night: true, cam: CAM([330, 25], 10, 1.05),
      sounds: [{ at: 0, sound: 'basiliskra.iii.club_plant' }, { at: 0, sound: 'basiliskra.iii.charge' }] },
    { t: 1.5, label: 'The breath', phase: 'fire', charge: 20, night: true, beam: true, cam: CAM([25, 35], 8, 1.15), sounds: [{ at: 0, sound: 'basiliskra.iii.beam', cut: 6.5 }] },
    { t: 1.25, label: 'It shoves him back on his heels', phase: 'skid', charge: 20, night: true, beam: true, skid: 1.75, cam: CAM([35, 40], 8, 1.15) },
    { t: 1.2, label: 'The club is planted and one foot lifts: that is the side he will swing to', phase: 'pivot', charge: 20, bend: 30, night: true, beam: true, held: 1.75, cam: CAM([40, 50], 9, 1.15),
      sounds: [{ at: 0, sound: 'basiliskra.iii.club_plant', pitch: 0.8 }] },
    { t: 2.5, label: 'His whole body swings round the buried club', phase: 'pivot', charge: 20, bend: 30, night: true, beam: true, held: 1.75, swing: 70, cam: CAM(50, 22, 2.0, 0.3) },
    { t: 3, label: 'He vents', phase: 'vent', charge: [8, 0], night: true, cam: CAM([60, 75], 6, 0.8, 0.6), sounds: knocks('basiliskra.knock.vent') },
    { t: 8, label: 'The roar: wings open, the jaw follows the loudness of the recording', phase: 'roar', cam: CAM([80, 40], 6, 1.25, 0.5), fx: [{ at: 0.1, kind: 8 }], sounds: [{ at: 0.1, sound: 'basiliskra.roar', cut: 8 }] },
    { t: 5, label: 'The shot that fails: the wings take the recoil, the veins light', phase: 'recoil', charge: [8, 0], night: true, cam: CAM([110, 60], 10, 1.3, 0.5), sounds: [{ at: 0, sound: 'basiliskra.iii.fizzle' }] },
    { t: 2, label: 'He shuts his mouth on a charge', phase: 'swallow', charge: [16, 0], night: true, cam: CAM([75, 60], 6, 0.8, 0.6), sounds: [{ at: 0, sound: 'basiliskra.iii.fizzle', pitch: 0.7 }] },
    { t: 8, label: 'And carries it: one flank lit, a pulse up the neck every few seconds', phase: 'carry', charge: 0, night: true, speed: 3.4, steps: 'basiliskra.iii.step', stepPitch: 0.68, cam: CAM([15, 55], 8, 0.95, 0.5),
      fx: [{ at: 2.5, kind: 11 }, { at: 5.5, kind: 11 }], sounds: [{ at: 2.5, sound: 'basiliskra.knock.vent', pitch: 0.9 }, { at: 5.5, sound: 'basiliskra.knock.vent', pitch: 1.0 }] },
    { t: 6.5, label: 'Reaching for the seabed, and hauling it in', phase: 'drag', cam: CAM([8, 28], 7, 1.0, 0.4), sounds: [{ at: 0.2, sound: 'basiliskra.iii.growl', pitch: 0.74 }, { at: 4.2, sound: 'basiliskra.roar_short', cut: 2.3 }] },
  ],
};
const STRIDE = { iii: POSE.stride_iii / 4, iv: 7 }, BEATS = { iii: 4, iv: 2 };

async function main() {
  const args = process.argv.slice(2);
  const forms = arg(args, 'forms', 'i,ii,iii,iv').split(',');
  const [W, H] = arg(args, 'size', '1280x720').split('x').map(Number);
  const fps = parseFloat(arg(args, 'fps', '30')), dt = 1 / fps;
  const only = parseFloat(arg(args, 'only', '0'));
  const out = path.resolve(ROOT, arg(args, 'out', 'previews/animations.mp4'));
  const work = path.join(ROOT, 'build/previews');
  fs.mkdirSync(work, { recursive: true });
  const silent = path.join(work, 'animations_silent.mp4');
  const s = await open();
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', silent], { stdio: ['pipe', 'inherit', 'inherit'] });
  const encoded = new Promise((res, rej) => ff.on('close', (c) => (c === 0 ? res() : rej(new Error('ffmpeg exit ' + c)))));
  const audio = [];                 // {at (s, in the whole reel), file, pitch, vol, cut}
  let clock = 0, frames = 0;
  const started = Date.now();
  const file = (id, n = 0) => { const list = SOUNDS[id].sounds; const e = list[n % list.length]; return path.join(ROOT, 'packs/RP', (typeof e === 'string' ? e : e.name) + '.ogg'); };

  for (const key of forms) {
    const scale = SCALE[key];
    // ---- the stage for this form: him, a chequered ground that moves under him, a figure for scale ----
    const info = await s.page.evaluate(async ({ key, scale, files, client }) => {
      const BK = window.BK, THREE = BK.THREE;
      for (const m of Object.values(BK.models)) m.holder.visible = false;
      if (BK.reel) { BK.scene.remove(BK.reel.ground, BK.reel.dummy, BK.reel.beam); }
      await BK.loadForm(key, files);
      await BK.makeAnimator(key, client);
      const m = BK.models[key];
      m.holder.scale.setScalar(scale);
      m.holder.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(m.holder);
      // ground: 4-block tiles, so that a planted foot can be seen to stay on its tile
      const cv = document.createElement('canvas'); cv.width = cv.height = 64;
      const g = cv.getContext('2d');
      for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) { g.fillStyle = (i + j) % 2 ? '#7b8c6c' : '#566649'; g.fillRect(i * 32, j * 32, 32, 32); }
      g.strokeStyle = 'rgba(0,0,0,0.25)'; g.strokeRect(0.5, 0.5, 31, 31); g.strokeRect(32.5, 32.5, 31, 31);
      const tex = new THREE.CanvasTexture(cv); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.magFilter = THREE.NearestFilter;
      const SIZE = 960, TILE = key === 'iv' ? 8 : 4; tex.repeat.set(SIZE / (2 * TILE), SIZE / (2 * TILE));
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE), new THREE.MeshBasicMaterial({ map: tex }));
      ground.rotation.x = -Math.PI / 2; ground.position.y = key === 'i' ? -3 : 0;
      const dummy = BK.Stage.playerDummy();
      dummy.position.set(box.min.x - 2.5, key === 'i' ? -3 : 0, box.min.z + 2);
      const beam = new THREE.Group();
      const mk = (r, c, o) => new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1, 12, 1, true), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      beam.add(mk(0.5, 0xfff0e0, 0.95), mk(1.1, 0xff2a1a, 0.55), mk(2.3, 0xe01410, 0.22));
      beam.visible = false;
      BK.scene.add(ground, dummy, beam);
      BK.reel = { key, m, ground, dummy, beam, tex, world: 2 * TILE, overlay: document.createElement('canvas'), seq: 0, sea: key === 'i' };
      const a = m.animator;
      for (const [k, v] of Object.entries({ form: { i: 1, ii: 2, iii: 3, iv: 4 }[key], bound: true, phase: 0, charge: 0, look_yaw: 0, look_pitch: 0, bend: 0, pitch: 0, gait: key === 'iii' ? 3 : key === 'iv' ? 1 : 2,
        gill: false, fx_kind: 0, fx_seq: 0, tier: 3, vis_lo: 0, vis_hi: 8 })) a.setProperty('basiliskra:' + k, v);
      for (let i = 0; i < 20; i++) a.update(1 / 30);
      return { min: box.min.toArray(), max: box.max.toArray(), missing: [...a.missing] };
    }, { key, scale, files: { geo: `/packs/RP/models/entity/basiliskra_${key}.geo.json`, tex: `/packs/RP/textures/entity/basiliskra/basiliskra_${key}.png`, glow: `/packs/RP/textures/entity/basiliskra/basiliskra_${key}_glow.png` }, client: CLIENT });
    if (info.missing.length) console.error(key, 'missing bones:', info.missing);
    const size = Math.max(info.max[0] - info.min[0], info.max[1] - info.min[1], (info.max[2] - info.min[2]) * 0.75);
    const height = info.max[1] - info.min[1];
    let distance = 0, landed = 0, gait = key === 'iii' ? 3 : key === 'iv' ? 1 : 2, seq = 0, kind = 0, stepN = 0;
    let dragT = 0;                                           // Form II: where he is in reach / pull / rest
    for (const seg of REEL[key]) {
      const n = Math.round(seg.t * fps);
      const t0 = clock;
      for (const e of seg.sounds || []) audio.push({ at: t0 + e.at, file: file(e.sound, audio.length), pitch: e.pitch ?? 1, vol: e.vol ?? 1, cut: e.cut });
      const fx = (seg.fx || []).map((e) => ({ ...e, done: false }));
      for (let f = 0; f < n; f++) {
        const u = f / Math.max(1, n - 1), ts = f * dt;
        let speed = seg.speed || 0;
        if (seg.drag) {
          // Basiliskra II: the script moves him only while he pulls, and names each part of the cycle
          const [reach, pull, rest] = POSE.gait_dur, cyc = reach + pull + rest;
          dragT += dt;
          const side = Math.floor(dragT / cyc) % 2, w = dragT % cyc;
          const part = w < reach ? 0 : w < reach + pull ? 1 : 2;
          if (part === 1 && gait !== side * 3 + 1) audio.push({ at: clock, file: file('basiliskra.ii.drag', side), pitch: 1, vol: 0.9 });
          gait = side * 3 + part;
          speed = part === 1 ? 1.7 : 0;
        }
        distance += speed * dt;
        if (STRIDE[key] && speed > 0 && distance >= (landed + 1) * STRIDE[key]) {
          landed++; gait = (gait + 1) % BEATS[key];
          if (seg.steps) audio.push({ at: clock, file: file(seg.steps, stepN++), pitch: seg.stepPitch ?? 0.9, vol: 0.8 });
        }
        for (const e of fx) if (!e.done && ts >= e.at) { e.done = true; kind = e.kind; seq = (seq + 1) & 15; }
        const val = (v, d = 0) => (v == null ? d : Array.isArray(v) ? lerp(v[0], v[1], u) : v);
        const cam = seg.cam, yaw = val(cam.yaw);
        const frame = {
          dt, w: W, h: H,
          props: { phase: PH[seg.phase], charge: Math.round(val(seg.charge)), look_yaw: seg.look ? seg.look[0] : 0, look_pitch: seg.look ? seg.look[1] : 0, bend: seg.bend || 0, gait, gill: !!seg.gill, fx_kind: kind, fx_seq: seq },
          distance, speed: speed / 20,
          night: !!seg.night, beam: !!seg.beam,
          back: seg.skid ? seg.skid * u : seg.held || 0, swing: seg.swing ? seg.swing * (u * u * (3 - 2 * u)) : 0,
          cam: { yaw, pitch: cam.pitch, dist: size * 1.45 * cam.dist, at: height * cam.at },
          title: `Basiliskra ${ROMAN[key]}`, label: seg.label,
        };
        const url = await s.page.evaluate((F) => {
          const BK = window.BK, THREE = BK.THREE, R = BK.reel, m = R.m, a = m.animator;
          for (const [k, v] of Object.entries(F.props)) a.setProperty('basiliskra:' + k, v);
          a.state.distance = F.distance; a.state.speed = F.speed;
          a.update(F.dt);
          // he stays where he is and the ground goes by under him; a skid moves him back; the pivot turns him about his club
          R.tex.offset.y = F.distance / R.world;
          const scale = m.holder.scale.x;
          m.holder.rotation.y = 0; m.holder.position.set(0, R.sea ? 0 : 0, F.back);
          if (F.swing) {
            m.holder.updateMatrixWorld(true);
            const club = m.locators.get('club_core_' + R.key).getWorldPosition(new THREE.Vector3());
            const th = F.swing * Math.PI / 180, rx = -club.x, rz = F.back - club.z;
            m.holder.rotation.y = th;
            m.holder.position.set(club.x + rx * Math.cos(th) + rz * Math.sin(th), 0, club.z - rx * Math.sin(th) + rz * Math.cos(th));
          }
          m.holder.updateMatrixWorld(true);
          R.beam.visible = false;
          if (F.beam) {
            const L = (n) => m.locators.get(n + '_' + R.key).getWorldPosition(new THREE.Vector3());
            const from = L('mouth'), dir = L('muzzle').sub(L('throat')).normalize();
            const len = 260;
            R.beam.position.copy(from).addScaledVector(dir, len / 2);
            R.beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
            const w = scale * (0.9 + 0.12 * Math.sin(a.time * 40));
            R.beam.scale.set(w, len, w);
            R.beam.visible = true;
          }
          if (F.night) { BK.env.uLight.value.set(0.30, 0.34, 0.5); BK.env.uAmbient.value.set(0.16, 0.17, 0.25); R.ground.material.color.set(0x556070); }
          else { BK.env.uLight.value.set(1, 1, 1); BK.env.uAmbient.value.set(0.42, 0.42, 0.44); R.ground.material.color.set(0xffffff); }
          const rdr = BK.renderer;
          rdr.setSize(F.w, F.h, false);
          rdr.setClearColor(new THREE.Color(F.night ? '#0b1020' : R.sea ? '#3d6f93' : '#9db7e6'), 1);
          const c = new THREE.PerspectiveCamera(34, F.w / F.h, 0.05, 3000);
          const y = F.cam.yaw * Math.PI / 180, p = F.cam.pitch * Math.PI / 180;
          const t = new THREE.Vector3(0, F.cam.at, F.back * 0.5);
          c.position.set(t.x - Math.cos(y) * Math.cos(p) * F.cam.dist, t.y + Math.sin(p) * F.cam.dist, t.z - Math.sin(y) * Math.cos(p) * F.cam.dist);
          c.lookAt(t);
          rdr.render(BK.scene, c);
          const o = R.overlay; o.width = F.w; o.height = F.h;
          const g = o.getContext('2d'), s = F.h / 720;
          g.drawImage(rdr.domElement, 0, 0, F.w, F.h);
          g.textBaseline = 'alphabetic';
          g.font = `600 ${Math.round(34 * s)}px Georgia, 'DejaVu Serif', serif`;
          g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillText(F.title, 42 * s + 2, 64 * s + 2);
          g.fillStyle = '#f2ece4'; g.fillText(F.title, 42 * s, 64 * s);
          g.font = `600 ${Math.round(21 * s)}px 'DejaVu Sans', sans-serif`;
          g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillText(F.label, 42 * s + 1, F.h - 44 * s + 1);
          g.fillStyle = '#f2ece4'; g.fillText(F.label, 42 * s, F.h - 44 * s);
          g.font = `${Math.round(12.5 * s)}px 'DejaVu Sans', sans-serif`;
          g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(0, F.h - 24 * s, F.w, 24 * s);
          g.fillStyle = 'rgba(255,255,255,0.78)';
          g.fillText('Offline reference render of the shipped model, textures and client animation; ground, camera, scale figure and beam are the preview tool\'s. Not in-game capture.', 12 * s, F.h - 8 * s);
          return o.toDataURL('image/jpeg', 0.92);
        }, frame);
        if (!ff.stdin.write(Buffer.from(url.split(',')[1], 'base64'))) await new Promise((res) => ff.stdin.once('drain', res));
        clock += dt; frames++;
        if (frames % 300 === 0) console.log(`${frames} frames, ${(frames / ((Date.now() - started) / 1000)).toFixed(1)} fps, at ${clock.toFixed(0)} s (Basiliskra ${ROMAN[key]})`);
        if (only && clock >= only) break;
      }
      if (only && clock >= only) break;
    }
    if (only && clock >= only) break;
  }
  ff.stdin.end();
  await encoded;
  await s.close();
  // ---- the sound: each recording laid in where the script would have played it ----
  const live = audio.filter((a) => a.at < clock - 0.05 && fs.existsSync(a.file));
  const inputs = [], filters = [];
  live.forEach((a, i) => {
    inputs.push('-i', a.file);
    const chain = [];
    if (a.pitch !== 1) chain.push(`asetrate=44100*${a.pitch}`, 'aresample=44100');
    else chain.push('aresample=44100');
    chain.push('aformat=channel_layouts=stereo');
    if (a.cut) chain.push(`atrim=0:${a.cut}`, `afade=t=out:st=${Math.max(0, a.cut - 0.4)}:d=0.4`);
    chain.push(`volume=${a.vol}`, `adelay=${Math.round(a.at * 1000)}:all=1`);
    filters.push(`[${i + 1}:a]${chain.join(',')}[a${i}]`);
  });
  if (!live.length) { inputs.push('-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo'); filters.push('[1:a]anull[mix]'); }
  else filters.push(`${live.map((_, i) => `[a${i}]`).join('')}amix=inputs=${live.length}:normalize=0:dropout_transition=0,alimiter=limit=0.95,apad[mix]`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', silent, ...inputs, '-filter_complex', filters.join(';'), '-map', '0:v', '-map', '[mix]',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-shortest', '-movflags', '+faststart', out], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('ffmpeg (sound) exit ' + r.status);
  console.log(`${out}: ${frames} frames, ${clock.toFixed(1)} s, ${live.length} sounds, ${(fs.statSync(out).size / 1e6).toFixed(1)} MB, rendered in ${((Date.now() - started) / 1000).toFixed(0)} s`);
}
main().catch((e) => { console.error(e); process.exit(1); });

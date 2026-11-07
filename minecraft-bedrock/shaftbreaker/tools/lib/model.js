// Build a three.js scene graph from a Bedrock .geo.json exactly the way
// Blockbench (and the game) interpret it.
//
// Coordinate conversion (verified against vanilla zombie/creaking rigs):
//   Bedrock FILE space has the entity facing -Z, its RIGHT side on -X.
//   Render space (three.js) = file space mirrored on X:  x_r = -x_f
//   Cube origin:  from_r.x = -(origin.x + size.x)
//   Rotations:    three Euler (-rx, -ry, +rz) in radians, order 'ZYX'
//   Animation rotation offsets are added to the rest rotation the same way;
//   animation position offsets map to (-px, +py, +pz).
// Per-face UV: Bedrock {uv, uv_size}; up/down faces are flipped on both axes
// relative to the side faces (Blockbench codec behaviour).
import { sampleAnimation, combineLayers } from './anim.js';

const DEG = Math.PI / 180;

// Vertex order per face: TL, TR, BL, BR as seen from OUTSIDE the cube.
const FACE_CORNERS = {
  north: { n: [0, 0, -1], c: [[1, 1, 0], [0, 1, 0], [1, 0, 0], [0, 0, 0]] },
  south: { n: [0, 0, 1], c: [[0, 1, 1], [1, 1, 1], [0, 0, 1], [1, 0, 1]] },
  east: { n: [1, 0, 0], c: [[1, 1, 1], [1, 1, 0], [1, 0, 1], [1, 0, 0]] },
  west: { n: [-1, 0, 0], c: [[0, 1, 0], [0, 1, 1], [0, 0, 0], [0, 0, 1]] },
  up: { n: [0, 1, 0], c: [[0, 1, 0], [1, 1, 0], [0, 1, 1], [1, 1, 1]] },
  down: { n: [0, -1, 0], c: [[0, 0, 1], [1, 0, 1], [0, 0, 0], [1, 0, 0]] },
};
const FACES = Object.keys(FACE_CORNERS);

// Blockbench-style rects [x1, y1, x2, y2] in declared texture units.
export function faceRects(cube) {
  const [w, h, d] = cube.size;
  const rects = {};
  if (Array.isArray(cube.uv)) {
    const [u, v] = cube.uv;
    rects.east = [u, v + d, u + d, v + d + h];
    rects.north = [u + d, v + d, u + d + w, v + d + h];
    rects.west = [u + d + w, v + d, u + 2 * d + w, v + d + h];
    rects.south = [u + 2 * d + w, v + d, u + 2 * d + 2 * w, v + d + h];
    rects.up = [u + d + w, v + d, u + d, v];
    rects.down = [u + d + 2 * w, v, u + d + w, v + d];
    if (cube.mirror) {
      for (const f of FACES) { const r = rects[f]; rects[f] = [r[2], r[1], r[0], r[3]]; }
      [rects.east, rects.west] = [rects.west, rects.east];
    }
  } else if (cube.uv && typeof cube.uv === 'object') {
    for (const f of FACES) {
      const fu = cube.uv[f];
      if (!fu) continue;
      const [u, v] = fu.uv;
      const [sw, sh] = fu.uv_size || [0, 0];
      rects[f] = f === 'up' || f === 'down' ? [u + sw, v + sh, u, v] : [u, v, u + sw, v + sh];
      if (fu.uv_rotation) rects[f].rotation = fu.uv_rotation;
    }
  }
  return rects;
}

function cubeGeometry(THREE, cube, texW, texH) {
  const inflate = cube.inflate || 0;
  const [sx, sy, sz] = cube.size;
  const from = [-(cube.origin[0] + sx) - inflate, cube.origin[1] - inflate, cube.origin[2] - inflate];
  const size = [sx + 2 * inflate, sy + 2 * inflate, sz + 2 * inflate];
  const rects = faceRects(cube);
  const pos = [], nor = [], uv = [], idx = [];
  for (const f of FACES) {
    const r = rects[f];
    if (!r) continue;
    const fc = FACE_CORNERS[f];
    const base = pos.length / 3;
    let uvs = [[r[0], r[1]], [r[2], r[1]], [r[0], r[3]], [r[2], r[3]]];
    if (r.rotation) {
      // rotate the UV corner assignment clockwise by uv_rotation degrees
      const order = [0, 1, 3, 2];
      const steps = ((r.rotation / 90) % 4 + 4) % 4;
      const ring = order.map((i) => uvs[i]);
      const rot = ring.map((_, i) => ring[(i - steps + 4) % 4]);
      const out = [];
      order.forEach((vi, i) => (out[vi] = rot[i]));
      uvs = out;
    }
    for (let k = 0; k < 4; k++) {
      const c = fc.c[k];
      pos.push(from[0] + c[0] * size[0], from[1] + c[1] * size[1], from[2] + c[2] * size[2]);
      nor.push(...fc.n);
      uv.push(uvs[k][0] / texW, 1 - uvs[k][1] / texH);
    }
    idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

export function eulerFromBedrock(THREE, r) {
  return new THREE.Euler(-(r[0] || 0) * DEG, -(r[1] || 0) * DEG, (r[2] || 0) * DEG, 'ZYX');
}

export function getGeometry(json, identifier) {
  const list = json['minecraft:geometry'];
  if (list) return identifier ? list.find((g) => g.description.identifier === identifier) : list[0];
  // legacy format
  const key = Object.keys(json).find((k) => k.startsWith('geometry.'));
  const g = json[key];
  return { description: { identifier: key, texture_width: g.texturewidth, texture_height: g.textureheight }, bones: g.bones };
}

// Returns { root, bones: Map(lowerName -> {obj, restRot, restPos, def}), locators: Map }
export function buildModel(THREE, geo, material) {
  const texW = geo.description.texture_width || 64;
  const texH = geo.description.texture_height || 64;
  const root = new THREE.Group();
  root.name = 'entity_root';
  const bones = new Map();
  const locators = new Map();
  const defs = geo.bones || [];
  // create bone groups
  for (const b of defs) {
    const obj = new THREE.Group();
    obj.name = b.name;
    bones.set(b.name.toLowerCase(), { obj, def: b });
  }
  for (const b of defs) {
    const entry = bones.get(b.name.toLowerCase());
    const piv = b.pivot || [0, 0, 0];
    const pivR = [-piv[0], piv[1], piv[2]];
    const parent = b.parent ? bones.get(b.parent.toLowerCase()) : null;
    const parentPiv = parent ? parent.def.pivot || [0, 0, 0] : [0, 0, 0];
    const parentPivR = parent ? [-parentPiv[0], parentPiv[1], parentPiv[2]] : [0, 0, 0];
    entry.restPos = new THREE.Vector3(pivR[0] - parentPivR[0], pivR[1] - parentPivR[1], pivR[2] - parentPivR[2]);
    entry.restRot = b.rotation ? [...b.rotation] : [0, 0, 0];
    entry.obj.position.copy(entry.restPos);
    entry.obj.rotation.copy(eulerFromBedrock(THREE, entry.restRot));
    (parent ? parent.obj : root).add(entry.obj);
    for (const cube of b.cubes || []) {
      const geom = cubeGeometry(THREE, cube, texW, texH);
      const mesh = new THREE.Mesh(geom, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.cube = cube;
      mesh.userData.bone = b.name;
      if (cube.rotation && cube.rotation.some((v) => v)) {
        const cp = cube.pivot || [0, 0, 0];
        const holder = new THREE.Group();
        holder.position.set(-cp[0] - pivR[0], cp[1] - pivR[1], cp[2] - pivR[2]);
        holder.rotation.copy(eulerFromBedrock(THREE, cube.rotation));
        // geometry is in entity space; shift so it sits relative to the cube pivot
        mesh.position.set(cp[0], -cp[1], -cp[2]);
        holder.add(mesh);
        entry.obj.add(holder);
      } else {
        mesh.position.set(-pivR[0], -pivR[1], -pivR[2]);
        entry.obj.add(mesh);
      }
    }
    for (const [lname, lval] of Object.entries(b.locators || {})) {
      const offset = Array.isArray(lval) ? lval : lval.offset;
      const loc = new THREE.Object3D();
      loc.name = lname;
      loc.position.set(-offset[0] - pivR[0], offset[1] - pivR[1], offset[2] - pivR[2]);
      entry.obj.add(loc);
      locators.set(lname.toLowerCase(), loc);
    }
  }
  return { root, bones, locators, texW, texH };
}

// Apply combined animation totals to a built model (resets to rest first).
export function applyPose(THREE, model, totals) {
  for (const [name, b] of model.bones) {
    const t = totals[name];
    const r = t ? [b.restRot[0] + t.rotation[0], b.restRot[1] + t.rotation[1], b.restRot[2] + t.rotation[2]] : b.restRot;
    b.obj.rotation.copy(eulerFromBedrock(THREE, r));
    b.obj.position.copy(b.restPos);
    b.obj.scale.set(1, 1, 1);
    if (t) {
      b.obj.position.x -= t.position[0];
      b.obj.position.y += t.position[1];
      b.obj.position.z += t.position[2];
      b.obj.scale.set(t.scale[0], t.scale[1], t.scale[2]);
    }
  }
}

// Convenience: sample animations [{anim, time, weight}] with a Molang ctx and pose the model.
export function poseModel(THREE, model, layers, ctx) {
  const sampled = layers.map((l) => ({ pose: sampleAnimation(l.anim, l.time, ctx), weight: l.weight ?? 1 }));
  const totals = combineLayers(sampled);
  applyPose(THREE, model, totals);
  return totals;
}

// Material emulating Bedrock "entity_emissive_alpha": opaque surface whose
// texture alpha encodes glow (alpha 0 = fully emissive, 255 = normally lit).
export function emissiveAlphaMaterial(THREE, texture, { glow = 1.0 } = {}) {
  const mat = new THREE.MeshLambertMaterial({ map: texture });
  mat.userData.glow = { value: glow };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uGlow = mat.userData.glow;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uGlow;')
      .replace('#include <map_fragment>', '#include <map_fragment>\nfloat sbEmis = 1.0 - diffuseColor.a;\ndiffuseColor.a = 1.0;')
      .replace('#include <opaque_fragment>', 'outgoingLight = mix(outgoingLight, diffuseColor.rgb * uGlow, sbEmis);\n#include <opaque_fragment>');
  };
  mat.transparent = false;
  return mat;
}

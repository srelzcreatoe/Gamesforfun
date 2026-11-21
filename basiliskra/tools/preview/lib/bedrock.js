// Builds a three.js scene graph from a Bedrock geometry file, the same way Blockbench
// displays one: positions are X-mirrored into a right-handed space, bone rotations become
// (-x, -y, z) Euler angles in ZYX order, and per-face UV rectangles are read exactly as the
// game's JSON gives them (negative uv_size flips the face).
import * as THREE from 'three';

const D2R = Math.PI / 180;

function fileRot(rx, ry, rz) {
  // file-space matrix: Rz(-rz) * Ry(ry) * Rx(-rx)
  const m = new THREE.Matrix4();
  const mx = new THREE.Matrix4().makeRotationX(-rx * D2R);
  const my = new THREE.Matrix4().makeRotationY(ry * D2R);
  const mz = new THREE.Matrix4().makeRotationZ(-rz * D2R);
  return m.multiply(mz).multiply(my).multiply(mx);
}

// corners of a face in file space for (s, t) in texture space, uv_size positive
function facePoint(face, lo, hi, s, t) {
  const [x0, y0, z0] = lo, [x1, y1, z1] = hi;
  const w = x1 - x0, h = y1 - y0, d = z1 - z0;
  switch (face) {
    case 'north': return [x0 + s * w, y1 - t * h, z0];
    case 'south': return [x1 - s * w, y1 - t * h, z1];
    case 'east': return [x0, y1 - t * h, z1 - s * d];
    case 'west': return [x1, y1 - t * h, z0 + s * d];
    case 'up': return [x0 + s * w, y1, z1 - t * d];
    case 'down': return [x0 + s * w, y0, z0 + t * d];
  }
}
const NORMALS = { north: [0, 0, -1], south: [0, 0, 1], east: [-1, 0, 0], west: [1, 0, 0], up: [0, 1, 0], down: [0, -1, 0] };

export function buildGeometry(geoJson) {
  const geo = geoJson['minecraft:geometry'][0];
  const TW = geo.description.texture_width, TH = geo.description.texture_height;
  const bones = new Map();
  const root = new THREE.Group();
  root.name = '__model';
  const locators = new Map();
  let cubeCount = 0, quadCount = 0;

  for (const jb of geo.bones) {
    const pivot = jb.pivot || [0, 0, 0];
    const rot = jb.rotation || [0, 0, 0];
    const group = new THREE.Group();
    group.name = jb.name;
    group.rotation.order = 'ZYX';
    const parent = jb.parent ? bones.get(jb.parent) : null;
    const pp = parent ? parent.pivot : [0, 0, 0];
    // Blockbench space: x mirrored
    const restPos = new THREE.Vector3(-pivot[0] + pp[0], pivot[1] - pp[1], pivot[2] - pp[2]);
    const restRot = [-rot[0] * D2R, -rot[1] * D2R, rot[2] * D2R];
    group.position.copy(restPos);
    group.rotation.set(restRot[0], restRot[1], restRot[2]);
    (parent ? parent.group : root).add(group);

    const pos = [], nor = [], uv = [], idx = [];
    for (const c of jb.cubes || []) {
      cubeCount++;
      const inf = c.inflate || 0;
      const lo = [c.origin[0] - inf, c.origin[1] - inf, c.origin[2] - inf];
      const hi = [c.origin[0] + c.size[0] + inf, c.origin[1] + c.size[1] + inf, c.origin[2] + c.size[2] + inf];
      let M = null, cp = null;
      if (c.rotation) {
        M = fileRot(c.rotation[0], c.rotation[1], c.rotation[2]);
        cp = c.pivot || pivot;
      }
      if (Array.isArray(c.uv)) throw new Error('box UV cubes are not used by this pack');
      for (const face of Object.keys(c.uv || {})) {
        const f = c.uv[face];
        const n0 = new THREE.Vector3(...NORMALS[face]);
        if (M) n0.applyMatrix4(M);
        const base = pos.length / 3;
        const corners = [];
        for (const [s, t] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
          const p = new THREE.Vector3(...facePoint(face, lo, hi, s, t));
          if (M) { p.sub(new THREE.Vector3(...cp)).applyMatrix4(M).add(new THREE.Vector3(...cp)); }
          // to Blockbench space, relative to the bone pivot
          const b = new THREE.Vector3(-(p.x - pivot[0]), p.y - pivot[1], p.z - pivot[2]);
          corners.push(b);
          pos.push(b.x, b.y, b.z);
          uv.push((f.uv[0] + s * f.uv_size[0]) / TW, (f.uv[1] + t * f.uv_size[1]) / TH);
        }
        const nb = new THREE.Vector3(-n0.x, n0.y, n0.z);
        for (let k = 0; k < 4; k++) nor.push(nb.x, nb.y, nb.z);
        // wind counter-clockwise as seen from outside
        const e1 = corners[1].clone().sub(corners[0]), e2 = corners[2].clone().sub(corners[0]);
        if (e1.cross(e2).dot(nb) >= 0) idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
        else idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
        quadCount++;
      }
    }
    let geometry = null;
    if (pos.length) {
      geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geometry.setIndex(idx);
    }
    const bone = { name: jb.name, group, pivot, parent, restPos, restRot, geometry, meshes: [], locators: {} };
    for (const [ln, lv] of Object.entries(jb.locators || {})) {
      const off = Array.isArray(lv) ? lv : lv.offset;
      const o = new THREE.Object3D();
      o.position.set(-(off[0] - pivot[0]), off[1] - pivot[1], off[2] - pivot[2]);
      group.add(o);
      bone.locators[ln] = o;
      locators.set(ln, o);
    }
    bones.set(jb.name, bone);
  }
  return { root, bones, locators, description: geo.description, cubeCount, quadCount };
}

// ---- materials -------------------------------------------------------------------------
// A flat approximation of the classic Bedrock entity shading: ambient plus two fixed lights,
// multiplied by a scene light colour (day, night, torch).  It is here to judge shape and
// texture, not to reproduce the game's renderer.
const VERT = `
varying vec2 vUv; varying vec3 vN; varying vec3 vW; varying float vDepth;
void main(){
  vUv = uv;
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 w = modelMatrix * vec4(position,1.0);
  vW = w.xyz;
  vec4 mv = viewMatrix * w;
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const FRAG_BASE = `
uniform sampler2D map; uniform vec3 uLight; uniform vec3 uAmbient; uniform vec3 uDir1; uniform vec3 uDir2;
uniform vec3 uFogColor; uniform float uFogNear; uniform float uFogFar; uniform vec3 uPoint; uniform vec3 uPointColor;
uniform float uPointRange; uniform float uWaterY; uniform vec3 uWaterTint; uniform float uUnderwater; uniform vec3 uTint;
varying vec2 vUv; varying vec3 vN; varying vec3 vW; varying float vDepth;
void main(){
  vec4 t = texture2D(map, vUv);
  if (t.a < 0.5) discard;
  vec3 n = normalize(vN);
  float d = 0.55*max(dot(n,uDir1),0.0) + 0.28*max(dot(n,uDir2),0.0);
  vec3 lit = uAmbient + uLight * d;
  float pd = length(uPoint - vW);
  float pa = clamp(1.0 - pd / uPointRange, 0.0, 1.0);
  lit += uPointColor * pow(pa, 1.4) * (0.45 + 0.55*max(dot(n, normalize(uPoint - vW)), 0.0));   // light falls off about as block light does
  vec3 c = t.rgb * uTint * min(lit, vec3(1.25));
  // anything below the water line is seen through water
  float sub = clamp((uWaterY - vW.y) * 0.22, 0.0, 1.0) * (1.0 - uUnderwater);
  c = mix(c, c * uWaterTint * 0.75 + uWaterTint * 0.10, sub * 0.85);
  float f = clamp((vDepth - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
  gl_FragColor = vec4(mix(c, uFogColor, f), 1.0);
}`;
const FRAG_GLOW = `
uniform sampler2D map; uniform float uAlpha; uniform vec3 uFogColor; uniform float uFogNear; uniform float uFogFar;
uniform float uWaterY; uniform vec3 uWaterTint; uniform float uUnderwater;
varying vec2 vUv; varying vec3 vW; varying float vDepth;
void main(){
  vec4 t = texture2D(map, vUv);
  float a = t.a * uAlpha;
  if (a < 0.004) discard;
  float f = clamp((vDepth - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
  float sub = clamp((uWaterY - vW.y) * 0.22, 0.0, 1.0) * (1.0 - uUnderwater);
  vec3 c = mix(t.rgb, t.rgb * uWaterTint, sub * 0.5);
  gl_FragColor = vec4(c, a * (1.0 - f * 0.8));
}`;

export function makeEnv() {
  return {
    uLight: { value: new THREE.Color(1, 1, 1) },
    uAmbient: { value: new THREE.Color(0.42, 0.42, 0.44) },
    uDir1: { value: new THREE.Vector3(0.35, 0.85, 0.4).normalize() },
    uDir2: { value: new THREE.Vector3(-0.5, 0.25, -0.65).normalize() },
    uFogColor: { value: new THREE.Color(0.7, 0.8, 0.95) },
    uFogNear: { value: 1e6 },
    uFogFar: { value: 2e6 },
    uPoint: { value: new THREE.Vector3(0, -1e5, 0) },
    uPointColor: { value: new THREE.Color(0, 0, 0) },
    uPointRange: { value: 1 },
    uWaterY: { value: -1e5 },
    uWaterTint: { value: new THREE.Color(0.25, 0.45, 0.75) },
    uUnderwater: { value: 0 },
  };
}

export function loadTexture(url) {
  return new Promise((res, rej) => {
    new THREE.TextureLoader().load(url, (t) => {
      t.magFilter = THREE.NearestFilter;
      t.minFilter = THREE.NearestFilter;
      t.generateMipmaps = false;
      t.flipY = false;
      t.colorSpace = THREE.NoColorSpace;
      res(t);
    }, undefined, rej);
  });
}

/** Attach meshes to a built model: one lit pass, and one glow pass per bone. */
export function skin(model, tex, glowTex, env) {
  const baseMat = new THREE.ShaderMaterial({
    uniforms: { ...env, map: { value: tex }, uTint: { value: new THREE.Color(1, 1, 1) } },
    vertexShader: VERT, fragmentShader: FRAG_BASE, side: THREE.DoubleSide,
  });
  model.baseMat = baseMat;
  for (const bone of model.bones.values()) {
    if (!bone.geometry) continue;
    const mesh = new THREE.Mesh(bone.geometry, baseMat);
    mesh.frustumCulled = false;
    bone.group.add(mesh);
    bone.base = mesh;
    if (glowTex) {
      const gm = new THREE.ShaderMaterial({
        uniforms: { ...env, map: { value: glowTex }, uAlpha: { value: 0 } },
        vertexShader: VERT, fragmentShader: FRAG_GLOW, side: THREE.DoubleSide, transparent: true,
        depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      });
      const g = new THREE.Mesh(bone.geometry, gm);
      g.frustumCulled = false;
      g.renderOrder = 5;
      g.visible = false;
      bone.group.add(g);
      bone.glow = g;
    }
  }
}

export function resetPose(model) {
  for (const b of model.bones.values()) {
    b.group.position.copy(b.restPos);
    b.group.rotation.set(b.restRot[0], b.restRot[1], b.restRot[2]);
    b.group.scale.set(1, 1, 1);
  }
}

/** Bedrock animation channels are added in file convention: rotation (-x, -y, z), position (-x, y, z). */
export function addPose(bone, rot, pos, scl) {
  if (rot) {
    bone.group.rotation.x -= rot[0] * D2R;
    bone.group.rotation.y -= rot[1] * D2R;
    bone.group.rotation.z += rot[2] * D2R;
  }
  if (pos) {
    bone.group.position.x -= pos[0];
    bone.group.position.y += pos[1];
    bone.group.position.z += pos[2];
  }
  if (scl) {
    bone.group.scale.x *= scl[0];
    bone.group.scale.y *= scl[1];
    bone.group.scale.z *= scl[2];
  }
}

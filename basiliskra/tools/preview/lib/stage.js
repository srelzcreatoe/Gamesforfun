// Scene dressing for the offline viewer: scale references now, voxel dioramas for the
// encounter previews (see scenes/).  Everything here is drawn by this tool; no game assets.
import * as THREE from 'three';

export function grid(size = 48, y = 0) {
  const g = new THREE.GridHelper(size * 2, size * 2, 0x555555, 0x333333);
  g.position.y = y;
  return g;
}

/** A 0.6 x 1.8 block figure so sizes read at a glance. */
export function playerDummy() {
  const grp = new THREE.Group();
  const mat = (c) => new THREE.MeshBasicMaterial({ color: c });
  const part = (w, h, d, x, y, z, c) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(c));
    m.position.set(x, y, z);
    grp.add(m);
  };
  part(0.5, 0.75, 0.25, 0, 0.375, 0, 0x3b4fa8);   // legs
  part(0.5, 0.75, 0.25, 0, 1.125, 0, 0x2aa7a0);   // torso
  part(0.25, 0.75, 0.25, -0.375, 1.125, 0, 0xc69a78);
  part(0.25, 0.75, 0.25, 0.375, 1.125, 0, 0xc69a78);
  part(0.5, 0.5, 0.5, 0, 1.75, 0, 0xc69a78);       // head
  return grp;
}

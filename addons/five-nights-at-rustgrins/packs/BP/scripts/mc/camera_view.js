// Security camera view for the guard (the same mechanic as FREDBEAR: Six
// Nights Below).
//
// One live feed at a time: the guard's view moves to the camera with the
// `minecraft:free` camera preset (Camera.setCamera). While the monitor is up:
//   * lateral movement and jumping are disabled (sneak stays enabled = lower);
//   * a camera-feed fog replaces the night fog and soft "IR" light blocks
//     light what the live camera watches (Actuators.camLight);
//   * the feed slowly pans a few blocks around its aim point;
//   * static / audio-only feeds are covered by a held fade.
// close() always restores the normal view, effects and input permissions; it
// runs on monitor down, jumpscare, 6 AM, power out, reset and world load.

import { system, InputPermissionCategory, EasingType } from '@minecraft/server';
import { CAMERA_BY_ID } from '../data/cameras.js';
import { Wv, runCmd } from './world_io.js';
import { log } from './log.js';

export const FOG = Object.freeze({
  camPush: 'fog @a push fnar:camera_feed fnar_cam',
  camPop: 'fog @a remove fnar_cam',
  nightPush: 'fog @a push fnar:night fnar_night',
  nightPop: 'fog @a remove fnar_night',
  darkPush: 'fog @a push fnar:power_out fnar_dark',
  darkPop: 'fog @a remove fnar_dark',
});

const v3 = (a) => ({ x: a[0], y: a[1], z: a[2] });

export class CameraView {
  constructor() {
    this.player = undefined;
    this.cam = undefined;
    this.active = false;
    this.panLeft = true;
    this.nextPan = 0;
    this.cover = null; // 'static' | 'audio' | null
    this.nextCover = 0;
  }

  /** @param {import('@minecraft/server').Player} player */
  open(player, camId) {
    this.player = player;
    this.active = true;
    try {
      player.inputPermissions.setPermissionCategory(InputPermissionCategory.LateralMovement, false);
      player.inputPermissions.setPermissionCategory(InputPermissionCategory.Jump, false);
    } catch (e) {
      log.warn(`camera open: ${e?.message ?? e}`);
    }
    runCmd(FOG.camPush);
    this.show(camId, true);
  }

  show(camId, first = false) {
    const cam = CAMERA_BY_ID[camId];
    if (!cam || !this.player?.isValid) return;
    this.cam = camId;
    try {
      if (!first) this.player.camera.fade({ fadeColor: { red: 0, green: 0, blue: 0 }, fadeTime: { fadeInTime: 0.05, holdTime: 0.05, fadeOutTime: 0.12 } });
      this.player.camera.setCamera('minecraft:free', { location: Wv(v3(cam.loc)), facingLocation: Wv(v3(cam.look)) });
      this.player.playSound('fnar.cam.switch', { volume: 0.6 });
    } catch (e) {
      log.warn(`camera show ${camId}: ${e?.message ?? e}`);
    }
    this.nextPan = system.currentTick + 30;
    this.nextCover = 0;
  }

  /** Every tick while active. `cover` decides whether the feed is obscured. */
  tick(cover) {
    if (!this.active || !this.player?.isValid) return;
    const now = system.currentTick;
    const cam = CAMERA_BY_ID[this.cam];
    if (cover !== this.cover) {
      this.cover = cover;
      this.nextCover = 0;
    }
    if (cover && now >= this.nextCover) {
      const color = cover === 'static' ? { red: 0.33, green: 0.35, blue: 0.33 } : { red: 0, green: 0, blue: 0 };
      try {
        this.player.camera.fade({ fadeColor: color, fadeTime: { fadeInTime: 0.05, holdTime: 1.6, fadeOutTime: 0.05 } });
        if (cover === 'static') this.player.playSound('fnar.cam.static', { volume: 0.45 });
      } catch {
        // ignore
      }
      this.nextCover = now + 30;
    }
    // slow security-camera pan around the aim point
    if (!cover && now >= this.nextPan && cam) {
      const [lx, ly, lz] = cam.look;
      const dx = lx - cam.loc[0];
      const dz = lz - cam.loc[2];
      const len = Math.hypot(dx, dz) || 1;
      const off = (this.panLeft ? 1 : -1) * Math.min(2.5, len * 0.1);
      const target = { x: lx + (-dz / len) * off, y: ly, z: lz + (dx / len) * off };
      try {
        this.player.camera.setCamera('minecraft:free', { location: Wv(v3(cam.loc)), facingLocation: Wv(target), easeOptions: { easeTime: 5, easeType: EasingType.InOutSine } });
      } catch {
        // ignore
      }
      this.panLeft = !this.panLeft;
      this.nextPan = now + 110;
    }
  }

  close() {
    const p = this.player;
    if (this.active) runCmd(FOG.camPop);
    this.active = false;
    this.cam = undefined;
    this.cover = null;
    if (p?.isValid) restorePlayerView(p);
  }
}

/** Return a player to normal first-person control (idempotent, safe on reload). */
/** @param {import('@minecraft/server').Player} p */
export function restorePlayerView(p) {
  try {
    p.camera.clear();
  } catch {
    // ignore
  }
  try {
    p.removeEffect('invisibility');
    p.removeEffect('night_vision');
    for (const c of [InputPermissionCategory.Camera, InputPermissionCategory.Movement, InputPermissionCategory.LateralMovement, InputPermissionCategory.Jump, InputPermissionCategory.Sneak]) {
      p.inputPermissions.setPermissionCategory(c, true);
    }
  } catch (e) {
    log.warn(`restore view: ${e?.message ?? e}`);
  }
}

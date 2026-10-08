// Security camera view for the guard player.
//
// One live feed at a time: the player's view is moved to the camera with the
// stable `minecraft:free` preset (Camera.setCamera). While the monitor is up:
//   * lateral movement and jumping are disabled (sneak stays enabled = exit);
//   * Night Vision makes the dim rooms readable ("night mode" feed), the
//     clear fb:camera_feed fog replaces the dark night fog, and soft hidden
//     light blocks (build plan, cameraLights) light what each camera watches;
//   * the feed slowly pans +/- a few blocks around its aim point;
//   * disrupted / audio-only / lost-signal feeds are covered by a held fade.
// close() always restores the normal camera, effects and input permissions;
// it is called on monitor down, death, jumpscare, win, reset and world load.

import { system, InputPermissionCategory, EasingType } from '@minecraft/server';
import { CAMERA_BY_ID } from '../data/cameras.js';
import { Wv, runCmd } from './world_io.js';
import { COMMAND_TEMPLATES } from './commands.js';
import { log } from './log.js';

const NV_TICKS = 20 * 60 * 30;

export class CameraView {
  constructor() {
    this.player = undefined;
    this.cam = undefined;
    this.active = false;
    this.panLeft = true;
    this.nextPan = 0;
    this.cover = null; // 'static' | 'audio' | 'lost' | 'echo' | null
    this.nextCover = 0;
  }

  open(player, camId) {
    this.player = player;
    this.active = true;
    try {
      player.inputPermissions.setPermissionCategory(InputPermissionCategory.LateralMovement, false);
      player.inputPermissions.setPermissionCategory(InputPermissionCategory.Jump, false);
      player.addEffect('night_vision', NV_TICKS, { amplifier: 0, showParticles: false });
    } catch (e) {
      log.warn(`camera open: ${e?.message ?? e}`);
    }
    runCmd(COMMAND_TEMPLATES.camFogPush[0]);
    this.show(camId, true);
  }

  show(camId, first = false) {
    const cam = CAMERA_BY_ID[camId];
    if (!cam || !this.player?.isValid) return;
    this.cam = camId;
    try {
      if (!first) this.player.camera.fade({ fadeColor: { red: 0, green: 0, blue: 0 }, fadeTime: { fadeInTime: 0.05, holdTime: 0.05, fadeOutTime: 0.1 } });
      this.player.camera.setCamera('minecraft:free', { location: Wv(arr(cam.loc)), facingLocation: Wv(arr(cam.look)) });
      this.player.playSound('fb.cam.switch', { volume: 0.6 });
    } catch (e) {
      log.warn(`camera show ${camId}: ${e?.message ?? e}`);
    }
    this.nextPan = system.currentTick + 30;
    this.nextCover = 0;
  }

  /** Called every tick while active. `cover` decides whether the feed is obscured. */
  tick(cover) {
    if (!this.active || !this.player?.isValid) return;
    const now = system.currentTick;
    const cam = CAMERA_BY_ID[this.cam];
    if (cover !== this.cover) {
      this.cover = cover;
      this.nextCover = 0;
    }
    if (cover && now >= this.nextCover) {
      const color = cover === 'static' ? { red: 0.35, green: 0.35, blue: 0.38 } : cover === 'echo' ? { red: 0.3, green: 0.05, blue: 0.35 } : { red: 0, green: 0, blue: 0 };
      const hold = cover === 'echo' ? 0.05 : 1.6;
      try {
        this.player.camera.fade({ fadeColor: color, fadeTime: { fadeInTime: 0.05, holdTime: hold, fadeOutTime: cover === 'echo' ? 0.3 : 0.05 } });
        if (cover === 'static') this.player.playSound('fb.cam.static', { volume: 0.5 });
      } catch {
        // ignore
      }
      this.nextCover = now + (cover === 'echo' ? 60 : 30);
    }
    // Slow security-camera pan around the aim point.
    if (!cover && now >= this.nextPan && cam) {
      const [lx, ly, lz] = cam.look;
      const dx = lx - cam.loc[0];
      const dz = lz - cam.loc[2];
      const len = Math.hypot(dx, dz) || 1;
      const off = (this.panLeft ? 1 : -1) * Math.min(3, len * 0.12);
      const target = { x: lx + (-dz / len) * off, y: ly, z: lz + (dx / len) * off };
      try {
        this.player.camera.setCamera('minecraft:free', {
          location: Wv(arr(cam.loc)), facingLocation: Wv(target), easeOptions: { easeTime: 5, easeType: EasingType.InOutSine },
        });
      } catch {
        // ignore
      }
      this.panLeft = !this.panLeft;
      this.nextPan = now + 110;
    }
  }

  close() {
    const p = this.player;
    if (this.active) runCmd(COMMAND_TEMPLATES.camFogPop[0]);
    this.active = false;
    this.cam = undefined;
    this.cover = null;
    if (!p?.isValid) return;
    restorePlayerView(p);
  }
}

function arr(v) {
  return { x: v[0], y: v[1], z: v[2] };
}

/** Return a player to normal first-person control (idempotent, safe on reload). */
export function restorePlayerView(p) {
  try {
    p.camera.clear();
  } catch {
    // ignore
  }
  try {
    p.removeEffect('night_vision');
    for (const c of [InputPermissionCategory.Camera, InputPermissionCategory.Movement, InputPermissionCategory.LateralMovement, InputPermissionCategory.Jump, InputPermissionCategory.Sneak]) {
      p.inputPermissions.setPermissionCategory(c, true);
    }
  } catch (e) {
    log.warn(`restore view: ${e?.message ?? e}`);
  }
}

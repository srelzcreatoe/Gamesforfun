/**
 * Short cutscenes: for a few seconds the players near something that is happening (the rift opening, him
 * coming through, a transformation) watch it from a camera that the script places and slowly moves.  The
 * players can still move; only what they see changes.  Every film has a fixed length and is ended by the
 * controller's own tick, so nothing that goes wrong in the scene it belongs to can leave a camera behind.
 */
import { Dimension, EasingType, Player } from "@minecraft/server";
import { CONFIG } from "./config";
import { players } from "./fx";
import { dist, type V3 } from "./vec";
import { clearLine, isLoaded } from "./world";

const FLAG = "bk:film";

export interface FilmOptions {
  /** Ticks it lasts. */
  ticks: number;
  /** Players within this many blocks of the focus when it starts are shown it. */
  radius: number;
  /** How far from the focus the camera stands, and how high above it. */
  dist: number;
  height: number;
  /** Degrees the camera travels round the focus over the whole film (0: it stands still). */
  orbit?: number;
  /** The camera closes in (or backs off) to this distance by the end. */
  distEnd?: number;
  /** A short fade through this colour as it starts (a flash for the rift, black for a change). */
  flash?: { red: number; green: number; blue: number };
}

class Film {
  private t = 0;
  private cast: { p: Player; base: number }[] = [];
  done = false;
  constructor(private readonly dim: Dimension, private readonly focus: () => V3, private readonly o: FilmOptions) {
    const f = focus();
    for (const p of players()) {
      try {
        if (p.dimension.id !== dim.id || dist(p.location, f) > o.radius) continue;
        // each watcher's camera starts on their own side of what they are shown
        const base = Math.atan2(p.location.z - f.z, p.location.x - f.x);
        this.cast.push({ p, base });
        p.setDynamicProperty(FLAG, true);
        if (o.flash) p.camera.fade({ fadeColor: o.flash, fadeTime: { fadeInTime: 0.1, holdTime: 0.15, fadeOutTime: 0.7 } });
      } catch { /* left */ }
    }
    this.aim();
  }

  private aim(): void {
    const o = this.o, f = this.focus(), k = Math.min(1, this.t / Math.max(1, o.ticks));
    const d = o.dist + ((o.distEnd ?? o.dist) - o.dist) * k;
    for (const { p, base } of this.cast) {
      try {
        if (!p.isValid || p.dimension.id !== this.dim.id) continue;
        const a = base + ((o.orbit ?? 0) * Math.PI / 180) * (k - 0.5);
        // somewhere it can see him from: the wanted place, else higher, else closer
        let at: V3 | null = null;
        for (const [kd, kh] of [[1, 1], [1, 1.8], [0.7, 1.4], [0.45, 1.2], [0.3, 2.2]]) {
          const q = { x: f.x + Math.cos(a) * d * kd, y: f.y + o.height * kh, z: f.z + Math.sin(a) * d * kd };
          if (!isLoaded(this.dim, q)) continue;
          if (clearLine(this.dim, q, f)) { at = q; break; }
          at ??= q;
        }
        if (!at) continue;
        p.camera.setCamera("minecraft:free", { location: at, facingLocation: f, easeOptions: { easeTime: 0.25, easeType: EasingType.Linear } });
      } catch { /* this watcher has gone, or the engine refused the camera: the others still see it */ }
    }
  }

  tick(): void {
    if (this.done) return;
    this.t++;
    if (this.t >= this.o.ticks) { this.cut(); return; }
    if (this.t % 2 === 0) this.aim();
  }

  /** End it now: every watcher gets their own eyes back. */
  cut(): void {
    if (this.done) return;
    this.done = true;
    for (const { p } of this.cast) release(p);
    this.cast = [];
  }
}

function release(p: Player): void {
  try { p.camera.clear(); } catch { /* left */ }
  try { p.setDynamicProperty(FLAG, undefined); } catch { /* left */ }
}

let films: Film[] = [];

/** Start a film (nothing happens, and nothing is returned to cut, when cutscenes are turned off). */
export function film(dim: Dimension, focus: () => V3, o: FilmOptions): { cut(): void; readonly done: boolean } {
  if (!CONFIG.cutscenes) return { cut() { /* none */ }, done: true };
  const f = new Film(dim, focus, o);
  films.push(f);
  return f;
}

/** Once a tick, from the controller. */
export function filmTick(): void {
  if (!films.length) return;
  for (const f of films) { try { f.tick(); } catch { f.cut(); } }
  films = films.filter((f) => !f.done);
}

export const filming = (): boolean => films.length > 0;

/** A player who joins (or a script that restarts) mid-film must not keep a camera nobody is moving. */
export function releaseStale(p: Player): void {
  try { if (p.getDynamicProperty(FLAG) === true) release(p); } catch { /* left */ }
}

export function cutAll(): void {
  for (const f of films) f.cut();
  films = [];
}

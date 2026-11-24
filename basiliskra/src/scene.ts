/**
 * Short cutscenes: for a few seconds the players near something that is happening (the rift opening, him
 * coming through, a transformation) watch it from a camera that the script places and slowly moves.  The
 * players can still move; only what they see changes.  Every film has a fixed length and is ended by the
 * controller's own tick, so nothing that goes wrong in the scene it belongs to can leave a camera behind.
 */
import { Dimension, EasingType, HudElement, HudVisibility, Player } from "@minecraft/server";
import { CONFIG } from "./config";
import { players } from "./fx";
import { dist, forwardOf, type V3 } from "./vec";
import { blockAt, clearLine, groundY, isLoaded, isSolidBlock } from "./world";

const FLAG = "bk:film";
/** What is put away while a scene plays: everything but the touch controls (a player can still walk) and titles. */
const HUD = [HudElement.PaperDoll, HudElement.Armor, HudElement.ToolTips, HudElement.Crosshair, HudElement.Hotbar, HudElement.Health, HudElement.ProgressBar,
  HudElement.Hunger, HudElement.AirBubbles, HudElement.HorseHealth, HudElement.StatusEffects, HudElement.ItemText];

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
  /**
   * A scene cut into shots (when given, `dist`, `height`, `orbit` and `distEnd` are not used).  Every watcher is
   * shown the same picture: the camera is placed relative to the way he faces, so he is in frame whoever watches.
   */
  shots?: Shot[];
  /** The way he faces (degrees), for placing the shots. */
  facing?: () => number;
  /** Hide the hotbar and the rest of the HUD while it plays. */
  cinema?: boolean;
  /** Title cards (a chapter heading, say): shown to every watcher `at` ticks into the film. */
  cards?: { at: number; title: string; sub?: string; stay?: number }[];
}

/**
 * One shot.  The camera stands `dist` blocks from what it looks at, `height` blocks above (or below) it, at
 * `angle` degrees round from straight in front of him (0: face on; 90: side on; 180: behind).  Each of the three
 * may be [from, to]: the camera moves smoothly between them over the shot.  `look`: what it looks at, if not the
 * film's focus (his head for a close-up, say).
 */
export interface Shot {
  ticks: number;
  angle: number | [number, number];
  dist: number | [number, number];
  height: number | [number, number];
  look?: () => V3;
  /** The cut into this shot dips through a colour for a moment (else the usual blink of black). */
  dip?: { red: number; green: number; blue: number; hold?: number };
  /** A shot given one angle or one distance is not held dead still: it drifts a few degrees and creeps in (1.8). Set false to hold it. */
  still?: boolean;
}
const span = (v: number | [number, number], k: number): number => (typeof v === "number" ? v : v[0] + (v[1] - v[0]) * k);

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
        if (o.cinema) { try { p.onScreenDisplay.setHudVisibility(HudVisibility.Hide, HUD); } catch { /* an older client: the HUD stays */ } }
        if (o.flash) p.camera.fade({ fadeColor: o.flash, fadeTime: { fadeInTime: 0.1, holdTime: 0.15, fadeOutTime: 0.7 } });
      } catch { /* left */ }
    }
    this.aim();
  }

  /** A place the camera can stand: not inside a block, not under the ground, and able to see what it looks at. */
  private stand(want: V3, look: V3): V3 | null {
    let best: V3 | null = null;
    for (const [kd, up] of [[1, 0], [1, 3], [0.85, 6], [0.7, 10], [0.55, 16], [0.4, 24]]) {
      const q = { x: look.x + (want.x - look.x) * kd, y: want.y + up, z: look.z + (want.z - look.z) * kd };
      if (!isLoaded(this.dim, q)) continue;
      const g = groundY(this.dim, q.x, q.z, q.y + 12, 40);
      if (typeof g === "number" && q.y < g + 1.6) q.y = g + 1.6;                 // never under the ground
      const here = blockAt(this.dim, q);
      if (here && isSolidBlock(here)) continue;
      if (clearLine(this.dim, q, look)) return q;
      best ??= q;
    }
    return best;
  }

  /** The shot that is playing, which it is, and how far through it the film is (0..1). */
  private shot(): { s: Shot; k: number; first: boolean; i: number } | null {
    const shots = this.o.shots;
    if (!shots || !shots.length) return null;
    let t = this.t, i = 0;
    for (const s of shots) {
      if (t < s.ticks) return { s, k: t / Math.max(1, s.ticks - 1), first: t < 2, i };
      t -= s.ticks; i++;
    }
    return { s: shots[shots.length - 1], k: 1, first: false, i: shots.length - 1 };
  }

  private aimShot(): void {
    const cur = this.shot();
    if (!cur) return;
    const { s, first } = cur;
    const k = cur.k * cur.k * (3 - 2 * cur.k);                                   // ease in and out of every move
    let look: V3;
    try { look = (s.look ?? this.focus)(); } catch { look = this.focus(); }
    // nothing is held dead still: a shot given one angle drifts a few degrees (one way, then the other, shot by
    // shot), and one given one distance creeps in on him
    const drift = s.still !== false && typeof s.angle === "number" ? (cur.i % 2 ? 1 : -1) * 7 * (cur.k - 0.5) : 0;
    const creep = s.still !== false && typeof s.dist === "number" ? 1 - 0.08 * cur.k : 1;
    const f = forwardOf((this.o.facing?.() ?? 0) + span(s.angle, k) + drift);
    const d = span(s.dist, k) * creep;
    const at = this.stand({ x: look.x + f.x * d, y: look.y + span(s.height, k), z: look.z + f.z * d }, look);
    if (!at) return;
    for (const { p } of this.cast) {
      try {
        if (!p.isValid || p.dimension.id !== this.dim.id) continue;
        // a new shot is a cut: no easing across it, and a blink of black so that it reads as one
        if (first) {
          if (this.t > 1 && s.dip) p.camera.fade({ fadeColor: { red: s.dip.red, green: s.dip.green, blue: s.dip.blue }, fadeTime: { fadeInTime: 0.05, holdTime: s.dip.hold ?? 0.2, fadeOutTime: 0.45 } });
          else if (this.t > 1) p.camera.fade({ fadeColor: { red: 0, green: 0, blue: 0 }, fadeTime: { fadeInTime: 0, holdTime: 0.05, fadeOutTime: 0.2 } });
          p.camera.setCamera("minecraft:free", { location: at, facingLocation: look });
        } else p.camera.setCamera("minecraft:free", { location: at, facingLocation: look, easeOptions: { easeTime: 0.15, easeType: EasingType.Linear } });
      } catch { /* this watcher has gone, or the engine refused the camera: the others still see it */ }
    }
  }

  private aim(): void {
    if (this.o.shots) { this.aimShot(); return; }
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
    for (const card of this.o.cards ?? []) {
      if (card.at !== this.t) continue;
      for (const { p } of this.cast) {
        try { p.onScreenDisplay.setTitle(card.title, { subtitle: card.sub, fadeInDuration: 10, stayDuration: card.stay ?? 50, fadeOutDuration: 16 }); } catch { /* left */ }
      }
    }
    if (this.t % 2 === 0 || this.o.shots) this.aim();
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
  try { p.onScreenDisplay.setHudVisibility(HudVisibility.Reset, HUD); } catch { /* left, or an older client */ }
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

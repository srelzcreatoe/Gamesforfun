/**
 * His themes.  Three pieces, each for a time of his life:
 *
 *   dread  - he is near: under the water, on the shore, walking the land;
 *   wrath  - he is fighting: the beam, the chase, the lightning, a boat being rammed, or somebody has hurt him;
 *   last   - the moments that happen once: a change, the last crossing (and the form that comes after).
 *
 * A player hears a theme while he is within earshot of them and awake; it fades in, loops, and fades out a few
 * seconds after he is gone.  It is ordinary game music: the Music slider sets how loud it is, and the setting
 * "His themes" switches it off.  Nothing here touches the game's own music except while one of his is playing.
 */
import { Player } from "@minecraft/server";
import { CONFIG, TICKS } from "./config";
import type { Creature } from "./creature";
import { players } from "./fx";
import { store } from "./store";
import { dist, type V3 } from "./vec";

export type Theme = "dread" | "wrath" | "last";
const TRACK = (t: Theme): string => `basiliskra.music.${t}`;
const RANGE: Record<Theme, number> = { dread: 80, wrath: 128, last: 160 };
const GRACE = 8 * TICKS.second;            // how long a theme plays on after its reason is gone
const PROP = "bk:music";

interface Playing { theme: Theme; lost: number }
const playing = new Map<string, Playing>();
/** A theme asked for by a scene (a change, an arrival), until a tick. */
let scene: { theme: Theme; until: number; at: V3; dim: string } | null = null;

/** A scene at a place wants a theme for a while (it wins over the theme his form would choose). */
export function sceneTheme(theme: Theme, ticks: number, at: V3, dim: string): void {
  scene = { theme, until: store.rec.clock + ticks, at: { ...at }, dim };
}

/** What he does when he fights (the names his brains give their acts). */
const FIGHT = new Set(["charge", "beam", "remember", "scatter", "lock", "pursue", "raze", "arc", "pin", "flinch", "boat"]);
let fightUntil = -1;

function themeFor(c: Creature | null, now: number, doing: string, hurtAt: number, battle: boolean): Theme | null {
  if (scene && now < scene.until) return scene.theme;
  if (!c || !c.valid) return null;
  if (store.rec.ending?.step || store.rec.evolve) return "last";
  // giants at each other: that is a fight, whatever form they have
  if (battle) return "wrath";
  if (c.form >= 4) return "last";
  // a fight is held for a while after its last blow, so the music does not flicker between two pieces
  if (FIGHT.has(doing) || (hurtAt > 0 && now - hurtAt < 5 * TICKS.second)) fightUntil = now + 25 * TICKS.second;
  if (now < fightUntil) return "wrath";
  return c.phase === "sleep" ? null : "dread";
}

function stop(p: Player): void {
  try { p.runCommand("music stop 3"); } catch { try { p.stopMusic(); } catch { /* left */ } }
  try { p.setDynamicProperty(PROP, undefined); } catch { /* left */ }
}

/** Once a second: start, change or fade out each player's theme. */
export function musicTick(c: Creature | null, now: number, doing = "", hurtAt = -1, battle = false): void {
  if (now % 20 !== 0) return;
  const want = CONFIG.music ? themeFor(c, now, doing, hurtAt, battle) : null;
  for (const p of players()) {
    let near = false;
    try {
      const inScene = !!scene && now < scene.until && p.dimension.id === scene.dim && dist(p.location, scene.at) <= RANGE.last;
      near = !!want && (inScene || (!!c && c.valid && p.dimension.id === c.dim.id && dist(p.location, c.pos) <= RANGE[want as Theme]));
    } catch { continue; }
    const cur = playing.get(p.id);
    if (near && want) {
      if (!cur || cur.theme !== want) {
        try {
          p.playMusic(TRACK(want), { fade: cur ? 3 : 2, loop: true, volume: 0.85 });
          p.setDynamicProperty(PROP, want);
          playing.set(p.id, { theme: want, lost: -1 });
        } catch { /* left */ }
      } else cur.lost = -1;
    } else if (cur) {
      if (cur.lost < 0) cur.lost = now;
      if (!CONFIG.music || now - cur.lost >= GRACE) { stop(p); playing.delete(p.id); }
    }
  }
}

/** A player joining: a theme left looping from a session that ended while it played is stopped. */
export function musicJoin(p: Player): void {
  playing.delete(p.id);
  try { if (p.getDynamicProperty(PROP) !== undefined) stop(p); } catch { /* left */ }
}

/** Everything off (the story reset, or he is sent away). */
export function musicStop(): void {
  scene = null;
  fightUntil = -1;
  for (const p of players()) if (playing.delete(p.id)) stop(p);
}

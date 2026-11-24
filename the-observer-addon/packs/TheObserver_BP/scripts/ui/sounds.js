// @ts-check
// The Sound Test (1.5.1; by creature since 1.7.0): the music and the sounds of each of them — the Observer, the
// Goatwalker, the Shaftbreaker and the Brinesleeper — to hear on demand from the Config Wheel. Pick a creature, then
// one of its tracks (or its whole playlist, one track after another), or one of its sounds. Music plays on your music
// channel (only you hear it): a track loops until you stop it or pick another; the playlist plays through once. A
// sound plays once, beside you. Open to everyone: it changes nothing.
import { ActionFormData } from "@minecraft/server-ui";
import { SOUNDS } from "../core/constants.js";
import { safe, emit } from "../core/util.js";

/** @typedef {import("@minecraft/server").Player} Player */
/** @typedef {[string, string]} Entry [sound id, lang key] */
/** @typedef {{key: string, name: string, tracks: Entry[], effects: Entry[]}} Creature */

/** The Observer's music, in the order it comes to you. */
export const TRACKS = /** @type {Entry[]} */ ([
  [SOUNDS.themeAround, "observer.sounds.m.around"],
  [SOUNDS.themeMire, "observer.sounds.m.lurking"],
  [SOUNDS.musicStalk, "observer.sounds.m.stalk"],
  [SOUNDS.musicMire, "observer.sounds.m.mire"],
  [SOUNDS.musicChase, "observer.sounds.m.chase"],
  [SOUNDS.musicEnd, "observer.sounds.m.end"],
]);

/** The Observer's sounds. */
export const EFFECTS = /** @type {Entry[]} */ ([
  [SOUNDS.presence, "observer.sounds.s.presence"],
  [SOUNDS.spotted, "observer.sounds.s.spotted"],
  [SOUNDS.whisper, "observer.sounds.s.whisper"],
  [SOUNDS.shriek, "observer.sounds.s.shriek"],
  [SOUNDS.vanish, "observer.sounds.s.vanish"],
  [SOUNDS.notice, "observer.sounds.s.notice"],
  [SOUNDS.voice, "observer.sounds.s.voice"],
  [SOUNDS.breath, "observer.sounds.s.breath"],
  [SOUNDS.heartbeat, "observer.sounds.s.heartbeat"],
  [SOUNDS.crack, "observer.sounds.s.crack"],
  [SOUNDS.knock, "observer.sounds.s.knock"],
  [SOUNDS.glitch, "observer.sounds.s.glitch"],
  [SOUNDS.static, "observer.sounds.s.static"],
  [SOUNDS.charmHum, "observer.sounds.s.charm"],
  [SOUNDS.drift, "observer.sounds.s.drift"],
  [SOUNDS.discovery, "observer.sounds.s.discovery"],
]);

/** @param {string} pre @param {string} lang @param {string[]} names @returns {Entry[]} */
const list = (pre, lang, names) => names.map((n) => [`${pre}${n}`, `${lang}${n.replace(/\./g, "_")}`]);

/** Every creature's page: its name, its music (the playlist, in order) and its sounds. @type {Creature[]} */
export const CREATURES = [
  { key: "observer", name: "observer.sounds.c.observer", tracks: TRACKS, effects: EFFECTS },
  {
    key: "goatwalker",
    name: "observer.sounds.c.goatwalker",
    tracks: list("goatwalker.music.", "observer.sounds.gw.m.", ["stellar", "lullaby", "needlefall", "hollow", "procession", "scapegoat", "eclipse", "static", "wrath", "tooslow"]),
    effects: list("goatwalker.", "observer.sounds.gw.s.", ["bleat", "call", "growl", "roar", "scream", "laugh", "whisper", "breath", "hoof", "gallop", "bell.near", "horn.blow", "chains", "knock", "jumpscare", "vanish"]),
  },
  {
    key: "shaftbreaker",
    name: "observer.sounds.c.shaftbreaker",
    tracks: list("music.shaftbreaker.", "observer.sounds.sb.m.", ["presence", "hollows", "close", "standoff", "chase"]),
    effects: list("shaftbreaker.", "observer.sounds.sb.s.", ["growl", "roar", "screech", "call", "whisper", "breath", "click", "neck_crack", "chew", "knock", "pickaxe", "step", "rush", "scrape", "jumpscare", "vanish"]),
  },
  {
    key: "brinesleeper",
    name: "observer.sounds.c.brinesleeper",
    tracks: list("music.brine.", "observer.sounds.br.m.", ["stillwater", "near", "chase", "sting"]),
    effects: [
      ...list("mob.brinesleeper.", "observer.sounds.br.s.", ["call", "moan", "roar", "hiss", "breathe", "click", "grasp", "lunge", "emerge", "submerge", "step", "hurt", "death"]),
      ["brine.spotted", "observer.sounds.br.s.spotted"],
      ["brine.jumpscare", "observer.sounds.br.s.jumpscare"],
      ["brine.heartbeat", "observer.sounds.br.s.heartbeat"],
    ],
  },
];

/** A creature by key (the Observer if unknown). @param {string} key */
export const creature = (key) => CREATURES.find((c) => c.key === key) ?? CREATURES[0];

/** What each player is hearing from here now: [the creature's name key, the track's key, or "playlist"]. @type {Map<string, [string, string]>} */
const playing = new Map();

/** Play one creature's track for this player only, looping. @param {Player} p @param {string} who @param {number} i */
export function playTrackOf(p, who, i) {
  const c = creature(who);
  const t = c.tracks[i];
  if (!t) return false;
  const ok = !!safe(() => {
    p.playMusic(t[0], { loop: true, fade: 0.5, volume: 1 });
    return true;
  }, false);
  if (ok) playing.set(p.id, [c.name, t[1]]);
  emit("sounds", { what: "track", player: p.name, who: c.key, id: t[0], ok });
  return ok;
}

/** One creature's whole playlist, one track after the next, once through. @param {Player} p @param {string} who */
export function playAll(p, who) {
  const c = creature(who);
  let n = 0;
  c.tracks.forEach(([id], i) => {
    const ok = safe(() => {
      if (i === 0) p.playMusic(id, { loop: false, fade: 0.5, volume: 1 });
      else p.queueMusic(id, { loop: false, fade: 0.5, volume: 1 });
      return true;
    }, false);
    if (ok) n++;
  });
  const ok = n === c.tracks.length;
  if (n) playing.set(p.id, [c.name, "observer.sounds.playlist"]);
  emit("sounds", { what: "playlist", player: p.name, who: c.key, n, ok });
  return ok;
}

/** Play one creature's sound beside this player. @param {Player} p @param {string} who @param {number} i */
export function playEffectOf(p, who, i) {
  const c = creature(who);
  const s = c.effects[i];
  if (!s) return false;
  const ok = !!safe(() => {
    p.playSound(s[0], { location: p.getHeadLocation(), volume: 1, pitch: 1 });
    return true;
  }, false);
  emit("sounds", { what: "sound", player: p.name, who: c.key, id: s[0], ok });
  return ok;
}

/** The Observer's (1.5.1). @param {Player} p @param {number} i */
export const playTrack = (p, i) => playTrackOf(p, "observer", i);
/** @param {Player} p @param {number} i */
export const playEffect = (p, i) => playEffectOf(p, "observer", i);

/** Stop the music this page started. @param {Player} p */
export function stop(p) {
  safe(() => p.stopMusic());
  playing.delete(p.id);
  emit("sounds", { what: "stop", player: p.name });
}

/** @param {string} pid */
export const forget = (pid) => playing.delete(pid);

/** What is playing, for a page's text. @param {Player} p */
function nowText(p) {
  const now = playing.get(p.id);
  return now
    ? { translate: "observer.sounds.now", with: { rawtext: [{ translate: now[0] }, { text: " — " }, { translate: now[1] }] } }
    : { translate: "observer.sounds.none" };
}

/** One creature's page: its playlist and its sounds; back to the creatures when you are done. @param {Player} p @param {Creature} c */
async function creaturePage(p, c) {
  for (let guard = 0; guard < 200 && p.isValid; guard++) {
    const f = new ActionFormData()
      .title({ rawtext: [{ translate: "observer.sounds.title" }, { text: " — " }, { translate: c.name }] })
      .body({ rawtext: [{ translate: "observer.sounds.page" }, { text: "\n\n" }, nowText(p)] });
    /** @type {(() => void | "back")[]} */
    const acts = [];
    f.button({ translate: "observer.sounds.back" });
    acts.push(() => "back");
    f.button({ translate: "observer.sounds.stop" });
    acts.push(() => stop(p));
    f.button({ translate: "observer.sounds.play_all" });
    acts.push(() => void playAll(p, c.key));
    c.tracks.forEach(([, key], i) => {
      f.button({ rawtext: [{ text: `§5♪ ${i + 1}. §r` }, { translate: key }] });
      acts.push(() => void playTrackOf(p, c.key, i));
    });
    c.effects.forEach(([, key], i) => {
      f.button({ rawtext: [{ text: "§8» §r" }, { translate: key }] });
      acts.push(() => void playEffectOf(p, c.key, i));
    });
    const r = await f.show(p);
    if (r.canceled || r.selection === undefined) return false;
    if (acts[r.selection]?.() === "back") return true;
  }
  return false;
}

/** The page: pick a creature, then something of its to hear; it stays open until you close it. @param {Player} p */
export async function openSoundTest(p) {
  for (let guard = 0; guard < 100 && p.isValid; guard++) {
    const f = new ActionFormData()
      .title({ translate: "observer.sounds.title" })
      .body({ rawtext: [{ translate: "observer.sounds.body" }, { text: "\n\n" }, nowText(p)] });
    f.button({ translate: "observer.sounds.stop" });
    for (const c of CREATURES) f.button({ rawtext: [{ text: "§4◉ §r" }, { translate: c.name }, { text: ` §8(${c.tracks.length} ♪, ${c.effects.length} »)` }] });
    const r = await f.show(p);
    if (r.canceled || r.selection === undefined) return;
    if (r.selection === 0) {
      stop(p);
      continue;
    }
    const c = CREATURES[r.selection - 1];
    if (c && !(await creaturePage(p, c))) return;
  }
}

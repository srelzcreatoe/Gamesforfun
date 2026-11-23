// @ts-check
// The Sound Test (1.5.1): every piece of its music and every sound it makes, to hear on demand from the Config Wheel —
// its two themes (your recordings), its own broken music from the fourth stage (stalking, the chase, its home, the
// end), and its sounds. Music plays on your music channel, looping, until you stop it or pick another track (only you
// hear it); a sound plays once, beside you. Open to everyone: it changes nothing.
import { ActionFormData } from "@minecraft/server-ui";
import { SOUNDS } from "../core/constants.js";
import { safe, emit } from "../core/util.js";

/** @typedef {import("@minecraft/server").Player} Player */

/** Its music, in the order it comes to you. [sound id, lang key] */
export const TRACKS = [
  [SOUNDS.themeAround, "observer.sounds.m.around"],
  [SOUNDS.themeMire, "observer.sounds.m.lurking"],
  [SOUNDS.musicStalk, "observer.sounds.m.stalk"],
  [SOUNDS.musicMire, "observer.sounds.m.mire"],
  [SOUNDS.musicChase, "observer.sounds.m.chase"],
  [SOUNDS.musicEnd, "observer.sounds.m.end"],
];

/** Its sounds. [sound id, lang key, pitch] */
export const EFFECTS = [
  [SOUNDS.presence, "observer.sounds.s.presence", 1],
  [SOUNDS.spotted, "observer.sounds.s.spotted", 1],
  [SOUNDS.whisper, "observer.sounds.s.whisper", 1],
  [SOUNDS.shriek, "observer.sounds.s.shriek", 1],
  [SOUNDS.vanish, "observer.sounds.s.vanish", 1],
  [SOUNDS.notice, "observer.sounds.s.notice", 1],
  [SOUNDS.voice, "observer.sounds.s.voice", 1],
  [SOUNDS.breath, "observer.sounds.s.breath", 1],
  [SOUNDS.heartbeat, "observer.sounds.s.heartbeat", 1],
  [SOUNDS.crack, "observer.sounds.s.crack", 1],
  [SOUNDS.knock, "observer.sounds.s.knock", 1],
  [SOUNDS.glitch, "observer.sounds.s.glitch", 1],
  [SOUNDS.static, "observer.sounds.s.static", 1],
  [SOUNDS.charmHum, "observer.sounds.s.charm", 1],
  [SOUNDS.drift, "observer.sounds.s.drift", 1],
  [SOUNDS.discovery, "observer.sounds.s.discovery", 1],
];

/** What each player is hearing from here now (a track's lang key). @type {Map<string, string>} */
const playing = new Map();

/** Play one of its tracks for this player only, looping. @param {Player} p @param {number} i index into TRACKS */
export function playTrack(p, i) {
  const t = TRACKS[i];
  if (!t) return false;
  const ok = !!safe(() => {
    p.playMusic(t[0], { loop: true, fade: 0.5, volume: 1 });
    return true;
  }, false);
  if (ok) playing.set(p.id, t[1]);
  emit("sounds", { what: "track", player: p.name, id: t[0], ok });
  return ok;
}

/** Play one of its sounds beside this player. @param {Player} p @param {number} i index into EFFECTS */
export function playEffect(p, i) {
  const s = EFFECTS[i];
  if (!s) return false;
  const ok = !!safe(() => {
    p.playSound(String(s[0]), { location: p.getHeadLocation(), volume: 1, pitch: Number(s[2]) });
    return true;
  }, false);
  emit("sounds", { what: "sound", player: p.name, id: s[0], ok });
  return ok;
}

/** Stop the music this page started. @param {Player} p */
export function stop(p) {
  safe(() => p.stopMusic());
  playing.delete(p.id);
  emit("sounds", { what: "stop", player: p.name });
}

/** @param {string} pid */
export const forget = (pid) => playing.delete(pid);

/** The page: pick something to hear; it stays open until you close it. @param {Player} p */
export async function openSoundTest(p) {
  for (let guard = 0; guard < 200 && p.isValid; guard++) {
    const now = playing.get(p.id);
    const f = new ActionFormData()
      .title({ translate: "observer.sounds.title" })
      .body({ rawtext: [{ translate: "observer.sounds.body" }, { text: "\n\n" }, now ? { translate: "observer.sounds.now", with: { rawtext: [{ translate: now }] } } : { translate: "observer.sounds.none" }] });
    /** @type {(() => void)[]} */
    const acts = [];
    f.button({ translate: "observer.sounds.stop" });
    acts.push(() => stop(p));
    TRACKS.forEach(([, key], i) => {
      f.button({ rawtext: [{ text: "§5♪ §r" }, { translate: key }] });
      acts.push(() => playTrack(p, i));
    });
    EFFECTS.forEach(([, key], i) => {
      f.button({ rawtext: [{ text: "§8» §r" }, { translate: String(key) }] });
      acts.push(() => playEffect(p, i));
    });
    const r = await f.show(p);
    if (r.canceled || r.selection === undefined) return;
    acts[r.selection]?.();
  }
}

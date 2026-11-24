// @ts-check
// It talks (1.5.0). It has been watching you long enough to have something to say — and it says it: in your chat, in a
// whisper across the bottom of your screen, in great broken letters over your view. What it says is about you: your
// name, where your home is, how many times you have died, how long since you slept, what you are holding, which way you
// always run. Its words break up as it speaks (the game's own scrambled letters), more the angrier and nearer it is.
// It answers what you do — you escape it, you look at it through the lens, you kill one of its own, you die, you lie
// down to sleep, you walk into its home — and now and then, when you are somewhere quiet, it asks you something and
// waits for your answer (a choice on your screen). What you answer changes what it does next.
// Fourth-wall scares (a setting of their own): a line that looks like the game's own ("The Observer joined the game"),
// a chat line in your own name that you never typed, and the screen cutting to static for a moment.
// It never reads what you type (that would need an experiment): it talks, and you answer by choosing.
// Settings: "It talks to you" and "Fourth-wall scares" (both on).
import { system, world } from "@minecraft/server";
import { ActionFormData, uiManager } from "@minecraft/server-ui";
import { S } from "../core/settings.js";
import { ps, now, markPlayerDirty } from "../core/state.js";
import { V, safe, emit, rand, pick, allPlayers, DEBUG } from "../core/util.js";
import { SOUNDS } from "../core/constants.js";
import { primaryHaunt } from "./memory.js";
import { discover } from "../progression/discoveries.js";

/** @typedef {import("@minecraft/server").Player} Player */

const on = () => S().enabled && S().talks !== false;
const fourthWall = () => on() && S().fourthWall !== false;

// ---------------------------------------------------------------- how it speaks

/**
 * Its words break up: whole words, and parts of words, turn into the game's scrambled letters (§k) for a moment.
 * @param {string} text @param {number} level 0 (clear) .. 1 (barely readable)
 */
export function glitch(text, level) {
  if (level <= 0) return text;
  return text.split(" ").map((w) => {
    const r = Math.random();
    if (w.length > 2 && r < level * 0.18) return `§k${w}§r§c`;
    if (w.length > 3 && r < level * 0.4) {
      const a = Math.floor(Math.random() * (w.length - 1));
      const b = Math.min(w.length, a + 1 + Math.floor(Math.random() * 2));
      return `${w.slice(0, a)}§k${w.slice(a, b)}§r§c${w.slice(b)}`;
    }
    // a stutter
    if (w.length > 1 && r > 1 - level * 0.12) return `${w[0]}-${w[0]}-${w}`;
    return w;
  }).join(" ");
}

/** Its name in your chat: never quite the same twice. @param {number} stage */
function speaker(stage) {
  const names = ["§4<The Observer>", "§4<§kThe§r§4 Observer>", "§4<The §kObserver§r§4>", "§4<§k???§r§4>", "§4<...>"];
  if (stage >= 5) names.push("§4<§lIT§r§4>", "§4<§k§lIT§r§4>");
  return pick(names);
}

/** How broken its words are: the stage, and how close it is. @param {Player} p */
function brokenness(p) {
  const s = ps(p);
  return Math.min(1, 0.1 + 0.12 * s.stage + (s.tension ?? 0) / 300);
}

/**
 * Fill in what it knows about them: {name} {hx} {hz} (their home) {deaths} {days} {item} {slept} {mined} {doors}
 * {here} (where they stand). @param {string} line @param {Player} p
 */
function fill(line, p) {
  const s = ps(p);
  const h = safe(() => primaryHaunt(p), undefined);
  const inv = safe(() => p.getComponent("minecraft:inventory")?.container, undefined);
  const held = inv ? safe(() => inv.getItem(p.selectedSlotIndex), undefined) : undefined;
  const item = held ? held.typeId.replace(/^[a-z_]+:/, "").replace(/_/g, " ") : "empty hand";
  const tod = safe(() => world.getTimeOfDay(), 6000) ?? 6000;
  const sinceSleep = s.lastSleep !== undefined ? Math.round(((tod - s.lastSleep + 24000) % 24000) / 1000) : undefined;
  const vals = {
    name: p.name,
    hx: h ? String(Math.round(h.center.x)) : "?",
    hz: h ? String(Math.round(h.center.z)) : "?",
    deaths: String(s.deaths ?? 0),
    days: String(Math.max(1, Math.floor((safe(() => world.getDay(), 1) ?? 1)))),
    item,
    slept: sinceSleep !== undefined ? `${sinceSleep} hours` : "too long",
    mined: String(s.tally?.mined ?? 0),
    doors: String(s.tally?.doors ?? 0),
    here: `${Math.round(p.location.x)}, ${Math.round(p.location.z)}`,
  };
  return line.replace(/\{(\w+)\}/g, (_, k) => vals[/** @type {keyof typeof vals} */ (k)] ?? "");
}

// ---------------------------------------------------------------- what it says

/** Lines by occasion. Those that need its knowledge of you are only used when it has it. */
const LINES = {
  greet: ["You came back, {name}.", "You were gone {days} days. I counted.", "I kept your place warm.", "Welcome back. I never left."],
  low: ["...{name}...", "Did you hear that?", "Turn around.", "Not yet.", "I like your house.", "You walk the same way every time.",
    "Keep going. I'm right behind you.", "Don't look.", "Quiet now."],
  mid: ["Your home is at {hx}, {hz}. I know the way.", "{deaths} times you have died. I watched every one.",
    "You haven't slept in {slept}.", "That {item} won't help you.", "You've opened {doors} doors. I was behind some of them.",
    "You dug {mined} blocks toward me.", "I can see you from here, {name}.", "Why do you keep looking over there? I'm over here.",
    "You're standing at {here}. So am I."],
  high: ["RUN.", "There is no out, {name}.", "I am in every one of them.", "I am everywhere you look away.", "{name}. {name}. {name}.",
    "You can't hide in your own head.", "Every creature here is mine. Every one is looking at you.", "I let you live. For now.",
    "This world is mine. You're only visiting."],
  chase: ["FOUND YOU.", "Too late, {name}.", "Where would you go?", "Run. It's better when you run.", "Nowhere to go."],
  ahead: ["Wrong way, {name}.", "I was here first.", "You can't outrun what's already ahead of you.", "Where are you going?", "Hello again."],
  hideout: ["I know where you hide, {name}.", "You always come here.", "I waited for you here.", "Same place as last time."],
  escaped: ["Run while you can.", "I let you go.", "Next time.", "Keep running. I like the sound."],
  repelled: ["Don't look at me like that.", "That light won't last.", "You can't hold me with glass.", "I'll be back before it's dark."],
  died: ["Again?", "That was too easy.", "Get up. We're not done.", "{deaths}. I'm keeping count."],
  killed_mine: ["That one was mine.", "I have more.", "You think that hurt me?", "It was only a body."],
  takeover: ["They're all mine now.", "Every one of them sees you.", "Look how many of me there are."],
  mire: ["You came home.", "Welcome to where I live.", "You shouldn't be here. Stay."],
  sleep: ["Sleep. I'll watch.", "Close your eyes, {name}.", "I'll be here when you wake."],
  lens: ["You can't hold me with glass.", "Look closer.", "I'm not in the glass. I'm behind you."],
  // the Rift (1.6.0)
  rift_arrive: ["Welcome to my woods, {name}.", "You came through. Nobody comes back through.", "This is where I keep them.",
    "Take what you like. Then try to leave.", "You came to me this time."],
  rift_taunt: ["I can hear you breathing.", "Every tree here is mine.", "Run, {name}. It's better when you run.", "Closer.",
    "The rain hides your footsteps. Not from me.", "I can see you from every tree."],
  rift_loot: ["That isn't yours.", "Put it back, {name}.", "Gold won't save you here.", "Greedy."],
  rift_guard: ["Leaving?", "Not that way.", "The stones are mine too.", "You don't get to go yet."],
  rift_back: ["Not yet.", "Back to the start, {name}.", "Again."],
  rift_left: ["Come back soon, {name}.", "You'll be back. The gold is still here.", "I'll leave it open for you."],
  stage2: ["Now you know."],
  stage3: ["I see you, {name}."],
  stage4: ["No more hiding."],
  stage5: ["I AM EVERYWHERE."],
};
/** @typedef {keyof typeof LINES} LineKey */

/** Its latest lines to this player (not to repeat itself). @type {Map<string, string[]>} */
const recent = new Map();

/** @param {Player} p @param {LineKey} key */
function line(p, key) {
  const said = recent.get(p.id) ?? [];
  const h = safe(() => primaryHaunt(p), undefined);
  const pool = LINES[key].filter((l) => !said.includes(l) && (h || !/\{h[xz]\}/.test(l)));
  const l = pick(pool.length ? pool : LINES[key]);
  said.push(l);
  if (said.length > 8) said.shift();
  recent.set(p.id, said);
  return fill(l, p);
}

/**
 * Say something to one player. how: "chat" (a line in their chat, from it), "whisper" (across the bottom of the
 * screen, with a breath), "title" (great broken letters across their view).
 * @param {Player} p @param {LineKey} key @param {"chat"|"whisper"|"title"} [how]
 */
export function say(p, key, how) {
  if (!on() || !p.isValid) return false;
  const s = ps(p);
  const way = how ?? (s.stage >= 4 && Math.random() < 0.2 ? "title" : Math.random() < 0.55 ? "whisper" : "chat");
  const text = line(p, key);
  const level = brokenness(p);
  if (way === "chat") {
    safe(() => p.sendMessage(`${speaker(s.stage)}§r §c${glitch(text, level)}`));
    safe(() => p.playSound(SOUNDS.glitch, { volume: 0.35, pitch: 0.8 + Math.random() * 0.3 }));
  } else if (way === "whisper") {
    safe(() => p.onScreenDisplay.setActionBar(`§4${glitch(text, level * 0.8)}`));
    safe(() => p.playSound(SOUNDS.whisper, { volume: 0.5 }));
  } else {
    const loud = text.toUpperCase();
    safe(() => p.onScreenDisplay.setTitle(`§4${glitch(loud, Math.min(1, level + 0.2))}`, { fadeInDuration: 0, stayDuration: 30, fadeOutDuration: 10, subtitle: "§k||||||||||" }));
    safe(() => p.playSound(SOUNDS.glitch, { volume: 0.8, pitch: 0.6 }));
  }
  s.talkLast = now();
  markPlayerDirty(p);
  emit("talk", { what: "say", player: p.name, key, how: way, text });
  return true;
}

// ---------------------------------------------------------------- the fourth wall

/**
 * A scare from outside the game's world: a line like the game's own, a chat line in their own name, or the screen
 * cutting to static. @param {Player} p @param {"joined"|"own_name"|"static"} [kind]
 */
export function fourth(p, kind) {
  if (!fourthWall() || !p.isValid) return false;
  const k = kind ?? pick(["joined", "own_name", "static"]);
  if (k === "joined") safe(() => p.sendMessage("§eThe Observer joined the game"));
  else if (k === "own_name") safe(() => p.sendMessage(`<${p.name}> ${pick(["it's behind me", "help", "i can see it", "why is it smiling", "don't come to my house"])}`));
  else {
    if (S().camera < 1) return false;
    safe(() => p.camera.fade({ fadeTime: { fadeInTime: 0, holdTime: 0.9, fadeOutTime: 0.3 }, fadeColor: { red: 0.02, green: 0, blue: 0 } }));
    safe(() => p.onScreenDisplay.setTitle("§4§k||||||§r §4ERROR §k||||||", { fadeInDuration: 0, stayDuration: 18, fadeOutDuration: 4, subtitle: `§8${glitch(`${p.name}.exe has stopped responding`, 0.5)}` }));
    safe(() => p.playSound(SOUNDS.static, { volume: 0.9 }));
  }
  emit("talk", { what: "fourth_wall", player: p.name, kind: k });
  return true;
}

// ---------------------------------------------------------------- it asks you something

/**
 * Questions, and what each answer does. act: a hook main.js fills in ("show" it appears close by, "angry" its next
 * encounter comes at once and angrier, "inside" it is inside with them, "knock" it knocks, "calm" a little quiet).
 */
const QUESTIONS = [
  { q: "{name}. Do you know what I am?", a: [["No.", "Then let me show you.", "show"], ["Leave me alone.", "No.", "angry"], ["You're not real.", "Turn around.", "show"]] },
  { q: "Are you alone?", a: [["Yes.", "Good.", "show"], ["No.", "You are now.", "angry"]], lie: true },
  { q: "Why do you keep coming back?", a: [["I'm not afraid of you.", "You will be.", "angry"], ["I don't know.", "I do.", "show"], ["...", "Good. Stay quiet.", "calm"]] },
  { q: "Can I come in?", a: [["No.", "I wasn't asking.", "knock"], ["Yes.", "Thank you.", "inside"]], home: true },
  { q: "Do you want to see my face?", a: [["No.", "You will.", "angry"], ["Yes.", "Look behind you.", "show"]] },
  { q: "What would you give me to leave you alone tonight?", a: [["Anything.", "Then give me tonight.", "calm"], ["Nothing.", "Then I'll take it.", "angry"]] },
];

/** Hooks main.js fills in: what an answer does. */
export const hooks = { /** @type {((p:Player, what:string)=>void)|undefined} */ act: undefined };

/** Open (one at a time, per player). @type {Set<string>} */
const asking = new Set();

/** Is now a fair moment to ask them something? (quiet, unhurt, nothing near, not busy) @param {Player} p */
function fairMoment(p) {
  const hp = safe(() => p.getComponent("minecraft:health"), undefined);
  if (hp && hp.currentValue < hp.effectiveMax * 0.6) return false;
  if (safe(() => p.isFlying || p.isGliding || p.isSwimming || p.isSleeping, false)) return false;
  if (safe(() => p.getComponent("minecraft:riding")?.entityRidingOn, undefined)) return false;
  const near = safe(() => p.dimension.getEntities({ location: p.location, maxDistance: 12, families: ["monster"] }), []) ?? [];
  return near.length === 0;
}

/** Ask them something and act on the answer. @param {Player} p @param {number} [index] @returns {Promise<boolean>} */
export async function ask(p, index) {
  if (!on() || !p.isValid || asking.has(p.id)) return false;
  const s = ps(p);
  const atHome = (() => {
    const h = safe(() => primaryHaunt(p), undefined);
    return !!h && V.hdist(p.location, h.center) < 24;
  })();
  const pool = QUESTIONS.map((q, i) => ({ q, i })).filter(({ q }) => !q.home || atHome);
  const pickQ = index !== undefined ? { q: QUESTIONS[index], i: index } : pick(pool);
  if (!pickQ) return false;
  const { q, i } = pickQ;
  asking.add(p.id);
  s.askAt = now();
  markPlayerDirty(p);
  safe(() => p.playSound(SOUNDS.static, { volume: 0.6, pitch: 0.7 }));
  const f = new ActionFormData().title(`§4§k::§r §4${glitch("?", 0)} §k::`).body(`§c${glitch(fill(q.q, p), brokenness(p) * 0.5)}`);
  for (const [label] of q.a) f.button(`§8${label}`);
  emit("talk", { what: "ask", player: p.name, q: i });
  /** @type {any} */
  let r;
  // it waits for an answer — but not forever: left unanswered (or nobody there to answer) it takes that as one
  const patience = DEBUG.talk === "always" ? 80 : 20 * 60;
  let timer;
  const timeout = new Promise((res) => {
    timer = system.runTimeout(() => {
      safe(() => uiManager.closeAllForms(p));
      res({ canceled: true, timedOut: true });
    }, patience);
  });
  try {
    r = await Promise.race([f.show(p), timeout]);
  } catch {
    r = { canceled: true };
  }
  if (timer !== undefined) safe(() => system.clearRun(/** @type {number} */ (timer)));
  asking.delete(p.id);
  if (!p.isValid) return false;
  if (r.canceled || r.selection === undefined) {
    // no answer: it does not like that
    safe(() => p.sendMessage(`${speaker(s.stage)}§r §c${glitch("Answer me.", brokenness(p))}`));
    safe(() => p.playSound(SOUNDS.knock, { volume: 1 }));
    s.askAt = now() - 600; // it will ask again soon
    emit("talk", { what: "answer", player: p.name, q: i, a: -1 });
    return true;
  }
  const [, reply, act0] = q.a[r.selection];
  let act = act0;
  let text = reply;
  // a lie (in company, "Yes, I am alone"): it knows
  if (q.lie && r.selection === 0 && allPlayers().some((o) => o.id !== p.id && o.dimension.id === p.dimension.id && V.dist(o.location, p.location) < 48)) {
    text = "Liar.";
    act = "angry";
  }
  system.runTimeout(() => {
    if (!p.isValid) return;
    safe(() => p.sendMessage(`${speaker(s.stage)}§r §c${glitch(fill(text, p), brokenness(p))}`));
    safe(() => p.playSound(SOUNDS.glitch, { volume: 0.5, pitch: 0.7 }));
    safe(() => hooks.act?.(p, act));
  }, 30);
  emit("talk", { what: "answer", player: p.name, q: i, a: r.selection, act });
  discover(p, "it_speaks");
  return true;
}

// ---------------------------------------------------------------- when it speaks

/** How long each player's next wait is (a factor for talking, seconds for asking). @type {Map<string, {talk:number, ask:number}>} */
const rolls = new Map();

/** Every second, per player: something to say, now and then; more, and more broken, the further it has come. */
export function tick() {
  if (!on() || DEBUG.talk === "never") return;
  const t = now();
  for (const p of allPlayers()) {
    const s = ps(p);
    if (s.stage < 1 || (s.witnessed && s.endMode === "rest")) continue;
    // (each wait is rolled once, when the last one has run: rolled every second it would always land near the shortest)
    let r = rolls.get(p.id);
    if (!r) rolls.set(p.id, (r = { talk: rand(0.75, 1.5), ask: rand(1200, 2400) }));
    // it talks: every 4-7 minutes at the second stage, every 45-90 s at the fifth
    const every = DEBUG.talk === "always" ? 8 : [0, 300, 200, 140, 90, 60][s.stage] * r.talk;
    if (t - (s.talkLast ?? -1e9) >= every && s.stage >= 2) {
      r.talk = rand(0.75, 1.5);
      say(p, s.stage >= 4 ? (Math.random() < 0.6 ? "high" : "mid") : s.stage >= 3 ? (Math.random() < 0.6 ? "mid" : "low") : "low");
      // and, rarely, from outside the game
      if (s.stage >= 3 && Math.random() < (DEBUG.talk === "always" ? 0 : 0.12)) system.runTimeout(() => fourth(p), 60);
    }
    // it asks: from the third stage, about every 20-40 minutes, at a fair moment
    const askEvery = DEBUG.talk === "always" ? 20 : r.ask;
    if (s.stage >= 3 && t - (s.askAt ?? 0) >= askEvery && fairMoment(p) && !asking.has(p.id)) {
      r.ask = rand(1200, 2400);
      ask(p).catch(() => asking.delete(p.id));
    }
  }
}

/** When something happens it has a word to say about. @param {Player} p @param {LineKey} key @param {number} [chance] */
export function react(p, key, chance = 1) {
  if (!on() || DEBUG.talk === "never" || !p?.isValid || Math.random() > chance) return false;
  if (ps(p).stage < 1) return false;
  return say(p, key);
}

/** @param {string} pid */
export const forget = (pid) => {
  recent.delete(pid);
  rolls.delete(pid);
  asking.delete(pid);
};

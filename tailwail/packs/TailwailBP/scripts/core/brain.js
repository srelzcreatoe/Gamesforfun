// Tailwail's encounter state machine (v3: the relentless hunter).  Pure: no Minecraft imports.
//
//   stalk (beats: watch / peek / tall / cross) -> standoff -> engage (scream) -> hunt
//   hunt <-> attack (swipe, combo, slam, pounce) | grab (struggle -> free | finisher)
//   attack / finisher -> savor -> hunt      free -> stunned -> hunt      (it never just leaves)
//   hunt -> climb | bash | reach -> hunt;  hunt -> search -> hunt | leave
//   ambush (cling / huddle) -> engage;  any -> flee (wounded) | leave | death
//
// Every state has an entry action, update rules, a hard time ceiling and a cleanup path.
// The adapter (mc/encounter.js) builds a perception snapshot each decision tick and
// implements `ctx`.  Tests drive the same class with a mock ctx (tests/helpers.mjs).
import { AGITATION, AMBUSH, CHASE, CLIP, DT, GRAB, IMITATION, RETREAT, SEARCH, SPEED, STALK, STANDOFF } from "../config.js";
import { createAgitation, stepAgitation } from "./agitation.js";
import { allow, createLimiter } from "./audio_rules.js";
import { chooseAttack, createCooldowns, hitLands, pickFinisher, spendAttack, struggleSpec } from "./combat_rules.js";
import { cancelImitation, createDetector, createImitator, observe, offer, updateImitator } from "./gestures.js";
import { SHOT } from "./ids.js";
import { SETUPS } from "./setups.js";

export const STATES = ["stalk", "standoff", "engage", "hunt", "attack", "grab", "savor", "stunned", "search", "climb", "bash",
  "reach", "ambush", "leave", "flee", "death"];
const HUNTING = new Set(["engage", "hunt", "attack", "grab", "savor", "stunned", "climb", "bash", "reach", "search"]);

// Hard ceilings per state (seconds).  A state that overstays always resolves somewhere safe.
export const MAX_STATE_TIME = {
  stalk: STALK.hardCap + 5,
  standoff: STANDOFF.durationMax + 8,
  engage: SHOT.rise.len + SHOT.scream.len + 1,
  hunt: CHASE.hardCap + 5,
  attack: 3,
  grab: GRAB.lunge + GRAB.window[1] + 0.8 + SHOT.smash.len + 2,
  savor: GRAB.savor[1] + 1,
  stunned: GRAB.stunned[1] + 1,
  search: SEARCH.maxDuration + SHOT.howl.len + 3,
  climb: 9,
  bash: 12,
  reach: CHASE.reachInTime[1] + 1.5,
  ambush: AMBUSH.waitMax + 4,
  leave: RETREAT.hardCap,
  flee: 20,
  death: CLIP.death + 2,
};

/** Look of the creature at an agitation level: tail, breath, tremor, jaw (degrees). */
export function agitationLook(a) {
  if (a >= 85) return { tail: "lash", breath: "frantic", tremor: 3, jaw: 30 };
  if (a >= AGITATION.cueThree) return { tail: "curl", breath: "frantic", tremor: 2, jaw: 20 };
  if (a >= AGITATION.cueTwo) return { tail: "lash", breath: "heavy", tremor: 1, jaw: 10 };
  return { tail: "free", breath: "heavy", tremor: 1, jaw: 6 };
}

export class Brain {
  /**
   * @param {object} o
   * @param {string} o.setup
   * @param {object} o.settings world settings (resolved)
   * @param {object} o.memory player memory record (mutated with observations)
   * @param {object} o.rng   seeded rng from util/rng.js
   * @param {object} o.ctx   adapter (see mc/encounter.js)
   * @param {{type:string,pitch:number}|null} o.remembered gesture to open with, if any
   * @param {boolean} [o.showcase] spawned by egg/command: skip the slow parts
   * @param {number} [o.stage] the target's escalation stage (0..3)
   */
  constructor(o) {
    this.setup = o.setup;
    this.def = SETUPS[o.setup] || SETUPS.stalker;
    this.settings = o.settings;
    this.memory = o.memory;
    this.rng = o.rng;
    this.ctx = o.ctx;
    this.remembered = o.remembered || null;
    this.showcase = !!o.showcase;
    this.stage = Math.max(0, Math.min(3, o.stage | 0));
    this.t = 0;
    this.state = null;
    this.stateT = 0;
    this.outcome = null;
    this.done = false;
    this.agit = createAgitation(0);
    this.detector = createDetector();
    this.imitator = createImitator();
    this.audio = createLimiter();
    this.cd = createCooldowns();
    this.vis = { act: "loco", tail: "free", breath: "heavy", tremor: 1, jaw: 6, look: "target", postureCap: null, postureWant: null };
    this.shot = null;
    this.noticeT = -1;
    this.watchFor = 0;
    this.grabs = 0;
    this.attacks = 0;
    this.hitsLanded = 0;
    this.lastSeen = null;
    this.sinceSeen = 0;
    this.retargetUsed = false;
    this.history = [];
    this.flags = new Set(); // things that happened (journal / memory hooks read these)
    this.pendingHits = 0;
    this.pendingDamageOthers = 0;
    this.huntStartT = -1;
    const op = this.def.opener;
    if (op === "hunt") this.enter("engage", "hunter");
    else if (op === "cling" || op === "huddle") this.enter("ambush", op);
    else if (op === "behind") this.enter("ambush", "behind");
    else this.enter("stalk", "spawn");
  }

  // ------------------------------------------------------------------ helpers
  log(msg) {
    if (this.history.length > 60) this.history.shift();
    this.history.push(`${this.t.toFixed(1)} ${msg}`);
    if (this.ctx.log) this.ctx.log(msg);
  }

  cue(name) {
    if (allow(this.audio, name, this.t)) this.ctx.cue(name);
  }

  fx(name, arg) {
    if (this.ctx.fx) this.ctx.fx(name, arg);
  }

  flag(name) {
    if (!this.flags.has(name)) {
      this.flags.add(name);
      if (this.ctx.onFlag) this.ctx.onFlag(name);
    }
  }

  enter(state, why) {
    const prev = this.state;
    if (prev && this["exit_" + prev]) this["exit_" + prev](state);
    this.state = state;
    this.stateT = 0;
    this.log(`${prev || "-"} -> ${state} (${why})`);
    this["enter_" + state](why);
  }

  finish(outcome) {
    if (!this.outcome) this.outcome = outcome;
  }

  get committed() {
    return HUNTING.has(this.state);
  }

  canRetarget() {
    return !this.retargetUsed && (this.state === "stalk" || this.state === "standoff" || this.state === "ambush");
  }

  markRetarget() {
    this.retargetUsed = true;
  }

  onHit(attackerIsTarget, amount = 0) {
    this.pendingHits += 1;
    if (!attackerIsTarget) this.pendingDamageOthers += amount;
    if (this.state !== "death" && this.state !== "grab" && this.ctx.play) this.ctx.play("flinch");
  }

  memoryReaction(kind, amt) {
    if (this.ctx.recordReaction) this.ctx.recordReaction(kind, amt);
  }

  die() {
    if (this.state !== "death") this.enter("death", "killed");
  }

  despawn() {
    if (this.done) return;
    this.done = true;
    this.ctx.despawn(this.outcome || "observed");
  }

  leave(outcome, why) {
    this.finish(outcome);
    if (this.state !== "leave") this.enter("leave", why);
  }

  /** Plays a one-shot clip; full-body clips put the body in the neutral "shot" state. */
  play(name) {
    const s = SHOT[name];
    if (!s) return;
    this.shot = { name, t0: this.t, len: s.len, partial: s.partial, fired: 0 };
    if (!s.partial) this.vis.act = "shot";
    if (this.ctx.play) this.ctx.play(name);
  }

  shotDone() {
    return !this.shot || this.t - this.shot.t0 >= this.shot.len - 1e-6;
  }

  shotT() {
    return this.shot ? this.t - this.shot.t0 : 99;
  }

  /** Number of this one-shot's hit frames that have been reached and not yet handled. */
  dueHits() {
    if (!this.shot) return 0;
    const hits = SHOT[this.shot.name].hits || [];
    let n = 0;
    while (this.shot.fired < hits.length && this.shotT() >= hits[this.shot.fired] - 1e-6) {
      this.shot.fired += 1;
      n += 1;
    }
    return n;
  }

  reached(goal, r = 1.6) {
    const c = this.snap ? this.snap.creature.pos : null;
    if (!goal || !c) return false;
    return Math.hypot(goal.x - c.x, goal.z - c.z) < r && Math.abs(goal.y - c.y) < 2.5;
  }

  locoAct(low) {
    return low ? "loco_low" : "loco";
  }

  // ------------------------------------------------------------------ main update
  update(snap, dt = DT) {
    if (this.done) return;
    this.t += dt;
    this.stateT += dt;
    this.snap = snap;
    const tg = snap.target;
    this.hits = this.pendingHits;
    this.pendingHits = 0;

    if (this.state !== "death" && this.state !== "leave" && this.state !== "grab" && this.state !== "flee") {
      if (!tg.valid || !tg.alive || !tg.eligible || tg.dist > 80) {
        const died = tg.valid && tg.alive === false; // a disconnect is not a kill
        this.finish(died ? (this.committed ? "caught" : "aborted") : this.committed ? "escaped" : "aborted");
        this.enter("leave", died ? "target-dead" : "target-lost");
      }
    }
    // wounded: it runs for its life (and remembers)
    const c = snap.creature;
    if (c.maxHealth && this.state !== "death" && this.state !== "flee" && this.state !== "grab" &&
        c.health / c.maxHealth <= (this.settings.fleeAt ?? 0.35) && this.settings.fleeAt > 0) {
      this.finish("wounded");
      this.enter("flee", "wounded");
    }

    // learning: only while it can see the target, and only before it commits
    if ((this.state === "stalk" || this.state === "standoff") && tg.valid && tg.canSee) {
      const g = observe(this.detector, { sneaking: tg.sneaking, pitch: tg.pitch, speed: tg.speed }, this.t);
      if (g) {
        if (this.ctx.recordGesture) this.ctx.recordGesture(g.type, g.pitch || 0);
        const r = offer(this.imitator, g, this.t, this.agit.value, this.rng, IMITATION.chance);
        if (r) {
          this.log(`imitate ${r.type} in ${(r.at - this.t).toFixed(1)}s`);
          this.flag("mirror");
        }
      }
    }
    this.watchFor = tg.valid && tg.watching ? this.watchFor + dt : 0;
    if (this.noticeT < 0 && this.watchFor >= STALK.noticeTime) {
      this.noticeT = this.t;
      this.flag("noticed");
    }
    if (tg.valid && tg.canSee) {
      this.lastSeen = tg.pos;
      this.sinceSeen = 0;
    } else {
      this.sinceSeen += dt;
    }

    this["update_" + this.state](snap, dt);
    if (!this.done && this.stateT > MAX_STATE_TIME[this.state]) this.onOverstay();
    this.publish();
  }

  onOverstay() {
    this.log(`overstay in ${this.state}`);
    switch (this.state) {
      case "leave":
      case "flee":
        if (!this.snap.anyInView) this.despawn();
        return;
      case "death":
        return;
      case "stalk":
      case "standoff":
      case "ambush":
        return this.enter("engage", "overstay");
      case "grab":
        return this.afterGrab("overstay");
      case "hunt":
        if (this.ctx.scheduleReturn) this.ctx.scheduleReturn();
        return this.leave("escaped", "hunt-cap");
      case "search":
        return this.leave("escaped", "overstay");
      default:
        return this.enter("hunt", "overstay");
    }
  }

  publish() {
    const mimicOk = this.state === "stalk" || this.state === "standoff";
    const im = mimicOk ? updateImitator(this.imitator, this.t) : { mimic: "none", amt: 0, pitch: 0 };
    const v = this.vis;
    // imitation shows on the plain standing states only
    const act = im.mimic !== "none" && (v.act === "watch" || v.act === "tall") ? "loco" : v.act;
    this.ctx.setVisual({
      state: this.state,
      act,
      tail: v.tail,
      breath: v.breath,
      tremor: v.tremor,
      jaw: v.jaw,
      look: v.look,
      mimic: im.mimic,
      mimicAmt: im.amt,
      mimicPitch: im.pitch,
      postureCap: v.postureCap,
      postureWant: v.postureWant,
    });
  }

  // ------------------------------------------------------------------ STALK (short beats)
  enter_stalk() {
    const f = this.ctx.stalkFactor ? this.ctx.stalkFactor() : 1;
    const extra = this.showcase ? -1 : 0;
    this.s = {
      beats: Math.max(1, Math.round(this.rng.int(STALK.beatsMin, STALK.beatsMax) * f) + extra),
      done: 0,
      beat: null,
      cap: this.showcase ? 25 : STALK.hardCap,
    };
    this.vis = { ...this.vis, act: "loco", tail: "free", breath: "heavy", tremor: 1, jaw: 6, look: "target", postureCap: null, postureWant: null };
    this.startBeat(this.def.firstBeat || null);
  }

  startBeat(kind) {
    const s = this.s;
    const tg = this.snap ? this.snap.target : null;
    let k = kind;
    if (!k) {
      const r = this.rng.next();
      k = r < STALK.crossChance ? "cross" : r < STALK.crossChance + 0.25 ? "peek" : this.rng.chance(0.35) ? "tall" : "watch";
    }
    const near = Math.max(STALK.nearMin, 22 - s.done * 4);
    let spot = null;
    if (k === "peek" && this.ctx.findCover) spot = this.ctx.findCover();
    if (k === "cross" && this.ctx.findCrossPath) {
      const path = this.ctx.findCrossPath();
      if (path) {
        s.beat = { kind: "cross", phase: "run", a: path.a, b: path.b, t0: this.t };
        if (this.ctx.placeAt) this.ctx.placeAt(path.a, path.b);
        this.vis.act = "loco";
        this.log("beat cross");
        return;
      }
      k = "watch";
    }
    if (!spot && this.ctx.findObservationSpot) {
      spot = this.ctx.findObservationSpot({ min: near, max: Math.max(near + 6, STALK.farMax - s.done * 4), visible: true });
    }
    s.beat = { kind: k === "peek" && !spot ? "watch" : k, phase: spot ? "move" : "show", spot, t0: this.t, showT: 0, seenT: -1,
      hold: this.rng.range(STALK.watchMin, STALK.watchMax), side: spot && spot.side ? spot.side : this.rng.chance(0.5) ? "l" : "r" };
    if (tg && tg.valid && !spot) s.beat.phase = "show";
    this.log(`beat ${s.beat.kind} (${s.done + 1}/${s.beats})`);
  }

  nextBeat(why) {
    const s = this.s;
    s.done += 1;
    if (s.done >= s.beats) return this.enter("standoff", why);
    this.startBeat(null);
  }

  update_stalk(snap, dt) {
    const s = this.s;
    const tg = snap.target;
    const b = s.beat;
    if (this.stateT >= s.cap) return this.enter("standoff", "stalk-cap");
    if (this.hits) return this.enter("engage", "provoked");
    if (tg.dist < STALK.approachStandoff && this.noticeT >= 0 && tg.closing > 0.8) return this.enter("standoff", "approached");
    if (b.kind === "cross") {
      this.vis.act = "loco";
      this.ctx.moveTo(b.b, SPEED.burst, "cross");
      if (this.reached(b.b, 2.2) || this.t - b.t0 > 9 || snap.creature.stuck) {
        if (tg.inView && this.rng.chance(STALK.chargeChance[this.stage] + 0.1)) return this.enter("engage", "cross-charge");
        return this.nextBeat("crossed");
      }
      return;
    }
    if (b.phase === "move") {
      this.vis.act = "loco";
      this.vis.look = "target";
      // it does not care much whether you see it moving now; it just goes there fast
      this.ctx.moveTo(b.spot, snap.anyInView ? SPEED.walk : SPEED.burst, "stalk");
      if (this.reached(b.spot, 1.8) || snap.creature.stuck || this.t - b.t0 > 12) {
        this.ctx.hold();
        b.phase = "show";
        b.showT = this.t;
      }
      return;
    }
    if (b.phase === "show") {
      this.ctx.hold();
      if (tg.valid) this.ctx.faceToward(tg.pos);
      this.vis.act = b.kind === "peek" ? (b.side === "l" ? "peek_l" : "peek_r") : b.kind === "tall" && snap.creature.headroom >= 5 ? "tall"
        : snap.creature.headroom < 4 ? "watch_low" : "watch";
      if (tg.watching && b.seenT < 0) {
        b.seenT = this.t;
        this.cue("click");
      }
      if (b.seenT >= 0 && this.t - b.seenT >= STALK.reactDelay) {
        const charge = STALK.chargeChance[this.stage] + 0.12 * s.done + (this.showcase ? 0.2 : 0);
        const r = this.rng.next();
        if (r < charge) return this.enter("engage", "seen-charge");
        if (r < charge + (1 - charge) * STALK.bolt && s.done + 1 < s.beats) {
          b.phase = "bolt";
          b.boltT = this.t;
          b.away = this.ctx.findRetreatSpot ? this.ctx.findRetreatSpot(14, 24) : null;
          this.cue("skitter");
          this.memoryReaction("stare", 0.2);
          return;
        }
        return this.enter("standoff", "seen-hold");
      }
      if (this.t - b.showT >= b.hold) return this.nextBeat("unnoticed");
      return;
    }
    if (b.phase === "bolt") {
      this.vis.act = "loco";
      if (b.away) this.ctx.moveTo(b.away, SPEED.burst, "bolt");
      if (!snap.anyInView && this.t - b.boltT > 1.0) return this.nextBeat("bolted");
      if (this.t - b.boltT > 5 || !b.away || snap.creature.stuck) return this.nextBeat("bolted");
    }
  }

  // ------------------------------------------------------------------ STANDOFF (seconds, not minutes)
  enter_standoff(why) {
    const late = this.stage >= 2 ? 0.6 : 1;
    this.so = {
      until: this.rng.range(STANDOFF.durationMin, STANDOFF.durationMax) * late * (this.showcase ? 0.7 : 1),
      nextCreep: STANDOFF.creepEvery,
      unwatched: 0,
      creep: null,
      creepT: 0,
      perfAt: this.rng.range(STANDOFF.perfMinGap, STANDOFF.perfMaxGap),
      why,
    };
    const tall = this.snap && this.snap.creature.headroom >= 5 && this.rng.chance(0.55);
    this.vis = { ...this.vis, act: tall ? "tall" : "watch_low", look: "target", ...agitationLook(this.agit.value), postureWant: null };
    this.ctx.hold();
    this.cue("growl");
    this.fx("standoff_on");
    this.flag("standoff");
    if (this.remembered && this.ctx.onRemembered) {
      this.ctx.onRemembered(this.remembered.type);
      this.flag("remembered");
    }
  }

  update_standoff(snap, dt) {
    const tg = snap.target;
    const so = this.so;
    const r = stepAgitation(this.agit, { watched: tg.watching, distance: tg.dist, closing: tg.closing, sprinting: tg.sprinting,
      hits: this.hits, movingAway: tg.movingAway }, dt, this.settings.agitationScale || 1);
    Object.assign(this.vis, agitationLook(this.agit.value));
    this.fx("standoff_level", this.agit.value);
    if (this.hits) return this.enter("engage", "provoked");
    if (tg.dist <= STANDOFF.tooClose) return this.enter("engage", "too-close");
    so.unwatched = tg.watching || tg.glance ? 0 : so.unwatched + dt;
    if (so.unwatched >= STANDOFF.turnAwayCharge && this.stateT > 1.0) return this.enter("engage", "turned-away");
    if (this.agit.value >= AGITATION.max - 0.5) return this.enter("engage", "agitated");
    if (this.stateT >= so.until) return this.enter("engage", "timeout");
    // it creeps at you even while you watch it now
    if (so.creep) {
      this.vis.act = "loco_low";
      this.ctx.moveTo(so.creep, SPEED.creep, "creep");
      if (this.reached(so.creep, 1.2) || this.t - so.creepT > 1.6) {
        so.creep = null;
        this.ctx.hold();
        this.vis.act = this.rng.chance(0.5) ? "watch_low" : snap.creature.headroom >= 5 ? "tall" : "watch";
        this.cue("creak");
      }
    } else {
      this.ctx.hold();
      if (tg.valid) this.ctx.faceToward(tg.pos);
      if (this.stateT >= so.nextCreep && tg.dist > STANDOFF.tooClose + 1.5 && this.ctx.findCreepPoint) {
        so.creep = this.ctx.findCreepPoint(STANDOFF.creepStep, STANDOFF.tooClose);
        so.creepT = this.t;
        so.nextCreep = this.stateT + STANDOFF.creepEvery * this.rng.range(0.7, 1.3);
      }
    }
    if (this.stateT >= so.perfAt) {
      so.perfAt = this.stateT + this.rng.range(STANDOFF.perfMinGap, STANDOFF.perfMaxGap);
      const pick = this.rng.weighted([["click", 3], ["growl", 2], ["breath_close", 1]]);
      this.cue(pick);
    }
    if (r.reasons.includes("sprint-start")) this.memoryReaction("flee", 0.3);
  }

  exit_standoff() {
    cancelImitation(this.imitator);
  }

  // ------------------------------------------------------------------ ENGAGE: the scream
  enter_engage(why) {
    this.ctx.hold();
    const tg = this.snap ? this.snap.target : null;
    if (tg && tg.valid && this.ctx.faceNow) this.ctx.faceNow(tg.pos);
    this.vis = { ...this.vis, tail: "rigid", breath: "frantic", tremor: 2, jaw: 0, look: "none", postureWant: null };
    this.fx("silence");
    const far = !tg || !tg.valid || tg.dist > 30;
    // from a crouch it unfolds first (the last warning) - unless it is already mid-hunt
    const rise = !far && (why === "timeout" || why === "agitated") && this.snap && this.snap.creature.headroom >= 5;
    this.e = { rise, screamed: false, far, short: why === "regained" || why === "ambush" || why === "stunned" };
    if (this.e.short) {
      this.play("roar");
      this.cue("roar");
      this.e.screamed = true;
      this.e.end = SHOT.roar.len;
    } else if (rise) {
      this.play("rise");
      this.cue("inhale");
    } else {
      this.startScream();
    }
    this.flag("scream");
  }

  startScream() {
    // the full wail stands it up to ~5 blocks: under a lower ceiling it roars from all fours
    const low = this.snap && this.snap.creature.headroom < 5;
    this.play(low ? "roar" : "scream");
    this.cue(this.e.far ? "scream_far" : "scream");
    this.e.screamed = true;
    this.e.screamT = this.t;
    this.e.end = SHOT.scream.len;
  }

  update_engage(snap) {
    const e = this.e;
    this.ctx.hold();
    if (!e.screamed) {
      if (this.shotDone()) this.startScream();
      return;
    }
    if (!e.fxDone && this.shotT() >= (SHOT[this.shot.name].peak || 0.4)) {
      e.fxDone = true;
      this.fx(e.far ? "scream_far" : "scream", { short: e.short });
    }
    if (this.shotDone()) this.enter("hunt", "engaged");
  }

  // ------------------------------------------------------------------ HUNT: relentless
  enter_hunt(why) {
    if (this.huntStartT < 0) this.huntStartT = this.t;
    this.h = {
      screechAt: this.rng.range(1.5, 3),
      snuffAt: 0.5,
      stuckTries: 0,
      roarAt: this.t + this.rng.range(CHASE.roarEvery[0], CHASE.roarEvery[1]),
      lostFor: 0,
      hiddenFor: 0,
      why,
    };
    this.vis = { ...this.vis, act: "loco", tail: "lash", breath: "frantic", tremor: 1, jaw: 22, look: "target", postureCap: null, postureWant: null };
    this.fx("chase_on", { resumed: why !== "engaged" });
    this.flag("chase");
    this.shot = null;
  }

  update_hunt(snap, dt) {
    const tg = snap.target;
    const h = this.h;
    const visible = tg.canSee && tg.dist <= CHASE.sightRange && !(tg.hidden && tg.dist > SEARCH.hiddenDetect);
    if (!visible && tg.noise && this.t - tg.noise.t < 1.0) this.lastSeen = tg.noise.pos;
    h.lostFor = visible ? 0 : h.lostFor + dt;
    h.hiddenFor = !visible && tg.hidden ? h.hiddenFor + dt : 0;
    this.vis.act = "loco";
    if (this.stateT >= h.screechAt) {
      this.cue("screech");
      h.screechAt = this.stateT + this.rng.range(CHASE.screechMin, CHASE.screechMax);
    }
    if (this.stateT >= h.snuffAt && this.settings.torchSnuff) {
      this.fx("snuff_path");
      h.snuffAt = this.stateT + CHASE.snuffEvery;
    }
    if (this.t - this.huntStartT > CHASE.hardCap) {
      if (this.ctx.scheduleReturn) this.ctx.scheduleReturn();
      return this.leave("escaped", "hunt-cap");
    }
    // ---- you crawled into a hole it cannot fit: it reaches in after you
    if (tg.inGap && tg.hdist < 3.2) return this.enter("reach", "gap");
    // ---- attacks
    if (visible && tg.alive) {
      const kind = chooseAttack({
        t: this.t, geom: snap.reach, settings: this.settings, rng: this.rng, cd: this.cd, headroom: snap.creature.headroom,
        canGrab: !!this.settings.grab && !!(snap.reach && snap.reach.holdClear), tunnel: snap.creature.posture === "crawl",
      });
      if (kind === "grab") return this.enter("grab", "reach");
      if (kind) return this.enter("attack", kind);
      // regained sight after losing it: a roar, then on
      if (h.regainedRoar && tg.dist > 6 && this.t >= this.cd.roar) {
        h.regainedRoar = false;
        this.cd.roar = this.t + 8;
        return this.enter("engage", "regained");
      }
    } else if (h.lostFor > 2.5) {
      h.regainedRoar = true;
    }
    // ---- terrain: doors and glass, ledges, holes
    const blk = snap.creature.blocked;
    if (blk && this.settings.breakBlocks > 0 && tg.dist < 24) return this.enter("bash", blk);
    // ---- losing you
    const lostTime = this.settings.lostSeconds || 8;
    if (h.lostFor >= lostTime && tg.dist >= CHASE.lostDistance) return this.enter("search", "lost-sight");
    if (h.hiddenFor >= 3) return this.enter("search", "hidden");
    const goal = visible ? tg.pos : this.lastSeen;
    if (!goal) return this.enter("search", "no-goal");
    if (!visible && h.lostFor > 1 && this.reached(this.lastSeen, 2.0)) return this.enter("search", "reached-last-known");
    if (snap.creature.stuck) {
      // you are up on something it cannot path to: it climbs
      if (this.settings.climbing && visible && tg.dy >= CHASE.climbMinRise && tg.dy <= CHASE.climbMaxRise && tg.hdist < 10) {
        return this.enter("climb", "ledge");
      }
      h.stuckTries += 1;
      this.log(`stuck (${h.stuckTries})`);
      if (h.stuckTries > CHASE.recoveryAttempts) return this.enter("search", "stuck");
      this.ctx.recover(h.stuckTries);
      return;
    }
    if (this.stateT > 2 && h.stuckTries && snap.creature.atGoal) h.stuckTries = 0;
    this.ctx.moveTo(goal, this.settings.chaseSpeed, "hunt");
  }

  // ------------------------------------------------------------------ ATTACK (one-shot with hit frames)
  enter_attack(kind) {
    this.attacks += 1;
    spendAttack(this.cd, kind, this.t, this.rng);
    this.a = { kind, landed: 0, pounced: false };
    this.ctx.hold();
    const tg = this.snap.target;
    if (tg.valid && this.ctx.faceNow) this.ctx.faceNow(tg.pos);
    this.vis = { ...this.vis, tail: "rigid", jaw: 0, look: "none" };
    this.play(kind);
    this.cue(kind === "slam" ? "slam_windup" : kind === "pounce" ? "pounce" : "swipe");
  }

  update_attack(snap) {
    const a = this.a;
    const tg = snap.target;
    if (a.kind === "pounce" && !a.pounced && this.shotT() >= (SHOT.pounce.launch || 0.2)) {
      a.pounced = true;
      if (tg.valid && this.ctx.pounce) this.ctx.pounce(tg.pos);
    } else if (a.kind !== "pounce") {
      this.ctx.hold();
    }
    const n = this.dueHits();
    for (let i = 0; i < n; i++) {
      const lands = hitLands(a.kind, snap.reach);
      if (lands) {
        a.landed += 1;
        this.hitsLanded += 1;
        this.ctx.dealDamage(a.kind);
        this.cue(a.kind === "slam" ? "slam" : "impact");
        this.flag("hit");
      } else if (a.kind === "slam") {
        this.cue("slam");
        this.fx("slam_shock");
      }
    }
    if (this.shotDone()) {
      if (!tg.alive) return this.leave("caught", "killed-target");
      // pinned under a pounce: sometimes it picks you straight up
      if (a.kind === "pounce" && a.landed && this.settings.grab && snap.reach && snap.reach.holdClear && this.rng.chance(0.35) &&
          this.t >= this.cd.grab) {
        return this.enter("grab", "pinned");
      }
      if (a.landed && (a.kind === "slam" || a.kind === "pounce" || this.rng.chance(0.25))) return this.enter("savor", a.kind);
      return this.enter("hunt", "after-" + a.kind);
    }
  }

  // ------------------------------------------------------------------ GRAB (struggle, then free or a finisher)
  enter_grab(why) {
    spendAttack(this.cd, "grab", this.t, this.rng);
    const spec = struggleSpec(this.settings, this.rng, this.grabs);
    this.grabs += 1;
    this.g = { phase: "lunge", phaseT: this.t, spec, released: false, holding: false, finisher: null, why };
    this.pendingDamageOthers = 0;
    this.vis = { ...this.vis, tail: "rigid", breath: "frantic", tremor: 1, jaw: 30, look: "none", postureCap: null };
    this.ctx.hold();
    const tg = this.snap.target;
    if (tg.valid && this.ctx.faceNow) this.ctx.faceNow(tg.pos);
    if (!this.ctx.grabStart(spec)) {
      this.log("grab refused by adapter");
      this.cd.grab = this.t + 1.5;
      this.g = null;
      return this.enter("hunt", "grab-refused");
    }
    this.g.holding = true;
    this.play("lunge_grab");
    this.cue("grab");
    this.flag("grabbed");
    this.log(`grab: ${spec.kind} x${spec.needed} in ${spec.window.toFixed(1)}s${spec.inescapable ? " (inescapable)" : ""}${spec.shiftAt ? " shift->" + spec.shiftTo : ""}`);
  }

  setGrabPhase(p) {
    this.g.phase = p;
    this.g.phaseT = this.t;
  }

  update_grab(snap) {
    const g = this.g;
    if (!g) return;
    const since = this.t - g.phaseT;
    this.ctx.hold();
    const gs = snap.grab || { holding: false };
    if (g.holding && !gs.holding && (g.phase === "lunge" || g.phase === "hold")) {
      // the victim is gone (died, left, changed dimension)
      g.holding = false;
      g.released = true;
      this.ctx.grabEnd("lost");
      this.log("grab lost its victim");
      return this.leave(snap.target.valid && !snap.target.alive ? "caught" : "aborted", "victim-gone");
    }
    if (g.phase === "lunge") {
      if (since >= GRAB.lunge) {
        this.setGrabPhase("hold");
        this.vis.act = "hold";
        this.cue("hold");
        if (this.ctx.grabStruggle) this.ctx.grabStruggle();
      }
      return;
    }
    if (g.phase === "hold") {
      this.vis.act = "hold";
      this.vis.jaw = Math.round(24 + 30 * Math.min(1, since / g.spec.window));
      if (gs.success || this.pendingDamageOthers >= GRAB.othersDamageToDrop) {
        this.log(gs.success ? "struggled-free" : "dropped");
        g.holding = false;
        g.released = true;
        this.ctx.grabEnd("free");
        this.cue("pain");
        this.flag("struggle");
        this.memoryReaction("attack", 0.3);
        return this.enter("stunned", "struggled-free");
      }
      if (gs.calm) {
        // "don't move" honoured: it sniffs you, loses interest for a moment and lets go
        g.holding = false;
        g.released = true;
        this.ctx.grabEnd("drop");
        this.flag("still");
        return this.enter("savor", "dropped-still");
      }
      if (gs.failed || since >= g.spec.window + 1.0) {
        const fin = pickFinisher(this.rng, snap.creature.headroom);
        g.finisher = fin;
        this.setGrabPhase("finisher");
        this.play(fin);
        this.cue(fin === "bite" ? "bite_windup" : "roar");
      }
      return;
    }
    if (g.phase === "finisher") {
      const s = SHOT[g.finisher];
      const at = s.release ?? (s.hits ? s.hits[0] : 0.4);
      if (!g.released && since >= at) {
        g.released = true;
        g.holding = false;
        this.ctx.grabEnd(g.finisher);
        this.cue(g.finisher === "bite" ? "bite" : g.finisher === "smash" ? "slam" : "throw");
        this.hitsLanded += 1;
      }
      if (this.shotDone()) {
        if (!snap.target.alive) return this.leave("caught", "killed-target");
        return this.enter("savor", g.finisher);
      }
    }
  }

  afterGrab(why) {
    if (this.g && this.g.holding && !this.g.released) {
      this.g.released = true;
      this.g.holding = false;
      this.ctx.grabEnd("abort");
    }
    this.enter("hunt", why);
  }

  exit_grab() {
    if (this.g && this.g.holding && !this.g.released) {
      this.g.released = true;
      this.g.holding = false;
      this.ctx.grabEnd("abort");
    }
  }

  // ------------------------------------------------------------------ SAVOR / STUNNED: a beat, then it hunts on
  enter_savor(why) {
    this.sv = { until: this.rng.range(GRAB.savor[0], GRAB.savor[1]), why };
    this.vis = { ...this.vis, act: "savor", tail: "curl", breath: "heavy", tremor: 0, jaw: 10, look: "target" };
    this.ctx.hold();
    this.cue("growl");
  }

  update_savor(snap) {
    this.ctx.hold();
    if (snap.target.valid) this.ctx.faceToward(snap.target.pos);
    if (!snap.target.alive) return this.leave("caught", "killed-target");
    if (this.stateT >= this.sv.until) {
      this.cue("screech");
      return this.enter("hunt", "savored");
    }
  }

  enter_stunned() {
    this.st = { until: this.rng.range(GRAB.stunned[0], GRAB.stunned[1]) };
    this.vis = { ...this.vis, act: "stunned", tail: "lash", breath: "frantic", tremor: 2, jaw: 26, look: "none" };
    this.ctx.hold();
  }

  update_stunned() {
    this.ctx.hold();
    if (this.stateT >= this.st.until) return this.enter("engage", "stunned");
  }

  // ------------------------------------------------------------------ CLIMB / BASH / REACH
  enter_climb() {
    this.vis = { ...this.vis, act: "climb", tail: "free", look: "target" };
    this.ctx.hold();
    const goal = this.snap.target.pos;
    this.cl = { ok: !!(this.ctx.climbStart && this.ctx.climbStart(goal)) };
    if (this.cl.ok) {
      this.cue("climb");
      this.flag("climb");
    }
  }

  update_climb(snap) {
    if (!this.cl.ok) return this.enter("search", "cannot-climb");
    if (!snap.creature.climbing) {
      this.cue("screech");
      return this.enter("hunt", "climbed");
    }
    if (this.stateT > 8) {
      if (this.ctx.climbAbort) this.ctx.climbAbort();
      return this.enter("search", "climb-timeout");
    }
  }

  exit_climb() {
    if (this.snap && this.snap.creature.climbing && this.ctx.climbAbort) this.ctx.climbAbort();
  }

  enter_bash(blk) {
    this.ctx.hold();
    this.bh = { ok: !!(this.ctx.bashStart && this.ctx.bashStart()), kind: blk };
    this.vis = { ...this.vis, act: this.bh.ok ? "bash" : "loco", tail: "lash", jaw: 30, look: "none" };
    if (this.bh.ok) this.flag("bash");
  }

  update_bash(snap) {
    if (!this.bh.ok) return this.enter("hunt", "bash-refused");
    this.ctx.hold();
    if (!snap.creature.bashing) {
      this.cue("roar");
      return this.enter("hunt", "broke-through");
    }
  }

  exit_bash() {
    if (this.ctx.bashStop) this.ctx.bashStop();
  }

  enter_reach() {
    this.ctx.hold();
    const tg = this.snap.target;
    if (tg.valid && this.ctx.faceNow) this.ctx.faceNow(tg.pos);
    this.rc = { until: this.rng.range(CHASE.reachInTime[0], CHASE.reachInTime[1]), nextHit: 0.9 };
    this.vis = { ...this.vis, act: "reach_in", tail: "lash", jaw: 26, look: "target" };
    this.cue("growl");
    this.flag("reach");
  }

  update_reach(snap) {
    this.ctx.hold();
    if (this.stateT >= this.rc.nextHit) {
      this.rc.nextHit = this.stateT + this.rng.range(0.7, 1.2);
      this.cue("scrape");
      if (hitLands("reach", snap.reach)) this.ctx.dealDamage("reach");
    }
    if (!snap.target.inGap && snap.target.canSee && snap.target.hdist > 3.5) return this.enter("hunt", "out-of-the-hole");
    if (this.stateT >= this.rc.until) return this.enter("search", "gave-up-reaching");
  }

  // ------------------------------------------------------------------ SEARCH (sniffing, listening)
  enter_search(why) {
    const origin = this.lastSeen || (this.snap ? this.snap.creature.pos : null);
    const pts = origin && this.ctx.findSearchPoints ? this.ctx.findSearchPoints(origin, SEARCH.points, SEARCH.radius) : [];
    this.se = { pts, i: 0, phase: "go", phaseT: this.t, why, howled: false };
    this.vis = { ...this.vis, act: "loco", tail: "free", breath: "heavy", tremor: 1, jaw: 8, look: "none" };
    this.fx("search_on");
    this.cue("sniff");
    this.flag("lost");
  }

  update_search(snap) {
    const tg = snap.target;
    const se = this.se;
    const visible = tg.canSee && tg.dist <= CHASE.sightRange && !(tg.hidden && tg.dist > SEARCH.hiddenDetect);
    if (se.phase === "howl") {
      this.ctx.hold();
      if (this.shotDone()) {
        if (this.ctx.scheduleReturn && this.rng.chance(SEARCH.returnChance)) this.ctx.scheduleReturn();
        return this.leave(this.se.why === "hidden" ? "hid" : "escaped", "gave-up");
      }
      return;
    }
    if (visible && tg.alive) {
      this.cue("screech");
      return this.enter("engage", "regained");
    }
    if (tg.inGap && tg.hdist < 3.2) return this.enter("reach", "found-in-gap");
    if (tg.noise && this.t - tg.noise.t < 1.2) {
      this.lastSeen = tg.noise.pos;
      se.pts = [tg.noise.pos];
      se.i = 0;
      se.phase = "go";
      se.phaseT = this.t;
      this.flag("noise");
      this.cue("click");
    }
    if (this.stateT >= SEARCH.maxDuration || (!se.pts.length && this.stateT > 4)) {
      se.phase = "howl";
      this.vis.act = "shot";
      this.play("howl");
      this.cue("howl");
      return;
    }
    const goal = se.pts[se.i % Math.max(1, se.pts.length)];
    if (se.phase === "go") {
      this.vis.act = "loco";
      if (!goal) return;
      this.ctx.moveTo(goal, SPEED.search, "search");
      if (this.reached(goal, 1.8) || snap.creature.stuck || this.t - se.phaseT > 7) {
        se.phase = this.rng.chance(0.5) ? "sniff" : "listen";
        se.phaseT = this.t;
        this.ctx.hold();
        this.cue(se.phase === "sniff" ? "sniff" : "click");
      }
    } else {
      this.ctx.hold();
      this.vis.act = se.phase;
      if (this.t - se.phaseT >= SEARCH.listen * (se.phase === "sniff" ? 1.6 : 1)) {
        se.i += 1;
        se.phase = "go";
        se.phaseT = this.t;
      }
    }
  }

  // ------------------------------------------------------------------ AMBUSH (ceiling / corner / behind you)
  enter_ambush(kind) {
    this.am = { kind, ok: false, stare: 0, triggered: false };
    this.vis = { ...this.vis, tail: "free", breath: "calm", tremor: 0, jaw: 4, look: "target" };
    if (kind === "cling") {
      this.am.ok = !!(this.ctx.cling && this.ctx.cling());
      this.vis.act = "cling";
      this.vis.postureWant = "crawl";
    } else if (kind === "huddle") {
      this.am.ok = !!(this.ctx.huddle && this.ctx.huddle());
      this.vis.act = "huddle";
      this.vis.look = "none";
    } else {
      this.am.ok = true;
      this.vis.act = "watch_low";
      this.cue("breath_close");
    }
    if (!this.am.ok) {
      this.log(`ambush ${kind} has no spot: stalking instead`);
      return this.enter("stalk", "no-ambush-spot");
    }
    this.flag(kind === "cling" ? "ceiling" : kind === "huddle" ? "huddle" : "behind");
  }

  update_ambush(snap, dt) {
    const tg = snap.target;
    const am = this.am;
    if (am.triggered) {
      if (this.shotDone()) {
        if (am.kind === "cling") this.cue("thud");
        return this.enter("engage", "ambush");
      }
      return;
    }
    this.ctx.hold();
    am.stare = tg.watching ? am.stare + dt : 0;
    const go = (why) => {
      am.triggered = true;
      this.log("ambush triggers: " + why);
      if (am.kind === "cling") {
        if (this.ctx.drop) this.ctx.drop();
        this.play("drop");
        this.cue("scream_close");
      } else if (am.kind === "huddle") {
        if (tg.valid && this.ctx.faceNow) this.ctx.faceNow(tg.pos);
        this.play("turn");
        this.cue("scream_close");
      } else {
        this.play("roar");
        this.cue("scream_close");
      }
    };
    if (this.hits) return go("hit");
    if (am.kind === "cling") {
      if (tg.valid && tg.hdist <= AMBUSH.dropRange) return go("underneath");
      if (am.stare >= AMBUSH.lookUpDrop && tg.dist < 14) return go("seen");
    } else if (am.kind === "huddle") {
      if (tg.dist <= AMBUSH.huddleTrigger) return go("close");
      if (am.stare >= AMBUSH.huddleStare && tg.dist < 16) return go("stared");
    } else if (tg.watching || tg.dist < 3 || this.stateT > 6) {
      return go("turned-around");
    }
    if (this.stateT >= AMBUSH.waitMax) {
      if (am.kind === "cling" && this.ctx.drop) this.ctx.drop();
      return this.leave("observed", "nobody-came");
    }
  }

  // ------------------------------------------------------------------ LEAVE / FLEE
  enter_leave(why) {
    const f = this.ctx.retreatFactor ? this.ctx.retreatFactor() : 1;
    const dmin = (RETREAT.distanceMin * f) | 0;
    this.lv = { spot: this.ctx.findRetreatSpot ? this.ctx.findRetreatSpot(dmin, RETREAT.distanceMax) : null, respots: 0, why,
      owl: this.rng.chance(RETREAT.owlChance) && why !== "target-dead" };
    this.vis = { ...this.vis, act: "loco", tail: "free", breath: "heavy", tremor: 0, jaw: 4, look: this.lv.owl ? "back" : "none",
      postureCap: null, postureWant: null };
    this.fx("end");
    this.shot = null;
  }

  update_leave(snap) {
    const lv = this.lv;
    if (this.stateT > RETREAT.minBeforeDespawn && !snap.anyInView) return this.despawn();
    if (!lv.spot || snap.creature.stuck) {
      if (lv.respots++ < RETREAT.respots && this.ctx.findRetreatSpot) lv.spot = this.ctx.findRetreatSpot(RETREAT.hideDistance, RETREAT.distanceMax);
      if (!lv.spot) {
        this.ctx.hold();
        if (this.stateT > RETREAT.maxDuration) this.despawn();
        return;
      }
    }
    this.ctx.moveTo(lv.spot, SPEED.retreat, "leave");
    if (this.reached(lv.spot, 2.0)) {
      this.ctx.hold();
      if (!snap.anyInView || this.stateT > RETREAT.maxDuration) this.despawn();
    }
  }

  enter_flee() {
    this.fl = { spot: this.ctx.findRetreatSpot ? this.ctx.findRetreatSpot(24, 40) : null };
    this.vis = { ...this.vis, act: "loco", tail: "rigid", breath: "frantic", tremor: 2, jaw: 40, look: "none" };
    this.cue("scream_pain");
    this.fx("end");
    this.flag("wounded");
    this.memoryReaction("attack", 0.6);
    this.shot = null;
  }

  update_flee(snap) {
    if (this.stateT > 1.5 && !snap.anyInView) return this.despawn();
    if (this.fl.spot) this.ctx.moveTo(this.fl.spot, SPEED.flee, "flee");
    else this.ctx.hold();
    if (this.stateT > 12) this.despawn();
  }

  // ------------------------------------------------------------------ DEATH
  enter_death() {
    this.finish("killed");
    this.vis = { ...this.vis, act: "death", tail: "free", breath: "none", tremor: 0, jaw: 50, look: "none", postureWant: null };
    this.ctx.hold();
    this.cue("death");
    this.fx("end");
    this.flag("killed");
    this.shot = null;
  }

  update_death() {
    if (this.stateT >= CLIP.death + 1.2) this.despawn();
  }
}

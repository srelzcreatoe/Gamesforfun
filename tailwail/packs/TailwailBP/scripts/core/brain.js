// Tailwail's encounter state machine.  Pure: no Minecraft imports.
//
// States: stalk -> standoff -> unfold -> windup -> chase -> search -> retreat (-> done)
//         plus death.  Every state has an entry action, update rules, interrupts,
//         a maximum duration and a cleanup path (see docs/STATE_MACHINE.md).
//
// The adapter (mc/encounter.js) builds a perception snapshot each decision tick and
// implements `ctx` (movement, spot finding, sounds, damage, despawn).  Tests drive the
// same class with a mock ctx.
import {
  AGITATION, CHASE, CLIP, DT, IMITATION, RETREAT, SEARCH, SPEED, STALK, STANDOFF,
} from "../config.js";
import { createAgitation, cueLevel, stepAgitation } from "./agitation.js";
import { createLimiter, allow, rearm } from "./audio_rules.js";
import { abortStrike, canStartStrike, createStrikeState, finishStrike, resolveImpact, startStrike } from "./combat_rules.js";
import { cancelImitation, createDetector, createImitator, observe, offer, schedule, updateImitator } from "./gestures.js";
import { SETUPS } from "./setups.js";

export const STATES = ["stalk", "standoff", "unfold", "windup", "chase", "search", "retreat", "death"];

// Hard ceilings per state (seconds).  A state that overstays always resolves somewhere safe.
export const MAX_STATE_TIME = {
  stalk: STALK.hardCap,
  standoff: STANDOFF.durationMax + 5,
  unfold: CLIP.unfold + 0.5,
  windup: CLIP.windup + 0.5,
  chase: 60,
  search: SEARCH.maxDuration + CLIP.ambush + 2,
  retreat: RETREAT.hardCap,
  death: CLIP.death + 2,
};

export class Brain {
  /**
   * @param {object} o
   * @param {string} o.setup
   * @param {object} o.settings world settings (resolved)
   * @param {object} o.memory player memory record (mutated with observations)
   * @param {object} o.rng   seeded rng from util/rng.js
   * @param {object} o.ctx   adapter (see mc/encounter.js)
   * @param {{type:string,pitch:number}|null} o.remembered gesture to open with, if any
   */
  constructor(o) {
    this.setup = o.setup;
    this.def = SETUPS[o.setup];
    this.settings = o.settings;
    this.memory = o.memory;
    this.rng = o.rng;
    this.ctx = o.ctx;
    this.remembered = o.remembered || null;
    this.t = 0;
    this.state = null;
    this.stateT = 0;
    this.outcome = null;
    this.done = false;
    this.agit = createAgitation(0);
    this.detector = createDetector();
    this.imitator = createImitator();
    this.audio = createLimiter();
    this.strike = createStrikeState();
    this.vis = { tail: "drag", voice: "breath", agit: 1, action: "none", look: null, postureCap: null, postureWant: null };
    this.noticeT = -1;
    this.retargetUsed = false;
    this.history = []; // compact transition log for diagnostics
    this.seenGestures = [];
    this.enter("stalk", "spawn");
  }

  // ------------------------------------------------------------------ helpers
  log(msg) {
    if (this.history.length > 40) this.history.shift();
    this.history.push(`${this.t.toFixed(1)} ${msg}`);
    this.ctx.log && this.ctx.log(msg);
  }

  cue(name) {
    if (allow(this.audio, name, this.t)) this.ctx.cue(name);
  }

  enter(state, why) {
    const prev = this.state;
    if (prev && this["exit_" + prev]) this["exit_" + prev]();
    this.state = state;
    this.stateT = 0;
    this.log(`${prev || "-"} -> ${state} (${why})`);
    this["enter_" + state]();
  }

  finish(outcome) {
    if (!this.outcome) this.outcome = outcome;
  }

  canRetarget() {
    return !this.retargetUsed && (this.state === "stalk" || this.state === "standoff");
  }

  markRetarget() {
    this.retargetUsed = true;
    this.detector = createDetector();
    cancelImitation(this.imitator);
  }

  /** Called by the adapter when a player hits Tailwail (any player). */
  onHit(attackerIsTarget) {
    this.pendingHits = (this.pendingHits || 0) + 1;
    if (attackerIsTarget) this.memoryReaction("attack", 0.4);
    if (this.state === "retreat") this.cue("snarl");
  }

  memoryReaction(kind, amt) {
    if (this.ctx.recordReaction) this.ctx.recordReaction(kind, amt);
  }

  die() {
    if (this.state !== "death") this.enter("death", "killed");
  }

  // ------------------------------------------------------------------ main update
  update(snap, dt = DT) {
    if (this.done) return;
    this.t += dt;
    this.stateT += dt;
    this.snap = snap;
    const tg = snap.target;
    this.hits = this.pendingHits || 0;
    this.pendingHits = 0;

    if (this.state !== "death" && this.state !== "retreat") {
      if (!tg.valid || !tg.alive || !tg.dimensionOk || !tg.eligible || tg.dist > 72) {
        this.finish(tg.alive === false && this.state === "chase" ? "caught" : this.state === "chase" ? "escaped" : "aborted");
        this.enter("retreat", !tg.alive ? "target-dead" : "target-lost");
      }
    }

    // learning: only while Tailwail can see the target, and only before commitment
    if ((this.state === "stalk" || this.state === "standoff") && tg.valid && tg.canSee) {
      const g = observe(this.detector, { sneaking: tg.sneaking, pitch: tg.pitch, speed: tg.speed }, this.t);
      if (g) {
        this.seenGestures.push(g.type);
        if (this.ctx.recordGesture) this.ctx.recordGesture(g.type, g.pitch || 0);
        const r = offer(this.imitator, g, this.t, this.agit.value, this.rng, this.settings.imitationChance);
        if (r) this.log(`imitate ${r.type} in ${(r.at - this.t).toFixed(1)}s amt ${r.amt.toFixed(2)}`);
      }
    }
    if (tg.valid && tg.watching && this.noticeT < 0 && this.watchFor >= STALK.noticeTime) {
      this.noticeT = this.t;
    }
    this.watchFor = tg.valid && tg.watching ? (this.watchFor || 0) + dt : 0;

    this["update_" + this.state](snap, dt);
    if (this.stateT > MAX_STATE_TIME[this.state] && !this.done) this.onOverstay();
    this.publish();
  }

  onOverstay() {
    this.log(`overstay in ${this.state}`);
    if (this.state === "retreat") {
      if (!this.snap.anyWatching) this.despawn();
      return;
    }
    if (this.state === "death") return;
    if (this.state === "unfold") return this.enter("windup", "overstay");
    if (this.state === "windup") return this.enter("chase", "overstay");
    this.finish(this.state === "chase" || this.state === "search" ? "escaped" : "observed");
    this.enter("retreat", "overstay");
  }

  publish() {
    const im = this.state === "stalk" || this.state === "standoff" ? updateImitator(this.imitator, this.t) : { mimic: "none", amt: 0, pitch: 0 };
    if (this.forceMimic) Object.assign(im, this.forceMimic);
    this.ctx.setVisual({
      state: this.state,
      tail: this.vis.tail,
      voice: this.vis.voice,
      agit: this.vis.agit,
      action: this.vis.action,
      look: this.vis.look,
      mimic: im.mimic,
      mimicAmt: im.amt,
      mimicPitch: im.pitch,
      postureCap: this.vis.postureCap,
      postureWant: this.vis.postureWant,
    });
  }

  /** Arrival test against the brain's OWN goal (the mover forgets its goal on hold). */
  reached(goal, r = 1.6) {
    if (!goal || !this.snap) return false;
    const p = this.snap.creature.pos;
    return Math.hypot(p.x - goal.x, p.z - goal.z) < r && Math.abs(p.y - goal.y) < 2.5;
  }

  despawn() {
    if (this.done) return;
    this.done = true;
    this.finish("observed");
    this.ctx.despawn(this.outcome);
  }

  // ------------------------------------------------------------------ STALK
  enter_stalk() {
    const f = this.ctx.stalkFactor ? this.ctx.stalkFactor() : 1;
    this.s = {
      dur: this.rng.range(STALK.durationMin, STALK.durationMax) * f,
      nextMove: 0,
      goal: null,
      phase: this.setup === "distant_silhouette" ? "silhouette" : "hidden",
      approachStare: 0,
      peeksLeft: this.def.peeks ? this.rng.int(this.def.peeks[0], this.def.peeks[1]) : 0,
      hidingUntil: 0,
      breathAt: this.rng.range(4, 10),
      nailAt: this.rng.range(8, 20),
      watchDur: this.rng.range(STALK.silhouetteWatchMin, STALK.silhouetteWatchMax),
      noticeWait: this.rng.range(STALK.withdrawAfterNoticeMin, STALK.withdrawAfterNoticeMax),
      rememberedDone: !this.remembered,
      peekSide: this.rng.chance(0.5) ? "peek_l" : "peek_r",
    };
    this.vis = { tail: "drag", voice: "breath", agit: 1, action: "none", look: null, postureCap: null,
      postureWant: this.def.posture === "crawl" ? "crawl" : null };
  }

  update_stalk(snap, dt) {
    const tg = snap.target;
    const s = this.s;
    this.vis.look = tg.canSee ? "target" : null;
    this.vis.action = "none";

    if (this.hits > 0) {
      stepAgitation(this.agit, { watched: false, distance: tg.dist, closing: 0, sprinting: false, hits: this.hits, movingAway: false }, dt, this.settings.agitationScale);
      return this.enter("standoff", "provoked");
    }

    // signature: open with a gesture remembered from an earlier encounter, before the player does it
    if (!s.rememberedDone && tg.watching && this.watchFor >= 0.6) {
      s.rememberedDone = true;
      const r = schedule(this.imitator, this.remembered.type, this.t + 0.4, 10, this.rng, this.remembered.pitch);
      this.log(`remembered gesture ${r.type}`);
      if (this.ctx.onRemembered) this.ctx.onRemembered(r.type);
    }

    // ambient cues, spaced out so the player can keep mining between them
    if (this.t >= s.breathAt && tg.dist < 26) {
      this.cue("breath_far");
      s.breathAt = this.t + this.rng.range(STALK.breathMin, STALK.breathMax);
    }
    if (this.t >= s.nailAt && this.def.cues.includes("nail_scrape") && !snap.anyWatching) {
      this.cue("nail_scrape");
      s.nailAt = this.t + this.rng.range(STALK.nailGapMin, STALK.nailGapMax);
    }

    const noticed = this.noticeT >= 0;

    // ---- setup specific resolutions
    if (this.def.withdrawAfterNotice && noticed && this.t - this.noticeT >= s.noticeWait) {
      this.finish("observed");
      return this.enter("retreat", "voluntary-withdrawal");
    }
    if (this.def.escalateWithin && noticed && tg.dist <= this.def.escalateWithin) {
      this.memoryReaction("approach", 0.3);
      if (this.rng.chance(0.55)) return this.enter("standoff", "approached");
      this.finish("interrupted");
      return this.enter("retreat", "approached-withdraw");
    }
    if (this.setup === "distant_silhouette" && noticed && this.t - this.noticeT >= s.watchDur) {
      this.finish("observed");
      return this.enter("retreat", "silhouette-done");
    }
    if (this.setup === "low_tunnel_observation" && this.stateT >= s.dur) {
      this.finish("observed");
      return this.enter("retreat", "tunnel-done");
    }

    // ---- approach into the stand-off
    if (s.phase === "approach") {
      if (tg.watching) s.approachStare += dt;
      else s.approachStare = 0;
      if ((s.approachStare >= STALK.interruptStare && tg.dist > 14) || snap.others.nearCreature > 0) {
        this.memoryReaction("stare", 0.3);
        this.finish("interrupted");
        return this.enter("retreat", "approach-interrupted");
      }
      if (!s.goal || this.stateT > s.approachDeadline) {
        if (tg.dist <= STALK.standoffMax + 1 && tg.canSee) return this.enter("standoff", "in-view");
        this.finish("observed");
        return this.enter("retreat", "no-standoff-spot");
      }
      if (this.reached(s.goal) || (tg.dist <= STALK.standoffMax && tg.canSee && tg.watching)) {
        return this.enter("standoff", "arrived");
      }
      this.ctx.moveTo(s.goal, tg.watching ? SPEED.creep : SPEED.walk, "approach");
      return;
    }

    const readyToApproach = this.def.approach && this.stateT >= s.dur && (noticed || this.stateT >= s.dur * 1.5);
    if (readyToApproach && !(this.def.peeks && s.peeksLeft > 0)) {
      const spot = this.ctx.findStandoffSpot(STALK.standoffMin, STALK.standoffMax, this.def.reveal ? this.def.needsHeadroom : 0);
      if (spot) {
        s.phase = "approach";
        s.goal = spot;
        s.approachDeadline = this.stateT + 25;
        if (this.def.reveal) this.vis.postureWant = "hunch"; // stays folded until it stands in view
        this.log("approach to stand-off");
        return;
      }
    }
    if (this.stateT >= s.dur * 1.8 && this.def.approach) {
      this.finish("observed");
      return this.enter("retreat", "stalk-expired");
    }

    // ---- corner peeks: show a sliver, withdraw when stared at
    if (this.def.peeks) {
      if (this.t < s.hidingUntil) {
        if (s.goal) this.ctx.moveTo(s.goal, SPEED.walk, "hide");
        return;
      }
      if (tg.watching && this.watchFor >= STALK.peekHideStare) {
        s.peeksLeft -= 1;
        this.cue("tail_scrape");
        const cover = this.ctx.findCover();
        s.goal = cover;
        s.hidingUntil = this.t + this.rng.range(5, 9);
        s.nextMove = s.hidingUntil;
        this.log(`peek withdrawn, ${s.peeksLeft} left`);
        if (s.peeksLeft <= 0 && !this.def.approach) {
          this.finish("observed");
          return this.enter("retreat", "peeks-done");
        }
        return;
      }
      if (tg.canSee && tg.dist < 26) this.vis.action = s.peekSide;
    }

    // ---- watched: hold still (breathing, tracking and imitation continue)
    if (snap.anyWatching) {
      this.ctx.hold();
      return;
    }

    // ---- unobserved: reposition through real space
    if (this.t >= s.nextMove || this.reached(s.goal)) {
      const shrink = Math.min(1, this.stateT / Math.max(1, s.dur));
      const far = STALK.farMax - (STALK.farMax - 16) * shrink;
      const near = this.setup === "distant_silhouette" ? 20 : STALK.nearMin;
      s.goal = this.ctx.findObservationSpot({
        near,
        far: Math.max(near + 4, far),
        visible: this.setup === "distant_silhouette",
        partial: !!this.def.peeks,
        headroom: this.def.posture === "crawl" ? 2 : 3,
      });
      s.nextMove = this.t + this.rng.range(STALK.repositionMin, STALK.repositionMax);
    }
    if (s.goal && !this.reached(s.goal)) {
      this.ctx.moveTo(s.goal, SPEED.creep, "stalk");
      if (tg.dist < 26) this.cue("tail_scrape");
    } else {
      this.ctx.hold();
    }
  }

  // ------------------------------------------------------------------ STANDOFF
  enter_standoff() {
    this.so = {
      maxDur: this.rng.range(STANDOFF.durationMin, STANDOFF.durationMax),
      clickAt: 0,
      clickUntil: -1,
      lostSight: 0,
      inhaled: false,
    };
    this.vis.postureWant = this.def.posture === "crawl" ? null : this.def.reveal ? "tall" : null;
    this.vis.look = "target";
    this.vis.action = "none";
    this.ctx.hold();
    if (this.def.reveal) this.cue("inhale");
  }

  update_standoff(snap, dt) {
    const tg = snap.target;
    const so = this.so;
    const r = stepAgitation(this.agit, {
      watched: tg.watching,
      distance: tg.dist,
      closing: tg.closing,
      sprinting: tg.sprinting,
      hits: this.hits,
      movingAway: tg.movingAway,
    }, dt, this.settings.agitationScale);
    if (r.reasons.includes("sprint-start")) this.memoryReaction("flee", 0.2);
    if (tg.watching) this.memoryReaction("stare", 0.02);

    const level = cueLevel(this.agit.value);
    this.vis.agit = level;
    this.vis.look = "target";
    this.vis.action = "none";
    if (level === 1) {
      this.vis.tail = "drag";
      this.vis.voice = "breath";
    } else {
      this.vis.tail = "twitch";
      if (this.t >= so.clickAt) {
        so.clickUntil = this.t + STANDOFF.clickLength;
        so.clickAt = this.t + this.rng.range(STANDOFF.clickGapMin, STANDOFF.clickGapMax) * (this.agit.value > 75 ? 0.6 : 1);
        this.cue("throat_click");
      }
      this.vis.voice = this.t < so.clickUntil ? "click" : "breath";
      if (this.agit.value >= STANDOFF.inhaleAbove && !so.inhaled) {
        so.inhaled = true;
        this.cue("inhale");
      }
    }

    // restrained movement: hold while watched; only an agitated Tailwail closes in (unobserved).
    // A calm one lets a retreating player go, which is what makes calm withdrawal possible.
    if (!snap.anyWatching && this.agit.value >= STANDOFF.calmAgitation && tg.dist > STANDOFF.followIfBeyond && tg.canSee) {
      this.ctx.moveTo(tg.pos, SPEED.creep, "keep-distance");
    } else {
      this.ctx.hold();
      this.ctx.faceToward(tg.pos);
    }

    so.lostSight = tg.canSee ? 0 : so.lostSight + dt;

    if (this.agit.value >= AGITATION.max) return this.commit("agitation");
    if ((tg.dist >= STANDOFF.calmDistance && this.agit.value < STANDOFF.calmAgitation) ||
        (so.lostSight >= STANDOFF.lostSightCalm && this.agit.value < 60)) {
      this.finish("calm");
      return this.enter("retreat", "calm-withdrawal");
    }
    if (this.stateT >= so.maxDur) {
      if (this.agit.value >= STANDOFF.commitAtTimeout) return this.commit("timeout-agitated");
      this.finish("calm");
      return this.enter("retreat", "standoff-timeout");
    }
  }

  commit(why) {
    // "The unfolding": if it was mid-imitation, it keeps rising past the gesture.
    const imitating = this.imitator.active || this.t - (this.imitator.cooldownUntil - IMITATION.cooldown) < 3;
    cancelImitation(this.imitator);
    rearm(this.audio, "wail");
    this.preRise = imitating ? 0.6 : 0;
    this.log(`commit (${why})${imitating ? " from imitation" : ""}`);
    this.enter("unfold", why);
  }

  // ------------------------------------------------------------------ UNFOLD
  enter_unfold() {
    const head = this.snap ? this.snap.creature.headroom : 8;
    this.unfoldLow = head < 5;
    this.unfoldDur = (this.unfoldLow ? CLIP.unfoldLow : CLIP.unfold) + (this.preRise || 0);
    this.vis.tail = "rigid";
    this.vis.voice = "silent";
    this.vis.agit = 3;
    this.vis.action = "none";
    this.vis.look = "target";
    this.vis.postureWant = this.unfoldLow ? null : "tall";
    this.forceMimic = this.preRise ? { mimic: "shrug", amt: 1.5, pitch: 0 } : null;
    this.ctx.hold();
  }

  update_unfold(snap) {
    this.ctx.hold();
    this.ctx.faceToward(snap.target.pos);
    if (this.forceMimic && this.stateT >= this.preRise) this.forceMimic = null;
    // uninterruptible: looking at it, hitting it or moving changes nothing here
    if (this.stateT >= this.unfoldDur) this.enter("windup", "unfolded");
  }

  exit_unfold() {
    this.forceMimic = null;
  }

  // ------------------------------------------------------------------ WINDUP
  enter_windup() {
    this.vis.tail = "rigid";
    this.vis.voice = "inhale";
    this.vis.agit = 3;
    this.vis.postureWant = null;
    this.cue("inhale");
    this.ctx.hold();
  }

  update_windup(snap) {
    this.ctx.hold();
    this.ctx.faceToward(snap.target.pos);
    if (this.stateT >= CLIP.windupLowAt) this.vis.postureCap = "hunch"; // the clip is planted by now
    if (this.stateT >= CLIP.windup) this.enter("chase", "windup-complete");
  }

  // ------------------------------------------------------------------ CHASE
  enter_chase() {
    const tg = this.snap ? this.snap.target : null;
    // one pursuit budget per commitment, shared across search/reacquire cycles
    if (!this.chaseResumed) this.pursuit = { used: 0, budget: this.settings.pursuitSeconds };
    this.c = {
      sinceSeen: 0,
      lastSeen: tg ? tg.pos : null,
      wailUntil: this.chaseResumed ? 0 : CLIP.wailHold,
      exertAt: CLIP.wailHold + 0.8,
      stuckTries: 0,
    };
    this.vis.tail = this.chaseResumed ? "free" : "rigid";
    this.vis.postureCap = "hunch";
    this.vis.postureWant = null;
    this.vis.look = "target";
    if (!this.chaseResumed) {
      this.vis.voice = "wail";
      this.cue("wail");
    } else {
      this.vis.voice = "snarl";
      this.cue("snarl");
    }
    this.ctx.hold();
  }

  update_chase(snap, dt) {
    const tg = snap.target;
    const c = this.c;
    if (tg.canSee && tg.dist <= CHASE.sightRange) {
      c.lastSeen = tg.pos;
      c.sinceSeen = 0;
    } else {
      c.sinceSeen += dt;
    }

    // wail: planted for a beat, then it moves
    if (this.stateT < c.wailUntil) {
      this.ctx.hold();
      this.ctx.faceToward(tg.pos);
      return;
    }
    this.pursuit.used += dt;
    this.vis.tail = "free";
    if (this.vis.voice === "wail" && this.stateT > c.wailUntil + 0.8) this.vis.voice = "silent";
    if (this.stateT >= c.exertAt) {
      this.cue("exertion");
      c.exertAt = this.stateT + CHASE.exertionGap + this.rng.range(0, 1.5);
    }

    // strike (the only damage source)
    const st = this.strike;
    if (st.active) {
      this.ctx.hold();
      this.ctx.faceToward(tg.pos);
      this.vis.action = "strike";
      if (resolveImpact(st, this.stateT, snap.strikeGeom)) {
        this.ctx.dealDamage();
        this.cue("impact");
        this.log("strike landed");
      }
      if (finishStrike(st, this.stateT)) this.vis.action = "none";
      return;
    }
    this.vis.action = "none";
    if (tg.alive && canStartStrike(st, this.stateT, tg.hdist, tg.dy, snap.strikeGeom.los)) {
      startStrike(st, this.stateT, CLIP.strikeImpact, CLIP.strike);
      this.cue("swipe");
      this.vis.action = "strike";
      this.ctx.hold();
      return;
    }

    // escape rules: finite budget, or long enough out of sight with real separation
    if (c.sinceSeen >= CHASE.escapeNoSight && tg.dist >= CHASE.escapeDistance) {
      this.searchReason = "lost";
      return this.enter("search", "lost-sight");
    }
    if (this.pursuit.used >= this.pursuit.budget) {
      this.searchReason = "budget";
      return this.enter("search", "pursuit-budget");
    }

    const goal = c.sinceSeen === 0 ? tg.pos : c.lastSeen;
    if (!goal) {
      this.searchReason = "lost";
      return this.enter("search", "no-goal");
    }
    if (c.sinceSeen > 0 && this.reached(c.lastSeen, 2.0)) {
      this.searchReason = "lost";
      return this.enter("search", "reached-last-known");
    }
    if (snap.creature.stuck) {
      c.stuckTries += 1;
      this.log(`stuck (${c.stuckTries})`);
      if (c.stuckTries > CHASE.recoveryAttempts) {
        this.searchReason = "stuck";
        return this.enter("search", "stuck");
      }
      this.ctx.recover(c.stuckTries);
      return;
    }
    this.ctx.moveTo(goal, this.settings.chaseSpeed, "chase");
  }

  exit_chase() {
    abortStrike(this.strike, this.stateT);
    this.vis.action = "none";
  }

  // ------------------------------------------------------------------ SEARCH
  enter_search() {
    const origin = this.c && this.c.lastSeen ? this.c.lastSeen : this.snap.creature.pos;
    this.se = {
      points: this.ctx.findSearchPoints(origin, SEARCH.points, SEARCH.radius),
      idx: 0,
      listenUntil: 0,
      frustrated: false,
      frustratedUntil: 0,
    };
    this.vis.tail = "twitch";
    this.vis.voice = "silent";
    this.vis.postureCap = "hunch";
    this.vis.look = null;
  }

  update_search(snap) {
    const tg = snap.target;
    const se = this.se;
    if (se.frustrated) {
      this.ctx.hold();
      this.vis.action = "ambush";
      if (this.stateT >= se.frustratedUntil) {
        this.vis.action = "none";
        this.finish("escaped");
        this.enter("retreat", "frustrated");
      }
      return;
    }
    // reacquire within the same commitment: no new wail, no new wind-up
    const left = this.pursuit ? this.pursuit.budget - this.pursuit.used : 0;
    if (tg.canSee && tg.dist <= CHASE.sightRange && this.searchReason !== "budget" && left > 3) {
      this.chaseResumed = true;
      this.enter("chase", "reacquired");
      return;
    }
    if (this.t < se.listenUntil) {
      this.ctx.hold();
      this.vis.action = "listen";
      return;
    }
    this.vis.action = "none";
    const pt = se.points[se.idx];
    if (!pt || this.stateT >= SEARCH.maxDuration) {
      se.frustrated = true;
      se.frustratedUntil = this.stateT + CLIP.ambush;
      this.cue("snarl");
      return;
    }
    if (this.reached(pt)) {
      se.idx += 1;
      se.listenUntil = this.t + SEARCH.listen;
      this.cue("throat_click");
      this.vis.voice = "click";
      return;
    }
    this.vis.voice = "silent";
    this.lastSearchGoal = pt;
    this.ctx.moveTo(pt, SPEED.search, "search");
  }

  // ------------------------------------------------------------------ RETREAT
  enter_retreat() {
    cancelImitation(this.imitator);
    const f = this.ctx.retreatFactor ? this.ctx.retreatFactor() : 1;
    this.re = {
      goal: this.ctx.findRetreatSpot(RETREAT.distanceMin * f, RETREAT.distanceMax * f),
      respots: 0,
      soundDone: false,
    };
    this.vis.tail = "drag";
    this.vis.voice = "silent";
    this.vis.agit = 1;
    this.vis.action = "none";
    this.vis.look = null;
    this.vis.postureCap = null;
    this.vis.postureWant = null;
  }

  update_retreat(snap) {
    const re = this.re;
    if (!re.soundDone && this.stateT > 0.6) {
      re.soundDone = true;
      this.cue("retreat");
    }
    const tg = snap.target;
    const far = !tg.valid || tg.dist >= RETREAT.hideDistance;
    if (!snap.anyWatching && this.stateT >= RETREAT.minBeforeDespawn && (far || !snap.anyLos)) {
      return this.despawn();
    }
    if (re.goal && this.reached(re.goal) && re.respots < RETREAT.respots) {
      re.respots += 1;
      re.goal = this.ctx.findRetreatSpot(RETREAT.distanceMin, RETREAT.distanceMax * 1.3);
    }
    if (re.goal && !this.reached(re.goal)) this.ctx.moveTo(re.goal, SPEED.retreat, "retreat");
    else this.ctx.hold();
    if (this.stateT >= RETREAT.maxDuration && !snap.anyWatching) this.despawn();
  }

  // ------------------------------------------------------------------ DEATH
  enter_death() {
    cancelImitation(this.imitator);
    abortStrike(this.strike, this.t);
    this.finish("killed");
    this.vis.tail = "free";
    this.vis.voice = "silent";
    this.vis.action = "none";
    this.vis.look = null;
    this.cue("death");
    this.ctx.hold();
  }

  update_death() {
    this.ctx.hold();
    if (this.stateT >= CLIP.death + 0.4 && !this.done) {
      this.done = true;
      this.ctx.despawn("killed");
    }
  }
}

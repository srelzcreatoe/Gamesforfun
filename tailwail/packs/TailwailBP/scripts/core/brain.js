// Tailwail's encounter state machine.  Pure: no Minecraft imports.
//
//   stalk -> standoff -> unfold -> scream -> windup -> chase <-> grab
//                                                      chase -> search -> frustrated -> retreat
//   plus retreat (from anywhere) and death.  Every state has an entry action, update rules,
//   a hard time ceiling and a cleanup path.
//
// The adapter (mc/encounter.js) builds a perception snapshot each decision tick and
// implements `ctx` (movement, spot finding, sounds, player effects, the grab, damage,
// despawn).  Tests drive the same class with a mock ctx (tests/helpers.mjs).
import {
  AGITATION, CHASE, CLIP, DT, GRAB, IMITATION, RETREAT, SEARCH, SPEED, STALK, STANDOFF,
} from "../config.js";
import { createAgitation, stepAgitation } from "./agitation.js";
import { allow, createLimiter } from "./audio_rules.js";
import {
  abortStrike, canStartStrike, createStrikeState, finishStrike, inGrabReach, resolveImpact, startStrike,
} from "./combat_rules.js";
import { cancelImitation, createDetector, createImitator, observe, offer, schedule, updateImitator } from "./gestures.js";
import { gestureBias } from "./memory.js";
import { SETUPS } from "./setups.js";

export const STATES = ["stalk", "standoff", "unfold", "scream", "windup", "chase", "grab", "search", "frustrated", "retreat", "death"];
export const STATUES = ["statue_reach", "statue_arms_up", "statue_cover", "statue_bow", "statue_sideways"];
const COMMITTED = new Set(["unfold", "scream", "windup", "chase", "grab"]);

// Hard ceilings per state (seconds).  A state that overstays always resolves somewhere safe.
export const MAX_STATE_TIME = {
  stalk: STALK.hardCap,
  standoff: STANDOFF.durationMax + 10,
  unfold: CLIP.unfold + 0.6,
  scream: CLIP.scream + 0.6,
  windup: CLIP.windupCut + 0.6,
  chase: 75,
  grab: CLIP.grab + GRAB.hold + CLIP.frustrated + CLIP.throw + 2.5,
  search: SEARCH.maxDuration + 4,
  frustrated: CLIP.frustrated + 0.8,
  retreat: RETREAT.hardCap,
  death: CLIP.death + 2,
};

/** Visual levels for an agitation value: tail, breath, tremor, jaw (degrees). */
export function agitationLook(a) {
  if (a >= 85) return { tail: "curl", breath: "frantic", tremor: 3, jaw: 34 };
  if (a >= AGITATION.cueThree) return { tail: "curl", breath: "frantic", tremor: 2, jaw: 22 };
  if (a >= AGITATION.cueTwo) return { tail: "twitch", breath: "heavy", tremor: 1, jaw: 10 };
  return { tail: "drag", breath: "calm", tremor: 0, jaw: 3 };
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
   */
  constructor(o) {
    this.setup = o.setup;
    this.def = SETUPS[o.setup] || SETUPS.statue_hunt;
    this.settings = o.settings;
    this.memory = o.memory;
    this.rng = o.rng;
    this.ctx = o.ctx;
    this.remembered = o.remembered || null;
    this.showcase = !!o.showcase;
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
    this.vis = { pose: "loco", tail: "drag", breath: "calm", tremor: 0, jaw: 3, look: "none", postureCap: null, postureWant: null };
    this.noticeT = -1;
    this.watchFor = 0;
    this.grabs = 0;
    this.grabCdUntil = 0;
    this.pursuit = null;
    this.chaseResumed = false;
    this.retargetUsed = false;
    this.history = [];
    this.flags = new Set(); // things that happened (journal / memory hooks read these)
    this.pendingHits = 0;
    this.pendingDamageOthers = 0;
    this.enter(this.def.hunter ? "scream" : "stalk", "spawn");
  }

  // ------------------------------------------------------------------ helpers
  log(msg) {
    if (this.history.length > 50) this.history.shift();
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
    return COMMITTED.has(this.state);
  }

  canRetarget() {
    return !this.retargetUsed && (this.state === "stalk" || this.state === "standoff");
  }

  markRetarget() {
    this.retargetUsed = true;
    this.detector = createDetector();
    cancelImitation(this.imitator);
  }

  /** Called by the adapter when a player hits Tailwail. */
  onHit(attackerIsTarget, amount = 0) {
    this.pendingHits += 1;
    if (!attackerIsTarget) this.pendingDamageOthers += amount;
    if (attackerIsTarget) this.memoryReaction("attack", 0.4);
  }

  memoryReaction(kind, amt) {
    if (this.ctx.recordReaction) this.ctx.recordReaction(kind, amt);
  }

  die() {
    if (this.state !== "death") this.enter("death", "killed");
  }

  pickStatue(avoid) {
    const opts = STATUES.filter((s) => s !== avoid);
    return this.rng.pick(opts);
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

  retreat(outcome, why) {
    this.finish(outcome);
    this.enter("retreat", why);
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

    if (this.state !== "death" && this.state !== "retreat" && this.state !== "grab") {
      if (!tg.valid || !tg.alive || !tg.eligible || tg.dist > 72) {
        const died = tg.valid && tg.alive === false; // a disconnect is not a kill
        const pursuing = this.state === "chase" || this.state === "search";
        this.finish(died ? (pursuing ? "caught" : "aborted") : pursuing ? "escaped" : "aborted");
        this.enter("retreat", died ? "target-dead" : "target-lost");
      }
    }

    // learning: only while Tailwail can see the target, and only before commitment
    if ((this.state === "stalk" || this.state === "standoff") && tg.valid && tg.canSee) {
      const g = observe(this.detector, { sneaking: tg.sneaking, pitch: tg.pitch, speed: tg.speed }, this.t);
      if (g) {
        if (this.ctx.recordGesture) this.ctx.recordGesture(g.type, g.pitch || 0);
        const chance = this.state === "standoff" ? IMITATION.chance : IMITATION.chance * 0.6;
        const r = offer(this.imitator, g, this.t, this.agit.value, this.rng, chance);
        if (r) {
          this.log(`imitate ${r.type} in ${(r.at - this.t).toFixed(1)}s amt ${r.amt.toFixed(2)}`);
          this.flag("mirror");
        }
      }
    }
    this.watchFor = tg.valid && tg.watching ? this.watchFor + dt : 0;
    if (this.noticeT < 0 && this.watchFor >= STALK.noticeTime) {
      this.noticeT = this.t;
      this.flag("noticed");
    }

    this["update_" + this.state](snap, dt);
    if (!this.done && this.stateT > MAX_STATE_TIME[this.state]) this.onOverstay();
    this.publish();
  }

  onOverstay() {
    this.log(`overstay in ${this.state}`);
    switch (this.state) {
      case "retreat":
        if (!this.snap.anyInView) this.despawn();
        return;
      case "death":
        return;
      case "unfold":
        return this.enter("scream", "overstay");
      case "scream":
        return this.enter("windup", "overstay");
      case "windup":
        return this.enter("chase", "overstay");
      case "grab":
        return this.retreat("caught", "overstay");
      default:
        return this.retreat(this.state === "chase" || this.state === "search" ? "escaped" : "observed", "overstay");
    }
  }

  publish() {
    const mimicOk = this.state === "stalk" || this.state === "standoff";
    const im = mimicOk ? updateImitator(this.imitator, this.t) : { mimic: "none", amt: 0, pitch: 0 };
    const v = this.vis;
    // the client only shows imitation overlays on the locomotion pose
    const pose = im.mimic !== "none" ? "loco" : v.pose;
    this.ctx.setVisual({
      state: this.state,
      pose,
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

  setLook(look) {
    Object.assign(this.vis, look);
  }

  // ------------------------------------------------------------------ STALK
  enter_stalk() {
    const f = this.ctx.stalkFactor ? this.ctx.stalkFactor() : 1;
    const d = this.def;
    this.s = {
      dur: this.rng.range(STALK.durationMin, STALK.durationMax) * f * (this.showcase ? 0.3 : 1),
      nextMove: 0,
      goal: null,
      phase: d.watcher ? "watch" : "lurk",
      frozen: !!d.behind,
      statue: d.behind ? "behind" : this.pickStatue(),
      stare: 0,
      hidden: 0,
      peeksLeft: d.peeks ? this.rng.int(d.peeks[0], d.peeks[1]) : 0,
      hidingUntil: 0,
      peekSide: this.rng.chance(0.5) ? "peek_l" : "peek_r",
      breathAt: this.rng.range(3, 8),
      knockAt: this.rng.range(10, 20),
      snuffAt: this.rng.range(8, 16),
      watchDur: this.rng.range(8, 16),
      rememberedDone: !this.remembered,
      approachDeadline: 0,
      slinkRolled: false,
    };
    const want = d.posture === "crawl" ? "crawl" : d.posture === "tall" ? null : "hunch";
    this.vis = { pose: d.behind ? "behind" : "loco", tail: "drag", breath: "calm", tremor: 0, jaw: 3, look: "none", postureCap: null, postureWant: want };
    if (d.behind) this.cue("breath_far");
  }

  update_stalk(snap, dt) {
    const tg = snap.target;
    const s = this.s;
    const d = this.def;
    this.vis.look = tg.canSee ? "target" : "none";

    if (this.hits > 0) return this.commit("provoked");

    // a hidden player (sneaking in the dark, out of reach) is lost after a while
    s.hidden = tg.hidden ? s.hidden + dt : 0;
    if (s.hidden >= STALK.hiddenLoseTrack) {
      this.flag("hid");
      this.memoryReaction("hide", 0.4);
      return this.retreat("hidden", "lost-track");
    }

    // signature: open with a gesture remembered from an earlier encounter
    if (!s.rememberedDone && tg.watching && this.watchFor >= 0.6) {
      s.rememberedDone = true;
      const r = schedule(this.imitator, this.remembered.type, this.t + 0.4, 20, this.rng, this.remembered.pitch);
      this.log(`remembered gesture ${r.type}`);
      this.flag("remembered");
      if (this.ctx.onRemembered) this.ctx.onRemembered(r.type);
    }

    // ambient cues while nobody is looking
    if (!snap.anyWatching) {
      if (this.t >= s.breathAt && tg.dist < 28) {
        this.cue("breath_far");
        s.breathAt = this.t + this.rng.range(STALK.breathMin, STALK.breathMax);
      }
      if (this.t >= s.knockAt && tg.dist < 20 && !d.watcher) {
        this.cue("knock");
        s.knockAt = this.t + this.rng.range(STALK.knockMin, STALK.knockMax);
      }
      if (this.t >= s.snuffAt && tg.dist < 24 && this.settings.torchSnuff) {
        this.fx("snuff_near_target", { count: 1 });
        s.snuffAt = this.t + this.rng.range(STALK.snuffMin, STALK.snuffMax);
      }
    }

    // ---- the distant watcher: stands and watches; leaves when approached or after a while
    if (s.phase === "watch") {
      this.vis.postureWant = null;
      this.vis.pose = "loco";
      this.ctx.hold();
      if (tg.canSee) this.ctx.faceToward(tg.pos);
      const noticed = this.noticeT >= 0;
      if (tg.dist <= 18 || (noticed && this.t - this.noticeT >= s.watchDur) || this.stateT >= s.dur * 1.6) {
        return this.retreat("observed", tg.dist <= 18 ? "approached" : "watched-enough");
      }
      return;
    }

    // ---- noticed: it freezes; a held stare (or walking up to it) starts the stand-off
    if (tg.watching) {
      s.stare += dt;
      if (!s.frozen) {
        s.frozen = true;
        s.statue = snap.creature.posture === "tall" ? this.pickStatue(s.statue) : "watch_low";
        this.ctx.hold();
        this.cue("creak");
      }
      if (s.peeksLeft > 0 && s.stare >= STALK.peekHideStare) {
        s.peeksLeft -= 1;
        s.frozen = false;
        s.stare = 0;
        s.goal = this.ctx.findCover();
        s.hidingUntil = this.t + this.rng.range(4, 7);
        this.cue("skitter");
        this.log(`peek withdrawn, ${s.peeksLeft} left`);
        return;
      }
      const first = !this.memory || this.memory.enc === 0;
      if (s.stare >= STALK.standoffStare || tg.dist <= STALK.standoffApproach) {
        if (first && !s.slinkRolled && !this.showcase) {
          s.slinkRolled = true;
          if (this.rng.chance(STALK.slinkChance)) return this.retreat("observed", "slinks-away");
        }
        if (d.standoff) return this.enter("standoff", "noticed");
        return this.retreat("observed", "noticed");
      }
    } else {
      s.stare = Math.max(0, s.stare - dt * 0.5);
    }

    // ---- peeking: show a sliver at the corner while in sight
    if (d.peeks && s.peeksLeft > 0 && this.t >= s.hidingUntil && tg.canSee && tg.dist < 26 && !s.frozen) {
      this.vis.pose = s.peekSide;
      this.ctx.hold();
      return;
    }

    // ---- anyone could see it: it does not move
    if (snap.anyInView) {
      this.ctx.hold();
      this.vis.pose = s.frozen ? s.statue : "loco";
      return;
    }
    s.frozen = false;
    this.vis.pose = "loco";

    if (this.t < s.hidingUntil) {
      if (s.goal && !this.reached(s.goal)) this.ctx.moveTo(s.goal, SPEED.walk, "hide");
      else this.ctx.hold();
      return;
    }

    // ---- approach into the stand-off
    if (s.phase === "approach") {
      if (!s.goal || this.stateT > s.approachDeadline) {
        if (tg.canSee && tg.dist <= STALK.standoffMax + 4 && d.standoff) return this.enter("standoff", "in-view");
        return this.retreat("observed", "no-standoff-spot");
      }
      if (this.reached(s.goal) || (tg.canSee && tg.dist <= STALK.standoffMax)) {
        if (d.standoff) return this.enter("standoff", "arrived");
        return this.retreat("observed", "arrived");
      }
      this.ctx.moveTo(s.goal, SPEED.walk, "approach");
      return;
    }
    if (this.stateT >= s.dur && (s.peeksLeft <= 0 || this.stateT >= s.dur * 1.5)) {
      const spot = this.ctx.findStandoffSpot(STALK.standoffMin, STALK.standoffMax, d.reveal ? 3 : 0);
      if (spot) {
        s.phase = "approach";
        s.goal = spot;
        s.approachDeadline = this.stateT + 25;
        this.log("approach to stand-off");
        return;
      }
      if (this.stateT >= s.dur * 1.8) return this.retreat("observed", "stalk-expired");
    }

    // ---- unobserved: reposition through real space, closer as time passes
    if (this.t >= s.nextMove || this.reached(s.goal)) {
      const shrink = Math.min(1, this.stateT / Math.max(1, s.dur));
      const far = STALK.farMax - (STALK.farMax - 14) * shrink;
      const near = d.behind ? 6 : STALK.nearMin;
      s.goal = this.ctx.findObservationSpot({
        near,
        far: Math.max(near + 4, far),
        partial: !!d.peeks,
        headroom: d.posture === "crawl" ? 2 : 3,
        behind: !!d.behind,
      });
      if (s.goal && s.goal.side) s.peekSide = s.goal.side;
      s.nextMove = this.t + this.rng.range(STALK.repositionMin, STALK.repositionMax);
    }
    if (s.goal && !this.reached(s.goal)) {
      this.ctx.moveTo(s.goal, d.behind ? SPEED.walk : SPEED.creep, "stalk");
      if (tg.dist < 24) this.cue("tail_scrape");
    } else {
      this.ctx.hold();
    }
  }

  // ------------------------------------------------------------------ STANDOFF
  enter_standoff(why) {
    const reveal = this.def.reveal && this.snap && this.snap.creature.headroom >= 7;
    const prev = this.vis.pose;
    this.so = {
      maxDur: STANDOFF.durationMax * (this.showcase ? 0.7 : 1),
      statue: STATUES.includes(prev) || prev === "watch_low" || prev === "behind" ? prev : this.pickStatue(),
      creeping: false,
      creepT: 0,
      creepGoal: null,
      unwatched: 0,
      nextCreepAt: 0,
      perf: null,
      perfUntil: 0,
      perfAt: this.t + this.rng.range(2.5, 5),
      lost: 0,
      revealUntil: reveal ? this.t + CLIP.unfold + 0.5 : 0,
      rehearseAt: this.t + this.rng.range(6, 11),
      clickAt: 0,
      creeps: 0,
    };
    // the agitation it already built up while stalking is kept; a provoked entry starts hot
    if (why === "provoked") this.agit.value = Math.max(this.agit.value, 70);
    this.vis.look = "target";
    this.vis.postureWant = this.def.posture === "crawl" ? "crawl" : reveal ? "tall" : null;
    this.vis.pose = reveal ? "unfold" : this.so.statue;
    this.ctx.hold();
    if (reveal) {
      this.cue("inhale");
      this.flag("reveal");
    }
    this.fx("standoff_on");
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
    const a = this.agit.value;
    this.setLook(agitationLook(a));
    this.vis.look = "target";
    this.fx("standoff_level", a);
    if (a >= AGITATION.cueTwo && this.t >= so.clickAt) {
      this.cue("click");
      so.clickAt = this.t + this.rng.range(2.5, 5) * (a > 75 ? 0.6 : 1);
    }

    // ---- endings
    if (this.hits > 0) return this.commit("provoked");
    if (a >= AGITATION.max) return this.commit("stare");
    if (tg.dist <= STANDOFF.tooClose) return this.commit("too-close");
    so.lost = !tg.canSee || tg.hidden ? so.lost + dt : 0;
    if (tg.dist >= STANDOFF.calmDistance && a < STANDOFF.calmAgitation) {
      this.flag("calm");
      return this.retreat("calm", "calm-withdrawal");
    }
    if (so.lost >= STANDOFF.hiddenCalm && (a < STANDOFF.calmAgitation || so.lost >= STANDOFF.hiddenCalm * 2)) {
      if (tg.hidden) this.flag("hid");
      return this.retreat("calm", "lost-sight");
    }
    if (this.stateT >= so.maxDur) {
      if (a >= STANDOFF.commitAtTimeout) return this.commit("timeout");
      return this.retreat("calm", "standoff-timeout");
    }

    // ---- the reveal: rising to full height, nothing else happens
    if (this.t < so.revealUntil) {
      this.vis.pose = "unfold";
      this.ctx.hold();
      return;
    }

    // ---- rehearsal: in a quiet moment it performs a gesture it learned from this player before
    if (!this.imitator.active && !this.imitator.queue.length && this.t >= so.rehearseAt && tg.watching) {
      so.rehearseAt = this.t + this.rng.range(9, 16);
      const learned = this.memory ? gestureBias(this.memory).filter(([g]) => this.memory.gest[g].n > 0) : [];
      if (learned.length && this.rng.chance(this.def.rehearsal ? 0.8 : 0.45)) {
        const g = this.rng.weighted(learned);
        schedule(this.imitator, g, this.t + 0.3, a, this.rng, this.memory.gest[g].p);
        this.log(`rehearses learned ${g}`);
        this.flag("remembered");
      }
    }

    // ---- statue creep: it only ever moves while no one has it on screen
    const inView = snap.anyInView;
    if (so.creeping) {
      so.creepT += dt;
      if (inView || this.reached(so.creepGoal, 1.2) || so.creepT >= STANDOFF.creepBurstMax) {
        this.stopCreep(inView);
      } else {
        this.ctx.moveTo(so.creepGoal, SPEED.burst, "creep");
        this.vis.pose = "loco";
        return;
      }
    }
    so.unwatched = inView ? 0 : so.unwatched + dt;
    if (!inView && so.unwatched >= STANDOFF.creepDelay && this.t >= so.nextCreepAt && tg.dist > STANDOFF.tooClose + 0.5) {
      const goal = this.ctx.findCreepPoint ? this.ctx.findCreepPoint(STANDOFF.creepBurst, STANDOFF.tooClose - 0.5) : null;
      if (goal) {
        so.creeping = true;
        so.creepT = 0;
        so.creepGoal = goal;
        so.creeps += 1;
        so.perf = null;
        this.vis.pose = "loco";
        this.cue("skitter");
        this.ctx.moveTo(goal, SPEED.burst, "creep");
        return;
      }
      so.nextCreepAt = this.t + 1.0;
    }
    this.ctx.hold();

    // ---- performing for its audience
    if (so.perf && this.t >= so.perfUntil) so.perf = null;
    if (!so.perf && tg.watching && this.t >= so.perfAt && !this.imitator.active) {
      const opts = [["tilt", 3], ["watch_low", 1.5]];
      if (a >= 20) opts.push(["owl", 1.5]);
      if (a >= 40) opts.push(["neck", 2.5]);
      if (a >= 60) opts.push(["unhinge", 2.5]);
      const p = this.rng.weighted(opts);
      const len = { tilt: CLIP.tilt, watch_low: 0.8, owl: CLIP.owl, neck: CLIP.neck, unhinge: 1.0 }[p];
      so.perf = p;
      so.perfUntil = this.t + len + this.rng.range(1.0, 2.5);
      const gap = STANDOFF.perfMaxGap - (STANDOFF.perfMaxGap - STANDOFF.perfMinGap) * Math.min(1, a / 80);
      so.perfAt = so.perfUntil + this.rng.range(gap * 0.6, gap);
      if (p === "neck" || p === "owl") this.cue("neck_crack");
      if (p === "unhinge") this.cue("jaw_crack");
    }
    this.vis.pose = so.perf || so.statue;
    if (so.perf === "unhinge") this.vis.jaw = 50;
  }

  stopCreep(caught) {
    const so = this.so;
    so.creeping = false;
    so.nextCreepAt = this.t + STANDOFF.creepCooldown;
    so.unwatched = 0;
    so.statue = this.pickStatue(so.statue);
    so.perf = null;
    so.perfAt = Math.max(so.perfAt, this.t + 1.5);
    this.vis.pose = so.statue;
    this.ctx.hold();
    if (caught || this.rng.chance(STANDOFF.creakChance)) this.cue("creak");
    this.flag("creep");
  }

  commit(why) {
    cancelImitation(this.imitator);
    this.log(`commit (${why})`);
    if (why === "stare") this.flag("stared");
    if (why === "provoked") this.flag("provoked");
    this.enter("unfold", why);
  }

  // ------------------------------------------------------------------ UNFOLD (silent rise)
  enter_unfold() {
    const head = this.snap ? this.snap.creature.headroom : 8;
    this.unfoldLow = head < 6;
    this.unfoldDur = this.unfoldLow ? CLIP.unfoldLow : CLIP.unfold;
    this.vis = { ...this.vis, pose: this.unfoldLow ? "unfold_low" : "unfold", tail: "rigid", breath: "none", tremor: 0, jaw: 0, look: "target", postureCap: null, postureWant: this.unfoldLow ? null : "tall" };
    this.ctx.hold();
    this.fx("silence");
  }

  update_unfold(snap) {
    this.ctx.hold();
    if (snap.target.valid) this.ctx.faceToward(snap.target.pos);
    if (this.stateT >= this.unfoldDur) this.enter("scream", "unfolded");
  }

  // ------------------------------------------------------------------ SCREAM (the wail)
  enter_scream(why) {
    this.vis = { ...this.vis, pose: "scream", tail: "rigid", breath: "none", tremor: 2, jaw: 60, look: "target", postureWant: null };
    this.ctx.hold();
    if (why === "spawn") {
      // the hunter: a scream from far away, then it comes
      this.cue("scream_far");
      this.fx("scream_far");
    } else {
      this.cue("scream");
      this.fx("scream");
    }
    this.flag("scream");
  }

  update_scream(snap) {
    this.ctx.hold();
    if (snap.target.valid) this.ctx.faceToward(snap.target.pos);
    if (this.stateT >= CLIP.scream) this.enter("windup", "screamed");
  }

  // ------------------------------------------------------------------ WINDUP (drops onto all fours)
  enter_windup() {
    const low = this.snap && this.snap.creature.headroom < 3;
    this.vis = { ...this.vis, pose: low ? "windup_c" : "windup", tail: "rigid", breath: "frantic", tremor: 1, jaw: 30, look: "target", postureWant: null };
    this.ctx.hold();
  }

  update_windup(snap) {
    this.ctx.hold();
    if (snap.target.valid) this.ctx.faceToward(snap.target.pos);
    if (this.stateT >= 0.4) this.vis.postureCap = "hunch";
    if (this.stateT >= CLIP.windupCut) this.enter("chase", "windup-complete");
  }

  // ------------------------------------------------------------------ CHASE
  enter_chase(why) {
    const tg = this.snap ? this.snap.target : null;
    const resumed = this.chaseResumed;
    if (!resumed || !this.pursuit) this.pursuit = { used: 0, budget: this.settings.pursuitSeconds };
    this.c = {
      sinceSeen: 0,
      lastSeen: tg && tg.valid ? tg.pos : null,
      screechAt: this.rng.range(1.5, 3),
      snuffAt: 0.5,
      stuckTries: 0,
    };
    this.vis = { ...this.vis, pose: "loco", tail: "free", breath: "frantic", tremor: 1, jaw: 32, look: "target", postureCap: "hunch", postureWant: null };
    if (resumed) this.cue("screech");
    this.fx("chase_on", { resumed });
    this.flag("chase");
    this.ctx.hold();
    this.log(`chase ${resumed ? "resumed" : "begins"} (${why}), budget left ${(this.pursuit.budget - this.pursuit.used).toFixed(1)}s`);
  }

  update_chase(snap, dt) {
    const tg = snap.target;
    const c = this.c;
    const visible = tg.canSee && tg.dist <= CHASE.sightRange && !(tg.hidden && tg.dist > SEARCH.hiddenDetect);
    if (visible) {
      c.lastSeen = tg.pos;
      c.sinceSeen = 0;
    } else {
      c.sinceSeen += dt;
      if (tg.noise && this.t - tg.noise.t < 1.0) c.lastSeen = tg.noise.pos;
    }
    this.pursuit.used += dt;
    if (this.stateT >= c.screechAt) {
      this.cue("screech");
      c.screechAt = this.stateT + this.rng.range(CHASE.screechMin, CHASE.screechMax);
    }
    if (this.stateT >= c.snuffAt && this.settings.torchSnuff) {
      this.fx("snuff_path");
      c.snuffAt = this.stateT + CHASE.snuffEvery;
    }

    // ---- contact
    const st = this.strike;
    if (st.active) {
      this.ctx.hold();
      if (tg.valid) this.ctx.faceToward(tg.pos);
      this.vis.pose = "strike";
      if (resolveImpact(st, this.stateT, snap.reach)) {
        this.ctx.dealDamage("strike");
        this.cue("impact");
        this.log("strike landed");
      }
      if (finishStrike(st, this.stateT)) this.vis.pose = "loco";
      return;
    }
    this.vis.pose = "loco";
    const grabOk = this.settings.grab && snap.reach && snap.reach.holdClear;
    if (tg.alive && this.t >= this.grabCdUntil && grabOk && inGrabReach(snap.reach)) return this.enter("grab", "reach");
    if (tg.alive && !grabOk && this.t >= this.grabCdUntil && canStartStrike(st, this.stateT, snap.reach)) {
      startStrike(st, this.stateT);
      this.cue("swipe");
      this.vis.pose = "strike";
      this.ctx.hold();
      return;
    }

    // ---- escape rules: finite budget, or long enough out of sight with real separation
    if (c.sinceSeen >= CHASE.escapeNoSight && tg.dist >= CHASE.escapeDistance) return this.enter("search", "lost-sight");
    if (this.pursuit.used >= this.pursuit.budget) {
      this.searchReason = "budget";
      return this.enter("search", "pursuit-budget");
    }
    const goal = c.sinceSeen === 0 ? tg.pos : c.lastSeen;
    if (!goal) return this.enter("search", "no-goal");
    if (c.sinceSeen > 0 && this.reached(c.lastSeen, 2.0)) return this.enter("search", "reached-last-known");
    if (snap.creature.stuck) {
      c.stuckTries += 1;
      this.log(`stuck (${c.stuckTries})`);
      if (c.stuckTries > CHASE.recoveryAttempts) return this.enter("search", "stuck");
      this.ctx.recover(c.stuckTries);
      return;
    }
    this.ctx.moveTo(goal, this.settings.chaseSpeed, "chase");
  }

  exit_chase() {
    abortStrike(this.strike, this.stateT);
  }

  // ------------------------------------------------------------------ GRAB (lift, hold, struggle, throw / bite)
  enter_grab() {
    this.grabs += 1;
    this.g = { phase: "lunge", phaseT: 0, kind: this.grabs >= 2 ? "bite" : "throw", released: false, holding: false };
    this.pendingDamageOthers = 0;
    this.vis = { ...this.vis, pose: "grab", tail: "rigid", breath: "frantic", tremor: 1, jaw: 40, look: "target", postureCap: null };
    this.ctx.hold();
    if (!this.ctx.grabStart()) {
      this.log("grab refused by adapter");
      this.grabCdUntil = this.t + 1.5;
      this.chaseResumed = true;
      this.g = null;
      return this.enter("chase", "grab-refused");
    }
    this.g.holding = true;
    this.cue("grab");
    this.flag("grabbed");
  }

  setGrabPhase(p) {
    this.g.phase = p;
    this.g.phaseT = this.stateT;
  }

  update_grab(snap) {
    const g = this.g;
    if (!g) return;
    const since = this.stateT - g.phaseT;
    this.ctx.hold();
    const gs = snap.grab || { holding: false, presses: 0, needed: 1 };
    if (g.holding && !gs.holding && (g.phase === "lunge" || g.phase === "hold")) {
      // the victim is gone (died, left, changed dimension)
      g.holding = false;
      g.released = true;
      this.ctx.grabEnd("lost");
      this.log("grab lost its victim");
      return this.retreat(snap.target.valid && !snap.target.alive ? "caught" : "aborted", "victim-gone");
    }
    if (g.phase === "lunge") {
      this.vis.pose = "grab";
      if (since >= CLIP.grab) {
        this.setGrabPhase("hold");
        this.vis.pose = "hold";
        this.cue("hold");
      }
      return;
    }
    if (g.phase === "hold") {
      this.vis.pose = "hold";
      this.vis.jaw = Math.round(28 + 30 * Math.min(1, since / GRAB.hold));
      if (gs.presses >= gs.needed || this.pendingDamageOthers >= GRAB.othersDamageToDrop) {
        this.log(gs.presses >= gs.needed ? "struggled-free" : "dropped");
        g.holding = false;
        g.released = true;
        this.ctx.grabEnd("free");
        this.cue("pain");
        this.flag("struggle");
        this.setGrabPhase("free");
        this.vis.pose = "frustrated";
        this.vis.jaw = 45;
        return;
      }
      if (since >= GRAB.hold) {
        this.setGrabPhase(g.kind);
        this.vis.pose = g.kind === "bite" ? "unhinge" : "throw";
      }
      return;
    }
    if (g.phase === "throw") {
      this.vis.pose = "throw";
      if (!g.released && since >= CLIP.throwRelease) {
        g.released = true;
        g.holding = false;
        this.ctx.grabEnd("throw");
        this.cue("throw");
      }
      if (since >= CLIP.throw + 0.5) this.afterGrab();
      return;
    }
    if (g.phase === "bite") {
      this.vis.pose = "unhinge";
      this.vis.jaw = 60;
      if (!g.released && since >= 0.35) {
        g.released = true;
        g.holding = false;
        this.ctx.grabEnd("bite");
        this.cue("bite");
      }
      if (since >= 1.3) this.retreat("caught", "bitten"); // it got what it came for
      return;
    }
    if (g.phase === "free") {
      this.vis.pose = "frustrated";
      if (since >= GRAB.freeStagger) this.afterGrab();
    }
  }

  afterGrab() {
    const tg = this.snap.target;
    this.grabCdUntil = this.t + CHASE.grabCooldown;
    if (!tg.valid || !tg.alive) return this.retreat("caught", "after-grab");
    const left = this.pursuit ? this.pursuit.budget - this.pursuit.used : 0;
    if (left < 3) return this.enter("search", "after-grab");
    this.chaseResumed = true;
    this.enter("chase", "after-grab");
  }

  exit_grab() {
    if (this.g && this.g.holding && !this.g.released) {
      this.g.released = true;
      this.g.holding = false;
      this.ctx.grabEnd("abort");
    }
  }

  // ------------------------------------------------------------------ SEARCH (sniffing, listening)
  enter_search(why) {
    const origin = this.c && this.c.lastSeen ? this.c.lastSeen : this.snap ? this.snap.creature.pos : null;
    this.se = {
      points: origin ? this.ctx.findSearchPoints(origin, SEARCH.points, SEARCH.radius) : [],
      idx: 0,
      listenUntil: 0,
      why,
    };
    this.vis = { ...this.vis, pose: "loco", tail: "twitch", breath: "heavy", tremor: 1, jaw: 8, look: "none", postureCap: "hunch", postureWant: null };
    this.fx("search_on");
  }

  update_search(snap) {
    const tg = snap.target;
    const se = this.se;
    const left = this.pursuit ? this.pursuit.budget - this.pursuit.used : 0;
    const seen = tg.canSee && tg.dist <= CHASE.sightRange && (!tg.hidden || tg.dist <= SEARCH.hiddenDetect);
    if (seen && this.searchReason !== "budget" && left > 3) {
      this.chaseResumed = true;
      return this.enter("chase", tg.hidden ? "found-hiding" : "reacquired");
    }
    if (tg.noise && this.t - tg.noise.t < 1.0 && tg.dist <= SEARCH.noiseRadius) {
      const cur = se.points[se.idx];
      if (!cur || Math.hypot(cur.x - tg.noise.pos.x, cur.z - tg.noise.pos.z) > 3) {
        se.points.splice(se.idx, 0, tg.noise.pos);
        se.listenUntil = 0;
        this.log("heard something");
      }
    }
    if (this.t < se.listenUntil) {
      this.ctx.hold();
      this.vis.pose = "sniff";
      return;
    }
    this.vis.pose = "loco";
    const pt = se.points[se.idx];
    if (!pt || this.stateT >= SEARCH.maxDuration) {
      if (tg.hidden) {
        this.flag("hid");
        this.memoryReaction("hide", 0.4);
      }
      return this.enter("frustrated", "gave-up");
    }
    if (this.reached(pt)) {
      se.idx += 1;
      se.listenUntil = this.t + SEARCH.listen;
      this.cue("sniff");
      return;
    }
    this.ctx.moveTo(pt, SPEED.search, "search");
  }

  // ------------------------------------------------------------------ FRUSTRATED (rears up and howls)
  enter_frustrated() {
    this.vis = { ...this.vis, pose: "frustrated", tail: "rigid", breath: "frantic", tremor: 2, jaw: 55, look: "none", postureCap: null };
    this.ctx.hold();
    this.cue("frustrated");
  }

  update_frustrated() {
    this.ctx.hold();
    if (this.stateT >= CLIP.frustrated) {
      this.flag("escaped");
      this.retreat("escaped", "frustrated");
    }
  }

  // ------------------------------------------------------------------ RETREAT
  enter_retreat() {
    cancelImitation(this.imitator);
    const f = this.ctx.retreatFactor ? this.ctx.retreatFactor() : 1;
    const tgValid = !!(this.snap && this.snap.target.valid && this.snap.target.alive);
    this.re = {
      goal: this.ctx.findRetreatSpot(RETREAT.distanceMin * f, RETREAT.distanceMax * f),
      respots: 0,
      soundDone: false,
      owl: tgValid && this.rng.chance(RETREAT.owlChance),
    };
    this.vis = { ...this.vis, pose: "loco", tail: "drag", breath: "calm", tremor: 0, jaw: 3, look: this.re.owl ? "target" : "none", postureCap: null, postureWant: null };
    this.fx("end");
  }

  update_retreat(snap) {
    const re = this.re;
    if (!re.soundDone && this.stateT > 0.6) {
      re.soundDone = true;
      this.cue("retreat");
    }
    const tg = snap.target;
    // walking away with its head turned all the way round to keep watching you
    this.vis.look = re.owl && tg.valid && tg.canSee ? "target" : "none";
    const far = !tg.valid || tg.dist >= RETREAT.hideDistance;
    if (!snap.anyInView && this.stateT >= RETREAT.minBeforeDespawn && (far || !snap.anyLos)) return this.despawn();
    if (re.goal && this.reached(re.goal) && re.respots < RETREAT.respots) {
      re.respots += 1;
      re.goal = this.ctx.findRetreatSpot(RETREAT.distanceMin, RETREAT.distanceMax * 1.3);
    }
    if (re.goal && !this.reached(re.goal)) this.ctx.moveTo(re.goal, SPEED.retreat, "retreat");
    else this.ctx.hold();
    if (this.stateT >= RETREAT.maxDuration && !snap.anyInView) this.despawn();
  }

  // ------------------------------------------------------------------ DEATH
  enter_death() {
    cancelImitation(this.imitator);
    abortStrike(this.strike, this.t);
    this.finish("killed");
    const low = !!(this.snap && this.snap.creature.posture !== "tall");
    this.vis = { ...this.vis, pose: low ? "death_low" : "death", tail: "free", breath: "none", tremor: 0, jaw: 40, look: "none" };
    this.cue("death");
    this.fx("end");
    this.flag("killed");
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

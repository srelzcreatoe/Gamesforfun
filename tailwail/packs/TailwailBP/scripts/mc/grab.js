// The grab: Tailwail lifts its victim to its face and holds them there.
// While held the player cannot walk or turn (Jump and Sneak still register: they are the
// struggle).  Every tick the player is placed in its hands, facing its face.
//
// The struggle is different every time (core/combat_rules.js struggleSpec): mash JUMP, mash
// SNEAK, alternate them, or "don't move"; the number of presses and the time allowed vary,
// the grip can shift halfway (the input changes), and sometimes it cannot be broken.
// Release paths: struggled free, dropped (stayed still), thrown, smashed, bitten, or aborted
// (it died, the victim died / left / changed dimension).  Every path restores input,
// title and fall protection.
import { EntityDamageCause, system } from "@minecraft/server";
import { GRAB } from "../config.js";
import { struggleProgress } from "../core/combat_rules.js";
import { dirFromYaw } from "../util/vec.js";
import * as fx from "./fx.js";
import { dlog } from "./log.js";

const active = new Map(); // player id -> GrabController
const PROMPT = {
  jump: "§7Mash §fJUMP",
  sneak: "§7Mash §fSNEAK",
  alternate: "§7Alternate §fJUMP §7+ §fSNEAK",
  still: "§7Don't. Move.",
};

export function grabFor(playerId) {
  return active.get(playerId);
}

/** Routed from world.afterEvents.playerButtonInput: "jump" | "sneak" pressed. */
export function onStrugglePressed(player, button) {
  const g = active.get(player.id);
  if (g) g.press(button);
}

export class GrabController {
  /**
   * @param {import("@minecraft/server").Entity} tw
   * @param {import("@minecraft/server").Player} player
   * @param {object} settings world settings
   * @param {object} spec from struggleSpec(): {kind, needed, window, shiftAt, shiftTo, inescapable}
   */
  constructor(tw, player, settings, spec) {
    this.tw = tw;
    this.player = player;
    this.settings = settings;
    this.spec = spec;
    this.kind = spec.kind;
    this.presses = 0;
    this.needed = Math.max(1, spec.needed | 0);
    this.holding = false;
    this.struggling = false;
    this.success = false;
    this.failed = false;
    this.calm = false;
    this.lastButton = null;
    this.interval = undefined;
    this.dimId = player.dimension.id;
    this.t0 = 0;
    this.ticks = 0;
    this.shifted = false;
  }

  holdPoints() {
    const l = this.tw.location;
    const f = dirFromYaw(this.tw.getRotation().y);
    return {
      hold: { x: l.x + f.x * GRAB.holdForward, y: l.y + GRAB.holdUp, z: l.z + f.z * GRAB.holdForward },
      face: { x: l.x + f.x * GRAB.faceForward, y: l.y + GRAB.faceUp, z: l.z + f.z * GRAB.faceForward },
    };
  }

  start() {
    const p = this.player;
    if (!p.isValid || active.has(p.id)) return false;
    this.holding = true;
    active.set(p.id, this);
    fx.lockInput(p); // walking and turning; Jump and Sneak stay live for the struggle
    try {
      p.addEffect("slow_falling", 20 * 10, { amplifier: 0, showParticles: false });
    } catch {
      /* cosmetic */
    }
    fx.shake(p, 0.4, 0.5, true);
    fx.title(p, "§4§lIT HAS YOU", "§8...", 30, 0, 0.2);
    this.place();
    this.interval = system.runInterval(() => this.tick(), 1);
    return true;
  }

  /** Called by the brain when the lunge has closed its hands: the clock starts. */
  beginStruggle() {
    if (!this.holding) return;
    this.struggling = true;
    this.ticks = 0;
    this.show(true);
  }

  bar() {
    const n = 12;
    if (this.spec.inescapable) return `§8[§4${"|".repeat(n)}§8]`;
    if (this.kind === "still") {
      const k = Math.round(Math.min(1, this.ticks / 20 / this.spec.window) * n);
      return `§8[§7${"|".repeat(k)}§8${"|".repeat(n - k)}§8]`;
    }
    const k = Math.round(struggleProgress(this.presses, this.needed) * n);
    return `§8[§c${"|".repeat(k)}§8${"|".repeat(n - k)}§8]`;
  }

  show(titleToo) {
    const p = this.player;
    const prompt = this.spec.inescapable ? "§4It is too strong." : PROMPT[this.kind];
    if (titleToo) fx.title(p, "§4§lIT HAS YOU", `${prompt}  ${this.bar()}`, 30, 0, 0.2);
    else fx.subtitle(p, `${prompt}  ${this.bar()}`);
  }

  place() {
    const p = this.player;
    const { hold, face } = this.holdPoints();
    p.teleport(hold, { facingLocation: face, keepVelocity: false, checkForBlocks: false });
  }

  tick() {
    if (!this.holding) return;
    const p = this.player;
    let ok = false;
    try {
      ok = p.isValid && this.tw.isValid && p.dimension.id === this.dimId && p.getComponent("minecraft:health").currentValue > 0;
    } catch {
      ok = false;
    }
    if (!ok) {
      this.release("lost");
      return;
    }
    try {
      this.place();
    } catch (e) {
      dlog("grab place", e);
      this.release("lost");
      return;
    }
    if (!this.struggling || this.success || this.failed || this.calm) return;
    this.ticks += 1;
    const t = this.ticks / 20;
    if (!this.shifted && this.spec.shiftAt !== null && t >= this.spec.shiftAt) {
      // it shifts its grip: the way out changes
      this.shifted = true;
      this.kind = this.spec.shiftTo;
      this.lastButton = null;
      fx.shake(p, 0.5, 0.3, true);
      fx.title(p, "§4§lIT SHIFTS ITS GRIP", `${PROMPT[this.kind]}  ${this.bar()}`, 30, 0, 0.2);
    }
    if (this.kind === "still") {
      if (this.ticks % 4 === 0) this.show(false);
      if (t >= this.spec.window) this.calm = true;
      return;
    }
    if (t >= this.spec.window) this.failed = true;
  }

  /** button: "jump" | "sneak" | "hit" (the victim hitting it: counts double, but is movement) */
  press(button) {
    if (!this.holding || !this.struggling || this.success || this.failed || this.calm) return;
    if (this.kind === "still") {
      this.failed = true; // it felt you move
      fx.shake(this.player, 0.6, 0.25, true);
      return;
    }
    if (this.spec.inescapable) {
      fx.shake(this.player, 0.15, 0.15);
      return;
    }
    let n = 0;
    if (button === "hit") n = 2;
    else if (this.kind === "alternate") n = button !== this.lastButton ? 1 : 0;
    else if (button === this.kind) n = 1;
    this.lastButton = button === "hit" ? this.lastButton : button;
    if (!n) return;
    this.presses += n;
    if (this.presses >= this.needed) this.success = true;
    this.show(false);
    fx.shake(this.player, 0.12, 0.15);
  }

  /** kind: "free" | "drop" | "throw" | "smash" | "bite" | "abort" | "lost" */
  release(kind) {
    if (this.interval !== undefined) {
      system.clearRun(this.interval);
      this.interval = undefined;
    }
    const wasHolding = this.holding;
    this.holding = false;
    active.delete(this.player.id);
    const p = this.player;
    if (!p.isValid) return;
    fx.unlockInput(p);
    fx.clearTitle(p);
    // fall protection for the drop, then it wears off
    system.runTimeout(() => {
      try {
        if (p.isValid) p.removeEffect("slow_falling");
      } catch {
        /* gone */
      }
    }, kind === "throw" ? 50 : 25);
    if (!wasHolding || kind === "abort" || kind === "lost") return;
    const tw = this.tw.isValid ? this.tw : undefined;
    const f = dirFromYaw((tw ? tw.getRotation().y : 0) + (kind === "throw" ? GRAB.throwSideDeg : 0));
    const dmg = (amount) => {
      try {
        p.applyDamage(amount, tw ? { cause: EntityDamageCause.entityAttack, damagingEntity: tw } : { cause: EntityDamageCause.entityAttack });
      } catch (e) {
        dlog("grab damage", e);
      }
    };
    const s = this.settings;
    try {
      if (kind === "throw") {
        p.applyKnockback({ x: f.x * GRAB.throwH, z: f.z * GRAB.throwH }, GRAB.throwV);
        dmg(s.throwDamage);
        fx.shake(p, 0.6, 0.6, true);
      } else if (kind === "smash") {
        dmg(s.smashDamage);
        fx.fade(p, 0.0, 0.25, 0.8, { red: 0.35, green: 0, blue: 0 });
        fx.shake(p, 1.0, 0.7, true);
        p.addEffect("slowness", 40, { amplifier: 2, showParticles: false });
        p.addEffect("nausea", 80, { amplifier: 0, showParticles: false });
      } else if (kind === "bite") {
        dmg(s.biteDamage);
        fx.fade(p, 0.05, 0.15, 0.9, { red: 0.45, green: 0, blue: 0 });
        fx.shake(p, 0.8, 0.5, true);
        p.applyKnockback({ x: f.x * 0.9, z: f.z * 0.9 }, 0.2);
      } else if (kind === "free") {
        dmg(GRAB.freeDamage);
        p.applyKnockback({ x: f.x * 1.4, z: f.z * 1.4 }, 0.38);
        fx.actionbar(p, "§aYou tore free. §7RUN.");
      } else if (kind === "drop") {
        p.applyKnockback({ x: f.x * 0.5, z: f.z * 0.5 }, 0.15);
        fx.actionbar(p, "§7It lets you fall.");
      }
    } catch (e) {
      dlog("grab release", e);
    }
  }
}

/** Emergency release of everything (world shutdown / reload / disable). */
export function releaseAll() {
  for (const g of [...active.values()]) g.release("abort");
}

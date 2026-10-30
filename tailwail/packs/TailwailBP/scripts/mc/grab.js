// The grab: Tailwail lifts its victim to its face and holds them there.
// While held the player cannot walk, turn or crouch (Jump still works: mashing it is
// the struggle).  Every tick the player is placed in its hands, facing its face.
// Release paths: struggled free, thrown, bitten, or aborted (it died, the victim died /
// left / changed dimension).  Every path restores input, title and fall protection.
import { EntityDamageCause, system } from "@minecraft/server";
import { GRAB } from "../config.js";
import { struggleProgress } from "../core/combat_rules.js";
import { dirFromYaw } from "../util/vec.js";
import * as fx from "./fx.js";
import { dlog } from "./log.js";

const active = new Map(); // player id -> GrabController

export function grabFor(playerId) {
  return active.get(playerId);
}

/** Routed from world.afterEvents.playerButtonInput (Jump pressed). */
export function onJumpPressed(player) {
  const g = active.get(player.id);
  if (g) g.press(1);
}

export class GrabController {
  /**
   * @param {import("@minecraft/server").Entity} tw
   * @param {import("@minecraft/server").Player} player
   * @param {object} settings world settings
   */
  constructor(tw, player, settings) {
    this.tw = tw;
    this.player = player;
    this.settings = settings;
    this.presses = 0;
    this.needed = Math.max(1, settings.strugglePresses | 0);
    this.holding = false;
    this.interval = undefined;
    this.dimId = player.dimension.id;
    this.lastBar = -1;
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
    fx.lockInput(p);
    try {
      p.addEffect("slow_falling", 20 * 8, { amplifier: 0, showParticles: false });
    } catch {
      /* cosmetic */
    }
    fx.shake(p, 0.35, 0.5, true);
    fx.title(p, "§4§lIT HAS YOU", this.bar(), 30, 0, 0.2);
    this.place();
    this.interval = system.runInterval(() => this.tick(), 1);
    return true;
  }

  bar() {
    const n = 12;
    const k = Math.round(struggleProgress(this.presses, this.needed) * n);
    return `§7Mash §fJUMP§7  §8[§c${"|".repeat(k)}§8${"|".repeat(n - k)}§8]`;
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
    }
  }

  press(n) {
    if (!this.holding) return;
    this.presses += n;
    const k = Math.round(struggleProgress(this.presses, this.needed) * 12);
    if (k !== this.lastBar) {
      this.lastBar = k;
      fx.subtitle(this.player, this.bar());
    }
    fx.shake(this.player, 0.12, 0.15);
  }

  /** kind: "free" | "throw" | "bite" | "abort" | "lost" */
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
    try {
      if (kind === "throw") {
        p.applyKnockback({ x: f.x * GRAB.throwH, z: f.z * GRAB.throwH }, GRAB.throwV);
        dmg(this.settings.throwDamage);
        fx.shake(p, 0.6, 0.6, true);
      } else if (kind === "bite") {
        dmg(this.settings.biteDamage);
        fx.fade(p, 0.05, 0.15, 0.9, { red: 0.45, green: 0, blue: 0 });
        fx.shake(p, 0.8, 0.5, true);
        p.applyKnockback({ x: f.x * 0.9, z: f.z * 0.9 }, 0.2);
      } else if (kind === "free") {
        dmg(GRAB.freeDamage);
        p.applyKnockback({ x: f.x * 1.3, z: f.z * 1.3 }, 0.35);
        fx.actionbar(p, "§aYou tore free. §7RUN.");
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

# Grinshackle — The Chainbound Dweller (v4.0.0)

A non-experimental Minecraft Bedrock add-on built around the supplied Grinshackle Chainreaver rig (77 bones, 736 cubes, 64×64 texture,
21 animations). Grinshackle listens, remembers, and deliberately lets you notice it. Its chains give it away — until it learns to hold them still.

This is a rebuild of the v1 "Chainreaver" pack: same pack identity (the manifest header UUIDs are unchanged, so it updates in place),
new namespace `gs:`, new encounter director, new audio, new items, a configuration dial, and every one of the 21 clips wired to a real trigger.

## Install and play

1. Open `Grinshackle_Chainbound_Dweller_v4.0.0.mcaddon` with Minecraft Bedrock (1.21.90 or later).
2. Add **Grinshackle — The Chainbound Dweller [BP]** and **[RP]** to a world. Leave every experiment toggle **off**; none is needed.
3. Play Survival or Adventure on Easy/Normal/Hard. Natural encounters happen in the **Overworld only**, underground, at or below **Y = 0**
   by default (configurable), for players who are not in Creative/Spectator, joined more than 20 s ago and did not die in the last 60 s.
4. The first natural encounter starts after a two-minute grace period; later ones wait three to six minutes (random). Not every omen leads to a
   spawn, and not every sighting becomes a chase.

You receive a **Chainbound Dial** the first time you join. Use it to open the configuration menu. If you lose it, craft one (gold ingots around
a chain) or run `/function grinshackle/dial`.

Upgrading a world that ran v1: the old `cr:chainreaver` entity is retired automatically and its saved reservation is cleared on first load.

## What you are up against

* **Encounter director** — DORMANT → OMENS → EMERGE → OBSERVE / INVESTIGATE / STALK / FLANK → WARNING → HUNT → SEARCH / RETREAT → COOLDOWN, with
  attacks, crawling, hurt reactions and enrage as substates. A bounded tension value (noise, proximity, staring, provocation raise it; quiet
  separation and lit refuges lower it) decides when a stalk becomes a warning and a hunt. Hunts are capped at 45 s.
* **Chain Snap** — while hunting it sheds chain-fragment markers (max 12, six-second life). Walking or sprinting over one rattles it; it plays the
  chain_snap clip and then gets four seconds of +20 % speed and +2 damage. Sneaking over a fragment never triggers it. There is a cooldown; the
  bonus never stacks.
* **Borrowed Footsteps** — after you stop, a delayed imitation of your own cadence continues from somewhere plausible nearby: two steps, a pause,
  one extra step, on the right surface material. Changing direction or moving again disrupts it.
* **The Last Link** — a rare stalking variation where it gathers its chains into its hands: the rattling stops, it creeps more slowly, and only a
  faint foot friction and an occasional wrist click remain. Before any attack the chains release with a distinct click and a normal warning follows.
* **The Corner That Watches** — it prefers real cover (a column, a bend, a mineshaft support) and shows only part of itself. When you look at it, its
  head turns first and its body follows slowly. Watched long enough, it visibly tightens, then changes tactics. It walks to its next cover; it never
  teleports.
* **Answering the Mine** — after a rhythm of block breaks, a delayed metallic imitation comes back from deeper in the cave, with one extra tap you
  did not make. A bell, pressure plate, lever or button interrupts its listening, then draws its attention.
* **Remembered Thresholds** — within an encounter it keeps up to six passages you keep fleeing through (90 s memory) and may walk to a side route and
  wait near the entrance. Change routes or break contact and the pattern breaks.
* **The Unfinished Retreat** — at most once per encounter it withdraws behind cover and crouches, listening. The music stops because the chase
  paused. A new disturbance brings it back (with a warning, on the remaining hunt budget); otherwise it genuinely leaves.
* **Light** — clusters of placed light sources (torches, lanterns, glowstone, froglights, copper bulbs…) discourage it. It hesitates at a strongly
  lit threshold, inspects the edge, then withdraws. This is a bounded nearby-light-block approximation with obstruction checks, not a light-level
  reading. A single distant torch does nothing; three or more real lights around you do.
* **Rattle Lure** — craft it from two Broken Chains, an Ink-soaked Scrap and string. Use it to throw a decoy rattle up to 10 blocks away. While it is
  observing, investigating or searching, the decoy redirects it for a few seconds. Identical placements lose effect (the actionbar tells you).
  It never cancels an attack that is already committed.
* **Adaptive profile** — a small, world-local, inspectable set of counters per player (sprinting, sneaking, staring, lights placed, escape headings,
  tight-passage use, melee rushes, dodge side). It shifts probabilities, patience and route choice only — never damage, immunity or hidden speed.
  Turn learning off or forget a profile from the dial. It is not a neural network and knows nothing outside this world.

## Combat

| Attack | Contact | Clip | Base damage (Normal) | Starts within | Hits within |
|---|---:|---:|---:|---:|---:|
| Forward chained-fist strike | 0.60 s | 1.35 s | 10 | 1.7 blocks | 1.8 blocks |
| Overhead slam | 0.85 s | 1.75 s | 12 | 1.6 blocks | 1.7 blocks |
| Crawling strike | 0.50 s | 1.15 s | 9 | 1.8 blocks | 1.95 blocks |

Easy ×0.65, Hard ×1.25, rounded. Health 80 (configurable 40–200). Damage is applied once per attack, at the impact tick, only after rechecking
distance, facing, vertical overlap, eligibility and line of sight. The body stops tracking you six ticks before impact, so a real dodge stays a
dodge. The entity has no native melee component, so a scripted hit can never be doubled. Stalking, emergence, feints (lunge, chain whip) and
previews never deal damage. In two-block passages it drops to a 1.95-block collision box and crawls; it stands up only with three blocks of
clearance. Unreachable pursuits end in a search, then a retreat — it never breaks blocks, hovers or teleports.

Hits reduce a script-tracked 80-point pool (the entity's engine health pool is larger so that the collapse clip can play in full). At zero it
collapses, drops Broken Chain ×2–4, Ink-soaked Scrap ×1–3 and a Grinshackle Fang (30 %), gives experience, and the encounter ends with a longer
cooldown. Nothing attacks you while you collect the drops.

## One creature per world

A persistent reservation (world dynamic property) plus a generation number on the creature guarantees a single Grinshackle across the whole
world, all dimensions, natural spawns, spawn eggs, `/summon`, test spawns, previews and reloads. Extra eggs dissolve immediately. A creature in
an unloaded chunk keeps its reservation; it resumes through emergence when loaded again. If it stays lost for 10 minutes (configurable) the
reservation is retired and the stale creature removes itself the next time it loads — it can never become a second authorised encounter.

## Commands (operator)

All commands are `/function grinshackle/<name>` (each runs `/scriptevent gs:control <verb>`):

| Function | Effect |
|---|---|
| `status` | Explains the spawn gate (disabled, grace, cooldown, Peaceful, wrong habitat, no eligible player, reserved/unloaded, no safe location) and the encounter state |
| `spawn` / `test` | Test encounter near you (master must be ON; Peaceful and an existing reservation block it) |
| `preview`, `preview_next`, `preview_list`, `preview_stop` | Harmless two-minute preview; `/scriptevent gs:control preview <clip>` plays a specific clip, `preview loop` cycles all 21 |
| `end` / `reset` | End the encounter and clean up (reset also clears cooldown and grace) |
| `enable` / `disable` | Master ON / OFF. OFF stops damage, cancels callbacks, retires the reservation, clears markers and stops audio immediately |
| `natural_on` / `natural_off` | Natural spawning without touching master |
| `mute` / `restore` | Grinshackle audio only (subtitle cues stay) |
| `cooldown` | Clear cooldown and grace |
| `forget` / `forget_all` | Erase your profile / every profile |
| `dial` | Recover a Chainbound Dial (never a duplicate) |
| `admin` | Mark yourself as a dial admin (the command already requires operator permission) |
| `debug_on` / `debug_off`, `learn_on` / `learn_off`, `preset_*` | Diagnostics, learning toggle, presets |

## The Chainbound Dial

Eight sections: Master, Spawning, Behavior, Audio, Encounter Tools, Player Study, Presets, Status. Admin sections (everything except personal
Audio and Status) require the world owner (the first player who joined after installing) or the `gs_admin` tag from `/function grinshackle/admin`.
The menus are standard Bedrock forms (button lists and sliders) so they work on touch, controller and keyboard and with other UI packs. There is
no custom radial interface in this version.

Presets: **Balanced** (defaults), **Slow Dread** (longer cooldowns and stalks, fewer spawns, gentler), **Relentless** (short cooldowns, aggressive,
faster — fairness limits, the 45 s hunt cap and full cleanup still apply), **Showcase** (no natural spawns, zero damage, all omens on).

Settings persist in the world. Personal audio volumes, subtitles and mute are per player.

## Audio and accessibility

25 original synthesized sounds (chain drag, wrist click, breathing, alert, answering tap, warning, wind-up, strike, impact, ink, defeat, chain
snap, roar, rattle, lure, chain release, hurt, collapse, five footstep surfaces) and two original music beds (a sparse stalking texture and a
restrained 96-BPM pursuit track), all under the `gs.` namespace so cleanup never silences anything else. Music plays only for the targeted
player and stops on retreat, defeat, target loss, disable, dimension change and reload. Important warnings have actionbar subtitles.

## Files

* `Grinshackle_Chainbound_Dweller_v4.0.0.mcaddon` — installable.
* `source/Grinshackle_BP`, `source/Grinshackle_RP` — editable packs (the same files).
* `assets/` — supplied `.bbmodel`, geometry, 64×64 PNG, original animation JSON, and the revised `grinshackle_chainreaver_v4.bbmodel` /
  animation JSON with the documented corrections.
* `preview/` — software-rendered animation preview (GIF + contact sheets). **Not in-game footage.**
* `tests/` — the Node.js mock-API harness and 21 behaviour scenarios (102 checks, all passing). This is not a Minecraft playtest; see
  `test_report.md` for exactly what was and was not tested.
* `animation_usage_report.md`, `compatibility_report.md`, `test_report.md`, `docs/ARCHITECTURE.md`.

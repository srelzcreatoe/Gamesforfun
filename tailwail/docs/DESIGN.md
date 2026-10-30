# Design and architecture

## Modules (packs/TailwailBP/scripts)

| Module | Responsibility | Minecraft API? |
|---|---|---|
| `config.js` | every tuning constant, presets, limits | no |
| `core/brain.js` | the encounter state machine (one per creature) | no — tested in Node |
| `core/agitation.js` | 0–100 agitation model, cue levels | no |
| `core/gestures.js` | gesture detection from observed samples, delayed replay queue | no |
| `core/memory.js` | per-player bounded, versioned, decaying memory | no |
| `core/scheduler.js` | grace / cooldown / post-death / eligibility rules | no |
| `core/setups.js` | the six encounter setups and selection | no |
| `core/combat_rules.js` | the single damage rule (wind-up, impact frame, reach, LOS, cooldown, once per strike) | no |
| `core/audio_rules.js` | cue table and limiters | no |
| `mc/director.js` | one global decision loop, scheduling, spawning, event wiring, adoption and sweeps | yes |
| `mc/encounter.js` | binds one entity + lure + brain + locked target; perception snapshot; property sync; damage | yes |
| `mc/perception.js` | watching/line-of-sight both ways, through-glass handling | yes |
| `mc/spots.js` | observation/stand-off/retreat/search/cover spots, spawn search, route check | yes |
| `mc/mover.js` | lure navigation, posture/collision profiles, stuck detection and recovery | yes |
| `mc/terrain.js` | block classification, clearance scans | yes |
| `mc/audio.js`, `mc/effects.js` | per-player sound playback, optional camera shake | yes |
| `mc/store.js` | dynamic-property persistence | yes |
| `mc/ui.js`, `mc/commands.js` | field guide, settings forms, slash commands | yes |

One `system.runInterval` drives every encounter's decision tick (every 4 game ticks), one
drives scheduling (every 20 ticks, one player per pass, each player checked every 10 s),
one sweeps orphans (every 200 ticks). No per-animation timers exist. The spawn-site search
runs as a `system.runJob` generator so it never stalls a tick.

## State machine

Exactly one `Brain` per Tailwail; the director refuses a second controller for the same
entity id, so state and damage have a single authority.

| State | Entry | Update | Exits | Ceiling |
|---|---|---|---|---|
| **stalk** | posture per setup (folded/hunched by default), tail *drag*, voice *breath*, randomised stalk duration 40–95 s × memory factor (0.8–1.2) | holds still while any player clearly watches; repositions through real space (lure navigation) to hidden/dark spots when unobserved; learns gestures only while it sees the target; ambient cues spaced 14–55 s; setup-specific behaviour (peek, silhouette, low tunnel, voluntary withdrawal); approach to a stand-off spot 8–12 blocks in clear view | → standoff (arrived, approached, provoked by a hit); → retreat (setup done, approach interrupted by a long stare or a second player, nothing found); target lost → retreat | 180 s |
| **standoff** | holds, faces target, head tracking; max duration 40–70 s | agitation from the **locked target only**; cue level 1 (drag, slow breath) / 2 (twitch, throat clicks, distorted imitation, menace posture, one inhale above 75); delayed imitation; rehearses learned gestures in quiet moments; only an agitated creature (≥ 55) follows a retreating player, and only while unobserved | agitation 100 → unfold; calm withdrawal (≥ 20 blocks & < 55, or 6 s unseen & < 60) → retreat *calm*; time-out → unfold if ≥ 70 else retreat | ~75 s |
| **unfold** | imitation cancelled, tail *rigid*, voice *silent*, rises as tall as headroom permits (reveal + full/mid overlay; low-ceiling variant 1.2 s); if it was mid-imitation it keeps rising from a hiked-shoulder gesture for 0.6 s first | uninterruptible; holds and faces | → windup after the clip | 2.5 s |
| **windup** | the supplied 3.2 s `windup` (or `windup_c` when hunched), voice *inhale*, jaw stretched | holds; collision shrinks to the hunched profile at 0.8 s when the clip is planted | → chase at 3.2 s | 3.7 s |
| **chase** | one wail (re-armed only by a new commitment); 1.0 s planted wail; one pursuit budget per commitment | moves toward the target **while it can see it**, else toward the last seen position; strikes: 0.55 s wind-up to impact, reach 3.2, ±70°, line of sight at impact, once per strike, 1.2 s cooldown; posture adapts to tunnels | escape: ≥ 8 s unseen and ≥ 16 blocks → search; budget spent → search; last-known reached unseen → search; stuck after 3 bounded recoveries → search; target dead → retreat *caught* | 60 s |
| **search** | tail *twitch*, silent; 2–3 points near the last-known position | walks to points, listens 1.5 s (throat click) at each; can resume the same pursuit (no new wail) if it sees the target and budget remains | → frustrated rear-up (ambush clip) + snarl → retreat *escaped* | ~13 s |
| **retreat** | tail *drag*, silent, retreat sound; destination 28–40 blocks away from players (memory factor up to ×1.4), preferring darkness and no line of sight | walks away; picks up to 3 further spots if still seen | despawns only when **no player is watching it** and it is ≥ 20 blocks from the target or out of every player's line of sight | 120 s (still waits until unobserved) |
| **death** | lethal damage is cancelled and replaced by a scripted death (state *death*, invulnerable) so the full 2.0 s death clip plays | holds | removed after 2.4 s, drops XP | 4 s |

Encounter outcomes recorded in memory and stats: *observed*, *calm*, *interrupted*,
*escaped*, *caught*, *killed*, *aborted*.

## Encounter setups

| Setup | Entry conditions | Cues | Typical outcomes |
|---|---|---|---|
| distant_silhouette | 22–28 blocks; ≥ 5 blocks headroom; picks dim spots *in* view | standing tall at the edge of the dark, breath | observed; escalates only if you walk within 14 |
| corner_peek | 16–24 blocks; edge spots where the body is hidden but a side is visible | lean-out peek toward the visible side; withdraws when stared at 2.5 s; 2–3 peeks | observed, or approach → stand-off |
| delayed_imitation | 18–26 blocks | folded stalking, tail scrapes, then a stand-off focused on copying | calm, interrupted, pursuit |
| low_tunnel_observation | 16–24 blocks in a passage only 2–3 blocks high | watches flat from the crawlspace, nail scrapes | observed; escalates if you come within 7 |
| full_height_reveal | needs a ≥ 7-block cavern near the spawn | approaches folded, then stands to full height in view with an inhale | stand-off → calm or pursuit |
| voluntary_withdrawal | 18–28 blocks | noticed once, then withdraws on its own after 6–12 s with drag/retreat sounds | observed (uncertain presence) |

Selection: weighted by memory novelty (the previous setup has weight 0, so it never
repeats back-to-back), filtered by measured headroom at the found spawn site.

## Scheduling

Per player, persisted with `world.getAbsoluteTime()` so quitting cannot skip it:
initial grace (10 min), post-death protection (5 min), randomised cooldown after each
encounter (6–10 min, stretched after pursuits, occasional quiet stretch). Eligibility also
requires: Survival/Adventure, Overworld, alive, ≥ 8 HP, not hurt by something else in the
last 8 s, not in water / riding / sleeping / flying, underground (sky light ≤ 3 at the head
and below y 62) for cave encounters, no encounter within 96 blocks, global cap not reached,
not Peaceful (Peaceful also ends active encounters). Then a per-10 s roll (22 % × frequency).

Spawn site (all must pass): loaded chunk; floor + clearance for the setup's posture;
combined light ≤ 7 at feet and head; no line of sight from **any** player's eyes to the
head, body or feet; ≥ 14 blocks from every player; within 10 blocks vertically; no lava
within 2 blocks; a plausible walking route found by a bounded flood fill (700 nodes) to
within 5 blocks of the player. Columns behind the player's facing are tried first.

## Memory

Per player, ≤ 900 bytes, version 1. Stores: gestures it observed (count ≤ 99, weight
0–1 decaying ×0.85 per encounter, last pitch), outcome counters, reaction weights
(approach/flee/attack/hide/stare), the last 4 setups, an average notice time.
Influence (all bounded): stalking duration ×0.8–1.2; setup weights (novelty, stare →
more silhouettes, flee → more corner peeks); retreat distance ×1.0–1.4; which gesture it
rehearses; the **remembered-gesture opener** (60 % chance when a gesture was seen ≥ 2
times and still has weight). It never changes damage, warning length or escape rules and
never uses information it did not observe. `Erase my memory` and `/tailwail:debug
resetmemory` delete it.

## Navigation and posture

Tailwail walks with the engine's pathfinder (`navigation.walk`, `melee_box_attack`)
toward an invisible, invulnerable, non-colliding **lure** entity that the script places
(measured in BDS: it arrives within 0.05 blocks). Lure slots a/b/c give each creature its
own lure family. Speed is the movement attribute (measured ≈ 43.2 × value² blocks/s).

Collision profiles (component groups, all 0.9 wide): tall 3.9 high, hunch 2.8, crawl 1.8.
The posture controller shrinks immediately when headroom here or 1–2 blocks ahead
requires it, and grows only after measuring enough clearance where it stands (1.5 s
hysteresis). The brain can cap it (pursuit is hunched) or ask to stay folded.
Stuck = < 0.6 blocks progress in 3 s toward a goal > 2.5 blocks away. Recovery is bounded:
smaller posture → side-step to real footing → give up (search/withdraw). It never teleports.

## Multiplayer rules

* **Target lock:** chosen at spawn (in a group: the player deepest in darkness). Never
  switched by other players watching. One switch allowed per encounter, only in
  stalk/stand-off and only if the original target became invalid and another player hits it.
* **Observers:** any player clearly watching freezes stalking movement and counts as
  "watched" for despawn safety; only the locked target feeds agitation, so several
  starers cannot multiply it. Hits from any player add a rate-limited agitation burst.
* **Caps:** one encounter per player group (no other encounter within 96 blocks), global
  cap 2 (1–3). Spawning respects every nearby player's sight lines and distance;
  despawning waits until no player watches.
* **Disconnect / death / dimension change of the target:** the encounter withdraws and
  despawns out of view; its lure is removed; cooldown and memory are saved.
* **Reload / unloaded chunks:** a Tailwail found without a controller (world reload,
  chunk reload) is adopted in withdrawal mode and despawns out of view (or immediately if
  no player is near); orphan lures are removed by owner check. `minecraft:despawn`
  (96–128 blocks) is a last-resort safety net if scripts are unavailable.

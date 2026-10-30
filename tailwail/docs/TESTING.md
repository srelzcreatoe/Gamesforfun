# Testing: how to run it and what has been verified

Evidence is separated by kind. Nothing below claims an in-client test, a device frame
rate or player feedback that did not happen.

## 1. Static validation — `python3 -I tools/validate.py [--tsc-types DIR]`

Result on the shipped build: **9 check groups, 0 errors**.

* all pack JSON parses; manifests: format 2, unique UUIDs, BP⇄RP dependency, engine
  `[1,26,60]`, modules pinned to stable `@minecraft/server 2.11.0` and `@minecraft/server-ui 2.3.0`,
  no capabilities/experiments, no beta/preview module references anywhere;
* every script import resolves; `node --check` on every file; **TypeScript type-check of
  all 24 scripts against the stable 2.11.0 / 2.3.0 typings** (with `--tsc-types`);
* entity events reference existing component groups; ≤ 32 properties, ≤ 16 enum values;
  every `triggerEvent`, `setProperty` name and enum value used by scripts exists;
* client entity: geometry, textures, render controllers, all 66 animation references and
  6 controllers resolve; every controller state's clips are mapped; every transition
  target exists; **all bones animated by any clip exist in the geometry (54)**;
  **every Molang variable read is written by the client entity (26/26)**, including all
  seven supplied-clip variables in `initialize`; every `q.property` read exists, is
  `client_sync`, and compares against real enum values;
* `config.js` clip durations equal the animation lengths (unfold 2.0, windup 3.2,
  strike 0.95, unfold-low 1.2, ambush 1.3, peek 0.9, death 2.0);
* all 15 sound events have files; every cue's sound id is defined; subtitles exist;
* item/egg icons, lang keys, pack icons exist;
* generated assets are reproducible (`build_assets.py --check`) and the original archive
  hash is unchanged.

## 2. Unit tests — `node --test tests/*.test.mjs`

Result: **29/29 pass** (Node 22). Coverage of the rules that matter for fairness:
glance grace and repeated-glance draining; calm decay; hit bursts rate-limited; gesture
detection only while continuously observed; replay 1–2 s after the gesture; distortion
grows with agitation; one damage per strike, no damage without LOS/reach/facing, cooldown;
wail once per commitment; per-player sound cap; memory bounded (≤ 900 bytes after 1000
encounters), decaying, versioned, defensive parsing; setups never repeat back-to-back and
respect terrain; grace / post-death / cooldown bounds; every eligibility rejection reason;
state machine: unfold → 3.2 s wind-up → one wail, rigid tail only during commitments,
provocation still gives ≥ 5.2 s before damage, watching does not freeze pursuit, escape →
search → retreat → despawn, finite pursuit budget, calm withdrawal, stand-off ceiling,
stalking holds while watched / moves when not, delayed copy, nothing learned unseen,
remembered-gesture opener, clean withdrawal on target loss, outcome labels (a disconnect
is not a kill), per-state ceilings, voluntary withdrawal.

## 3. Runtime on Bedrock Dedicated Server 1.26.61.1 (no experiments)

`python3 tools/bds_scenarios.py --server <scratch BDS dir>` builds a **test copy** of the
behavior pack plus `devtests/harness/devharness.js` and runs scripted scenarios on a fresh
flat world. BDS has no real players, so the harness drives the real encounter code with a
**stand-in player** (an armor stand implementing the Player members the code reads). Real
terrain, real raycasts, real pathfinding, real entity events. Full log:
[test_logs/bds_scenarios_1.26.61.txt](test_logs/bds_scenarios_1.26.61.txt).

| Scenario | Observed result |
|---|---|
| boot (shipped `.mcaddon` contents, default world) | both packs load; `[Tailwail] v1.0.0 ready`; no content-log errors or warnings from the packs at verbose level; `/tailwail:debug status` answers from the console; `/summon` is adopted |
| navigation (dev pack) | walks to the lure and stops within 0.05 blocks; speed ≈ 43.2 × movement² (0.30 → 3.89 b/s, 0.45 → 8.74 b/s) |
| gaze | facing it in the open = watching; facing away = not; **facing it through a stone wall = not watching and it cannot see you**; through glass = watching |
| commit | stand-off at agitation 99.9 → unfold (tail rigid, silent) → wind-up 3.2 s (collision shrinks at 0.8 s) → one wail → pursuit → strikes landed once each, ≈ 2.2 s apart |
| wall strike | target sealed in a stone box 2.5 blocks away: **no damage**; bounded stuck recovery ran |
| escape | target ran through a 1-high hole Tailwail cannot fit: stuck → recovery → lost sight → search (listening) → frustrated rear-up → retreat → despawned out of view; outcome *escaped*, no damage |
| tunnel | wall forces a 1-wide, 2-high tunnel: switched hunch → crawl at the entrance, crawled through, struck inside, withdrew after the kill (*caught*) |
| stalk | watched with clear sight: moved 0 blocks; unwatched for 10 s: crept a 14.3-block path between pillars in the dark (folded posture) |
| imitate | stand-in crouched at tick 20 → replay *crouch* scheduled 0.9–1.2 s after detection (≈ 1.4–1.7 s after the crouch began, plus ≈ 0.45 s client easing); memory recorded the crouch; a second encounter **opened with the remembered crouch** before any new crouch (the 60 % in-game chance forced to 100 % for the test) |
| calm | backing away at walking pace from a stand-off: withdrawal at 20 blocks, despawn out of view, outcome *calm*, no damage |
| death | lethal damage cancelled → death state 2.4 s → removed, outcome *killed* |
| spawn site | dark roofed cave with pillars: found a light-0, hidden, reachable site 26.8 blocks away in 62 ms (spread over ticks) |
| perf | three concurrent encounters (stalk / stand-off / chase): decision tick avg 1.4–2.0 ms across runs, p95 3 ms, max 7 ms, ≈ 10–10.5 raycasts per tick — BDS on a 2.1 GHz Xeon (4 vCPU); **not** a client or mobile measurement |

Issues found and fixed through these runs: stalking never moving (goal-arrival bug),
premature "reached last known", posture dropping beside solid columns, retreat without a
destination when the target stood on it, calm withdrawal blocked by following, a read of
a despawned entity, `scan_interval` performance warning, an invalid
`entityHurt` option (caught by the type-check).

## 4. In-game (client) verification — **pending**

No client was available. Manual plan for the first session (fresh Survival world,
experiments off, both packs active, `/tailwail:debug log on`):

1. Spawn egg in a dark cave: model, texture, 1.5× scale, feet on the floor in idle, hunch,
   gallop, tunnel crawl, unfold; head tracking; jaw breathing; tail drag/twitch/rigid.
2. Crouch, look up/down, stop dead while it watches → delayed copies; agitate it → twitching
   tail + clicks + distorted copies; keep staring → unfold, wind-up, wail, pursuit.
3. Back away calmly from a stand-off → withdrawal without attack.
4. Pursuit through open cavern, corners, 2-high tunnel, wooden door, stairs, 1-high gap;
   break sight for 8 s → search → withdrawal. Stand behind a wall at reach → no hit.
5. Die → respawn: no encounter for 5 min. Disconnect mid-chase, rejoin: creature gone,
   no stuck lure. Change dimension mid-stalk. Save & reload mid-encounter.
6. Two players with different sight lines; one stares, one hits it.
7. Settings forms (operator and non-operator), field guide item, volume/captions/effects.
8. A 60-minute survival session: note encounter times, setups, outcomes
   (`/tailwail:debug status`), quiet periods.
9. Content log: no errors from the packs. Record device, OS, game version and frame rate.

## 5. Playtest rubric (to be filled from real sessions)

Score each 0–2 per tester, with a one-line observation; do not self-assign.

| Question | Evidence to record |
|---|---|
| Did they notice it copying them? How long after the first copy? | quote / timestamp |
| Could they tell calm vs agitated vs committed from posture/sound alone? | which cue they cited |
| After an attack, could they explain why it attacked? | their explanation vs the logged cause |
| Did they discover an escape (line of sight, distance, 1-high gap, calm retreat)? | which |
| After 3+ encounters, still tense/interested? Did they notice the remembered gesture? | quote |

Pending: no playtests have been run.

## 6. Competitor comparison

Only a desk review of official coverage and listing text was possible
([COMPETITIVE_BASELINE.md](COMPETITIVE_BASELINE.md)). No side-by-side play comparison has
been done; no claim is made that Tailwail exceeds any product.

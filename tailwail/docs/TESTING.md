# Testing: how to run it and what has been verified

Evidence is separated by kind. Nothing here claims an in-client test, a device frame rate
or player feedback that did not happen.

## 1. Static validation: `python3 -I tools/validate.py --tsc-types <dir> --vanilla-sounds <file>`

Result on the shipped build: **14 check groups, 0 errors**.

- All pack JSON files parse (strictly: no NaN, no duplicate keys).
- Manifests: format 2, v3.1.0, unique UUIDs, BP⇄RP dependency, engine `[1,26,60]`,
  modules pinned to stable `@minecraft/server 2.11.0` / `@minecraft/server-ui 2.3.0`, no
  capabilities, no beta or preview modules.
- Every import resolves; `node --check` passes on all 32 scripts; **all scripts
  type-check with `tsc` against the stable typings**.
- Entities: every event's component groups exist; ≤ 32 properties; every
  `triggerEvent`, property and `tailwail:*` identifier used by scripts exists.
- **Client simulation** (`tools/client_sim.py`, below) passes.
- `CLIP.death` and the 17 one-shots in `core/ids.js` match the animation file: lengths,
  loop mode, and every hit / release / launch frame lies inside its clip; every one-shot
  the scripts play exists.
- Sounds:
  - all 43 events have their files and subtitles, and every custom sound id a script plays
    is defined;
  - music is `category: music` and streamed;
  - **all 33 vanilla sound ids** the scripts use exist in the 1.26.60 vanilla pack.
- Block, fog and particle: geometry, terrain texture and loot tables resolve; the custom
  component is registered by script; the block states match `torches.js`; every fog and
  particle id used by script exists.
- Echo: all 11 hallucination poses map to clips.
- Items, icons and lang keys present, including the resource-pack check key.
- No experiments, beta modules or holiday features are referenced.
- **Reproducibility:**
  - every generator (clips, client, assets) is re-run on a scratch copy and the output is
    byte-compared with the committed files (the whole v3 animation file is re-baked);
  - the model and texture copies match the supplied archive (the texture with exactly its two
    pupil pixels painted out);
  - the resource pack ships no stale animation file;
  - the supplied archive's sha256 is unchanged.

## 2. Client simulation: `python3 -I tools/client_sim.py`

A strict Molang parser and evaluator (`tools/molang.py`) plus a frame simulator that
emulates controller semantics: one transition per controller per frame, first true wins,
animations restart on entry, weighted `animate` entries evaluated every frame. Result:
**0 errors, 0 warnings**.

- Wiring: every animation ref and controller resolves; every Molang string parses; every
  query is documented; every `q.property` exists and is `client_sync`; every animated bone
  exists; **every variable read outside pre_animation has a `??` fallback**.
- **552/552** act-to-act transitions happen in one frame. A 600-step random schedule across
  all properties and speeds never desynchronises; every blend weight stays within [0, 1].
- Gait selection: idle at 0 m/s, walk at 2.6, gallop at 7.8, weights summing to 1.
- **Failure modes:** with the pre-animation script not running at all, the default state
  still idles, walks and gallops by speed, and breathing, tremor, look, jaw and tail stay
  on.
- Tail weights follow the tail property; the tunnel crawl hands the tail to the
  floor-solved clip. The hurt flinch returns, and never plays during death.
- Gaits are distance-driven: the phase wraps exactly once per stride (gallop 3.6, walk 2.94,
  creep 1.85, tunnel 1.0, squeeze 0.85 blocks).
- **Grounding:** every state at three speeds and every one-shot over the neutral state, with
  every overlay on, at 1.5×: nothing sinks through the floor or floats; the tunnel crawl and
  the reach-in stay under 2 blocks (1.97 max); **the squeeze stays under 1.15 blocks (1.03
  max still, 0.94 crawling)**.
- **Tail sweep:** every tail mode × locomotion state × speed stays out of the floor, under
  2.0 blocks in the tunnel and under 1.15 in the squeeze.

## 3. Unit tests: `node --test tests/*.test.mjs`

Result: **51/51 pass** (Node 22).

- **Brain (30 tests)**: the hunter opening; "quick to action" (20 seeds of a stalker opening
  reach the hunt within the caps); **the observation** (40 seeds: idle, approach and all
  four tests: bluff charge at full chase speed, sidestep, backing off, neck crane);
  **staring too long sets it off, a glance does not**; **shooting at it provokes it at once
  (a roar, not the scream) from the stand-off, the stalk and the ceiling ambush**, then it
  sprints at you; running from a test makes it likelier to attack than holding still; turning
  your back; too close and hits commit; **the grab is parked** (20 seeds at arm's length, no
  grab with default settings); **the Cave Dweller pace** (0.425 on every preset = 7.8
  blocks/s, attack starts never closer than 1.0 s, at least 8 attacks in 10 s); attacks land
  only at hit frames in reach; misses; the pounce; low ceilings; climbing, door smashing,
  **reaching into a hole and then asking for the squeeze posture to come in after you** (and
  not searching flattened); **squeezed: no pounces, slams or grabs, but rakes**; relentless
  for 60 s while in sight; losing it; search, noise, give-up and return; fleeing; the ceiling
  and corner ambushes; the low-ceiling roar; death; target loss; a 25-seed fuzz over every
  setup. The parked grab's code paths keep their tests (struggle variety, finishers,
  release paths) with the grab enabled explicitly.
- **Rules (11 tests):** agitation, gestures, imitation, hit reach for every attack, attack
  choice by range / cooldown / headroom / setting, grab reach, struggle spec per preset,
  finishers, audio limits.
- **Scheduler, presence, journal, memory (10 tests):** eligible-time waits, death
  protection, cooldowns, the escalation ladder; cave and surface setup lists; presence
  stage gating, cooldowns, needs (doors, windows, walls, torches), settings, no repeats,
  pacing by level; mimicry sound mapping; journal unlock; memory bounds and decay.

## 4. Runtime on Bedrock Dedicated Server 1.26.61.1 (no experiments)

```bash
python3 tools/bds_scenarios.py --server <scratch BDS dir>
```

This builds a **test copy** of the behavior pack plus `devtests/harness/devharness.js` and
runs scenarios on a fresh flat world. BDS has no real players, so the harness drives the
real code with a **stand-in player**: an armor stand that implements the Player members the
code calls and **records every player-only call** (camera, FOV, fog, music, input
permissions, titles, sounds, teleports). Condensed logs:
[test_logs/bds_scenarios_v3.1_1.26.61.txt](test_logs/bds_scenarios_v3.1_1.26.61.txt) (run 1:
every scenario; run 2: the stand-off twice, after fixing a harness bug that spoiled run 1's
shot test). The content log showed no errors or warnings from the packs.

| Scenario | Observed (3.1.0) |
|---|---|
| boot | `[Tailwail] v3.1.0 ready`; `playAnimation` of the scream, a rake and the flinch: ok; `tailwail:float_on` held it 4 blocks up, `float_off` dropped it to the floor; `camera … fov_clear / fov_set` parse |
| stand-off (observation) | kept at the edge of the view (a glance): it **approached, backed off to test, read "you held still"** (run 1); approached then stood idle (run 2); idle then backed off (run 2), then it decided / timed out and hunted. Turned its back: **engage after 17 ticks (0.85 s)**, three times. Stared at straight on: engaged after 4.0-6.2 s (by its own decision or the stand-off's limit; at stage 2 the stand-off is short, so the 5-9 s stare limit did not get the chance: the unit tests cover it) |
| shot at it | a stand-in arrow (a real player's projectile cannot exist on BDS) through the real aim test: **a wide miss was ignored; a shot aimed at it provoked it at once: one roar (no scream), hunting 24 ticks (1.2 s) later**, twice. A real arrow with no player owner, through the real spawn event: ignored, no errors |
| commit | scream: **all 3 torches** became burnt-out sticks, relight restored `minecraft:torch`; chase music, fog, FOV punch |
| hunt | the hunter: scream from far away, then the hunt at **7.8 blocks/s** (measured; the Cave Dweller's 0.5 × 0.85; a sprinting player does 5.6); pounce, rakes: 3 hits; **still hunting after the hits** |
| squeeze | you behind a solid wall with a 1-wide, 1-high, 12-block tunnel: it went `squeeze` posture / `loco_squeeze` act, **dragged itself through (≈ 7 s inside), came out at the far end** and attacked (slam 9, then a rake every second) |
| escape | through a 1-high gap, **sealed behind you**, then crouched in the dark: it searched, howled and left: **escaped, 0 damage**, every effect cleaned |
| ceiling | clung under the ceiling with gravity off (`cling` act), dropped as you came, savoured, hunted |
| climb | you on a 5-high pillar: it **climbed to the top** and attacked |
| door | you in a sealed room behind a wooden door: it **hammered the door until it broke** and came in |
| surface | light at the open surface: 15 at noon, **4 at midnight**. The real spawn search at night on open flat ground: a site **27 blocks behind the player** (light 4). `treeline`: stood tall, stand-off, decided, scream, hunt; pounce, rake, slam, savour |
| hide | crouched in light 0, never seen: it searched and **never found you** (0 damage) |
| tunnel | 1-wide, 2-high tunnel: belly-crawl all the way through, then rakes |
| presence | breath, whisper, snuff, door, glimpse (seen, looked away, gone), mimic (`dig.deepslate` replayed), footsteps (5 steps over 6 blocks), behind (turned: echo + stinger), lights out, running steps (9 heavy steps), distant scream, **runner (7.8 blocks in 1 s)**, door bang (3 bangs), window. Knock, peek and scrape declined in this arena layout (they need the right wall / corner; scrape and peek ran in earlier runs) |
| grab (parked) | the parked grab code still works when entered directly: a jump prompt with a grip shift was broken, input unlocked; an alternate prompt left alone ended in a finisher. Never reachable in game |
| death | lethal hit: death clip, removed after it, outcome killed |
| spawn site | dark roofed cave: light-0 site 29 blocks away in 61 ms; the "behind you" site 7 blocks behind the player in 40 ms |
| perf | three concurrent encounters at 10 decisions/s: **decision tick avg 2.29 ms, p95 4 ms, max 5 ms**, 18 raycasts per tick. BDS on a dev container CPU, **not** a client or mobile measurement |

## 5. Mojang Creator Tools 0.20.0 (`mct validate all --if dist/Tailwail_3.1.0.mcaddon`)

0 errors. Two warnings remain, both false positives: the recipe uses vanilla `minecraft:book`
and `minecraft:bone`, which are "not found in this pack". The remaining recommendations
are only "newer format_version available" notes. Log:
[test_logs/mct_validate_v3.csv](test_logs/mct_validate_v3.csv) (re-run on 3.1.0).

## 6. In-game (client) verification: **not done**

No game client was available, so nothing has been seen or heard in game. Checklist for
the first session (fresh Survival world, experiments off, both packs on,
`/tailwail:debug log on`):

1. On join the chat must say **"Resource pack 3.1.0 active"**. If it shows the raw
   `TAILWAIL_RESOURCE_PACK_3.1.0_IS_NOT_ACTIVE…` key, re-apply the resource pack first.
2. `/tailwail:debug anim`: every state and one-shot plays in turn on a harmless copy. Check
   that nothing stands still, feet on the floor, the gallop reads as a heavy charge, the
   squeeze lies flat, and the eyes are empty black sockets.
3. Spawn egg in a dark cave: it watches, twitches, reacts within a quarter second when seen.
4. Stand-off: keep it at the edge of your view and watch it idle, approach and test you
   (bluff charge, sidestep, backing off, neck crane). Then: stare at it; shoot an arrow at
   it; throw a snowball; turn your back. Each must set it off (a shot: a roar and an
   instant sprint).
5. Scream: silence, rise, scream (loudness, shake, darkness pulse, torches out).
6. Hunt: speed versus your sprint; every attack, one a second; it keeps coming after it
   hits you.
7. Squeeze: run through a 1-wide, 1-high tunnel; it must flatten and follow. Crawl into a
   low hole: an arm first, then the rest of it.
8. Ceiling ambush (cave with a 5-10 high ceiling), corner heap, climbing a pillar, a door,
   a window (doors and glass setting).
9. Escape: break line of sight, seal the gap behind you, crouch in the dark; it searches,
   howls, maybe returns.
10. Presence: `/tailwail:debug presence <event>` for each one.
11. Cleanup: die mid-hunt, disconnect mid-hunt then rejoin: controls, FOV, fog and music
    must be normal; `/tailwail:debug restore`.
12. Listen to every sound: `/playsound tailwail.<event> @s`.
13. A 60-minute survival session: escalation, presence spacing, encounter spacing, surface
    nights.
14. Check the content log for errors from the packs. Record the device, OS, game version and
    frame rate.

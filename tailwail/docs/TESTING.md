# Testing: how to run it and what has been verified

Evidence is separated by kind. Nothing here claims an in-client test, a device frame rate
or player feedback that did not happen.

## 1. Static validation: `python3 -I tools/validate.py --tsc-types <dir> --vanilla-sounds <file>`

Result on the shipped build: **14 check groups, 0 errors**.

- All pack JSON files parse (strictly: no NaN, no duplicate keys).
- Manifests: format 2, v3.0.0, unique UUIDs, BP⇄RP dependency, engine `[1,26,60]`,
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
  - the model and texture copies match the supplied archive;
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
- **506/506** act-to-act transitions happen in one frame. A 600-step random schedule across
  all properties and speeds never desynchronises; every blend weight stays within [0, 1].
- Gait selection: idle at 0 m/s, walk at 2.6, gallop at 8.4, weights summing to 1.
- **Failure modes:** with the pre-animation script not running at all, the default state
  still idles, walks and gallops by speed, and breathing, tremor, look, jaw and tail stay
  on.
- Tail weights follow the tail property; the tunnel crawl hands the tail to the
  floor-solved clip. The hurt flinch returns, and never plays during death.
- Gaits are distance-driven: the phase wraps exactly once per stride (gallop 3.0, walk 2.94,
  creep 1.85, tunnel 1.0 blocks).
- **Grounding:** every state at three speeds and every one-shot over the neutral state, with
  every overlay on, at 1.5×: nothing sinks through the floor or floats; the tunnel crawl and
  the reach-in stay under 2 blocks (1.97 max).
- **Tail sweep:** every tail mode × locomotion state × speed stays out of the floor, and
  under 2.0 blocks in the tunnel.

## 3. Unit tests: `node --test tests/*.test.mjs`

Result: **44/44 pass** (Node 22).

- **Brain (23 tests)**: the hunter opening (one scream, then the hunt); "quick to action"
  (20 seeds of a stalker opening reach the hunt within the caps); the stand-off creeps while
  watched and charges within 0.8 s of you turning away; too close and hits commit; close
  range picks rakes, combos, slams and grabs, damage only at hit frames in reach; a miss out
  of reach; the pounce impulse; no slam and no throw/smash finisher under low ceilings; the
  struggle varies (all four kinds, counts, windows, grip shifts, inescapable, first grab
  always escapable); **after a failed struggle it hurts you, savours and hunts on (10
  seeds)**; tearing free stuns it, then it roars and hunts; staying still gets you dropped;
  relentless for 60 s while in sight; losing it by distance or hiding; search, noise,
  give-up and return; fleeing when wounded; the ceiling and corner ambushes; climbing,
  door smashing (and not when disabled), reaching into holes; the low-ceiling roar; death
  releases a grab; target loss; a 25-seed fuzz over every setup (state ceilings, act ids,
  grab bookkeeping).
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
[test_logs/bds_scenarios_v3_1.26.61.txt](test_logs/bds_scenarios_v3_1.26.61.txt) (four
runs; the two "ERROR boot" lines in run 1 are a harness bug, fixed for run 2). The content
log showed no errors or warnings from the packs.

| Scenario | Observed |
|---|---|
| boot | `[Tailwail] v3.0.0 ready`; `playAnimation` of the scream, a rake and the flinch: ok; `tailwail:float_on` held it 4 blocks up, `float_off` dropped it to the floor; `camera … fov_clear / fov_set` parse |
| standoff | watched: crept **0.7 blocks in 3 s while being looked at**; stand-off music and dread fog on. Turned its back: **engage after 16 ticks (0.8 s)**, scream, hunt. Cleanup: input unlocked, fog and music off, FOV cleared |
| commit | scream: **all 3 torches** became burnt-out sticks, relight restored `minecraft:torch`; chase music, fog, FOV punch; straight into a pounce |
| hunt | the hunter: scream from far away, then the hunt at **8.4 blocks/s** (measured; a sprinting player does 5.6); pounce, rakes, combo: 3 hits; **still hunting after the hits** |
| grab | grab 1 asked "mash JUMP ×10 in 2.2 s": pressing it tore free (2 damage, knockback, input unlocked, stunned, roar, hunt). Grab 2 asked "alternate ×6, grip shift to JUMP at 1.2 s": doing nothing → **bite (11), then it attacked again** (rake 6): still hunting |
| ceiling | clung to the ceiling **4.4 blocks up with gravity off** (`cling` act); stared at, it dropped, roared, hunted (pounce, slam) |
| climb | you on a 5-high pillar: it came up to the pillar, **climbed to the top in ~1.5 s** (`climb` act), stepped on and attacked |
| door | you in a sealed room behind a wooden door: it **hammered the door until it broke** (`setblock … destroy`), came in and attacked |
| surface | light at the open surface: 15 at noon, **4 at midnight**. The real spawn search, at night on open flat ground: a site **27 blocks behind the player** (light 4). `treeline`: stood tall 35 blocks away, held your stare → stand-off → scream → hunt in ~12.5 s; pounce, rakes, combo, slam, savour, grab |
| hide | crouched in light 0, never seen: it searched for the whole window and **never found you** (0 damage) |
| escape | through a 1-high gap it cannot fit, then crouched in the dark: **escaped, 0 damage**, every effect cleaned |
| tunnel | 1-wide, 2-high tunnel: belly-crawl all the way through; rakes only (no room for slams or grabs) |
| presence | breath, whisper, fake chat, snuff, door, glimpse (seen, looked away, gone), peek, mimic (`dig.deepslate` replayed), footsteps (5 steps over 6 blocks), behind (turned: echo + stinger), lights out, scrape, **running steps** (9 heavy steps, then breath), **distant scream**, **runner** (moved 9 blocks in 1 s), **door bang** (3 bangs), **window** (face spawned outside the glass). Knock declined (no wall behind in the arena) |
| death | lethal hit: death clip, removed after it, outcome killed, effects clean |
| spawn site | dark roofed cave: light-0 site 29 blocks away in 65 ms (spread over ticks); the "behind you" site 7 blocks behind the player in 36 ms |
| perf | three concurrent encounters (stalk, stand-off, hunt) at 10 decisions/s: **decision tick avg 2.95 ms, p95 4 ms, max 8 ms**, 18 raycasts per tick. BDS on a dev container CPU, **not** a client or mobile measurement |

## 5. Mojang Creator Tools 0.20.0 (`mct validate all`)

0 errors. Two warnings remain, both false positives: the recipe uses vanilla `minecraft:book`
and `minecraft:bone`, which are "not found in this pack". The remaining recommendations
are only "newer format_version available" notes. Log:
[test_logs/mct_validate_v3.csv](test_logs/mct_validate_v3.csv).

## 6. In-game (client) verification: **not done**

No game client was available, so nothing has been seen or heard in game. Checklist for
the first session (fresh Survival world, experiments off, both packs on,
`/tailwail:debug log on`):

1. On join the chat must say **"Resource pack 3.0.0 active"**. If it shows the raw
   `TAILWAIL_RESOURCE_PACK_3.0.0_IS_NOT_ACTIVE…` key, re-apply the resource pack first.
2. `/tailwail:debug anim`: every state and one-shot plays in turn on a harmless copy. Check
   that nothing stands still, feet on the floor, the gallop reads as a charge.
3. Spawn egg in a dark cave: it watches, twitches, reacts within a quarter second when seen.
4. Stand-off: it creeps while watched; turn your back and it charges.
5. Scream: silence, rise, scream (loudness, shake, darkness pulse, torches out).
6. Hunt: speed versus your sprint; every attack; it keeps coming after it hits you.
7. Grab: try every prompt (jump, sneak, alternate, don't move); the grip shift; release
   restores controls; no fall damage from the hold.
8. Ceiling ambush (cave with a 5-10 high ceiling), corner heap, climbing a pillar, a door,
   a window (doors and glass setting), a 1-high hole.
9. Escape: break line of sight, crouch in the dark; it searches, howls, maybe returns.
10. Presence: `/tailwail:debug presence <event>` for each one.
11. Cleanup: die mid-hunt, disconnect mid-grab then rejoin: controls, FOV, fog and music
    must be normal; `/tailwail:debug restore`.
12. Listen to every sound: `/playsound tailwail.<event> @s`.
13. A 60-minute survival session: escalation, presence spacing, encounter spacing, surface
    nights.
14. Check the content log for errors from the packs. Record the device, OS, game version and
    frame rate.

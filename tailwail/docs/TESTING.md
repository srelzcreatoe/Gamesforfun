# Testing: how to run it and what has been verified

Evidence is separated by kind. Nothing here claims an in-client test, a device frame rate
or player feedback that did not happen.

## 1. Static validation: `python3 -I tools/validate.py --tsc-types <dir> --vanilla-sounds <file>`

Result on the shipped build: **14 check groups, 0 errors**.

- All 30 pack JSON files parse.
- Manifests: format 2, v2.0.0, unique UUIDs, BP⇄RP dependency, engine `[1,26,60]`,
  modules pinned to stable `@minecraft/server 2.11.0` / `@minecraft/server-ui 2.3.0`, no
  capabilities, no beta or preview modules.
- Every import resolves; `node --check` passes on all 31 scripts; **all scripts
  type-check with `tsc` against the stable typings**.
- Entities: every event's component groups exist; ≤ 32 properties; every
  `triggerEvent`, property and `tailwail:*` identifier used by scripts exists.
- **Client simulation** (`tools/client_sim.py`, below) passes.
- 15 clip durations in `config.js` match the animation files.
- Sounds:
  - all 32 events have their files and subtitles, and every custom sound id a script plays
    is defined;
  - music is `category: music` and streamed;
  - **all 30 vanilla sound ids** the scripts use exist in the 1.26.60 vanilla pack.
- Block, fog and particle:
  - geometry, terrain texture and loot tables resolve;
  - the custom component is registered by script;
  - the block states match `torches.js`;
  - every fog and particle id used by script exists.
- Echo: all 10 poses map to clips.
- No experiments, beta modules or holiday features are referenced.
- **Reproducibility:**
  - every generator (clips, client, assets) is re-run on a scratch copy and the output is
    byte-compared with the committed files;
  - the legacy derived clips re-derive;
  - the supplied archive's sha256 is unchanged.

## 2. Client simulation: `python3 -I tools/client_sim.py`

A strict Molang parser and evaluator (`tools/molang.py`) plus a frame simulator that
emulates controller semantics: one transition per controller per frame, first true wins,
animations restart on entry, `blend_transition`. Result: **0 errors, 0 warnings**.

- Wiring:
  - all 65 animation refs and 6 controllers resolve;
  - every Molang string parses;
  - every query used is documented;
  - every `q.property` exists and is `client_sync`;
  - every variable read is written;
  - every animated bone exists;
  - every script-held clip loops or holds its last frame.
- **756/756** pose-to-pose transitions happen in one frame. A 600-step random schedule
  across all properties never desynchronises, and every blend weight stays within [0, 1].
- Posture weights sum to 1. The hurt flinch returns, and never plays during death.
- The gallop stride measured from `v.walk` is 2.89 blocks, matching the supplied clip.
- **Grounding:** body plus every overlay at 1.5×, for 36 states × 8 samples. The lowest
  point is within the floor tolerance everywhere.
  - *Found and fixed:* the tunnel crawl sank the tail ~1 block and the shins ~0.2 blocks
    into the floor. Solved clips now lay the tail along the floor.
- **Tail sweep:** every tail state × posture × speed stays out of the floor, and under 2.0
  blocks in the crawl.

## 3. Unit tests: `node --test tests/*.test.mjs`

Result: **40/40 pass** (Node 22).

- **State machine (21 tests)**, including a 25-seed fuzz:
  - the commit sequence and its timings, with exactly one scream;
  - the statue rule: no movement while on screen, creeps when unwatched, new pose;
  - too-close commit; calm and hidden withdrawal; stare commit in 15–60 s;
  - provocation keeps the full warning;
  - grab: struggle free, then throw, then bite; refused grab; victim lost mid-hold;
  - strike fallback, never through walls;
  - escape → search → howl → retreat; hiding only fails within 2.8 blocks;
  - noise redirects the search;
  - stalking freeze and creep, losing track of a hidden player;
  - the hunter opening; the mirror copies 1–2 s late on the locomotion pose;
  - death releases a grab; target loss and outcome labels;
  - fuzz: state ceilings, valid visual ids, and every grab released exactly once.
- **Rules (9 tests):** agitation, gestures, imitation, strike and grab reach, struggle,
  audio limits.
- **Scheduler, presence, journal, memory (10 tests):**
  - eligible-time waits, death protection, cooldowns;
  - the escalation ladder;
  - presence stage gating, cooldowns, needs, settings, no repeats, pacing by level;
  - mimicry sound mapping; journal unlock;
  - memory bounds and decay; setup variety, terrain and stage gating.

## 4. Runtime on Bedrock Dedicated Server 1.26.61.1 (no experiments)

```bash
python3 tools/bds_scenarios.py --server <scratch BDS dir>
```

This builds a **test copy** of the behavior pack plus `devtests/harness/devharness.js` and
runs scenarios on a fresh flat world. BDS has no real players, so the harness drives the
real code with a **stand-in player**: an armor stand that implements the Player members the
code calls and **records every player-only call** (camera, FOV, fog, music, input
permissions, titles, sounds, teleports). The content log showed no errors or warnings from
the packs. Raw logs are in [test_logs/](test_logs/).

| Scenario | Observed |
|---|---|
| boot | `[Tailwail] v2.0.0 ready`; the snuffed-torch block resolves; `camera @a fov_clear …` and `fov_set` parse (no syntax error) |
| statue | watched for 3 s: **moved 0 blocks**, pose `statue_reach`, stand-off music and dread fog pushed. Three look-aways: advanced **2.6 / 2.9 / 3.3 blocks**, each time a new pose (`statue_bow`, `statue_sideways`, `statue_bow`), skitter and creak cues. End: input unlocked, fog cleared, music stopped, FOV cleared |
| commit | stare at agitation 99.8: unfold 2.0 s (tail rigid, jaw 0, music cut), **scream** (jaw 60), windup, then chase. **All 3 torches** near it became burnt-out sticks; **relight** restored `minecraft:torch` |
| grab | chase into reach, then grab. Input locked (lateral, camera, sneak), slow falling, the "IT HAS YOU" title, the stand-in teleported into its hands every tick (2.35 forward, 1.95 up). **8 Jump presses: struggled free**: input unlocked, knockback, 1 heart, frustrated stagger, chase resumed. Second catch without struggling: **bite**, 12 damage, input unlocked |
| hide | crouched in light 0 at 17–25 blocks: **never found**. Search for 14 s, then the enraged howl, then retreat (flag `hid`) |
| escape | sprinting through a 1-block-high hole it cannot fit: chase, then search, then howl, then retreat (escaped), no damage, every effect cleaned |
| tunnel | 1-wide, 2-high tunnel: crawl posture all the way through; no room to lift, so strikes (3 hits); outcome caught |
| presence | ran: breath, whisper, fake chat, snuff, door, **glimpse** (echo spawned; seen, looked away, gone), **mimic** (`dig.deepslate` replayed 2.5 s after the break), **footsteps** (5 steps heard after walking 6 blocks: 4 plus the extra one), **behind** (turned, echo plus stinger), **lights out** (every torch around went out). Correctly declined: knock (no wall behind) and peek (no corner) in the open test arena |
| death | lethal hit: `death_low` (hunched), removed after the clip, outcome killed, effects clean |
| spawn site | dark roofed cave: light-0 site 29 blocks away in 60 ms (spread over ticks) |
| perf | three concurrent encounters (stalk, stand-off, chase): **decision tick avg 2.30 ms, p95 5 ms, max 9 ms**, 12.3 raycasts per tick. BDS on a dev container CPU, **not** a client or mobile measurement |

## 5. Mojang Creator Tools 0.20.0 (`mct validate all`)

0 errors. Two warnings remain, both false positives: the recipe uses vanilla `minecraft:book`
and `minecraft:bone`, which are "not found in this pack". The remaining recommendations
are only "newer format_version available" notes.

## 6. In-game (client) verification: **not done**

No game client was available, so nothing has been seen or heard in game. Checklist for
the first session (fresh Survival world, experiments off, both packs on,
`/tailwail:debug log on`):

1. Spawn egg in a dark cave. Check:
   - model at 1.5× scale, feet on the floor;
   - breathing and tremor visible even while frozen, head tracking;
   - statue poses, tail states, crawl through a 2-high tunnel.
2. Stand-off:
   - look away and back: it is closer, in a new pose, with skitter and creak;
   - stare: tail curls, clicks speed up, jaw opens, FOV narrows, heartbeat rises;
   - crouch: it copies you late.
3. Commit:
   - silence, rise, scream (check loudness and screen shake), darkness pulse, torches out;
   - chase music, fog.
4. Grab:
   - view locked on its face, Jump mashing works, title bar;
   - release restores controls; no fall damage from the hold.
5. Escape: hide crouched in the dark; make noise; watch the howl and the owl-turn retreat.
6. Presence:
   - `/tailwail:debug presence <event>` for each one;
   - the glimpse vanishes once seen and looked away from;
   - relight a snuffed torch with flint and steel.
7. Cleanup:
   - die mid-chase, and disconnect mid-grab then rejoin: controls, FOV, fog and music
     must be normal;
   - `/tailwail:debug restore`.
8. Listen to every sound: `/playsound tailwail.<event> @s`.
9. Do a 60-minute survival session. Note escalation, presence spacing and encounter spacing.
10. Check the content log for errors from the packs. Record the device, OS, game version and
    frame rate.

# Test Report

Everything below was run in this project's build environment. Results are copied from the logs of those runs; nothing
here is projected or assumed. Where something could not be tested, it says so (§8).

## 1. Environment and method

| Item | Value |
|---|---|
| Server | Bedrock Dedicated Server **1.26.52.3** for Linux (official build), a fresh test world per run (seed 424242, normal world generation) |
| Script APIs | `@minecraft/server` 2.10.0, `@minecraft/server-ui` 2.2.0 (stable, no experiments) |
| Test players | GameTest simulated players (`@minecraft/server-gametest` 1.0.0-beta), used **only** by the separate test pack `tests/bds/testkit_BP` |
| Harness | `tests/bds/run_bds.py`: installs both packs into the world, drives a scenario over the server console, collects `[OTEST]` lines and every content-log/script error |
| Event channel | the add-on reports what it does (`start`, `end`, `ledger`, `body`, `discovery`, `strike` …) through `/scriptevent observer_evt:*`, only while dev tracing is on; tests assert on those events and on the world itself (blocks, entities, items, health) |

The harness patches **only the installed test copy** of the behaviour pack (one manifest dependency and one import of
the GameTest module) because simulated players are otherwise not visible to the add-on's `world.getAllPlayers()`. The
packs in `packs/` and `dist/` are not modified and do not depend on GameTest.

Test arena (`tests/bds/testkit_BP/scripts/arenas.js`): a 220 × 80 platform at y = 140 with an open field, trees, a
furnished house (door, torches, pumpkin, stonecutter), a 64 × 72 pool, a 20-block pillar, a 57-block 2 × 3 tunnel
inside solid stone at y = 125, a Nether platform, and (1.0.9) a dark cave room nine blocks high and a yard with three
sealed cages (a 1-block gap, glass walls, a closed door) and a six-block stone ridge.

### 1.1 First load in a game client (reported by the user)

The user imported the first build into a Windows client. The content log showed three errors, all in the resource pack
and therefore invisible to a dedicated server (which never loads resource packs) and accepted by the official schema
package:

| Error | Cause | Fix |
|---|---|---|
| `controller.animation.observer.state | states | hidden | animations | Required child not found` | the `hidden` state had `"animations": []` | the key is omitted when a state plays nothing (`tools/make_client_entity.py`) |
| `sound_effects | windup` and `| recoil`: `Allowed types: 'string'` | client-entity `sound_effects` were `{"effect": "…"}` objects | plain `"short name": "sound event"` strings, as in vanilla |

Both now also fail `tools/validate.mjs`. A new check, `tools/check_vanilla_shapes.py`, compares the JSON value type at
every position in our 15 entity / controller / render-controller / animation / particle / fog files with Mojang's
vanilla resource pack (`Mojang/bedrock-samples`, 839 files): run on the old files it flags both reported problems
(and nothing else of consequence), flagged one optional particle field (`plane_normal`, removed), and reports **0 mismatches** on this build.

## 2. Static verification

| Check | Tool | Result |
|---|---|---|
| Type check of all 37 script files against the official 2.10.0 / 2.2.0 typings | `tsc --checkJs` (`npm run typecheck`) | **0 errors** |
| JSON schema validation | `tools/validate.mjs` with the official `@minecraft/bedrock-schemas` 1.26.50 | **34 files valid**; 15 files hit known defects of the schema package itself and are listed in the validator with the reason (recipe catalog points at the brewing schema; loot typed as object; fog id; numeric geometry vectors; `part_visibility` arrays; `languages.json`) |
| Cross-references | `tools/validate.mjs` | OK: geometry ↔ bones in every animation, controller states ↔ animation short names, render controller ↔ textures/geometry, 26 sound events ↔ 39 `.ogg` files, particles, fogs, lang keys for every item/block/entity/UI string, recipes ↔ items, script IDs ↔ definitions, entity properties/events used by scripts |
| Resource-pack structure vs. vanilla | `tools/check_vanilla_shapes.py` against Mojang's `bedrock-samples` (839 vanilla files) | **17 files, 0 mismatches** (entity, controllers, render controllers incl. the eye layer, animations, all 9 particles, fogs) |
| New creature sounds | `ffmpeg` decode + level and spectrogram check | voice, presence, notice, shriek, vanish: no silence, no clipping (shriek peak lowered to 0.7 after the first render clipped at 1.0), reverb tails trimmed; spectrograms show the intended structure (creak pulses, swell-then-cut, accelerating clicks, rising harmonics, rip-then-thump) |
| Vanilla block IDs the add-on may touch | `tools/validate.mjs` against `@minecraft/vanilla-data` | **141 / 141** exist (found and fixed: `minecraft:terracotta` → `hardened_clay`; removed `end_gateway`) |
| Supplied assets preserved | `tools/integrate_supplied_assets.py`, `source_assets/supplied/SHA256SUMS.txt` | texture byte-identical; geometry bones/cubes/UVs identical; only the identifier was namespaced |
| Animation poses | `tools/render_model.py` (forward kinematics, matched against the supplied preview renders) | `docs/media/animation_states.png`, `docs/media/stalk_walk.gif`; stoop height 2.81 blocks |
| Packaging | `tools/build.py` | reproducible ZIPs (fixed timestamps/order), `dist/SHA256SUMS.txt` |

## 3. Runtime capability probes and calibration

Before building systems on an API, each assumption was probed on the server (`tests/bds/testkit_BP/scripts/proto.js`,
scenario `proto.txt`): **29 probes, 28 passed, 1 failed.**

Passed: chunk loading, simulated player spawn and visibility, Observer spawn, entity property write/read (readable the
*next* tick, not the same tick), still mode floats without gravity, teleport facing and `setRotation`, approach-mode
movement (≈ 1.49 b/s), pursue-mode speed (≈ 4.76 b/s), door placement/toggle permutations, raycast occlusion, large
world dynamic property, player dynamic property, personal sound, `/fog` push/remove, `/camerashake`, camera fade API,
particles, torch place/remove, effects, `applyDamage` from the Observer (20 → 16), biome query, absolute time, light
levels, cancelling a block break without drops, hit event with immunity (health stays 400), `getBlockAbove` semantics
(it **includes** the starting block — this changed the headroom code), despawn event.

**Failed: `retreat_mode_moves_away`** — the vanilla `avoid_mob_type` goal did not move the Observer away from a player
within 4 s. Walking away is therefore script-driven (`body.withdraw`, validated steps) and verified separately by
`withdraw_walks_away` (§5).

Movement calibration (`speed.js`, scenario `speed.txt`): steady speed ≈ **3.88 × multiplier²** blocks/s for this entity.

| `melee_box_attack` speed multiplier | 0.60 | 0.70 | 0.80 | 0.90 | 1.00 |
|---|---|---|---|---|---|
| measured b/s | 1.40 | 1.90 | 2.49 | 3.15 | 3.88 |

Shipped values: approach 0.62 (≈ 1.5 b/s, a creep), pursue 1.11 (≈ 4.6–4.8 b/s: faster than walking at 4.3, slower
than sprinting at 5.6). The engine's own melee hit is disabled (`damage 0`, reach 0); contact with a player at full
speed caused no native damage (`hurtEvents=0`), so all damage comes from the telegraphed scripted strike.

## 4. Performance

Scenario `tps.txt`: one simulated player walking for 180 s (36 five-second samples) with the director running on its
own. Measured twice: before and after the final fixes.

| Run | mean TPS | min TPS | median | natural encounters during the run |
|---|---|---|---|---|
| With The Observer (first build) | 20.00 | 19.99 | 20.00 | distant_watch, borrowed_sound |
| Baseline (`--no-addon`, test kit only) | 20.00 | 19.99 | 20.00 | — |
| With The Observer (final build) | 20.00 | 19.99 | 20.00 | distant_watch, snuffed_lights |
| Baseline (`--no-addon`), same session | 20.00 | 19.98 | 20.00 | — |

Every integration run also records the minimum TPS seen between tests; see §5. Client frame time was not measurable here.

## 5. Integration suite

`tests/bds/testkit_BP/scripts/suite.js` — 85 test groups (including setup and a status check) with 375 assertions, run in one session
(`scenarios/suite_full.txt`). Each group resets the target player's state, triggers or waits for an encounter, plays the
part of the player (looking, turning, sneaking, walking, breaking blocks, placing torches, using items) and asserts on
outcomes, discoveries, block states, entities, items, health and timing.

### 5.1 History

| Run | Pass | Fail | What the failures were |
|---|---|---|---|
| 1 | 93 | 28 | add-on bugs (door detection, relighting, pursuit result order, chalk not firing, tunnels never sealing because headroom probing was wrong) and test-design errors |
| 2 | 121 | 9 | borrowed-sound walk, home-visit torch count, closed-path strike reach, chalk, vigil |
| 3 | 136 | 3 | water placement, vigil home threshold |
| 4 | 140 | 6 | water surface (raycasts pass through water), carve candidates, escape timing, a strike miss at point-blank range |
| targeted re-runs after the fixes in §7 | 44 + 34 | 3 + 0 | the 3 were test-side (blocks broken faster than a hand can, health compared after regeneration) and were corrected |
| 5 (first release build) | 165 | 0 | all passed, including the new tests for walking away, occupied seals and multiplayer fairness. Its log then showed the carve opening facing away from the path; fixed and re-tested (13/13) |
| 6 (with the Config Wheel; stopped early) | — | 6 so far | door, home-visit and night-visit tests: the player's own door changes were no longer noticed. Cause: a loop timing bug (§7) that the new code's different load time exposed. The run was stopped and the bug fixed |
| 7 (1.0.1) | 173 | 0 | all passed: the earlier suite plus the Config Wheel tests (wheel on first join, See it now, encounter toggles) and the carve-direction check |
| targeted (1.0.2 creature update) | 41 | 0 | new tests for glowing eyes, vanish, auto-peek, lunge, *Closer Each Time* (held and reaching), the extended preview |
| 8 (1.0.2, first full run) | 190 | 3 | `animals_face_it` 2/4 (always borderline at 3/4: the cows' own AI turned them between updates — animals now stop and are re-aimed every 2 ticks: 4/4 three times in a row); both *Closer Each Time* tests: a second simulated player left over from an earlier test kept watching it, and any player's gaze freezes it (by design) — the tests now move other players out of range. Re-run of those tests after a witness test: 17 / 17 |
| 9 (1.0.2) | 193 | 0 | all passed, including the creature update (eyes, vanish, peeking, lunge, Closer Each Time) with the animal and test-isolation fixes |
| targeted (1.0.4: relentless attack, too close, taiga shadows, peek only from cover) | 55 + 42 + 18 | 4 + 4 + 0 | first passes: the encounter's long internal wait delayed the end of a too-close reaction (waits are now interruptible every 5 ticks); the test world's arena is itself a taiga, so "none outside taiga" was re-tested in a distant frozen-ocean area (this server has no `/fillbiome`); shadows were placed on the real terrain 63 blocks below the sky arena (they now prefer the player's height); a peek check ran where test trees stood ahead; a too-close test stopped short of the varying trigger distance |
| 10 (1.0.4, first full run) | 212 | 6 | *Borrowed Work* cut short by the too-close reaction, an *Echo Ahead* spot far below the platform, the *Closed Path* escape rule (see §7), and a peek test seen by a leftover second player — all fixed; re-runs 69 / 71 then 12 / 12 |
| final (1.0.4) | 218 | 0 | all passed, including the relentless attack, too-close reaction, taiga shadows and cover-only peeking |
| targeted (1.0.5: flare, learning, silence, pages, signs, inside, borrowed eyes, returns + regressions) | 57 + 65 | 4 + 1 | flare mid-attack did not end the attack, then its outcome was overwritten; the sign floor check used an API that does not exist; *It's Inside* had no room in a small house; one test lit its flare out of range (all in §7) |
| 11 (1.0.5, first full run) | 252 | 7 | the old *While You Slept* effigy draw (§7); the new tests run after all the old ones: a second player left parked in view of the test house (the add-on rightly refused to put up a sign or return an item where someone could watch), a torch left burning in the house by an earlier test (so the room was not dark — again correct), a flare still burning when the next test's creature arrived (it was driven off at once — correct), and a flinch that put it out of the next test flare's reach. The tests now clear the house and park other players far away |
| house sequence (1.0.5, the 15 house tests in suite order) | 60 + 59 | 2 + 4 | the leftover torch, then the escape-count fading bug (§7) |
| final (1.0.5) | 269 | 0 | all passed: the 1.0.4 suite plus the Flare, escape learning, the silence, its pages, signs, *It's Inside*, *Borrowed Eyes* and returned items |
| targeted (1.0.6: floating chase, climbing + chase/attack regressions) | 47 | 0 | all passed on the first run |
| 12 (1.0.6, first full run) | 277 | 3 | *The Closed Path* skipped once (deferred): its spot ahead is drawn from a wide random cone, and in the test's 2-wide tunnel most of that cone is rock — about 1 run in 30 found nothing (an old intermittent; in a real 1-wide tunnel it would skip far more often). It now searches along the corridor first; the Closed Path tests then ran 10 times in a row: 84 / 84 |
| 13 (1.0.6) | 277 | 1 | a taiga shadow was placed almost in the centre of the player's view and vanished the instant it appeared (an old intermittent: two of its eight search directions were only 25° off the view). Shadows now always appear 40°+ to the side and never within 35° of where the player looks; the shadow tests then ran 8 times in a row: 53 / 53 |
| 14 (1.0.6) | 277 | 2 | test ordering only: a flare from the previous test was still burning (they last 8 s) when the learning test began, and it used up the creature's one learned flinch, so the test's own flare drove it off (correct behaviour). The flare tests now wait for every flare to burn out; the three flare tests twice back to back: 47 / 47 |
| **final (1.0.6)** | **283** | **0** | all passed: the 1.0.5 suite plus the floating chase (surge, drift, the shoreline hover) and climbing (pillar, from the wall during the attack, over the top of a roof) |
| targeted (1.0.7: the Weeping Mire) | 19 + 22 + 20 + 21 | 5 + 4 + 1 + 1 | runs 1–2: looking at its watcher never counted — under the weeping trees its head reached into the canopy, where it could see out but nobody could see it (placement now checks the line of sight both ways, for every encounter); run 1 also: the last torn page found it still busy and gave up (it now waits up to a minute); run 3: a test retry after an aborted appearance hit its cooldown (test-side); run 4: a torn page found no visible spot 16–24 blocks behind the player in thick trees (it now tries from 8 blocks before falling back), and the test then read the removed entity (test-side) |
| targeted (1.0.7) | 26 | 0 | all passed |
| targeted (1.0.8: every attack floats; the Mire near spawn, never where you start) | 94 + 99 + 93 + 98 | 4 + 1 + 2 + 1 | run 1: the first biome tuning also took the taigas, and the test arena (a taiga) became Mire, which the new setup check caught (the field then counted as its home, so two Mire checks that compare "there" with "elsewhere" failed too) — the taigas were left out; the test could not write back a fresh world's unset spawn (test-side). Runs 2–4: the taiga-shadow test ran before any other shadow test, so the "first minute in the woods is quiet" clock had not started when it skipped time (test-side: it now waits for it); and the first-spawn guard's "no spawn point of their own" condition was wrong — every player has one — so it was dropped. Every float assertion (approach, lunge, strike and recoil in mid-air) passed in every run |
| **final (1.0.7)** | **306** | **0** | all passed on the first full run: the 1.0.6 suite (re-run because placement now checks the line of sight both ways) plus the Weeping Mire as its home (context, stage bonus, early grace, its watcher, too close at 9 blocks, the torn pages) |
| targeted (1.1.0: the music, the heartbeat, charging at it, the profile, hiding behind trees, Mire fuel + regressions) | 86 + 40 + 79 | 3 + 2 + 0 | run 1: the first auto-peek check failed once (a cover-side ambiguity in the test: the spot it chose already had cover on the other side), the tree peek never switched sides (the test encounter ended after 10 s, before it could) and the learned-charge check got no reading (the body stood beyond the 32-block charge range); run 2: two test-side problems (the learned habit set before the test's own player reset was wiped; a "stands without cover" check where a real tree remained) |
| full (1.1.0, first) | 370 | 5 | a real bug: hanging from a ceiling under 14 blocks away counted as "walked up to" at once, so it went straight into the standoff and was gone (now it has to be approached: closer than it first stood, less 4); and three test sensitivities in the busier full-suite state (a Witness Lens left in hand lowered the charge score to its floor — the "armed" rule working; a weight compared against an encounter not eligible while standing still; the open-ground placement at stage 3 sometimes the favoured bearing instead) — all re-run: 79 / 79 |
| full (1.1.0, second) | 374 | 1 | test-side: the "Peeking from cover" wheel test waited 15 s for its end, but behind a tree the peekaboo now runs up to 20 s; it waits 23 s now (re-run on its own: 18 / 18) |
| **final (1.1.0)** | **375** | **0** | all passed: the 1.0.9 suite plus the music cut while it is around and back after it has gone, the heartbeat and its tremor (none with camera effects off), charging at it (it attacks; it vanishes and sets an ambush that springs when the moment favours it; the decision weighs the light, health, company, what is held and what it has learned), the profile (habits learned with each repetition, where and when you play, light placed, encounters that get a reaction), hiding behind a real tree (body behind the trunk, looks round, ducks when seen, switches sides) and Mire wood burning in a furnace |
| targeted (1.0.9: vanish in place, stalking from ledges and ceilings, the standoff, through gaps, glass and doors) | 81 + 84 | 2 + 0 | run 1: the ledge test found no ledge (the flat test field has none worth the name: a stone ridge was added) and the new cages broke the "peek needs cover" test (they stood on its open stretch; the cages and ridge moved to a yard of their own); also seen in passing: it struck from the gap or doorway still lying flat (it now stands up inside first) and the rage was too fast (11 b/s → ~8) |
| **final (1.0.9)** | **348** | **0** | all passed on the first full run: the 1.0.8 suite plus vanishing in place, the standoff (creeping, a stare or an arrow provoking the rage, gone when left alone), hanging from a cave ceiling, a high ledge, and the three cages |
| **final (1.0.8)** | **319** | **0** | all passed on the first full run: every attack floats (approach, lunge, too-close strike, the strike and recoil in mid-air), the arena checked to be outside the Mire, and the first-spawn guard; then, after the guard was limited to players new to the world, `setup illusion_taiga mire_spawn status` again: 13 / 13 |

Run 7 (1.0.1): 1080 s, minimum TPS 19.8, 0 errors; after the version bump to 1.0.1, `setup wheel_welcome showcase
toggles distant_watch status` was re-run: 19 / 19.

**1.0.3 (test-only behaviours in the Config Wheel):** `setup test_entries status` 10 / 10; then, because the real
vigil now shares its code with the practice vigil, `setup wheel_welcome vigil showcase toggles test_entries
distant_watch status` 30 / 30 (two assertions first failed only because the real vigil ran just before them — its
restorations were counted as "changes" and the player already held the Eye; the assertions now count new changes and
compare the Eye count before and after). The full suite was not repeated for 1.0.3.

Run 9 (1.0.2): 1105 s, minimum TPS 19.9, 0 errors.

Final run (1.0.4): 1060 s, minimum TPS between tests 19.2, 0 content-log or script errors.

Final run (1.0.5): 65 test groups, 1449 s, minimum TPS between tests 20.0, 0 content-log or script errors.

Final run (1.0.6): 69 test groups, 1274 s, minimum TPS between tests 19.9, **0 content-log or script errors**.

Final run (1.0.7): 72 test groups, 1547 s, minimum TPS between tests 19.8, **0 content-log or script errors**.

Final run (1.0.8): 73 test groups, 1572 s, minimum TPS between tests 19.6, **0 content-log or script errors**.

Final run (1.0.9): 79 test groups, 1526 s, minimum TPS between tests 19.5, **0 content-log or script errors**.

Final run (1.1.0): 85 test groups, 1496 s, minimum TPS between tests 19.8, **0 content-log or script errors**.

`noexp.txt` and `mire_locate.txt` re-run on 1.1.0: `level.dat` experiments none, 0 errors.
`noexp.txt` and `mire_locate.txt` re-run on 1.0.9: `level.dat` experiments none, 0 errors.
`noexp.txt` and `mire_locate.txt` re-run on 1.0.8: `level.dat` experiments none, 0 errors; the nearest Weeping Mire
to 0,0 on seed 424242 is now at 32, 95, -32 ("45 blocks", the first square `locate` samples).

**The Weeping Mire with no experiments (1.0.7):** `mire_locate.txt` without the test kit on a fresh world (seed
424242), `--require-no-experiments`: `level.dat` experiments **none** before and after; `locate biome
wmire:weeping_mire` found the Mire at -1760, 63, 928 (1989 blocks from spawn); Mire blocks placed and read back
(`testforblock` found the torn page); `summon wmire:watcher` is refused (the old watcher no longer exists — the one
expected console error, which the harness ignores by name); **0 content-log or script errors**. `noexp.txt` re-run on
1.0.7: 0 errors, `level.dat` experiments none. `python3 tools/merge_weeping_mire.py --check`: 132 Weeping Mire files
checked, 0 differ from the user's archive.

**No experiments (1.0.5):** `noexp.txt` without the test kit on a fresh world, `--require-no-experiments`:
`level.dat` experiments **none** before and after the run; the add-on's scripts ran on the stable APIs (status, trace,
debug and preset commands answered); `observer:the_observer`, `observer:shadow` and `observer:flare` were summoned
and removed; every item, block and recipe loaded; **0 content-log or script errors** (26 s). By contrast, the test kit
cannot load without the *Beta APIs* experiment (the server says so on the first boot of every `--testkit` world) —
which is why only test worlds get it.

### 5.2 Final run by area

| Test group | Assertions passed | Failed |
|---|---|---|
| `setup` | 4 | — |
| `wheel_welcome` | 1 | — |
| `distant_watch` | 9 | — |
| `unnoticed_trace` | 3 | — |
| `mirror_bearing` | 3 | — |
| `extra_step_turn` | 5 | — |
| `extra_step_sneak` | 2 | — |
| `door_ajar` | 6 | — |
| `turned_object` | 3 | — |
| `turned_object_noticed` | 3 | — |
| `snuffed_lights` | 5 | — |
| `window_watch` | 3 | — |
| `close_breath` | 4 | — |
| `borrowed_sound` | 4 | — |
| `echo_ahead` | 4 | — |
| `home_visit` | 9 | — |
| `closed_path_escape` | 9 | — |
| `closed_path_held` | 8 | — |
| `closed_path_struck` | 7 | — |
| `aggression_zero` | 6 | — |
| `unfamiliar_route` | 7 | — |
| `pursuit` | 7 | — |
| `pursuit_watched_walks` | 3 | — |
| `lens` | 3 | — |
| `second_witness` | 3 | — |
| `night_visit` | 3 | — |
| `dimension` | 5 | — |
| `water` | 4 | — |
| `elevated` | 4 | — |
| `ward` | 4 | — |
| `chalk` | 1 | — |
| `manip_off` | 2 | — |
| `carve` | 3 | — |
| `animals` | 1 | — |
| `vigil` | 3 | — |
| `vanish_in_place` | 4 | — |
| `seal_occupied` | 2 | — |
| `mp_fairness` | 1 | — |
| `pursuit_water_escape` | 4 | — |
| `closed_path_light` | 7 | — |
| `bearing_three` | 2 | — |
| `showcase` | 8 | — |
| `toggles` | 1 | — |
| `presence_fx` | 4 | — |
| `auto_peek` | 3 | — |
| `lunge` | 5 | — |
| `creeping_held` | 5 | — |
| `creeping_reaches` | 3 | — |
| `test_entries` | 8 | — |
| `relentless` | 5 | — |
| `near_vanish` | 3 | — |
| `near_strike` | 3 | — |
| `illusion` | 6 | — |
| `illusion_taiga` | 2 | — |
| `flare` | 10 | — |
| `flare_mid_attack` | 3 | — |
| `learning` | 9 | — |
| `hush` | 6 | — |
| `pages` | 4 | — |
| `sign` | 6 | — |
| `inside` | 5 | — |
| `borrowed_eyes` | 4 | — |
| `returns` | 4 | — |
| `climb_pillar` | 4 | — |
| `climb_attack` | 3 | — |
| `climb_over` | 2 | — |
| `float_test_entry` | 2 | — |
| `standoff` | 12 | — |
| `stalk_hang` | 4 | — |
| `stalk_ledge` | 2 | — |
| `squeeze_gap` | 3 | — |
| `squeeze_glass` | 4 | — |
| `squeeze_door` | 3 | — |
| `mire_home` | 6 | — |
| `mire_watcher` | 10 | — |
| `mire_pages` | 7 | — |
| `mire_spawn` | 7 | — |
| `presence_music` | 2 | — |
| `heartbeat` | 5 | — |
| `charge` | 9 | — |
| `profile` | 2 | — |
| `peek_tree` | 6 | — |
| `mire_fuel` | 3 | — |
| `natural` | 1 | — |
| `status` | 0 | — |

### 5.3 Restart and persistence

Scenarios `restart_a.txt` then `restart_b.txt` on the same world (re-run after the persistence fixes):
a *Closed Path* is started, the Veil seal placed and the Observer present and watched — then the server is stopped
mid-encounter (A: 5/5 pass). After restart (B: 2/2 pass): **0 stray Observer bodies** once the chunk loaded, and the
interrupted encounter's Veil cells were **restored** (0 Veil blocks left) within 30 s.

### 5.4 Where the Weeping Mire generates (1.0.8)

`locate biome wmire:weeping_mire` from the server console (origin 0,0) on fresh worlds, no experiments, one world per
seed. "45" is the first square `locate` samples (±32, ±32): the Mire is right there. Seeds 1 and 8080 have deep ocean
at 0,0, so the game's land spawn is elsewhere and these two distances overstate it.

| Setting (`replace_biomes`) | 424242 | 1 | 31337 | 90210 | 2026 | 5150 | 777 | 8080 |
|---|---|---|---|---|---|---|---|---|
| as merged in 1.0.7 (amount 0.25, noise 0.4) | 1989 | 1696 | 1586 | 2266 | 1221 | 1496 | 289 | 595 |
| amount 0.25, noise 1.0 | 996 | 647 | 559 | 2266 | 1810 | — | — | — |
| amount 0.4, noise 1.0 | 950 | 635 | 497 | 481 | 417 | — | — | — |
| amount 0.4, noise 2.0 | 417 | 595 | 481 | 45 | 45 | — | — | — |
| amount 0.3 or 0.35, noise 2.0, more targets (with taigas) | 417 | 559 | 364 | 289 | 226 | 684–725 | 101 | 595 |
| amount 0.4, noise 2.0, more targets (with taigas) | 45 | 595 | 243 | 45 | 45 | 45 | 101 | 544 |
| amount 0.4, noise 3.0, more targets (with taigas) | 45 | 635 | 243 | 45 | 135 | 45 | 101 | 544 |
| **shipped: amount 0.4, noise 2.0, more targets (no taigas)** | **45** | **595** | **243** | **45** | **45** | **45** | **101** | **544** |

Taking the taigas as well made no difference to these distances but put the test arena (a taiga) inside the Mire,
so the taigas are left alone (they keep the taiga shadows). With the shipped setting, `setup_arena_not_in_the_mire`
and `illusion_in_taiga` confirm the arena is still a taiga, and the test Mire is at 32, 95, -32 (seed 424242).

## 6. Manual in-game test procedure (client)

A dedicated server cannot render, play audio, or show forms. Before distribution, one pass in a Bedrock client
(1.26.50+) is required. Create a flat creative test world, activate both packs, then switch to survival:

1. **Model & animation** — on joining, a chat message should confirm the add-on is running and you should receive the
   Observer Config Wheel. Use it → **See it now**: the Observer appears a few blocks ahead and plays each state, named
   on the action bar (watching, staring, head tilt, peeking, stalking walk, running, strike wind-up, recoil), then
   walks away. Check: supplied model and texture correct, each clip plays, head follows you, the content log is empty. `/observer:stage 5` then `/observer:trigger pursuit`, look away: run clip,
   attack wind-up ~0.6 s before the hit, recoil on hit with the lens.
2. **Stoop** — dig a 3-high tunnel; `/observer:trigger closed_path` while walking. It must crouch (no head through the
   ceiling) and the walk must look like walking (not gliding) when it leaves.
3. **Peek lean** — `/observer:trigger distant_watch` near a tree: when it peeks from cover, it must lean *out* from the
   cover. If it leans into the wall, flip the sign in `tools/make_supplemental_anims.py` and rebuild.
4. **Presence** — at night: the eyes glow (two bright points that follow the head), wisps drift around the body from
   feet to head and glow, its voice is audible within ~20 blocks; when it leaves it bursts into crimson shreds.
   **Particles & fog** — footprints oriented along the walk direction, chalk marks, effigy dust;
   the dread fog during a closed path clears afterwards.
5. **Blocks & items** — Veil, Effigy (all four facings), Ward Lantern models and light; all item icons; crafting recipes
   appear in the recipe book after picking up an ingredient.
6. **Audio** — listen for every sound in `RP/sounds/sound_definitions.json` (each is used by at least one encounter):
   steps, extra step, hum, seal, snuff, chime, breath, strike, whiff, vigil drone. Adjust levels if any is too loud.
7. **UI** — every Config Wheel button (status text, presets, all settings, encounter toggles, Test an encounter in
   Survival, Undo its changes, captions), Field Notes form (pages, lessons, vigil button), settings form (operator only), captions toggle, action-bar
   captions, title card after the vigil, camera fade/shake only when the camera setting allows them.
8. **Natural play** — `/observer:preset standard`, play 40–60 minutes normally (building, a cave, a night). Expect nothing
   during the 12-minute grace period, then an encounter every few minutes (2.5–5 min apart at stage 1, shorter at night
   and underground), with a longer quiet stretch every 3–5 encounters. Then `/observer:restore` and confirm no Veil/Effigy blocks remain.
9. **1.0.5 additions** (Config Wheel → Test an encounter, Survival): **The Flare** — throw it near the staring figure:
   the flare flies like a snowball, burns with a white hissing glare and lights the area, and the figure recoils and
   tears apart; craft one (glowstone dust + gunpowder + paper → 8). **The world goes quiet** — with music playing, the
   music stops and a faint high ringing rises; after 20 s your music comes back on the game's schedule. **A page you
   didn't write** — a scratching sound, a message, then Field Notes → *Pages I didn't write* shows it. Stand still 4–5
   minutes in a house with a door to make it your home, then test **Signs** (a sign by the door with readable text,
   facing the door), **It returns what you threw away** (drop an item, walk 10 blocks: a knock, the item outside the
   door), **It's Inside** at night with the torches out (it is in a dark corner behind you; a torch or a 2 s stare
   sends it away), and **Borrowed Eyes** facing a cow or villager (it stops and its head follows you). Finally
   `/scriptevent observer:learn light 3` and check Field Notes → *What I have learned*.
10. **1.0.6** — Test an encounter → **The floating chase**: it rises a block off the ground; look away and it surges
   at you leaning forward with its arms and legs streaming behind; look at it and it drifts upright and limp; no
   footsteps, a rush of air instead. **Climbing after you**: pillar up 5+ blocks first; it climbs the side of your
   pillar hand over hand, staring up at you, and hangs just below you. Check the hands meet the wall and the body
   does not sink into it. In a 3-high tunnel, the floating figure should stay inside the ceiling. While it drifts and
   you hold its gaze, it should be nearly still and then jerk: its head snapping to a wrong angle and holding there, a
   shoulder hitching, the whole body dropping and catching, each with a crack.
11. **1.0.7, the Weeping Mire** — make sure the stand-alone Weeping Mire packs are not active, then on a new world
   `/locate biome wmire:weeping_mire` and go there. Check the Mire looks as it did in the stand-alone add-on: black
   fog, its lighting and colour grading, dark water, weeping trees and giant weeping trees, bone roots and grass,
   silt ponds, cabins; wind gusts with leaves and streaks; leaves falling from the canopy; music silent. The content
   log must be empty. Read a torn page (use it): the note opens as a form, *Torn Page n/8*. Then
   `/scriptevent observer:trigger mire_watcher`: the Observer stands among the trees, not inside the canopy; look at it
   and it holds your gaze, then is gone in black mist with a cave sound. `/scriptevent observer:mirepage all`: the
   title *it knows your name*, and it is behind you.
12. **1.0.8** — Test an encounter → **The Strike**: it comes at you a block off the ground (no footsteps, a rush of
   air), and the wind-up and the strike happen in mid-air with its legs hanging, never touching down; drive it off with
   the lens: the recoil is in mid-air too. **See it now** shows the same. On a few new worlds, check you never start
   inside the Mire and that it is in sight or a short walk away.
13. **1.0.9** — `/scriptevent observer:standoff auto` (it is on by default in play), `/observer:stage 3`, then
   `/observer:trigger distant_watch`: look at it for a second, then away; each time you look back it is closer. Stare
   at it and keep staring: its neck cracks, it rattles, and after a few seconds it shrieks and comes at you, fast,
   floating. Shoot an arrow at it in another standoff: the same. In a cave with a high ceiling,
   `/scriptevent observer:stalk hang` then trigger it again: it hangs upside down from the ceiling (check the feet
   meet the ceiling and the arms dangle); look away and it is standing below. Build a stone box around yourself
   with one 1-block hole, `Test an encounter → The Strike`: it crawls in flat and stands up inside; with glass walls
   it breaks in (the glass comes back); with a door it opens it. When any encounter ends it simply vanishes where it
   stood.
14. **1.1.0** — With music playing, trigger any encounter: the music stops, and fades back a few seconds after it is
   gone. Stand near it, then let it come for you (Test an encounter → The Strike): a heartbeat, quickening, and a light
   tremor when it is on you (none with camera effects off). Stand in a field with trees, Test an encounter → Peeking
   from cover: it is behind a trunk, only its head, a shoulder and a hand showing, its head following you; look at it
   and it ducks, look away and it looks round again — after two catches on the other side. Sprint at a distant figure
   (`/scriptevent observer:charge auto`, stage 3): it either comes for you or is gone; if gone, at night it comes back
   soon. Put Mire planks in a furnace as fuel, and craft Bone Root into bone meal. Field Notes → Lessons → "It knows me"
   after staring it down a few times.

## 7. Bugs found and fixed

**Found by runtime testing**
* Supplied geometry renders mirrored unless X is mirrored in JSON space — renderer convention fixed and verified against
  the supplied previews; stoop pose deepened (3.23 → 2.81 blocks) to fit 3-high tunnels.
* `getBlockAbove` includes its start block → every headroom check failed; probes now start inside the open feet block.
* Placement could start inside rock in tunnels → placement requires an open start block and searches several heights.
* Oak doors are `minecraft:wooden_door`; door interactions were missed and the upper half's `open_bit` is stale →
  periodic ledger scan plus linked door halves.
* Relighting with a new torch was not seen → placed blocks are routed to running encounters.
* Pursuit result overwritten by the sighting → order fixed; pursuit/closed path froze in torchlight → lights along the
  approach are snuffed and light is tested one step toward the player.
* Custom items without a use component never fire `itemUse` → `use_modifiers` added (chalk, notes, eye).
* The vigil aborted itself as "body lost" when it removed its own body between rounds → intentional removals tracked.
* Content errors on load: `minecraft:movable` needs block format 1.21.100; recipe `unlock` context invalid; blocks with
  material instances need geometry — all fixed (0 errors since).
* Water: raycasts pass through water, so the surface was never found → explicit surface scan.
* Carving only considered the closest blocks (the tunnel walls right next to the player) → new candidate search on wall
  faces beside the path, 4–10 blocks away.
* The vanilla retreat goal did not move the body → scripted walk-away.
* Carving could open a wall face toward space behind the wall instead of toward the path → the open side must face the
  player (found in run 5's log).
* Periodic work inside fixed-rate loops was gated on `system.currentTick % n`, which only ever matches if the loop
  happens to start on a multiple of n. After the Config Wheel changed load timing, the block-change scan never ran, so
  a player closing a door the Observer had opened went unnoticed (run 6). Eye glints, chalk-mark display and footprint
  trails used the same pattern. All loops now count their own runs.

* *Peeking* only happened when a placement happened to be partly visible; nothing reacted to actual cover. It now
  follows the blocks beside it every second (`auto_peek_*`, found from the user's report).
* Animals meant to stand and stare at it kept drifting back to their own movement between rotation updates
  (`animals_face_it` was 3/4 in every run, 2/4 once) → they are now slowed to a standstill and re-aimed every 2 ticks.
* The new "notice" sound generator never terminated (its click gaps shrink geometrically and never reach the end
  time) — a tool bug caught while rendering, fixed before anything shipped.

* An encounter waiting in one long `wait()` noticed an abort only when the wait ended (up to 30 s later); waits now
  check every 5 ticks.
* With the faster creature, *The Closed Path*'s escape rule ("10 blocks further than at the start") stopped working;
  the new rule (broke the Veil and is on the far side of the seal from it) first never fired because a normalised
  vector was compared with a distance — caught by `closed_path_escape`, fixed, re-tested 12 / 12.
* The new too-close reaction cut *Borrowed Work* short (walking up to the source is that encounter's answer) — it now
  handles the approach itself; spots far below the player's level are penalised (an *Echo Ahead* spot landed 64
  blocks below the test platform).

**Found by the 1.1.0 tests**
* Hanging from a ceiling closer than 14 blocks, it was "approached" the instant it appeared and went straight into
  the standoff: approaching now means coming closer than it first stood, less 4 blocks (`stalk_hang_stays_put`).
* The tree peekaboo ran only once a second (it sat after the maintenance loop's every-fourth-run return), so it was
  slow to duck; it runs every 5 ticks now.
* The first peek lean put a hand in front of its face and left its chest out past the trunk; the clip was refitted
  with the offline renderer (head about a block out, the body behind the trunk, the hand on the bark).
* Test-side: the "Peeking from cover" wheel test still waited 15 s for its end, but behind a tree it now plays
  peekaboo for up to 20 s; it waits 23 s now (`test_peek_outcome`).

**Found by the 1.0.9 tests**
* Through a gap or a doorway it struck from the opening, still lying flat, and missed: it now comes all the way in
  and stands up before it strikes (`squeeze_gap_reaches_you`, `squeeze_door_reaches_you`).
* The first rage speed (melee speed ×1.75) measured 11 b/s, twice a sprint: it is ×1.5 now, ~8 b/s.
* Test-side: the new cages sat on the open stretch the "peek needs cover" test relies on, and the flat field has no
  real ledges; the cages and a stone ridge now stand in a yard of their own.

**Found by the 1.0.8 tests**
* The first biome tuning made the Mire take taigas too, and the test arena — a taiga — became Mire; the new
  `setup_arena_not_in_the_mire` check caught it. Taking the taigas made no difference to how close the Mire is to
  spawn (§5.4), so they are left alone.
* A new world's spawn is unset (y 32767): the game picks the spot itself, which may be away from 0,0 when 0,0 is
  ocean. The first-spawn guard now treats any first spawn as "at the world spawn" while it is unset, instead of
  requiring it to be within 48 blocks of 0,0.

**Found by the 1.0.7 tests**
* In the Weeping Mire the watcher could be placed where the player could not see it, although placement had
  checked the line of sight: under the weeping trees its head reached into the leaves, and a ray that starts inside a
  block does not see that block — so it could see out while nobody could see it, and looking at it never counted.
  Placement now checks the line both ways for every encounter (`mire_watcher_seen`).
* A torn page could find no visible spot behind the player in thick trees and fell back to one deep among them; it
  now tries 8 blocks behind before that (`mire_page_behind`).
* The last torn page found the Observer still busy with the previous appearance and gave up; it now waits for it to
  be free, for up to a minute.

**Found by the 1.0.6 tests**
* *The Closed Path* sometimes found no spot ahead in a narrow tunnel (above, run 12): the search now looks along the
  corridor in a 5° cone with 40 samples before falling back to the old 22° cone.
* A taiga shadow could appear in the middle of the view and vanish at once (run 13): shadows now always appear 40°+
  to the side, never within 35° of where the player is looking.

**Found by the 1.0.5 tests**
* A Flare thrown mid-attack stopped the damage but not the attack: strikes delivered back to back never passed through
  `enc.wait()`, so an abort was never noticed and the creature kept winding up (no damage, because of the new
  `repelled` flag) until the attack timed out. The same loop could keep a stopped encounter alive in other ways (a dead
  or departed target). The attack loop now checks for an abort before every strike (`flare_mid_attack_ends_it`).
* After that fix the flare ended the attack but the outcome read "struck": the attack loop recorded its last strike as
  it unwound, overwriting *flared*, so it would have learned the wrong lesson. An aborted encounter's outcome can no
  longer be overwritten.
* *Signs* never found a spot: the floor check used `Block.isSolid`, which does not exist in `@minecraft/server` 2.10.0
  (the call failed silently inside `safe()`). It now uses the same floor rules as effigies (`sign_placed`).
* Escape learning could miss its third use: every count faded a little each minute, so three escapes a few minutes
  apart added up to 2.99 and it never adapted (seen when the learning test ran late in a long sequence). Counts now
  stay whole while a way out is in use and only fade after 20 minutes unused.
* *While You Slept* sometimes staged no effigy: the effigy spot is drawn at random within 2 blocks of the bed and was
  given up when the draw landed on the player's own cell (an old bug; it had passed by chance in every earlier full
  run). Occupied cells are now skipped and another spot is drawn (`night_visit_staged`).
* *It's Inside* could not appear in a small room once the player faced the far corner (spots had to be 4.5+ blocks
  away). Spots may now be 3+ blocks away, and the room-sized too-close distance is always shorter than where it stands,
  so it never vanishes the moment it arrives (`inside_leaves_when_lit`).

**Found by loading the pack in a game client (reported by the user)**
* An empty `animations` list in a controller state and object-valued client-entity `sound_effects` (see §1.1).
* A strike at point-blank range could "miss" because direction is meaningless at 0.4 blocks → in-front test skipped
  under 1.2 blocks.

**Found by an independent code review of all scripts (then fixed and, where possible, tested)**
* Two creative/sleeping players who had waited longest could block every other player forever → ineligible players are
  skipped before choosing (`mp_fairness`).
* A player whose encounters kept deferring held the director → deferrals release the global gap and back off per
  player and per type.
* A new home could never replace an old one once six areas were remembered → the current area is never evicted.
* Veil/mimic/effigy could be placed into a cell another player stood in; carving could dig a floor pit → occupancy check
  and wall-only carving (`seal_occupied`, `carve_*`).
* The body could be left standing when a body-free encounter that borrowed it was aborted, or a running walk-away could
  remove the next encounter's body → cleanup by ownership, walk-away stops when the body changes.
* Player state could be lost if they left within 5 s of a change → saved at the moment of leaving; shutdown saves are
  independent of each other.
* Fog and the chase tag persisted on a player who disconnected mid-encounter; one encounter's fog cleanup could remove
  another's → per-encounter fog ids, cleared on rejoin.
* Mimic sand/gravel could fall and duplicate → gravity blocks mapped to non-falling look-alikes.
* The add-on clock was only saved when the world state changed → saved every 5 s on its own.
* *Something Facing You* rewarded any release (a ward, an explosion) → only a player putting it back counts.
* The vigil could be started from a stale form (day, already running, someone else's encounter) → re-validated.
* Witness Lens cooldown was 2 s in script but 20 s in the item and docs → 20 s.

## 8. Not verified

* Anything a client shows or plays: model, animations, the glowing eyes, wisp aura and vanish burst, other particles,
  fog, block models, icons, sounds (including the new voice and shriek), forms, captions, camera effects (§6).
* A real player disconnecting and reconnecting (simulated players cannot reconnect with the same identity).
* Each pacing rule individually (quiet periods, recovery, anti-repetition, deferral back-off): they run in every test,
  and the natural-director tests start encounters on their own, but timings were not asserted one by one.
* Escapes from the pursuit by out-running it 48+ blocks or by outlasting its 35-second limit (the arena is too small);
  the water escape is tested.
* The sleep trigger of *While You Slept* (simulated players cannot sleep; the encounter itself is tested).
* 1.0.5: what the silence sounds like (the server accepted every `playMusic` / `stopMusic` call; whether the game's own
  music resumes promptly afterwards is up to the client), the flare's sprite, glare and sounds, the rendered sign text,
  the "Pages I didn't write" and "What I have learned" forms, and the shore-wait, from-behind, outrun, double-seal,
  lens and blow adaptations individually (they share the asserted code paths: counting, adapting, `shrug`, thresholds).
* Crafting a Flare in the crafting UI (the recipe loads without errors; the recipe book needs a client).
* 1.0.8: how the strike and recoil look in mid-air (the server shows the `observer:afloat` property set on every
  strike in the tests; the look is an offline preview), and a real client's first spawn in a new world whose spawn is
  inside the Mire (the move is tested with simulated players; a real join goes through the same `playerSpawn` event).
* Phones, consoles, low-end devices, and Realms.

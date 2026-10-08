# 10 · Test report

## Read this first

| Category | Status |
|---|---|
| **Static validation** | **Completed** — 6 validators, all passing (below) |
| **Automated logic tests** (night simulation, AI, power, director) | **Completed** — 18 tests passing, plus the balance simulator (docs/05) |
| **Automated structure tests** (command-block files) | **Completed** — 6 tests passing |
| **Automated route-guidance tests** (walkable graph vs the voxel model) | **Completed** — 5 tests passing |
| **Automated integration tests** (real pack scripts on a mock `@minecraft/server`) | **Completed** — 20 tests passing |
| **In-game tests** (Minecraft Bedrock running) | **No systematic pass.** Minecraft is not available in the build environment. The map owner built and played the previous version in-game and reported dark camera feeds, odd mouths and hard-to-follow breadcrumbs; those are fixed in this version (table below) but the fixes have **not** been re-checked in-game yet. |
| **Manual tests still required** | The checklist at the end of this file |

The integration tests run the real behavior-pack scripts against a headless model of the Script API (`tests/mock/`).
They are strong evidence that the scripts, the generated command-block structures and the build plan work together as
designed, **but they are not a playthrough**: rendering, physics, redstone, real tick timing and the real engine were not involved.
Nothing in this report should be read as proof that the map has been played in Minecraft.

Environment: Linux container, Node.js 22.22, TypeScript 5.9.3, Python 3.13 (Pillow, numpy, jsonschema 4.26), ffmpeg/libvorbis.
Run everything with `npm run validate && npm test`.

## Static validation

| Validator | Checks | Result |
|---|---|---|
| `tools/validate_blocks.mjs` | 253 palette entries: block names, state names and values vs official 1.26.50 block metadata | PASS |
| `tools/validate_map.mjs` | voxel model of the whole build: every AI route polyline sampled every 0.5 blocks (6,762 samples), every route node a valid standing position, every camera in open air and seeing exactly its designed nodes (ray casts), office sealed except its doors and hatch, players can walk from the lobby to every gameplay space (66,132 walkable cells), every input command block enclosed | PASS (0 errors, 0 warnings) |
| `tools/validate_commands.mjs` | 488 command strings (448 command blocks, 7 functions, script templates) parsed against the official 1.26.50 command grammar; block states, particles, sound ids, function paths, fill volume, height limits | PASS |
| `tools/validate_schemas.py` | 5 entities vs `server/entity/1.26.50` schema, 3 items vs `server/item/1.26.30`, both manifests (format 2, dependencies, unique UUIDs, script entry exists) | PASS |
| `tools/validate_assets.mjs` | 31 JSON files parse; BP ↔ RP ↔ script entity ids; textures, geometry, animations, controllers, render-controller keys resolve; UV boxes inside 128×64; every animated bone exists; every `fb:anim` value has a controller state; scripts only set enum values; items → icons; 48 sounds with files; every script sound id defined; 6 fogs; lang names | PASS |
| `tsc --checkJs` | every Script API call in the 40 script files against `@minecraft/server` 2.10.0 and `server-ui` 2.2.0 declarations | PASS |

## Automated tests (49, all passing)

**Core simulation (`tests/core.test.mjs`, 18):** same seed reproduces a night exactly · all six nights completable (oracle, 10 seeds each) ·
every lethal attack preceded by its telegraph and never through a closed barrier · closed door always stops Bonnie · 6 AM boundary ·
power zero (reserve window, Freddy sequence, devices off) · power out just before 6 AM survivable · Fredbear barrier + strobe / stun /
forced-open · Fredbear window floors for every aggression · mercy cap · simultaneous threats (≤ 2 entries, none beside Fredbear, one
attack token) · ten fresh sessions start identical · maintenance pauses clock and AI then resumes with grace · Chica's breaker affects
lights only · Freddy never moves while watched · Night 6 finale · input debounce and feedback · no AI outside RUNNING.

**Structures (`tests/structures.test.mjs`, 6):** every `.mcstructure` round-trips and matches the register · every command valid and every
input action handled · module wiring (impulse needs redstone, chain always active, first block clears its pad) · no position collisions ·
exactly one repeating block · command-block NBT keys, `Version` and block version match a structure exported by Bedrock.

**Route guidance (`tests/guide.test.mjs`, 5):** the generated graph matches the current build plan · every edge is walkable both ways · routes reach the office, both basement maintenance rooms and every pre-shift task · the generator route goes down the Staff Stairwell into the basement · breadcrumbs start beside the player and never sit inside walls.

**Integration (`tests/integration.test.mjs`, 20):** main.js wiring · structure-id resolution · intro breadcrumbs over walkable floor with the distance on the HUD · Shift Guide topic menu · `/fb:setup` builds the map and installs 448 command blocks ·
the built world equals the offline voxel model (> 2 million cells) · in-game self-test 9/9 PASS · training shift through the
physical controls · night start and office controls (blocks change, power drains, spoofed input rejected) · 6 AM win persists unlock ·
jumpscare → game over → immediate retry · maintenance pause/resume · ten randomized play/reset cycles · duplicate and stray puppets removed ·
unloaded chunks recovery · quit mid-night and reload · progress survives reload · helper `.mcfunction` files · full campaign nights 1-6
through the console buttons, ending and persistent completion · upgrading a world built by an older version (asks for /fb:setup, rebuilds, keeps progress).

## The 20 required tests

Status key: **S** verified statically · **L** verified by logic tests/simulation · **M** verified in the integration mock ·
**G** verified in-game (none) · **Manual** still requires an in-game check.

| # | Test | Expected result | Actual result / evidence | Status |
|---|---|---|---|---|
| 1 | Import and activate both packs | both packs import from the `.mcaddon`; activating the BP adds the RP | `dist/` archives built reproducibly and integrity-checked (`zipfile.testzip`); manifests valid (format 2, unique UUIDs, BP depends on RP, stable script modules). Import itself not performed | S · **Manual** |
| 2 | Pack dependency and JSON validation | all JSON valid; dependencies resolvable | `validate_schemas.py`, `validate_assets.mjs` PASS; entity/item components checked against official 1.26.50 schemas | S |
| 3 | Every command and referenced identifier | no invalid command, block, state, particle, sound, effect, item, camera preset or entity property | 488 commands PASS; mock rejects unknown blocks/states, sounds, effects, items, presets, entity properties — 0 rejections over all integration runs | S · M |
| 4 | Skins, models and animations | four recognizable animatronics, correct UVs, all animations play | UV/bone/controller checks PASS; offline preview sheet (docs/model_previews.png) shows correct mapping and accessories. In-game look, scale and animation feel unverified | S · **Manual** |
| 5 | All six nights start and complete | each night starts from the time clock and ends at 6 AM | oracle 100 % on 20 seeds per night (docs/05); integration: nights 1-6 played through the office buttons, each clock reached 9,600 ticks | L · M · **Manual** |
| 6 | Each animatronic's attack and defense | every attack has a telegraph and a working counter | core tests for Bonnie, Chica (breaker), Freddy (lurk, watched freeze, power-out), Fredbear (barrier + strobe); human-model simulations lose only after power exhaustion | L |
| 7 | Closed-door protection | no attack through a closed door/hatch | core tests: closed door always repels Bonnie; attack log never shows a closed barrier; Fredbear forces the barrier open first (visible JAMMED state) | L |
| 8 | Camera entry, switching and exit | free camera on the selected feed; switch; sneak/button exits; view restored after exit, death, retry, win | integration: console button and map buttons open feeds (`minecraft:free`), lateral movement locked, hotbar switches, sneak exits, camera cleared and permissions restored after every reset/retry/win. Rendering of remote feeds unverified | M · **Manual** |
| 9 | Power reaching zero | doors open, lights off, reserve window (N3+), Freddy music → dark → attack unless 6 AM | core tests (reserve, sequence, survivable before 6 AM) | L |
| 10 | Fredbear's phases and countermeasures | foreshadow N1-3, phases 1-3 on N4-6, powers signalled, strobe counter works | core tests (windows, strobe rules, mercy cap, finale); campaign mock test N4-6 won with hatch/doors + strobe through the console | L · M |
| 11 | Simultaneous threats | ≤ 2 engaged entries, one attack at a time | core test "simultaneous threats"; scenario `double` | L |
| 12 | 6 AM boundary | 6 AM wins unless an attack already started | core test; scenario `boundary` | L |
| 13 | Death and immediate retry | jumpscare → game over → retry restarts the night in the office | integration: scream played, free jumpscare camera, retry restarts night 2 sealed in the office | M · **Manual** |
| 14 | ≥ 10 consecutive reset cycles | each reset restores everything (docs/03 list) | integration: 10 randomized cycles (random nights, inputs, blackout, echo, skipped hours), every invariant checked after each; core: 10 identical fresh sessions | L · M |
| 15 | Quit and reopen the world | night abandoned, progress kept, back at the time clock | integration: reload mid-night → lobby, "interrupted" message, save unchanged, single puppets | M · **Manual** |
| 16 | Chunk unloading and lower simulation distances | night logic unaffected; entities recover | integration: stage area and control room unloaded mid-night → clock continues, actuation deferred then applied, one puppet each afterwards. Lower simulation/render distances on a real client unverified | M · **Manual** |
| 17 | Missing or duplicated entities | exactly one of each animatronic | integration: extra tagged duplicate, untagged strays removed within 40 ticks; missing puppets respawned; self-test check | M |
| 18 | Campaign unlock persistence | unlocks survive quitting | integration: win → `fb:save` updated; reload → unlocks, settings and completion intact | M · **Manual** |
| 19 | Night 6 ending | finale at 5 AM, ending sequence, campaign complete | core finale test; integration campaign reaches ENDING, then lobby with `campaignDone`, archive/credits shown | L · M · **Manual** |
| 20 | Full uninterrupted campaign playthrough | tutorial + nights 1-6 + ending by a player | mock playthrough by an automated policy (oracle) pressing the console buttons. **No human or in-game playthrough has been done.** | M · **Manual** |

## Failures found and fixed

| Found by | Problem | Fix |
|---|---|---|
| player report (in-game) | The breadcrumb sparkles pointed in a straight line through walls and floors, so the basement generator was hard to find | walkable route-guidance graph generated from the build plan; sparkles follow doors, corridors and stairs; distance on the HUD; directions in the maintenance text |
| player report (in-game screenshot) | Mouths looked like a second nose: a narrow protruding muzzle with its own painted nose under the skin's nose | head split along the skin's face; full-width hinged jaw from the skin's own lower face, mouth line one block higher; teeth and cavity only show when the jaw opens; Chica's beak extruded from her own skin pixels |
| player report (in-game) | Camera feeds too dark to read | clear `fb:camera_feed` fog while the monitor is up; 40 soft hidden lights where cameras look (door corners excluded) |
| player request | Animatronics slightly larger; better animations | scale ×1.35 / 1.3 / 1.3 / 1.45; one stage performance per character with props in the hands; jaw motion in every animation |
| preview vs screenshot | Bonnie's ears leaned inward (the A shape in the screenshot): the ear roll sign was inverted | ear rolls flipped; the preview renderer's roll sign now matches vanilla animations |
| integration test | The in-game self-test reported the heartbeat as FAIL when run within 5 s of loading the world | the self-test waits up to 6 s for the repeating heartbeat block |
| integration test | Training shift and debug night/scenario start called `fullReset` and `beginNight` in the same tick; the reset's chained `night.end` module ran after `night.begin` and re-opened the doorways | actuator bus `fence()`: triggers after a reset wait until the reset chains finish (docs/03) |
| integration test | helper `.mcfunction` files sent `scriptevent fb:setup` / `fb:debug`, which the game did not handle | handlers added; `lobby` debug action; control-room teleport fixed |
| schema / vanilla check | `minecraft:pushable` no longer exists in 1.26.50 entity definitions (split into `pushable_by_*`); `minecraft:breathable` keys were wrong | components removed (puppets are teleported; damage sensor covers suffocation) |
| audio review | Freddy's and Fredbear's music-box clips were shorter than their cues (up to 20 s / 17 s) | clips lengthened; the script stops them when the cue ends |
| balance simulation | oracle lost nights 5-6 to power-outs | device and base drain retuned; recovery floors raised |
| logic tests | Chica's linger fell through to a movement roll; Freddy's retreat fallback; withdraw pathing | fixed in `ai/*` |
| map validator (21 findings) | blocked stage routes, sign text over a door, vent passability, unreachable props loft (web on the ladder), camera sightlines blocked (C02/C04/C05/C06/C07/C11/C12/C14 moved), exposed attic command block, arcade cabinets too tall | layout, kits and cameras corrected; validator now clean |
| command validator | 502 command blocks with duplicated logic | shared modules → 448 blocks (docs/06 "Why 448") |
| tutorial review | one action advanced two tutorial steps | one event source per step |
| typecheck | API misuse caught by `tsc` against official typings | fixed |

## Manual checks still required (Windows Bedrock 1.26.50 recommended)

1. Import `dist/Fredbear_Six_Nights_Below.mcaddon`; create a Flat world with cheats; activate the BP (RP added automatically).
2. `/fb:setup`: build completes without a *Build report*; time the build and note any lag.
3. `/fb:debug selftest`: 9 × PASS. In particular *command blocks in place* (structure ids `fb:*` load) and *actuator round trip*.
4. Walk the map in FREE ROAM: stairs face the right way, doors/windows/props look right, signs readable, no floating or
   missing blocks; control room labels readable.
5. Check the four animatronics on the stage and Fredbear in the chamber: textures, ears, hats, beak, props, the new jaw (closed and open), scale; glowing eyes in the dark. At the new sizes, hats and Bonnie's ears may poke through the top of 3-block doorways while walking.
6. TRAINING SHIFT end to end, then nights 1-6 (use `/fb:debug scenario …` to reach specific situations quickly).
7. Cameras: every feed is bright enough to read (camera fog + lights), shows its room and puppets at render distance 11+, then at 6-8 chunks; the door corners stay dark on camera and through the windows; feeds never leave the player stuck.
7b. Breadcrumbs: from the time clock to the office, and on nights 3 and 5 from the office to the basement maintenance rooms.
8. Animations: walk, stalk, crawl in vents (hidden), threat at doors, attack lunge with the free camera aimed at the face.
9. Sounds: positional footsteps audible from the office, music boxes stop when the cue ends, captions match.
10. Quit mid-night and reload; quit mid-build and run `/fb:setup` again.
11. Controller and touch: buttons, items (does the item interact button fire `itemUse`?), hotbar camera switching, sneak exit.
12. Performance: frame rate in the office with the monitor up; tick rate during the build.

## Known limitations

* The map is built in the player's world by script; no `.mcworld` is provided because a valid world archive could not be produced
  and validated here (docs/01).
* Camera feeds are single views (one at a time); there are no simultaneous live video feeds.
* Unverified engine behaviour is listed in docs/01 "Unverified items".
* Balance is tuned with player models, not with people; nights 5-6 are hard for the human model mainly because of power (docs/05).

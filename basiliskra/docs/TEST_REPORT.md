# Basiliskra: what was tested, and what was not

## Devices and game builds tested

**By the project owner, once: Android (the content log paths are `/data/user/0/com.mojang.minecraftpe/...`), an existing world.** That first load showed two faults, both in files I had marked as checked:

| Content log | Cause | Fix |
|---|---|---|
| `minecraft:timer -> time: expected an object`, then both entities *failed to load from JSON* | The two timers were written `"time": 2`. The 1.26.60 schema wants `{ "min", "max" }`; my validator flagged it and I waived it because vanilla files do it (they are all on format 1.26.50 or older). With the entity not loading, **he could never appear**. | `"time": { "min": 2, "max": 2 }` (and 20 for the hit volumes). The waiver is gone from the validator. |
| `model already has a locator mouth that doesn't exactly match ... skipping new definition in ii` (11 names, forms I and II) | The game merges the locators of all three geometries of one entity and keeps the first of each name, so forms I and II would have emitted their particles from Form III's mouth, gills, eyes and notch. | Every locator carries its form (`mouth_i`, `mouth_ii`, `mouth_iii`); the animation controllers use those names. `armor_offset.default_neck`, which the engine derives per geometry, is declared identically in all three. The validator now fails on any locator name defined differently by two geometries of one entity. |

The fixes have **not** been seen in game yet. Everything else below is what could be checked without the game, against Mojang's own published material for **1.26.60**: It is everything that could be checked without the game, done as carefully as possible, against Mojang's own published material for **1.26.60**:

* the JSON schemas, vanilla packs and vanilla id lists in `Mojang/bedrock-samples` v1.26.60.5,
* the `@minecraft/server` **2.11.0** and `@minecraft/server-ui` **2.3.0** typings from npm (the stable modules for 1.26.60).

The first thing to do with this add-on is an import and a play session on a real 1.26.60 build. The list at the end says what to look at first.

`tools/bds/smoke.py` can load both packs into a Bedrock Dedicated Server you point it at and collect every error line from the logs. It has not been run; in-game testing is done by the project owner.

## What was run

All of it is reproducible with `python3 tools/build.py` (which runs the first four) and the commands shown.

| Check | Command | Result |
|---|---|---|
| Type-check of the script against the 2.11.0 typings (strict) | `npx tsc --noEmit -p .` | clean |
| Bundle | `node tools/bundle.mjs` | 166 KiB, one import: `@minecraft/server` |
| Pack validation | `python3 tools/validate/validate.py` | no problems (three notes, below) |
| Scenario suite in a simulated world | `node test/run.mjs` | **119 of 119 checks pass** |
| Engine calls per tick | `node test/perf.mjs` | see DESIGN.md, "Bounded work" |
| Foot and claw contact on the shipped animation | `node tools/preview/contact.cjs` | below |
| Independent code review (a second reviewer with no access to my reasoning) | | 20 findings; all acted on, the reviewer's four probe scripts re-run clean and kept as regression scenarios |

### Pack validation

Strict JSON for 57 files; 36 documents checked against Mojang's schemas (entity 1.26.60, item 1.26.50, particle 1.21.10 and others); every reference resolved: textures and their six PBR texture sets, four geometries, 135 animated bones, 47 locator-bound particle hooks, 33 particle effects, 48 sound events over 71 files, 15 synchronised properties (all `client_sync`), 55 vanilla block and entity ids and 26 vanilla sound ids used by the script (checked against the 1.26.60 lists), manifest UUIDs and versions, `@minecraft/server` 2.11.0 as the only module, the `pbr` capability.

Notes it prints, none of them a failure: `minecraft:timer` uses a bare number for `time` (vanilla does; the published schema lists only the object form); one sound id is built from two literals at run time (both exist).

### Scenario suite

The script bundle that ships is run unmodified against `test/mock.mjs`: persistent entities and ids, chunk unloading, three dimensions, dynamic properties, queued after-events, before-events, a restart that throws away every script object, and an engine tick counter that starts again at zero each session.

| Asked for | Scenario group | What is asserted |
|---|---|---|
| What opens the rift | 1 | one meal and one tree weigh almost nothing; natural deaths nothing; repeated harm crosses the line; a late-joining friend has no blame; an untouched region recovers; history is bounded |
| Simultaneous first-arrival triggers from two players | 2 | one request becomes the arrival, the other is refused; the coast is reserved before anything is created; exactly one exists; the knocks and rams reach both players; hit volumes cover the body |
| Duplicate submission, copied creature, stray summon | 3 | a second trigger is refused; a summon is removed before it ticks and is never visible; a copy with the same token is quarantined; the same holds in every dimension; the original's identity survives; a hit on any part counts once |
| Driven off, not killed | 3 | at his last breath he leaves through a seam, nothing replaces him, and the same animal returns a day later, whole |
| Interrupted arrival | 4 | entity saved but record not: reconciled, not recreated. Record saved but no entity: created exactly once |
| Returning to an unloaded coast after the Nether | 5 | his chunk unloads with him; nothing is created while it is unloaded; coming back finds the same entity; hit volumes do not outlive him |
| Evolution during save and reload | 6 | same entity id before and after; health kept; named Basiliskra II; a reload between "record says III" and "entity says II" is repaired |
| A player joining during a beam charge | 7 | the late joiner reads form, phase and charge from the entity; the player who stepped aside is missed, the one in the locked line is hit; the drawn beam has the length the server measured; the vent knocks follow |
| Grounding | 8 | a weathered, waxed rod near the club takes the charge; nothing is fired; no real lightning |
| The ending; a completed rift stays quiet | 9 | fin pulses quicken near the seam; the rhythm calls him; interrupted, he backs out and can be called again; held, he crosses; zero remain; still zero after a restart; new harm and a summon do nothing; the old token is refused |
| Pack upgrade | 10 | an older record is migrated in place; a retired save stays retired |
| Walls and lanes | 11 | he walks round a cottage (no part of his trunk inside it); a goal inside a building is given up; the seam opens where he has a lane; three real rams; the lane misses the pier |
| Review findings | 12 | canopy is not ground; cover stops the beam; a call with no water lapses or gives way; redstone-clocked note blocks hold the rhythm; scorch rules; deep water; an unload mid-arrival |
| Spawn egg, spawn command, journal, config wheel | 13 | the journal and wheel are handed out once; the egg on land in a new world makes Basiliskra III and he stays; a second egg moves the same animal; the egg in the Nether makes nothing; an egg far from an unloaded Basiliskra takes over his identity and the old body is removed when it loads; the three commands register without cheats and refuse non-operators where they should; the journal shows the anger percentage, what more it takes, your share, when and where he comes, and changes nothing; settings change and survive a reload; bring, send back and reset work; busy screens are retried |

Counting him: the suite counts loaded and saved entities of his type after every scenario above. It is 0 before arrival and after departure and 1 otherwise, in every case.

### Contact (measured on the shipped geometry and animation, in the offline viewer)

| | |
|---|---|
| Form III, planted sole speed over the ground | 0.01 blocks/s mean, 0.014 worst |
| Form III, sole height | never more than 0.03 below the ground; lifts 1.0 in swing |
| Form III, feet on the ground | three for 91% of the walk, four for 9%, never fewer |
| Form III, lowest spike of the tail club while walking | 0.68 above the ground |
| Form II, foreclaw during a pull | moves 0.25 blocks while the body travels 1.6 |
| Form III, eye at the window | 2.4 blocks outside the pane, level with its middle (0.04 off in height, 0.17 sideways); chin one block clear of the ground |
| Beam aim, locked line against the target's head (server skeleton, whole-degree look angles as the client receives them) | passes 0.1 to 0.3 blocks from it at 16 to 27 blocks, 0.7 at 42 |

### Previews

`previews/*.mp4` were rendered offline from replays of the real script. They are evidence of what the script decides and of how the shipped assets look and move in *my* viewer, which implements Bedrock's geometry format, Molang (the subset used), animation controllers, render controllers and particle components from their documentation. They are not evidence of how the game renders them.

## Not verified, in order of risk

1. **That the packs import and the entity loads at all.** Format versions, component names and shapes match the 1.26.60 schemas and vanilla files, but schemas do not catch everything the game rejects.
2. **Script-driven movement.** The animal is moved by `applyImpulse` on an entity with no gravity or collision. How smoothly that interpolates on clients, and whether a 46-block entity is simulated when its origin chunk is at the edge of simulation distance, has not been seen.
3. **Render distance of something this big.** Geometry has generous visible bounds and the client entity updates bones off screen, but entity culling by distance is engine behaviour I could not observe. He may pop in later than the terrain around him.
4. **Model cost.** Form III is 1,501 cubes, with up to nine extra glow passes while charging. Fine on paper for a single entity; not measured on a phone.
5. **Molang in the real client.** 128 pre-animation statements per frame, including leg IK with `math.acos` and `math.atan2`. Verified only in my runtime.
6. **The beam billboard.** `lookat_direction` with a direction derived from velocity is vanilla-proven, but which axis the game stretches is assumed from documentation.
7. **Hit volumes.** That a cancelled hit on a helper entity re-applied to the main one behaves like a normal hit (knockback resistance, invulnerability frames, enchantment effects), and that the 20-second keep-alive timer resets as intended.
8. **`minecraft:dimension_bound` with no collision**, name tags on a nameable entity set from script, and `beforeEvents.entityHurt` damage rewriting, as used here.
9. **Sounds.** 68 files are synthesised and three are cuts of the roar recording supplied by the project owner; all 71 pass automatic checks (format, mono, length, peak, DC, clean edges). **Nobody has listened to the synthesised ones**, and I have not heard the roar either: I measured it (seven seconds at full level, then a tail) and cut it on those measurements. Their in-game range follows the `max_distance` values in the definitions; not heard.
10. **Vibrant Visuals.** Texture sets are well-formed and the emissive level was calibrated against vanilla sets; not seen under the deferred renderer.
11. **Realms, consoles, split-screen, low simulation distance, and anything multiplayer beyond what the simulation models.**

## First session checklist

Import on 1.26.60 → content log on → check the two errors above are gone. Use the journal; then, on a *copy* of the world: the config wheel's **Call him** at a coast and **Skip to dusk**, and watch one arrival; **Bring him here** as I, II and III (or `/basiliskra:spawn i|ii|iii`) to see each form; look at each form from far away, at the screen edge, and under Vibrant Visuals; hit head and tail; stand behind cover during a beam; put a rod by the club; finish the ending; reload the world at each stage; then try the spawn egg twice and a structure-block copy, and count: there should only ever be one.

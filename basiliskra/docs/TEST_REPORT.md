# Basiliskra: what was tested, and what was not

## Devices and game builds tested

**By the project owner, once: Android (the content log paths are `/data/user/0/com.mojang.minecraftpe/...`), an existing world.** That first load showed two faults, both in files I had marked as checked:

| Content log | Cause | Fix |
|---|---|---|
| `minecraft:timer -> time: expected an object`, then both entities *failed to load from JSON* | The two timers were written `"time": 2`. The 1.26.60 schema wants `{ "min", "max" }`; my validator flagged it and I waived it because vanilla files do it (they are all on format 1.26.50 or older). With the entity not loading, **he could never appear**. | `"time": { "min": 2, "max": 2 }` (and 20 for the hit volumes). The waiver is gone from the validator. |
| `model already has a locator mouth that doesn't exactly match ... skipping new definition in ii` (11 names, forms I and II) | The game merges the locators of all three geometries of one entity and keeps the first of each name, so forms I and II would have emitted their particles from Form III's mouth, gills, eyes and notch. | Every locator carries its form (`mouth_i`, `mouth_ii`, `mouth_iii`); the animation controllers use those names. `armor_offset.default_neck`, which the engine derives per geometry, is declared identically in all three. The validator now fails on any locator name defined differently by two geometries of one entity. |

**Then, by the project owner, in game with 1.2 (screenshots of the settings, Form III spawned with the command, the Geiger counter).** The packs loaded, he spawned, the journal, wheel and counter worked. What was reported, and what 1.3 does about it:

| Seen in game | Cause | 1.3 |
|---|---|---|
| Form II and III not much bigger than Form I | The models are their real size; III is longer, not taller | II is drawn 1.25 times its model and III 1.7 times (client `scale`, Molang on the form property); the server rig, hit volumes, movement, stride, window pose and visible bounds scale with it |
| Hitting his feet did not hurt him | The server skeleton stands its legs at rest, so the foot volumes stayed under the hips while the drawn feet strode; and each foot volume was centred on the sole, half of it underground | Leg volumes (knee and sole, four legs) follow the walk cycle the client solves; no volume's box starts below his feet; sizes up to 13 blocks |
| Walking animation too fast | One stride of 7 blocks at walking speed | The stride is 11.9 blocks at the new size (the legs swing about 40% slower at the same speed); Form II's drag is 35% slower |
| He ignored animals | Only players were hunted | He goes after any creature (`mob` family) when no player is near enough, treads on what is underfoot, and turns his breath on it |
| Sliders could not be dragged (phone) | `ModalFormData.slider` | Dropdowns of presets, each with a box to type any value |
| "I killed three and it says 19, then it resets" | The figure was a *percentage* of what calls him (three kills weigh 0.15 + 0.5 + 1 of 8: 20%, then faded to 19%), and the headline was the *least* of animals and habitat (0% with no trees cut), for the 64-block area the player stood in | The journal shows plain counts (animals killed, logs cut) beside what they count for, a progress figure that only rises with harm, the angriest of the nine areas round you, and your own totals |
| (1.3, in game) Spawned as Basiliskra III he always walked off near a body of water | With no player he could hunt near (a Creative player did not count), he roamed round his "home", which was the first place he was ever brought, or the seam, which is always in water | He roams round any player who is near, of any game mode; and wherever he is brought becomes his home (he also comes back there, on land, after being sent away) |
| (requests) time the breath to the supplied recording; use the voice recording; roars with shake, shockwave and land damage; a bigger, smokier, more destructive, wither-like beam; roar at random and after the beam | | All done; see "Bigger, louder, out of control" below. The breath stays scarlet (as asked after the first plan was blue) |

None of the 1.3 changes has been seen in game. Everything else below is what could be checked without the game, done as carefully as possible, against Mojang's own published material for **1.26.60**:

* the JSON schemas, vanilla packs and vanilla id lists in `Mojang/bedrock-samples` v1.26.60.5,
* the `@minecraft/server` **2.11.0** and `@minecraft/server-ui` **2.3.0** typings from npm (the stable modules for 1.26.60).

The first thing to do with this add-on is an import and a play session on a real 1.26.60 build. The list at the end says what to look at first.

`tools/bds/smoke.py` can load both packs into a Bedrock Dedicated Server you point it at and collect every error line from the logs. It has not been run; in-game testing is done by the project owner.

## What was run

All of it is reproducible with `python3 tools/build.py` (which runs the first four) and the commands shown.

| Check | Command | Result |
|---|---|---|
| Type-check of the script against the 2.11.0 typings (strict) | `npx tsc --noEmit -p .` | clean |
| Bundle | `node tools/bundle.mjs` | 237 KiB, two imports: `@minecraft/server`, `@minecraft/server-ui` |
| Pack validation | `python3 tools/validate/validate.py` | no problems |
| Scenario suite in a simulated world | `node test/run.mjs` | **169 of 169 checks pass** |
| Engine calls per tick | `node test/perf.mjs` | see DESIGN.md, "Bounded work" |
| Foot and claw contact on the shipped animation | `node tools/preview/contact.cjs` | below |
| Independent code review (a second reviewer with no access to my reasoning) | | 20 findings; all acted on, the reviewer's four probe scripts re-run clean and kept as regression scenarios |

### Pack validation

Strict JSON for 90 files; 59 documents checked against Mojang's schemas (entity 1.26.60, block 1.26.60, item 1.26.50, particle 1.21.10 and others); every reference resolved: textures and their six PBR texture sets, four geometries (2,136 cubes), 135 animated bones, 79 locator-bound particle hooks and 86 locators (unique across the entity's geometries), 51 particle effects, 54 sound events over 85 files, 14 synchronised properties used by the client, 64 vanilla block and entity ids, one vanilla particle id and 29 vanilla sound ids used by the script, the 164 vanilla block ids the shockwave may break, and all 14 values of the sound ids the script builds at run time (all checked against the 1.26.60 lists), manifest UUIDs and versions, the two stable script modules, the `pbr` capability.

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
| Walls and lanes | 11 | (scorch mode) he walks round a cottage, no part of his trunk inside it; a goal inside a building is given up; (destroy mode) the same walk goes straight through the cottage, a chest and a bed inside are left, the ground stays; the seam opens where he has a lane; three real rams; the lane misses the pier |
| Review findings | 12 | canopy is not ground; cover stops the beam (scorch mode), and in destroy mode the beam blows a hole in the wall and finds the player; a call with no water lapses or gives way; redstone-clocked note blocks hold the rhythm; scorch rules; deep water; an unload mid-arrival |
| Spawn egg, spawn command, journal, config wheel | 13 | the journal and wheel are handed out once; the egg on land in a new world makes Basiliskra III and he stays; a second egg moves the same animal; the egg in the Nether makes nothing; an egg far from an unloaded Basiliskra takes over his identity and the old body is removed when it loads; the three commands register without cheats and refuse non-operators where they should; the journal shows the anger percentage, what more it takes, your share, when and where he comes, and changes nothing; settings change and survive a reload; bring, send back and reset work; busy screens are retried |
| Bigger, louder, out of control (1.3) | 15 | the charge lasts exactly the charging part of the recording (137 ticks from its sound) and he fires on the tick the shot's sound starts, for its 155 ticks; he vents, then roars; the beam glows, smokes and blasts; it blows a burning crater (181 blocks, 8 fires in the test) and not a tunnel; screens shake (strongest 0.34 at 56 blocks, never above 0.75); a roar's shockwave throws and hurts a player 14 blocks off and a cow, leaves one 70 blocks off alone, flattens 24 of 24 flowers and shatters glass in destroy mode, spares a chest, and leaves glass in scorch mode; with no player to hunt he goes after a cow and it is hurt; left alone he roars 4 times in 15 minutes at uneven gaps (167 to 356 s) and makes his recorded noises between; Form III has 8 leg volumes that sweep 4.6 (knee) and 9.2 (sole) blocks through the walk, none below the ground, sized up to 9 blocks; presets and typed numbers ("1.25", "x1.5", "1,5") are read and nonsense ignored; a 1.2 save that never chose a terrain mode gets the new default, a 1.3 choice is kept; three kills read as three, the progress figure counts them with no trees cut, and stepping over an area's edge does not lose them; at the window one eye ends 2.55 blocks outside the pane, in its upper block; (1.3.1) spawned by command beside a Creative player in a world whose old seam is 300 blocks off, he stays within 46 blocks of the player for five minutes, and sent back he returns where he was brought, on land |
| Fallout | 14 | his beam leaves fallout; ash and motes reach witnesses; grass turns to irradiated soil and plants wither inside it; Geiger clicks; hunger, weakness and nausea in strong fallout; the cottage, a lawn against its wall and a planted hedge are never touched; wild leaves fall, trunks stay; sand the beam touches fuses into trinitite; with the custom blocks refused it falls back to vanilla blocks without an error; the journal and the counter read it; it fades and the soil heals; the record stays bounded; off means off |

Counting him: the suite counts loaded and saved entities of his type after every scenario above. It is 0 before arrival and after departure and 1 otherwise, in every case.

### Contact (measured on the shipped geometry and animation, in the offline viewer, on 1.2)

These were measured before Form III was drawn larger and have not been measured again: the offline viewer does not apply the client entity's `scale`. The walk is solved in model units and driven by distance divided by the scale, so the soles should still hold still while planted; that is reasoning, not a measurement.

| | |
|---|---|
| Form III, planted sole speed over the ground | 0.01 blocks/s mean, 0.014 worst |
| Form III, sole height | never more than 0.03 below the ground; lifts 1.0 in swing (1.7 at the new size) |
| Form III, feet on the ground | three for 91% of the walk, four for 9%, never fewer |
| Form III, lowest spike of the tail club while walking | 0.68 above the ground (1.16 at the new size) |
| Form II, foreclaw during a pull | moves 0.25 blocks while the body travels 1.6 |
| Beam aim, locked line against the target's head (server skeleton, whole-degree look angles as the client receives them) | passes 0.1 to 0.3 blocks from it at 16 to 27 blocks, 0.7 at 42 |

Measured again for 1.3 with the server rig (scenario 15): at the window, with the 6.5-unit crouch, one eye ends 2.55 blocks outside the pane at 2.6 blocks above his feet, in the upper block of a two-high pane; the jaw rests on the ground. His skull is too big now to bring the eye to the middle of the pane without sinking the jaw.

### Previews

**The previews have not been rendered again for 1.3.** They show 1.2: Form III at his old size, the narrower beam without its smoke, glow and craters, the synthesised charge and beam sounds, and no shockwave.

`previews/*.mp4` were rendered offline from replays of the real script. They are evidence of what the script decides and of how the shipped assets look and move in *my* viewer, which implements Bedrock's geometry format, Molang (the subset used), animation controllers, render controllers and particle components from their documentation. They are not evidence of how the game renders them.

## Not verified, in order of risk

1. **That the 1.3 packs import cleanly.** 1.2 did; 1.3 adds 13 particle effects, a Molang `scale` on the client entity, three more hit-volume sizes (up to 13 blocks: vanilla's largest collision box is the dragon's 13) and new sounds. All are schema-valid.
2. **The cost of destruction in a real world.** A beam in destroy mode sets up to 110 blocks to air every fourth tick and lights fires; walking, he clears slabs of what is built, up to 96 blocks every third tick. Counted in the simulation (DESIGN.md, "Bounded work"), not timed on a device. Fire that spreads through a wooden village is vanilla fire and behaves as vanilla fire does.
3. **The roar's block query.** `Dimension.getBlocks` with a type filter is stable in 2.11.0; whether the engine limits the volume (up to 81 x 12 x 81 here) is not documented. If it throws, the ring is sampled instead (fewer blocks break).
4. **Script-driven movement at the new size.** The animal is moved by `applyImpulse` on an entity with no gravity or collision. How smoothly that interpolates on clients, and whether a 70-block entity is simulated when its origin chunk is at the edge of simulation distance, has not been seen.
5. **Render distance of something this big.** Geometry bounds are scaled with him and the client entity updates bones off screen, but entity culling by distance is engine behaviour I could not observe.
6. **Model cost.** Form III is 1,501 cubes, with up to nine extra glow passes while charging, and now more particles while firing (10 blazing plates, smoke along the beam). Not measured on a phone.
7. **Molang in the real client.** 128 pre-animation statements per frame, including leg IK with `math.acos` and `math.atan2`, and the new `scale` expression. Verified only in my runtime.
8. **The beam billboards and the drag-placed smoke.** `lookat_direction` with a direction derived from velocity is vanilla-proven, but which axis the game stretches is assumed from documentation; smoke and embers rely on `particle_initial_speed` being evaluated per particle (as vanilla's random speeds are).
9. **Hit volumes.** That a cancelled hit on a helper entity re-applied to the main one behaves like a normal hit, that the 20-second keep-alive timer resets as intended, and that a 13-block collision box on a helper is hit as expected.
10. **Commands from script:** `camerashake` and `stopsound` run as the player; not seen.
11. **The two blocks** (irradiated soil, scarlet trinitite): schema-valid; not yet confirmed placed in game.
12. **Sounds.** 67 files are synthesised; 18 are cuts of the three recordings supplied by the project owner (roar, atomic breath, voice). I have not heard any of them: the breath was cut where it changes from charging to firing (6.86 s: a 14 dB dip, then the low band doubles), and the voice at the breaths between grunts, both from measurements. Their in-game range follows the `max_distance` values; not heard.
13. **Vibrant Visuals**, **Realms, consoles, split-screen, low simulation distance**, and multiplayer beyond what the simulation models.

## First session checklist

Import on 1.26.60 → content log on → look for any error naming basiliskra. Spawn Form III (`/basiliskra:spawn iii`) and: hit a foot while he walks; watch a beam from the side (charge, the eye locking, seven seconds of fire, the crater, the roar after); stand near a roar; give him a cow; let him walk at a house; open the settings on the phone. Then, as before: Use the journal; then, on a *copy* of the world: the config wheel's **Call him** at a coast and **Skip to dusk**, and watch one arrival; **Bring him here** as I, II and III (or `/basiliskra:spawn i|ii|iii`) to see each form; look at each form from far away, at the screen edge, and under Vibrant Visuals; hit head and tail; stand behind cover during a beam; put a rod by the club; finish the ending; reload the world at each stage; then try the spawn egg twice and a structure-block copy, and count: there should only ever be one.

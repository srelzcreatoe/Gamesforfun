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

**Then, by the project owner, in game with 1.3 / 1.3.1.** What was reported, and what 1.4 does about it:

| Seen in game | Cause | 1.4 |
|---|---|---|
| "Send him back" did not make him go away; calling him afterwards gave the same form | That button was written as "worn down": he left and was owed back a day later in the stage he had. "Call him" only booked an arrival for the next dusk | **Send him away** ends it: a fresh story (the anger on record and his fallout stay), and he is gone until called. **Call him now** acts at once |
| The rift never opened: "nothing happens" | Calling waited for dusk and for deep water, with nothing to see meanwhile; and there was no rift on land at all | The rift opens the moment he is called: in deep water for Basiliskra I, on the ground in front of the caller for a returning II or III, who walks out of it |
| "Bring him here": he floated in the air and did nothing | He was put level with the player, not on the ground under that spot; and in a world whose story had not begun the record was left in a state the brain never started from | The ground is searched for all the way down; the record is begun properly; a test brings each form in mid-air and checks he lands and acts |
| Hitting his head only counted from inside him | A few large volumes on bone pivots, which sat inside the skull and neck; and one entity type resized at run time | Volumes are generated from every bone's solid boxes, snout to tail tip (25, 33 and 29 volumes for I, II, III; largest uncovered gap 0.4 to 0.7 blocks); ten entity types of fixed size; a swing that plainly lands but that the game did not register is counted (`playerSwingStart`) |
| (requests) walk through everything as III; hear him from 200 blocks; time roars and sounds to animation; a cooler beam; better pathfinding; a flashy rift; cutscenes; glowing radiation blocks and items, strong, spreading then going; three themes; a clearer account of how he changes | | All done; see "1.4" under "What was run". The journal lists what each change waits on as a checklist |

**Then, by the project owner, with 1.5.** What was reported, and what 1.6 does about it:

| Seen in game | Cause | 1.6 |
|---|---|---|
| "When transforming some of them get out of frame cuz it's zoomed out in the cutscene" | One camera on a wide orbit whose distance was a fixed sum for all forms: the small forms were lost in it and the large ones ran out of the top of it | The change is five cut shots, each a multiple of the size he is drawn and placed from the way he faces, looking at his head or his middle; the camera's place is tested for solid blocks. Asserted in the suite: during the change to IV the camera is never more than 48 blocks from what it is looking at (the old one stood 94 off) |
| (requests) only minutes for a change; go to villages; cities with people, a beach, a very deep sea with its own blocks and structures; a much stronger battle form; a gun | | All done; see groups 19 to 22 below. A biome was asked for and a script-built city delivered: a custom biome needs an experiment |

None of the 1.4, 1.5 or 1.6 changes has been seen in game by me (the report above is the owner's). Everything else below is what could be checked without the game, done as carefully as possible, against Mojang's own published material for **1.26.60**:

* the JSON schemas, vanilla packs and vanilla id lists in `Mojang/bedrock-samples` v1.26.60.5,
* the `@minecraft/server` **2.11.0** and `@minecraft/server-ui` **2.3.0** typings from npm (the stable modules for 1.26.60).

The first thing to do with this add-on is an import and a play session on a real 1.26.60 build. The list at the end says what to look at first.

`tools/bds/smoke.py` can load both packs into a Bedrock Dedicated Server you point it at and collect every error line from the logs. It has not been run; in-game testing is done by the project owner.

## What was run

All of it is reproducible with `python3 tools/build.py` (which runs the first four) and the commands shown.

| Check | Command | Result |
|---|---|---|
| Type-check of the script against the 2.11.0 typings (strict) | `npx tsc --noEmit -p .` | clean |
| Bundle | `node tools/bundle.mjs` | 423 KiB, two imports: `@minecraft/server`, `@minecraft/server-ui` |
| Pack validation | `python3 tools/validate/validate.py` | no problems |
| Scenario suite in a simulated world | `node test/run.mjs` | **361 of 361 checks pass** (23 groups) |
| Engine calls per tick | `node test/perf.mjs` | see DESIGN.md, "Bounded work" |
| Foot and claw contact on the shipped animation | `node tools/preview/contact.cjs` | below |
| Independent code review (a second reviewer with no access to my reasoning) | | Done once, on an early version: 20 findings, all acted on, the reviewer's four probe scripts kept as regression scenarios. **Not repeated for 1.4 to 1.6.** |

### Pack validation

Strict JSON for 170 files; 104 documents checked against Mojang's schemas (entity 1.26.60, block 1.26.60, item 1.26.50, particle 1.21.10 and others); every reference resolved: textures and their eight PBR texture sets, seven geometries (3,618 cubes: the four forms, the empty hit-volume model, the crystal and the Seam Lance), 200 animated bones, 153 locator-bound particle hooks and 135 locators (unique across the entity's geometries), 74 particle effects, 42 render passes, 57 sound events over 99 files, 14 synchronised properties used by the client, the ten hit-volume entity types, 11 blocks (textures, texture sets, sounds, names, loot tables and the items they drop, the crystal's model and its 30-pixel limit, block states of at most 16 values, custom components that the script really registers), 7 items, 7 recipes (shapeless and shaped), the Seam Lance's attachable (its geometry, texture, hold animation and binding), the Titan's two entity files (the same properties as his, every client reference one of his, health the script's own figure, a name and an egg), the fog the script pushes, 131 vanilla block and entity ids, one vanilla particle id and 32 vanilla sound ids used by the script, the 164 vanilla block ids the shockwave may break, and all 17 values of the sound ids the script builds at run time (all checked against the 1.26.60 lists), manifest UUIDs and versions, the two stable script modules, the `pbr` capability.

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
| Fallout (1.4) | 14 | his beam leaves fallout, and glowing slag in the crater; the zone spreads to more than twice its width in under a minute; the motes and the ring at its edge reach witnesses; grass turns to irradiated soil, bare rock to irradiated rock, crystals grow (few, never crowded), plants wither, wild leaves fall; the red fog is pushed; a survival player is sick at once and burns after standing in the heart of it; iodine clears it and holds it off; glowing slag burns; nothing built, no lawn against a wall, no planted hedge is touched; sand fuses to trinitite; vanilla stand-ins if the blocks are refused; the journal and the counter read it (dose, distance, direction); as it fades every glowing block goes back, **grass as grass, stone as stone, deepslate as deepslate**, the slag cools, and the zone is forgotten and the fog removed; an orphaned glowing block puts itself right on a random tick, but not while fallout there is strong; off means off |
| Calling, sending away, the rift, changing now, mid-air (1.4) | 16 | "Call him now" opens the rift at once (water for I, land for a returning II or III, who walks out of it); the camera is given to players near and taken back; "Send him away" leaves nothing and a fresh story; "Make him change now" plays the change; brought in mid-air, each form comes down to the ground and acts |
| Routes and ploughing (1.4) | 17 | walked into a pocket of walls, III and II (not destroying) plan a route and walk out and round; destroying, III climbs a gentle rise, cuts a cliff to a step, goes straight through a wood and a house, leaves the floor whole and a chest standing |
| Themes and voice (1.4) | 18 | "near" plays looped and faded in; it changes to "fighting" when he charges and back some time after; off means off; out of earshot it fades after a few seconds; it stops when he is sent away; a roar tells the client which recording began; the beam draws its aim line first and only first, then the flare, shock ring, rings and lightning |
| Basiliskra IV (1.5) | 19 | brought as IV: one of him, named, 61 hit volumes with head, body, limbs, wings and tail among them, the size he is drawn; his entrance: the thin beam, 26 blocks popping into glass, and no roar until after the last; his theme; the stare: Slowness III while he can see you and nothing after, ended by cover; he walks left foot, right foot through a 33-high wall (gone where he went, standing beside), 500 blocks of crater under his feet, the ground under his middle whole, never sinking, a chest left standing, and the same without the engine's fill; the breath at 120 blocks: charge, fire, vent, roar; the skid (1.2 to 2.5 blocks); 22 ticks or more of lifted foot before he moves; a swing of 55 to 85 degrees at a constant distance from the club; a player by the buried tail unhurt until the club is ripped free; the misfire: sound cut, thin beams drawn, ground struck behind him and none in front, nobody in front hurt; the swallow: charge sound stopped, carry, three pulses, the forced shot, and the shot at once when cover is removed; the plate: eight blocks, the bone hidden, a player under a roof seen by it and burned through it, burnt out after three; the seabed: the wave, a player hurt and swept inland, a boat shoved, two cod, no block changed; the rift out in the water when he is called back by the sea, where he stops, no roar before the glass on the beach; the change from III after three days and twelve beams, only at night; the journal for both; the last crossing's hooks present on him |
| Time is all a change waits on; the scene (1.6) | 6, 19 | the journal names time and nothing else, with the minutes left; before his time is up nothing happens; when it is up Basiliskra III changes by day with no beam fired; set to one minute, Basiliskra II changes a minute after he became II (by day, dry, having dragged himself nowhere) and III a minute after that; the camera is never further from what it looks at than it takes to hold all of him (48 blocks for the change to IV, where the old camera stood 94 off); the HUD is put away, his name is shown, and the player's own view and HUD are given back |
| The Seam Lance (1.6) | 20 | 34 to his body from seventy blocks, 51 to the head; one shot per cooldown, with the hotbar cooldown started; a shot that misses does nothing to him; a wall stops it; something else alive in the line takes a little; the bolt is drawn from the muzzle to where it struck; the recipe and the attachable are checked by the validator |
| Cities, the beach, the deep; going where people live (1.6) | 21 | raised where an operator stands, the sea the way they look; one at a time; the ground kept loaded while it is built and let go after; streets, lit towers (the tallest by the water), villagers; a promenade and a beach that shelves under the water; 102 blocks of water over a floor of abyssal basalt, lined on every side; vents, spires with lanterns, ribs, the pit and its ring, the ruin and its chest with a Seam Lance in it; nothing outside the footprint touched; never raised by itself over anything built; a build cut short by a restart is finished; on a real coast one rises by itself with its beach on the shoreline, and with the setting off none do; with nobody to hunt, Basiliskra III makes for the nearest city or the villagers he senses and walks through it |
| The Titan (1.6) | 22 | made by the manager and by a spawn egg: bound, form IV, named, 61 hit volumes, 4000 health, and his story untouched (still dormant, no Basiliskra anywhere); three is the cap and a fourth is removed with a message; none outside the Overworld; alone it prowls within 95 blocks of where it was made; two Titans roar at each other, burn each other (30 a hit), lunge (85), whip (130), charge and circle, a heavy blow staggers, their middles never come nearer than their two girths, the health bars reach watchers, and after about three minutes one falls, is removed with its hit volumes, and leaves shards, a fin and fallout; against Basiliskra IV and against III he answers with his own breath and is driven off, never killed, with the Titan above 3000; the Seam Lance does 34 to it; a blow that would kill is held back and it is gone about five seconds later; a Survival player near one is hunted; after a restart the same bodies have the same names and wounds and one set of hit volumes each; the wheel puts one down and takes them away |
| Three changes, three scenes (1.6.1) | 23 | each change is played from "Make him change now" to its end with a Creative watcher and an Adventure bystander 24 blocks off. I to II: the phases run knock, spasm, rise, evolve, then beach, arc; three gill knocks before and three horn arcs after; splash, bubbles, steam, the fin breaking and the fountain are sent; no thunder and no bolt. II to III: arc with three flinches, three thunders at shortening intervals and a fourth on the instant of the change; then grounded, at least eight plates heard lighting, scatter; glass in the ground under him. III to IV: charge, vent, scatter with the charge sound once, three vent knocks and no beam; then swallow, recoil, rise, two wing beats, smoke; his name shown 110 ticks after the change; no roar and his entrance not yet played. All three: different phase sequences, different lengths (312, 352, 448 ticks), cut into shots with the camera never more than 26, 37 and 47 blocks from what it looks at; HUD hidden and given back with the player's own view; the bystander never hurt; all of him lit at its height; II and III roar afterwards |

Counting him: the suite counts loaded and saved entities of his type after every scenario above. It is 0 before arrival and after departure and 1 otherwise, in every case. (Titans are another type and are counted separately: never more than three.)

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

### The animation reel (1.5.1)

`node tools/preview/anim.cjs` plays each form through its phases in the offline viewer, running the shipped client entity's own Molang with the properties the script would set (phase, charge, the foot that landed, the voice pulses), and lays the pack's recordings in at the same moments. It is the only place the poses have been watched in motion: `previews/basiliskra_animations.mp4`. It shows the model, the walk cycles against a tiled ground, the glow passes and the jaw against the roar; it does not show particles, the real beam, terrain, or anything the game's own renderer does differently.

### The Titan's reel (1.6)

`node tools/preview/anim.cjs --forms titan` plays the Titan's own client entity (`basiliskra_titan.entity.json`) through the phases the script sets for it. It is where its always-lit seams, the lunge, the tail whip to each side (the tail goes to the side the head is turned to, as the script assumes) and the collapse with the glow dying were watched. The blows themselves, the other giant, the shove and every particle are the script's and are not in it.

### Previews

**The previews have not been rendered again for 1.3.** They show 1.2: Form III at his old size, the narrower beam without its smoke, glow and craters, the synthesised charge and beam sounds, and no shockwave.

`previews/*.mp4` were rendered offline from replays of the real script. They are evidence of what the script decides and of how the shipped assets look and move in *my* viewer, which implements Bedrock's geometry format, Molang (the subset used), animation controllers, render controllers and particle components from their documentation. They are not evidence of how the game renders them.

## Not verified, in order of risk

**New in 1.6.1 and 1.6.2, the three change scenes** (exercised in the simulated world; **not seen in game**):

1. **They are assembled from existing poses**, timed by the script: each phase's pose was rendered offline before (the reel, and `previews/transformations.mp4` for these sequences), but how they read at cutscene distance, cut as they are, has not been watched in the game.
2. **The bolts** are the beam's particles emitted pointing straight down for three ticks from 70 blocks up, with vanilla thunder and a screen flash. Whether that reads as lightning is a guess.
3. **Form I's scene happens wherever he is when his time is up**: usually near a beach, sometimes in open water, where the low shots are close to the surface and may dip under it.
4. **The top-down shots** put the camera directly over him, up to 21 blocks above Form I and 27 above Form II; under a low roof or in a cave the camera is brought down to wherever is clear.
5. **The camera and his own body.** The camera's place is tested against blocks, not against him. Five shots of 1.6.1 measured their distance from his middle from in front or behind, which on an animal this long is inside his neck; 1.6.2 measures those from his head and stands the side shots further off (found by reading the shots against his size, not by seeing it). Other shots may still clip a limb or his crest at some moment.
6. **A fault this work found and fixed**: the server skeleton was cached across the tick in which his form changes, so anything asked of his body in that tick used the old form's bones. Nothing asked before 1.6.1; the new scenes do.

**New in 1.6** (schema-valid, exercised in the simulated world, **none of it seen in game**):

1. **The Titan as an entity.** A second entity type that reuses his client files (geometry, textures, the pose animation, the render passes of his last form) under its own identifier, with lines added after his pre-animation that keep its glow zones lit. That the game draws it, that the always-on glow passes look as intended (they were rendered offline at that level: `previews/titan_poses.png`), and what three of them cost with sixty hit volumes each, are unknown. Counted in the simulation, two Titans fighting ask about three times the block reads of Basiliskra IV alone (`test/perf.mjs`).
2. **The new poses.** The lunge, the tail whip and the collapse were rendered offline from the shipped animation (the same picture). Their timing against the script's blows (tick 9 and tick 15) was set from the pose curves, not watched. During the tail whip and the lunge his feet do not step.
3. **Giants shoving giants.** A struck giant is moved up to 11 blocks in one tick onto ground it can stand on; on clients that will be seen as a fast slide.
4. **`beforeEvents.entityHurt` cancelling a killing blow** on the Titan, and reducing a Titan's damage to him by assigning `damage`. Both are in the 2.11.0 typings; the same mechanism has kept him alive since 1.0 (owner-tested), but not for a second type.
5. **The health bars** use the action bar every half second for players within 150 blocks, which also carries the Geiger readout and the iodine message (the Titans' line gives way to a held Geiger counter).
6. **The cutscene shots.** Five `setCamera` moves with eases and a short black fade at each cut; HUD elements hidden with `setHudVisibility` and reset at the end, on leaving, and on the next spawn. Whether the cuts read as cuts, and whether every HUD element comes back on every device, has not been seen.
7. **The Seam Lance in the hand.** The attachable copies vanilla's crossbow hold offsets; where a 21-cube gun actually sits in first and third person has not been seen and may need moving. `itemUse` firing on right-click / long-press with no `use` component of its own is how the journal and wheel already work (owner-tested).
8. **City building.** Up to 40,000 blocks of `fillBlocks` volume a tick for under a minute; four `tickingarea add` commands run from script and removed after (a world that already has ten ticking areas will refuse them: the build then waits for players to be near); villagers spawned from script; a chest filled through its inventory component; water filled as source blocks 102 deep (it should stay put, lined on five sides; lighting updates under a hundred blocks of water may be slow). **Automatic placement uses `Dimension.getBiome`** to tell land from ocean; if that call is refused the seeker simply never finds a coast.
9. **Custom blocks of the deep** (abyssal basalt, seam vent, drowned lantern, old bone): same form as the 1.4 blocks, which the owner has seen load; the vent and lantern emit light.
10. **No biome.** A real custom biome was asked for; the 1.26.60 documentation still places biome definitions behind the Custom Biomes experiment, so none is shipped. If that changes, the city plan could be placed by a feature instead.
11. **Time-only changes** remove every condition that used to guarantee a watcher: he can now change with nobody there to see the scene. That is as asked.

**New in 1.5, Basiliskra IV** (the same caveat: valid against the schemas, exercised in the simulated world, never seen in game):

1. **His size.** A 55-block-tall, 90-block-long entity with a 2048 x 2048 texture, 1,464 cubes and up to twelve glow passes. Whether it is drawn at all from far enough away to see the whole of it, and what it costs on a phone, is unknown. If he is too heavy, `DRAW_SCALE["iv"]` in `tools/kit/kit.py` is the one number to lower.
2. **`Dimension.fillBlocks` with an exclude filter of about 240 ids**, on boxes of up to 6,000 blocks, a few times every fifth tick while he walks. Stable in 2.11.0; its limits are not documented. If it throws, he clears his road block by block instead (tested).
3. **The pivot.** His position is rotated about a point 69 blocks behind him at 1.4 degrees a tick: his middle moves about 1.7 blocks a tick sideways. How that interpolates on clients has not been seen; it may look like sliding.
4. **His walk on two legs** is solved in Molang like III's and rendered offline (`previews/model_iv_poses.png`), but his feet on real ground have not been seen.
5. **The poses of the set pieces** were rendered offline from the shipped animation for four of them (standing, walking, roaring, reaching); the pivot, the misfire and the swallow were checked more briefly. Arm and wing angles may need taste applied.
6. **Spawning a boat and cod** from script; **Slowness** from the stare; the **`gill` flag hiding one bone** on this form.
7. **61 hit volumes** following him, some 13 blocks wide.
8. **What was not built from the brief:** the row of spines moving under the sea before his entrance, and fish stranded *before* the wave.

**New in 1.4** (each is schema-valid and exercised in the simulated world, none has been seen in game):

1. **The "fades" block component.** Four blocks carry a custom component (`basiliskra:fades`, registered at start-up, Custom Components V2: the component's name used directly as a key in the block file). If the game refuses that form, those four blocks do not load: the script then falls back to coarse dirt for soil and makes no rock, crystals or slag. The same blocks carry a 16-value state (`basiliskra:was`) set with `BlockPermutation.resolve`.
2. **The crystal's model.** A block with its own geometry, no collision box and `alpha_test` material. Its look, and whether it is selectable and breakable as intended, have not been seen.
3. **Cutscenes.** `camera.setCamera("minecraft:free", ...)` every few ticks for up to 20 seconds, then `camera.clear()`. A player who leaves mid-scene is released on their next spawn. Whether the easing reads as smooth, and how it behaves on a phone, is unknown. "Cutscenes" in the Settings turns them off.
4. **Hearing him from 200 blocks.** Beyond 40 blocks each listener is played the sound from a point ten blocks away in his direction, with the volume scaled by distance. The fall-off curve was chosen, not heard.
5. **The jaw.** The loudness of each roar recording is measured at build time and written into the pose as a 2 KB Molang expression; voice sounds open the jaw for a set time. Verified in my Molang runtime only.
6. **New particles**: rings standing square to the beam use `direction_z` facing (documented; no vanilla particle uses it), sparks drawn inwards on a sphere, the rift's effects, and a zone-sized cloud of motes (up to about 110 particles a zone).
7. **The red fog** (`fog @s push`, a fog definition in the resource pack). Under Vibrant Visuals distance fog may be drawn differently or not at all.
8. **Music.** `Player.playMusic` with three `music`-category streamed definitions, and `music stop 3` to fade. **Nobody has listened to the themes**: they were composed and rendered by code and checked by measurement (length, level, spectrum, no clipping), not by ear.
9. **Iodine tablets** (a custom food item; the effect is applied on `itemCompleteUse`), the shaped recipe for the lamp, and the loot table that drops shards.
10. **Cost.** Ploughing clears up to 170 blocks every few ticks ahead of him; a healing fallout zone queries a 16 x 29 x 16 volume a tick. Counted in the simulation (`test/perf.mjs`), not timed on a device. Up to 33 hit-volume entities follow him.

**From 1.3 and before:**

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

## First session checklist (1.6.2)

Set **Minutes in each form** to 1 and `/basiliskra:spawn i` in deep water near a beach; watch all three changes in turn (or use **Make him change now**). For each: is he in the picture in every shot; do the cuts fall where something happens (a knock, a bolt, the wings); does the HUD come back; and for II to III, do the bolts look like bolts?

## First session checklist (1.6)

On a *copy* of a world, with the content log on, in Creative as an operator. Look first for any error naming `basiliskra:titan`, `seam_lance`, or one of the four new blocks. Then: **the config wheel → Put a Titan here**, walk a hundred blocks, and put down another: do they draw (glowing all over), roar, breathe at each other, close and fight; do the bars show; does one fall and vanish? Shoot one with the **Seam Lance** (`/give @s basiliskra:seam_lance`): where does the gun sit in your hand, does the bolt draw, does its health drop? **Raise a city here** on a shore, looking out to sea: does it finish, is the water still, are there people, can you walk down the beach into the deep? `/basiliskra:spawn ii`, set **Minutes in each form** to 1, and watch the change: is he in the picture in all five shots, and does your HUD come back? With him as III and nobody in Survival, does he make for the city?

## First session checklist (1.5)

On a *copy* of a world, with the content log on: **Bring him here** as IV on open ground and watch his entrance (the thin line, the glass, the roar). Does he draw at his full size, and from how far? Let him walk at a hill and a village. Stand 100 blocks off and let him fire: watch for the skid, the lifted foot, the swing; try the place by his tail. Wait for a shot that fails and stand in front of him. Hide behind a hill while he charges. Bring him to a beach. Check the frame rate while he walks.

## First session checklist (1.4)

Import on 1.26.60 with the content log on, and look for any error naming basiliskra (especially a block that "failed to load", which would be item 1 above). Then, with the config wheel: **Call him now** at a coast (the rift, the camera, Basiliskra I); **Bring him here** as III on land (does he stand on the ground and move?); hit his head, a foot and the tip of his tail; walk away 150 blocks and listen; let him fire (the aim line, the rings, the crater, glowing slag in it); watch the fallout spread for a minute, walk into it (red air, clicks, sickness), eat iodine, break a crystal, then wait five minutes and see whether the ground goes back; **Make him change now** twice (the scenes); **Send him away**, then **Call him now** again (Basiliskra I, through a rift). Listen for the three themes.

## First session checklist (1.3)

Import on 1.26.60 → content log on → look for any error naming basiliskra. Spawn Form III (`/basiliskra:spawn iii`) and: hit a foot while he walks; watch a beam from the side (charge, the eye locking, seven seconds of fire, the crater, the roar after); stand near a roar; give him a cow; let him walk at a house; open the settings on the phone. Then, as before: Use the journal; then, on a *copy* of the world: the config wheel's **Call him** at a coast and **Skip to dusk**, and watch one arrival; **Bring him here** as I, II and III (or `/basiliskra:spawn i|ii|iii`) to see each form; look at each form from far away, at the screen edge, and under Vibrant Visuals; hit head and tail; stand behind cover during a beam; put a rod by the club; finish the ending; reload the world at each stage; then try the spawn egg twice and a structure-block copy, and count: there should only ever be one.

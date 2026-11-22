# Basiliskra: how it is built

Target: retail Minecraft Bedrock **1.26.60**, stable `@minecraft/server` **2.11.0**, no experiments, no Beta APIs.
Player-facing instructions are in [SURVIVAL_GUIDE.md](SURVIVAL_GUIDE.md); what was and was not verified is in [TEST_REPORT.md](TEST_REPORT.md).

## One animal

There is one entity type, `basiliskra:basiliskra`, and at most one instance per save. Basiliskra I, II and III are the same entity: a synchronised property (`basiliskra:form`) selects geometry, texture, animation, movement and collision, and it changes in place.

The script owns a single world record (a world dynamic property, chunked JSON, schema-versioned and migrated on load):

| Field | Purpose |
|---|---|
| `stage` | `dormant → pending → arriving → alive → departed` (an explicit call can set `alive` from any stage) |
| `token`, `entityId` | his identity: a random token also written on the entity, and the engine's persistent entity id |
| `pending`, `arrival`, `evolve`, `ending` | every multi-step sequence, with its step, so each can be resumed |
| `form`, `health`, `rift`, `beach`, `last` | the stage of his life, where the seam is, where he was last seen |
| `home` | where he was last brought on purpose (egg, command, wheel): he wanders round it with nobody near, and comes back to it after being sent away |
| `mut`, `learned`, `sites` | mutation progress, what he has learned, bounded kill-site history |
| `clock` | the pack's own saved tick count; every stored time is measured on it, never on the engine's per-session tick |

Rules that keep it to one:

* **Reserve, then create.** The record is saved as "arriving, token X, no entity yet" before anything is spawned. Two functions can spawn him: `create()` for the story, and `bringHere()` for an explicit call; both write the record first and adopt the body in the same tick.
* **Reconcile before creating.** After a restart, an entity carrying the saved token is adopted; a reservation with no entity is completed once. Creation is never retried while an entity id is on record.
* **Unloaded is not gone.** An empty entity query means nothing. He is only presumed lost if every chunk round his last position is loaded and watched for a full minute.
* **A call on purpose brings the one.** A body with no token at all can only come from the spawn egg, `/summon` or `/basiliskra:spawn`. That is read as "bring him here": if he is loaded he is moved there and the new body is removed; if not, the record is rewritten to name the new body (same token, his form and health) before anything else, and the old body is removed whenever its chunk loads. Outside the Overworld, or with the setting off, the body is simply removed.
* **Everything else is removed.** A structure-block copy (his token, a different id), or any body the record does not name: unbound and removed in the tick it loads, in every dimension, before it can act. A second line of defence is in the entity file: without the script's `bound` property the entity despawns itself after two seconds. Natural spawning is off (there are no spawn rules); the spawn egg exists only for the calls above.
* **Evolution writes the record first**, then brings the entity into line; a reload between the two writes is detected and finished.
* **Departure ends the story.** After `departed` nothing in the world calls another and the old token is not honoured. Only an explicit call (egg, command, the wheel) brings him back.

## What stable Bedrock does not give, and what stands in

| Wanted | Stable-API reality | What the add-on does |
|---|---|---|
| A 30 to 70 block animal that walks and swims | Vanilla physics, collision and pathfinding do not work at this size | The entity has no gravity or collision. The script moves it each tick: limited turn rate, lower-median-of-nine ground settle, never more than 0.45 up or 0.9 down per tick, steering round built walls and cliff faces, a depth limit in water, a swim lane check. Motion is sent as velocity so clients interpolate; teleport is only a recovery. |
| A hitbox the shape of the body | One axis-aligned box per entity | Invisible hit-volume entities are kept on the skeleton from snout to tail tip: 25, 33 and 29 of them for I, II and III. They are **generated from the model**: the kit exports each bone's solid boxes (`boxes` in the rig), and `partsFor()` tiles them with cubes of ten fixed sizes (1.5 to 13 blocks), biggest parts first, skipping what is already covered. There is one entity type per size (`basiliskra:hitbox_0` .. `_9`), so the box a client aims at is the box the server has. A hit on any of them is forwarded to him (head hits count more, tail hits less, one blast counts once). Form III's leg volumes are carried through the walk cycle as the client solves it. If a swing plainly passes through him but the game reports no hit (`playerSwingStart` with no damage event), a ray from the player's eyes is tested against the volumes and the hit is counted. |
| A bigger animal without new models | Geometry is in model units | The client entity's `scale` is a Molang expression of the form property (II 1.25, III 1.7); the server rig multiplies every model-space point by the same number (`SCALE` in `generated/rig.ts`), and the movement constants, stride, window stand-off and visible bounds are scaled with it. The walk cycle is solved in model units and driven by world distance, so planted feet still do not slide. |
| Client state machine that late joiners agree on | Animation controller state is per client | The pose is a pure function of synchronised properties (form, phase, charge, look angles, bend, gait, gill, veil). There is no client state to disagree about: a player who joins mid-charge sees the same lit zones. Only particle emitters use controller states. |
| The server knowing where his mouth, feet and club are | No bone queries server-side | The model kit writes the same skeleton it built the geometry from into the script (`src/generated/rig.ts`); the server poses it with the same numbers the client animation uses. Beam origin, footfall positions, hit volumes and the window stand-off all come from it. |
| A body that slips through a seam | No clipping planes | Nine zones from tail to head; two synchronised properties (`vis_lo`, `vis_hi`) hide the zones that have not yet come through, or have already gone. |
| A beam | No beam primitive | The server ray-casts, measures the length, and sends stretched, camera-turning billboards with that length (white core, scarlet body, wide glow), particles thrown along it that come to rest at random points of it by drag (smoke, embers), a scarlet spiral, and impact particles. Damage is tested against the same segment and needs a clear line to the player. |
| A beam timed to its recording | A played sound cannot be followed by script | The supplied recording is cut at the moment it fires (6.86 s): the charge phase lasts exactly 137 ticks from the charge sound, the fire phase starts on the tick of the second sound and lasts the 155 ticks of the shot. A charge that is grounded or cut off stops its sound (`stopsound`). |
| Destroying like the Wither | Explosions cannot spare chests, and are stopped by blast resistance | `src/havoc.ts`: the beam blows a sphere of blocks out where it lands, every fourth tick, nearest first and within a block budget, to a crater at most six blocks deep before it moves on with his aim, lights fires on the crater's edge and sears its floor (rock to glowing slag, sand to trinitite). **Walking, Basiliskra III ploughs**: a probe ahead of his shoulders finds anything in the way and a slab his own width is cleared, from the ground up for what is built or grown, and only from stepping height up for the world's own rock (so a slope is climbed, a cliff is cut to a step, and he never bores down into the ground or sinks in water). Bedrock, portals and command blocks are never broken; storage is spared by default. |
| Finding a way round | Vanilla pathfinding does not work at this size | `src/path.ts`: when he has been stopped for a while (and is not ploughing), a coarse-grid A* search runs over his surroundings, a few cells a tick. A cell is passable only if every column under his body (radius plus a margin) is free of built blocks at shoulder height, there is no cliff face, and the line from the last cell is clear. He then walks the way-points. Each column is read once per search. Used by all three forms (swimming too). |
| A way to be heard far off | A sound's range is its `max_distance`, and distant sounds are simply silent | `fx.loud()`: beyond 40 blocks each listener is played the sound from a point ten blocks away in his direction, the volume scaled by distance, out to 220 blocks. |
| A jaw that moves with a recording | The client cannot read a sound's level | `gen_client.py` measures the loudness of each roar recording every tenth of a second at build time, reduces it to a few straight lines, and writes it into the pose as a function of the time since the roar began; the same table (`ROAR_ENV`) drives the screen shake on the server. Voice sounds open the jaw for a fixed time per kind. The script only announces "this voice started now" (two synchronised properties). |
| A cutscene | No cinematics API on the stable path beyond the camera | `src/scene.ts`: `camera.setCamera("minecraft:free")` on everyone within range, moved along an orbit round a focus every few ticks with a short ease, then cleared. Used for the rift, the arrival and each change. A player who leaves mid-scene is released when they next spawn. |
| Music that follows what he does | No adaptive music | `src/music.ts`: once a second a theme is chosen from what his brain is doing (near / fighting / a once-only moment) and played to each player in range with `playMusic` (looped, faded); it is faded out with `music stop` a few seconds after its reason is gone. |
| A roar's shockwave | No shockwave primitive | `src/roar.ts`: one engine-side query (`getBlocks` with a type filter, 164 vanilla ids checked against 1.26.60) lists what is brittle within reach; a ring then runs out at two blocks a tick, breaking each as it is reached and throwing and hurting each player and creature once. If the engine refused the query the ring is sampled instead. Camera shake is `camerashake`, falling off linearly with distance. |
| Body lighting up | No dynamic lights | Extra render passes on the same geometry with the vanilla bioluminescent material, one per zone, alpha driven by the charge. Under Vibrant Visuals the glow texture set is emissive as well. |
| Lamps flaring | Changing block states would touch player redstone | A flare particle on each lamp, nearest first. No block or wire is changed. |
| Silencing a bell | A played sound cannot be cancelled | The first three rings startle him; after that he knows which bell it is, drags himself to it and rests a claw on the frame, watching the nearest door. The vanilla ring still sounds (it cannot be suppressed), but while the claw is on it a choked, deadened ring is played over it at the bell and he does not react. A second sound source (another bell, a note block) draws the claw away. The bell block is never changed. |
| Lightning between spikes | Real lightning burns and transforms | Scarlet particle arcs only. |
| Hearing a note block | No note event | A hand on a note block is an interaction event; a redstone-clocked one is found by a rolling scan near the seam and watched for rising power. |
| Knowing a body of water is deep and clear | No region queries on the stable path he can rely on | Every block of the lane is read, a few hundred per tick, only in loaded chunks. |

## Fallout

`src/fallout.ts`. A zone is `{x, y, z, r, m, s, t, h}` in the world record (at most 32; a deposit near a zone's heart feeds it; the weakest goes first). Sources: each beam impact (tier radius 3, 4 or 5, plus one when destroying), ridge-scatter hits, a grounded charge, each transformation, each rift.

**Life of a zone** (in ticks since it was last fed; closed-form, so nothing is stored but the numbers above):

* its **radius** runs from `r` to `m` (2.4 times what it was left with, 24 at most) over 50 seconds, fast at first;
* its **strength** stays at `s` for 45% of its life, then falls to nothing; its life is 2.5 minutes for a trace up to 5.5 minutes for a full beam;
* from 72% of its life it is **healing**: nothing more is changed, and its ground is swept once, a 16 x 29 x 16 tile a pass (`getBlocks` with a type filter), every glowing block found being put back, 24 a tick;
* when its life is over and the sweep is done it is forgotten.

| Each tick, near players only | |
|---|---|
| Land (mode "land") | 10 columns, spread over the zones in turn, more likely the stronger the dose. Soil, sand, gravel to `irradiated_soil`; bare rock to `irradiated_rock`; each **remembers what it was** in a block state (`basiliskra:was`, 0..15, tables generated into `src/generated/blocks.ts`). Plants withered; natural leaves dropped; snow melted. On ground already his, a `crimson_crystal` grows in about one column in thirteen (chosen by position, so they never crowd). Never where anything built touches. Zones in water skip this. |
| Air, every 8 ticks | one zone-sized cloud of motes per zone (`variable.size` is its radius), a ring of sparks at its edge while it spreads |
| Every 10 ticks | dose per player (sum over zones), Geiger click level 1 to 4, the red fog pushed above 0.3 and removed below 0.2, the counter's action bar, glowing slag underfoot |
| Every 40 ticks | sickness: hunger above 0.1, weakness and nausea above 0.3, poison above 0.5; above 0.8, after about eight seconds of exposure, direct damage. Iodine (a dynamic property on the player) stops all of it for four minutes. Creatures in strong zones are slowed, weakened and, near the heart, withered. |

**Blocks.** `irradiated_soil`, `irradiated_rock`, `crimson_crystal` and `glowing_slag` carry the custom component `basiliskra:fades` (registered at start-up): on a random tick, with no un-healed zone around it (or fallout switched off), the block puts itself back. That is what cleans up after a zone that ended with nobody near. `scarlet_trinitite`, `cooled_slag` and `shard_lamp` are plain blocks and stay. If the game refuses a custom block the script uses coarse dirt and smooth basalt for soil and trinitite and makes none of the others. Measured cost: about 110 block reads a tick at the 32-zone cap.

## Basiliskra IV

`src/forms/four.ts`. His brain **extends Basiliskra III's** (`BrainFour extends BrainThree`): the walk, the ordinary charge, the lightning rod, the vent and the last crossing are inherited, so the ending works for him unchanged; what he chooses to do, his feet, his roar's reach and the acts below are his own. The beam's per-tick work (ray, picture, crater, fallout, burns) is shared by both in `src/beam.ts`.

| | How it is done |
|---|---|
| His size | One more geometry on the same entity (`form` 4, client `scale` 2.0). `tools/kit/gen_client.py` writes his pose: a two-legged walk solved like III's (the server names the foot that landed, the cycle advances with the ground covered, the knee is solved so a planted sole does not slide), wings that fold by fixed angles (`WING_FOLD`, the same numbers on the server skeleton), and a weight per set-piece phase. |
| Hit volumes | Generated like the others, tiled more loosely, and without the wing finger bones (a block thick and forty long: two hundred volumes between them): 61 in all. |
| The plough | `havoc.ploughBox`: the slab ahead of him (his width, 56 high, 7 deep) is emptied with `Dimension.fillBlocks` and a block filter, a few calls every fifth tick. The filter can only name block *ids*, so the ids to spare are generated from the script's own patterns and Mojang's block list (`tools/kit/gen_ids.py` -> `src/generated/ids.ts`: 36 never broken, 106 storage, 92 natural ground). Natural ground is kept below stepping height, as for III. If the engine refuses the call he falls back to III's block-by-block clearing. |
| Footfalls | Each landing: a blast (hurt and thrown within 8 blocks) and, in destroy mode and not afloat, a carved sphere of radius 3.4 under the foot. His feet are 8.5 blocks either side of his line, so the ground under his middle is untouched and he does not sink. |
| The stare | An act of about eight seconds: his head follows one player, and every half second while a clear line runs from his nose to their head they are given Slowness III for 2.5 s. Three failed looks end it. |
| 1 The entrance | `debut()`: until it has played (`rec.four.debut`) it is the only thing he will do. A thin beam (drawn, harmless) is walked along 26 ground columns toward the nearest watcher; 60 ticks; each column is turned to trinitite (`fallout.glassify`, natural ground only) three ticks apart, far end first; then the whole roar. Reset on every arrival through a rift. Called back with water near, the rift is put out in the water along the line from the caller, far enough that he stops at the water's edge. |
| 2 The pivot | Inside `fire()`, on the recording's clock: ticks 30-55 he is moved back 0.07 a tick (phase `skid`); at 55 the club's place is taken as the pivot, phase `pivot`, and `bendHold` is set to 30 toward the side the quarry is on (the client lifts that foot); from 79 to 129 his position is rotated about the pivot 1.4 degrees a tick and his yaw with it; at 129 a blast at the pivot. |
| 3 The misfire | 22% of shots after the first, never twice running. The charge sound is stopped; phase `recoil` (the client opens the wings); for 64 ticks each of the eight `wing_vein_*` locators throws the thin beam down and backward, fanned outward. Nothing points forward. |
| 4 The seabed | Offered when the block at his knees is water and a hunted player stands on something that is not, 24 to 90 blocks off. He turns to them, phase `drag` (the client reaches for 2.5 s, holds, hauls at 4.2 s), then a line of particles 35 wide advances 1.3 blocks a tick up the ground's own height; each entity it passes is knocked along it once (players hurt, boats given an impulse); a boat (if none was caught) and two cod are spawned where it stops. No block is changed. |
| 5 The plate | On his third charge `shedPlate()` hides the `plate_break` bone (the `gill` flag, unused by this form) and builds eight blocks of trinitite 15 blocks to his left and 9 behind. `plateSees()` asks for a clear line mouth-to-plate and plate-to-player when the mouth itself has none; `plateShot()` draws one beam into the plate and fires a second, real one from its tip along the line fixed at that moment. Three uses, then the blocks become cooled slag. |
| 6 The swallow | While his eye still follows (before the lock), four looks in a row with no clear line to a player end the charge: phase `swallow`, then `carry` (he walks, ploughing, toward where he last saw them; the client lights `ribs_l` on its own glow pass). One neck pulse (`fx_kind` 11) every 100 ticks. A clear line fires at once (`snapShot`, the muzzle laid in the firing pose); the third pulse fires with no aim. |

He becomes IV from III's `choose()`: three days in form and twelve beams, at night, with anyone within 140 blocks; the change itself is the same scene as the others.

## Out of control (Form III)

* **Quarry**: players first (the one he remembers, else the nearest), then any creature with the `mob` family within 72 blocks (looked up every two seconds), unless `huntMobs` is off. A new quarry gets a roar first.
* **The beam**: at players or creatures between 14 and the tier's range from his mouth, with line of sight. Tier 1 wanders; tiers 2 and 3 follow at 0.22 and 0.3 degrees a tick, slower than a player walking sideways at the range he fires from.
* **Footfalls** hurt and throw whatever is within 3.7 blocks of the landing foot; walking, he treads on players inside his volumes.
* **Ploughing** (destroy mode): see "Destroying like the Wither" above; he does not go round what he can walk through, so the route planner is only used in the gentler modes.
* **Voice**: every 10 to 22 seconds, in the phases where he is not roaring, charging, knocking or at a window, a grunt, huff or growl cut from the supplied voice recording (pitched down through water, up as II).
* **Random roars**: a chance every one to three minutes, with anyone (Creative included) within 110 blocks.
* **Roaming**: round the nearest player of any game mode but Spectator (he hunts only Survival and Adventure players); with nobody within 110 blocks, round `home`, else the coast that called him, else the seam. (Before 1.3.1 a Creative player did not count, and the home was the first place he was ever brought, which is why a spawned Basiliskra III kept walking off to the water by his old seam.)

## Players' tools

* **Journal** (`basiliskra:journal`, `/basiliskra:journal`): a server-ui form built from the record and a read-only copy of the harm history (`harm.angerNear`, `harm.angriest`), so reading it never creates or evicts a region. Each region also keeps plain counts (animals killed, habitat blocks cut) beside its weighted, fading score, and each player a running total, so the journal shows counts as counts. "Near you" is the angriest of the nine regions round the player.
* **Config wheel** (`basiliskra:config_wheel`, `/basiliskra:config`): operators only. Settings are one world dynamic property (`bk:cfg`) applied over the defaults in `config.ts` at load; unknown or out-of-range values are ignored. From 1.3 only values that differ from the defaults are saved (with `v: 2`); a 1.2 save that carries the old default terrain mode is read as "never chosen". Numbers are dropdowns of presets plus a text box (no sliders).
* **Commands** are registered at start-up with the stable custom-command registry (`cheatsRequired: false`); callbacks only schedule work (`system.run`), as the API requires.
* Forms that cannot open yet (chat still open) are retried for a few seconds.

## Where things are

```
packs/BP/                 behaviour pack: entities, item, manifest, scripts/main.js (bundled)
packs/RP/                 resource pack: geometry, textures + texture sets, client entity, animations,
                          animation controllers, render controllers, particles, sounds
models/*.bbmodel          the editable Blockbench models (I to III with animations; IV modelled, not yet in the game)
src/                      the script, in TypeScript
  controller.ts           lifecycle: the record, arrival, evolution, absence, drive-off, retirement
  creature.ts             the loaded animal: movement, skeleton, hit volumes
  forms/one|two|three.ts  the encounters of each stage, written as generators with one exit
  forms/four.ts           Basiliskra IV: the stare and his six set pieces, on top of three.ts
  beam.ts                 one tick of the breath, shared by III and IV
  ending.ts               the last crossing
  havoc.ts                what he breaks: craters, ploughing, the shockwave's brittle blocks, blasts
  path.ts                 the route planner (coarse-grid A*)
  roar.ts                 screen shake and the shockwave
  rift.ts, scene.ts       the rift as seen and heard; the cutscene camera
  fallout.ts              zones, the land, sickness, iodine, the fading blocks
  music.ts                which of his themes plays
  harm.ts                 regional harm tracking
  store.ts, world.ts, fx.ts, rig.ts, brain.ts, vec.ts, config.ts
tools/kit/                model kit: design files per form, texture painter, client-file and particle generators
tools/kit/gen_blocks.py   the fallout's blocks and items, the crystal's model, recipes, the fog
tools/kit/gen_hitbox.py   the ten hit-volume entity types
tools/kit/gen_ids.py      vanilla block ids to spare, from the script's own patterns (for the engine's fill)
tools/preview/pose_eval.mjs  the shipped pose evaluated for given properties (to render any phase of any form)
tools/sound/synth.py      every synthesised sound, and the cuts of the three supplied recordings (tools/sound/source/)
tools/music/compose.py    his three themes, rendered from a written score by modelled instruments
tools/validate/           pack validator (Mojang's published schemas + reference integrity)
tools/preview/            offline viewer and encounter replays (reference renders, not the game)
tools/build.py            type-check, bundle, validate, test, package the .mcaddon
test/                     simulated world, scenario suite, replay recorder, work counter
```

## Bounded work

Counted in the simulated world as calls into the engine per tick (`node test/perf.mjs`):

| Situation | block reads, average | worst tick | entity queries, average |
|---|---|---|---|
| Dormant world | 0 | 1 | 0.3 |
| Searching for water | 5 | 265 | 0.32 |
| Arrival | 29 | 920 | 0.33 |
| Form I | 35 to 43 | 64 | 0.3 |
| Form II in a village | 55 | 631 | 0.3 |
| Form III in a village, fighting (beams, craters, pursuit) | 179 | 609 | 0.51 |
| Form III at the window | 134 | 1411 | 0.33 |
| The last crossing being called | 199 | 557 | 0.35 |
| Six strong fallout zones round a player | 99 | 169 | 0.4 |
| Fallout at its cap of 32 zones | 112 | 200 | 0.4 |
| Form IV in a village (breath, craters, ploughing) | 142 | 862 | 1.02 |

(The worst tick at the window is one route search starting: every column under his body is read once.)

No world-wide scans, no chunk loading, no recurring chat. Harm history is capped at 40 regions and 24 kill sites. Particles are sent per witness with a budget of 96 packets a tick. Sounds and particles go only to players within range of the event.

These are counts from a simulation, not frame times from a device.

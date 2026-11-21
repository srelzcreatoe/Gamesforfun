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
| A 30 to 46 block animal that walks and swims | Vanilla physics, collision and pathfinding do not work at this size | The entity has no gravity or collision. The script moves it each tick: limited turn rate, lower-median-of-nine ground settle, never more than 0.45 up or 0.9 down per tick, steering round built walls and cliff faces, a depth limit in water, a swim lane check. Motion is sent as velocity so clients interpolate; teleport is only a recovery. |
| A hitbox the shape of the body | One axis-aligned box per entity | 8, 12 or 18 small invisible `basiliskra:hitbox` entities are kept on the skeleton from head to tail; a hit on any of them is forwarded to him (head hits count more, tail hits less, one blast counts once). Players inside a volume are pushed out. The main entity also carries a large trunk box. |
| Client state machine that late joiners agree on | Animation controller state is per client | The pose is a pure function of synchronised properties (form, phase, charge, look angles, bend, gait, gill, veil). There is no client state to disagree about: a player who joins mid-charge sees the same lit zones. Only particle emitters use controller states. |
| The server knowing where his mouth, feet and club are | No bone queries server-side | The model kit writes the same skeleton it built the geometry from into the script (`src/generated/rig.ts`); the server poses it with the same numbers the client animation uses. Beam origin, footfall positions, hit volumes and the window stand-off all come from it. |
| A body that slips through a seam | No clipping planes | Nine zones from tail to head; two synchronised properties (`vis_lo`, `vis_hi`) hide the zones that have not yet come through, or have already gone. |
| A beam | No beam primitive | The server ray-casts, measures the length, and sends one stretched, camera-turning billboard per tick with that length, plus a scarlet spiral and impact particles. Damage is tested against the same segment and needs a clear line to the player. |
| Body lighting up | No dynamic lights | Extra render passes on the same geometry with the vanilla bioluminescent material, one per zone, alpha driven by the charge. Under Vibrant Visuals the glow texture set is emissive as well. |
| Lamps flaring | Changing block states would touch player redstone | A flare particle on each lamp, nearest first. No block or wire is changed. |
| Silencing a bell | A played sound cannot be cancelled | The first three rings startle him; after that he knows which bell it is, drags himself to it and rests a claw on the frame, watching the nearest door. The vanilla ring still sounds (it cannot be suppressed), but while the claw is on it a choked, deadened ring is played over it at the bell and he does not react. A second sound source (another bell, a note block) draws the claw away. The bell block is never changed. |
| Lightning between spikes | Real lightning burns and transforms | Scarlet particle arcs only. |
| Hearing a note block | No note event | A hand on a note block is an interaction event; a redstone-clocked one is found by a rolling scan near the seam and watched for rising power. |
| Knowing a body of water is deep and clear | No region queries on the stable path he can rely on | Every block of the lane is read, a few hundred per tick, only in loaded chunks. |

## Fallout

`src/fallout.ts`. A zone is `{x, y, z, r, s, t}` in the world record (at most 32; nearby zones merge; the weakest goes first), with strength halving every three days at pacing 1. Sources: each beam impact (tier radius 3, 4 or 5), ridge-scatter hits, a grounded charge, each transformation, the seam opening.

| Each tick, near players only | |
|---|---|
| Land (mode "land") | 6 columns, spread over the zones in turn. Grass/dirt/podzol/mycelium/moss/coarse dirt to `basiliskra:irradiated_soil` (only open to the sky above, nothing built beside it); plants withered; natural leaves (no `persistent_bit`) dropped; snow layers melted. Below a fifth of full strength the zone heals instead: soil back to dirt. Zones in water skip this. |
| Air, every 3 ticks | a mote per zone (more likely the stronger it is), shimmer over strong ones |
| Every 10 ticks | dose per player (sum over zones, strongest at the centre), Geiger click level 1 to 4 played to that player alone, the counter's action bar |
| Every 40 ticks | sickness: hunger above 0.15, weakness and nausea above 0.45, poison above 0.8; slowness and weakness on mobs in zones above 0.35 |

Sand at the beam's own impact fuses into `basiliskra:scarlet_trinitite`. Both blocks are plain 1.26.60 data-driven blocks (schema-checked); if the game ever refuses one, the script uses a vanilla block in its place (coarse dirt, smooth basalt) and carries on. Measured cost: about 75 block reads a tick at the 32-zone cap.

## Players' tools

* **Journal** (`basiliskra:journal`, `/basiliskra:journal`): a server-ui form built from the record and a read-only copy of the harm history (`harm.angerAt`, `harm.angriest`), so reading it never creates or evicts a region.
* **Config wheel** (`basiliskra:config_wheel`, `/basiliskra:config`): operators only. Settings are one world dynamic property (`bk:cfg`) applied over the defaults in `config.ts` at load; unknown or out-of-range values are ignored.
* **Commands** are registered at start-up with the stable custom-command registry (`cheatsRequired: false`); callbacks only schedule work (`system.run`), as the API requires.
* Forms that cannot open yet (chat still open) are retried for a few seconds.

## Where things are

```
packs/BP/                 behaviour pack: entities, item, manifest, scripts/main.js (bundled)
packs/RP/                 resource pack: geometry, textures + texture sets, client entity, animations,
                          animation controllers, render controllers, particles, sounds
models/*.bbmodel          the three editable Blockbench models (textures and animations embedded)
src/                      the script, in TypeScript
  controller.ts           lifecycle: the record, arrival, evolution, absence, drive-off, retirement
  creature.ts             the loaded animal: movement, skeleton, hit volumes
  forms/one|two|three.ts  the encounters of each stage, written as generators with one exit
  ending.ts               the last crossing
  harm.ts                 regional harm tracking
  store.ts, world.ts, fx.ts, rig.ts, brain.ts, vec.ts, config.ts
tools/kit/                model kit: design files per form, texture painter, client-file and particle generators
tools/sound/synth.py      every sound, synthesised (no samples)
tools/validate/           pack validator (Mojang's published schemas + reference integrity)
tools/preview/            offline viewer and encounter replays (reference renders, not the game)
tools/build.py            type-check, bundle, validate, test, package the .mcaddon
test/                     simulated world, scenario suite, replay recorder, work counter
```

## Bounded work

Counted in the simulated world as calls into the engine per tick (`node test/perf.mjs`):

| Situation | block reads, average | worst tick | entity queries, average |
|---|---|---|---|
| Dormant world | 0 | 0 | 0.3 |
| Searching for water | 5 | 265 | 0.3 |
| Arrival | 27 | 667 | 0.3 |
| Form I | 35 to 43 | 63 | 0.3 |
| Form II in a village | 44 | 631 | 0.3 |
| Form III in a village, fighting | 90 | 414 | 0.3 |
| Form III at the window | 91 | 249 | 0.3 |
| The last crossing being called | 210 | 757 | 0.3 |

No world-wide scans, no chunk loading, no recurring chat. Harm history is capped at 40 regions and 24 kill sites. Particles are sent per witness with a budget of 96 packets a tick. Sounds and particles go only to players within range of the event.

These are counts from a simulation, not frame times from a device.

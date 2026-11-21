# Basiliskra: how it is built

Target: retail Minecraft Bedrock **1.26.60**, stable `@minecraft/server` **2.11.0**, no experiments, no Beta APIs.
Player-facing instructions are in [SURVIVAL_GUIDE.md](SURVIVAL_GUIDE.md); what was and was not verified is in [TEST_REPORT.md](TEST_REPORT.md).

## One animal

There is one entity type, `basiliskra:basiliskra`, and at most one instance per save. Basiliskra I, II and III are the same entity: a synchronised property (`basiliskra:form`) selects geometry, texture, animation, movement and collision, and it changes in place.

The script owns a single world record (a world dynamic property, chunked JSON, schema-versioned and migrated on load):

| Field | Purpose |
|---|---|
| `stage` | `dormant → pending → arriving → alive → departed` |
| `token`, `entityId` | his identity: a random token also written on the entity, and the engine's persistent entity id |
| `pending`, `arrival`, `evolve`, `ending` | every multi-step sequence, with its step, so each can be resumed |
| `form`, `health`, `rift`, `beach`, `last` | the stage of his life, where the seam is, where he was last seen |
| `mut`, `learned`, `sites` | mutation progress, what he has learned, bounded kill-site history |
| `clock` | the pack's own saved tick count; every stored time is measured on it, never on the engine's per-session tick |

Rules that keep it to one:

* **Reserve, then create.** The record is saved as "arriving, token X, no entity yet" before anything is spawned. There is exactly one function that spawns him.
* **Reconcile before creating.** After a restart, an entity carrying the saved token is adopted; a reservation with no entity is completed once. Creation is never retried while an entity id is on record.
* **Unloaded is not gone.** An empty entity query means nothing. He is only presumed lost if every chunk round his last position is loaded and watched for a full minute.
* **Everything else is removed.** A stray summon, a structure-block copy (same token, different id), anything after `departed`: unbound and removed in the tick it loads, in every dimension, before it can act. A second line of defence is in the entity file: without the script's `bound` property the entity despawns itself after two seconds. Natural spawning is off and there is no spawn egg.
* **Evolution writes the record first**, then brings the entity into line; a reload between the two writes is detected and finished.
* **Departure is the only end.** `departed` is terminal: nothing calls another, and the old token is not honoured.

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
| Form III in a village, fighting | 98 | 414 | 0.3 |
| Form III at the window | 108 | 249 | 0.3 |
| The last crossing being called | 209 | 757 | 0.3 |

No world-wide scans, no chunk loading, no recurring chat. Harm history is capped at 40 regions and 24 kill sites. Particles are sent per witness with a budget of 96 packets a tick. Sounds and particles go only to players within range of the event.

These are counts from a simulation, not frame times from a device.

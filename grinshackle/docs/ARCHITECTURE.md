# Grinshackle — The Chainbound Dweller: architecture contract (v2.0.0)

> Implementation notes (what changed while building against this contract): a fourth controller `controller.animation.gs.track` drives the
> head-tracking overlay; the pose controller's `stalk`/`walk`/`run`/`crawl` states are split into moving and `_still` sub-states with real blend
> transitions; motion groups gained `hunt_slow`/`crawl_slow` for `speedScale < 0.9`; the creature carries a large engine health pool while the
> script tracks the configurable 80-point pool so the collapse clip can play in full; attack reach was tightened to the visual claw reach
> (start 1.7/1.6/1.8, hit 1.8/1.7/1.95 blocks); join protection is 20 s and death protection 60 s.

This document is the binding contract for every file in the add-on. Implementers must use exactly the identifiers,
property names, event names, state names, timings and module exports listed here. If something is missing, add it to
your module's own exports but do NOT rename anything listed here.

## 0. Non-negotiables (from the brief)
* Non-experimental. Stable `@minecraft/server` **2.0.0** and `@minecraft/server-ui` **2.0.0** only. Every API used must exist in
  `/tmp/.../apicheck/node_modules/@minecraft/server/index.d.ts` (2.0.0). No beta APIs, no `Player.isOp`, no
  `commandPermissionLevel`, no light-level queries, no `camera`, no custom UI JSON. Entity JSON `format_version` `"1.21.90"`.
* Plain ES modules (`.js`), no bundler, no TypeScript syntax. Files live in `Grinshackle_BP/scripts/`. `main.js` is the
  only entry; other modules are imported with relative paths and `.js` extensions.
* Every world mutation / entity call that can throw (unloaded chunk, invalid entity) is wrapped in `try/catch` via the
  helpers in `util.js`. Never let an exception escape the tick loop.
* All timers are game ticks (20/s). All delayed callbacks are scheduled through `timers.js` so master-OFF can cancel them,
  and every callback re-checks the gates (`gates.js`) when it fires.
* Bounded everything: markers ≤ 12, waypoints ≤ 2 live, noise events ≤ 32, movement samples ≤ 64, memory points ≤ 6,
  profile size ≤ 2 KB JSON, queued timers ≤ 64, particles per tick ≤ 6.
* The creature never teleports during an encounter, never breaks or places blocks, never targets Creative/Spectator,
  never acts on Peaceful, never deals damage outside `attacks.js` `resolveImpact()`.

## 1. Identifiers
| Thing | Identifier |
|---|---|
| Namespace | `gs` |
| Creature entity | `gs:grinshackle` (family `gs_grinshackle`, `monster`, `mob`) |
| Legacy shim entity (v1 saves) | `cr:chainreaver` — despawns instantly, not spawnable/summonable |
| Waypoint helper entity | `gs:waypoint` (family `gs_waypoint`), invisible, inert, self-expiring (timer 45 s) |
| Chain fragment marker | script-side only (`markers.js`) + particle `gs:chain_fragment` |
| Items | `gs:chainbound_dial`, `gs:rattle_lure`, `gs:broken_chain`, `gs:ink_scrap`, `gs:grinshackle_fang` |
| Player target tag | `gs_target` |
| Admin tag | `gs_admin` |
| Script event channel | `gs:control` (message = command line) |
| World dynamic properties | `gs:config` (JSON), `gs:reservation` (JSON), `gs:owner` (player id), `gs:history` (JSON ring of variants), `gs:profile:<playerId>` (JSON), `gs:migrated_v1` (bool) |
| Entity dynamic properties (creature) | `gs:generation` (number), `gs:mode` (`natural`/`test`/`egg`/`preview`), `gs:pose_saved` (string) |
| Player dynamic properties | `gs:prefs` (JSON: musicVolume, effectsVolume, subtitles, quietPreset, dialGiven), `gs:lastDeathTick` (number) |
| Geometry | `geometry.grinshackle_chainreaver` (unchanged) |
| Texture | `textures/entity/grinshackle_chainreaver` (unchanged 64×64) |
| Animations | the 21 `animation.grinshackle_chainreaver.<suffix>` clips (exact names) + procedural overlays `animation.grinshackle_chainreaver.overlay_head_track`, `.overlay_gather_chains`, `.overlay_tighten` (small, few bones, documented as additions) |
| Animation controllers | `controller.animation.gs.pose`, `controller.animation.gs.action`, `controller.animation.gs.overlay` |
| Render controller | `controller.render.gs.grinshackle` |
| Particles | `gs:ink_motes` (ambient, looping ~1 s), `gs:ink_drip` (falling droplets), `gs:ink_puff` (burst), `gs:chain_fragment` (marker), `gs:collapse_chains` (defeat), `gs:snap_sparks` (chain snap), `gs:lit_edge` (light-threshold hesitation) |
| Sound definitions | see §8 |

## 2. Entity properties (BP `description.properties`, all `client_sync: true`)
| Property | Type | Values | Meaning |
|---|---|---|---|
| `gs:pose` | enum | `hidden, emerge, idle, stalk, walk, run, crouch, crawl, stare, battle_idle, vanish, collapse` | base locomotion/posture layer (exactly one clip) — default `emerge` |
| `gs:action` | int 0..10 | 0 none, 1 alert, 2 twitch, 3 lunge, 4 chain_whip, 5 roar, 6 hurt, 7 chain_snap, 8 attack, 9 slam, 10 attack_crawl | one-shot overlay layer; the script sets it back to 0 one tick before the clip's end |
| `gs:overlay` | int 0..2 | 0 none, 1 gather_chains (Last Link), 2 tighten (repeated staring) | additive posture overlay |
| `gs:track` | bool | | head-tracking overlay enabled (observation states only) |

Pose → clip mapping in `controller.animation.gs.pose` (one state per pose, `blend_transition` 0.15, `hidden` plays nothing):
`emerge→emerge`, `idle→idle`, `stalk→stalk`, `walk→walk`, `run→run`, `crouch→crouch`, `crawl→crawl`, `stare→stare`,
`battle_idle→battle_idle`, `vanish→vanish`, `collapse→collapse`. Transitions are purely `query.property('gs:pose') == '<pose>'`.
Action controller: state `none` ↔ one state per action, entered on `query.property('gs:action') == N`, exited ONLY when the
property changes (`!= N`), `blend_transition` 0.08 (attacks) / 0.12 (others). Overlay controller likewise for 1/2, and a separate
`head_track` state entered when `query.property('gs:track')`.

Clip durations (ticks, authoritative for the script; `constants.js` `CLIPS`):
| clip | seconds | ticks | loop |
|---|---|---|---|
| idle 5.096 / battle_idle 2.912 / stalk 1.911 / walk 1.092 / run 0.582 / stare 4.186 / crouch 3.458 / crawl 1.1 | — | — | loop |
| alert | 1.729 | 35 | once |
| twitch | 1.319 | 26 | once |
| lunge | 1.411 | 28 | once |
| chain_whip | 1.684 | 34 | once |
| roar | 2.366 | 47 | once |
| emerge | 2.639 | 53 | once |
| vanish | 1.911 | 38 | hold |
| hurt | 0.655 | 13 | once |
| collapse | 2.275 | 46 | hold |
| chain_snap | 2.184 | 44 | once |
| attack | 1.35 | 27 | once — impact tick 12 |
| slam | 1.75 | 35 | once — impact tick 17 |
| attack_crawl | 1.15 | 23 | once — impact tick 10 |

## 3. BP entity component groups & events (creature)
Motion groups (exactly one active; event `gs:move_<name>` removes all others then adds one):
`still` (movement 0), `creep` (0.09, Last Link), `stalk` (0.13), `walk` (0.18), `hunt` (0.32), `hunt_fast` (0.38), `crawl` (0.22),
`crawl_fast` (0.27), `retreat` (0.25 + `avoid_mob_type` players 24 blocks).
Every moving group includes `minecraft:behavior.move_towards_target` (priority 3, within_radius 1.25; `stalk`/`walk` use 6.0 / 0.8).
Target groups (exactly one; events `gs:target_player`, `gs:target_waypoint`, `gs:target_none`):
`gs:target_player` = `nearest_attackable_target` (must_see false, reselect_targets true, within_radius 48, filter family player AND has_tag `gs_target`);
`gs:target_waypoint` = `nearest_attackable_target` (family `gs_waypoint`, within_radius 64).
Posture groups: `gs:tall` (collision 0.8×2.68) / `gs:low` (0.8×1.95) via events `gs:stand` / `gs:crouch`.
Base components: health 80/80, physics, pushable, movement.basic, navigation.walk (can_jump true, avoid_water true, can_open_doors false, can_break_doors false), jump.static, follow_range 48, knockback_resistance 0.65, persistent, nameable false, experience_reward 8, damage_sensor (immune to fall; everything else normal), loot `loot_tables/entities/grinshackle.json`, conditional_bandwidth_optimization. **No `minecraft:attack`, no melee goals, no look goals.**
Spawned event `minecraft:entity_spawned` adds `still`, `gs:tall`, `gs:target_none`.

Waypoint entity `gs:waypoint`: health 10, damage_sensor deals_damage false, physics has_gravity false has_collision false,
collision_box 0.1×0.1, pushable false, type_family `gs_waypoint`, timer 45 s → event `gs:expire` → `minecraft:instant_despawn`. Client entity renders nothing.

## 4. Module map (`Grinshackle_BP/scripts/`)
Every module exports plain functions; shared mutable state lives ONLY in `state.js`.

### `constants.js`
Exports `IDS` (all identifiers of §1), `POSES`, `ACTIONS` (name→int and int→name), `OVERLAYS`, `CLIPS` (name→{ticks, loop, impact?}),
`ATTACKS` = `{ attack:{action:8, impact:12, duration:27, range:2.2, damage:10, facing:0.45, vertical:1.6}, slam:{action:9, impact:17, duration:35, range:2.25, damage:12, facing:0.45, vertical:1.6}, attack_crawl:{action:10, impact:10, duration:23, range:2.15, damage:9, facing:0.45, vertical:1.6} }`,
`DIRECTOR_STATES` = `['DORMANT','OMENS','EMERGE','OBSERVE','INVESTIGATE','STALK','FLANK','WARNING','HUNT','SEARCH','RETREAT','COOLDOWN']`,
`VARIANTS` = `['watcher','shadow','last_link','ambusher','feint']`, `SOUNDS` (§8), `PARTICLES`, `LIGHT_BLOCKS` regex, `MINESHAFT_BLOCKS` regex.

### `util.js`
`v(x,y,z)`, `add/sub/scale/len/dist/flatDist/norm/dot`, `yawTo(from,to)` (Bedrock yaw degrees: `Math.atan2(-dx, dz)*180/PI`),
`turnToward(currentYaw, targetYaw, maxDeg)`, `clamp`, `lerp`, `rand(min,max)`, `randInt`, `pick(arr)`, `chance(p)`,
`safe(fn, fallback)` (try/catch wrapper), `isValid(e)`, `log(level, msg)` (respects `config.debug`), `nowTick()`.

### `state.js`
`export const S = { tick:0, loaded:false, config:null, active:undefined, record:undefined, reservation:undefined, preview:undefined,
  markers:[], waypoints:[], noise:[], samples:new Map(), lastError:0, nextNaturalCheck:0, debug:false, music:new Map(), loops:new Map() }`.
`record` (per encounter, created by `director.beginEncounter`) has EXACTLY these fields:
```
{ generation, mode, variant, state, since, stateEntered, startedTick, budgetEnd, huntStart, huntBudgetTicks, target (player id|undefined),
  tension (0..100), pose, action, actionUntil, overlay, track, motion, low, lastPos, lastProgress, nextAttack, pendingAttack (null|{kind, startTick, hitDone}),
  enragedUntil, snapCooldownUntil, hurtCooldownUntil, fragmentsEnabled, lastFragment, lit:{count, threshold, hesitating, until},
  omens:{ nextAllowed, lastKind, footstepsUsed, mineUsed, dragUsed }, lastLink:{ active, releasedAt }, corner:{ active, coverPoint, revealPoint, watchedTicks, hesitateUntil, tightened, moves },
  thresholds:[ {x,y,z,heading,uses,lastTick} ], flank:{ active, point, since }, retreatPause:{ used, active, until },
  stalkStart, stalkLength, sightingOnly, unreachableTicks, outsideTicks, lureRedirect:{point, until}, staredTotal, rageAnnounced, lastLine }
```

### `timers.js`
`schedule(ticks, fn, tag)` → id; `cancel(id)`; `cancelAll()`; `cancelTag(tag)`; `pump()` (called once per tick from main). Max 64 pending;
each callback runs inside `safe()` and is skipped if `gates.masterEnabled()` is false (unless scheduled with `tag:'system'`).

### `config.js`
`DEFAULTS` (see §6), `BOUNDS` (min/max per numeric key), `PRESETS` (`balanced`, `slow_dread`, `relentless`, `showcase`),
`load()`, `save()`, `get(key)`, `set(key, value)` (clamped to BOUNDS, persisted), `applyPreset(name)`, `reset()`,
`prefs(player)` → per-player object with defaults, `setPref(player, key, value)`.

### `gates.js`
`masterEnabled()`, `naturalEnabled()`, `worldAllowsEncounters()` (not Peaceful), `playerEligible(p)` (valid, Survival/Adventure, alive,
not respawn-protected (60 s after death/spawn), Overworld), `habitatOK(p)` (dimension overworld, y ≤ config.maxSpawnY, not sky-exposed
per `world_scan.isUnderground`), `spawnGate()` → `{ ok:boolean, reason:'disabled'|'natural_off'|'grace'|'cooldown'|'peaceful'|'no_eligible_player'|'wrong_habitat'|'reserved_active'|'reserved_unloaded'|'no_safe_location'|'ok' , detail }`.
Status text uses these reasons verbatim (`text.js` maps them to sentences).

### `world_scan.js`
`isAir(dim,pos)`, `isSolidFloor(dim,pos)`, `standRoom(dim,pos,height)`, `isUnderground(dim,pos)` (bounded 24-block upward scan + y rule),
`lightApprox(dim, pos, radius=4)` → `{count, strong:boolean}` (counts blocks matching `LIGHT_BLOCKS` within radius; each counted block is
verified with one `getBlockFromRay` obstruction check from the light to `pos`+1; ≤ 12 rays), `materialAt(dim,pos)` → `'stone'|'deepslate'|'gravel'|'wood'|'dirt'|'other'`,
`mineshaftScore(dim,pos)`, `findSpawnPoint(player, {min, max, height, testing})` → pos|undefined (≤ 24 candidates per call, rejects view cone
dot>0.45 unless testing, rejects liquid/no floor/no headroom/lit>=strong), `findCoverPoint(dim, fromPos, playerPos, {min,max})` →
`{cover, reveal}|undefined` (cover = floor point with no LOS to the player's head, reveal = adjacent floor point with LOS),
`hasLineOfSight(dim, from, to)`, `walkableNear(dim, pos, radius)`.
All scans are budgeted: never more than 400 `getBlock` calls per call.

### `reservation.js`
`load()`, `current()` → `{entityId, generation, dimensionId, x,y,z, mode, createdTick, lastSeenTick}|undefined`,
`reserve(entity, mode)` (increments generation, writes `gs:generation` on the entity), `release()`, `validate(entity)` → boolean
(entity valid, id matches, generation matches), `touch(entity)` (updates lastSeen/pos), `adopt(entity)` (called on spawn/load: returns
`'active'|'duplicate_removed'|'stale_removed'|'disabled_removed'|'legacy_removed'`), `retireIfLost()` (if reservation unloaded for
> config.lostReservationMinutes and entity not found in any dimension → generation++ and release; the old entity self-removes on load),
`migrateV1()` (clear `cr:*` properties once, remove any `cr:chainreaver`).

### `perception.js`
`lineOfSight(entity, player)`, `isWatched(entity, player, cone=0.91)`, `targetOf(record)` → Player|undefined, `chooseTarget(entity)`,
`recordNoise(kind, pos, playerId, loudness)` (kinds: `sprint, jump, break, place, bell, plate, lever, button, lure, hit`), `recentNoise(pos, radius, ticks)`,
`sampleMovement(player)` (per tick for target; ring 64 of `{tick,x,z,onGround,sneaking,sprinting}`), `stepEvents(playerId)` (derived steps:
one step per 0.6 blocks travelled on ground; sneaking steps flagged quiet), `playerStopped(playerId, ticks=10)`, `movementHeading(playerId)`,
`tensionDelta(record, player)` (per 5-tick evaluation: +proximity(<8:2,<4:4), +sprint 1.5, +watched 0.8 (observe) , +noise, −sneak 0.6,
−no LOS & dist>16: 1.2, −lit strong: 1.5; clamp 0..100).

### `memory.js`
Encounter thresholds: `notePosition(record, player)` (every 20 ticks; detects narrow passages = ≤4 of 8 horizontal neighbours air at feet
level; merges within 3 blocks; cap 6; expire 90 s), `repeatedThreshold(record)` → point|undefined (uses ≥ 2 while fleeing),
`clearThresholds(record)`.
Adaptive profile (`gs:profile:<id>`): `profile(playerId)` → `{samples, sprint, sneak, stare, lights, escapeBins[8], tight, rush, dodgeL, dodgeR, updated}`,
`observe(playerId, key, amount)`, `decay(playerId)` (×0.97 per encounter end), `confident(profile,key)` (samples ≥ 5 and ratio ≥ 0.6),
`traits(playerId)` → `{runner, sneaker, starer, lighter, rusher, routeBins}`, `forget(playerId)`, `forgetAll()`, `describe(playerId)` → string.
Learning respects `config.learning`.

### `navigation.js`
`setMotion(name)` (triggers `gs:move_<name>` only on change; records `record.motion`), `setPosture(low)` (validates clearance;
`gs:crouch`/`gs:stand`), `targetPlayer()`, `targetWaypoint(point)` (spawns/moves ≤1 live `gs:waypoint`, sets target group),
`clearWaypoints()`, `faceToward(pos, maxDegPerTick)` (setRotation with turn limit), `facePlayerGradual(player)`, `trackProgress()`
(updates lastPos/lastProgress; `stalled(ticks)`), `crampedAhead()` (2-block passage check at position and 0.85 ahead), `hesitateAtLight()`.

### `attacks.js`
`canStart(kind)` (dist ≤ 1.95 for attack/slam, 1.8 crawl; LOS; `tick ≥ record.nextAttack`; not enraged-locked), `start(kind)`
(sets `pendingAttack`, action, motion still, plays wind-up sound + subtitle), `update()` (per tick: face target until `impact-6`,
resolve at `impact` once, end at `duration` → nextAttack = tick + 15 + recovery), `resolveImpact()` (ALL rechecks: reservation valid,
eligible, same dimension, dist ≤ range, |dy| ≤ vertical, facing dot ≥ 0.45, LOS; difficulty multiplier Easy .65 / Hard 1.25; +2 if enraged;
`applyDamage` with `EntityDamageCause.entityAttack`; knockback 0.55/0.16; impact sound), `cancel(reason)`.
`chooseKind()` (crawl → attack_crawl; profile rusher → slam 60 % else 30 %).

### `animation.js`
`setPose(name)`, `setAction(name)` (sets int, schedules reset at ticks-1 via `record.actionUntil`), `clearAction()`, `setOverlay(n)`, `setTrack(bool)`,
`syncFromRecord()` (writes properties only on change), `previewPlay(entity, clipName)` (uses the same properties; looping clips set pose,
one-shots set action), `resetVisual()` (pose idle, action 0, overlay 0, track false).

### `audio.js`
`fx(id, pos, {volume, pitch, radius=24})` (Player.playSound with location for each player within radius, scaled by prefs.effectsVolume and
`config.effectsVolume`; skipped when muted), `chainDrag(entity)` (rate-limited 1 s loop segments while moving and chains not gathered),
`wristClick`, `breath`, `music(player, 'stalk'|'hunt'|null)` (`playMusic`/`stopMusic`, per player, only the target; respects musicVolume),
`stopAll()` (stopMusic for every player, `stopsound` of `gs.` loops via runCommand, clears `S.loops`), `subtitle(player, text)`
(actionbar when prefs.subtitles), `mute(bool)`.

### `markers.js`
`drop(pos)` (ring ≤12, expire 120 ticks, min spacing 1.5 blocks, never on the player's current block, never more than 1 per 30 ticks),
`update(player)` (particles every 10 ticks; trigger when player within 0.85, not sneaking, on ground; sneak = no trigger; sets
`record.snapPending` → director runs chain_snap → enrage 80 ticks; cooldown 200 ticks between snaps), `clear()`.

### `omens.js`
Each omen: `available(record, player)`, `start(record, player)`, `tick(record, player)`, `end(record)`. Kinds: `borrowed_footsteps`
(after the player stops: delay 30–60 ticks, plays 2 steps (interval from observed cadence ±15 %), pause 20–40 ticks, 1 step, at a
`walkableNear` point 6–10 blocks away out of LOS; material-matched sound; cooldown 90 s; disrupted if the player changes heading > 60° or
starts moving), `answering_mine` (listens to `playerBreakBlock` events: after ≥3 breaks with intervals 8–40 ticks, waits 40–80 ticks then
replays the same intervals as `gs.answer_tap` from 14–20 blocks away in the direction away from the player, plus one extra tap; cooldown
120 s; a bell/plate/lever/button noise within 24 blocks interrupts listening for 60 ticks then raises tension +8), `distant_drag`
(audio only, 12–20 blocks away, 3 s). `pick(record, player)` enforces: one omen at a time, ≥ 8 s pause between omens, anti-repeat.

### `director.js`
`beginEncounter(entity, mode, targetPlayer)`, `endEncounter(reason)` (idempotent; clears markers/waypoints/audio/tags/timers; sets cooldown),
`transition(state)`, `tick()` (the per-tick brain; heavy work gated to `tick % 5`), `onHurt(event)`, `onTargetLost()`, `onSnapTriggered()`,
`forceVanish()`, `masterOff()`, `naturalSpawnTick()` (every 100 ticks; uses `gates.spawnGate`), `chooseVariant()` (anti-repeat ring of 4 in `gs:history`),
`statusLine()`.
State rules (entry / exit / valid targets / timers / animation / cleanup) are written as a table at the top of the file and MUST match §5.

### `ui.js`
`openDial(player)` (ActionFormData main menu, 8 buttons with icons), `sectionMaster`, `sectionSpawning`, `sectionBehavior`, `sectionAudio`,
`sectionTools`, `sectionStudy`, `sectionPresets`, `sectionStatus`; admin sections require `isAdmin(player)` (tag `gs_admin` or `gs:owner`),
non-admin gets Status and personal Audio only. All forms are standard `@minecraft/server-ui` forms; no radial claims.

### `commands.js`
`handle(sourceEntity, message)` for `gs:control`: `status, spawn, test (=spawn), preview [clip|list|next|stop], end, reset, enable, disable,
natural on|off, mute, restore, cooldown, forget [player|all], dial, admin, debug on|off, preset <name>, learn on|off, help`.
Functions in `functions/grinshackle/<name>.mcfunction` map 1:1.

### `items.js`
`giveDialOnce(player)`, `giveDial(player)` (no duplicate if inventory already has one), `onItemUse(event)` (dial → `ui.openDial`,
lure → `useLure(player, itemStack)`), `useLure(player)` (validates point via `getBlockFromViewDirection` ≤ 8 blocks else 5 ahead; plays
`gs.lure`; effectiveness 1.0 → 0.6 → 0.3 for repeats within 6 blocks in the same encounter; feedback via subtitle; sets `record.lureRedirect`;
consumes one item).

### `text.js`
`LINES` (rare original atmospheric chat lines), `line(player, key)` (max one per 90 s, only when `config.atmosphericLines`), `cue(player, key)`
(actionbar mechanic cues; visual equivalent for audio warnings when subtitles on), `gateSentence(reason, detail)`.

### `preview.js`
`start(player, clip?)` (spawns `gs:grinshackle` 5 blocks ahead, mode `preview`, reservation mode preview, `gs:target_none`, motion still,
no damage/no targeting, 2400-tick lifetime, faces player), `play(clip)`, `next()`, `stop()`, `tick()`.

### `main.js`
Subscribes: `system.afterEvents.scriptEventReceive`, `world.afterEvents.worldLoad` (or first tick fallback), `entitySpawn`, `entityLoad`,
`entityRemove`, `entityDie`, `entityHurt`, `playerSpawn`, `playerLeave`, `playerGameModeChange`, `playerDimensionChange`, `playerBreakBlock`,
`playerPlaceBlock`, `playerInteractWithBlock` (bell), `pressurePlatePush`, `leverAction`, `buttonPush`, `itemUse`. Tick loop: `S.tick++`,
`timers.pump()`, gate checks, `director.tick()`, `preview.tick()`, natural spawn every 100 ticks, error throttle (1 log / 200 ticks).

## 5. Encounter director — state table
| State | Entry | Per tick | Exit → |
|---|---|---|---|
| DORMANT | no entity; `nextNaturalCheck` set | every 100 ticks `spawnGate()`; if ok and roll passes → OMENS (65 %) or EMERGE (35 %) | OMENS / EMERGE |
| OMENS | pick target; `omens.pick`; 15–60 s budget; no entity yet | play ≤2 omens with pauses; 35 % of OMENS end without a spawn → COOLDOWN (short cooldown 90–150 s) | EMERGE / COOLDOWN |
| EMERGE | `findSpawnPoint` (12–24, dark, not in view cone) → spawn, `reserve`, pose emerge, motion still, ink sound + puff, face target | after 53 ticks → OBSERVE (watcher/last_link) or STALK (others) | OBSERVE / STALK |
| OBSERVE | pose stare or idle/crouch, track on, target player, motion still; corner logic (`findCoverPoint`) | head-first turn, body ≤ 60°/s; watched → hesitate 2–4 s; watched ≥ 6 s cumulative → overlay tighten, then move to a new cover when unwatched (walk pose, waypoint); sighting-only variants end after 5–12 s → RETREAT | INVESTIGATE / STALK / RETREAT / WARNING |
| INVESTIGATE | waypoint = last noise / lure point; pose walk (stalk clip if within 10 blocks of player) | arrive or stall 8 s → OBSERVE; new noise re-targets | OBSERVE / STALK |
| STALK | target player, motion stalk (creep + overlay gather_chains in last_link), chain drag audio (silent in last_link), fragments off | 20–40 s (config), tension accumulates; at 100 → WARNING; player out of range 40 → RETREAT; ≥3 strong lights → hesitate/withdraw | WARNING / FLANK / RETREAT |
| FLANK | waypoint = side route near a remembered threshold; pose walk | arrive → crouch & wait ≤ 15 s; player within 6 → WARNING; stall → STALK | WARNING / STALK |
| WARNING | motion still; action roar (rare, first hunt of encounter, 25 %) else chain_whip or alert; last_link → click_release sound + alert; subtitle | after action → HUNT | HUNT |
| HUNT | motion hunt / crawl; run pose (battle_idle when stationary); fragments on; music hunt; huntStart, 45 s cap | attacks via `attacks.js`; crawl posture via `crampedAhead`; snap → chain_snap action (44 ticks, motion still) then enrage 80 ticks; stalled 8 s or unreachable → SEARCH; cap → RETREAT | SEARCH / RETREAT / (collapse) |
| SEARCH | waypoint = last known player pos; pose walk; music stalk | LOS regained & budget left → HUNT; 12 s no contact → RETREAT | HUNT / RETREAT |
| RETREAT | motion retreat, pose run; fragments cleared; music off; may do `retreatPause` once (cover + crouch 6–10 s listening) | disturbance during pause → WARNING→HUNT (remaining budget only); else after 5 s / 32 blocks → VANISH (pose vanish 38 ticks, ink) → `endEncounter` | COOLDOWN |
| COOLDOWN | reservation released; `nextNaturalCheck = tick + rand(cooldownMin, cooldownMax)` | — | DORMANT |
Overlays at any time: hurt (rate-limited 30 ticks, never interrupts an attack), master OFF (→ immediate cleanup, no animation), Peaceful / target
invalid (→ RETREAT), death (→ collapse pose, loot, release, no further actions), unloaded chunk (record dropped, reservation kept).

## 6. Config keys (all persisted; `config.js` DEFAULTS)
```
master:true, naturalSpawning:true, spawnChance:0.6 (per check when gate ok), graceSeconds:120, cooldownMinSeconds:180, cooldownMaxSeconds:360,
stalkMinSeconds:20, stalkMaxSeconds:40, huntCapSeconds:45, maxSpawnY:0, minSpawnDistance:12, maxSpawnDistance:24,
health:80 (40..200), damageScale:1.0 (0.25..2.0), speedScale:1.0 (0.6..1.4), aggression:1.0 (0.5..1.5),
crawling:true, lightAvoidance:true, lightThreshold:3, chainFragments:true, omenFootsteps:true, omenMine:true, omenDrag:true,
cornerWatch:true, lastLink:true, thresholds:true, unfinishedRetreat:true, learning:true, effectDensity:1.0 (0..1.5),
musicVolume:0.6, effectsVolume:1.0, subtitles:true, atmosphericLines:true, quietPreset:false, lostReservationMinutes:10, debug:false
```
Presets: balanced = defaults; slow_dread = cooldown 300–600, stalk 35–60, spawnChance .4, aggression .8, omens all on, huntCap 40;
relentless = cooldown 120–240, stalk 15–25, spawnChance .9, aggression 1.4, speedScale 1.15, huntCap 45 (never more), lightThreshold 4;
showcase = natural off, aggression .5, damageScale 0 (preview-safe), omens on, music on.

## 7. Sound definitions (`gs.` namespace, all original, generated)
`gs.chain_drag` (1.0 s segment, 3D), `gs.wrist_click`, `gs.breath`, `gs.alert`, `gs.answer_tap`, `gs.warning`, `gs.windup`, `gs.strike`,
`gs.impact`, `gs.ink`, `gs.defeat`, `gs.chain_snap`, `gs.roar`, `gs.rattle`, `gs.lure`, `gs.click_release`, `gs.hurt`, `gs.collapse_chains`,
`gs.step.stone`, `gs.step.deepslate`, `gs.step.gravel`, `gs.step.wood`, `gs.step.dirt`, `gs.music.stalk` (category music, stream), `gs.music.hunt` (music, stream).
Files: `sounds/grinshackle/<name>.ogg` (steps under `sounds/grinshackle/step_<mat>.ogg`, music under `sounds/grinshackle/music_<x>.ogg`).

## 8. Items / recipes / loot
* `gs:chainbound_dial`: max stack 1, icon `gs_chainbound_dial`, glint, category equipment; recipe shaped `" G ","GCG"," G "` (G gold_ingot, C minecraft:chain).
* `gs:rattle_lure`: stack 16, icon `gs_rattle_lure`, cooldown category `gs_lure` 3 s; recipe shapeless 2× `gs:broken_chain` + 1× `gs:ink_scrap` + 1× string.
* `gs:broken_chain` (stack 64): recipe shapeless 1× `minecraft:chain` → 2; also loot.
* `gs:ink_scrap` (stack 64): recipe shapeless 1× paper + 1× ink_sac → 2; also loot.
* `gs:grinshackle_fang` (stack 16): loot only (30 %); trophy, lore line.
* Loot table `loot_tables/entities/grinshackle.json`: broken_chain 2–4, ink_scrap 1–3, fang 30 %.
* Spawn egg via client entity `spawn_egg` colours (#111513 / #be9b58).

## 9. Text (original, short)
Atmospheric (chat, rare): "One step too many." / "It stopped dragging the chain." / "The last tap was not yours." / "Something counted your steps." /
"The grin has not moved." / "It is holding the chain still." Mechanic cues (actionbar): "[chains rattle nearby]", "[a chain snaps — it is faster]",
"[it is winding up]", "[it hesitates at the light]", "[it lost you]", "[it has gone]", "[decoy: it barely turned its head]".

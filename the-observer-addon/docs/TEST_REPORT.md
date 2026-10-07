# Test Report

Everything below was run in this project's build environment. Results are copied from the logs of those runs; nothing
here is projected or assumed. Where something could not be tested, it says so (§8).

## 1. Environment and method

| Item | Value |
|---|---|
| Server | Bedrock Dedicated Server **1.26.52.3** for Linux (official build), fresh flat test world per run |
| Script APIs | `@minecraft/server` 2.10.0, `@minecraft/server-ui` 2.2.0 (stable, no experiments) |
| Test players | GameTest simulated players (`@minecraft/server-gametest` 1.0.0-beta), used **only** by the separate test pack `tests/bds/testkit_BP` |
| Harness | `tests/bds/run_bds.py`: installs both packs into the world, drives a scenario over the server console, collects `[OTEST]` lines and every content-log/script error |
| Event channel | the add-on reports what it does (`start`, `end`, `ledger`, `body`, `discovery`, `strike` …) through `/scriptevent observer_evt:*`, only while dev tracing is on; tests assert on those events and on the world itself (blocks, entities, items, health) |

The harness patches **only the installed test copy** of the behaviour pack (one manifest dependency and one import of
the GameTest module) because simulated players are otherwise not visible to the add-on's `world.getAllPlayers()`. The
packs in `packs/` and `dist/` are not modified and do not depend on GameTest.

Test arena (`tests/bds/testkit_BP/scripts/arenas.js`): a 220 × 80 platform at y = 140 with an open field, trees, a
furnished house (door, torches, pumpkin, stonecutter), a 64 × 72 pool, a 20-block pillar, a 57-block 2 × 3 tunnel
inside solid stone at y = 125, and a Nether platform.

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
| Cross-references | `tools/validate.mjs` | OK: geometry ↔ bones in every animation, controller states ↔ animation short names, render controller ↔ textures/geometry, 21 sound events ↔ 28 `.ogg` files, particles, fogs, lang keys for every item/block/entity/UI string, recipes ↔ items, script IDs ↔ definitions, entity properties/events used by scripts |
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

`tests/bds/testkit_BP/scripts/suite.js` — 45 test groups (including setup and a status check) with 173 assertions, run in one session
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
| **final** | **173** | **0** | all passed: the earlier suite plus the Config Wheel tests (wheel on first join, See it now, encounter toggles) and the carve-direction check |

Final run: 1080 s, minimum TPS between tests 19.8, **0 content-log or script errors**. The pack version was then raised
to 1.0.1 (so the fixed build replaces 1.0.0 on import); `setup wheel_welcome showcase toggles distant_watch status`
was re-run on that build: 19 / 19, 0 errors.

### 5.2 Final run by area

| Test group | Assertions passed | Failed |
|---|---|---|
| `setup` | 3 | — |
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
| `pursuit` | 6 | — |
| `pursuit_watched_walks` | 2 | — |
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
| `withdraw_walks` | 3 | — |
| `seal_occupied` | 2 | — |
| `mp_fairness` | 1 | — |
| `pursuit_water_escape` | 3 | — |
| `closed_path_light` | 7 | — |
| `bearing_three` | 2 | — |
| `showcase` | 5 | — |
| `toggles` | 1 | — |
| `natural` | 1 | — |
| `status` | 0 | — |

### 5.3 Restart and persistence

Scenarios `restart_a.txt` then `restart_b.txt` on the same world (re-run after the persistence fixes):
a *Closed Path* is started, the Veil seal placed and the Observer present and watched — then the server is stopped
mid-encounter (A: 5/5 pass). After restart (B: 2/2 pass): **0 stray Observer bodies** once the chunk loaded, and the
interrupted encounter's Veil cells were **restored** (0 Veil blocks left) within 30 s.

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
4. **Particles & fog** — footprints oriented along the walk direction, eye glints in darkness, chalk marks, effigy dust;
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

* Anything a client shows or plays: model, animations, particles, fog, block models, icons, sounds, forms, captions,
  camera effects (§6).
* A real player disconnecting and reconnecting (simulated players cannot reconnect with the same identity).
* Each pacing rule individually (quiet periods, recovery, anti-repetition, deferral back-off): they run in every test,
  and the natural-director tests start encounters on their own, but timings were not asserted one by one.
* Escapes from the pursuit by out-running it 48+ blocks or by outlasting its 35-second limit (the arena is too small);
  the water escape is tested.
* The sleep trigger of *While You Slept* (simulated players cannot sleep; the encounter itself is tested).
* Phones, consoles, low-end devices, and Realms.

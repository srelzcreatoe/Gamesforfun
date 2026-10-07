# Developer Guide

## 1. Layout

```
the-observer-addon/
├── packs/
│   ├── TheObserver_BP/            behaviour pack (shipped)
│   │   ├── entities/the_observer.json     body: properties, modes, physics
│   │   ├── blocks/                        veil, effigy, ward_lantern
│   │   ├── items/  recipes/  loot_tables/
│   │   └── scripts/                       all game logic (ES modules, @minecraft/server 2.10.0)
│   └── TheObserver_RP/            resource pack (shipped)
│       ├── models/entity/the_observer.geo.json         supplied geometry (namespaced copy)
│       ├── animations/the_observer.animation.json      supplied clips (namespaced copy)
│       ├── animations/the_observer_supplemental.animation.json   stalk_walk, peek, recoil, stoop, look_at_target
│       ├── animation_controllers/  entity/  render_controllers/
│       ├── sounds/ (28 original .ogg + definitions)  particles/  fogs/  textures/  texts/
├── source_assets/supplied/        the ZIP's contents, untouched, with SHA256SUMS.txt
├── tools/                         asset pipeline, validator, packager, offline renderer
├── tests/bds/                     dedicated-server harness + GameTest test kit (dev only)
├── docs/                          this documentation
└── dist/                          built .mcaddon / .mcpack + checksums
```

### Script modules (`packs/TheObserver_BP/scripts/`)
| Module | Responsibility |
|---|---|
| `main.js` | wiring: startup, events, loops (5/20/100/1200-tick), evidence traces |
| `core/constants.js` | identifiers and block/sound tables (block IDs verified against vanilla data) |
| `core/util.js` | vectors, RNG, dimension helpers, `allPlayers()`, debug/trace/emit |
| `core/state.js` | world + per-player state, chunked JSON dynamic properties, the add-on clock |
| `core/settings.js` | settings, presets, aggression/damage, captions |
| `world/sight.js` | gaze, line of sight (sees through glass/bars/fences), visibility of body points, `GazeTracker` |
| `world/space.js` | valid standing positions, cover, wards, `findSpot`, corridor detection |
| `world/ledger.js` | recorded, reversible block changes; break/interact/scan handling; persistence |
| `world/manipulate.js` | the manipulation mechanics M1–M8 |
| `observer/body.js` | the single physical Observer: spawn, state/mode, facing, stoop, glints, strike, withdraw, strays |
| `observer/memory.js` | breadcrumbs, haunts, route familiarity, habits, attentiveness |
| `director/context.js` | per-player situation snapshot |
| `director/encounter.js` | the runtime object passed to encounter scripts |
| `director/director.js` | scheduling, selection, multiplayer fairness, bookkeeping, recovery |
| `encounters/*.js` | one file per encounter; each calls `register()` |
| `progression/discoveries.js` | discoveries, Vestiges, stage advancement |
| `progression/items.js` | Field Notes, Chalk, Lens, Ward Lantern, effigy rewards, blows |
| `ui/forms.js` | Field Notes UI, settings form, after-vigil choice |
| `ui/wheel.js` | the Config Wheel menu: status, preview, start now, presets, settings, encounter toggles, test, undo |
| `encounters/showcase.js` | the *See it now* preview (`preview: true`: any game mode, no progress, no block changes) |
| `dev/commands.js` | `/observer:*` commands and `/scriptevent observer:*` equivalents |

## 2. Tooling

```bash
npm install                      # dev dependencies only (typings, schemas, ajv, typescript)
npm run typecheck                # tsc --checkJs against @minecraft/server 2.10.0 typings
npm run validate                 # official JSON schemas + cross-reference checks
python3 tools/check_vanilla_shapes.py --samples <bedrock-samples>/resource_pack
                                 # compare RP JSON value types with Mojang's vanilla files (catches
                                 # client-only load errors the schema package accepts; see its docstring)
python3 tools/build.py           # validate + typecheck + package into dist/
python3 tools/integrate_supplied_assets.py    # re-derive the namespaced supplied assets (asserts identity)
python3 tools/make_supplemental_anims.py      # regenerate supplemental clips (FK-grounded)
python3 tools/make_client_entity.py           # client entity, render & animation controllers
python3 tools/synth_sounds.py                 # regenerate all .ogg (needs ffmpeg + libvorbis)
python3 tools/make_textures.py                # textures, block models, pack icons
python3 tools/render_model.py GEO TEX out.png --anim FILE NAME TIME --view side --debug-colors
```

## 3. Runtime testing on Bedrock Dedicated Server

`tests/bds/run_bds.py` installs both packs plus the dev-only test kit into a BDS directory, creates a test world,
enables the *Beta APIs* experiment **only for that world** (the test kit uses `@minecraft/server-gametest` to spawn
simulated players; the shipped add-on needs no experiments), runs a scenario, and summarises `[OTEST] PASS/FAIL` lines
and any content-log/script errors.

```bash
python3 tests/bds/run_bds.py --bds /path/to/bedrock-server --testkit --fresh \
        --world suite --scenario tests/bds/scenarios/suite_full.txt --log suite.log
```

Scenarios: `load.txt` (packs load cleanly), `proto.txt` (capability probes), `speed.txt` (movement calibration),
`suite_smoke.txt`, `suite_full.txt` (all 45 test groups), `suite_extra.txt` (a short subset), `restart_a.txt` +
`restart_b.txt` (interrupted encounter across a server restart), `tps.txt` (tick rate; run once more with `--no-addon`
for the baseline). Results and the manual client procedure are in [TEST_REPORT.md](TEST_REPORT.md).

The harness patches the **installed test copy** of the BP to import
`@minecraft/server-gametest` so simulated players are visible to the add-on's script context; the shipped manifest is
untouched.

With tracing on, the add-on publishes structured events as script events `observer_evt:start|end|discovery|body|ledger|strike|smudge|info`
that the test kit asserts on. In normal play nothing is emitted.

## 4. Adding an encounter

Create `encounters/my_event.js` and import it in `main.js`:

```js
// @ts-check
import { register } from "../director/director.js";
import * as body from "../observer/body.js";
import { findSpot } from "../world/space.js";
import { observe, sighting, acknowledge } from "./common.js";

register({
  id: "my_event",          // also the /observer:trigger name
  tier: 2,                 // 1 subtle .. 4 peak (exposure points, tension, recovery)
  minStage: 2,
  needsBody: true,         // only one body encounter runs at a time
  cooldown: 600,           // seconds per player (scaled by frequency)
  minManip: 0,             // minimum manipulation setting, if it changes blocks
  benign: true,            // allowed in post-vigil "attendant" mode
  weight(c, s) {           // context -> weight (0 = not here)
    if (c.water || c.gliding) return 0;
    return c.night ? 10 : 6;
  },
  prepare(enc) {           // find everything you need; return false to defer
    enc.data.spot = findSpot(enc.p, { minDist: 20, maxDist: 30, concealment: "partial", needLOS: true, hideFrom: enc.witnesses() });
    return !!enc.data.spot;
  },
  async run(enc) {
    const spot = enc.data.spot;
    enc.spawnBody(spot.loc, { state: "watch", stoop: spot.stoop, side: spot.side });
    enc.sound("observer.tell", spot.loc, 0.8, 1, "caption.chime");   // personal, with caption key
    const r = await observe(enc, { maxTicks: 600, noticeTicks: 18, approachDist: 12 });
    if (r.noticed) {
      sighting(enc, r.by ?? enc.p);   // records The Figure / Second Witness
      await acknowledge(enc);
    } else enc.result("unnoticed");
    // withdrawal, fog cleanup and ledger restoration are handled by the director
  },
});
```

Encounter API highlights (`director/encounter.js`): `wait(ticks)` and `until(pred, maxTicks)` (both abort-checked:
target left/died/changed dimension/game mode, add-on disabled, body lost), `sound/worldSound/particle/footprints/leaveTrace`,
`fog/clearFog/shake/fade` (respect the camera setting), `canScare/usedScare`, `toggle/snuff/turn/veil/mimic/effigy/carve`
(ledger-tagged with the encounter), `released` (player answers to its changes), `inputs` (blocks placed by involved
players), `updateGaze`, `witnesses()`, `discover(id)`, `result(outcome, noticed)`, `restoreDelay`, `emit(kind, data)`.

Add caption and discovery strings to `packs/TheObserver_RP/texts/en_US.lang`; `npm run validate` fails on missing IDs.

## 5. Adding a manipulation

1. Add the block types to an allow-list in `core/constants.js` (the validator checks them against vanilla data).
2. Write the mechanic in `world/manipulate.js`; call `ledger.change(dim, loc, permutation, { enc, kind, restoreIn, flags })`
   — never `setPermutation` directly. Use `F.NODROP` for anything the Observer *places*.
3. Gate it with `manip() >= level` and document purpose / activation / scope / cleanup in DESIGN.md §7.

## 6. Tuning knobs

| What | Where |
|---|---|
| Presets and setting ranges | `core/settings.js` (`PRESETS`, `updateSettings`) |
| Encounter gaps, quiet periods, recovery, global gap | `director/director.js` (`finish`, `GLOBAL_GAP`) |
| Stage thresholds | `progression/discoveries.js` (`STAGE_EXPOSURE`, `STAGE_MIN_ENCOUNTERS`) |
| Strike damage per aggression | `core/settings.js` (`strikeDamage`) |
| Movement speeds | `entities/the_observer.json` (`melee_box_attack.speed_multiplier`; speed ≈ 3.88·m² b/s) |
| Ward radius, headroom rules | `world/space.js` |
| Ledger cap | `world/ledger.js` (`MAX_ENTRIES`) |
| Evidence trail lifetime | `main.js` (`tickTraces`) |

## 7. Persistence formats

* World: `observer:world` (chunked JSON) — `{v, clock, settings, active, globalCooldownUntil, wards[[d,x,y,z]], traces[], nextEnc, stats}`.
* Ledger: `observer:ledger` — array of `{k, d, x, y, z, o:[type, states], n:[type, states], enc, kind, at, ra, f, l?}`.
* Player: `observer:player` on each player — see the `PlayerState` typedef in `core/state.js`.
* Entities: the body carries `observer:enc` (owning encounter) so strays can be recognised after reloads.

Strings are split into 30 000-character chunks (`key`, `key#1`, …). `v` is the schema version for future migrations.

## 8. Performance budget

* No per-tick world scans. Loops: 5 ticks (body upkeep: one ceiling probe, glints), 10 ticks (ledger scan of the running
  encounters' few entries), 20 ticks (memory sampling, director, ≤ 12 restorations), 40 ticks (marks, traces),
  100 ticks (saves), 1200 ticks (decay, stray sweep, ward validation).
* Spot searches sample ≤ 40 candidates once per encounter start, with 2–5 raycasts each.
* Block searches use the native `dimension.getBlocks(volume, {includeTypes})` within ≤ 16 blocks.
* Hard caps: one body, ≤ 800 ledger entries, ≤ 16 traces, ≤ 8 chalk marks per player, ≤ 64 wards.
* Measured on BDS with the full suite running: see TEST_REPORT.md (tick-rate monitor).

## 9. Compatibility

* Target: Minecraft Bedrock 1.26.50+ (`min_engine_version` 1.26.50), tested on Bedrock Dedicated Server 1.26.52.3.
* Script modules: `@minecraft/server` 2.10.0, `@minecraft/server-ui` 2.2.0 (stable). No experiments required.
* Namespaces: everything is under `observer:`; the entity is `observer:the_observer`.

# 09 · Developer controls and diagnostics

## In-game commands (cheats on)

| Command | Effect |
|---|---|
| `/fb:setup [rebuild]` | build the map (resumes an interrupted build); `true` rebuilds from scratch |
| `/fb:lobby` | full reset to the time clock (restores camera, inputs, effects, doors, lights, puppets) |
| `/fb:debug help` | list of actions |
| `/fb:debug lobby` | same as `/fb:lobby` |
| `/fb:debug overlay` | toggle the developer overlay: every animatronic's state, node or edge, aggression, tick and noise heat on the action bar |
| `/fb:debug selftest` | in-game self-test (below) |
| `/fb:debug graph` | walk every route polyline in the built world and report blocked samples |
| `/fb:debug state` | dump game state, bus statistics, heartbeat, puppet counts, session snapshot and the last 8 AI transitions to chat |
| `/fb:debug puppets` | delete and respawn all puppets |
| `/fb:debug camtour` | cycle through all 16 camera views (3 s each) |
| `/fb:debug night <0-6>` | start a night immediately in the office |
| `/fb:debug scenario <name>` | start a repeatable test scenario (seed 4242, see below) |
| `/fb:debug seed <n>` | deterministic mode with seed *n* for the next nights |
| `/fb:debug unlock <1-6>` | set the highest unlocked night |
| `/fb:debug hour <0-5>` / `skip` | jump to an hour / to the next hour |
| `/fb:debug power <pct>` | set power |
| `/fb:debug ai <who> <0-20>` | set an animatronic's aggression |
| `/fb:debug place <who> <node>` | move an animatronic to a route node (ids in docs/02) |
| `/fb:debug approach <who> <L\|R\|H>` | force an approach to an entry |
| `/fb:debug win` / `lose [who]` | skip to 6 AM / trigger a jumpscare |
| `/fb:debug maint [generator\|electrical]` | start a maintenance section |
| `/fb:debug verbose` | verbose content-log output |

Functions (same effects, for command blocks or chat): `/function fb/setup`, `fb/rebuild`, `fb/lobby`, `fb/selftest`,
`fb/debug_overlay`, `fb/tickingareas` (re-create ticking areas), `fb/control_room` (teleport to the control room).

## Control-room developer panel

Underground at world y −59, x 26-44, z 166 (`/function fb/control_room`): EXIT TO LOBBY, SELF-TEST, DEBUG OVERLAY,
DETERMINISTIC SEED, DEBUG MENU, VALIDATE ROUTES, DUMP STATE, RESPAWN PUPPETS, SKIP HOUR, FULL RESET. Signs label every
module's impulse block and every row's sections; docs/06 lists every block.

## Scenarios (deterministic, seed 4242)

| Name | Night | What it sets up |
|---|---|---|
| `slice` | 0 | vertical slice: short test night, Bonnie only, lethal |
| `boundary` | 2 | Bonnie telegraphing at the left door at 5:59 AM (6 AM must win) |
| `power_zero` | 3 | power at 1 % (reserve lever window) |
| `double` | 3 | Bonnie and Chica telegraph at both doors at once |
| `freddy` | 5 | Freddy stalking the east hall end |
| `fredbear_hatch` | 4 | Fredbear heading for the hatch (close hatch, then strobe) |
| `fredbear_left` | 5 | Fredbear relocating to the west hall (close left door, then strobe) |
| `blackout` | 5 | forced Fredbear blackout |
| `finale` | 6 | Night 6 at 4:58 AM (Golden Hour) |

## Self-test (`/fb:debug selftest`)

Nine checks, each PASS/FAIL with evidence: palette resolves; all 30 structures present in the pack; 177 command blocks
(102 module impulse blocks + 75 inputs) in place; actuator round trip (script → pad → command block → `scriptevent`
back to the script); heartbeat repeating command block reporting; AI routes clear in the built world; camera positions
in open air; exactly one puppet per animatronic; office, stage, chamber and control-room chunks loaded.

## Logs

Warnings and errors go to the content log prefixed `[FB]` (enable *Content Log* in Settings → Creator). The last 200
lines are kept in memory and the last 6 appear in `/fb:debug state`.

## Offline tools (Node 22 + Python 3)

| Command | What it does |
|---|---|
| `npm test` | 49 tests: core simulation (18), command-block structures (6), route guidance (5), integration against the mock runtime (20) |
| `node tools/gen_guide.mjs` | regenerate the player route-guidance graph from the build plan (`scripts/data/guide_graph.generated.js`) |
| `npm run validate` | palette, map, commands, JSON schemas, asset references, Script API types |
| `npm run typecheck` | `tsc` over all scripts against `@minecraft/server` 2.10.0 / `server-ui` 2.2.0 |
| `npm run build` | regenerate everything and package `dist/` |
| `node tools/balance_sim.mjs` | balance tables (docs/05) |
| `node tools/validate_map.mjs` | routes, cameras (voxel ray casts), office seal, walkability, hidden command blocks; writes `tools/out/map_report.json` |
| `python3 tools/render_preview.py` | offline model preview sheet |

### Integration mock (`tests/mock/`)

A headless stand-in for `@minecraft/server` / `server-ui` that runs the **real** pack scripts: voxel world, `.mcstructure`
placement, a command-block executor driven by the actual structure files (impulse/chain/repeating, tick delays, pads),
entities, players, dynamic properties, events, jobs and chunk unloading. It rejects anything the official metadata does
not know (blocks and states, sounds, effects, camera presets, items, entity properties). It is a model of the API, not
Minecraft: rendering, physics, redstone beyond pad-to-impulse and real timing are not simulated.

## Repository layout

```
fredbear-six-nights-below/
  packs/FredbearBP/          behavior pack: manifest, entities, items, functions, structures/fb/*.mcstructure,
                             scripts/ (main.js, core/ simulation + AI, data/ map/nodes/cameras/inputs/actuators/story,
                             mc/ Minecraft adapter: game, builder, bus, puppets, camera view, audio, HUD, UI, debug)
  packs/FredbearRP/          resource pack: entity, models, animations, controllers, render controllers, textures,
                             sounds, fogs, texts
  art/skins/                 the four supplied skins (source art)
  tools/                     generators, validators, simulators, packager; tools/ref = official reference data
  tests/                     node:test suites + tests/mock (integration runtime)
  docs/                      this documentation; floor plans; model previews; command-block register (MD + CSV)
  dist/                      .mcpack / .mcaddon packages + checksums
```

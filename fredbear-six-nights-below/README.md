# FREDBEAR: SIX NIGHTS BELOW

A Five Nights at Freddy's–inspired survival-horror campaign for **Minecraft Bedrock Edition 1.26.50**, built as a
behavior pack + resource pack. The behavior pack constructs the whole map in your own world, installs a 478-block
command-block network from structure files, and runs four animatronics with explainable AI on the stable Script API
(`@minecraft/server` 2.10.0, `@minecraft/server-ui` 2.2.0). No experimental features.

* **Location:** an abandoned family entertainment complex, 200 × 200 blocks, three levels (basement, ground, upper floor),
  62 rooms and spaces, from the parking lot, dining hall and show stage to the sealed original Fredbear's Diner and his hidden chamber.
* **Animatronics:** Freddy (patient stalker), Bonnie (aggressive flanker), Chica (resource pressure) and Fredbear
  (phased central threat with camera disruption, false camera echoes, blackouts, warned relocation, his own power-out, a laugh
  when he starts hunting and flickering office lamps when he is close). Freddy, Bonnie and Chica are built from the supplied
  skins on custom geometry with ears, hats, beak and props; Fredbear is the owner's **Fredbear V6** model with all 12 of its
  animations.
* **Campaign:** training shift, seven nights of 9,600 ticks (8 minutes), mid-night maintenance sections, Night 6 finale and
  ending, **Night 7 — Fredbear's Revenge** with a seal-or-burn final choice, four **challenge modes**, newspaper clippings, an
  intro camera tour, a night 4 flashback, the rare Shadow Fredbear, Halloween and Christmas decorations, persistent unlocks,
  retry, secrets, free roam.
* **Sound:** the owner's recordings for the jumpscares, doors, camera monitor, CCTV hum and laughs, and looping night music
  with an on/off switch in the Shift Guide.
* **Office:** two doors, two hall lights, 16 cameras with a physical map, floor hatch, emergency strobe, breaker, reserve lever,
  power meter, hour lamps, warning indicators, captions.

## Status — read before playing

Everything here was generated and verified **without running Minecraft**: 6 static validators against Mojang's official
1.26.50 metadata and schemas, 66 automated tests, a balance simulator, and an integration harness that runs the real pack
scripts against a mock of the Script API (full build, self-test, tutorial, a complete six-night campaign through the office
buttons, night 7 and both endings, challenges, resets, reloads). The map owner has played version 1.1 in-game up to night 6;
**nothing added in 1.2.0 has been tested in-game yet.** The remaining in-game checks are listed in
[docs/10_TEST_REPORT.md](docs/10_TEST_REPORT.md), and engine behaviour that could not be verified is listed in
[docs/01_COMPATIBILITY.md](docs/01_COMPATIBILITY.md).

No `.mcworld` is included: the map is built inside your world by `/fb:setup` (a valid world archive could not be produced and
validated here).

## Quick start

1. Open `dist/Fredbear_Six_Nights_Below.mcaddon` with Minecraft Bedrock 1.26.50+.
2. New world: **Flat**, **cheats on**, activate **FREDBEAR: Six Nights Below (Behavior)**. Render distance ≥ 11 chunks.
3. In the world: `/fb:setup`, wait for the title, then clock in at the time clock.

**Updating to 1.2.0:** import the new `.mcaddon`, check that both packs show 1.2.0 in the world settings, enter the world
and run `/fb:setup` when asked (the time-clock room changed). Your progress is kept.

Full instructions, controls and troubleshooting: [docs/08_INSTALL_AND_PLAY.md](docs/08_INSTALL_AND_PLAY.md).

## Deliverables

| # | Deliverable | Where |
|---|---|---|
| 1 | Overview and compatibility specification | [docs/01_COMPATIBILITY.md](docs/01_COMPATIBILITY.md) |
| 2 | Floor plan, coordinate registry, route graph | [docs/02_FLOOR_PLAN.md](docs/02_FLOOR_PLAN.md), `docs/floorplan_L*.png` |
| 3 | Project folder structure | [docs/09_DEVELOPER_TOOLS.md](docs/09_DEVELOPER_TOOLS.md#repository-layout) |
| 4 | Behavior-pack and resource-pack source | `packs/FredbearBP/`, `packs/FredbearRP/` |
| 5 | Assets | textures, models, animations, 52 sounds, fogs, icons in `packs/FredbearRP/`; source skins, recordings and the Fredbear V6 model in `art/`; [docs/07](docs/07_CONSTRUCTION.md#resource-pack-assets) |
| 6 | Command-block placement and configuration register | [docs/06_COMMAND_BLOCK_REGISTER.md](docs/06_COMMAND_BLOCK_REGISTER.md), `docs/command_blocks.csv` |
| 7 | Construction procedure | [docs/07_CONSTRUCTION.md](docs/07_CONSTRUCTION.md) (automatic builder + manual fallback) |
| 8 | Playable package | `dist/*.mcpack`, `dist/Fredbear_Six_Nights_Below.mcaddon` (no `.mcworld`, see above) |
| 9 | Installation and player instructions | [docs/08_INSTALL_AND_PLAY.md](docs/08_INSTALL_AND_PLAY.md) |
| 10 | Developer controls and diagnostics | [docs/09_DEVELOPER_TOOLS.md](docs/09_DEVELOPER_TOOLS.md) |
| 11 | Test results and limitations | [docs/10_TEST_REPORT.md](docs/10_TEST_REPORT.md) |

Design references: [docs/03_ARCHITECTURE.md](docs/03_ARCHITECTURE.md) (ownership, state machine, reset, persistence, chunk
loading), [docs/04_AI_DESIGN.md](docs/04_AI_DESIGN.md) (state machines, detection, Fredbear's powers),
[docs/05_NIGHTS_AND_BALANCE.md](docs/05_NIGHTS_AND_BALANCE.md) (night table, formulas, power maths, simulation results).

## For developers

```
npm install        # dev-only: pinned Script API typings + TypeScript
npm run validate   # static validators
npm test           # 66 tests (core, structures, route guidance, holiday decorations, integration mock)
npm run build      # regenerate structures, register, floor plans, RP assets, docs, dist/
```

## Credits and notices

* Fan-made, non-commercial tribute. *Five Nights at Freddy's* and its characters belong to Scott Cawthon. Minecraft belongs to
  Mojang Studios / Microsoft. This project is not affiliated with or endorsed by either.
* Animatronic skins supplied by the map owner (`art/skins/`). Fredbear V6 model supplied by the map owner
  (`art/models_incoming/`).
* Recorded sounds supplied by the map owner (`art/sounds_incoming/`): the jumpscares, the storm-door slam
  (freesound 161190, volivieri), the metal door (freesound 75826, analog-bleep-ten), the CCTV hum (freesound 740223,
  fossarts), camera open / close and the Freddy and Fredbear laughs. Check each clip's licence before publishing the map.
* Night music: *PIZZA DINNER* from the *FNAF 1 Remake* fan-game soundtrack, supplied by the map owner. It belongs to its
  composer; ask them before sharing the map publicly.
* Every other sound was synthesised for this project by `tools/gen_sounds.py`; Freddy's music box plays Bizet's
  *Toreador March* (1875, public domain).
* Validation references: Mojang `bedrock-samples` v1.26.50.4 metadata and schemas, and one Bedrock-exported structure from the
  Bedrock Wiki (CC BY 4.0 / MIT) used as a test reference (`tools/ref/SOURCE.md`).

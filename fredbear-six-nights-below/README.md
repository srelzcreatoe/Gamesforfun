# FREDBEAR: SIX NIGHTS BELOW

A Five Nights at Freddy's–inspired survival-horror campaign for **Minecraft Bedrock Edition 1.26.50**, built as a
behavior pack + resource pack. The behavior pack constructs the whole map in your own world, installs a 523-block
command-block network from structure files, and runs six animatronics with explainable AI on the stable Script API
(`@minecraft/server` 2.10.0, `@minecraft/server-ui` 2.2.0). No experimental features.

* **Location:** an abandoned family entertainment complex, 200 × 200 blocks, three levels (basement, ground, upper floor),
  62 rooms and spaces, from the parking lot, dining hall and show stage to the sealed original Fredbear's Diner and his hidden chamber.
* **Animatronics:** Freddy (patient stalker), Bonnie (aggressive flanker, vent crawler, bangs on a door so Chica can sneak
  in), Chica (resource pressure, flanks, joins the others at the door) and Fredbear (phased central threat with camera
  disruption, false camera echoes, blackouts, warned relocation, his own power-out, a laugh when he starts hunting and
  flickering office lamps when he is close; on nights 7 and 9 he is everywhere at once). New in 1.3: **Morgrave**, the rabbit
  in the walls (crawls through the duct and the crawlspace), and **Valek**, the gray bear in the dark (only his eyes, steps
  only while unwatched, mimics the others' sounds). Freddy (V6), Bonnie (V2), Fredbear (V6), Morgrave and Valek are the
  owner's models with their own animations plus added crawl / stalk / threat / dormant / look clips; Chica is built from the
  supplied skin. Watched on camera, they slowly turn to stare into the lens; from night 7 the trio look withered.
* **Campaign:** training shift, nine nights of 9,600 ticks (8 minutes), mid-night maintenance sections, Night 6 finale and
  ending, **Night 7 — Fredbear's Revenge** with a seal-or-burn final choice, **Night 8** (Morgrave after the seal ending,
  Valek after the burn ending), **Night 9 — Three Below** (Fredbear, Morgrave and Valek together, whatever ending you chose,
  with its own ending), four **challenge modes**, newspaper clippings, the 1987 security tapes, a sealed 1983 birthday room,
  the wall of names, construction-crew graffiti, an intro camera tour, a night 4 flashback, the rare Shadow Fredbear,
  Halloween and Christmas decorations, persistent unlocks, retry, secrets, free roam.
* **Sound:** the owner's recordings for the jumpscares, doors, camera monitor, CCTV hum, laughs, Fredbear's music box and
  Chica in the kitchen, and looping night music with an on/off switch in the Shift Guide.
* **Office:** two doors, two hall lights, 21 cameras with a physical map and an on-screen FNAF-style camera map, floor hatch,
  vent and shaft seals, emergency strobe, breaker, reserve lever, tape deck, power meter, hour lamps, warning indicators,
  captions.

## Status — read before playing

Everything here was generated and verified **without running Minecraft**: 6 static validators against Mojang's official
1.26.50 metadata and schemas, 76 automated tests, a balance simulator, and an integration harness that runs the real pack
scripts against a mock of the Script API (full build, self-test, tutorial, a complete six-night campaign through the office
buttons, night 7 and both endings, nights 8 and 9 and the night 9 ending, the camera map, the tapes, challenges, resets,
reloads). The map owner played version 1.2 in-game to the end; **nothing added in 1.3.0 has been tested in-game yet.** The remaining in-game checks are listed in
[docs/10_TEST_REPORT.md](docs/10_TEST_REPORT.md), and engine behaviour that could not be verified is listed in
[docs/01_COMPATIBILITY.md](docs/01_COMPATIBILITY.md).

No `.mcworld` is included: the map is built inside your world by `/fb:setup` (a valid world archive could not be produced and
validated here).

## Quick start

1. Open `dist/Fredbear_Six_Nights_Below.mcaddon` with Minecraft Bedrock 1.26.50+.
2. New world: **Flat**, **cheats on**, activate **FREDBEAR: Six Nights Below (Behavior)**. Render distance ≥ 11 chunks.
3. In the world: `/fb:setup`, wait for the title, then clock in at the time clock.

**Updating to 1.3.0:** import the new `.mcaddon`, check that both packs show 1.3.0 in the world settings, enter the world
and run `/fb:setup` when asked (new cameras, the duct, seals and lore rooms are built). Your progress is kept; if you already
beat night 7, night 8 is open.

Full instructions, controls and troubleshooting: [docs/08_INSTALL_AND_PLAY.md](docs/08_INSTALL_AND_PLAY.md).

## Deliverables

| # | Deliverable | Where |
|---|---|---|
| 1 | Overview and compatibility specification | [docs/01_COMPATIBILITY.md](docs/01_COMPATIBILITY.md) |
| 2 | Floor plan, coordinate registry, route graph | [docs/02_FLOOR_PLAN.md](docs/02_FLOOR_PLAN.md), `docs/floorplan_L*.png` |
| 3 | Project folder structure | [docs/09_DEVELOPER_TOOLS.md](docs/09_DEVELOPER_TOOLS.md#repository-layout) |
| 4 | Behavior-pack and resource-pack source | `packs/FredbearBP/`, `packs/FredbearRP/` |
| 5 | Assets | textures, models, animations, 57 sounds, fogs, icons, the camera map HUD in `packs/FredbearRP/`; source skins, recordings and the owner's models in `art/`; [docs/07](docs/07_CONSTRUCTION.md#resource-pack-assets) |
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
npm test           # 76 tests (core, nights 8-9, structures, route guidance, holiday decorations, integration mock)
npm run build      # regenerate structures, register, floor plans, RP assets, docs, dist/
```

## Credits and notices

* Fan-made, non-commercial tribute. *Five Nights at Freddy's* and its characters belong to Scott Cawthon. Minecraft belongs to
  Mojang Studios / Microsoft. This project is not affiliated with or endorsed by either.
* Animatronic skins supplied by the map owner (`art/skins/`). The Fredbear V6, Freddy V6, Bonnie V2, Morgrave and Valek models
  were supplied by the map owner (`art/models_incoming/`). The 1.2 Freddy and Bonnie models are kept in `art/models_archive/`.
* Recorded sounds supplied by the map owner (`art/sounds_incoming/`): the jumpscares, the storm-door slam
  (freesound 161190, volivieri), the metal door (freesound 75826, analog-bleep-ten), the CCTV hum (freesound 740223,
  fossarts), camera open / close, the Freddy and Fredbear laughs, *Fredbear's Family Diner* music box and *Chica in the
  Kitchen* (FNaF sound clips). Check each clip's licence before publishing the map.
* Night music: *PIZZA DINNER* from the *FNAF 1 Remake* fan-game soundtrack, supplied by the map owner. It belongs to its
  composer; ask them before sharing the map publicly.
* Every other sound was synthesised for this project by `tools/gen_sounds.py` (Morgrave's scrape, Valek's hum and vanish
  among them); Freddy's music box plays Bizet's *Toreador March* (1875, public domain).
* Validation references: Mojang `bedrock-samples` v1.26.50.4 metadata and schemas, and one Bedrock-exported structure from the
  Bedrock Wiki (CC BY 4.0 / MIT) used as a test reference (`tools/ref/SOURCE.md`).

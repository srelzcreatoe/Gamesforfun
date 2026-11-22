# Basiliskra

An original survival-horror add-on for Minecraft Bedrock. One creature per save. Basiliskra I, II and III are three stages of the life of one animal, and the story is found by playing an ordinary survival world.

* **Game:** retail Minecraft Bedrock **1.26.60**
* **Script modules:** stable `@minecraft/server` **2.11.0** and `@minecraft/server-ui` **2.3.0** (no Beta APIs)
* **Experiments:** none. **Cheats:** none. **Commands:** none needed.
* **Graphics:** standard Bedrock rendering; Vibrant Visuals supported (PBR texture sets with emissive glow).

> **1.3 is built from the project owner's in-game play of 1.2** (bigger forms, feet that can be hit, slower legs, settings that work on a phone, a journal that counts kills as kills, the atomic breath timed to its recording, roars with a shockwave, wither-like destruction, and an animal that hunts everything). None of 1.3 has been seen in game yet; it was checked without the game: Mojang's published schemas and typings and a simulated world. [docs/TEST_REPORT.md](docs/TEST_REPORT.md) says exactly what was and was not verified.

**Out of control:** Basiliskra III (now drawn 1.7 times his model, about seventy blocks long) goes after players and animals alike, treads on what is underfoot and smashes through buildings. His atomic breath charges for seven seconds and fires for seven and a half, smoking, blasting burning craters and destroying whatever it meets, like the Wither (chests, beds and portals are spared by default). He roars after every breath, at whatever he goes after, and now and then for no reason, and every roar shakes the screen and sends a shockwave across the land.

**Fallout:** his beam, his changes and his seam leave radiation that changes the land (irradiated soil, withering, scarlet trinitite where sand fuses), with Geiger clicks, radiation sickness and a craftable Geiger counter.

In game: a **journal** (how angry he is, as a percentage, and when he will come), a **config wheel** for operators (settings saved with the world; bring, call, send back, reset), a **spawn egg**, and `/basiliskra:spawn`, `/basiliskra:journal`, `/basiliskra:config` (no cheats needed). See the [survival guide](docs/SURVIVAL_GUIDE.md).

## Get it

| File | What it is |
|---|---|
| `dist/Basiliskra-1.3.0.mcaddon` | behaviour pack + resource pack, ready to import |
| `models/basiliskra_i.bbmodel`, `_ii`, `_iii` | the three editable Blockbench models, textures and animations embedded |
| `docs/SURVIVAL_GUIDE.md` | install, what calls him, the three stages, the ending, settings |
| `previews/*.mp4` | reference videos (see below) |

## Previews

These are **offline reference renders of 1.2, not in-game capture**, and have not been rendered again for 1.3 (Form III is shown at his old size, with the old beam and no shockwave). The encounter videos replay a recording of the real behaviour script, run in a simulated world, using the shipped geometry, textures, client animations, particle definitions and sounds. The terrain, sky, rain, stand-in player and boat are drawn by the preview tool.

| Video | Shows |
|---|---|
| `previews/arrival.mp4` | Basiliskra I, one continuous take: the boat knocks three times, the seam opens, he slips through, rams the empty water three times, the left gill sticks, he sinks |
| `previews/window.mp4` | Basiliskra III in a village at night in rain: four footfalls, then one small eye level with the window |
| `previews/beam.mp4` | Basiliskra III: the hide lights tail to head, the beam, the vent; then a second charge led into a lightning rod, and the roar that follows |
| `previews/fallout.mp4` | One white lance into a meadow at dusk, then a minute of what it leaves: motes, ash, soil spreading, trinitite, Geiger clicks |
| `previews/model_i.mp4`, `model_ii.mp4`, `model_iii.mp4` | each model from the left, front, right and back, an eye close-up, its signature motions and (II, III) its roar (scripted property values, no behaviour script) |

## Build

```
npm install                         # typings, esbuild, typescript
python3 tools/build.py              # type-check, bundle, validate both packs, run the scenario suite, package
python3 tools/build.py --assets     # also regenerate models, textures, client files, particles and sounds
```

Requires Node 20+, Python 3.10+ with `numpy` and `Pillow`, and `ffmpeg` for sounds and previews.

```
node test/run.mjs                   # scenario suite in the simulated world
node test/perf.mjs                  # engine calls per tick, per situation
python3 tools/validate/validate.py  # schemas and reference integrity of both packs
node test/record.mjs                # record the encounter replays
node tools/preview/scenes.cjs arrival && python3 tools/preview/mix_audio.py arrival --bed water
```

More: [docs/DESIGN.md](docs/DESIGN.md) (how it works and what stands in for what stable Bedrock lacks), [docs/MODEL_KIT.md](docs/MODEL_KIT.md) (changing the models), [docs/SOUNDS.md](docs/SOUNDS.md) (every sound and how it is made).

## Originality

The creature, its models, textures, animations, particles and story are original to this project, and are generated by the tools in this repository; no game files or third-party art are included. Vanilla sounds are only *played* (the remembered call of an animal that was killed), never shipped.

Sounds: 67 of the 85 files are synthesised by `tools/sound/synth.py`. The other 18 are cut from three recordings supplied by the project owner (`tools/sound/source/`): his **roar** (the whole roar, a short bellow, the roar through water), his **atomic breath** (the charge and the shot, cut where one becomes the other) and his **voice** (thirteen grunts, growls and breaths, four of them through water). Where those recordings came from, and the right to distribute them, is for the project owner to confirm before the add-on is published.

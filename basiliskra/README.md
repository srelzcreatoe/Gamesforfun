# Basiliskra

An original survival-horror add-on for Minecraft Bedrock. One creature per save. Basiliskra I, II, III and IV are stages of the life of one animal, and the story is found by playing an ordinary survival world.

* **Game:** retail Minecraft Bedrock **1.26.60**
* **Script modules:** stable `@minecraft/server` **2.11.0** and `@minecraft/server-ui` **2.3.0** (no Beta APIs)
* **Experiments:** none. **Cheats:** none. **Commands:** none needed.
* **Graphics:** standard Bedrock rendering; Vibrant Visuals supported (PBR texture sets with emissive glow).

> **1.7**: **his breath leaves his open mouth** (the jaw drops as he charges; the beam starts in the middle of the gap) and is **as wide as the form that fires it**, drawn in new layers: white-hot core, plasma, fire, light racing down it, rings, lightning, smoke and embers. **Form IV's palms face inward.** The **Seam Lance** is held in the hand, half as big again, and fires a **thick red laser**. Every footfall sends a **shock rolling on ahead of him** that breaks what stands in front. He **tilts his head back and leads what flies** (the Wither, the Ender Dragon, ghasts). **Cities are half as big again** and **no longer lag** as they are built (at most 6,000 blocks and 4 ms a tick), and their streets are full of **townspeople** of their own who **run when they see a giant**. Called with the wheel, **the rift opens out in deep water off a beach, clear of every block**, and he wades ashore; each form has its own arrival shots.
>
> **1.6.2**: **each of his three changes is now a scene of its own**: the water boils (I to II), the sky comes down (II to III), he burns through and his wings tear open (III to IV), each with its own events, length and camera.
>
> **1.6**: **a change now waits on time only** (set the minutes yourself), and every change is a **cinematic scene shot close**: five shots that keep him in the picture. With nothing alive in reach he **goes to the nearest village or city and walks through it**. The pack **raises cities** on real coasts and wherever an operator asks: towers, streets, people, a beach he can walk up, and beyond it a **sea cut a hundred blocks deep** with its own blocks and things on the bottom. There is a gun made for him, the **Seam Lance**. And there is the **Titan**: a separate, far stronger Basiliskra IV for battles in Creative (up to three; they fight each other, and him, with breath, jaws, tail and weight, and they can be killed).
>
> **1.5 brings Basiliskra IV into the game**: the last form, upright and winged, fifty-five blocks tall. He walks across the world emptying whatever is in his way, every footfall a crater; his breath reaches 150 blocks; he stares players to a crawl; and he has six habits of his own (his first roar after his first beam, the turn on his buried club, the misfire through his wing veins, the seabed hauled ashore, the broken plate that throws his beam, the charge he swallows). **1.4** fixed what the project owner found playing 1.3 and added the rift, the cutscenes, fallout that glows and goes, and three themes. **Neither 1.4 nor 1.5 has been seen in game yet**: both were checked without the game, against Mojang's published schemas and typings and in a simulated world. [docs/TEST_REPORT.md](docs/TEST_REPORT.md) says exactly what was and was not verified; the owner's brief is [docs/FORM_IV_PLAN.md](docs/FORM_IV_PLAN.md).

**Out of control:** Basiliskra III (now drawn 1.7 times his model, about seventy blocks long) goes after players and animals alike, treads on what is underfoot and smashes through buildings. His atomic breath charges for seven seconds and fires for seven and a half, smoking, blasting burning craters and destroying whatever it meets, like the Wither (chests, beds and portals are spared by default). He roars after every breath, at whatever he goes after, and now and then for no reason, and every roar shakes the screen and sends a shockwave across the land.

**Fallout:** his beam, his changes and his rift leave radiation that spreads for a minute, stands, then fades and heals within minutes. While it lasts the ground glows (irradiated soil and rock, crimson crystals, glowing slag where the beam lands, scarlet trinitite where sand fuses), the air turns red, and it is strong: sickness at once, burns in the heart of it. Iodine tablets, a Geiger counter, crimson shards and a shard lamp are craftable.

**Music:** three themes of his own ("He is near", "He is fighting", "The last form"), about two and three quarter minutes each, written and rendered for this pack from code (modelled strings, brass, choir, percussion and organ in a synthetic hall; no samples, nothing borrowed).

In game: a **journal** (how angry he is, as a percentage, when he will come, and the minutes left before he changes), a **config wheel** for operators (settings saved with the world; bring, call, send back, reset, raise a city, put down or remove Titans), **spawn eggs** for him and for the Titan, and `/basiliskra:spawn`, `/basiliskra:titan`, `/basiliskra:city`, `/basiliskra:journal`, `/basiliskra:config` (no cheats needed). See the [survival guide](docs/SURVIVAL_GUIDE.md).

## Get it

| File | What it is |
|---|---|
| `dist/Basiliskra-1.7.0.mcaddon` | behaviour pack + resource pack, ready to import |
| `models/basiliskra_i.bbmodel`, `_ii`, `_iii`, `_iv` | the four editable Blockbench models, textures and animations embedded |
| `docs/SURVIVAL_GUIDE.md` | install, what calls him, the four stages, cities, the Seam Lance, the Titan, the ending, settings |
| `previews/*.mp4` | reference videos (see below) |

## Previews

**`previews/basiliskra_animations.mp4`** is an animation reel of all four forms (2 min 22 s, with sound): each form is played through its phases from the shipped model, textures and client animation, and the pack's own recordings are laid in at the moments the script would play them, so the jaw can be watched against the roar. The ground, the camera, the scale figure and the drawn beam are the preview tool's (`tools/preview/anim.cjs`); particles are not drawn. It is an offline render, not in-game capture.

**`previews/titan_moves.mp4`** (40 s, with sound) plays the Titan through what only it does, driven by its own client entity: at rest with its seams lit, walking, the lunge from two sides, the tail to each side, a shortened charge and the breath, the stagger, and going down as its fire fails (`node tools/preview/anim.cjs --forms titan`). Like the reel above it is an offline render, not in-game capture.

**`previews/transformations.mp4`** (about a minute, with sound) plays him through the three changes as the script poses him, with the pack's sounds where the script plays them (`node tools/preview/anim.cjs --forms c1a,c1b,c2a,c2b,c3a,c3b`). What the script adds in the world (the boiling sea, the bolts, the smoke, the glass in the ground) and the game's own thunder are not in it, and the camera is the preview tool's, not the cutscene's.

New for 1.7 (offline renders from the shipped files, not the game): **`previews/breath.mp4`** (10 s, with sound: Basiliskra III's breath cut close, from the recording of the real script, with the new particles: it leaves his open jaw), **`previews/seam_lance_held.png`** (the gun in a player's hand in first and third person, with the hold the pack ships), **`previews/civilians.png`** (the twelve townspeople, calm and frightened), **`previews/form_iv_hands.png`** (Basiliskra IV's hands, palms in) and **`previews/city_plan.png`** (drawn again for the bigger city). How the game binds a held item is worked out from the vanilla trident's files, not seen: the hold in the game may differ from the picture.

Stills for 1.6 (offline renders and drawings, not the game): **`previews/titan_poses.png`** (the Titan at rest, its lunge, its tail, its fall, from the shipped model and pose), **`previews/seam_lance.png`** (the gun, from its shipped model and texture) and **`previews/city_plan.png`** (a full city drawn from the list of blocks the script places: a plan from above and a section through the beach and the deep).

These are **offline reference renders of 1.2, not in-game capture**, and have not been rendered again since (Form III is shown at his old size, with the old beam and no shockwave, rift or fallout glow). The encounter videos replay a recording of the real behaviour script, run in a simulated world, using the shipped geometry, textures, client animations, particle definitions and sounds. The terrain, sky, rain, stand-in player and boat are drawn by the preview tool.

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

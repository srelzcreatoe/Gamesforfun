# Minecraft-style FNAF models

These are Blockbench models in the **Bedrock Entity** format, each built from a reference picture and ready for a FNAF addon.

| Character | Folder | Animations |
| --- | --- | --- |
| Bonnie | [`bonnie/`](bonnie/README.md) | idle, walk, run, pose 1–2, performance 1–2 (banjo) |
| Freddy (classic) | [`freddy/`](freddy/README.md) | idle, walk, run, pose 1–2, performance 1–2 (mic), jumpscare 1–2 |
| Withered Freddy | [`withered_freddy/`](withered_freddy/README.md) | idle, walk, run, pose 1–2, performance 1–2, jumpscare 1–2 |
| Party Cat | [`party_cat/`](party_cat/README.md) | idle, walk, run, pose 1–2, performance 1–2 (bell), jumpscare 1–2 |
| Rat | [`rat/`](rat/README.md) | idle, walk, run, pose 1–2, performance 1–2 (mic), jumpscare 1–2 |
| Monkey | [`monkey/`](monkey/README.md) | idle, walk, run, pose 1–2, performance 1–2 (cymbal clap, chest drum), jumpscare 1–2 |
| Bat | [`bat/`](bat/README.md) | idle, walk, run, pose 1–2, performance 1–2 (wing song, screech), jumpscare 1–2 |
| Crocodile | [`crocodile/`](crocodile/README.md) | idle, walk, run, pose 1–2, performance 1–2 (soft-shoe, snap song), jumpscare 1–2 |
| Fox | [`fox/`](fox/README.md) | idle, walk, run, pose 1–2, performance 1–2 (sea shanty, hook fight), jumpscare 1–2 |
| Bunny | [`bunny/`](bunny/README.md) | idle, walk, run, pose 1–2, performance 1–2 (air guitar, hop dance), jumpscare 1–2 |
| Goat | [`goat/`](goat/README.md) | idle, walk, run, pose 1–2, performance 1–2 (bleating laugh, stomp dance), jumpscare 1–2 |
| Bear | [`bear/`](bear/README.md) | idle, walk, run, pose 1–2, performance 1–2 (conducting, slow clap), jumpscare 1–2 |
| Golden Freddy | [`golden_freddy/`](golden_freddy/README.md) | idle, limping walk, run, pose 1–2 (slumped sit), performance 1–2 (music box, endo piano), jumpscare 1–2 ("IT'S ME", head twist) |
| Crimson Freddy | [`crimson_freddy/`](crimson_freddy/README.md) | idle, stomping walk, charging run, pose 1–2 (boxer), performance 1–2 (rock song, belly laugh), jumpscare 1–2 (bear hug, fist slam) |
| Violet Bunny | [`violet_bunny/`](violet_bunny/README.md) | idle, skipping walk, hopping run, pose 1–2 (wave), performance 1–2 (slap bass, side-step dance), jumpscare 1–2 (pounce, peek-in) |
| Rustgrin | [`rustgrin/`](rustgrin/README.md) | idle, proud march, charging run, pose 1–2 ("ladies and gentlemen"), performance 1–2 (bowing song, soft-shoe), jumpscare 1–2 (claw lunge, grinding head turn) |
| Mirehop | [`mirehop/`](mirehop/README.md) | idle, sneaking walk, lurching run, pose 1–2 (peek and beckon), performance 1–2 (air guitar, hop dance), jumpscare 1–2 (pounce, dead-then-lunge) |
| Noxbriar | [`noxbriar/`](noxbriar/README.md) | idle, gliding walk, run, pose 1–2 (looming), performance 1–2 (conducting, music-box waltz), jumpscare 1–2 (head tilt then lunge, arms crash down) |

**Ready-to-play add-on:** [`addon/FNAF_Animatronics.mcaddon`](addon/README.md) has all 15 characters in one resource pack + behavior pack, with spawn eggs and events for the poses, performances and jumpscares. See [`addon/README.md`](addon/README.md) for install steps and commands. [`addon/FNAF_Six.mcaddon`](addon/README.md) is a smaller, separate add-on with just Bonnie, Freddy, Withered Freddy, Rustgrin, Mirehop and Noxbriar.

Each folder contains:

- `<name>.bbmodel`: open it in Blockbench (**File → Open Model**). The animations are in the Animate tab.
- `preview/<name>_preview.mp4` and `preview/<name>_sheet.png`
- `bedrock/`: resource-pack files (geometry, animations, client entity, render controller, animation controller, textures). They match Blockbench's own Bedrock export.

Everyone except Bonnie moves like an animatronic at night: every part moves like its own servo, snapping to a position and holding it (see `tools/fnafkit/servo.py`). The ten newest characters (Monkey to Violet Bunny) each have their own walk, run, poses, performances and jumpscares, so no two of them move alike.

Every `.bbmodel` was loaded in Blockbench 5.2.2 (web) with no errors. Its *Export Bedrock Geometry / Animations* output is identical to the files in `bedrock/`.

## Tools

```
tools/
  pack.py             python3 tools/pack.py  -> addon/FNAF_Animatronics.mcaddon (all characters)
                      python3 tools/pack.py --pack FNAF_Six bonnie freddy withered_freddy rustgrin mirehop noxbriar
                                          -> addon/FNAF_Six.mcaddon (a separate pack with just those)
  build.py            python3 tools/build.py [bonnie freddy withered_freddy party_cat rat
                                       monkey bat crocodile fox bunny goat bear
                                       golden_freddy crimson_freddy violet_bunny
                                       rustgrin mirehop noxbriar]
  fnafkit/            shared code: rig, texture painting + baked shading (rig.py), keyframes + IK (anim.py),
                      animatronic servo motion (servo.py), .bbmodel / Bedrock export (export.py)
  characters/         geometry, textures and animations: bonnie.py, freddy.py (both Freddys),
                      body.py (shared voxel frame), trio.py (Party Cat, Rat),
                      cast.py + cast_anims.py (Monkey, Bat, Crocodile, Fox, Bunny, Goat, Bear),
                      fred3.py + fred3_anims.py (Golden Freddy, Crimson Freddy, Violet Bunny),
                      vested.py + vested_anims.py (Rustgrin, Mirehop, Noxbriar, built on fred3's parts),
                      night.py (shared animatronic clips)
  render/             three.js preview renderer (render.mjs), character sheets (make_sheet.py)
                      and per-character camera/text configs (configs/)
```

```bash
python3 tools/build.py                       # rebuild every model (IK results are cached in tools/.cache/)
cd tools/render && npm install               # three.js + playwright, once
node render.mjs freddy video                 # -> freddy/preview/freddy_preview.mp4
python3 make_sheet.py freddy                 # -> freddy/preview/freddy_sheet.png
```

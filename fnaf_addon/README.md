# Minecraft-style FNAF models

These are Blockbench models in the **Bedrock Entity** format, each built from a reference picture and ready for a FNAF addon.

| Character | Folder | Animations |
| --- | --- | --- |
| Bonnie | [`bonnie/`](bonnie/README.md) | idle, walk, run, pose 1–2, performance 1–2 (banjo) |
| Freddy (classic) | [`freddy/`](freddy/README.md) | idle, walk, run, pose 1–2, performance 1–2 (mic), jumpscare 1–2 |
| Withered Freddy | [`withered_freddy/`](withered_freddy/README.md) | idle, walk, run, pose 1–2, performance 1–2, jumpscare 1–2 |

Each folder contains:

- `<name>.bbmodel`: open it in Blockbench (**File → Open Model**). The animations are in the Animate tab.
- `preview/<name>_preview.mp4` and `preview/<name>_sheet.png`
- `bedrock/`: resource-pack files (geometry, animations, client entity, render controller, animation controller, textures). They match Blockbench's own Bedrock export.

Every `.bbmodel` was loaded in Blockbench 5.2.2 (web) with no errors. Its *Export Bedrock Geometry / Animations* output is identical to the files in `bedrock/`.

## Tools

```
tools/
  build.py            python3 tools/build.py [bonnie freddy withered_freddy]
  fnafkit/            shared code: rig + texture painting (rig.py), keyframes + IK (anim.py),
                      .bbmodel / Bedrock export (export.py)
  characters/         one module per character: geometry, textures and animations
  render/             three.js preview renderer (render.mjs), character sheets (make_sheet.py)
                      and per-character camera/text configs (configs/)
```

```bash
python3 tools/build.py                       # rebuild every model (IK results are cached in tools/.cache/)
cd tools/render && npm install               # three.js + playwright, once
node render.mjs freddy video                 # -> freddy/preview/freddy_preview.mp4
python3 make_sheet.py freddy                 # -> freddy/preview/freddy_sheet.png
```

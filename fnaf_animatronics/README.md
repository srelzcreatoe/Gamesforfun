# FNAF animatronics: Bramble, Hollis, Gildric

Blockbench models (Bedrock entity format) for a Minecraft FNAF add-on, built from the three
reference renders in `source/references/`.

| Character | What it is | Cubes | Bones | Texture |
|---|---|---|---|---|
| **Bramble** | purple rabbit, one upright ear and one folded ear | 135 | 20 | 256×256 |
| **Hollis** | red-brown bear with top hat | 150 | 20 | 256×256 |
| **Gildric** | withered golden bear with top hat and open endoskeleton hands | 204 | 28 (incl. finger bones) | 512×256 |

All three use the same scale as the pictures (40 image px = 1 Blockbench pixel), so they keep
the same size relative to each other. Each one is about 37.5 px tall (≈ 2.35 blocks).

## Open in Blockbench

1. In Blockbench, choose **File → Open Model** and pick a file in `blockbench/`
   (`bramble.bbmodel`, `hollis.bbmodel`, `gildric.bbmodel`).
   The texture and all animations are embedded in the file.
2. Switch to the **Animate** tab to play the animations.
3. To export for your add-on, use **File → Export → Export Bedrock Geometry** and
   **Animation → Export Animations**. The same exports are already in `bedrock/`.

## Ready-made Bedrock files (`bedrock/`)

```
bedrock/models/entity/<name>.geo.json      geometry.<name>
bedrock/animations/<name>.animation.json   animation.<name>.<anim>
bedrock/textures/entity/<name>.png
```

Copy these into your resource pack, then point your client entity at `geometry.<name>`,
`textures/entity/<name>` and the animation names below.

## Animations (all three characters)

| Animation | Length | Loop | Notes |
|---|---|---|---|
| `animation.<name>.idle` | 4.0 s | loop | breathing, head sway, ear and finger twitches |
| `animation.<name>.walk` | 1.2 s | loop | heavy animatronic walk, in place |
| `animation.<name>.run` | 0.64 s | loop | forward lean, pumping arms, in place |
| `animation.<name>.jumpscare` | 1.6 s | hold on last frame | lunge forward, jaw drops open, violent head shake |
| `animation.<name>.pose_1` | 2.0 s | loop | show-stopper: arm raised to the crowd, other hand on hip |
| `animation.<name>.pose_2` | 4.0 s | loop | menacing stare: hunched, slow head tilt |
| `animation.<name>.perform_1` | 2.0 s | loop | singing: sways to the beat, "mic" hand, mouth sings |
| `animation.<name>.perform_2` | 1.6 / 3.2 / 2.4 s | loop | Bramble: air-guitar solo · Hollis: hat tip and bow · Gildric: broken marionette dance |

Walk and run stay in place; movement comes from the entity, as usual for add-ons.

## Bones

`root > body > torso > head > jaw`, plus `hat` (bears), `ear_right` / `ear_left`
(Bramble also has `ear_left_tip`), `arm_* > forearm_* > hand_*` and `leg_* > shin_* > foot_*`.
Gildric's hands also have `finger1_*`, `finger2_*`, `finger3_*` and `thumb_*`.
`_right` / `_left` are the character's own right and left.

## How close it is to the pictures

The front of every model was fitted to the reference picture. Its silhouette overlaps the picture by about
90–92%, and the front textures are taken from the picture itself. See
`preview/compare_front.png`; the remaining difference is mostly one-pixel stair-steps along
the edges.

The pictures only show the front, so the depth of every part, the sides and the back are my
best inference in the same voxel style.

## Preview

`preview/fnaf_animatronics_preview.mp4` shows a turntable, every animation on all three
characters, jumpscare close-ups, and the reference-vs-model comparison.

## Regenerating

`source/` contains the generator. `build.py` measures each part from the reference image,
builds the cubes, projects the picture onto the front faces and writes the files:

```
cd source && python3 build.py bramble hollis gildric
```

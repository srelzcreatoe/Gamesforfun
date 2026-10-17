# FNAF animatronics: Bramble, Hollis, Gildric

Blockbench models (Bedrock entity format) for a Minecraft FNAF add-on, built to the proportions
of the three reference renders in `source/references/`. Every cube is placed by hand in
half-pixel steps, and every texture is designed pixel art (palette colours with per-pixel
shading, plus drawn details such as eye sockets, whisker dots, teeth, suspenders and stains).
Nothing is projected from the pictures.

| Character | What it is | Cubes | Bones | Texture |
|---|---|---|---|---|
| **Bramble** | purple rabbit, one upright ear and one folded ear | 117 | 20 | 256×128 |
| **Hollis** | red-brown bear with top hat | 126 | 20 | 256×128 |
| **Gildric** | withered golden bear with top hat and open endoskeleton hands | 160 | 28 (incl. finger bones) | 256×128 |

All three use the same scale as the pictures (40 image px = 1 Blockbench pixel), so they keep
the same size relative to each other. Each one is about 37.5 px tall (≈ 2.35 blocks).
Textures are 2 texture pixels per Blockbench pixel. Every limb joint has a small endoskeleton
cube centred on its pivot, so bending never opens a hole, and no two visible faces overlap in
the same plane (no z-fighting).

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
| `animation.<name>.idle` | 4.0 s | loop | breathing, looks around, jaw twitch, ear and finger twitches |
| `animation.<name>.walk` | 1.6 s | loop | heavy animatronic stomp with heel-strike and push-off, in place |
| `animation.<name>.run` | 0.8 s | loop | forward lean, high knees, pumping arms, in place |
| `animation.<name>.jumpscare` | 1.5 s | hold on last frame | pulls back, lunges forward, jaw drops open, violent head shake |
| `animation.<name>.pose_1` | 2.4 s | loop | show-stopper: arm thrown up and waving, other hand on hip |
| `animation.<name>.pose_2` | 4.0 s | loop | menacing stare: hunched, slow head tilt |
| `animation.<name>.perform_1` | 2.0 s | loop | singing at 120 bpm: sways, "mic" hand at the mouth, mouth sings, foot taps |
| `animation.<name>.perform_2` | 1.6 / 3.2 / 2.4 s | loop | Bramble: air-guitar solo · Hollis: hat tip and bow · Gildric: broken marionette dance |

Walk and run stay in place; movement comes from the entity, as usual for add-ons.

## Bones

`root > body > torso > head > jaw`, plus `hat` (bears), `ear_right` / `ear_left`
(Bramble also has `ear_left_tip`), `arm_* > forearm_* > hand_*` and `leg_* > shin_* > foot_*`.
Gildric's hands also have `finger1_*`, `finger2_*`, `finger3_*` and `thumb_*`.
`_right` / `_left` are the character's own right and left.

## How close it is to the pictures

Part sizes and positions were measured from each reference picture and rebuilt as clean
cubes, so the outlines match the pictures closely from the front. `preview/compare_front.png`
shows each reference next to the model's front, 3/4 and back views. The pictures only show the
front, so the depth of every part, the sides and the back are my best inference in the same
blocky style.

## Preview

`preview/fnaf_animatronics_preview.mp4` shows a turntable, every animation on all three
characters, jumpscare close-ups, and the reference-vs-model comparison.

## Regenerating

`source/` contains the generator: `spec2_<name>.py` lists every cube and its palette,
`rig2.py` is the shared body, `anims2.py` holds the keyframes, and `zcheck.py` reports any
z-fighting faces.

```
cd source && python3 build.py bramble hollis gildric
```

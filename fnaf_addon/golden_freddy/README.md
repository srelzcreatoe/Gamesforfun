# Golden Freddy: Minecraft-style FNAF model

This is a Blockbench model of Golden Freddy built from your Golden Freddy picture, in the **Bedrock Entity** format.

Every part was measured from the picture at one shared scale (26 picture pixels = 1 model pixel), the same scale used for the other two characters from that set. No part is enlarged or shrunk: each keeps the size it has in the picture, and so does the character.

To make it a replica, the model's exact front outline was then laid over the picture's outline, and every limb, the chest, the legs, the ears and the hat were fitted until they lined up. The two outlines now overlap by 80%, and the inner edges (where the arms meet the chest, the joints, the face) were checked against the picture too. Every colour was matched by rendering the model under a front light like the picture's and sampling it at the same spots.

It includes:

- 455 cubes and 43 bones
- a 1024×1024 texture painted at 4 texels per model pixel (the eyes at 32, so they keep every detail), in half-pixel squares of colour with a fine grain and scattered dark specks, like the picture (no tile or brick edges)
- soft light and shadow baked into the texture: every block darkens toward its edges and where it meets the next part, so the model looks rounded and shaded like the picture, in Blockbench and in Minecraft too
- 9 animations in an animatronic style: idle, walk, run, pose 1, pose 2, performance 1, performance 2, jumpscare 1 and jumpscare 2

![sheet](preview/golden_freddy_sheet.png)

## Files

| File | What it is |
| --- | --- |
| `golden_freddy.bbmodel` | **Open this in Blockbench.** It contains the geometry, the embedded texture and all 9 animations. |
| `preview/golden_freddy_preview.mp4` | Preview video: turnaround, close-ups, then every animation |
| `preview/golden_freddy_sheet.png` | Character sheet |
| `textures/golden_freddy.png` | Texture atlas (the same one embedded in the .bbmodel) |
| `textures/golden_freddy_emissive.png` | Glow mask for the eyes |
| `bedrock/` | Resource-pack-ready files. They match Blockbench's own *Export Bedrock Geometry / Animations* output. |

## What's on the model

- **Fur:** golden orange with small dark specks, a lighter tan belly
- **Head:** a black top hat; round ears with a dark ring and a lighter centre; big round black eye sockets filled by glossy black eyeballs, as in the picture: a small dull red-brown iris with a dark ring and pupil, a white glint, a pale halo round the iris and white reflections along the bottom of each socket; raised brow blocks above the eyes; black wires running down from the eyes over the muzzle; a tan muzzle split down the middle with a big black nose; a row of grey teeth
- **Chest:** a black bow tie and two round black buttons
- **Hands:** working endoskeleton hands, palms facing the legs: a furry back of the hand with two tendon rods, three bare fingers hanging in a row and a thumb in front, each a chain of golden blocks on black ball joints. Every segment has its own bone, so the hands make fists, spread, point and play
- **Arms and legs:** rounded shoulder caps beside the jaw; the upper arms angle out from dark ball joints and the forearms hang almost straight down; chunky thighs and shins on dark knee joints. Every limb block has its corners cut back in steps, like the picture
- **Feet:** big three-toed feet on a dark sole, each centred under its leg

## Rig

```
root
├─ body (pelvis)
│  └─ torso (chest, belly, bow tie, buttons, neck)
│     ├─ head ─ jaw, eyes, rightEar, leftEar, hat
│     ├─ rightArm ─ rightForearm ─ rightHand ─ rightFinger1a ─ 1b ─ 1c (one chain per finger), rightThumba ─ b
│     └─ leftArm  ─ leftForearm  ─ leftHand  ─ leftFinger1a ─ 1b ─ 1c ..., leftThumba ─ b
├─ rightLeg ─ rightShin ─ rightFoot
└─ leftLeg  ─ leftShin  ─ leftFoot
```

The hands hang with the palm facing the leg and the thumb in front (the hand bone is turned a quarter about Y). Each finger is a chain of three bones (`rightFinger1a`, `rightFinger1b`, `rightFinger1c`, ..., outermost finger first and the index finger last) and the thumb has two (`rightThumba`, `rightThumbb`). None of them has a rest rotation, so a positive X rotation bends any joint straight back into a fist and a Z rotation on the first bone spreads a finger.

## Animations

All nine clips move like an animatronic at night. Each part is driven like its own servo: it jumps to a new position, stops dead with a small overshoot, and holds. Keyframes are linear on Blockbench's 24 fps grid, so the holds stay perfectly still. In every clip, the feet stay on the ground. A broken, haunted suit: long dead holds broken by glitch snaps, arms that hang and swing like dead weight.

| Animation | Length | Notes |
| --- | --- | --- |
| `animation.golden_freddy.idle` | 6.0 s loop | Slumped and limp: the head hangs, snaps up to stare straight at you and holds while the jaw creaks open, then creaks over sideways much too far; servo glitches, a power flicker, fingers flexing |
| `animation.golden_freddy.walk` | 2.2 s loop | A dragging limp: the right leg steps, the left drags its toes along the floor, the body sinks onto it and the arms swing late like dead weight |
| `animation.golden_freddy.run` | 1.0 s loop | Pitched far forward, staring up at you, the arms trailing limp behind with the fingers splayed |
| `animation.golden_freddy.pose1` | 3.0 s loop | The picture: standing upright; the head slowly tips over to one side and back, a finger twitches |
| `animation.golden_freddy.pose2` | 3.0 s loop | The slump: sitting on the floor, legs out in front, head hanging to one side |
| `animation.golden_freddy.performance1` | 4.8 s loop | A music-box figurine: the whole body turns in ratchet clicks while one hand beckons, the fingers curling in one after another |
| `animation.golden_freddy.performance2` | 4.0 s loop | Plays an invisible piano, both hands out in front, each finger striking its own key |
| `animation.golden_freddy.jumpscare1` | 1.3 s, plays once | "IT'S ME": dead still, then in two frames he is in your face, jaw wide, shaking and glitching, the clawed hands coming up at you |
| `animation.golden_freddy.jumpscare2` | 1.7 s, plays once | Powers down, then the head twists round sideways to look at you... snaps straight, and he lunges with both arms grabbing at you |

## Using it in a Bedrock addon

It's included in the combined add-on, [`../addon/FNAF_Animatronics.mcaddon`](../addon/README.md), with spawn eggs and events. To use it in your own resource pack instead, copy `bedrock/` into it:

| Copy | To |
| --- | --- |
| `models/entity/` | `RP/models/entity/` |
| `animations/` | `RP/animations/` |
| `animation_controllers/` | `RP/animation_controllers/` |
| `render_controllers/` | `RP/render_controllers/` |
| `entity/` | `RP/entity/` |
| `textures/entity/golden_freddy/` | `RP/textures/entity/golden_freddy/` |

- **Identifier:** the client entity uses `fnaf:golden_freddy`. If your addon uses a different namespace, change it to match.
- **Glowing eyes:** the client entity uses `golden_freddy_glow.png` with the `entity_emissive_alpha` material. Golden Freddy's dull eyes don't glow, as in the picture.
- **Size:** about 3.1 blocks to the top of the head and 3.4 blocks to the top of the hat.
- **Movement:** the animation controller plays idle, walk or run based on `query.ground_speed`.
- **Poses, performances and jumpscares:** these play when the behavior entity's `minecraft:mark_variant` value is set:

| mark_variant | Animation |
| --- | --- |
| 1 | pose1 |
| 2 | pose2 |
| 3 | performance1 |
| 4 | performance2 |
| 5 | jumpscare1 |
| 6 | jumpscare2 |

The jumpscares play once. After one finishes, set `mark_variant` back to 0 so the character returns to idle.

## How close is it to the reference?

These match the picture:

- every size and position, measured in picture pixels from the front view
- the colours, sampled from it
- every part listed above

These differ:

- The picture shows only the front, so the depths (front to back) are estimated from the widths.
- The fur is a procedural pattern of little blocks in the picture's colours, not a pixel copy of the picture.
- Only soft shading is baked into the texture, not the picture's coloured side lights, so the model looks right from every side.
- The black wires under the eyes are thin straight strips.
- The animations are my own, since the reference is a single pose. Pose 1 recreates the pose in the picture.
- The hands are built to work (fists, pointing, spreading) rather than to copy the picture's hand pose, and the feet sit straight under the legs.

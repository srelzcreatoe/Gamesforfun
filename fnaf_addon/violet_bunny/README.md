# Violet Bunny: Minecraft-style FNAF model

This is a Blockbench model of Violet Bunny built from your purple bunny picture, in the **Bedrock Entity** format.

Every part was measured from the picture at one shared scale (26 picture pixels = 1 model pixel), the same scale used for the other two characters from that set. No part is enlarged or shrunk: each keeps the size it has in the picture, and so does the character.

To make it a replica, the model's exact front outline was then laid over the picture's outline, and every limb, the chest, the legs, the ears and the hat were fitted until they lined up. The two outlines now overlap by 88%, and the inner edges (where the arms meet the chest, the joints, the face) were checked against the picture too. Every colour was matched by rendering the model under a front light like the picture's and sampling it at the same spots.

It includes:

- 430 cubes and 49 bones
- a 1024×1024 texture painted at 4 texels per model pixel (the eyes at 32, so they keep every detail), in half-pixel squares of colour with a fine grain and scattered dark specks, like the picture (no tile or brick edges)
- soft light and shadow baked into the texture: every block darkens toward its edges and where it meets the next part, so the model looks rounded and shaded like the picture, in Blockbench and in Minecraft too
- 9 animations in an animatronic style: idle, walk, run, pose 1, pose 2, performance 1, performance 2, jumpscare 1 and jumpscare 2

![sheet](preview/violet_bunny_sheet.png)

## Files

| File | What it is |
| --- | --- |
| `violet_bunny.bbmodel` | **Open this in Blockbench.** It contains the geometry, the embedded texture and all 9 animations. |
| `preview/violet_bunny_preview.mp4` | Preview video: turnaround, close-ups, then every animation |
| `preview/violet_bunny_sheet.png` | Character sheet |
| `textures/violet_bunny.png` | Texture atlas (the same one embedded in the .bbmodel) |
| `textures/violet_bunny_emissive.png` | Glow mask for the eyes |
| `bedrock/` | Resource-pack-ready files. They match Blockbench's own *Export Bedrock Geometry / Animations* output. |

## What's on the model

- **Fur:** purple with small darker specks, a pale lilac belly
- **Head:** his right ear stands up, tilted out; the left ear rises a little and then folds down outward at a chrome hinge, as in the picture; both ears have pale inner panels. A head that widens gradually from a rounded top, as in the picture; a flat lilac face plate around the eyes; round sockets filled by glossy black eyeballs with round red irises (a dark ring, a pupil and a white glint), a pale halo round them and white reflections along the bottom, as in the picture; a lilac muzzle with black freckles, split down the middle, and a small black nose; the mouth slightly open over a row of lower teeth
- **Chest:** a red bow tie, with two thin dark-red stripes running down the chest on either side of the belly
- **Hips:** a maroon band around the hips
- **Hands:** working mitten hands: the back of the hand faces forward, four chunky fingers hang in a row, the thumb sits on the inner edge, chrome pins at the wrists. Every segment has its own bone, so the hands make fists, spread, point and claw
- **Feet:** big three-toed feet on a pale sole, each centred under its leg

## Rig

```
root
├─ body (pelvis, hip band)
│  └─ torso (chest, belly, bow tie, stripes, neck)
│     ├─ head ─ jaw, eyes, rightEar, leftEar ─ leftEarTop
│     ├─ rightArm ─ rightForearm ─ rightHand ─ rightFinger1a ─ 1b ─ 1c (one chain per finger), rightThumba ─ b
│     └─ leftArm  ─ leftForearm  ─ leftHand  ─ leftFinger1a ─ 1b ─ 1c ..., leftThumba ─ b
├─ rightLeg ─ rightShin ─ rightFoot
└─ leftLeg  ─ leftShin  ─ leftFoot
```

The hands hang with the back of the hand facing forward. Each finger is a chain of three bones (`rightFinger1a`, `rightFinger1b`, `rightFinger1c`, ..., outermost finger first and the index finger last) and the thumb has two (`rightThumba`, `rightThumbb`). None of them has a rest rotation, so a positive X rotation bends any joint straight back into a fist and a Z rotation on the first bone spreads a finger.

## Animations

All nine clips move like an animatronic at night. Each part is driven like its own servo: it jumps to a new position, stops dead with a small overshoot, and holds. Keyframes are linear on Blockbench's 24 fps grid, so the holds stay perfectly still. In every clip, the feet stay on the ground. Jittery and springy: quick little servo steps, head tilts and restless ears.

| Animation | Length | Notes |
| --- | --- | --- |
| `animation.violet_bunny.idle` | 5.0 s loop | Hands fidgeting together in front of his belly, bobbing on his toes; the head cocks one way then the other in quick little steps, the ears flick |
| `animation.violet_bunny.walk` | 1.2 s loop | A bouncy skip: springing off each foot, arms swinging high, ears flapping |
| `animation.violet_bunny.run` | 0.6 s loop | Hopping with both feet pushing off together, arms swinging forward on every hop |
| `animation.violet_bunny.pose1` | 2.0 s loop | The picture: standing straight; the head cocks to one side, the folded ear bobs |
| `animation.violet_bunny.pose2` | 2.0 s loop | A shy wave beside his head, the fingers wiggling, the other hand behind his back |
| `animation.violet_bunny.performance1` | 4.0 s loop | Slap bass: bass held across the hips, the left fingers fretting, the right thumb slapping on the beat, foot tapping |
| `animation.violet_bunny.performance2` | 4.0 s loop | A side-step dance: stepping side to side, pointing up with one hand and then the other |
| `animation.violet_bunny.jumpscare1` | 1.2 s, plays once | Crouches low like a spring with his ears pinned back, then pounces with clawed hands |
| `animation.violet_bunny.jumpscare2` | 1.6 s, plays once | Peeks in slowly from the side with his head tipped right over, hands creeping up beside his face... then screams |

## Using it in a Bedrock addon

It's included in the combined add-on, [`../addon/FNAF_Animatronics.mcaddon`](../addon/README.md), with spawn eggs and events. To use it in your own resource pack instead, copy `bedrock/` into it:

| Copy | To |
| --- | --- |
| `models/entity/` | `RP/models/entity/` |
| `animations/` | `RP/animations/` |
| `animation_controllers/` | `RP/animation_controllers/` |
| `render_controllers/` | `RP/render_controllers/` |
| `entity/` | `RP/entity/` |
| `textures/entity/violet_bunny/` | `RP/textures/entity/violet_bunny/` |

- **Identifier:** the client entity uses `fnaf:violet_bunny`. If your addon uses a different namespace, change it to match.
- **Glowing eyes:** the client entity uses `violet_bunny_glow.png` with the `entity_emissive_alpha` material. The red irises glow in the dark.
- **Size:** about 3.0 blocks to the top of the head and 3.4 blocks to the ear tip.
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
- The animations are my own, since the reference is a single pose. Pose 1 recreates the pose in the picture.
- The hands are built to work (fists, pointing, spreading) rather than to copy the picture's hand pose, and the feet sit straight under the legs.

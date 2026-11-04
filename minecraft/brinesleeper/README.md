# The Brinesleeper — Minecraft Bedrock entity model

A vanilla-style Minecraft entity built from the *Brinesleeper* concept sheet: a 3.5-block-tall,
emaciated aquatic cave dweller with a long arched neck, a pale mask-like face crying black
"tears" that drip off its chin, a tapered ribcage, and arms long enough to drag its clawed hands
on the ground.

![Preview sheet](preview/brinesleeper_preview_sheet.png)

![Turnaround](preview/turnaround.png)

The MP4 preview (`preview/brinesleeper_preview.mp4`, 1080p, 68 s) shows a turntable and every
animation, rendered in a voxel cave with reflective water. `preview/viewer.html` is an
interactive viewer where you can orbit the model and play each animation in a browser. Every
frame and still was rendered straight from the exported `.geo.json`, `.animation.json` and
texture, using the same conventions Blockbench uses, so what you see is what the files contain.

## What's included

| File | What it is |
|---|---|
| `brinesleeper.bbmodel` | Blockbench project (Bedrock Entity format) with the texture and all animations embedded. Open it with **File → Open Model**. |
| `Brinesleeper.mcaddon` | One-tap import for Minecraft Bedrock: resource pack and behavior pack together. |
| `resource_pack/` | Geometry, texture, animations, animation controllers, render controller, client entity, and the en_US name. |
| `behavior_pack/` | Starter AI: amphibious hunter with a spawn rule and a spawn egg. |
| `preview/` | Preview sheet, turnaround strip, the MP4, and `viewer.html` (interactive 3D viewer). |
| `tools/` | The scripts that generate everything: model, texture, animations, packs, renders. |

## Model specs

* **Format:** Bedrock geometry `1.12.0`, identifier `geometry.brinesleeper`
* **53 bones, 65 cubes**, all integer-sized cubes on **box UV** (vanilla style, 1 texel = 1 pixel)
* **Texture:** 128×64, pixel-painted. The pale face has two tiny black eyes with tear streaks
  that run into the hanging drip strands. The torso is dark with ribs, shoulder blades and a
  spine. The limbs are a mottled wet grey, and the hands and claws are paler.
* **Height:** 56 px (3.5 blocks) in its default hunched pose
* **Rig:** `root › body › pelvis › waist › chest › neck_lower › neck_mid › neck_upper › head › jaw`,
  with drip strands on the jaw and head. Each arm has a hand, four two-segment fingers and a
  thumb. Each leg has a shin, a foot and three toes. The jaw opens, so there are fangs and a
  mouth inside.
* The rest pose is the hunched pose from the concept sheet's front, side, back and ¾ views.

## Animations

| Animation | Loop | Length | Notes |
|---|---|---|---|
| `animation.brinesleeper.watch` | ✔ | 6.0 s | Standing on the shoreline, breathing. The head slowly tilts, then twitches. Fingers flex. |
| `animation.brinesleeper.idle_water` | ✔ | 4.0 s | Chest-deep in water with arms splayed on the surface like a spider, fingers drumming. |
| `animation.brinesleeper.walk` | ✔ | 2.4 s | Hunched walk: IK-planted feet, swinging arms, and a lagging neck that keeps the head steady. |
| `animation.brinesleeper.crouch_stalk` | ✔ | 3.2 s | Low four-legged creep with elbows hiked above the back and the head held level. |
| `animation.brinesleeper.run` | ✔ | 0.72 s | Hunt state: a fast four-legged gallop with planted hands and feet. |
| `animation.brinesleeper.lunge` | ✕ | 1.3 s | Coils, then lunges with arms reaching and the jaw dropping open, then recovers. |
| `animation.brinesleeper.grasp` | ✕ | 2.2 s | Drowning Grasp: reaches out, clenches, and drags its prey down. |
| `animation.brinesleeper.emerge` | ✕ | 2.8 s | Rises from the depths with arms first, slams its hands onto the bank, and hauls itself up. |
| `animation.brinesleeper.submerge` | ✕ | 2.6 s | Retreat: sinks straight down, staring, with its arms drifting up. |
| `animation.brinesleeper.swim` | ✔ | 1.8 s | Underwater breaststroke with a wave travelling down the spine. |
| `animation.brinesleeper.look_at_target` | ✔ | — | Molang head and neck tracking, layered on top in game. |

The keyframes are linear, sampled from procedural motion at 60 fps, and simplified to within
0.35° and 0.03 px, so Blockbench and the game play them identically.

The gaits are authored for these ground speeds: walk 0.68 blocks/s, crouch_stalk 0.25,
run 5.4 and swim 2.1. If you change the entity's movement speed a lot, add an
`anim_time_update` to the locomotion animations so the feet stay planted.

The client entity wires these up with three animation controllers:
* **Movement:** watch, walk, stalk (when it has a target), run, idle_water and swim.
* **Attack:** lunge on land, grasp in water.
* **Look:** head tracking.

`emerge` and `submerge` are cinematic one-shots. Trigger them with `/playanimation`:

```
/playanimation @e[type=brine:brinesleeper] animation.brinesleeper.emerge
/playanimation @e[type=brine:brinesleeper] animation.brinesleeper.submerge
```

## Use it

**Blockbench:** open `brinesleeper.bbmodel`. The **Animate** tab lists all the animations.
You can also import `resource_pack/models/entity/brinesleeper.geo.json` and the
`.animation.json` file directly.

**Minecraft Bedrock:**
1. Open `Brinesleeper.mcaddon`.
2. Activate **Brinesleeper Resources** and **Brinesleeper Behaviors** on a world.
3. Use the *Spawn Brinesleeper* egg, or run `/summon brine:brinesleeper`.

The behavior pack is a starting point and has not been play-tested. It includes:
* An amphibious hunter that targets players.
* **Dryland Hunt:** a 15–20 s timer starts when it leaves the water, then it heads back to water.
* Spawning in dark, underground water.

False Reflection, Echoed Splashes and Stillwater Curse are concept mechanics. They are not
implemented here.

**Java Edition:** Blockbench can convert the project to *Modded Entity* or OptiFine CEM with
**File → Convert Project**.

## Regenerating

```bash
cd tools
npm install                      # three.js and playwright for the headless renderer
python3 build.py out             # geometry + texture  -> out/
python3 anim.py out/brinesleeper.animation.json out/preview_meta.json
python3 pack.py .. shots/sheet/face.png
python3 export_bbmodel.py out/brinesleeper.geo.json out/brinesleeper.png out/brinesleeper.animation.json ../brinesleeper.bbmodel
npm run stills                   # preview sheet
npm run video                    # MP4 (software WebGL, ~1 h at 1080p)
```

The video's soundtrack is mixed by `make_soundtrack.py` from this repository's own synthesized
audio in `assets/audio`.

Every texture pixel, cube, keyframe and preview was generated for this project; no Mojang assets
are included. Not affiliated with Mojang or Microsoft.

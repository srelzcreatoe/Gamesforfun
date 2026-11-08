# The Brinesleeper — Minecraft Bedrock entity model

A vanilla-style Minecraft entity built from the *Brinesleeper* concept art: a 3.5-block-tall,
emaciated aquatic cave dweller. It has a long arched neck ridged with spines, a pale mask-like
face streaked with reddish tears that drip off its chin as glossy strands, a skeletal ribcage,
and arms long enough to drag its clawed hands on the ground.

It comes with its own cave biome, the [Stillwater Caves](#stillwater-caves-biome), where it is
the only hostile mob that spawns.

![Preview sheet](preview/brinesleeper_preview_sheet.png)

![Stalking & bipedal poses](preview/brinesleeper_poses_sheet.png)

![Turnaround](preview/turnaround.png)

* `preview/brinesleeper_preview.mp4` (1080p) shows a turntable, the fixed crawl, emerge and run,
  and all 20 stalking and bipedal poses, in a voxel cave with reflective water.
* `preview/viewer.html` is an interactive viewer where you can orbit the model and play every
  animation in a browser.

Every frame and still is rendered straight from the exported `.geo.json`, `.animation.json`
and texture, using the same conventions Blockbench uses, so what you see is what the files
contain.

## What's included

| File | What it is |
|---|---|
| `brinesleeper.bbmodel` | Blockbench project (Bedrock Entity format) with the texture and all animations embedded. Open it with **File → Open Model**. |
| `Brinesleeper.mcaddon` | One-tap import for Minecraft Bedrock: resource pack and behavior pack together. |
| `resource_pack/` | Geometry, texture, animations, animation controllers, render controller, client entity, the biome's fog, look, sounds and block textures, and the en_US names. |
| `behavior_pack/` | Starter AI (amphibious hunter, spawn rule, spawn egg) and the Stillwater Caves biome: biome, blocks, features, feature rules and dripstone structures. |
| `preview/` | Preview sheet, poses sheet, turnaround strip, the MP4, `viewer.html`, and the biome preview. |
| `tools/` | The scripts that generate everything: model, texture, animations, packs, renders. |

## Model specs

* **Format:** Bedrock geometry `1.12.0`, identifier `geometry.brinesleeper`
* **55 bones, 77 cubes**, all integer-sized cubes on **box UV** (vanilla style, 1 texel = 1 pixel)
* **Texture:** 128×64, pixel-painted.
  * The long face has a grey streaky brow, two black pinhole eyes, and reddish tear tracks that
    run down the narrow jaw.
  * The ribcage has raised rib bars, and there are bony spines along the neck and upper back.
  * The limbs are a mottled wet grey, and the hands and claws are paler.
* **Height:** 56 px (3.5 blocks) in its default hunched pose. It is taller in `full_stand`.
* **Rig:** `root › body › pelvis › waist › chest › neck_lower › neck_mid › neck_upper › head › jaw`
  * Liquid strands hang from the jaw and cheeks. The two long ones have two segments, so they
    swing like goo.
  * Each arm has a hand, four two-segment fingers and a thumb. Each leg has a shin, a foot and
    three toes.
  * The jaw opens wide, showing fangs and a mouth inside.

## Animations (29, plus head tracking)

Every animation has a twitch-and-crack layer, so the creature never moves smoothly for long.
The layer adds:
* snap-and-hold head cracks,
* sudden flicks,
* finger spasms,
* jaw twitches,
* short tremor bursts,
* a lurching, stop-start upper body on the gaits.

The layer is deterministic and loops seamlessly. Hands and feet that touch something are solved
with IK, so they stay planted.

Every frame also passes through a set of joint limits:
* Elbows and knees only bend the natural way.
* Wrists stay within a realistic flex, tilt and forearm-twist range.
* Fingers settle onto whatever they touch (floor, ledge, ceiling, pillar or water) instead of
  passing through it.

`tools/audit.py` checks every animation frame by frame for these problems:
* limbs passing through the body or each other,
* joints bending backwards,
* wrists or fingers out of range.

All 29 animations pass.

### Core

| Animation | Loop | Length | Notes |
|---|---|---|---|
| `watch` | ✔ | 6.0 s | Shoreline idle: breathing, a slow head tilt that cracks back. |
| `idle_water` | ✔ | 4.0 s | Chest-deep with arms splayed on the surface, fingers drumming. |
| `walk` | ✔ | 2.4 s | Hunched walk with a lagging, lurching upper body. |
| `crouch_stalk` | ✔ | 3.2 s | Low four-legged creep that moves forward, with planted hands and feet. |
| `run` | ✔ | 0.72 s | Hunt-state gallop on all fours. |
| `grasp` | ✕ | 2.2 s | Drowning Grasp: reaches out, clenches, and drags its prey down while trembling. |
| `emerge` | ✕ | 2.8 s | Rises with arms flung wide, slams both hands down far out to the sides, and hauls itself up. |
| `submerge` | ✕ | 2.6 s | Sinks straight down, staring. |
| `swim` | ✔ | 1.8 s | Underwater breaststroke with a wave down the spine. |
| `look_at_target` | ✔ | — | Molang head and neck tracking. |

### Stalking & bipedal poses

| # | Animation | Loop | Length | Pose |
|---|---|---|---|---|
| 1 | `submerged_watch` | ✔ | 6.0 s | Only its head above the water, silently observing. |
| 2 | `shoreline_stalk` | ✔ | 4.0 s | Crawling out of the water, head carried high. |
| 3 | `corner_watch` | ✔ | 6.0 s | Peeking around a pillar, its long fingers wrapped round the edge. |
| 4 | `ceiling_lurk` | ✔ | 6.0 s | Clinging upside-down to a ceiling 4 blocks up, its head hanging down. |
| 5 | `distant_observer` | ✔ | 6.0 s | Crouched on all fours across the lake, watching. |
| 6 | `veil_stalk` | ✔ | 5.0 s | Swaying low behind vines. |
| 7 | `reflection_lurk` | ✔ | 6.0 s | Bent over the water, face inches from its reflection. |
| 8 | `tunnel_crawl` | ✔ | 2.8 s | Flattened lizard crawl through tight passages. |
| 9 | `patient_strike` | ✔ | 6.0 s | Motionless, one hand outstretched on the water. |
| 10 | `shadow_hide` | ✔ | 6.0 s | A thin, still silhouette in the dark. |
| 11 | `full_stand` | ✔ | 6.0 s | Unfolded to its true height. |
| 12 | `head_tilt` | ✔ | 5.0 s | Tilts its head 40°, then cracks it the other way. |
| 13 | `slow_approach` | ✔ | 3.2 s | Upright, high slow steps, head locked on you. |
| 14 | `emerge_roar` | ✕ | 3.4 s | Rises to full height, head thrown back, maw stretched open. |
| 15 | `water_rise` | ✕ | 3.2 s | Stands up out of the water. |
| 16 | `hunting_stance` | ✔ | 3.0 s | Coiled forward lean with one claw raised, rocking before a chase. |
| 17 | `behind_cover` | ✔ | 6.0 s | Standing behind a pillar, one arm reaching round to grip its edge. |
| 18 | `ledge_watch` | ✔ | 6.0 s | Hands on a ledge 2 blocks high, leaning over to look down. |
| 19 | `lunge` | ✕ | 1.6 s | Long two-legged strike: one arm flung at your face, claws splayed. |
| 20 | `retreat` | ✕ | 4.4 s | Turns its back and wades away, sinking out of sight. |

All animation names start with `animation.brinesleeper.`. Keyframes are linear, sampled from
procedural motion at 60 fps and simplified to within 0.35° and 0.03 px, so Blockbench and the
game play them identically.

The gaits are authored for these ground speeds:

| Gait | Speed (blocks/s) |
|---|---|
| walk | 1.09 |
| crouch_stalk | 0.33 |
| run | 5.6 |
| shoreline_stalk | 0.33 |
| tunnel_crawl | 0.45 |
| slow_approach | 0.89 |
| swim | 2.1 |

If you change the entity's movement speed a lot, add an `anim_time_update` to those
animations so the feet stay planted.

The client entity wires these up with three animation controllers:
* **Movement:** watch, hunting_stance (when it has a target), walk, stalk, run, idle_water and swim.
* **Attack:** lunge on land, grasp in water.
* **Look:** head tracking.

Every pose is registered on the entity, so you can trigger any of them with `/playanimation`:

```
/playanimation @e[type=brine:brinesleeper] animation.brinesleeper.ceiling_lurk
/playanimation @e[type=brine:brinesleeper] animation.brinesleeper.emerge_roar
```

## Stillwater Caves biome

![Stillwater Caves](preview/stillwater_caves_preview.png)

The Brinesleeper's home is a flooded cave biome. It takes over part of the vanilla Dripstone
Caves, deep underground.

* **Identifier:** `brine:stillwater_caves`. Needs Minecraft Bedrock **1.26.30 or newer**.
  Custom biomes no longer need an experimental toggle.
* **Find it:** run `/locate biome brine:stillwater_caves` and teleport to the coordinates it
  prints. It is underground, usually below sea level.
* **Spawning:**
  * No vanilla hostile mob can spawn here. The biome has no `monster` tag, the same way the Deep
    Dark keeps monsters out. It also has no `dripstone_caves` tag, so drowned don't spawn either.
  * The Brinesleeper's spawn rule targets the biome's own `stillwater_caves` tag. It spawns in
    the water and on the dark cave floor, and nowhere else.
  * Passive bats and glow squid still appear.
  * Mobs can still wander in from neighbouring caves, and spawners in dungeons or mineshafts that
    happen to generate inside the biome still work.
* **Look and sound:**
  * dense blue-black fog from 6 to 64 blocks
  * dark, nearly opaque water
  * drifting ash
  * no music (the Stillwater Curse), only the cave mood sounds, distant echoing splashes and
    drips
* **Terrain:** cave walls of deepslate with bands of tuff and smooth basalt.
* **Decorations:**
  * blood-stained ceilings dripping red weeping vines
  * vanilla pointed dripstone stalactites and stalagmites
  * still pools sunk into the floor
  * gravel and mud shores with bone coral and bloodroot
  * three-toed footprint trails in the mud
  * claw marks raked into the walls

Five new blocks are in the Creative inventory's Nature tab:

| Block | Where it generates |
|---|---|
| Bloodstained Deepslate | Ceiling patches, with weeping vines hanging from them |
| Clawed Deepslate | Claw marks raked into the walls |
| Tracked Mud | Footprints in the mud shores |
| Bone Coral | Pale branching coral on shores |
| Bloodroot | Dark red reeds on shores |

Test it in a **new** world:

```
/locate biome brine:stillwater_caves
/tp @s <x> <y> <z>
/summon brine:brinesleeper
```

The biome only generates in chunks created after the pack is added, so explored areas of an
existing world don't change. Back up a world before adding the pack to it.

To make the biome more or less common, edit `minecraft:replace_biomes` in
`behavior_pack/biomes/stillwater_caves.biome.json` (generated by `tools/biome.py`):
* `amount` is the share of Dripstone Caves it takes over (0.5).
* `noise_frequency_scale` sets patch size (0.5). Lower values give bigger, rarer patches. Published
  cave-biome packs use 0.5 to 1.

Keep the `minecraft:` prefix on the target (`"minecraft:dripstone_caves"`). Microsoft's docs,
Mojang's schema and the Bedrock Wiki all say targets must not be namespaced, but the game resolves
them by full identifier. Mojang's own samples and every published biome pack use the prefix.

**Troubleshooting:** version 1.3.0 wrote the target without the prefix. The game then logged
`No biome found with name: 'dripstone_caves'` and skipped the whole biome, so the Brinesleeper
had nowhere to spawn. Version 1.3.1 fixes this. Import the new `.mcaddon` (it installs over 1.3.0)
and test in a new world.

**How the pack is checked:**
* `tools/validate_packs.py` checks every file and cross-reference offline. It also catches
  version-specific mistakes, like the target prefix and the snap range key that format 1.26.50
  renamed.
* `tools/schema_check.py` runs the packs through Mojang's JSON schemas. Some of those schemas
  are wrong: they reject forms that Mojang's own samples and vanilla files use, such as weighted
  `[name, weight]` lists, plain block names and string textures. So treat its output as hints,
  not a verdict.
* The feature details follow [featurelab](https://github.com/stirante/featurelab)'s in-game
  measurements. For example, `random_horizontal` snaps only to floors and ceilings, so claw marks
  use a wall test instead.

The preview image comes from `tools/biome_preview.py`, which runs the biome's own generation rules
on a sample cavern. It is not an in-game screenshot.

## Use it

**Blockbench:** open `brinesleeper.bbmodel`. The **Animate** tab lists all the animations.
You can also import `resource_pack/models/entity/brinesleeper.geo.json` and the
`.animation.json` file directly.

**Minecraft Bedrock:**
1. Open `Brinesleeper.mcaddon`.
2. Activate **Brinesleeper Resources** and **Brinesleeper Behaviors** on a world.
3. Use the *Spawn Brinesleeper* egg, or run `/summon brine:brinesleeper`.

The packs are version 1.3.1, so they import over an earlier copy. They need Minecraft Bedrock
1.26.30 or newer, for the custom biome.

The behavior pack is a starting point and has not been play-tested. It includes:
* An amphibious hunter that targets players.
* **Dryland Hunt:** a 15–20 s timer starts when it leaves the water, then it heads back to water.
* Spawning only in the Stillwater Caves biome, in water or on the dark cave floor.

False Reflection, Echoed Splashes and Stillwater Curse are concept mechanics. They are not
implemented as gameplay. The biome only hints at them through its silence, its dark water and
its distant echoing splashes.

**Java Edition:** Blockbench can convert the project to *Modded Entity* or OptiFine CEM with
**File → Convert Project**.

## Regenerating

```bash
cd tools
npm install                      # three.js and playwright for the headless renderer
python3 build.py out             # geometry + texture  -> out/
python3 anim.py out/brinesleeper.animation.json out/preview_meta.json
python3 audit.py                 # anatomy check of every animation
node shoot.js viewer/cinema.html jobs_sheet.json shots/v2sheet 690 1120
node shoot.js viewer/cinema.html jobs_poses.json shots/v2sheet 300 690
python3 make_sheet.py shots/v2sheet ../preview/brinesleeper_preview_sheet.png
python3 make_poses_sheet.py shots/v2sheet ../preview/brinesleeper_poses_sheet.png
python3 pack.py .. shots/v2sheet/face.png   # packs, biome and .mcaddon
python3 validate_packs.py ..     # offline check of every pack file and reference
python3 schema_check.py <bedrock-schemas checkout> ..   # optional: Mojang's JSON schemas (some are buggy)
python3 biome_preview.py out     # simulate the biome on a sample cavern -> out/biome_scene.json
node shoot.js viewer/biome.html jobs_biome.json shots/biome 1600 900
python3 make_biome_sheet.py shots/biome out/biome_tex ../preview/stillwater_caves_preview.png
python3 export_bbmodel.py out/brinesleeper.geo.json out/brinesleeper.png out/brinesleeper.animation.json ../brinesleeper.bbmodel
python3 build_viewer.py          # preview/viewer.html
npm run video                    # MP4 (software WebGL, ~1.5 h at 1080p)
```

The video's soundtrack is mixed by `make_soundtrack.py` from this repository's own synthesized
audio in `assets/audio`.

Every texture pixel, cube, keyframe and preview was generated for this project; no Mojang assets
are included. Not affiliated with Mojang or Microsoft.

# Assets: inventory, changes and attribution

## Supplied archive (preserved byte-identical)

`source_assets/original/TallWail_Blockbench_v3.zip` — sha256
`04ce682fded20f7981ed52d98c5b38517203a65f0481ad562380e914fa560d4e`. The build checks this
hash and the hash of each member before generating anything.

| File | sha256 | Re-verified facts |
|---|---|---|
| `tall_wail.geo.json` | `b180cc39…511b` | format 1.12.0, identifier `geometry.tall_wail`, **54 bones, 268 cubes** (per-face UVs; 187 cubes carry their own rotation), texture 512 × 128, culling bounds 5 × 4.5 offset (0, 1.6, 0) |
| `tall_wail.animation.json` | `e903f5e9…4ce7` | format 1.8.0, **31 animations** (the 31 suffixes listed in the brief); procedural Molang clips use `q.life_time`, `v.walk`, `v.move`, `v.look_x`, `v.look_y`, `v.jaw`; `crawl`/`climb` use `anim_time_update` `v.crawl`/`v.climb_t`; `windup`/`windup_c` are 3.2 s `hold_on_last_frame`; `scream` loops |
| `tall_wail.png` | `a23e2443…0e7` | 512 × 128 RGBA; 3 alpha values (2 semi-transparent pixels) → `entity_alphatest` material |

The archive contains no client entity, controllers, sounds or behavior files.

## What the clips actually do (from renders, not names)

Rendered with `tools/render_preview.py` / `tools/clip_sheet.py` (the repo's software
renderer evaluates the real geometry, keyframes and Molang). Highlights: `windup` drops
from upright into a planted knuckle stance by 0.8 s and holds it; `windup_c` is the same
hold starting from the planted stance; `crawl` is a quadrupedal knuckle-gallop (used as
the pursuit gait); `strike` is a one-arm swipe from the planted stance, arm fully forward
at 0.35 s; `lunge` reaches forward and returns; `ambush` rears up with arms spread and
drops back; `reveal` rises to the tallest supplied pose (48.4 px) with arms spread;
`climb` is a vertical wall pose; `pounce` leaves the ground (6 px airborne);
`peek_left/right` lean the upper body sideways; `death`/`death_low` collapse forward.

## Scale and measurements (model px; 16 px = 1 block at scale 1)

| Pose | Export height (scale 1) | In game at **scale 1.5** |
|---|---|---|
| bind / idle (folded rest) | 44.6 px = 2.8 blocks | 4.2 blocks (13.7 ft) |
| reveal end (tallest supplied) | 48.4 px | 4.5 blocks |
| unfold full (new, arms raised) | 53.3 px | **5.0 blocks (≈ 16.4 ft)** |
| planted / hunched / gallop | 31.1–31.8 px | 2.9–3.0 blocks |
| v3 tunnel crawl (with every overlay) | ≤ 20.8 px | ≤ 1.97 blocks |
| 3.1 squeeze (crushed flat, with every overlay) | | ≤ 1.03 blocks |
| v3 gallop | | 3.0-3.75 blocks |
| v3 `tall` / scream / slam / throw peaks | | 4.8 / 5.0 / 5.7 / 5.5 blocks |

The export does **not** render at sixteen feet (2.8 blocks ≈ 9 ft at rest). Scale 1.5 was
chosen so the full unfold reaches ≈ 16 ft while the folded rest (4.2 blocks) and the
hunched pursuit (≈ 2.9 blocks) still fit ordinary cave passages. Collision (0.9 wide):
tall 3.9, hunched 2.8, crawl 1.8, squeeze 0.9 high; custom hit boxes match the visible body.
Ground contact: the bind pose's feet touch y = 0 exactly. Every v3 clip is grounded frame
by frame (feet, or feet and hands) by `tools/anim_v3.py`; `client_sim.py` checks every
state and one-shot with all overlays on.

## Changes made to working copies

| Asset | Change | Reason |
|---|---|---|
| geometry copy (`packs/TailwailRP/models/entity/tall_wail.geo.json`) | only `visible_bounds_width/height/offset` → 8 / 7.5 / (0, 3.5, 0) | the 1.5× scale plus raised arms (≈ 6 blocks) and forward reach would otherwise be culled at screen edges |
| supplied animation file | **not shipped** in v3 | `tools/anim_v3.py` reads it from the archive and re-bakes the clips it reuses (walk, crawl, the planted crouch) into the single v3 file |
| texture copy | **two pixels** (uv 5,22 and 19,22 on the head's front face): the pale grey pupils (150, 146, 140, alpha 175) are painted with the black face colour around them (3, 2, 2); every other pixel is identical | 3.1: "remove the white pupils from his eyes": the eyes are empty black sockets |
| identifiers | kept: `geometry.tall_wail`, `animation.tall_wail.*`; entity id `tailwail:tall_wail` | public name Tailwail, original identifiers preserved |
| mane | not simplified (183 of 268 cubes are mane strands) | no profiling evidence that it matters; see [LIMITATIONS.md](LIMITATIONS.md) |

Every v3 clip is listed in [ANIMATION_AUDIO.md](ANIMATION_AUDIO.md); all have new names
(`animation.tall_wail.v3.*`). The v1 rehearsal and v2 clip files are no longer shipped.

## Generated assets (original to this project)

| Asset | Tool | Notes |
|---|---|---|
| every clip: 5 gaits, 23 body states, 17 one-shots, overlays and tail modes (`animations/tall_wail.v3.animation.json`) | `tools/anim_v3.py` (pose algebra in `tools/pose_lib.py`) | baked at 12-30 fps, every frame grounded (the squeeze with its root scale applied); gait strides measured from foot travel; gallop body bob solved numerically; tunnel tail solved against the floor |
| client entities, 3 controllers, `core/ids.js` (acts, one-shot table, resource-pack check key), entity properties | `tools/gen_client_v3.py` | single source of truth shared by scripts and Molang |
| model and texture copies | `tools/build_assets.py` | geometry bounds widened; texture: the two pupil pixels painted out (checked: no other pixel differs) |
| 95 Ogg Vorbis sound files + 2 music loops, `sound_definitions.json` | `tools/gen_audio_v2.py` | synthesized from oscillators/noise with fixed seeds, loudness-normalised; no samples |
| burnt-out torch block (behavior + geometry + 16 x 16 texture + loot), dread fog, snuff-smoke particle, lang | `tools/gen_assets_v2.py` | |
| 3.2 wall decals: `tailwail:claw_marks` (3 gouge patterns) and `tailwail:tally` (1-5 strokes, the fifth crossing the four), a shared flat-plane geometry (`geometry.tailwail_decal`), eight 16 x 16 textures (dark core, pale dust edge, transparent elsewhere), an empty loot table | `tools/gen_assets_v2.py` | drawn procedurally; no samples |
| `pack_icon.png`, spawn egg and journal icons | `tools/gen_icons.py` | |
| `docs/images/pose_board.png` | `tools/pose_board.py` | offline render through the simulated controllers |

All generators are deterministic; `tools/validate.py` re-runs them on a scratch copy and
byte-compares the result with the committed files.

## Third-party attribution

No third-party art, audio or code is shipped. Tools used during development and **not
distributed**: Bedrock Dedicated Server 1.26.61.1 (runtime testing, downloaded from
minecraft.net under its terms), the `@minecraft/server` / `@minecraft/server-ui` npm type
definitions (type-checking only), TypeScript (`tsc`), ffmpeg/libvorbis (encoding), NumPy
and Pillow. Vanilla files from `Mojang/bedrock-samples` were read for format reference
only; nothing was copied into the packs.

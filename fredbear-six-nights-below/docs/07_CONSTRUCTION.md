# 07 · Construction procedure and assets

The map is not shipped as a world file. It is **constructed in your own world by the behavior pack** from a
deterministic build plan (`scripts/data/build_plan.js`), so it can be rebuilt, repaired and checked at any time.
The same plan drives the offline voxel model used by every map test, and the integration tests prove that the
in-game builder produces exactly that model (docs/10).

## Stage 0 — world requirements

* A **Flat** world (default flat preset: grass at y −61). The plinth is built from y −61 to y −52 and everything
  above is cleared, so other terrain also works, but Flat avoids caves and water under the property.
* Cheats **on** (needed for `/fb:setup` and for command blocks), behavior pack **FREDBEAR: Six Nights Below (Behavior)**
  active (it pulls in the resource pack as a dependency). No experiments.
* Stand anywhere; the build area is world x −12..211, z −12..211, y −61..−10.

## Stage 1 — `/fb:setup` (automatic)

`/fb:setup` (or `/function fb/setup`) starts `Builder.start()`:

1. **Palette check.** All 253 block permutations are resolved with `BlockPermutation.resolve`; any failure is reported.
2. **World policy.** `gamerule commandblocksenabled true`, `commandblockoutput false`, `sendcommandfeedback false`,
   no daylight/weather cycles, no mob spawning, `time set 18000`.
3. **Ticking areas** `fb_nw`, `fb_ne`, `fb_sw`, `fb_se` (8 × 8 chunks each, docs/02).
4. **Wait for chunks**: 197 probe points must report loaded.
5. **Plan phases** (time-sliced with `system.runJob`; fills above 32,768 blocks are split into columns, one per job step):

   | Phase | Operations | Blocks written | Contents |
   |---|---:|---:|---|
   | terrain | 123 | 2,611,384 | clear the volume, plinth, earth berm |
   | shell | 682 | 516,735 | floors, walls, ceilings and roofs of the 62 rooms by style, structural solids, brick façade |
   | openings | 147 | 1,642 | doors, archways, windows (boarded where broken) |
   | stairs | 389 | 1,349 | 8 stairways/ladders/hatch with railings |
   | decor | 812 | 11,839 | room kits (≈50): stage, tables, arcade cabinets, kitchen, parts bins, posters, webs, lights…; then 40 soft hidden camera lights (light blocks 6/8/10 where each camera looks, none near the office corners) |
   | exterior | 188 | 11,045 | plaza, parking, roads, loading dock and truck, fence, dead trees, rooftop billboard |
   | consoles | 8 | 69 | console blocks under every control |
   | *(structures)* | 30 | 448 | command-block structure files, see below |
   | controls | 4 | 75 | buttons, levers on the consoles |
   | signs | 196 | 196 | room story signs, control labels, control-room labels (waxed) |

   Progress is saved in `fb:build` every 24 operations: if the world closes, run `/fb:setup` again and it resumes.
6. **Command blocks.** After the consoles phase, each of the 30 files in `structures/fb/` is placed with
   `world.structureManager.place()` at the origin listed in docs/06 "Structure files".
7. **Verification.** Every input command block must exist where registered; errors are listed in a *Build report* form.
8. **Lobby.** A full reset puts you at the time clock.

`/fb:setup true` (or `/function fb/rebuild`) rebuilds from scratch. Run `/fb:debug selftest` afterwards: it should
report 9 PASS lines (palette, structures, command blocks in place, actuator round trip, heartbeat, AI routes clear,
camera positions in open air, one puppet per animatronic, chunks loaded).

## Stage 2 — manual fallback for command blocks

Only needed if the self-test reports missing command blocks or a failed round trip.

1. **Load the structure files by hand.** For each row of docs/06 "Structure files":
   `/structure load fb:cb_row_0 23 -59 169` (identifier, then the world origin). A Structure Block in *Load* mode with
   the same name and offset works too.
2. **If a structure cannot be loaded at all**, rebuild its modules from docs/06 "Every command block" (or
   `docs/command_blocks.csv`). For each row: place the block type at the listed world coordinates facing the listed
   direction (modules face **east**, input blocks face **up**), set *Unconditional*, set *Needs Redstone* for impulse
   blocks and *Always Active* for chain/repeating blocks, enter the tick delay and paste the exact command.
   The first (impulse) block of each module sits one block east of its redstone pad and its command clears that pad.
3. Re-run `/fb:debug selftest`.

## Resource pack assets

Chica derives from the skin supplied by the map owner (`art/skins/`, unmodified). Fredbear is the owner's **Fredbear V6**
model (`art/models_incoming/Fredbear_V6_NoEyeDots_Complete.zip`), imported by `tools/fredbear_v6.py`. In 1.3, Freddy and
Bonnie are the owner's **Freddy V6** and **Bonnie V2** models, and the two new animatronics are the owner's **Morgrave** and
**Valek** models, all four imported by `tools/owner_models.py`. The old skin-built Freddy, Bonnie and Fredbear are kept
outside the game in `art/models_archive/` with instructions to restore them. `tools/gen_rp.py` regenerates every file below
deterministically.

| Asset | Files | Notes |
|---|---|---|
| Textures | `textures/entity/fb/{freddy,bonnie,chica,fredbear,fredbear_echo}.png` (128×64) | left half = the supplied 64×64 skin; right half = accessory atlas. Chica's skin is legacy 64×32 and is converted to 64×64 with the standard legacy-skin conversion (left arm and leg mirrored from the right ones, outer faces swapped) |
| Eye layers | `*_eyes.png` | only the pupils (taken from each skin's face) are opaque; drawn with the vanilla `creaking_eyes` material and `ignore_lighting`, shown when `fb:eyes` is true |
| Fredbear V6 | `models/entity/fb_fredbear.geo.json` (43 bones, 730 cubes), `textures/entity/fb/fredbear.png` (256×256), `animations/fb_fredbear.animation.json`, `controller.animation.fb.fredbear` | imported unchanged except: a geometry id of `geometry.fb.fredbear`, an eye layer made from the model's lens faces (`fredbear_eyes.png`), and keyframes thinned with linear interpolation within 0.2° / 0.02 (largest measured error 0.17° / 0.016). All 12 of its clips are used: idle, walk, run (retreat), showman (Golden Hour rise), bow (a held door), the four stage performances chained one after another on the diner stage, and the three jumpscares (picked at random per jumpscare). Added for the game: `stalk` (the walk at 60 % speed), `crawl` (a crawl made for the hatch and vents), `dormant` (the deepest bow frame, held). Scale 1.09 (the same height as the old model) |
| Freddy V6, Bonnie V2, Morgrave, Valek (1.3) | `models/entity/fb_{freddy,bonnie,morgrave,valek}.geo.json`, `textures/entity/fb/<who>.png` (unchanged from the zips), `animations/fb_<who>.animation.json`, `animation_controllers/fb_<who>.animation_controllers.json` | the models' own clips (Freddy 6, Bonnie 8, Morgrave 4, Valek 4: idle, walk, run / hurry, poses, stage shows, Morgrave's and Valek's jumpscares), keyframes thinned within 0.2° / 0.02. Added for the game on the idle base pose: crawl, stalk, hurry, threat, dormant, attack (Freddy, Bonnie), the shows as one-shot clips, and an additive **look_at** head turn driven by `fb:look_yaw/pitch/tilt` (the stare into the camera, heads following you in Free Roam). Bonnie's added clips keep her own arm poses. Each is scaled to the height of the character it replaces or matches (Freddy ×0.992, Bonnie ×0.605, Morgrave ×0.768, Valek ×0.87). Eye layers use only the models' own eye texels. Valek's render controller hides his body when `fb:variant` is 1 (eyes only, on the hunt) |
| Withered skins (1.3) | `textures/entity/fb/{freddy,bonnie,chica}_withered.png` | darker, grimy, torn patches showing the endoskeleton; used from night 7 and in the challenges (`fb:variant` 1, `controller.render.fb.withered`) |
| Camera map HUD (1.3) | `ui/hud_screen.json`, `textures/ui/fb/cam_map.png`, `textures/ui/fb/cam_map_c01..c21.png` | generated by `tools/gen_cam_map.py` from the floor plan data: ground floor and basement outlines, one numbered box per camera, YOU in the office; one blinking green overlay per camera. Shown while the title text carries the map marker (see docs/01 item 14) |
| Fredbear echo / shadow | `fredbear_echo.png`, `fredbear_shadow.png` (+ eye layers) | purple, scan-lined copy for false camera events; a black silhouette with white eyes for Shadow Fredbear. One entity, the texture chosen by `fb:variant` |
| Geometry | `models/entity/fb_<name>.geo.json` (format 1.21.0) | the vanilla `geometry.humanoid.custom` bone set and UVs (body + jacket, arms + sleeves, legs + pants). The head is split with per-face UVs: rows 0-5 of the skin's face stay on the head, rows 6-7 form a full-width **jaw** hinged at the back of the head (base and hat layer), so the closed face is exactly the supplied skin (one nose, the skin's own mouth line). A dark mouth cavity and upper/lower teeth sit inside the closed head and show when the jaw opens. Extra bones `snout` (Chica's upper beak), `leftEar`, `rightEar`, `crown`, `prop` |
| Accessories (Chica; the 1.2 Freddy and Bonnie in the archive) | in the atlas | Freddy: round ears, black top hat, microphone. Bonnie: long ears with inner colour, red guitar (shown only while performing). Chica: a slightly extruded beak made of the skin's own beak pixels (upper on the head, lower on the jaw), head tuft, cupcake on a plate. Fredbear: round ears with purple inner, purple top hat, microphone. Bow ties and Chica's bib come from the supplied skins. In-game size: Freddy ×1.35, Bonnie and Chica ×1.3, Fredbear ×1.45 |
| Animations (Chica) | `animations/fb_animatronic.animation.json` | idle, walk, stalk, crawl, look (head turns), pause (suspicious freeze), threat (doorway, jaw working), attack (jumpscare lunge, jaw wide open), retreat, dormant, music, plus one stage performance per character: Freddy sings into the microphone, Bonnie strums the guitar (left hand on the neck), Chica presents the cupcake (plate kept level) and waves, Fredbear sings with a sweeping arm. Every pose has a matching jaw motion |
| Animation controller | `controller.animation.fb.pose` | one state per `fb:anim` value, 0.2 s blends (0.05 s into attack) |
| Render controllers | `controller.render.fb.animatronic`, `controller.render.fb.eyes`, plus echo controllers with texture arrays | `fb:hidden` hides the whole model (vent crawls) |
| Sounds | `sounds/fb/**.ogg` (57 ids), `sounds/sound_definitions.json` | **recordings supplied by the map owner** (`art/sounds_incoming/`, converted by `tools/gen_sounds.py`): the animatronic jumpscare and Fredbear's own jumpscare, the storm-door slam (door / hatch closing), the metal door (opening), camera up / down, the looping CCTV hum while the monitor is up (1.3: quieter), Freddy's laugh (4 cuts), Fredbear's laugh (4 cuts), the night music, and in 1.3 Fredbear's music box (*Fredbear's Family Diner*) and Chica's kitchen (*Chica in the Kitchen*, 5 takes). **Synthesised**: footsteps, lights, power, breaker, strobe, seals, clock chimes, phone, ambience, groan, breathing, Freddy's music box, roar, glitch, finale, ending theme, the fire of the burn ending, Morgrave's scrape and Valek's hum and vanish. Freddy's music box plays Bizet's *Toreador March* (public domain); all other synthesised melodies are original |
| Night music | `sounds/fb/night/bgm.ogg` (`fb.night.bgm`, category `music`, `stream: true`) | *PIZZA DINNER* from the FNAF 1 Remake fan-game soundtrack, supplied by the map owner; looped by `playMusic` from 12 AM to 6 AM |
| Fogs | `fogs/fb_night_{1..9}.json`, `fogs/fb_camera_feed.json`, `fogs/fb_flashback.json`, `fogs/fb_ending_fire.json` | night fogs get darker and closer each night (`fog @a push fb:night_<n> fb_night`); while the camera monitor is up the clear, faintly green `fb:camera_feed` fog is pushed on top (`fb_cam`) so feeds are not blacked out; a sepia fog for the night 4 flashback and an orange smoke fog for the burn ending (`fb_scene`) |
| Items | `textures/items/fb_{tablet,remote,guide}.png`, `textures/item_texture.json` | 16×16 icons |
| Text | `texts/en_US.lang`, `texts/languages.json` | entity and item names |
| Pack icons | `pack_icon.png` in both packs | faces from the supplied skins |

![Model previews](model_previews.png)

The preview sheet is rendered offline by `tools/render_preview.py` from the geometry and textures (front,
three-quarter, a frame of each character's performance, an added clip and the threat pose, sampled from the real
animation files; the withered skins; Morgrave's crawl and Valek's stalk and their jumpscares; for Fredbear also his crawl,
bow, showman, a jumpscare, and the echo and shadow). It checks UV mapping, accessory placement and that props sit in the hands; **it is not an in-game screenshot**.

## Time-clock room (lobby) rework

The lobby was rebuilt for 1.2 (`lobbyKit` in `data/kits.js`): a terminal wall with the night buttons (nine since 1.3), CONTINUE and
FREE ROAM, a **challenge console** with four lamps (lit once a challenge is beaten), a **newspaper board** whose
button opens the clippings, lockers along the west wall, benches and posters.

## 1.3 additions to the map

* **Cameras**: CAM 17 (office subfloor), CAM 18 (supply duct), CAM 19 (Fredbear's chamber), CAM 20 (diner party room),
  CAM 21 (diner kitchen); the tabletop map gains a column of buttons.
* **Supply duct** (`VENT_DUCT`, y -3..-2 under the supply closet floor to the left door corner) with the **vent seal** and
  a **shaft seal** in the crawlspace; their shutters and lamps are command-block modules (`seal.*`).
* **Parts & Service**: three storage spots for the trio on nights 7 and 9, and Valek's spot.
* **Lore** (`data/lore.js`): the sealed 1983 birthday party in the old diner (table, cake, candles relit by `night.begin`,
  presents, banner), the wall of names in Fredbear's chamber (the player's name is added after night 6), and the 1987 crew
  graffiti in the west maintenance tunnel. The office gets the TAPE DECK button.

## Seasonal decorations

`tools/gen_holidays.mjs` writes `data/holiday_decor.generated.js`: Halloween (jack-o'-lanterns, pumpkins, cobwebs —
149 cells) and Christmas (three small trees in the employee room, reception and dining room, presents, lights — 409
cells). Cells are chosen only where the built map has air and where no camera sight line, route polyline, guide edge,
input or module needs the space (`forbiddenCells()`). The script places them from the device date (Halloween
15 Oct – 2 Nov, Christmas 10 Dec – 6 Jan), 48 cells per tick, and removes them again by writing air. Settings can switch
them off.

## Regenerating everything

```
npm install          # pinned typings + TypeScript (dev only)
npm run build        # structures, register, floor plans, RP art/sounds, previews, generated docs, dist/
npm run validate     # six static validators
npm test             # unit, structure and integration tests
```

Python 3 with Pillow and numpy, ffmpeg with libvorbis, and `jsonschema` are needed for the asset and schema steps.

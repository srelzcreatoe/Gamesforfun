# Custom blocks — specification

Read `docs/DESIGN.md` §1 (look and feel, palette) first. Everything here is
original art. The building itself is mostly vanilla blocks; these custom
blocks fill the FNAF-specific gaps. They must read as **vanilla Minecraft**:
16 px per block face, limited palettes, soft value noise, 1-px highlights and
shadows, no smooth gradients, no photo textures, no anti-aliased lines.
Darker and grimier than vanilla (worn, stained, dusty) — the pizzeria is dying.

## Conventions (all blocks)

* Identifier `fnar:<name>`. BP file `packs/BP/blocks/<name>.json`,
  `"format_version": "1.26.50"`.
* `description.menu_category`: `{ "category": "construction" }` (decor shows in
  the creative inventory) unless the spec says `none`.
* Textures: `packs/RP/textures/blocks/fnar/<tex>.png` (color, RGBA),
  `<tex>_mer.png` (R metalness, G emissive, B roughness; same size),
  `<tex>_height.png` (greyscale heightmap, same size) and
  `<tex>.texture_set.json`:
  ```json
  { "format_version": "1.21.30", "minecraft:texture_set": {
      "color": "<tex>", "metalness_emissive_roughness": "<tex>_mer", "heightmap": "<tex>_height" } }
  ```
  Short texture names in `terrain_texture.json` are `fnar_<tex>` →
  `textures/blocks/fnar/<tex>`. Do NOT edit the shared
  `packs/RP/textures/terrain_texture.json` directly: write your entries to
  the fragment file named in your task (`tools/fragments/terrain_<you>.json`,
  same shape as `texture_data`), plus `tools/fragments/flipbook_<you>.json`
  (array) and `tools/fragments/local_lighting_<you>.json` (object for
  `minecraft:local_light_settings`). `tools/merge_fragments.mjs` merges them.
* Full cubes: `"minecraft:geometry": "minecraft:geometry.full_block"`.
  Custom shapes: `packs/RP/models/blocks/<name>.geo.json`, format `1.12.0`,
  identifier `geometry.fnar.<name>`, model space 16 px per block, origin at
  the block's bottom centre (x/z −8..8, y 0..16). Stay inside the 16 px cell
  unless the spec says otherwise.
* `minecraft:material_instances`: use `render_method` `opaque` for full solid
  cubes, `alpha_test` for cut-out shapes, `blend` only for real translucency.
  Emissive parts may use a separate material instance name.
* Facing: `"traits": { "minecraft:placement_direction": { "enabled_states":
  ["minecraft:cardinal_direction"], "y_rotation_offset": 180 } }` plus one
  permutation per direction with `minecraft:transformation` `rotation`
  `rotation`. Model every block **facing north** (its front towards −Z).
  The state value is the direction the front faces: `north` → `[0, 0, 0]`,
  `west` → `[0, 90, 0]`, `south` → `[0, 180, 0]`, `east` → `[0, -90, 0]`.
  Wall-mounted things are modelled with their back flat against the **south**
  side of the cell (z = +8) so that state `north` means "hanging on the wall
  to the south, facing north into the room". The game script always places
  blocks with explicit states, so this convention must hold exactly.
* Light: `minecraft:light_emission` (0–15) on lit permutations;
  `minecraft:light_dampening: 0` for non-solid shapes. Emissive pixels get a
  high MER green value so they glow in Vibrant Visuals.
* Every block needs sensible `minecraft:collision_box` / `minecraft:selection_box`
  (thin wall decor: no collision, small selection box) and a
  `minecraft:destructible_by_mining` (seconds_to_destroy 1–3), and
  `minecraft:map_color`.
* Script hooks: blocks that the player presses carry the custom component
  `"fnar:control": {}` (custom components v2 — just a key in `components`).
* Validate with `node tools/validate_json.mjs packs` (official Mojang schemas;
  known schema bugs are already suppressed).

## A — surfaces, signage, lights (agent "surfaces")

Full cubes (one 16×16 texture used on all faces unless noted):

| name | look | MER intent |
|---|---|---|
| `tile_checker` | 2×2 black/off-white checker (8 px tiles) with 1-px dark grout, slightly uneven tiles, faint grime in grout | tiles roughness low (glossy ~70), grout rough |
| `tile_checker_worn` | same pattern, dirtier: scuffs, a cracked tile, a dried stain | slightly rougher |
| `tile_office` | dark slate-grey 4×4 small tiles, grimy (office floor) | semi-gloss |
| `tile_kitchen` | 4×4 red/white quarry tiles, greasy | semi-gloss |
| `wall_checker` | wainscot band: 4-px black/white checker, a 1-px dark rule at top and bottom | glossy tiles |
| `wall_plaster` | blue-grey painted plaster, mottled, faint vertical water streak | matte |
| `wall_plaster_stained` | same with heavy stains, peeling paint showing concrete | matte |
| `wallpaper_maroon` | deep maroon wallpaper with a faint darker damask/diamond motif, worn | matte |
| `wall_trim` | charcoal with a 2-px red stripe at mid height (chair rail) | satin |
| `cinderblock_painted` | light-grey painted cinder blocks (2 courses per block), grime at the bottom | matte |
| `ceiling_tile` | drop-ceiling: 2×2 off-white yellowed acoustic tiles in a thin grey T-bar grid, pinholes | matte |
| `ceiling_tile_stained` | same with a big brown water stain and one tile sagging dark | matte |
| `carpet_party` | 80s arcade carpet: dark navy-purple with small neon squiggles/triangles/dots (pink, teal, yellow) | matte |
| `curtain_purple` | purple velvet, vertical folds (light/dark bands), small gold stars | velvet (roughness high) |
| `curtain_red` | red velvet stage curtain, folds | velvet |
| `tent_stripe` | faded red/cream vertical stripes (4 px), canvas weave | matte |
| `duct_metal` | galvanised sheet metal, seams and rivets, dust | metal ~180, roughness mid |
| `stage_floor` | black-painted stage boards, worn to wood at the edges, tape marks | satin |
| `door_shutter` | steel security shutter: horizontal ribbed slats, rivets, scratches. State `fnar:part` int 0–1: 1 = bottom panel with yellow/black hazard stripes in the lower 5 px. `menu_category` none | metal |

Lights (custom shapes unless noted). States use `fnar:lit` (bool); `true` =
emissive + light; `false` = dead/dark.

| name | shape | lit | light |
|---|---|---|---|
| `ceiling_lamp` | full block placed IN the ceiling: bottom face = fluorescent troffer (metal frame, 2 tubes behind a prismatic diffuser); other faces = `ceiling_tile` | tubes bright cool white, emissive | 13, static light `#dfe8ff` |
| `exit_sign` | wall box 10×5×2 px at the top of the cell, green "EXIT" | green emissive | 5, static `#3cff6e` |
| `wall_sconce` | small half-cylinder shade on the wall, warm | warm emissive | 10, point light `#ffc98a` |
| `stage_spotlight` | can light on a yoke, pointing forward-down (hangs from the ceiling: top of cell) | lens emissive | 12, point light `#ffe2b0` |
| `hanging_lamp` | pendant: cord from the top of the cell, conical shade, bulb | warm | 11, point light `#ffc98a` |

Picture panels — 1 px thick on the wall (back at z = +8, facing north),
facing via cardinal direction, each tile of a multi-block picture is the same
block with state `fnar:tile` (int 0..n-1, row-major from the TOP-LEFT as seen
from the front). One texture per tile: `<name>_<tile>.png` (+ MER/height).
No collision; selection box = the panel.

| name | tiles (w×h) | content |
|---|---|---|
| `poster_revue` | 2×3 | "RUSTGRIN & THE RUSTY REVUE" — Rustgrin centre with mic, Mirehop and Noxbriar either side, stage stars, faded |
| `poster_party` | 2×2 | "LET'S PARTY!" with Rustgrin waving (the FNAF "Celebrate!" analogue) |
| `poster_cabaret` | 2×3 | "KITTY'S CABARET — every night at 8!" the Cat posing, purple/gold |
| `poster_midway` | 2×3 | "MARVELLO'S MIDNIGHT MIDWAY" — Top-Hat Rat with cane, Purple Rat with maracas, circus red/cream |
| `poster_rules` | 2×2 | "PIZZA REVUE RULES" header, numbered illegible pixel lines, a small Rustgrin |
| `poster_missing` | 1×2 | yellowed flyer "HAVE YOU SEEN THIS GUARD?" with a blank grey silhouette (no gore) |
| `drawing` | 1×1 ×6 variants (`fnar:tile` 0–5) | kids' crayon drawings on white paper: each animatronic, scribbly, one with all of them and a tiny stick-figure guard |
| `sign_cabaret` | 3×1 | marquee "KITTY'S CABARET", purple with gold bulbs (bulbs emissive) |
| `sign_out_of_order` | 2×1 | handwritten cardboard "SORRY! OUT OF ORDER" |
| `sign_midway` | 4×1 | circus marquee "MIDNIGHT MIDWAY" red/cream with bulbs (emissive) |
| `sign_revue` | 6×2 | big exterior neon sign "RUSTGRIN'S" (top row) / "PIZZA REVUE" (bottom row) on a dark board, neon tubes pink and teal, emissive; `light_emission` 7 |
| `sign_staff` | 1×1 ×4 variants | "STAFF ONLY", "MEN", "WOMEN", "KITCHEN" door signs |

Portrait renders of the animatronics (transparent PNG, front/three-quarter)
are in `assets/portraits/` for the posters: downscale and re-palette them into
pixel art; never paste them unprocessed.

## B — props (agent "props")

All custom geometry, cardinal facing unless noted, alpha_test. Textures may
be any power-of-two size up to 64×64 but must look like 16-px-per-block
vanilla art (1 texel ≈ 1 model pixel).

| name | size (px) | notes / states |
|---|---|---|
| `door_button` | plate 6×8 on the wall at mid height + big round button (5 px) | red button; `fnar:on` bool → glowing red (emissive, light 3); `"fnar:control": {}` |
| `light_button` | same | white button; `fnar:on` → glowing white (light 4); `"fnar:control": {}` |
| `vent_cover` | full cell, placed IN the ceiling | `fnar:closed` bool: false = steel grate with slats (see-through, alpha_test), true = solid steel hatch with hazard edge; no facing |
| `crt_monitor` | 12×11×12 on the desk | beige-grey CRT; `fnar:on` bool: on = screen emissive (dim green-blue static), off = black glass |
| `desk_fan` | base 6×2×5, neck, cage Ø10 | blades: a plane with a 4-frame **flipbook** spinning blur texture (`fan_blades`, 1 tick/frame) |
| `desk_phone` | 8×4×6 | old push-button office phone, beige; `fnar:ringing` bool → a red line-light emissive |
| `desk_clutter` | flat ≤3 px tall | papers, a coffee cup, pens, a sticky note |
| `plush_rat` | ~6×8×5 | soft plush of Purple Rat (purple body, big ears, pink nose) sitting on the desk |
| `party_table` | top at y 13–15, cloth drapes 3 px | white-ish stained tablecloth with a red/white checker hem; `fnar:part` int 0–2 (0 single = drapes all sides, 1 end = drapes on 3 sides, open side = south before rotation, 2 middle = drapes on east/west only); facing gives the table's long axis |
| `party_chair` | small chair | red plastic seat, metal legs |
| `party_hat` | cone 4 px wide, 7 tall, on the floor of the cell (sits on a table below) | `fnar:color` int 0–3 (red, blue, purple, yellow), stripes + pom-pom; no facing |
| `pizza_box` | 12×2 per box | `fnar:count` int 1–3 stacked boxes, red logo |
| `plate_set` | flat | two paper plates with crusts + a cup; no facing |
| `balloons` | 3 balloons on strings, up to 16 tall | `fnar:color` int 0–2 colour sets |
| `bunting` | wall plane, string of triangle flags across the top of the cell | faded multicolour |
| `arcade_cabinet` | 2 blocks tall: `fnar:half` int 0 = lower (cabinet + controls), 1 = upper (screen + marquee) | screen = flipbook (`arcade_screen`, 4 frames, 6 ticks/frame) emissive, marquee "RAT RACE" emissive; light 6 on the upper half |
| `show_tape` | 16×14×8 | the Ringmaster's reel-to-reel show deck on a stand: two reels, buttons, a 4-LED VU meter; `fnar:level` int 0–4 = number of lit LEDs (emissive green→yellow→red) |
| `security_camera` | body 4×4×8 on an arm, hangs at the top of the cell from the wall | grey CCTV, red LED (emissive) |
| `pa_speaker` | wall horn speaker | grey, rusty |
| `stage_speaker` | 16×16×10 floor cabinet | black with grille cloth, scuffed |
| `guitar_amp` | 12×10×7 | Mirehop's amp, green-black tolex, grille, knobs |
| `time_clock` | wall box 10×12×5 | punch time clock with clock face and card rack (lobby prop) |
| `stage_star` | plane 14×14 on the wall | gold star cutout, chipped paint, slight emissive edge |
| `wet_floor_sign` | A-frame 8×12 | yellow, "CAUTION" pictogram |
| `mop_bucket` | bucket 8×7 + mop handle 14 tall | yellow bucket, grey water |
| `trash_can` | Ø10×12 | dented steel can with lid |
| `parts_shelf` | 16×16×8 | metal shelf with boxes, wires, a spare endoskeleton hand |
| `toilet` | 10×12×12 | white ceramic, grimy |
| `sink` | 12×6×8 wall sink at y 10–16 + pipe | white ceramic, rust stains |
| `locker` | 2 blocks tall (`fnar:half` 0/1), 14×16×14 | dented grey staff locker |

## C — the last week (environment pass)

Decay props and signage for the pizzeria's last week before the auction
(November 1991): dread and implication, no gore. Props are built by
`tools/blocks/props/props_decay.py` (section B conventions), the cubes, the
flickering lamp and the picture panels by the section A generators
(`gen_cubes.py`, `gen_lights.py`, `gen_panels.py`, registered in `gen_blocks.py`).
The build plan places them in `lastWeek()` / `lastWeekOutside()` / `parts()`
(`packs/BP/scripts/data/build_plan.js`); lights that are built lit and never
switched by the game are listed in `meta.fixtures`.

| name | states | look |
|---|---|---|
| `spare_head` | `fnar:char` 0-4 (Rustgrin, Mirehop, Noxbriar, the Cat, the Purple Rat), facing | a spare costume head at the performers' own head size, in the cast's colours (`sprites.py` palettes): hollow eye sockets, slack jaw, cables out of the neck; Mirehop's has one ear torn to a stub, Rustgrin's has one pupil still faintly lit |
| `endo_parts` | `fnar:part` 0 skull, 1 forearm and hand, 2 endoskeleton bust on a repair stand; facing | bare endoskeleton parts, staring eyeballs, rust |
| `slumped_suit` | `fnar:char` 0 grey bear, 1 green rabbit; facing (back against the wall) | an empty costume sitting against the wall, head dropped forward and to one side, black empty sockets, a split seam |
| `birthday_cake` | `fnar:lit` (light 4, warm point light); facing | the last birthday cake: one slice gone, three dead candles, one knocked over, one still burning |
| `fallen_chair` | facing | the party chair tipped over on its back |
| `floor_decal` | `fnar:kind` 0-7: tickets, tickets_b, confetti, puddle (glossy), prints (wet animatronic footprints), prints_faint, debris (fallen ceiling tile), drag (drag marks); facing rotates it | a 0.1 px floor decal, no collision; footprints walk towards the facing |
| `hanging_wires` | `fnar:kind` 0 cut cable bundle, 1 dangling junction box + insulation; facing | hangs from the top of the cell (place it under the ceiling) |
| `walter_things` | `fnar:kind` 0 desk set (mug, note, cap, pen), 1 his flashlight on the floor, still on (light 6); facing | the guard who walked out at 3 AM |
| `boarded_planks` | `fnar:kind` 0 three planks across (one slipped), 1 an X; facing (wall mounted) | weathered grey boards nailed over a window or opening |
| `emergency_light` | `fnar:lit` (light 6, red point light); facing (wall mounted) | caged red beacon on a bracket |
| `ceiling_tile_missing` | full cube | drop ceiling with a tile fallen out (black plenum, a pipe, a cable) and one cracked and sagging |
| `ceiling_lamp_broken` | full cube, light 9 | a troffer nobody fixed: one tube dead, a diffuser panel missing, the other tube flickering (flipbook `frames` sequence, 2 ticks/frame); never switched by the game |
| `wall_writing` | `fnar:tile` 0-15: 0-7 THE SHOW MUST GO ON (4 x 2, white paint), 8-13 HE KNOWS YOUR NAME (3 x 2, scratched), 14 chalk tally marks, 15 scratched tally marks | picture panel; place with `writing(p, 'show' \| 'name' \| 'tally' \| 'scratches', ...)` (`WRITING` in `palette.js`) |
| `poster_auction` | 2 x 3 picture | PUBLIC AUCTION, NOV 9, LOTS 1-6, every lot struck through with a marker |
| `poster_torn` | 2 x 2 picture | the LET'S PARTY! poster, half torn away, Rustgrin's eyes scratched out |
| `lot_tag` | 1 x 1 x 6 variants (LOT 1 - LOT 6) | manila auction tag on a string |

# Preview renderer — specification

Goal: high-quality still images of the pizzeria and the animatronics for the
add-on's preview pictures, rendered offline with three.js in headless
Chromium (Playwright). The look should approximate Minecraft **Vibrant
Visuals** at night inside a dark, grimy pizzeria (FNAF 1 Remake / "Soulless"):
pixel-crisp textures (nearest filtering), PBR materials from the texture sets,
point lights from lamps, emissive glow + bloom, soft shadows, light haze/fog,
ACES tone mapping. It must also be able to render "classic" style
(flat-ish lighting) if asked.

## Existing pieces (read them)
* `tools/render/bedrock_model.js` — Bedrock geometry → three.js (Blockbench
  conventions, verified on the six animatronics) + animation sampler.
* `tools/render/page.js`, `page.html`, `render.mjs` — the Playwright driver
  (`withRenderer(async (render) => render(sceneSpec, outPng), { mounts })`),
  a static HTTP server with mount points, WebGL2 via SwiftShader.
* `tools/render/portraits.mjs` — example of rendering models.

## Inputs

### 1. Voxel snapshot (`fnar-voxels-1`)
```json
{
  "format": "fnar-voxels-1",
  "origin": [x0, y0, z0],
  "size": [sx, sy, sz],
  "palette": [ { "name": "minecraft:air" }, { "name": "minecraft:smooth_stone_slab", "states": { "minecraft:vertical_half": "bottom" } } ],
  "data": "<base64 of a little-endian Uint16Array, length sx*sy*sz, index = x + sx*(z + sz*y)>",
  "signs": [ { "pos": [x, y, z], "lines": ["..."] } ]
}
```
Coordinates are Minecraft-style (+X east, +Y up, +Z south). A voxel at array
index (x,y,z) occupies world box [x0+x, x0+x+1] etc.

### 2. Scene spec (JSON) for one image
```json
{
  "width": 1920, "height": 1080,
  "voxels": "path/to/snapshot.json",
  "camera": { "pos": [x,y,z], "target": [x,y,z], "fov": 60 },
  "style": "vibrant" | "classic" | "camera_feed",
  "time": "night",
  "exposure": 1.0,
  "entities": [ { "id": "fnar:rustgrin", "pos": [x,y,z], "yaw": 180, "anim": "idle", "t": 0.5, "eyes": true, "scale": 1.0 } ],
  "extra_lights": [ { "type": "point"|"spot", "pos": [...], "target": [...], "color": "#ffc98a", "intensity": 5, "distance": 12 } ],
  "fog": { "color": "#0b0b10", "density": 0.03 },
  "bloom": { "strength": 0.6, "radius": 0.4, "threshold": 0.85 }
}
```
Entities resolve through the resource pack (`packs/RP/entity/*.entity.json` →
geometry + textures + `_mer` texture set if present); until those exist, fall
back to `assets/source_models/**` (`fnaf:*` ids there map to `fnar:*`).

## Block rendering
* **Vanilla blocks**: resolve textures with Mojang's vanilla
  `resource_pack/blocks.json` + `resource_pack/textures/terrain_texture.json`
  (bedrock-samples, fetched from
  `https://raw.githubusercontent.com/Mojang/bedrock-samples/main/<path>` and
  cached under `tools/.cache/vanilla/`, git-ignored). Textures can be `.png` or
  `.tga` (decode TGA yourself or via a small lib). Handle per-face textures
  (`up/down/side/north/...`), variation arrays (pick deterministically by
  position), tinted blocks are not needed (no grass tint required except the
  exterior grass: tint `#79c05a`).
* **Shapes** needed (others may render as full cubes): full cube, slab
  (`minecraft:vertical_half`), stairs (`weirdo_direction`, `upside_down_bit`),
  carpet, trapdoor (`direction`, `open_bit`, `upside_down_bit`), iron bars /
  glass panes (connect to solid neighbours), chain (`pillar_axis`), lantern
  (`hanging`), fence (connect), door (`minecraft:cardinal_direction`,
  `open_bit`, `door_hinge_bit`, `upper_block_bit`), button (`facing_direction`),
  wall sign (`facing_direction`, draws `signs` text roughly), ladder, cake,
  flower pot, logs (`pillar_axis`), barrel (`facing_direction`).
  Invisible: `minecraft:light_block_*`, `minecraft:barrier`, `minecraft:structure_void`, air.
* **Custom blocks** (`fnar:*`): read `packs/BP/blocks/*.json` — geometry
  (`minecraft:geometry.full_block` or `geometry.fnar.*` from
  `packs/RP/models/blocks/`), `minecraft:material_instances`, permutations
  whose `condition` is a simple `q.block_state('a') == v [&& ...]` (implement a
  tiny parser for `==`, `&&`, `||`, strings/numbers/bools; `query.` and `q.`),
  `minecraft:transformation` rotation, `minecraft:light_emission`. Texture
  names resolve via `packs/RP/textures/terrain_texture.json` and texture sets
  (`*.texture_set.json`: MER → metalness/emissive/roughness maps; heightmap →
  bump map). Flipbook textures: use frame 0.
* Face culling between opaque full cubes; merge geometry into few meshes
  (group by material); keep it fast enough for a ~110×40×100 region.

## Lighting model
* Light sources = blocks with `minecraft:light_emission` > 0 (custom) plus
  vanilla emitters you meet (lantern, sea_lantern, redstone_lamp lit, torch,
  end_rod, glowstone, light_block_N = invisible fill light). Colour from
  `packs/RP/local_lighting/local_lighting.json` if listed, else warm white.
  Too many lights for WebGL: cluster/merge nearby emitters and keep the N most
  relevant to the camera as real point lights (with 1–3 shadow casters); the
  rest can be approximated (e.g. a baked per-vertex block-light term from a
  flood-fill of light levels like Minecraft's — recommended: compute block
  light 0–15 with Minecraft's flood fill and use it as an ambient term so dark
  areas stay dark and lit areas glow; this is what makes it look like
  Minecraft).
* Emissive: MER green channel → emissive map; bloom via UnrealBloomPass.
* `camera_feed` style: greenish-grey desaturated, night-vision-like brightness
  (the game gives the player night vision on the cameras), film grain,
  scanlines, slight barrel vignette — the HUD overlay is added later by a
  separate compositor, not here.

## Deliverables
* `tools/render/world.js` (browser module) and `tools/render/render_world.mjs`
  (`node tools/render/render_world.mjs scene.json out.png`, also importable).
* `tools/render/fetch_vanilla.mjs` (downloads + caches needed vanilla files).
* A self-made test snapshot `tools/render/test/test_room.json` exercising every
  shape above + any custom blocks that exist when you test, and its rendered
  PNGs in `tools/render/test/`.
* `tools/render/README.md`.

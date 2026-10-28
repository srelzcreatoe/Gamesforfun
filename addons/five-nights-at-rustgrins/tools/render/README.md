# Preview renderer (`tools/render/`)

Offline renderer for the add-on's preview pictures: renders an `fnar-voxels-1` snapshot of the
pizzeria (vanilla + `fnar:*` custom blocks) plus posed animatronics into PNGs with three.js in
headless Chromium (Playwright, WebGL2 via SwiftShader). Three looks:

* `vibrant` (default) - approximates Minecraft **Vibrant Visuals at night**: PBR from texture sets,
  Minecraft-style block light pools, real point/spot lights with soft shadows, emissive + bloom,
  haze with light halos and spotlight beams, ACES tone mapping, pixel-crisp textures.
* `classic` - Minecraft smooth lighting (block/sky light, AO, directional face shading,
  brightness option), no PBR, no bloom.
* `camera_feed` - night-vision CCTV: desaturated green-grey, extra ambient (night vision), grain,
  scanlines, slight barrel distortion and vignette. (The HUD is composited elsewhere.)

Spec: `docs/RENDERER.md`. Examples of output: `tools/render/test/*.png`.

## Usage

```sh
# one image (paths in the scene file are relative to the scene file)
node tools/render/render_world.mjs scene.json out.png
# several images in one browser session (the world is built once per snapshot)
node tools/render/render_world.mjs a.json a.png b.json b.png --packs extra/pack1,extra/pack2 [--quiet]
# prefetch the vanilla files a snapshot needs (render_world does this automatically)
node tools/render/fetch_vanilla.mjs snapshot.json [--packs dir]      # or --all for every vanilla block texture
```

```js
import { renderWorld } from './tools/render/render_world.mjs';
// jobs: { scene: path | sceneObject, out: pngPath } or an array of them
// opts: { packs?: string[], baseDir?: string (for relative paths in scene objects), root?: string, quiet?: boolean }
const results = await renderWorld([{ scene: 'tools/render/test/scenes/overview_vibrant.json', out: '/tmp/a.png' }], { quiet: true });
// -> [{ out, ms, log: string[] }]
```

Rendering a 110x40x100 region at 1920x1080 (193k visible quads, 760 emitters, 8 point lights with
2 shadow casters, 4x MSAA, bloom) takes about 9 s end to end in SwiftShader (`test/perf_hall.png`,
`node tools/render/test/run_tests.mjs perf --perf`).

## Scene spec

Everything in `docs/RENDERER.md` plus a few optional extras. Coordinates are world coordinates.

| field | meaning (default) |
|---|---|
| `width`, `height` | output size (1920x1080) |
| `voxels` | snapshot path, relative to the scene file |
| `packs` | extra pack folders (each with `BP/` and/or `RP/`), e.g. test fixtures |
| `camera` | `{ pos, target, fov (vertical deg, 70), roll? }` |
| `style` | `vibrant` \| `classic` \| `camera_feed` |
| `time` | `night` (default) \| `day` (bright sky light + shadowed sun; minimal) |
| `exposure` | multiplier on the style's exposure (1) |
| `entities` | `[{ id, pos, yaw, anim, t, eyes, scale, eyeIntensity? }]` - `yaw` 0 = facing south (Minecraft yaw); `anim` = short name (`idle`, `perform_1`/`perform`, `pose_1`/`pose`...) or full `animation.*` id |
| `extra_lights` | `[{ type: point\|spot\|dir\|ambient, pos, target, color, intensity, distance, angle, penumbra, decay, shadow, shadowExtent }]` |
| `fog` | `{ color, density }` (style default `#07080c` / 0.03); `null` disables |
| `bloom` | `{ strength, radius, threshold }` (vibrant 0.45 / 0.45 / 0.9); `null` disables |
| `lighting` | tuning: `block` (baked block-light scale, 0.8), `curve` (falloff exponent, 1.3), `sky` + `skyIntensity` (night sky light colour, `#1d2740` x 0.55), `ambient` (`#020203`), `faceDim` (MC directional shading strength, 0.3), `spec` (indirect specular from block light, 0.5), `emissive` (emissive intensity, 2.4), `normal` (heightmap normal strength, 1), `brightness` (classic: MC brightness option 0..1, 0.5) |
| `lights` | real-light selection: `max` (8 point lights), `shadows` (2), `shadowSize` (768), `intensity` (16), `scale` (1), `minLevel` (6), `maxDistance` (48), `includeStatic` (false), `maxSpots` (6), `spotShadows` (3), `spots` (per block id: `{ angle, pitch, intensity, range, penumbra }`; any block id containing `spotlight` is a spot by default) |
| `halo` | light halo sprite strength in the haze (1; 0 off) |
| `beams` | spotlight beam strength in the haze (1; 0 off) |
| `background` | clear colour (fog colour) |
| `msaa` | samples (4) |
| `camera_feed` | `{ grain, scan, vignette, distort, chroma, gamma, tint, seed }` overrides for the CCTV pass |
| `sun` | `{ dir, color, intensity }` directional light with shadow (set by `time: day`) |

The snapshot's `signs` (`{ pos, lines }`) are drawn on wall / standing / hanging signs at those positions.

## How it works

`render_world.mjs` (Node) loads the scene + snapshot, resolves every palette entry with
`blocks.mjs`, fetches/decodes vanilla textures (`fetch_vanilla.mjs`), pre-processes textures with
`texproc.mjs`, resolves entities, then calls `window.renderWorld()` in `world.html`/`world.js`
through `render.mjs` (static server + Chromium with the SwiftShader flags).

* **Vanilla blocks** - textures via Mojang's `resource_pack/blocks.json` +
  `textures/terrain_texture.json` (cached in `tools/.cache/vanilla/`, git-ignored; `/opt/bedrock-samples`
  is used when present). `.tga` files are decoded (own decoder, verified against Pillow) and cached as
  PNG. Vanilla VV texture sets (`*.texture_set.json`, MERS) are fetched too, so vanilla blocks get
  metalness/roughness/emissive. Per-face keys (`up/down/side/north/...`), legacy texture arrays
  (index 0, or by state for doors, barrels, cakes, candles), `isotropic` random rotation of tops, grass
  tint `#79c05a` (+ overlay tint on grass sides, foliage tint on leaves). Block ids are the 1.26 names
  (`grass_block`, `iron_chain`, `wooden_door`, `trapdoor`, ...; a few aliases such as `oak_trapdoor`
  also work).
* **Shapes** (`shapes.js`, Java-model-style elements, UVs world-locked like `uvlock` unless explicit):
  full cube, slab (`minecraft:vertical_half`), double slab, stairs (`weirdo_direction`,
  `upside_down_bit`, `minecraft:corner` or computed corners), carpet, trapdoor (`direction`,
  `open_bit`, `upside_down_bit`), panes / iron bars (`minecraft:connection_*` states or computed from
  neighbours), chain (`pillar_axis`), lantern (`hanging`), fence, fence gate, wall, door
  (`minecraft:cardinal_direction`, `open_bit`, `door_hinge_bit`, `upper_block_bit`; direction/open from
  the lower half, hinge from the upper), button (`facing_direction`, pressed), wall / standing / hanging
  sign (+ text), ladder, cake (`bite_counter`), flower pot, logs & pillars (`pillar_axis`), barrel
  (`facing_direction`), torch / wall torch (`torch_facing_direction`), end rod, pressure plate, snow
  layer, cross plants, glass / leaves (non-opaque cubes). Invisible: air, `light_block*`, barrier,
  structure_void. Everything else renders as a cube with its textures; unknown ids get the magenta
  "missing" texture and a warning.
* **Custom blocks** (`fnar:*` or any id found in a pack): `packs/BP/blocks/*.json` (+ extra `packs`),
  state defaults incl. traits, permutations with a small molang evaluator (`q./query.block_state`,
  `==`, `!=`, `<`..., `&&`, `||`, `!`, `?:`, numbers / strings / bools), later permutations override
  earlier ones per component; `minecraft:geometry` (string or `{identifier, bone_visibility}`;
  `minecraft:geometry.full_block` default) from `packs/RP/models/blocks/*.geo.json`;
  `minecraft:material_instances` (face names, per-face `material_instance` in the geometry, `*`
  fallback, string aliases, `render_method`, `face_dimming`, `ambient_occlusion`);
  `minecraft:transformation` (rotation about the block centre, pivots, translation, scale);
  `minecraft:light_emission` / `light_dampening` (default 15); colour/type from
  `local_lighting/local_lighting.json` (`light_color`, `light_type`), else warm white.
  Textures resolve through the RP `terrain_texture.json` (strings, arrays, `{path}`, `variations` picked
  per position), `*.texture_set.json` (MER/MERS -> metalness/roughness/emissive maps, uniform values,
  `heightmap` -> per-texel normal map, `normal`), flipbooks (frame 0). Not-yet-merged
  `tools/fragments/{terrain,flipbook,local_lighting}_*.json` fill gaps in the main pack.
  Custom geometry goes through `bedrock_model.js` (the same Blockbench conventions as the entities):
  file +X = west, per-face UVs with Blockbench's up/down handling. A model authored facing north with
  `rotation [0, 90, 0]` faces west, `[0, -90, 0]` east (checked in `test/close_orient_*.png`).
* **Lighting** - every emitter does a Minecraft flood fill (level - 1 per step, opaque blocks stop it,
  `light_dampening` subtracts), each emitter's contribution is curved with MC's lightmap curve, coloured
  and summed per cell; a sky-light flood fill (open sky above the snapshot) adds night-sky light. Per
  vertex the renderer samples this field with smooth lighting (trilinear over the 8 cells around the
  vertex, opaque cells excluded) and ambient occlusion (MC-like 0.8/0.6/0.4). In `vibrant` this baked
  term is injected into `MeshStandardMaterial` as uniform-environment irradiance + radiance (so metals
  and glossy tiles still reflect), with a steeper falloff exponent for "pools" of light. On top,
  up to `lights.max` real `PointLight`s from clustered emitters ranked by intensity, distance, frustum
  and line of sight (1-3 with PCF soft shadows, soft near-field radius against hot spots), and
  `SpotLight`s for spotlight blocks (aimed along their facing, tilted down, shadowed, with a haze beam).
  Halo sprites fake light scattering in the exp fog. Entities get the same baked light per vertex.
* **Entities** - `packs/RP/entity/*.entity.json` (identifier `fnar:<id>`) -> geometry, texture,
  animations, `eyes`/`glow` texture (emissive) and `_mer` texture set; otherwise
  `assets/source_models/**` (`fnaf:<id>`). Without an eyes texture, bright red pixels inside the
  `head` bone's UV rectangles become emissive.

Caches: `tools/.cache/vanilla/` (Mojang files, `missing.json` remembers 404s),
`tools/.cache/render/` (processed textures, converted pack TGAs, eye masks, perf world).

## Tests

```sh
node tools/render/test/run_tests.mjs            # regenerate snapshots + render every scene (~2.5 min)
node tools/render/test/run_tests.mjs close_     # only scenes whose file name contains "close_"
node tools/render/test/run_tests.mjs perf --perf # 110x40x100 performance world at 1920x1080
python3 tools/render/test/fixtures/make_fixtures.py   # regenerate the synthetic fnartest:* pack
```

* `test/test_room.json` (`make_test_room.mjs`): small building with every shape, lit / unlit /
  coloured / invisible emitters, sky light, dark corners, signs, the synthetic custom blocks from
  `test/fixtures/` (`fnartest:*`: full_block with per-face instances, custom geometry with an
  orientation atlas, lamp with `bone_visibility` + MER emissive + local light colour, MER + heightmap
  tile, metal, alpha-test grate, blend glass, flipbook sign, 2x2 tiled panel, an unknown id) and every
  real `fnar:*` block found in `packs/BP/blocks` (zone E). Scenes in `test/scenes/`.
* `test/gallery.json` (`make_gallery.mjs`): every vanilla shape variant on a grid (`gallery_*.png`).
* `test/showcase.json` (`make_showcase.mjs`): a pizzeria dining hall / stage / office built from the
  real `fnar:*` blocks with BLOCKS.md placement conventions (vanilla fallbacks for missing ones), with
  the animatronics - the closest thing to final preview pictures (`showcase_*.png`).

## Known limitations

* Light is Minecraft-like, not path traced: no screen-space reflections, no real volumetrics (halos and
  beam cones fake them), block light passes through non-full blocks (except `light_dampening`).
* Only a handful of real lights can be afforded in SwiftShader; distant/hidden emitters contribute only
  through the baked block light.
* Vanilla shape coverage is the list above; other special blocks (beds, chests, rails, redstone, plants
  with growth stages, water/lava, banners, item frames...) render as textured cubes or with texture 0.
  Fluids are not rendered. Biome tints other than grass/foliage are not applied.
* Bedrock-specific texture orientation of a few vanilla faces (e.g. some top textures, door hinge
  mirroring) follows Java's model conventions and may differ slightly from the game.
* `minecraft:transformation` multi-axis rotation order and translation units (blocks) are best guesses;
  block culling rules (`minecraft:geometry.culling`), `uv_lock`, `item_visual` and per-instance
  `tint_method` are ignored. Custom geometry faces touching a full opaque neighbour are culled.
* Entities: one animation sampled at one time (no animation controllers / molang variables); render
  controllers are not evaluated (all bones visible, eyes texture used as an emissive overlay).
* Sign text uses a monospace system font, not Minecraft's font.

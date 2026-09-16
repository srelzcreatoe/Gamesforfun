# Brief: VOXEL ENGINE engineer

Read COMMON.md first. Your contract: ARCHITECTURE.md §4 (world & voxel engine), §5 (chunk shaders), plus §2, §3, §12. Also read game/data/blocks.json
and game/autoload/Textures.gd (block texture array, face layers, animated frames).

You own: game/scripts/world/** (ChunkColumn.gd, ChunkManager.gd, ChunkMesher.gd, Lighting.gd, Fluids.gd, VoxelPhysics.gd, World.gd, SaveManager.gd,
BlockTable.gd, BlockShapes.gd, FlatTestGen.gd, DebugCamera.gd, ...), game/scenes/world/World.tscn, game/shaders/chunk_opaque.gdshader,
game/shaders/chunk_cutout.gdshader, a first functional game/shaders/water.gdshader (the shaders engineer polishes it later keeping your uniforms),
game/tests/test_world_*.gd. (SkyController.gd/Weather.gd/Clouds.gd in scripts/world are the shaders engineer's.)

Deliverables, in priority order:
1. `ChunkColumn` + `World` + `ChunkManager` per §4: streaming around `set_view_center` with `Game.settings.render_distance`/`sim_distance`;
   generation on `WorkerThreadPool` through a pluggable generator: `World.generator` is any object with
   `generate_column(col: ChunkColumn, seed: int, planet: Dictionary) -> void` (the worldgen engineer provides `scripts/worldgen/WorldGenFactory.gd`
   with `static func create(planet_def: Dictionary, seed: int) -> Object`; until it exists use your `FlatTestGen.gd`: hills from FastNoiseLite,
   stone/dirt/grass_block, ponds of water, a few oak trees, tall grass/flowers, torches). States EMPTY→GENERATED→DECORATED→LIT→MESHED; neighbours
   GENERATED before meshing (pass a 3x3 neighbourhood snapshot or 1-block borders to the mesher thread).
2. `ChunkMesher.build_section(...)` on worker threads producing `opaque`, `cutout`, `water` surfaces with the §4 vertex layout
   (UV, UV2=(layer, packed_light/255), COLOR=(tint rgb, ao)). Shapes from blocks.json: cube, cutout_cube (cull only against same id),
   translucent_cube, cross (random offset by position hash), crop, liquid (height from meta level 8=source ≈0.875, flowing lower, slanted toward flow;
   sides only against air), slab_bottom, torch, ladder, fence (post + arms), door/trapdoor (meta open bit), waterlily, snow_layer, model (cube for now).
   Per-vertex AO (4 levels) + smooth light. Tint: grass/foliage/mask via `Registry.biome(...)` colours (fallback #91BD59/#77AB2F), water #3F76E4.
   Layers via `Textures.block_face_layer(id, face, x, y, z)`; animated tiles: encode frames in the fractional part of UV2.x (layer + frames/64.0),
   fps as a uniform — document it in the shader header.
3. Shaders: `sampler2DArray tiles` (filter_nearest_mipmap), unshaded pipeline: albedo = tex.rgb * mix(1, COLOR.rgb, tex.a) for opaque (tint mask) /
   full tint for cutout; brightness = face factor (top 1, north/south 0.8, east/west 0.6, bottom 0.5) × max(sky_light*daylight, block_light warm) × ao;
   uniforms `float daylight, vec3 sun_color, vec3 fog_color, float fog_start, float fog_end, float time, vec3 ambient_color`; distance fog; cutout with
   ALPHA_SCISSOR 0.5 + gentle wind sway for plants/leaves; water translucent, cull_disabled, vertex wave 0.05, animated frames, fresnel brightening,
   depth_draw_always. gl_compatibility only (no SCREEN_TEXTURE needed in v1).
4. `Lighting.gd`: sky light flood fill (15 at open sky, `light_attenuation` for water, opaque stops) + block light BFS from emissive blocks, on the
   worker thread after generation, incremental relight on `set_block` (bounded, budgeted). Light crosses chunk borders for loaded neighbours.
5. `Fluids.gd`: Minecraft-style water/lava spreading (meta 8 source, 7..1 flowing, falling flag; `flow.spread/tick`), infinite source rule, removal,
   lava+water -> obsidian/cobblestone/stone, flow vectors (`World.flow_at(x,y,z) -> Vector3`) used by `VoxelPhysics.fluid_at`; budgeted per tick,
   only within sim_distance.
6. `VoxelPhysics.gd` static helpers (§4): per-axis AABB sweeps (slabs/paths/farmland `height`, `solid=false`, fences 1.5 tall, ladders climbable,
   doors), step-up 0.51 on ground, `fluid_at` (submerged fraction, flow), `aabb_intersects_solid`, `World.raycast` (DDA, 256 steps, block/normal/point/
   dist, `ignore_liquid`).
7. `World.gd` API (§4): `set_block` (dirty + neighbour sections, relight, Events.block_changed), `get_height`, `get_biome`, `spawn_entity` (loads
   `Registry.entities[type].scene` if it exists else a placeholder box Node3D; adds to `$Entities`; sets `entity.world = self` when the property exists),
   `entities_in_aabb`, time of day (24000 ticks per 1200 s, paused when `Game.paused_by_ui`), `daylight()`, `sun_direction()`, `explode(...)`
   (removes blocks by hardness, unbreakable stay, emits `Events.explosion`), `start(info, profile)` (planet/seed from info; generator from
   WorldGenFactory if present else FlatTestGen; streams around the profile position; when the 3x3 ring is meshed spawns `Player.tscn` if
   `res://scenes/player/Player.tscn` exists (sets `Game.player`, emits `Events.player_spawned`) else your `DebugCamera` (WASD+mouse; slow auto-orbit
   under `--autoplay` for screenshots); emits `Events.world_loaded`), `load_progress() -> float`, `save_modified_chunks()`, `flow_at`.
   `World.tscn`: `Chunks`, `Entities`, `WorldEnvironment` (placeholder ProceduralSkyMaterial, ambient from sky, fog off — the shaders engineer's
   `SkyController` replaces it), `Sun` (DirectionalLight3D; shadows only if `Game.settings.shadows`), `Fluids` ticker. Each frame the World pushes
   `daylight, sun_color, fog_color, fog_start, fog_end, ambient_color, time` into the chunk/water materials (from SkyController if it exists, else
   your own day/night curve).
8. `SaveManager.gd`: per-column `user://worlds/<slug>/<planet>/c_<cx>_<cz>.bin` (magic, version, DEFLATE of blocks+meta+biomes), modified-only,
   load skips generation, robust to corrupt files; `Game.save_all()` + reload keeps edits.
9. Performance: ≤ 6 ms/frame world updates on llvmpipe at render distance 5; ≤ 2 section uploads/frame; reuse PackedArrays; per-block-id flat
   lookup arrays in `BlockTable` (shape/opaque/solid/light/tint/height...) instead of Dictionary lookups in the mesher; one-line profile print every
   5 s only when `Game.settings.show_fps`.
10. Tests (`tools/run_tests.sh voxel world`): index math, set/get roundtrip, lone cube = 6 faces, shared faces hidden, cross = 4 quads, lighting
    (torch 14 at source, 13 adjacent; sky 15 above ground, 0 under 3 opaque), fluid spreads to level 7 and stops, VoxelPhysics floor stop + slab
    step-up, raycast block/face, save/load roundtrip.

Verify visually: `tools/screenshot.sh .../shots/voxel_1.png --sandbox voxel --seconds 12 --args "--autoplay=777"` — lit, textured terrain, water,
trees, grass, correct AO, no magenta tiles, no z-fighting, no script errors. Report measured gen/mesh timings.

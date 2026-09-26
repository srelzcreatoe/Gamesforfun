# Brief: WORLD GENERATION engineer

Read COMMON.md first. Your contract: ARCHITECTURE.md §4 (generator interface: `generate_column(col: ChunkColumn, seed: int, planet: Dictionary)`),
§9 (structures/dragon balls placement hooks), DATA_SCHEMA.md (biomes.json, planets.json, structures.json). Read the voxel engineer's code in
game/scripts/world/ (ChunkColumn.gd, World.gd, BlockTable.gd, FlatTestGen.gd, Lighting.gd) to match how columns are filled (index math, biome bytes,
heightmap, `entities_pending`, `structure_marks`, state transitions) and game/data/biomes.json, planets.json, structures.json, game/assets/structures/*.json
(converted DMZ structure templates + procedural ones, produced by the data engineer).

You own: game/scripts/worldgen/** (WorldGenFactory.gd with `static func create(planet_def: Dictionary, seed: int) -> Object`, WorldGen.gd base,
EarthGen.gd, NamekGen.gd, OtherworldGen.gd, SacredGen.gd, TimeChamberGen.gd, VegetaGen.gd, YardratGen.gd, VampaGen.gd, CerealGen.gd, HellGen.gd,
HeavenGen.gd, SpaceGen.gd, OrbitGen.gd, BiomeMap.gd, Terrain.gd (noise stacks), Caves.gd, Decorator.gd (trees/plants/ores/lakes), Trees.gd (all tree
types incl. ajissa/sacred/cherry/cactus/big oak/jungle), Structures.gd (placement + stamping from assets/structures json, jigsaw-ish villages),
DragonBallPlacement.gd (deterministic seeded positions per set), SpawnPoint.gd), game/tests/test_worldgen_*.gd.

Deliverables:
1. Deterministic, seeded generation (same seed + planet => identical columns regardless of visit order; unit-test it) using FastNoiseLite stacks
   (continentalness, erosion, peaks/ridges, temperature, humidity) with cheap 3D cave noise sampled at stride 4 and interpolated (spaghetti + cheese
   caves on Earth/Namek/Vegeta only), ore veins per planet (blocks.json ores), water at sea level, rivers, beaches, gravel/sand under water, snow above
   altitude, bedrock floor. Keep a column under ~8 ms on desktop (measure; the voxel engineer runs it on a worker thread).
2. Biome selection from biomes.json per planet (temperature/humidity/continentalness + `weight`), with biome bytes written into `col.biomes` (index
   into `Registry.biome_order`), surface/filler/underwater blocks, per-biome trees/plants/mobs (write mobs into `col.entities_pending` as
   `{type, pos}` sparsely; the Spawner handles ongoing spawns), grass/foliage colours come from biomes.json (the mesher tints).
3. Planet generators matching the DMZ / DMZ Plus feel: Earth (varied biomes, the `wasteland` rocky battlefield biome must exist in reasonable amounts
   near spawn so Saiyan-saga quests can spawn there — bias the first 400 blocks around spawn to include plains + wasteland + forest + a beach/ocean for
   Kame House); Namek (green sky feel: ajissa_plains with blue grass? no — use the DMZ namek blocks: namek_grass_block/namek_dirt/namek_stone, lakes
   of water (namek water tint via biome water_color), ajissa trees (tall bulbous canopies of namek_ajissa_leaves on ajissa_log), namekian_rivers,
   namek_rocky hills, Namek villages from assets/structures village pieces); Otherworld (endless otherworld_cloud plains at y=60, Snake Way winding from
   the Check-In Station toward King Kai's planet (use the snake_way segments + your own path noise; make it walkable/flyable), King Kai's planet as a
   floating sphere structure with high gravity flag handled by planet data, HFIL/hell below the clouds optional); Sacred Kai planet (sacredkai biomes
   with sacred_planet_grass_block, sacred trees, floating pillar for Old Kai); Time chamber (white infinite plane of time_chamber_block at y=60 with
   the timechamber structure at the origin); Vegeta (rocky_stone/rocky_dirt mesas + vegeta_red_sand, red sky handled by planet data); Yardrat
   (rolling purple hills, yardrat_grass); Vampa (vampa_sand dunes, dead bushes, bone_block scatters, vampa_rock spires, a few lakes); Cereal
   (cereal_sand mesa bands with terracotta layers); Hell planet (hell_rock, hell_rock_molten pools of lava, ash-like gravel, no water); Heaven
   (heaven_grass_block meadows with flowers, heaven_cloud floating islands, small lakes, heaven_arch structure); Deep space (empty; asteroid_rock
   clumps at random 3D positions between y 32-208 like DMZ Plus `asteroid_rock` feature; no gravity handled by planet data); Orbit (a thin band of
   asteroid rocks + nothing else).
4. Structures: stamp every `structures.json` entry on its planet with deterministic placement (rarity per region cell, y_mode surface/absolute/sky,
   `unique` ones placed once at a seeded position within 300-1200 blocks of spawn, `min_distance_from_spawn`, `clear_above`), spanning chunk borders
   correctly (stamp per column using the structure's world origin decided from a region-level seeded decision so every column agrees), spawn their
   `entities` into `col.entities_pending` and record `structure_marks` `{id, quest_tag, aabb}` so quests can require "be in structure". Kame House on
   a beach/ocean edge near spawn, Capsule Corp in plains near spawn, Korin tower + Kami's lookout (sky y 100+ above the tower) in the plains/mountains,
   Goku's house in a forest, Cell arena in the wasteland, Gero's lab in mountains, RR tower in desert/badlands, Frieza ship + Guru + villages on Namek,
   Babidi's ship in the wasteland/desert, Check-in station + King Kai planet in otherworld, Old Kai pillar on the sacred planet.
5. `DragonBallPlacement.gd`: for each ball set (earth: 7 on Earth, namek: 7 on Namek, super: 7 in deep space, cereal: 2 on Cereal) choose seeded
   positions within `spawn_range` of the planet spawn, on the surface (or floating in space), and register them via `col.entities_pending`
   `{type: "dragon_ball", pos, data: {set, star}}` — the quests engineer's DragonBalls manager reads/persists found state, so expose
   `static func positions(set_id: String, seed: int) -> Array[Vector3]` too.
6. `SpawnPoint.gd`: `static func find(planet_def, seed) -> Vector3` (surface, not water, near 0,0).
7. Tests: determinism (two generators same seed -> identical block arrays for 4 columns; different visit order), sea level/water presence on Earth,
   biome bytes valid, a structure stamps identically across its columns, dragon ball positions deterministic and on the surface.
8. Verify visually with `tools/screenshot.sh ... --sandbox worldgen --seconds 14 --args "--autoplay=4242 --planet=earth"` (and namek, otherworld,
   vegeta, heaven, hell_planet, universe_7_deep_space) once the voxel engine renders; LOOK at each PNG and iterate on terrain shape/colours until they
   look like the DragonMineZ/DMZ Plus planets and Minecraft-quality Earth terrain.

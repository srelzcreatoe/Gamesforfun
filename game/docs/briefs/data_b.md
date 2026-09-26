# Brief: DATA CONVERSION engineer, part B (items, recipes, biomes, planets, structures)

Read COMMON.md first. Then game/docs/ARCHITECTURE.md, game/docs/DATA_SCHEMA.md, game/autoload/Registry.gd and game/data/blocks.json (the FIXED block
registry: never edit it; map anything missing to the closest existing block id).

Sources: DragonMineZ 2.1.3 at /tmp/claude-0/-home-user-Gamesforfun/a637a6ef-7708-59b3-aeb2-5b4698448421/scratchpad/ex/dmz (GPL-3.0), DMZ Plus at
.../scratchpad/ex/dmzplus, Fused packs at .../scratchpad/ex/fused. Item icon PNGs already exist under /home/user/Gamesforfun/game/assets/textures/items/
(DMZ items verbatim incl. subfolders armors/, weapons/, patterns/; generated vanilla icons like iron_pickaxe.png, iron_ingot.png, bread.png, senzu_bag.png,
capsule.png, key.png, space_suit.png; block icons block_<block_id>.png). List that directory before you start.

Write `tools/convert_dmz_data_b.py` (deterministic, re-runnable) producing:

1. `data/items.json` (`{"items": [...]}`) — every non-block item: (a) ALL DragonMineZ items from lang keys `item.dragonminez.<id>` that have an icon
   under assets/textures/items (search subfolders; `icon` = path relative to assets/textures/items without extension, e.g. "armors/goku_gi_chestplate");
   strip § colour codes; classify `kind`: food (senzu_bean heals all + ki/stamina; meats, frog legs, might_tree_fruit, heart_medicine with food values),
   armor (every *_helmet/_chestplate/_leggings/_boots -> `armor: {slot, defense, layer: "<set>", set}` where layer is the texture base name existing in
   assets/textures/armor/ e.g. goku_gi_layer1.png -> "goku_gi"; defense by set: gi 2/5/4/2, saiyan armor 3/7/5/3, kikono 4/8/6/4, gete 5/9/7/5,
   strongest 6/10/8/6, space_suit 1/3/2/1 with `bonus.oxygen`), weapon (z_sword, brave_sword, power_pole, yajirobe_katana, trunks_sword,
   dimensional_sword... with damage/speed/anim_set from data/dragonminez/weapon_attributes and data/minecraft/weapon_attributes), scouter (color),
   radar (dball_radar -> id "dragon_radar" set earth, namekdball_radar -> "namek_dragon_radar" set namek, fused radar, super_dball_radar (DMZ Plus) set
   super, cereal radar set cereal), dragon_ball (dball1..7 earth, dball1_namek..7 namek: `dragon_ball: {set, star}`), capsule (colours + gete capsules:
   `capsule: {type}`), vehicle (saiyan_ship -> `vehicle: "space_pod"`, flying_nimbus/black_nimbus -> "nimbus"), weights (`weights: {mult}`), material
   (kikono_*, gete_*, radar parts, chips, cpus, ki_battery, anti_ki_cloak...), key (hbtc_key), music_disc (-> bgm files), misc. (b) Vanilla items with
   generated icons: wooden/stone/iron/golden/diamond/kikono/gete pickaxe/axe/shovel/hoe/sword (tool tier 1..5 (kikono/gete 5), speed 2/4/6/8/8/9/12,
   durability 60/130/250/32/1560/2000/3000, damage), iron/gold/copper ingot, raw_iron/copper/gold, coal, diamond, emerald, redstone, lapis_lazuli,
   glowstone_dust, kikono_dust, stick, bread, carrot, potato, baked_potato, melon_slice, egg, cooked_meat, raw_meat, bone, string, leather, feather,
   book, paper, bowl, sugar, flint, bucket, water_bucket, lava_bucket, snowball, clay_ball, wheat_seeds, beetroot_seeds, melon_seeds, pumpkin_seeds,
   apple, wheat, beetroot, senzu_bag (misc), capsule_house (kind capsule, icon "capsule"), space_suit_* (DMZ Plus icons). Every item: id, name, icon,
   stack, kind, rarity. Make sure every item referenced by blocks.json `drops` exists (gete_scrap, kikono_shard, coal, raw_iron, carrot, potato, ...).
2. `data/recipes.json` (`{"recipes": [...]}`) — port every recipe under data/dragonminez/recipes/ and data/dmzplus/recipes/ (shaped/shapeless/smelting;
   map ids; tags like #minecraft:planks / minecraft:wool / forge:ingots/iron -> lists of our ids) into the DATA_SCHEMA format (`station`: hand (fits 2x2),
   crafting_table, furnace, kikono_station, gete_forge), skipping recipes whose result does not exist (print them). Add vanilla essentials: planks from
   each log (4), sticks, crafting_table, furnace, chest, torch, ladder, all tool tiers, iron/gold blocks <-> ingots, smelt raw ores -> ingots,
   cobblestone->stone, sand->glass, bread, baked_potato, cooked meats, bookshelf, fences, doors, stone_bricks, bricks from clay, snow_block,
   dragon_ball_altar (7 stone + gold), training_post, capsule_house (capsule + planks).
3. `data/biomes.json` (`{"biomes": [...]}`) — Earth: plains, sunflower_plains, forest, birch_forest, dark_forest, jungle, taiga, snowy_taiga, snowy_plains,
   ice_spikes, desert, badlands, savanna, swamp, mountains, meadow, cherry_grove, beach, ocean, deep_ocean, river, mushroom_fields, wasteland (DMZ
   `rocky`: rocky_stone/rocky_dirt), frozen_ocean; Namek (data/dragonminez/worldgen/biome): ajissa_plains, namekian_rivers, namek_rocky; otherworld:
   other_world, king_kai_planet; sacred_kai_planet: sacredkai_plains, sacredkai_hills, sacredkai_rivers, sacred_land; time_chamber:
   hyperbolic_time_chamber; DMZ Plus (data/dmzplus/worldgen/biome): vegeta_wasteland, yardrat_hills, vampa_barrens, cereal_mesa, hell_planet_wastes,
   heaven_meadows, deep_space, asteroid_field, orbit. Fields per DATA_SCHEMA: colours (from the source biome json `effects` when present, ints -> hex),
   temperature, humidity, surface/filler/underwater (ONLY blocks.json ids), `trees` [{type, density}] (oak, birch, spruce, jungle, acacia, dark_oak,
   cherry, ajissa, sacred, cactus...), `plants` [{block, density}] (existing plant blocks only), `mobs` [{entity, weight, min, max}] with entity ids
   dino1, dino2, dino3, dinokid, sabertooth, namek_frog, bandit, red_ribbon_soldier, robot1, namek_warrior, namek_trader only, `quest_tag` (the
   Minecraft/DMZ biome id quests require — scan data/dragonminez/previousQuests for every BIOME value and make sure each maps to exactly one biome here),
   `planet`, `weight`.
4. `data/planets.json` (`{"planets": [...]}`) — earth, namek, otherworld, sacred_kai_planet, time_chamber, vegeta, yardrat, vampa, cereal, hell_planet,
   heaven, universe_7_deep_space, orbit (generic) following DATA_SCHEMA with values from DMZ Plus data/dmzplus/dmz_planets/*.json (gravity as a multiple
   of 9.807, oxygen, temperature), assets/dmzplus/dmzplus_planet_renderers/*.json (sky colours, stars, star_brightness, sky_texture -> milky_way
   strength, sky_renderables -> `bodies` [{texture relative to assets/textures/environment, scale, kind}]), DMZ dimension_type + noise_settings (sea
   level, default block), spacepod destinations (`travel.unlock`, icon_index). `generator` strings: earth, namek, otherworld, sacred, time_chamber,
   vegeta, yardrat, vampa, cereal, hell, heaven, space, orbit. `structures` per planet from 5. `music` contexts. `day_length` minutes (namek `suns: 3`,
   time_chamber endless day).
5. `data/structures.json` (`{"structures": {...}}`) + converted structure files under game/assets/structures/<name>.json: write a pure-Python NBT reader
   (gzip + tag parser; nbtlib is NOT installed) for data/dragonminez/structures/*.nbt (roshi_house, kamilookout, goku_house, cell_arena, gero_lab_*,
   rrtower, piccolo_house, yamcha_house, frieza_ship, elder_guru, babidi_*, timechamber, trunks_ship, vegeta_pod, cc_villager, oldkai_pillar) and the
   village pieces (village_ajissa/**, village_sacred/** — skip entities/*.nbt but record their entity ids as npc spawns). Output per structure:
   `{"size":[x,y,z], "palette":["air","oak_planks",...], "blocks":[[x,y,z,palette_index],...], "entities":[{"id":"master_roshi","pos":[x,y,z]}],
   "origin_offset":[x,y,z]}` with the palette mapped from Minecraft block names to OUR block ids via a mapping table (quartz_block, concretes, stairs ->
   base block, slabs -> oak_slab/stone_slab, panes -> glass, unknown -> nearest by material; print the mapping and unmapped list). Also generate
   procedural definitions for structures without NBT: capsule_corp (domed white/yellow building with logo ~20x12x20), korin_tower (1-wide 90-tall
   column of korin_tower_block with a platform + small house on top), snake_way segment (64-long S-curve of snake_way blocks with edges), king_kai_planet
   (12-radius sphere of kai_grass_block/dirt with a small house + road ring), check_in_station (King Yemma's building 24x12x16 of check_in_wood),
   hell_gate, heaven_arch, kai_shrine. structures.json entry: `{"file": "assets/structures/x.json", "planet": "earth", "biomes": [...], "rarity": N,
   "y_mode": "surface|absolute|sky", "y": .., "unique": bool, "spawn_entities": [...], "clear_above": bool, "quest_tag": "dragonminez:roshi_house",
   "min_distance_from_spawn": N}` using DMZ worldgen/structure_set/*.json for placement hints.

Rules: only blocks.json block ids; entity ids in DMZ style (saga_*, master_*, dino1, namek_warrior, bandit...); validate JSON with python; then run
`cd /home/user/Gamesforfun && tools/godot.sh --headless --path game --quit-after 3 2>&1 | grep -E "Registry|SCRIPT ERROR|\[E\]" | head -60` and fix
every problem that is yours (unknown entity ids in biome mobs may persist until part A lands). Report counts, mapping summary, structures with sizes,
and anything not converted.

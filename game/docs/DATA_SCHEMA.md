# Data schema (game/data/*.json)

All files are plain JSON, UTF-8, loaded once at boot by `Registry`. Ids are
`snake_case` strings. Texture keys refer to `assets/textures/blocks/<key>.png`
(16x16 RGBA). Item icons refer to `assets/textures/items/<key>.png`.

## blocks.json
```json
{ "blocks": [
  { "id": "air", "name": "Air", "shape": "none" },
  { "id": "stone", "name": "Stone", "shape": "cube",
    "textures": { "all": "stone" }, "variants": ["stone0","stone1","stone2","stone3","stone4"],
    "material": "stone", "hardness": 1.5, "tool": "pickaxe", "min_tier": 0,
    "drops": [{"item": "cobblestone", "count": 1}], "light": 0, "tint": "none",
    "sound": "stone", "opaque": true, "solid": true, "gravity": false, "flammable": false }
]}
```
* `shape`: `none` (air), `cube`, `cutout_cube` (leaves/glass: alpha-scissor, culls only against same id),
  `translucent_cube` (stained glass, ice), `cross` (plants, 2 crossed quads),
  `crop` (4 quads inset), `liquid` (water/lava; `meta` = level), `slab_bottom`,
  `torch`, `ladder`, `fence`, `door`, `trapdoor`, `waterlily`, `snow_layer`,
  `carpet`, `model` (uses `model` key: Bedrock geo rendered as entity-like mesh).
* `textures`: keys `all`, `top`, `bottom`, `side`, `north`, `south`, `east`, `west`; value is a
  texture key. `variants` overrides `textures.all/top` with a position-hashed random pick.
  `tint`: `none` | `grass` | `foliage` | `water` | `mask` (rgb×biome color only where texture alpha == 255).
* `material`: stone, earth, sand, wood, plant, leaves, glass, metal, cloth, liquid, snow, ice, cloud, special.
* `hardness` seconds at bare hand (−1 unbreakable), `tool` best tool, `min_tier` 0 hand,1 wood,2 stone,3 iron,4 diamond,5 kikono/gete.
* `light` 0..15 emission. `opaque` blocks light. `solid` collides. `gravity` falls like sand.
* `drops`: array; `{"item": "self"}` allowed. Optional `silk`: item when mined with silk.
* Optional `flow` (liquid): `{ "spread": 7, "tick": 5, "lava": false }`.
* Optional `plant`: `{ "needs": ["grass_block","dirt"], "growth_stages": 4, "stage_textures": [...] }`.
* Optional `animated`: `{ "frames": 32, "fps": 8 }` — the tile texture is a vertical strip.
* Optional `hit_sound` / `place_sound` override the material sounds.

## items.json
```json
{ "items": [
  { "id": "senzu_bean", "name": "Senzu Bean", "icon": "senzu_bean", "stack": 16, "kind": "food",
    "food": { "hunger": 20, "heal": 999, "ki": 999, "stamina": 999, "instant": true }, "rarity": "epic" },
  { "id": "iron_pickaxe", "name": "Iron Pickaxe", "icon": "iron_pickaxe", "stack": 1, "kind": "tool",
    "tool": { "type": "pickaxe", "tier": 3, "speed": 6.0, "durability": 250, "damage": 4 } },
  { "id": "goku_gi", "name": "Goku's Gi", "icon": "armors/goku_gi_chestplate", "stack": 1, "kind": "armor",
    "armor": { "slot": "chest", "defense": 6, "layer": "goku_gi", "set": "goku_gi", "bonus": {"ki_regen": 0.1} } },
  { "id": "dragon_radar", "name": "Dragon Radar (Earth)", "icon": "dball_radar", "stack": 1, "kind": "radar", "radar": {"set": "earth"} },
  { "id": "dball1", "name": "Dragon Ball (1 Star)", "icon": "dball1", "stack": 1, "kind": "dragon_ball", "dragon_ball": {"set":"earth","star":1} },
  { "id": "space_pod", "name": "Saiyan Space Pod", "icon": "saiyan_ship", "stack": 1, "kind": "vehicle", "vehicle": "space_pod" }
]}
```
Kinds: `block` (auto for every block), `material`, `food`, `tool`, `weapon`, `armor`, `radar`,
`dragon_ball`, `capsule`, `vehicle`, `scouter`, `weights`, `key`, `music_disc`, `misc`.
Tools: `pickaxe`, `axe`, `shovel`, `hoe`, `sword`. Weapons also carry `weapon: {damage, speed, anim_set}`.

## recipes.json
```json
{ "recipes": [
  { "id": "planks_oak", "station": "hand", "shape": ["L"], "keys": {"L": "oak_log"}, "result": {"item": "oak_planks", "count": 4} },
  { "id": "dragon_radar", "station": "crafting_table", "shape": ["GRG","RCR","GIG"], "keys": {"G":"glass","R":"radar_piece","C":"t1_radar_cpu","I":"iron_ingot"}, "result": {"item":"dragon_radar","count":1} },
  { "id": "cooked_dino_meat", "station": "furnace", "input": "raw_dino_meat", "result": {"item":"cooked_dino_meat","count":1}, "time": 8 }
]}
```
`station`: `hand` (2x2), `crafting_table` (3x3), `furnace` (smelting), `kikono_station`, `gete_forge`.

## biomes.json
```json
{ "biomes": [
  { "id": "plains", "name": "Plains", "planet": "earth", "temperature": 0.8, "humidity": 0.4,
    "grass_color": "#91BD59", "foliage_color": "#77AB2F", "water_color": "#3F76E4", "sky_tint": "#78A7FF", "fog_color": "#C0D8FF",
    "surface": "grass_block", "filler": "dirt", "underwater": "sand",
    "trees": [{"type": "oak", "density": 0.004}], "plants": [{"block": "tall_grass", "density": 0.12}, {"block":"dandelion","density":0.01}],
    "mobs": [{"entity":"dino1","weight":10,"min":1,"max":2}], "quest_tag": "minecraft:plains" }
]}
```
`quest_tag` lets ported DMZ quests keep their original biome ids.

## planets.json
```json
{ "planets": [
  { "id": "earth", "name": "Earth", "gravity": 1.0, "oxygen": true, "temperature": 15,
    "biomes": ["plains","forest","desert","rocky_wasteland","snowy","mountains","swamp","ocean","beach","jungle","savanna"],
    "generator": "earth", "sea_level": 62, "day_length": 20, "spawn": [0, -1, 0],
    "sky": { "type": "atmosphere", "day": "#7DAEFF", "horizon": "#CFE4FF", "night": "#050818", "sunset": "#FF8C3A", "fog": "#BFD6F5",
             "stars": 1500, "star_brightness": 0.6, "milky_way": 0.3, "clouds": true, "aurora": false, "sun_scale": 1.0, "moon": true,
             "bodies": [] },
    "structures": ["roshi_house","capsule_corp","korin_tower","kami_lookout","goku_house","cell_arena","gero_lab","rr_tower","piccolo_house","yamcha_house","vegeta_pod","trunks_ship","babidi_ship"],
    "dragon_balls": "earth", "music": "explore_earth", "travel": {"unlock": "ALWAYS", "icon": 0} }
]}
```
Planets: earth, namek, otherworld (Snake Way / King Kai / Check-in station), sacred_kai_planet,
time_chamber, vegeta, yardrat, vampa, cereal, hell_planet, heaven, universe_7_deep_space.

## entities.json
```json
{ "entities": [
  { "id": "saga_raditz", "name": "Raditz", "kind": "enemy", "scene": "res://scenes/entities/Enemy.tscn",
    "model": "entity/sagas/saga_raditz", "texture": "entity/sagas/saga_raditz", "hd_texture": true,
    "animations": ["entity/sagas/saga_base"], "hitbox": [0.6, 1.9], "scale": 0.9375,
    "stats": {"health": 450, "melee": 22, "ki": 39, "defense": 4, "speed": 1.0}, "ai_tier": 1, "faction": "villain",
    "techniques": ["blast","double_sunday"], "can_fly": true, "drops": [{"item":"broken_scouter","chance":1.0}],
    "sounds": {"hurt":"golpe1","death":"knockback_character"}, "taunt": "dmz.saga.raditz.intro", "bgm": "boss" },
  { "id": "master_roshi", "name": "Master Roshi", "kind": "master", "scene": "res://scenes/entities/Npc.tscn",
    "model": "entity/master/master_roshi", "texture": "entity/master/master_roshi", "animations": ["entity/master/master_roshi"],
    "hitbox": [0.6,1.8], "master": "roshi" }
]}
```
Kinds: `player`, `enemy`, `master`, `npc`, `animal`, `projectile`, `pickup`, `dragon`, `vehicle`, `dragon_ball`.

## races.json / forms.json / skills.json / techniques.json
Converted from DragonMineZ configs by `tools/convert_dmz_data.py`. Forms keep the DMZ
field names (`strMultiplier`, `auraColor`, `hairType`, `hasLightnings`, `transformationAnimation`,
`customModel`, `modelScaling`, `energyDrain`, `unlockOnSkillLevel`, ...). Skills have
`max_level`, `tp_costs[]`, `effect`. Techniques have `kind`, `charge`, `ki_cost`, `damage_mult`,
`cast_anim`, `fire_anim`, `charge_sound`, `fire_sound`, `color`, `size`, `speed`, `duration`, `unlock`.

## sagas.json and quests/**.json
Ported verbatim structure from DMZ (`id`, `title`, `description` resolved to English text,
`type`, `category`, `requirements`, `prerequisites`, `objectives`, `rewards`, `quest_giver`, `turn_in`),
plus resolved English `entity_name` fields. Quest ids are `"<category>:<id>"`.

## masters.json
`{ "roshi": { "entity": "master_roshi", "name": "Master Roshi", "structure": "roshi_house", "teaches": ["kamehameha","ki_control"], "trains": true, "quests": ["sidequest:roshi_basic_training"], "dialog": ["..."] } }`

## wishes.json
Per dragon: list of `{id, name, desc, type: item|tps|form|reset|recustomize|revive|planet, ...}`.

## audio.json
`{ "sfx": { "punch": ["golpe1","golpe2","golpe3"], "ki_blast": ["kiblast_shoot"], ... }, "bgm": { "menu": ["menu_music-1", ...], "explore_earth": [...], "battle": [...], "boss": [...], "transformation": [...], "space": [...], "namek": [...], "otherworld": [...] } }`

## Profile (Game.profile)
```json
{ "character": { "name": "Kakarot", "race": "saiyan", "gender": "male", "class": "warrior", "body_type": 0, "hair_type": 1,
                 "hair_color": "#222629", "eye_type": 0, "eye_color": "#222629", "skin_color": "#FFD3C9", "skin_color2": "#572117",
                 "nose": 0, "mouth": 0, "tattoo": 0, "aura_color": "#7FFFFF" },
  "stats": { "STR": 5, "SKP": 5, "STM": 5, "RES": 5, "VIT": 5, "PWR": 5, "ENE": 5 }, "tp": 0, "tp_total": 0, "alignment": 50,
  "skills": { "fly": 1, "ki_control": 1 }, "techniques": ["blast"], "forms": { "unlocked": ["ssgrades.supersaiyan"], "mastery": {"ssgrades.supersaiyan": 12.5} },
  "quests": { "active": {}, "completed": [], "claimed": [], "tracked": "" },
  "inventory": { "slots": [ {"item":"senzu_bean","count":2}, null, ... 36 ], "armor": [null,null,null,null], "hotbar": 0 },
  "position": { "planet": "earth", "x": 0, "y": 70, "z": 0, "yaw": 0 }, "spawn": {"planet":"earth","x":0,"y":70,"z":0},
  "health": 100, "ki": 100, "stamina": 100, "hunger": 20, "planets_unlocked": ["earth"], "dragon_balls": { "earth": { "found": [], "next_summon_day": 0 } },
  "play_time": 0 }
```

# Cubic World data registry schemas (save-format v1)

All game content is data-driven. The engine loads these JSON files at boot and
validates every cross-reference (block names, item names, texture tiles, biome
names). Unknown fields are ignored. All names are lower_snake_case and must be
unique within their registry.

## blocks.json
```json
{ "blocks": [ {
  "name": "grass_sod",
  "displayName": "Grass Sod",
  "shape": "cube",            // cube | cross | slab | liquid | ladder
  "textures": {                // tile names from tiles.json; "all" or per-face
    "all": "tile_name",       // OR top/bottom/side (side covers n/s/e/w)
    "top": "...", "bottom": "...", "side": "..."
  },
  "material": "earth",        // earth | stone | wood | plant | metal | glass | cloth | liquid  (drives sounds/particles)
  "hardness": 0.6,             // seconds to break bare-handed; -1 = unbreakable
  "opaque": true,              // fully blocks light + hides neighbor faces
  "translucent": false,        // rendered in translucent pass (glass, water)
  "solid": true,               // has collision
  "lightEmission": 0,          // 0..15
  "drops": "soil_clump",      // item name; omit = drops itself; "none" = nothing
  "dropCount": 1,
  "tool": "shovel",           // pick | hatchet | shovel | none (correct tool mines faster)
  "minTier": 0,                // 0 wood/fiber, 1 flintstone, 2 copper, 3 ironroot, 4 emberite, 5 starsteel; below this tier => no drop
  "gravity": false,            // falls like loose sand
  "flammable": false
} ] }
```

## tiles.json — procedural 16x16 texture recipes (rendered by tools/gen_textures.py)
```json
{ "tiles": [ {
  "name": "grass_top",
  "pattern": "speckle",       // flat | speckle | noise | grain_v | grain_h | planks
                               // | brick | crystal | leaf | cross_plant | liquid
                               // | ore (base rock + blobs) | glass | crop (stage via accent2)
                               // | ring (log end) | sand | gravel | glow
  "base": [96, 190, 92],      // RGB 0-255
  "accent": [126, 214, 116],  // pattern-dependent secondary
  "accent2": [72, 150, 74],   // optional tertiary
  "seed": 7                    // deterministic variation
} ] }
```

## items.json
```json
{ "items": [ {
  "name": "flint_pick",
  "displayName": "Flint Pick",
  "kind": "tool",             // block | tool | material | food
  "block": "grass_sod",       // kind=block: the block it places (name equality preferred)
  "icon": "tile_name",        // tile for inventory icon (kind=block may omit -> uses block side)
  "stack": 1,                  // max stack (tools 1, others 64)
  "toolType": "pick",         // pick | hatchet | shovel | blade | cultivator (kind=tool)
  "tier": 1,                   // material tier 0..5
  "durability": 132,
  "efficiency": 2.0,           // block-break speed multiplier
  "damage": 3,                 // attack hearts *2
  "food": { "hunger": 4, "heal": 0 }   // kind=food
} ] }
```

## recipes.json — shapeless with station requirement
```json
{ "recipes": [ {
  "name": "planks_from_log",
  "station": "hand",          // hand | handwork_mat | forge_table | kiln | cookpot
  "inputs": [ { "item": "sunbark_log", "count": 1 } ],
  "output": { "item": "sunbark_planks", "count": 4 }
} ] }
```
Kiln/cookpot recipes also take `"fuel": true` handling: any recipe at those
stations consumes station fuel, not a recipe input.

## biomes.json
```json
{ "biomes": [ {
  "name": "sunleaf_meadows",
  "displayName": "Sunleaf Meadows",
  "temp": [0.35, 0.75],       // selection window in 0..1 climate space
  "moist": [0.25, 0.65],
  "surface": "grass_sod",
  "subsurface": "soil",
  "underwater": "shell_sand",
  "heightBase": 24,            // added to sea level 48
  "heightVar": 14,
  "roughness": 0.5,            // 0 smooth .. 1 cliffy
  "treeType": "sunbark",      // registered tree generator name or "none"
  "treeDensity": 0.006,        // per-column probability
  "plants": [ { "block": "wild_sunbean", "density": 0.02 } ],
  "grassTint": [140, 200, 90],
  "leafTint": [120, 190, 80],
  "skyTint": [130, 180, 235],
  "creatures": [ { "creature": "spriggle", "weight": 10 } ]
} ] }
```

## creatures.json
```json
{ "creatures": [ {
  "name": "spriggle",
  "displayName": "Spriggle",
  "hostile": false,
  "health": 8,
  "speed": 1.6,                // blocks/sec walking
  "damage": 0,                 // hostile only
  "size": [0.6, 0.7],          // width, height in blocks
  "drops": [ { "item": "fiber_wisp", "count": [0,2] } ],
  "tiles": { "body": "spriggle_body", "head": "spriggle_head" },
  "spawn": { "night": false, "maxLight": 15, "minLight": 8, "weight": 10, "groupMax": 3 },
  "sounds": "chirp"           // idle sound family
} ] }
```

## Material tier reference (original progression)
0 wood/fiber → 1 flintstone → 2 copper alloy → 3 ironroot metal → 4 emberite → 5 starsteel

# Changelog

## 0.1.0 — first playable release (2026-08-31)

### World
- Deterministic seeded generation: 8 original biomes, caves, 5 ore types,
  3 tree families, rivers/oceans, gravity blocks, Waystone ruin structures
- 4 world types: Standard, Wide Islands, Mountain Realm, Flat Builder
- Day/night cycle (16 min), weather (clear/rain/fog/snow/storm), BFS voxel
  lighting with emissive blocks, water + Glow Sap fluids

### Gameplay
- Survival / Creative / Explorer modes; Calm / Adventurous / Fierce difficulties
- Mining with tool tiers & hold-to-break, placement with body protection,
  66 blocks, 103 items, 54 discovery-gated recipes, 4 crafting stations
- Health, hunger, oxygen, fall damage, eating & cooking, crop farming with
  tilled soil and growth stages
- 6 creatures with state-machine AI (wander/flee/warn/chase/attack), spawn
  rules by biome/light/time, drops, melee combat with knockback
- Storage crates with persistent inventories; death satchel drops
  (keep-inventory world option)

### Android
- Touch controls: joystick (double-push to sprint), look/tap/hold region,
  editable-opacity buttons, hotbar, left-handed mode; immersive fullscreen
  with cutout support
- Classic survival HUD: heart and food icon rows, crack stages on the block
  being mined plus a mobile progress ring
- World management: create (name/seed/mode/difficulty/type), rename,
  duplicate, delete with confirmation; automatic world backups
- Atomic compressed chunk saves, autosave, save-on-pause/quit
- Settings: audio sliders, per-camera sensitivity, FOV, render/simulation
  distance, performance presets, UI scale, accessibility toggles
- Original synthesized soundtrack, ambience and material-aware effects

### Tooling
- Procedural texture/icon/audio generators (`tools/`)
- 31-test unit/integration suite (determinism, save roundtrip, lighting,
  meshing, crafting, full chunk pipeline)
- Desktop AutoShot harness for automated visual testing

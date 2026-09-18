# Changelog

## Preview 3 (2026-09-18)

- Hair is DragonMineZ's own: all 27 mod hair presets decoded from the jar, rendered with the mod's strand geometry and hair texture; Super Saiyan variants per preset.
- Pierced Animations pack replaces the same-named Serious Player Animations clips; DMZ clips untouched.
- Character screen and menus restyled with DMZ panoramas, panels, buttons and HUD art; 3D preview always visible.
- Cinematic four-phase transformations, ki/beam/hit/explosion VFX pass; ambient life (leaves, fireflies, butterflies, birds, splashes).
- Android build is 64-bit only; boot breadcrumb log at user://boot.log for crash reports.

## Preview 2 (2026-09-17)

- Fixed world loading (a parse error in the transformation cinematic took the player scripts down with it).
- Nature's Spirit biomes and Terralith-style Earth terrain; tree-free spawn clearing and safe spawn.
- Three save slots with per-slot settings, coordinates toggle, dev mode cheat menu.
- Player animations from DragonMineZ + Serious Player Animations, planet gravity, controls polish.
- Night City Inventory GUI skin and palette across the menus.
- Wind field with gusts, whole-canopy leaf sway, foliage pushed away by the player, explosions and hits.


## 0.1.0 — first playable build (in progress)

### Engine
- Godot 4.4 project targeting Android (GL Compatibility renderer, immersive landscape, 60 fps budget)
- Voxel world: 16×128×16 columns, threaded generation/meshing, per-vertex AO, sky/block light flood
  fill, Minecraft-style water and lava flow with currents and buoyancy, per-column DEFLATE saves
- Bedrock model (`.geo.json`) and animation (`.animation.json`, Molang subset) runtime importer for
  every DragonMineZ character, master, enemy and dragon; DMZ HD textures used when present

### Content
- 232 blocks (Fused Vanilla textures + DragonMineZ/DMZ Plus blocks + generated planet blocks),
  DragonMineZ items, recipes, races, forms, skills, techniques, masters and wishes
- Planets: Earth, Namek, Otherworld, Sacred World of the Kai, Hyperbolic Time Chamber, Planet Vegeta,
  Yardrat, Vampa, Cereal, Hell Planet, Heaven, deep space
- 121 story quests across six sagas and 90 sidequests ported from DragonMineZ, quest enemy spawning,
  dragon balls, dragon summoning and wishes, space travel between planets

### Presentation
- Over-the-shoulder third-person camera, Cubic World touch HUD, Minecraft-style inventory/crafting,
  Monocraft font
- Ki charge, blasts, beams, discs, transformations with cinematic aura/lightning/shockwave sequences
- Sky, clouds, water, fog and post-processing inspired by Complementary Reimagined; per-planet skies
- DragonMineZ sound effects and music plus synthesized effects, ambience and battle loops

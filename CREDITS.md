# Credits & licenses

Dragon Block Sagas is a fan game. Dragon Ball, its characters and names are the property of
Akira Toriyama / Shueisha / Toei Animation / Bird Studio; this project is not affiliated with
them, with Mojang/Microsoft (Minecraft) or with the authors of Dragon Block C.

## Game code and generated content
All GDScript, shaders, Python tools, procedurally generated block tiles, item icons, sound
effects and the original music loops (`bgm_battle`, `bgm_boss`, `bgm_transformation`,
`bgm_space`, `bgm_namek`, `bgm_otherworld`, ambience loops) were created for this project.
The project is licensed under the **GNU GPL-3.0-or-later** (required by the DragonMineZ /
DMZ Plus data and assets it ports).

## Third-party content bundled in `game/assets`

| Source | Used for | License / terms |
|---|---|---|
| **DragonMineZ 2.1.3** by the DragonMineZ team (https://github.com/DragonMineZ/dragonminez) | Bedrock models and animations of every character, master, saga enemy and dragon; race skin layers; GUI art (HUD, menus, quest tree, radial, scouter); item/block textures; particle sprites; sound effects; the saga/quest/sidequest definitions, race/form/skill/technique/wish data and structure templates ported to `game/data` | GPL-3.0-or-later |
| **DMZ Plus 1.1.6** by Kiziro Akami (https://github.com/KiziroAkami/dmz-plus) | Planet, dimension, solar-system and space data; planet/sky textures; super and Cerealian dragon balls; space suit items | GPL-3.0-or-later; the Milky Way panorama is "The Milky Way panorama" by ESO/S. Brunier, CC BY 4.0 |
| **DMZ HD Texturepack 2.1** by ZoneMC (user-supplied) | HD entity, armor, particle and GUI textures (`assets/textures/**/hd/`, `inventory.png`, `widgets.png`, `icons.png`) | as distributed by its author |
| **Fused Vanilla Texture Pack / Models Pack 1.0–1.1** by Fused Bolt (user-supplied Bedrock packs) | Block, plant, crop, flower, leaf and item textures, colormaps, leaf particles | as distributed by its author |
| **AAA Particles: World 2.0.0** by ChloePrime | Lightning, explosion, smoke, sparkle and shockwave particle sprites; loot sounds | MIT |
| **Nature's Spirit 2.2.5** by Team Hibiscus (user-supplied) | Wood/leaf/plant textures for redwood, maple, wisteria, palm, cypress, aspen, fir, sugi, willow, joshua, lavender; biome designs (names, colours, tree shapes) re-implemented in GDScript | assets: All Rights Reserved (as distributed by its author); code MIT (none used) |
| **Serious Player Animations 1.2.0** by McVader (user-supplied) | Player animations (Bedrock format) used only for states DragonMineZ does not cover | MIT |
| **Monocraft** by Idrees Hassan (https://github.com/IdreesInc/Monocraft) | UI font | SIL Open Font License 1.1 |
| **Night City Inventory GUI** (1.21.3) by Myth6 | inventory screen skin, empty armour-slot icons (`textures/gui/nightcity/`) | user-supplied resource pack, no licence stated: used with the pack owner's permission, not redistributable |
| **Complementary Reimagined r5.9.2** by EminGT (user-supplied) | Studied as a *reference* for the sky, water, cloud and tonemapping look. No code or textures from the pack are included. | Complementary License 1.7 (redistribution of its code is not permitted) |

The DragonMineZ sound folder contains 39 tracks whose in-mod titles reference the
Dragon Ball / Dragon Ball Z original soundtracks (Shunsuke Kikuchi). They are redistributed here
exactly as shipped in the GPL-licensed mod because the project owner asked for the mod's music;
the underlying compositions remain the property of their rights holders and are not covered by
the GPL. Remove `game/assets/audio/bgm/menu_music-*.ogg` and the corresponding entries in
`game/data/audio.json` if you need a release that only contains original music.

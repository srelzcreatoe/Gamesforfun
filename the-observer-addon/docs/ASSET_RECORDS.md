# Asset Records

Provenance of every asset shipped in the packs. No third-party samples, textures, models or code are included.

**Not used:** a third-party add-on (*The One Who Watches*, credited to Mythicus and shanewolf38, redistributed by a
download site) was uploaded during development with a request to reuse its code. Nothing from it was copied or
adapted: its contents were only opened to read its credits, then deleted from the working area.

## Supplied assets (from the request ZIP `Hollow_Dweller_Pack.zip`)

Made by the user, who confirmed they own the model, texture and animations (2026-10-28). The ZIP contents are
preserved unmodified in `source_assets/supplied/` with `SHA256SUMS.txt`.

ZIP SHA-256: `c2bac9de2be22c0b2167bb13f76ab7f4449c78be2398ceba038db6d3b300a4c9`

| File | SHA-256 | Use |
|---|---|---|
| `Hollow_Dweller.bbmodel` | `3142e0f710170f04…` | editable source (not shipped) |
| `README.txt` | `7f2e48bfbe4cc7f1…` | reference |
| `dweller_animations.gif` | `a8feea7e7dbb299b…` | reference only |
| `dweller_preview.png` | `22e54d7408e56c05…` | pack icon crop; rotation-convention reference |
| `dweller_texture.png` | `dfe172002e070d8c…` | shipped as the entity texture (byte copy) |
| `dweller_turnaround.png` | `4384e39a9fb696e1…` | rotation-convention reference |
| `hollow_dweller.animation.json` | `b56fa4c40ad02571…` | shipped (clip names namespaced) |
| `hollow_dweller.geo.json` | `8118cdbe35797eae…` | shipped (identifier namespaced) |

## Particle sheets supplied by the user (chat, 2026-10-08)

Made by the user, who confirmed they own them (2026-10-28). Preserved unmodified in
`source_assets/supplied_particles/` with `SHA256SUMS.txt`.

| File | SHA-256 | Use |
|---|---|---|
| `vanish_sheet.png` (crimson shreds, 100×100) | `aa2d54a40c130716…` | the Observer tearing apart when it vanishes (`observer:vanish`) |
| `wisp_sheet.png` (grey wisps, 100×100) | `f9fa59f885989d11…` | the glowing aura around its body (`observer:wisp`) |

## The Weeping Mire (supplied by the user, 2026-10-30)

The user's own biome add-on, *Weeping Mire* 1.2.6 (the user confirmed it is theirs, 2026-10-30), merged into The
Observer in 1.0.7 as the Observer's home. The archive is preserved unmodified in `source_assets/supplied_weeping_mire/`
with `SHA256SUMS.txt`.

Archive SHA-256: `95af8ed1e68bb6f17e5262bd87d512fad87d50bc1b4f3af7f52c0c064ec7602d` (152 files)

`tools/merge_weeping_mire.py` copies 132 of its files into the packs, under their own `wmire:` namespace: 131 byte
for byte, and the biome definition with one rule tuned (1.0.8, so the Mire generates near the player: its
`replace_biomes` amount, noise frequency and target list; nothing else in it changes). `python3
tools/merge_weeping_mire.py --check` verifies every one against the archive (the biome as tuned):

| Pack | Folders (files) |
|---|---|
| behaviour | `biomes/` (1), `blocks/` (12), `features/` (14), `feature_rules/` (8), `worldgen/` (6), `structures/wmire/` (13), `loot_tables/wmire/` (2), `recipes/weeping_*` (11) |
| resource | `biomes/`, `fogs/`, `atmospherics/`, `color_grading/`, `lighting/`, `water/` (1 each), `particles/` (5), `models/blocks/torn_page` (1), `textures/blocks/wmire/` and `textures/particle/wmire_wind.png` (53) |

Merged into existing files: the Mire's entries in RP `blocks.json` and `textures/terrain_texture.json`, and its block
names in `texts/en_US.lang` (under *Weeping Mire (merged)*). Its script (`scripts/main.js`) is ported by hand into
`scripts/mire/mire.js`: wind, falling leaves and the eight torn pages, with the page texts unchanged. Not merged: its
watcher mob (entity, spawn rule, client entity, model, animation, render controller and textures), whose part the
Observer now plays, and its manifests, pack icons and pack names. Added for the Mire (1.1.0, original): items
`items/wmire_weeping_{log,wood,planks}.json` (the blocks as fuel, drawn as their blocks) and the recipe
`recipes/wmire_bone_meal_from_bone_root.json`. Its black-mist particle uses the vanilla particle
atlas (`textures/particle/particles`) by reference.

1.1.1 adds no asset files. The animals that sense it use vanilla sound events by name only (`mob.wolf.growl`,
`mob.wolf.whine`, `mob.cat.hiss`, `mob.cow.say`, `mob.sheep.say`, `mob.pig.say`, `mob.goat.ambient`,
`mob.horse.angry`, `mob.horse.donkey.angry`, `mob.llama.angry` — names checked against Mojang's vanilla
`sound_definitions.json`), and sleep paralysis played its existing breath sound (its whisper since 1.1.2).

1.1.2: the user's own Observer recordings (seven WAVs, 48 kHz stereo, supplied as `observer.zip`) are in the pack,
prepared by `tools/prepare_supplied_sounds.py` (the raw WAVs are not kept in the repository). They replace three of
the synthesized sounds (the arrival pressure, the shriek and the vanish) and add its sting when spotted, its whisper
and its two themes. Their rights rest with the user who supplied them.

1.5.0 adds original sounds and music synthesized by `tools/synth_music.py` (glitch1-3, static1-2, and four tracks in
`sounds/observer/music/`: stalk, chase, mire, end — melodies written in the script, no samples, no existing songs), an
original particle sheet drawn by `tools/make_textures.py` (`textures/particle/observer/glitch.png`) with two one-shot
particle definitions (`glitch_aura`, `glitch_burst`), and five original structures written by `tools/make_structures.py`
(`structures/wmire/drowned_chapel`, `watchers_spire`, `bone_altar`, `sunken_archive`, `surveyors_camp`) with their loot
tables and original journals.

1.5.1 adds the Mire Eyebloom, all original: five textures drawn by `tools/make_eyebloom.py` (the stalk, the petals,
the eyeball, the eye as an 8-frame flipbook, the shut lid), its flower's model, two one-shot particles made from the
existing mote texture (a falling red drop, rising red spores), its blocks, a 1×3×1 structure and its worldgen; and
the Sound Test, which plays the existing sounds and music (no new audio). The Weeping Mire's biome file changes again
(its `replace_biomes` rule only: amount 0.55, frequency 0.5, 33 targets; `tools/merge_weeping_mire.py --check` applies
the same tuning and finds 0 differences from the user's archive otherwise).

1.4.0 adds two original item icons drawn by `tools/make_textures.py` (`cold_eye.png`, `cold_charm.png`) and one original
sound synthesized by `tools/synth_sounds.py` (`charm_hum1.ogg`: two detuned partials a fifth apart, a faint shimmer, a
breath of noise), for the Cold Eye and the Charm of Cold Eyes. The test kit's stand-in for another add-on's scripted
creature (`otest:rival_dweller`, `scripts/rival.js`) is development-only and never shipped.

1.3.0 adds three original one-shot particle definitions, `particles/puppet_wisp.json`, `puppet_shred.json` and
`puppet_burst.json`, made from its existing wisp and vanish definitions and textures (one-shot, so nothing keeps emitting
from another creature). 1.2.1 adds one original particle definition, `particles/servant_eyes.json` (two glints of its existing `glint` texture
for the eyes it puts in the creatures that are its). 1.2.0 adds no asset files (its rule over other creatures reuses its own vanish particle and sounds).

## Its dwellers (supplied by the user with the 1.6.0 request)

The user's own three add-ons, sent to be merged into this one pack: *The Goatwalker* 3.1, *Shaftbreaker* and
*Brinesleeper*. The archives are preserved unmodified in `source_assets/supplied_dwellers/` with `SHA256SUMS.txt`:

| Archive | SHA-256 |
|---|---|
| `The_Goatwalker_v3.1.mcaddon` | `f89dbdace1c573f90d5aca45b250ca10cbb45309a4724cad28ed9623fc4b6b47` |
| `Shaftbreaker.mcaddon` | `e7cd1c8e13dd26ee6c7ee8876a96ba691364220b184ee13f454b4511d98f1325` |
| `Brinesleeper.mcaddon` | `0544a360beb8cbf3d7e17ae0e150e65696fd526bf2e460fc70ed3472026d300b` |

`tools/merge_dwellers.py` copies their files into the packs under their own namespaces (`goatwalker:`, `shaftbreaker:`,
`brine:`; their scripts under `scripts/dwellers/<name>/`): the 1,257 files it writes whole are listed in
`tools/merged_dweller_files.txt`, and with the nine shared files it merges into, `python3 tools/merge_dwellers.py
--check` verifies 1,267 files against what the tool writes from the archives. What it changes, and only where the merge needs it (every change made by the tool, listed in
it): their slash commands moved under the one namespace a pack may use (`observer:brine_*`, `observer:sb`,
`observer:sb_action`); their `getAllPlayers()` calls and their music calls routed through `link/shared.js` (who each
sees; one music channel); their own wheels no longer handed out unasked; the Goatwalker's `void_fence` booleans in
`bone_visibility` made Molang strings (this game version rejects booleans there); shutdown/command/open hooks appended
to the Goatwalker's `main.js`; the Stellar Taiga's `replace_biomes` targets narrowed so it never shares a vanilla
biome with the Weeping Mire; and a `// @ts-nocheck` line on their scripts. Merged into existing files: their entries
in RP `blocks.json`, `sounds.json`, `sound_definitions.json`, `music_definitions.json`, the texture lists of
`terrain_texture.json` and `item_texture.json`, `flipbook_textures.json`, and their lines in both packs'
`texts/en_US.lang` (each in a marked block). Not merged: their manifests, pack icons and pack names.

## The Rift (1.6.0): all original

Every file of the Rift is made by this project's own tools, from nothing but code: its blocks and their textures and
models (`tools/rift_assets.py`), its twelve pieces drawn block by block and its loot tables and books
(`tools/rift_world.py`; the pieces use vanilla blocks, the Goatwalker's and the Mire's blocks, and the Rift's own), and
the rift itself, its particles and its mist (`tools/rift_portal.py`). The two images sent with the request (a purple
rift full of stars; a misty wood of dead pines in the rain) were looked at as references for mood only; nothing of
them is in the packs. Vanilla sounds used by name only: `ambient.weather.rain`, `ambient.weather.thunder`,
`ambient.weather.lightning.impact`, `portal.portal`, `portal.trigger`, `beacon.deactivate`, `mob.endermen.portal`.

| File | Provenance | SHA-256 (16) |
|---|---|---|
| `TheObserver_BP/blocks/rift/blood.json` | original — tools/rift_assets.py (1.6.0): a Rift block | `ec0202b09527c26f` |
| `TheObserver_BP/blocks/rift/corpse.json` | original — tools/rift_assets.py (1.6.0): a Rift block | `af2ada63ab7a0966` |
| `TheObserver_BP/blocks/rift/gravestone.json` | original — tools/rift_assets.py (1.6.0): a Rift block | `ef755c3ec8e2fb7f` |
| `TheObserver_BP/blocks/rift/hanged.json` | original — tools/rift_assets.py (1.6.0): a Rift block | `80ab249d71e6d46c` |
| `TheObserver_BP/blocks/rift/rift_bark.json` | original — tools/rift_assets.py (1.6.0): a Rift block | `992075ff909d6d27` |
| `TheObserver_BP/blocks/rift/rift_bricks.json` | original — tools/rift_assets.py (1.6.0): a Rift block | `2e0d96f3fcc2138d` |
| `TheObserver_BP/blocks/rift/rift_bricks_cracked.json` | original — tools/rift_assets.py (1.6.0): a Rift block | `252ed442ddc2d68e` |
| `TheObserver_BP/blocks/rift/rift_glass.json` | original — tools/rift_assets.py (1.6.0): a Rift block | `f60d43801ed482c0` |
| `TheObserver_BP/blocks/rift/rift_lamp.json` | original — tools/rift_assets.py (1.6.0): a Rift block | `85edfff1f5a1a072` |
| `TheObserver_BP/blocks/rift/rift_moss.json` | original — tools/rift_assets.py (1.6.0): a Rift block | `da5b6d9463a9b3a1` |
| `TheObserver_BP/blocks/rift/rift_needles.json` | original — tools/rift_assets.py (1.6.0): a Rift block | `36b97dca297e87ba` |
| `TheObserver_BP/blocks/rift/skeleton.json` | original — tools/rift_assets.py (1.6.0): a Rift block | `7f2490fcc4927fb1` |
| `TheObserver_RP/textures/blocks/rift/blood_0.png` | original — drawn by tools/rift_assets.py (1.6.0) | `ba3eb7e591a81487` |
| `TheObserver_RP/textures/blocks/rift/blood_1.png` | original — drawn by tools/rift_assets.py (1.6.0) | `c5deb92ca5ba8ad0` |
| `TheObserver_RP/textures/blocks/rift/blood_2.png` | original — drawn by tools/rift_assets.py (1.6.0) | `3b8890ba0fe7fc0a` |
| `TheObserver_RP/textures/blocks/rift/blood_3.png` | original — drawn by tools/rift_assets.py (1.6.0) | `9fe7863013c2d683` |
| `TheObserver_RP/textures/blocks/rift/corpse_cloth.png` | original — drawn by tools/rift_assets.py (1.6.0) | `d7e885b672b62f30` |
| `TheObserver_RP/textures/blocks/rift/corpse_skin.png` | original — drawn by tools/rift_assets.py (1.6.0) | `08d18fa3d8a1ce5f` |
| `TheObserver_RP/textures/blocks/rift/gravestone.png` | original — drawn by tools/rift_assets.py (1.6.0) | `ff5749cb5ed3e82f` |
| `TheObserver_RP/textures/blocks/rift/rift_bark.png` | original — drawn by tools/rift_assets.py (1.6.0) | `371855df695cf920` |
| `TheObserver_RP/textures/blocks/rift/rift_bark_top.png` | original — drawn by tools/rift_assets.py (1.6.0) | `7d25d77d702d975b` |
| `TheObserver_RP/textures/blocks/rift/rift_bricks.png` | original — drawn by tools/rift_assets.py (1.6.0) | `16f69c7f68faa3b9` |
| `TheObserver_RP/textures/blocks/rift/rift_bricks_cracked.png` | original — drawn by tools/rift_assets.py (1.6.0) | `14adf4ff8652b41d` |
| `TheObserver_RP/textures/blocks/rift/rift_glass.png` | original — drawn by tools/rift_assets.py (1.6.0) | `1a6904798915440e` |
| `TheObserver_RP/textures/blocks/rift/rift_lamp.png` | original — drawn by tools/rift_assets.py (1.6.0) | `82fe3fe04be3468a` |
| `TheObserver_RP/textures/blocks/rift/rift_moss_side.png` | original — drawn by tools/rift_assets.py (1.6.0) | `93d45d334197c8d2` |
| `TheObserver_RP/textures/blocks/rift/rift_moss_top.png` | original — drawn by tools/rift_assets.py (1.6.0) | `e3707a5c775c54f6` |
| `TheObserver_RP/textures/blocks/rift/rift_needles.png` | original — drawn by tools/rift_assets.py (1.6.0) | `566d26ee071fe120` |
| `TheObserver_RP/textures/blocks/rift/rift_soil.png` | original — drawn by tools/rift_assets.py (1.6.0) | `682f649c675c923e` |
| `TheObserver_RP/textures/blocks/rift/skeleton_bone.png` | original — drawn by tools/rift_assets.py (1.6.0) | `b11e1d186afe5ee6` |
| `TheObserver_RP/textures/blocks/rift/skull_face.png` | original — drawn by tools/rift_assets.py (1.6.0) | `77bb5ce8a5e12983` |
| `TheObserver_RP/models/blocks/rift_corpse.geo.json` | original — tools/rift_assets.py (1.6.0): a block model | `b9aeb3720073e8b9` |
| `TheObserver_RP/models/blocks/rift_decal.geo.json` | original — tools/rift_assets.py (1.6.0): a block model | `308e3e1706a73ad6` |
| `TheObserver_RP/models/blocks/rift_gravestone.geo.json` | original — tools/rift_assets.py (1.6.0): a block model | `8e161bab477ddbed` |
| `TheObserver_RP/models/blocks/rift_hanged_lower.geo.json` | original — tools/rift_assets.py (1.6.0): a block model | `9448f4c000c58f1f` |
| `TheObserver_RP/models/blocks/rift_hanged_upper.geo.json` | original — tools/rift_assets.py (1.6.0): a block model | `48b60600f0930ba9` |
| `TheObserver_RP/models/blocks/rift_skeleton.geo.json` | original — tools/rift_assets.py (1.6.0): a block model | `8bdfb4750bcc7093` |
| `TheObserver_BP/structures/rift/castle.mcstructure` | original — drawn block by block by tools/rift_world.py (1.6.0) | `30fa324b52db0294` |
| `TheObserver_BP/structures/rift/church.mcstructure` | original — drawn block by block by tools/rift_world.py (1.6.0) | `8956cc6ffa5cf4ce` |
| `TheObserver_BP/structures/rift/corner_1.mcstructure` | original — drawn block by block by tools/rift_world.py (1.6.0) | `a81da3c9ee0421c2` |
| `TheObserver_BP/structures/rift/corner_2.mcstructure` | original — drawn block by block by tools/rift_world.py (1.6.0) | `9cd7f8afd3b2ed67` |
| `TheObserver_BP/structures/rift/edge_1.mcstructure` | original — drawn block by block by tools/rift_world.py (1.6.0) | `6b49a265392688a3` |
| `TheObserver_BP/structures/rift/edge_2.mcstructure` | original — drawn block by block by tools/rift_world.py (1.6.0) | `07651034104a3d02` |
| `TheObserver_BP/structures/rift/edge_3.mcstructure` | original — drawn block by block by tools/rift_world.py (1.6.0) | `bf821f4295b76271` |
| `TheObserver_BP/structures/rift/landing.mcstructure` | original — drawn block by block by tools/rift_world.py (1.6.0) | `b63b5400dd6cc291` |
| `TheObserver_BP/structures/rift/woods_1.mcstructure` | original — drawn block by block by tools/rift_world.py (1.6.0) | `22d40324bc64bd6d` |
| `TheObserver_BP/structures/rift/woods_2.mcstructure` | original — drawn block by block by tools/rift_world.py (1.6.0) | `c5c3bcd1feaf1ae1` |
| `TheObserver_BP/structures/rift/woods_3.mcstructure` | original — drawn block by block by tools/rift_world.py (1.6.0) | `a8636dc579ac1a1e` |
| `TheObserver_BP/structures/rift/woods_4.mcstructure` | original — drawn block by block by tools/rift_world.py (1.6.0) | `c8954fe487482130` |
| `TheObserver_BP/loot_tables/rift/bones.json` | original — tools/rift_world.py / rift_assets.py (1.6.0) | `280bde4112caae57` |
| `TheObserver_BP/loot_tables/rift/castle_armoury.json` | original — tools/rift_world.py / rift_assets.py (1.6.0) | `bbe266c46b668a22` |
| `TheObserver_BP/loot_tables/rift/castle_lord.json` | original — tools/rift_world.py / rift_assets.py (1.6.0) | `1bc87385fc16962d` |
| `TheObserver_BP/loot_tables/rift/castle_treasury.json` | original — tools/rift_world.py / rift_assets.py (1.6.0) | `6e25d41ef7010b16` |
| `TheObserver_BP/loot_tables/rift/church_altar.json` | original — tools/rift_world.py / rift_assets.py (1.6.0) | `5fdb087207a2aaa2` |
| `TheObserver_BP/loot_tables/rift/crypt.json` | original — tools/rift_world.py / rift_assets.py (1.6.0) | `ad4c7a06ed565a92` |
| `TheObserver_BP/loot_tables/rift/dungeon.json` | original — tools/rift_world.py / rift_assets.py (1.6.0) | `2c9c74f313ff5659` |
| `TheObserver_BP/loot_tables/rift/mausoleum.json` | original — tools/rift_world.py / rift_assets.py (1.6.0) | `2fda6f54f540044a` |
| `TheObserver_BP/loot_tables/rift/nothing.json` | original — tools/rift_world.py / rift_assets.py (1.6.0) | `d19c6266c7122cab` |
| `TheObserver_BP/loot_tables/rift/traveller.json` | original — tools/rift_world.py / rift_assets.py (1.6.0) | `a5e0b13382b601ba` |
| `TheObserver_BP/entities/rift_portal.json` | original — tools/rift_portal.py (1.6.0): the rift | `49883af1fe3164b4` |
| `TheObserver_RP/entity/rift_portal.entity.json` | original — tools/rift_portal.py (1.6.0) | `5c879f90407f31cf` |
| `TheObserver_RP/models/entity/rift_portal.geo.json` | original — tools/rift_portal.py (1.6.0) | `a75b7946eb03876e` |
| `TheObserver_RP/render_controllers/rift_portal.render_controllers.json` | original — tools/rift_portal.py (1.6.0) | `40c31efb813a6ddc` |
| `TheObserver_RP/animations/rift_portal.animation.json` | original — tools/rift_portal.py (1.6.0) | `f7f01c802a34370a` |
| `TheObserver_RP/animation_controllers/rift_portal.animation_controllers.json` | original — tools/rift_portal.py (1.6.0) | `c29d2fa63f775cef` |
| `TheObserver_RP/textures/entity/rift_portal/eye.png` | original — drawn by tools/rift_portal.py (1.6.0) | `b669354ee00c2c9a` |
| `TheObserver_RP/textures/entity/rift_portal/halo.png` | original — drawn by tools/rift_portal.py (1.6.0) | `ba1e5892dafd5667` |
| `TheObserver_RP/textures/entity/rift_portal/void_0.png` | original — drawn by tools/rift_portal.py (1.6.0) | `f5d84ff06a6f8aa7` |
| `TheObserver_RP/textures/entity/rift_portal/void_1.png` | original — drawn by tools/rift_portal.py (1.6.0) | `ed40f2b249b21b57` |
| `TheObserver_RP/textures/entity/rift_portal/void_2.png` | original — drawn by tools/rift_portal.py (1.6.0) | `b68b754ce4101af0` |
| `TheObserver_RP/textures/entity/rift_portal/void_3.png` | original — drawn by tools/rift_portal.py (1.6.0) | `d12a4a34f0aee39d` |
| `TheObserver_RP/textures/entity/rift_portal/void_4.png` | original — drawn by tools/rift_portal.py (1.6.0) | `6b6c139b876423e1` |
| `TheObserver_RP/textures/entity/rift_portal/void_5.png` | original — drawn by tools/rift_portal.py (1.6.0) | `b20dd70e5ae1df4a` |
| `TheObserver_RP/textures/entity/rift_portal/void_6.png` | original — drawn by tools/rift_portal.py (1.6.0) | `50060f0b7e4c80ef` |
| `TheObserver_RP/textures/entity/rift_portal/void_7.png` | original — drawn by tools/rift_portal.py (1.6.0) | `56aa92dbd41980de` |
| `TheObserver_RP/particles/rift_burst.json` | original — tools/rift_portal.py (1.6.0) | `ac4989d0ee0b7645` |
| `TheObserver_RP/particles/rift_embers.json` | original — tools/rift_portal.py (1.6.0) | `9d6c4db67eaa7d1d` |
| `TheObserver_RP/particles/rift_motes.json` | original — tools/rift_portal.py (1.6.0) | `e2ec0ece67908f8e` |
| `TheObserver_RP/particles/rift_rain.json` | original — tools/rift_portal.py (1.6.0) | `8ea4f43f7d8641ef` |
| `TheObserver_RP/particles/rift_sparks.json` | original — tools/rift_portal.py (1.6.0) | `b12412262cd3763e` |
| `TheObserver_RP/textures/particle/observer/rift_rain.png` | original — drawn by tools/rift_portal.py (1.6.0) | `92b3367c95e168b1` |
| `TheObserver_RP/textures/particle/observer/rift_spark.png` | original — drawn by tools/rift_portal.py (1.6.0) | `d8a3ec1202c41d65` |
| `TheObserver_RP/fogs/rift.json` | original — tools/rift_portal.py (1.6.0): the Rift's mist | `54c5fcfd13501fe3` |

## 1.7.0: all original

Everything new in 1.7.0 is made by this project's own tools from code alone: the Rift's seven new pieces and two more
kinds of woods, and their loot (`tools/rift_world.py`); the Hollows' great chambers, from the Shaftbreaker's own blocks
(`tools/hollows_world.py`); the eyeblooms' 48 turned geometries (`tools/eyebloom_aim.py`, from its 1.5.1 model); the
Rift's textures, redrawn (`tools/rift_assets.py`); the Observer's four tracks made over, and the Shaftbreaker's music
and the Brinesleeper's soundtrack and voice, made new (`tools/synth_dark.py`: written note by note, rendered from
oscillators and noise — the "in the style of" the old horror fan-games the user asked for; nothing sampled,
transcribed or imitated note for note). The concept images sent with the request (the Shaftbreaker's infested caves, an
asset sheet) were looked at as references for mood only; nothing of them is in the packs. The Brinesleeper's and the
Shaftbreaker's replaced files are no longer shipped (`SKIP_FILES` in `tools/merge_dwellers.py`). Removed in 1.7.0:
`TheObserver_BP/features/eyebloom_feature.json` and `TheObserver_BP/feature_rules/weeping_mire_eyeblooms.json` (the
Mire grows no new eyeblooms).

| File | Provenance | SHA-256 (16) |
|---|---|---|
| `TheObserver_BP/structures/rift/observatory.mcstructure` | original — written block by block by tools/rift_world.py (1.7.0): an observatory: a round tower, a broken dome, a telescope, a star chart, rocks hanging in the air | `ce9a95556ba41f74` |
| `TheObserver_BP/structures/rift/eye_garden.mcstructure` | original — written block by block by tools/rift_world.py (1.7.0): the Garden of Eyes: a sunken garden of eyeblooms round a great eye | `b3ea7ed5f703d235` |
| `TheObserver_BP/structures/rift/graveyard.mcstructure` | original — written block by block by tools/rift_world.py (1.7.0): a barrow field: rows of graves, a chapel of bones over a vault | `3500ac84a490d2ad` |
| `TheObserver_BP/structures/rift/hamlet_1.mcstructure` | original — written block by block by tools/rift_world.py (1.7.0): an abandoned hamlet: cottages round a well and a gallows | `229591a7d00725b5` |
| `TheObserver_BP/structures/rift/hamlet_2.mcstructure` | original — written block by block by tools/rift_world.py (1.7.0): a second hamlet, laid out differently | `bc3bf996a8364d0d` |
| `TheObserver_BP/structures/rift/watchtower.mcstructure` | original — written block by block by tools/rift_world.py (1.7.0): a watchtower: four floors, a soul fire and a bell on its top, a palisade | `84ffef582d0769e5` |
| `TheObserver_BP/structures/rift/camp.mcstructure` | original — written block by block by tools/rift_world.py (1.7.0): an expedition's camp: tents round a fire gone blue, its stores, the dead | `91e30f4e02a11e87` |
| `TheObserver_BP/structures/rift/woods_5.mcstructure` | original — written block by block by tools/rift_world.py (1.7.0): the dead woods (a fifth kind), with rocks hanging over them | `00587451556645b2` |
| `TheObserver_BP/structures/rift/woods_6.mcstructure` | original — written block by block by tools/rift_world.py (1.7.0): the dead woods (a sixth kind) | `1612031b1dcd4327` |
| `TheObserver_BP/loot_tables/rift/observatory.json` | original — tools/rift_world.py (1.7.0) | `993ee47010697212` |
| `TheObserver_BP/loot_tables/rift/garden.json` | original — tools/rift_world.py (1.7.0) | `5cec412f28ae54ef` |
| `TheObserver_BP/loot_tables/rift/barrow.json` | original — tools/rift_world.py (1.7.0) | `0f27b184dfc3e38b` |
| `TheObserver_BP/loot_tables/rift/hamlet.json` | original — tools/rift_world.py (1.7.0) | `46daa3325d3fe482` |
| `TheObserver_BP/loot_tables/rift/watchtower.json` | original — tools/rift_world.py (1.7.0) | `a5481d2b2a1bf0f1` |
| `TheObserver_BP/loot_tables/rift/camp.json` | original — tools/rift_world.py (1.7.0) | `9898155d0aa66a4f` |
| `TheObserver_BP/structures/hollows/flesh_cavern_0.mcstructure` | original — written block by block by tools/hollows_world.py (1.7.0, from the Shaftbreaker's own blocks): a cavern of veinstone and pulsing flesh under arching ribs | `aebb03ded8a5576b` |
| `TheObserver_BP/features/hollows/hl_flesh_cavern_0.json` | original — tools/hollows_world.py (1.7.0): carves the chamber into rock only | `af23857033c4fb3e` |
| `TheObserver_BP/structures/hollows/flesh_cavern_1.mcstructure` | original — written block by block by tools/hollows_world.py (1.7.0, from the Shaftbreaker's own blocks): a second flesh cavern | `5e0d8ba370cf1a20` |
| `TheObserver_BP/features/hollows/hl_flesh_cavern_1.json` | original — tools/hollows_world.py (1.7.0): carves the chamber into rock only | `4a6c038d4f4abcf1` |
| `TheObserver_BP/structures/hollows/rib_hall_0.mcstructure` | original — written block by block by tools/hollows_world.py (1.7.0, from the Shaftbreaker's own blocks): a nave of ribstone ribs | `3cae851183d88ccc` |
| `TheObserver_BP/features/hollows/hl_rib_hall_0.json` | original — tools/hollows_world.py (1.7.0): carves the chamber into rock only | `ae25763be5320235` |
| `TheObserver_BP/structures/hollows/rib_hall_1.mcstructure` | original — written block by block by tools/hollows_world.py (1.7.0, from the Shaftbreaker's own blocks): a second rib hall | `0a16cf1becef7e58` |
| `TheObserver_BP/features/hollows/hl_rib_hall_1.json` | original — tools/hollows_world.py (1.7.0): carves the chamber into rock only | `a76ac1800950c7bc` |
| `TheObserver_BP/structures/hollows/heart_chamber.mcstructure` | original — written block by block by tools/hollows_world.py (1.7.0, from the Shaftbreaker's own blocks): a great organ in a cavity of flesh | `9818802bb1056998` |
| `TheObserver_BP/features/hollows/hl_heart_chamber.json` | original — tools/hollows_world.py (1.7.0): carves the chamber into rock only | `6ec365eb1868957f` |
| `TheObserver_BP/structures/hollows/mine_collapse.mcstructure` | original — written block by block by tools/hollows_world.py (1.7.0, from the Shaftbreaker's own blocks): a collapsed mine: rails, timber frames, the dead | `5b4b4207cf07c506` |
| `TheObserver_BP/features/hollows/hl_mine_collapse.json` | original — tools/hollows_world.py (1.7.0): carves the chamber into rock only | `7e721c7d8f11c5e9` |
| `TheObserver_BP/features/hollows/hl_great_chamber.json` | original — tools/hollows_world.py (1.7.0): one of the six chambers | `2266acb075a7a943` |
| `TheObserver_BP/feature_rules/hollows/hl_great_chamber_rule.json` | original — tools/hollows_world.py (1.7.0): one Hollows chunk in 14, y −48…8 | `24e567170049530b` |
| `TheObserver_RP/sounds/music/shaft_dark/presence.ogg` | original — synthesized by tools/synth_dark.py (1.7.0; replaces the Shaftbreaker's own track): something below: a drone, picks striking far down the shafts, beams creaking, a lullaby backwards | `c7638131733b99b9` |
| `TheObserver_RP/sounds/music/shaft_dark/hollows.ogg` | original — synthesized by tools/synth_dark.py (1.7.0; replaces the Shaftbreaker's own track): the Hollows: a wet pulse, the walls breathing, voices that never resolve, bells out of tune | `e9bda88fdaa359fd` |
| `TheObserver_RP/sounds/music/shaft_dark/close.ogg` | original — synthesized by tools/synth_dark.py (1.7.0; replaces the Shaftbreaker's own track): it is close: a quickening heartbeat, strings crawling upward, a tritone bass pulse, clicking | `58ac2125ebdefac6` |
| `TheObserver_RP/sounds/music/shaft_dark/standoff.ogg` | original — synthesized by tools/synth_dark.py (1.7.0; replaces the Shaftbreaker's own track): the standoff: a thin high tone, the dark ticking, a slow sub pulse, one bell | `a5e0e9e1e2712cca` |
| `TheObserver_RP/sounds/music/shaft_dark/chase.ogg` | original — synthesized by tools/synth_dark.py (1.7.0; replaces the Shaftbreaker's own track): the chase: 170 bpm, metal on rock for drums, a distorted bass sliding down a tritone, a screech every four bars | `236f08725746ec71` |
| `TheObserver_RP/sounds/music/brine_dark/stillwater_1.ogg` | original — synthesized by tools/synth_dark.py (1.7.0; replaces the Brinesleeper's own track) | `70eb13c13186ed5a` |
| `TheObserver_RP/sounds/music/brine_dark/stillwater_2.ogg` | original — synthesized by tools/synth_dark.py (1.7.0; replaces the Brinesleeper's own track) | `c06b0c11962ac0f9` |
| `TheObserver_RP/sounds/music/brine_dark/stillwater_3.ogg` | original — synthesized by tools/synth_dark.py (1.7.0; replaces the Brinesleeper's own track) | `f699ed3c7d202a29` |
| `TheObserver_RP/sounds/music/brine_dark/near_1.ogg` | original — synthesized by tools/synth_dark.py (1.7.0; replaces the Brinesleeper's own track) | `72cba5cd5ae6daee` |
| `TheObserver_RP/sounds/music/brine_dark/near_2.ogg` | original — synthesized by tools/synth_dark.py (1.7.0; replaces the Brinesleeper's own track) | `ca05988d160623c0` |
| `TheObserver_RP/sounds/music/brine_dark/chase.ogg` | original — synthesized by tools/synth_dark.py (1.7.0; replaces the Brinesleeper's own track) | `3030f379697b4a2a` |
| `TheObserver_RP/sounds/music/brine_dark/sting_1.ogg` | original — synthesized by tools/synth_dark.py (1.7.0; replaces the Brinesleeper's own track) | `961794c2d47b9c18` |
| `TheObserver_RP/sounds/music/brine_dark/sting_2.ogg` | original — synthesized by tools/synth_dark.py (1.7.0; replaces the Brinesleeper's own track) | `64cd97a8134c301c` |
| `TheObserver_RP/sounds/music/brine_dark/sting_3.ogg` | original — synthesized by tools/synth_dark.py (1.7.0; replaces the Brinesleeper's own track) | `7793f4c73abf1d8d` |
| `TheObserver_RP/sounds/mob/brinesleeper_dark/breathe.ogg` | original — synthesized by tools/synth_dark.py (1.7.0; replaces the Brinesleeper's own sound) | `a31f6ddbf3671659` |
| `TheObserver_RP/sounds/mob/brinesleeper_dark/call.ogg` | original — synthesized by tools/synth_dark.py (1.7.0; replaces the Brinesleeper's own sound) | `4f2a5a124702d2c9` |
| `TheObserver_RP/sounds/mob/brinesleeper_dark/click1.ogg` | original — synthesized by tools/synth_dark.py (1.7.0; replaces the Brinesleeper's own sound) | `a0c6500b71fff93f` |
| `TheObserver_RP/sounds/mob/brinesleeper_dark/click2.ogg` | original — synthesized by tools/synth_dark.py (1.7.0; replaces the Brinesleeper's own sound) | `36918d89b07efe05` |
| `TheObserver_RP/sounds/mob/brinesleeper_dark/death.ogg` | original — synthesized by tools/synth_dark.py (1.7.0; replaces the Brinesleeper's own sound) | `d64242be0cecb863` |
| `TheObserver_RP/sounds/mob/brinesleeper_dark/emerge.ogg` | original — synthesized by tools/synth_dark.py (1.7.0; replaces the Brinesleeper's own sound) | `8b31085668e2cb0f` |
| `TheObserver_RP/sounds/mob/brinesleeper_dark/grasp.ogg` | original — synthesized by tools/synth_dark.py (1.7.0; replaces the Brinesleeper's own sound) | `3035e764d8c9ea9c` |
| `TheObserver_RP/sounds/mob/brinesleeper_dark/hiss.ogg` | original — synthesized by tools/synth_dark.py (1.7.0; replaces the Brinesleeper's own sound) | `11e65ee822ea7850` |
| `TheObserver_RP/sounds/mob/brinesleeper_dark/hurt.ogg` | original — synthesized by tools/synth_dark.py (1.7.0; replaces the Brinesleeper's own sound) | `bada3b7d34daf2db` |
| `TheObserver_RP/sounds/mob/brinesleeper_dark/jumpscare.ogg` | original — synthesized by tools/synth_dark.py (1.7.0; replaces the Brinesleeper's own sound) | `989bd581efa9b85d` |
| `TheObserver_RP/sounds/mob/brinesleeper_dark/lunge.ogg` | original — synthesized by tools/synth_dark.py (1.7.0; replaces the Brinesleeper's own sound) | `80b8123ceb8253d3` |
| `TheObserver_RP/sounds/mob/brinesleeper_dark/moan.ogg` | original — synthesized by tools/synth_dark.py (1.7.0; replaces the Brinesleeper's own sound) | `c9119d88b87979e1` |
| `TheObserver_RP/sounds/mob/brinesleeper_dark/roar.ogg` | original — synthesized by tools/synth_dark.py (1.7.0; replaces the Brinesleeper's own sound) | `8434c10e437c5f5c` |
| `TheObserver_RP/sounds/mob/brinesleeper_dark/spotted.ogg` | original — synthesized by tools/synth_dark.py (1.7.0; replaces the Brinesleeper's own sound) | `8900c04114920e38` |
| `TheObserver_RP/sounds/mob/brinesleeper_dark/step1.ogg` | original — synthesized by tools/synth_dark.py (1.7.0; replaces the Brinesleeper's own sound) | `041b78a683971bc3` |
| `TheObserver_RP/sounds/mob/brinesleeper_dark/step2.ogg` | original — synthesized by tools/synth_dark.py (1.7.0; replaces the Brinesleeper's own sound) | `8d78b2a7b47a2762` |
| `TheObserver_RP/sounds/mob/brinesleeper_dark/submerge.ogg` | original — synthesized by tools/synth_dark.py (1.7.0; replaces the Brinesleeper's own sound) | `1369477d92f1e70a` |

## Shipped resource files

| File | Provenance | SHA-256 (first 16) |
|---|---|---|
| `TheObserver_RP/sounds/observer/presence.ogg` | made by the user (supplied 2026-11-01 in observer.zip); trimmed, faded, loudness-normalised and encoded by tools/prepare_supplied_sounds.py — from "observer grunt or teleporting" (mono, −17 LUFS): it arrives | `22b926016a997045` |
| `TheObserver_RP/sounds/observer/shriek.ogg` | made by the user (supplied 2026-11-01 in observer.zip); trimmed, faded, loudness-normalised and encoded by tools/prepare_supplied_sounds.py — from "observer scream" (mono, −12 LUFS): it snaps, lunges, rages, or kills | `df84e200421b1a1f` |
| `TheObserver_RP/sounds/observer/spotted.ogg` | made by the user (supplied 2026-11-01 in observer.zip); trimmed, faded, loudness-normalised and encoded by tools/prepare_supplied_sounds.py — from "observer spotted" (stereo, −17 LUFS; a click at 6.0 s cut): the sting when you spot it | `f6611984d6e02840` |
| `TheObserver_RP/sounds/observer/vanish.ogg` | made by the user (supplied 2026-11-01 in observer.zip); trimmed, faded, loudness-normalised and encoded by tools/prepare_supplied_sounds.py — from "observer vanishes" (mono, −19 LUFS): it is gone | `c75f781fb7589d56` |
| `TheObserver_RP/sounds/observer/whisper.ogg` | made by the user (supplied 2026-11-01 in observer.zip); trimmed, faded, loudness-normalised and encoded by tools/prepare_supplied_sounds.py — from "observer nearby or whisper" (mono, −19 LUFS): close and unseen; sleep paralysis | `328729b82b271edd` |
| `TheObserver_RP/sounds/observer/theme_around.ogg` | made by the user (supplied 2026-11-01 in observer.zip); trimmed, faded, loudness-normalised and encoded by tools/prepare_supplied_sounds.py — from "dweller thr observer is around" (stereo, −21 LUFS, trailing silence trimmed): its music while it is around | `cdd54e30193ac0d8` |
| `TheObserver_RP/sounds/observer/theme_lurking.ogg` | made by the user (supplied 2026-11-01 in observer.zip); trimmed, faded, loudness-normalised and encoded by tools/prepare_supplied_sounds.py — from "observer lurking" (stereo, −23 LUFS, made a seamless loop with a 3 s crossfade): its music in the Weeping Mire | `b8aed4977559d94d` |
| `TheObserver_RP/sounds/observer/arrival.ogg` | original — synthesized by tools/synth_sounds.py | `65d1a04c09e62914` |
| `TheObserver_RP/sounds/observer/breath1.ogg` | original — synthesized by tools/synth_sounds.py | `f22da6308d1f31e5` |
| `TheObserver_RP/sounds/observer/breath2.ogg` | original — synthesized by tools/synth_sounds.py | `7161ec51f8e7539d` |
| `TheObserver_RP/sounds/observer/chalk1.ogg` | original — synthesized by tools/synth_sounds.py | `76305aee83f9374b` |
| `TheObserver_RP/sounds/observer/chalk2.ogg` | original — synthesized by tools/synth_sounds.py | `ad6e6a414d77574c` |
| `TheObserver_RP/sounds/observer/crack1.ogg` | original — synthesized by tools/synth_sounds.py (1.0.6: the drift's cracks) | `63be4156f6161874` |
| `TheObserver_RP/sounds/observer/crack2.ogg` | original — synthesized by tools/synth_sounds.py (1.0.6: the drift's cracks) | `7978dc8306d26ee9` |
| `TheObserver_RP/sounds/observer/crack3.ogg` | original — synthesized by tools/synth_sounds.py (1.0.6: the drift's cracks) | `56e15fb600140766` |
| `TheObserver_RP/sounds/observer/discovery.ogg` | original — synthesized by tools/synth_sounds.py | `933ac64eeabc93a5` |
| `TheObserver_RP/sounds/observer/drift1.ogg` | original — synthesized by tools/synth_sounds.py | `649ca24a9e76baf2` |
| `TheObserver_RP/sounds/observer/drift2.ogg` | original — synthesized by tools/synth_sounds.py | `1fd054360304bb03` |
| `TheObserver_RP/sounds/observer/effigy_break.ogg` | original — synthesized by tools/synth_sounds.py | `41dc26df692f77fd` |
| `TheObserver_RP/sounds/observer/fabric1.ogg` | original — synthesized by tools/synth_sounds.py | `f3f3f201a0184bc3` |
| `TheObserver_RP/sounds/observer/fabric2.ogg` | original — synthesized by tools/synth_sounds.py | `d486525c7fcd4ac9` |
| `TheObserver_RP/sounds/observer/fabric3.ogg` | original — synthesized by tools/synth_sounds.py | `e69972ae68a613a6` |
| `TheObserver_RP/sounds/observer/heartbeat1.ogg` | original — synthesized by tools/synth_sounds.py (1.1.0: the player's own heartbeat) | `e80c61cf35caa43b` |
| `TheObserver_RP/sounds/observer/heartbeat2.ogg` | original — synthesized by tools/synth_sounds.py (1.1.0: the player's own heartbeat) | `520b19dd99b108e7` |
| `TheObserver_RP/sounds/observer/hum.ogg` | original — synthesized by tools/synth_sounds.py | `2bdd47e2bd5a2358` |
| `TheObserver_RP/sounds/observer/knock.ogg` | original — synthesized by tools/synth_sounds.py | `0de61b0c5460ac2a` |
| `TheObserver_RP/sounds/observer/lens.ogg` | original — synthesized by tools/synth_sounds.py | `2074db49d4bd8e16` |
| `TheObserver_RP/sounds/observer/notice1.ogg` | original — synthesized by tools/synth_sounds.py | `0f3f23cb4c7c7816` |
| `TheObserver_RP/sounds/observer/notice2.ogg` | original — synthesized by tools/synth_sounds.py | `c1b327df423e8298` |
| `TheObserver_RP/sounds/observer/ring.ogg` | original — synthesized by tools/synth_sounds.py | `ff2eeaac0253cdaa` |
| `TheObserver_RP/sounds/observer/scrawl1.ogg` | original — synthesized by tools/synth_sounds.py | `8bdb8613f7b7d5a8` |
| `TheObserver_RP/sounds/observer/scrawl2.ogg` | original — synthesized by tools/synth_sounds.py | `72cef7508d25c4de` |
| `TheObserver_RP/sounds/observer/seal.ogg` | original — synthesized by tools/synth_sounds.py | `ccb32fcda6aecd81` |
| `TheObserver_RP/sounds/observer/silence.ogg` | original — synthesized by tools/synth_sounds.py (a near-silent looping music track) | `592cf63dbcb8d32c` |
| `TheObserver_RP/sounds/observer/sink.ogg` | original — synthesized by tools/synth_sounds.py | `6c6e7fea42343da7` |
| `TheObserver_RP/sounds/observer/charm_hum1.ogg` | original — synthesized by tools/synth_sounds.py (1.4.0: the charm of cold eyes) | `412693d3da3e2d2b` |
| `TheObserver_RP/sounds/observer/snuff.ogg` | original — synthesized by tools/synth_sounds.py | `e83b2133ae9b3786` |
| `TheObserver_RP/sounds/observer/step1.ogg` | original — synthesized by tools/synth_sounds.py | `63a56e276d623455` |
| `TheObserver_RP/sounds/observer/step2.ogg` | original — synthesized by tools/synth_sounds.py | `d2890f748438f346` |
| `TheObserver_RP/sounds/observer/step3.ogg` | original — synthesized by tools/synth_sounds.py | `882dc077f0e8465a` |
| `TheObserver_RP/sounds/observer/step4.ogg` | original — synthesized by tools/synth_sounds.py | `912e833ffa8f6784` |
| `TheObserver_RP/sounds/observer/sting.ogg` | original — synthesized by tools/synth_sounds.py | `e2eb0dc8a1403e8a` |
| `TheObserver_RP/sounds/observer/strike.ogg` | original — synthesized by tools/synth_sounds.py (1.1.2: saturated a little, ~5 dB louder, to sit in the mix) | `b62bfa0228f8f1a7` |
| `TheObserver_RP/sounds/observer/tell.ogg` | original — synthesized by tools/synth_sounds.py | `79aaa953fd4eaef8` |
| `TheObserver_RP/sounds/observer/turn.ogg` | original — synthesized by tools/synth_sounds.py | `4b37c2faffef1d53` |
| `TheObserver_RP/sounds/observer/vigil.ogg` | original — synthesized by tools/synth_sounds.py | `e758ff7a2004fa2a` |
| `TheObserver_RP/sounds/observer/voice1.ogg` | original — synthesized by tools/synth_sounds.py | `774634ca8641f449` |
| `TheObserver_RP/sounds/observer/voice2.ogg` | original — synthesized by tools/synth_sounds.py | `c8408c3b3bc99d04` |
| `TheObserver_RP/sounds/observer/voice3.ogg` | original — synthesized by tools/synth_sounds.py | `5dec2769f6949575` |
| `TheObserver_RP/sounds/observer/whiff.ogg` | original — synthesized by tools/synth_sounds.py | `c608d5345eec2f8d` |
| `TheObserver_RP/sounds/observer/windup.ogg` | original — synthesized by tools/synth_sounds.py | `1ea1f5f28e9bbb40` |
| `TheObserver_RP/textures/blocks/observer/effigy.png` | original — drawn by tools/make_textures.py | `22c4f4e9499ef0ad` |
| `TheObserver_RP/textures/blocks/observer/veil.png` | original — drawn by tools/make_textures.py | `088dbf6781e9b937` |
| `TheObserver_RP/textures/blocks/observer/ward_lantern.png` | original — drawn by tools/make_textures.py | `80ed13cb45faa368` |
| `TheObserver_RP/textures/entity/observer/the_observer.png` | supplied — byte copy of source_assets/supplied/dweller_texture.png | `dfe172002e070d8c` |
| `TheObserver_RP/textures/entity/observer/the_observer_eyes.png` | derived — only the two eye cubes' pixels of the supplied texture (tools/integrate_supplied_assets.py) | `f0d4128927c35473` |
| `TheObserver_RP/textures/entity/observer/the_observer_shadow.png` | derived — near-black silhouette of the user's texture with the white eyes kept (tools/integrate_supplied_assets.py), for the taiga shadows | `b7aa1c618cd306c9` |
| `TheObserver_RP/textures/items/observer/chalk.png` | original — drawn by tools/make_textures.py | `61c5f11bc4336204` |
| `TheObserver_RP/textures/items/observer/cold_charm.png` | original — drawn by tools/make_textures.py (1.4.0) | `3d232aef08402a79` |
| `TheObserver_RP/textures/items/observer/cold_eye.png` | original — drawn by tools/make_textures.py (1.4.0) | `6920f73195005e2e` |
| `TheObserver_RP/textures/items/observer/config_wheel.png` | original — drawn by tools/make_textures.py | `f37c7dd0b7558917` |
| `TheObserver_RP/textures/items/observer/field_notes.png` | original — drawn by tools/make_textures.py | `870cc046d4176aee` |
| `TheObserver_RP/textures/items/observer/flare.png` | original — drawn by tools/make_textures.py (also the thrown flare's sprite) | `9e35e36dc571b6c8` |
| `TheObserver_RP/textures/items/observer/observers_eye.png` | original — drawn by tools/make_textures.py | `dddd6404d452a15d` |
| `TheObserver_RP/textures/items/observer/vestige.png` | original — drawn by tools/make_textures.py | `0b3414b3e07abde5` |
| `TheObserver_RP/textures/items/observer/ward_lantern.png` | original — drawn by tools/make_textures.py | `3d78ffae2fbff70c` |
| `TheObserver_RP/textures/items/observer/witness_lens.png` | original — drawn by tools/make_textures.py | `52719ac82d0e649a` |
| `TheObserver_RP/textures/particle/observer/chalk_mark.png` | original — drawn by tools/make_textures.py | `e67428d1924495a1` |
| `TheObserver_RP/textures/particle/observer/chalk_smudged.png` | original — drawn by tools/make_textures.py | `ea919836b2f3ff3d` |
| `TheObserver_RP/textures/particle/observer/dust.png` | original — drawn by tools/make_textures.py | `c6cd545069a60399` |
| `TheObserver_RP/textures/particle/observer/footprint.png` | original — drawn by tools/make_textures.py | `fb68566f0813306a` |
| `TheObserver_RP/textures/particle/observer/glint.png` | original — drawn by tools/make_textures.py | `f01a2640559c0981` |
| `TheObserver_RP/textures/particle/observer/mote.png` | original — drawn by tools/make_textures.py | `1fbddbcb046d205c` |
| `TheObserver_RP/textures/particle/observer/smoke.png` | original — drawn by tools/make_textures.py | `53ef19d15ff9afb4` |
| `TheObserver_RP/textures/particle/observer/vanish.png` | made by the user (supplied 2026-10-08) — shapes from source_assets/supplied_particles/vanish_sheet.png copied pixel-for-pixel into a grid (tools/integrate_particle_sheets.py) | `3fe39a53c0fc8df8` |
| `TheObserver_RP/textures/particle/observer/wisp.png` | made by the user (supplied 2026-10-08) — shapes from source_assets/supplied_particles/wisp_sheet.png copied pixel-for-pixel into a grid (tools/integrate_particle_sheets.py) | `d6f06c5e60c01904` |
| `TheObserver_BP/pack_icon.png` | derived — crop of supplied dweller_preview.png on a generated background (tools/make_textures.py) | `2529bdac03c514e1` |
| `TheObserver_RP/animations/the_observer.animation.json` | supplied — hollow_dweller.animation.json, clip names renamed only | `3d684b6f10a5acc8` |
| `TheObserver_RP/animations/the_observer_supplemental.animation.json` | original — tools/make_supplemental_anims.py (uses supplied bone names; 1.0.6 adds float_drift — calm, broken by one-frame twitches — float_surge, climb; 1.0.8 float_hang; 1.0.9 hang, crawl; 1.1.0 a new peek round a trunk) | `95e220083183e66e` |
| `TheObserver_RP/models/blocks/effigy.geo.json` | original — tools/make_textures.py | `e85d1aee3108b4c0` |
| `TheObserver_RP/models/blocks/ward_lantern.geo.json` | original — tools/make_textures.py | `fa03764ae1ebdcb9` |
| `TheObserver_RP/models/entity/the_observer.geo.json` | supplied — hollow_dweller.geo.json, identifier renamed and two eye locators added (tools/integrate_supplied_assets.py asserts cubes/UVs unchanged) | `48b77f6164817a47` |
| `TheObserver_RP/pack_icon.png` | derived — crop of supplied dweller_preview.png on a generated background (tools/make_textures.py) | `2529bdac03c514e1` |
| `TheObserver_RP/sounds/observer/glitch1.ogg` | original — synthesized by tools/synth_music.py (1.5.0): a crushed, gated square tone jumping in pitch, with a stutter: what it holds glitches | `1c99f71bdb958501` |
| `TheObserver_RP/sounds/observer/glitch2.ogg` | original — synthesized by tools/synth_music.py (1.5.0): a second glitch variant (longer) | `766010fb5a9fda23` |
| `TheObserver_RP/sounds/observer/glitch3.ogg` | original — synthesized by tools/synth_music.py (1.5.0): a third glitch variant (shorter) | `fa9e56ad4adad447` |
| `TheObserver_RP/sounds/observer/static1.ogg` | original — synthesized by tools/synth_music.py (1.5.0): static with a mains hum: the corruption, a scrambled name | `226810c58cc0e5b8` |
| `TheObserver_RP/sounds/observer/static2.ogg` | original — synthesized by tools/synth_music.py (1.5.0): a shorter burst of static | `51296887237e8cf5` |
| `TheObserver_RP/sounds/observer/music/stalk.ogg` | original — synthesized by tools/synth_dark.py (1.7.0, made over darker; written note by note, no samples): its presence: a beating drone, a swelling cluster, a bell melody played backwards, a far choir, its heartbeat | `55ad7d4eaaf36ea9` |
| `TheObserver_RP/sounds/observer/music/chase.ogg` | original — synthesized by tools/synth_dark.py (1.7.0, made over darker; written note by note, no samples): the chase: 150 bpm, pounding drums, a distorted tritone bass, organ stabs, strings shrieking upward | `3a04f7b34fc015a6` |
| `TheObserver_RP/sounds/observer/music/mire.ogg` | original — synthesized by tools/synth_dark.py (1.7.0, made over darker; written note by note, no samples): its home: low voices, slow wrong bells, water dripping in the dark, as if heard underwater | `3909350fd2ae9787` |
| `TheObserver_RP/sounds/observer/music/end.ogg` | original — synthesized by tools/synth_dark.py (1.7.0, made over darker; written note by note, no samples): the fifth stage: an organ dirge and choir falling a semitone at a time, a music-box tune going wrong, sinking into the drone | `edd0a7837c36c79d` |
| `TheObserver_RP/textures/particle/observer/glitch.png` | original — drawn by tools/make_textures.py (1.5.0): glitch fragments for the aura round what it holds and the bursts | `69368823bc97f3ac` |
| `TheObserver_RP/particles/glitch_aura.json` | original — written for 1.5.0 (one-shot; its own glitch texture) | `b57602aad7a6529a` |
| `TheObserver_RP/particles/glitch_burst.json` | original — written for 1.5.0 (one-shot; its own glitch texture) | `4f50fb8c5746f37d` |
| `TheObserver_BP/structures/wmire/drowned_chapel.mcstructure` | original — written block by block by tools/make_structures.py (1.5.0): a drowned chapel, with a chest and a lectern; the lectern holds an original journal | `727dcfee212e2994` |
| `TheObserver_BP/structures/wmire/watchers_spire.mcstructure` | original — written block by block by tools/make_structures.py (1.5.0): a tall watchers' spire, with a chest, two barrels and a lectern; the lectern holds an original journal | `0193e574a8b0fa57` |
| `TheObserver_BP/structures/wmire/bone_altar.mcstructure` | original — written block by block by tools/make_structures.py (1.5.0): a bone altar, with a chest and a lectern; the lectern holds an original journal | `35b2953d30f9ce7b` |
| `TheObserver_BP/structures/wmire/sunken_archive.mcstructure` | original — written block by block by tools/make_structures.py (1.5.0): an archive sunk into the ground, with two chests and a lectern; the lectern holds an original journal | `304fdc1957127d03` |
| `TheObserver_BP/structures/wmire/surveyors_camp.mcstructure` | original — written block by block by tools/make_structures.py (1.5.0): an abandoned surveyors' camp, with a chest, two barrels and a lectern; the lectern holds an original journal | `833d39a1f5c815b2` |
| `TheObserver_BP/loot_tables/wmire/altar_chest.json` | original — tools/make_structures.py (1.5.0) | `79e3aede77416949` |
| `TheObserver_BP/loot_tables/wmire/archive_chest.json` | original — tools/make_structures.py (1.5.0) | `97baa19ad8b2b76b` |
| `TheObserver_BP/loot_tables/wmire/camp_barrel.json` | original — tools/make_structures.py (1.5.0) | `9342b17d7619ef61` |
| `TheObserver_BP/loot_tables/wmire/camp_chest.json` | original — tools/make_structures.py (1.5.0) | `2adbae19cea6ce22` |
| `TheObserver_BP/loot_tables/wmire/chapel_chest.json` | original — tools/make_structures.py (1.5.0) | `367a00615c2dbeee` |
| `TheObserver_BP/loot_tables/wmire/spire_chest.json` | original — tools/make_structures.py (1.5.0) | `340c0330c24fc97d` |
| `TheObserver_BP/worldgen/structures/bone_altar.json` | original — tools/make_structures.py (1.5.0) | `c0ebcb9ce1ca8bdc` |
| `TheObserver_BP/worldgen/template_pools/bone_altar.json` | original — tools/make_structures.py (1.5.0) | `3bab5d481f30f415` |
| `TheObserver_BP/worldgen/structures/drowned_chapel.json` | original — tools/make_structures.py (1.5.0) | `1f2d178374012a37` |
| `TheObserver_BP/worldgen/template_pools/drowned_chapel.json` | original — tools/make_structures.py (1.5.0) | `899ab8dfc1f985d3` |
| `TheObserver_BP/worldgen/structures/sunken_archive.json` | original — tools/make_structures.py (1.5.0) | `63a36e2b7e97ca74` |
| `TheObserver_BP/worldgen/template_pools/sunken_archive.json` | original — tools/make_structures.py (1.5.0) | `07e6f32df3a2e1c8` |
| `TheObserver_BP/worldgen/structures/surveyors_camp.json` | original — tools/make_structures.py (1.5.0) | `6500bc916f6a242d` |
| `TheObserver_BP/worldgen/template_pools/surveyors_camp.json` | original — tools/make_structures.py (1.5.0) | `211fdaf0f67b68b0` |
| `TheObserver_BP/worldgen/structures/watchers_spire.json` | original — tools/make_structures.py (1.5.0) | `f90b50e0e1eae9a9` |
| `TheObserver_BP/worldgen/template_pools/watchers_spire.json` | original — tools/make_structures.py (1.5.0) | `bf1563073be67d3a` |
| `TheObserver_BP/worldgen/structure_sets/mire_ruins.json` | original — tools/make_structures.py (1.5.0): the ruins scattered through the Weeping Mire | `1d29df8da9ecba4e` |
| `TheObserver_RP/textures/blocks/wmire/eyebloom_stalk.png` | original — drawn by tools/make_eyebloom.py (1.5.1): the stalk: a black-green stem with drooping, red-veined leaves (a cross plant) | `a5e10ea0c7271b48` |
| `TheObserver_RP/textures/blocks/wmire/eyebloom_petals.png` | original — drawn by tools/make_eyebloom.py (1.5.1): a halo of dark petals with crimson tips, behind its eye | `4818f723eb6a64d2` |
| `TheObserver_RP/textures/blocks/wmire/eyebloom_white.png` | original — drawn by tools/make_eyebloom.py (1.5.1): the eyeball: off-white, shaded, red veins | `25ee64e77396a2c9` |
| `TheObserver_RP/textures/blocks/wmire/eyebloom_eye.png` | original — drawn by tools/make_eyebloom.py (1.5.1): its eye, a flipbook strip of 8 frames (16×128): ahead, left, right, up, half shut, shut, down, the pupil wide | `56659331bb82687b` |
| `TheObserver_RP/textures/blocks/wmire/eyebloom_shut.png` | original — drawn by tools/make_eyebloom.py (1.5.1): the lid, shut tight, weeping | `f02ef8af557e9faa` |
| `TheObserver_RP/models/blocks/eyebloom.geo.json` | original — written for 1.5.1: the Eyebloom's flower (a stem, a halo of petals, an eyeball) | `bd3fe5c3f848571f` |
| `TheObserver_RP/textures/flipbook_textures.json` | original — 1.5.1: the eye's flipbook (its frames and timing) | `0aa7fc32818e0e7f` |
| `TheObserver_RP/particles/eye_drip.json` | original — written for 1.5.1 (one-shot; its existing mote texture, tinted): a red drop falling from the eye | `d30fa55c74874ff4` |
| `TheObserver_RP/particles/eye_spore.json` | original — written for 1.5.1 (one-shot; its existing mote texture, tinted): red spores drifting up | `0b74fdd4eded489a` |
| `TheObserver_BP/blocks/eyebloom.json` | original — 1.5.1: the Eyebloom's flower | `923437115b25c01b` |
| `TheObserver_BP/blocks/eyebloom_stalk.json` | original — 1.5.1: the Eyebloom's stalk | `3a5816ebcd58281e` |
| `TheObserver_BP/structures/wmire/eyebloom.mcstructure` | original — written by tools/make_eyebloom.py (1.5.1): stalk, stalk, flower | `6a569aa8988f19a0` |
| `TheObserver_BP/loot_tables/wmire/eyebloom.json` | original — 1.5.1: the eye may leave a spider eye | `db124c85f935250d` |
| `TheObserver_BP/loot_tables/wmire/eyebloom_stalk.json` | original — 1.5.1: nothing | `d19c6266c7122cab` |

## Vanilla references

Matched footsteps and "borrowed" work sounds call vanilla Bedrock sound events by name (`step.*`, `dig.*`, `use.*`,
`random.door_open/close`, `random.chestopen/closed`, `random.eat`, `random.bow`, `random.wood_click`, `game.player.hurt`);
the Flare uses `random.bow`, `firework.blast`, `random.fuse` and `random.fizz`; the taiga shadows `ambient.cave`.
The thrown flare's client entity uses the vanilla `geometry.item_sprite`, `controller.render.item_sprite`,
`animation.actor.billboard` and `snowball` material by reference, exactly as the vanilla snowball does.
No vanilla audio files are copied into the packs. Block identifiers used by the scripts were checked against
`@minecraft/vanilla-data` 1.26.52 (190 identifiers, see `tools/validate.mjs`).

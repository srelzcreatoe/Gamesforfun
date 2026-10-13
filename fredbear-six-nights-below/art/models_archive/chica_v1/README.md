# Chica v1 (archived)

The skin-built Chica used up to version 1.4 of the map, built from `art/skins/` by `tools/gen_rp.py`.
It is **not in the game** any more: version 1.5 builds Chica on the owner's Classic Freddy body (`tools/chica_classic.py`),
imported by `tools/owner_models.py`. Its animations are the shared `animation.fb.*` clips
(`art/models_archive/fb_animatronic.animation.json` and `fb_animatronic.animation_controllers.json`).

To put it back, copy the geometry to `packs/FredbearRP/models/entity/`, the textures to `packs/FredbearRP/textures/entity/fb/`,
`fb_chica.entity.json` to `packs/FredbearRP/entity/`, and restore `minecraft:scale` in `packs/FredbearBP/entities/chica.json`
and `SCALE` / `EYE_HEIGHT` in `scripts/mc/game.js` (1.35 / 1.3 and 1.55).

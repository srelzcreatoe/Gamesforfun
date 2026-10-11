# Freddy v1 (archived)

The skin-built Freddy used up to version 1.2 of the map, built from `art/skins/` by `tools/gen_rp.py`.
It is **not in the game** any more: version 1.3 uses the map owner's model (`art/models_incoming/Freddy_V6_Blink_Coverage.zip`,
imported by `tools/owner_models.py`). Its animations are the shared `animation.fb.*` clips that Chica still uses
(`packs/FredbearRP/animations/fb_animatronic.animation.json`).

To put it back, copy the geometry to `packs/FredbearRP/models/entity/`, the textures to `packs/FredbearRP/textures/entity/fb/`,
`fb_freddy.entity.json` to `packs/FredbearRP/entity/`, and restore `minecraft:scale` in `packs/FredbearBP/entities/freddy.json`
and `SCALE` / `EYE_HEIGHT` in `scripts/mc/game.js` (1.35 / 1.3 and 1.55).

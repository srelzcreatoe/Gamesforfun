# Bonnie v1 (archived)

The skin-built Bonnie used up to version 1.2 of the map, built from `art/skins/` by `tools/gen_rp.py`.
It is **not in the game** any more: version 1.3 uses the map owner's model (`art/models_incoming/Bonnie_V2_Proportions_Fixed_Eyes.zip`,
imported by `tools/owner_models.py`). Its animations are the shared `animation.fb.*` clips that Chica still uses
(`packs/FredbearRP/animations/fb_animatronic.animation.json`).

To put it back, copy the geometry to `packs/FredbearRP/models/entity/`, the textures to `packs/FredbearRP/textures/entity/fb/`,
`fb_bonnie.entity.json` to `packs/FredbearRP/entity/`, and restore `minecraft:scale` in `packs/FredbearBP/entities/bonnie.json`
and `SCALE` / `EYE_HEIGHT` in `scripts/mc/game.js` (1.35 / 1.3 and 1.55).

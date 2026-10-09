# Fredbear v1 (archived)

The skin-built Fredbear model used up to version 1.1 of the map, built from `art/skins/fredbear_source.png` by
`tools/gen_rp.py`. It is **not in the game** any more: version 1.2 uses the map owner's Fredbear V6 model
(`art/models_incoming/Fredbear_V6_NoEyeDots_Complete.zip`, imported by `tools/fredbear_v6.py`).

To put this model back, copy `fb_fredbear.geo.json` to `packs/FredbearRP/models/entity/`, the textures to
`packs/FredbearRP/textures/entity/fb/`, `fb_fredbear.entity.json` to `packs/FredbearRP/entity/` and add
`animation.fb.perform.fredbear` from `fb_fredbear_v1.animation.json` to the shared animation file; then set
`minecraft:scale` back to 1.45 in `packs/FredbearBP/entities/fredbear*.json` and `SCALE.fredbear` in
`scripts/mc/game.js`.

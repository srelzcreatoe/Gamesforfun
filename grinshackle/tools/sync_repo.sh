#!/bin/bash
# Copy the finished build into the repository's grinshackle/ directory (run package.sh first).
set -e
S=/tmp/claude-0/-home-user-Gamesforfun/f0d9b1e4-8cf6-5788-bfed-3c567a50b1ea/scratchpad
R=/home/user/Gamesforfun/grinshackle
rm -rf "$R/source" "$R/assets" "$R/docs" "$R/tools" "$R/tests" "$R/preview" "$R/dist"
mkdir -p "$R/source" "$R/assets" "$R/docs" "$R/tools" "$R/tests" "$R/preview" "$R/dist"
cp -r "$S/build/Grinshackle_BP" "$S/build/Grinshackle_RP" "$R/source/"
cp "$S/upload/Chainreaver_v1/assets/grinshackle_chainreaver.bbmodel" "$R/assets/grinshackle_chainreaver_supplied.bbmodel"
cp "$S/upload/Chainreaver_v1/assets/grinshackle_chainreaver.animation.json" "$R/assets/grinshackle_chainreaver_supplied.animation.json"
cp "$S/build_assets/grinshackle_chainreaver_v2.bbmodel" "$R/assets/"
cp "$S/build_anim/grinshackle_chainreaver.animation.json" "$R/assets/grinshackle_chainreaver_v2.animation.json"
cp "$S/build_anim/fixlog.json" "$R/assets/"
cp "$S/upload/Chainreaver_v1/assets/grinshackle_chainreaver.geo.json" "$S/upload/Chainreaver_v1/assets/grinshackle_chainreaver.png" "$R/assets/"
cp "$S"/docs/*.md "$S/docs/validator_output.txt" "$R/docs/"; cp "$S/design/ARCHITECTURE.md" "$R/docs/"; cp "$S/docs/README.md" "$R/README.md"
cp "$S"/tools/anim_tools.py "$S"/tools/apply_anim_fixes.py "$S"/tools/update_bbmodel.py "$S"/tools/render_preview.py "$S"/tools/validate_pack.py "$S"/tools/package.sh "$S"/tools/sync_repo.sh "$R/tools/"
for f in gen_foley.py gen_music.py gen_particles.py gen_textures.py; do [ -f "$S/assets_work/$f" ] && cp "$S/assets_work/$f" "$R/tools/"; done
cp -r "$S"/build/tests/* "$R/tests/"; cp "$S/docs/scenario_output.txt" "$R/tests/"
sed -i "s#'../Grinshackle_BP/scripts/#'../source/Grinshackle_BP/scripts/#g" "$R/tests/scenarios.mjs"
sed -i "s#../Grinshackle_BP/scripts/#../source/Grinshackle_BP/scripts/#g" "$R/tests/README.md"
cp "$S/preview/grinshackle_animation_preview.gif" "$S"/preview/*_sheet.png "$R/preview/"
cp "$S"/dist/*.mcaddon "$R/dist/"
# the editable zip the user asked for (packs + assets + docs + preview + tools + tests)
cd "$R/.." && rm -f "$S/dist/Grinshackle_Chainbound_Dweller_v2.0.0_editable.zip" && zip -q -r -X "$S/dist/Grinshackle_Chainbound_Dweller_v2.0.0_editable.zip" grinshackle -x '*/dist/*' -x '*/__pycache__/*'
cp "$S/dist/Grinshackle_Chainbound_Dweller_v2.0.0_editable.zip" "$R/dist/"
du -sh "$R"; ls -la "$R/dist"

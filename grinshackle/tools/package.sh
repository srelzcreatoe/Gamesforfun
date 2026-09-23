#!/bin/bash
# Build the installable .mcaddon (a zip holding both packs) and the editable source zip.
set -e
S=/tmp/claude-0/-home-user-Gamesforfun/f0d9b1e4-8cf6-5788-bfed-3c567a50b1ea/scratchpad
OUT=$S/dist; rm -rf "$OUT"; mkdir -p "$OUT"
cd "$S/build"
rm -f "$OUT/Grinshackle_Chainbound_Dweller_v2.0.0.mcaddon"
zip -q -r -X "$OUT/Grinshackle_Chainbound_Dweller_v2.0.0.mcaddon" Grinshackle_BP Grinshackle_RP -x '*.DS_Store' -x '*/__pycache__/*'
unzip -l "$OUT/Grinshackle_Chainbound_Dweller_v2.0.0.mcaddon" | tail -1
echo "mcaddon: $(du -h "$OUT/Grinshackle_Chainbound_Dweller_v2.0.0.mcaddon" | cut -f1)"

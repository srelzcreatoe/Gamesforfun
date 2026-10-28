#!/bin/sh
# Regenerates the prop preview contact sheets (tools/blocks/props/preview_*.png) from the packs.
# Run from anywhere after `python3 tools/blocks/props/build_props.py` and `node tools/merge_fragments.mjs`.
set -e
cd "$(dirname "$0")/../../.."
P=tools/blocks/props
OFFICE="door_button light_button vent_cover crt_monitor desk_fan desk_phone desk_clutter plush_rat security_camera show_tape"
PARTY="party_table party_chair party_hat pizza_box plate_set balloons bunting arcade_cabinet stage_star stage_speaker guitar_amp"
SERVICE="pa_speaker time_clock wet_floor_sign mop_bucket trash_can parts_shelf toilet sink locker"
node $P/preview.mjs --out $P/preview_office.png --cols 5 --tile 300x300 --skip pillar --title "Rustgrin's props: office" $OFFICE
node $P/preview.mjs --out $P/preview_party.png --cols 5 --tile 300x300 --skip pillar --title "Rustgrin's props: dining + stage" $PARTY
node $P/preview.mjs --out $P/preview_service.png --cols 5 --tile 300x300 --skip pillar --title "Rustgrin's props: back of house" $SERVICE
node $P/preview.mjs --out $P/preview_facing.png --cols 4 --tile 340x340 --title "Facing check: each prop on all four sides of a pillar (state = side it faces)" \
  'door_button:pillar*' 'security_camera:pillar*' 'pa_speaker:pillar*' 'time_clock:pillar*' 'sink:pillar*' 'stage_star:pillar*'
node $P/preview.mjs --night --out $P/preview_night.png --cols 4 --tile 320x320 --title "Emissive states in the dark" \
  'door_button:on' 'light_button:on' 'crt_monitor:on' 'desk_phone:ringing' 'show_tape:level 4' 'arcade_cabinet:both halves' 'stage_star:north' 'security_camera:north'
python3 $P/sheets.py $P/preview_textures.png $(python3 -c "import json;print(' '.join(k[5:] for k in sorted(json.load(open('tools/fragments/terrain_props.json')))))")

#!/usr/bin/env bash
# Render the game under Xvfb (llvmpipe, OpenGL3) and save a screenshot.
# Usage: tools/screenshot.sh out.png [--scene res://scenes/x.tscn] [--seconds N] [--args "a b c"] [--sandbox name] [--size WxH]
source "$(dirname "$0")/env.sh"
out="${1:?output png}"; shift
scene=""; seconds=6; args=""; name="shots"; size="1280x720"
while [ $# -gt 0 ]; do
  case "$1" in
    --scene) scene="$2"; shift 2;;
    --seconds) seconds="$2"; shift 2;;
    --args) args="$2"; shift 2;;
    --sandbox) name="$2"; shift 2;;
    --size) size="$2"; shift 2;;
    *) echo "unknown arg $1"; exit 2;;
  esac
done
proj="$("$REPO/tools/sandbox.sh" "$name")"
out_abs="$(cd "$(dirname "$out")" && pwd)/$(basename "$out")"
w="${size%x*}"; h="${size#*x}"
set +e
timeout 300 xvfb-run -a -s "-screen 0 ${w}x${h}x24" "$GODOT" --path "$proj" --rendering-driver opengl3 --resolution "$size" $scene -- --screenshot="$out_abs" --after="$seconds" $args 2>&1 | grep -vE "ALSA|libpulse|audio_driver|dummy driver|snd_"
echo "exit=${PIPESTATUS[0]} -> $out_abs"

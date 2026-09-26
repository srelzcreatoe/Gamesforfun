#!/usr/bin/env bash
# Run all headless GDScript tests (tests/test_*.gd) in a sandbox copy.
# Usage: tools/run_tests.sh [sandbox-name] [filter]
source "$(dirname "$0")/env.sh"
name="${1:-tests}"
filter="${2:-}"
proj="$("$REPO/tools/sandbox.sh" "$name")"
set +e
timeout 900 "$GODOT" --headless --path "$proj" res://tests/TestRunner.tscn -- "$filter" 2>&1 | grep -vE "ALSA|libpulse|audio_driver|dummy driver|snd_"
code=${PIPESTATUS[0]}
exit $code

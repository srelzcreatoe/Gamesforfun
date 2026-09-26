#!/usr/bin/env bash
# Run the Godot 4.4.1 editor binary with the toolchain environment.
# Usage: tools/godot.sh [godot args...]   e.g. tools/godot.sh --headless --path game --quit-after 2
source "$(dirname "$0")/env.sh"
exec "$GODOT" "$@"

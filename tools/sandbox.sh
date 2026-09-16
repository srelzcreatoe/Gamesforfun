#!/usr/bin/env bash
# Create/refresh a private copy of game/ so several agents can run Godot concurrently
# without fighting over game/.godot import caches. The import cache is copied too (it is
# content-addressed), so a sandbox does not need to re-import 3000 assets.
# Usage: tools/sandbox.sh <name>   -> prints the sandbox project path
source "$(dirname "$0")/env.sh"
name="${1:?sandbox name}"
dst="$SANDBOX/$name/game"
mkdir -p "$dst"
if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete --exclude 'build/' --exclude '.godot/editor/' --exclude '.godot/shader_cache/' "$GAME/" "$dst/" 2>/dev/null
else
  python3 "$REPO/tools/sync_dir.py" "$GAME" "$dst" --exclude build .godot/editor .godot/shader_cache 2>/dev/null
fi
echo "$dst"

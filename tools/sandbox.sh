#!/usr/bin/env bash
# Create/refresh a private copy of game/ so several agents can run Godot concurrently
# without fighting over game/.godot import caches. The import cache is copied too (it is
# content-addressed), so a sandbox does not need to re-import 3000 assets. If any script is
# newer than the global class cache, the editor is run headless once to refresh class_name
# resolution (otherwise fresh sandboxes cannot resolve other engineers' classes).
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
cache="$dst/.godot/global_script_class_cache.cfg"
newest="$(find "$dst/scripts" "$dst/scenes" "$dst/autoload" "$dst/tests" -name '*.gd' -newer "$cache" 2>/dev/null | head -1)"
if [ ! -f "$cache" ] || [ -n "$newest" ]; then
  timeout 180 "$GODOT" --headless --path "$dst" --editor --quit >/dev/null 2>&1
fi
echo "$dst"

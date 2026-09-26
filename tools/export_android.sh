#!/usr/bin/env bash
# Export the signed debug APK. Usage: tools/export_android.sh [out.apk]
source "$(dirname "$0")/env.sh"
out="${1:-$GAME/build/DragonBlockSagas.apk}"
mkdir -p "$(dirname "$out")"
# Make sure editor settings point at the SDK/JDK (headless export reads them).
ed="$HOME/.config/godot"; mkdir -p "$ed"
if ! grep -q android_sdk_path "$ed/editor_settings-4.4.tres" 2>/dev/null; then
cat > "$ed/editor_settings-4.4.tres" <<EOT
[gd_resource type="EditorSettings" format=3]

[resource]
export/android/android_sdk_path = "$ANDROID_HOME"
export/android/java_sdk_path = "$JAVA_HOME"
EOT
fi
# First import everything (icons, textures) so the export sees a warm cache.
"$GODOT" --headless --path "$GAME" --import 2>&1 | grep -vE "ALSA|libpulse|audio_driver|dummy driver|snd_" | tail -3
"$GODOT" --headless --path "$GAME" --export-debug Android "$out" 2>&1 | grep -vE "ALSA|libpulse|audio_driver|dummy driver|snd_" | grep -iE "error|warn|export: (begin|end)|Signed" 
ls -la "$out"

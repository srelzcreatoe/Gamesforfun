#!/usr/bin/env bash
# Type-check the director script against Mojang's official typings for the stable modules it targets.
# Usage: ./typecheck.sh   (needs node/npm; installs into tools/.typecheck, which git ignores)
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p .typecheck
cd .typecheck
[ -f package.json ] || echo '{"name": "typecheck", "version": "1.0.0", "private": true}' > package.json
npm install --no-audit --no-fund --ignore-scripts @minecraft/server@2.9.0 @minecraft/server-ui@2.1.0 typescript@5.6.3 >/dev/null
rm -f ./*.js && cp ../scripts/*.js .
echo 'declare const console: { warn(...a: any[]): void; log(...a: any[]): void; error(...a: any[]): void };' > globals.d.ts
cat > tsconfig.json <<'JSON'
{"compilerOptions": {"allowJs": true, "checkJs": true, "noEmit": true, "target": "es2022", "module": "es2022",
  "moduleResolution": "node", "lib": ["es2022"], "types": [], "noUnusedLocals": true}, "files": ["index.js", "main.js", "brain.js", "care.js", "menu.js", "config.js", "halls.js", "globals.d.ts"]}
JSON
node_modules/.bin/tsc -p tsconfig.json && echo "scripts: no type errors against @minecraft/server 2.9.0 / server-ui 2.1.0"

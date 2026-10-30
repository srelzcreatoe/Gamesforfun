# Target versions and stable-API evidence (checked 2026-10-30)

## Selection

| Item | Value | Evidence |
|---|---|---|
| Retail game target | **Bedrock 1.26.60** (`min_engine_version [1, 26, 60]` in both manifests) | `Mojang/bedrock-samples` `version.json` lists 1.26.60.5 (27-10-2026) as latest; the official BDS download API serves `bedrock-server-1.26.61.1` (a 1.26.6x hotfix) |
| Runtime-tested build | Bedrock Dedicated Server **1.26.61.1** (Linux) | packs loaded and scenarios run — [TESTING.md](TESTING.md) |
| `@minecraft/server` | **2.11.0** | npm `latest` dist-tag (published 2026-10-27); learn.microsoft.com module page lists 2.11.0 under *Available Versions* (non-beta). Beta at the same time is `2.12.0-beta.1.26.61-stable` |
| `@minecraft/server-ui` | **2.3.0** | npm `latest` (2026-10-27) |
| Manifest format | 2 | Manifest v3 (needed for "custom pack settings") is documented as *preview* → not used |

Version pattern observed on npm: each retail release `1.26.X0` ships stable `@minecraft/server`
2.(n) and beta 2.(n+1)-beta.1.26.X0. 2.11.0 therefore corresponds to 1.26.60, which is why
`min_engine_version` is `[1, 26, 60]`. Players on older clients cannot load the pack; the
code would need re-verification before lowering either number.

## How "stable" was verified

1. **Type-checking against the stable typings.** `npm install @minecraft/server@2.11.0
   @minecraft/server-ui@2.3.0` installs the stable `.d.ts` files, which contain only
   stable members. Every script is type-checked with the TypeScript compiler against them
   (`python3 -I tools/validate.py --tsc-types <dir>`). Two real API mistakes were caught this
   way during development (an `entityTypes` option that `entityHurt` before-events does not
   accept, and a JSDoc type error).
2. **Runtime.** BDS 1.26.61.1 loads the behavior pack with no experiments enabled
   (`server.properties` has no experiment toggles; the world was created fresh by the
   harness). A beta-only member would throw at module load or call time; none did.
3. **Content log.** Entity JSON components (`minecraft:custom_hit_test`,
   `minecraft:behavior.melee_box_attack`, `minecraft:navigation.walk`, entity properties,
   component-group events, items, recipe) produced no content-log errors at log level
   *verbose*. One performance warning (`scan_interval` < 10) was fixed.

## Stable members the design relies on (all present in 2.11.0 typings, type-checked)

Encounter and world: `world.beforeEvents.entityHurt` (scripted death, health multiplier) ·
`Entity.setProperty/getProperty` (client-synced int properties) · `Entity.triggerEvent`
(including the `tailwail:float_on/off` gravity groups) · **`Entity.playAnimation`** (every
one-shot: attacks, scream, drop, howl; options `controller`, `blendOutTime`) ·
**`Entity.applyImpulse`** (the pounce) · `Entity.teleport` (with `facingLocation` /
`rotation`: climbing, ceiling placement) · `Entity.setRotation` · `Entity.applyDamage /
applyKnockback / addEffect / removeEffect` · `Dimension.getBlockFromRay` (sight, doors and
glass in its path) · `Dimension.getLightLevel / getSkyLightLevel` ·
`Dimension.getBlocks(BlockVolume, {includeTypes})` (torch and door queries) ·
`Dimension.spawnEntity` (`initialRotation`) · `Dimension.spawnParticle` · `Dimension.playSound` ·
`BlockPermutation.resolve / getState / withState`, `BlockTypes.get` · `system.runJob` ·
`system.beforeEvents.startup` -> `customCommandRegistry` and
`blockComponentRegistry.registerCustomComponent` (`onPlayerInteract`) · dynamic properties.

Player effects: `Player.camera.addShake / setFov / fade / stopShaking` ·
`Player.fogSettings.push / remove` (tagged fog stack) · `Player.playMusic / stopMusic`
(per-player music) · `Player.playSound` (per-player, positional) ·
`Player.inputPermissions.setPermissionCategory` (LateralMovement and Camera during the
grab; Sneak is only ever restored) · `Player.onScreenDisplay.setTitle / updateSubtitle /
setActionBar` · `Player.sendMessage` with `rawtext` / `translate` (the resource-pack check) ·
`world.afterEvents.playerButtonInput` (Jump and Sneak presses for the struggle) ·
`world.afterEvents.playerBreakBlock / playerPlaceBlock / playerInteractWithBlock /
blockContainerOpened / itemCompleteUse / itemReleaseUse` (mimicry and noise) ·
`@minecraft/server-ui` `ActionFormData` / `ModalFormData`.

Commands run from script (no cheats required for script-issued commands):
- `camera @s fov_clear <time> in_out_sine`, documented as
  `/camera <players> fov_clear [fovEaseTime] [fovEaseType]`; its syntax was confirmed on
  BDS 1.26.61.1;
- `setblock <x> <y> <z> air destroy` when it breaks through a door or window (drops the
  block and plays its break effects like a player breaking it); exercised on BDS 1.26.61.1.

Block format: `format_version 1.21.90` with the custom component listed directly in
`components` (custom components v2), loaded by BDS 1.26.61.1 without content-log errors.

## Deliberately not used

* `@minecraft/server-gametest`, `-net`, `-admin`, `-editor`, any `-beta` version.
* Custom pack settings (manifest v3, preview).
* Experimental cameras, rendering, upcoming creator features, holiday creator features.
* Custom shaders, external servers, network or ML services.

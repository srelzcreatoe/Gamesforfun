# 01 · Overview and compatibility specification

## What this is

**FREDBEAR: SIX NIGHTS BELOW** is a single-player, Five Nights at Freddy's–inspired horror campaign for
**Minecraft Bedrock Edition**. It ships as a behavior pack and a resource pack. The behavior pack builds the
whole map inside your own world (`/fb:setup`), installs the command-block network from structure files,
and runs the night simulation with the stable Script API.

* Map: abandoned entertainment complex, 200 × 200 footprint, 3 levels, 62 rooms and spaces (docs/02).
* Enemies: Freddy, Bonnie, Chica and Fredbear, each with its own state machine (docs/04).
* Campaign: training shift + six nights, persistent unlocks, Night 6 finale and ending (docs/05).
* Office: two doors, two hall lights, 16 cameras, hatch, emergency strobe, breaker, reserve lever, power and
  hour displays, warning indicators (docs/03).
* Command blocks: 448 blocks in 30 structure files, each one listed in docs/06.

## Target versions (pinned)

| Item | Version | Where it is pinned |
|---|---|---|
| Minecraft Bedrock Edition | **1.26.50** (stable) | `min_engine_version: [1, 26, 50]` in both manifests |
| `@minecraft/server` | **2.10.0** (stable) | BP manifest dependency + `package.json` dev typings |
| `@minecraft/server-ui` | **2.2.0** (stable) | BP manifest dependency + `package.json` dev typings |
| `@minecraft/vanilla-data` | 1.26.52 | dev only (typings / reference) |
| Manifest format | 2 | same format the official 1.26.50 vanilla sample packs use |
| Entity JSON | format 1.26.50 | `packs/FredbearBP/entities/*.json` |
| Item JSON | format 1.26.30 | `packs/FredbearBP/items/*.json` (latest item schema in the samples) |
| Client entity / animations / controllers | 1.10.0 / 1.8.0 / 1.10.0 | same formats as the vanilla 1.26.50 resource pack |
| Geometry | 1.21.0 | same as vanilla `humanoid.custom.geo.json` |

**No experimental toggles are required.** Every script module used is a stable (non-beta) version, and
every JSON component used appears in the official 1.26.50 schemas or in vanilla 1.26.50 files.

## How syntax was verified

Official references are vendored in `tools/ref/` (provenance in `tools/ref/SOURCE.md`): Mojang's
`bedrock-samples` tag **v1.26.50.4** (commit 46ba6ea985fb5a92d79a9419198f10dda14c199d) and the npm typings above.

| What | Checked against | Tool |
|---|---|---|
| Every command (448 command blocks, 7 functions, script command templates — 488 strings) | `mojang-commands.json` overloads, enums and parameter types | `tools/validate_commands.mjs` |
| Every block name and block state (253 palette entries, command arguments, structure palettes) | `mojang-blocks.json` | `tools/validate_blocks.mjs`, the mock's `BlockPermutation.resolve` |
| Particles, camera presets, effects, item ids | `vanilla_particles.txt`, `mojang-camera-presets.json`, `mojang-effects.json`, `mojang-items.json` | validators + integration mock |
| Entities and items JSON | `metadata/json_schemas` (server/entity/1.26.50, server/item/1.26.30) | `tools/validate_schemas.py` |
| Script API usage (every call, option bag and enum) | `@minecraft/server` 2.10.0 / `server-ui` 2.2.0 type declarations | `tsc --checkJs` (`npm run typecheck`) |
| Sound ids, fog ids, textures, geometry, animations, render controllers | the packs themselves | `tools/validate_assets.mjs` |

### Version-sensitive features in use (all stable in 2.10.0 / 1.26.50)

* Script lifecycle: `system.beforeEvents.startup` (custom commands `fb:setup`, `fb:lobby`, `fb:debug`) and
  `world.afterEvents.worldLoad` (world access only after load — early-execution rules of 2.x).
* Blocks: `Dimension.fillBlocks` with `BlockVolume` / `ListBlockVolume` and `blockFilter`, `BlockPermutation.resolve`,
  sign component `setText` / `setWaxed`, `world.structureManager.getPackStructureIds()` / `place()`.
* Camera: `Player.camera.setCamera('minecraft:free', { location, facingLocation, easeOptions })`, `fade`, `clear`.
* Input: `Player.inputPermissions.setPermissionCategory`, `world.afterEvents.playerButtonInput`
  (`InputButton.Sneak`), `world.afterEvents.playerHotbarSelectedSlotChange`.
* Entities: client-synced entity properties (`fb:anim` enum, `fb:eyes`, `fb:hidden`) set with `Entity.setProperty`.
* Items: `ItemStack.lockMode = ItemLockMode.slot`, `keepOnDeath`.
* Audio: `Player.playSound` / `Dimension.playSound` returning `SoundInstance` (`stop()` for music-box loops).
* Events from command blocks: `/scriptevent` → `system.afterEvents.scriptEventReceive` with `sourceBlock`.
* Persistence: world dynamic properties.
* UI: `ActionFormData`, `ModalFormData`, `MessageFormData`, `FormCancelationReason.UserBusy` retry.

1.26.50 renamed/split the old `minecraft:pushable` entity component (`pushable_by_block`,
`pushable_by_entity`); the animatronic entities use neither (they are teleported every tick), so they cannot be pushed.

## Unverified items (need an in-game check)

No part of this project has been run inside Minecraft (see docs/10). Items that static checks and the mock cannot settle:

1. **Structure ids.** Files at `structures/fb/<name>.mcstructure` are addressed as `fb:<name>` (Microsoft's documented
   folder-as-namespace rule). The builder reads `getPackStructureIds()`, falls back to matching by file name if the game uses another
   namespace, and reports any structure it still cannot find.
2. **Command blocks loading from our structures in 1.26.50.** Their NBT matches a structure exported by Bedrock
   (`tools/ref/reference_command_blocks.mcstructure`: same keys, `Version` 42, block version 18161159; tested), but the
   files have not been loaded by the game itself. The builder reports any structure that fails to place.
3. **Stair orientation**: `weirdo_direction` values 0-3 are mapped to +x/−x/+z/−z; visual facing is unverified.
4. **Custom item use**: whether `itemUse` fires for the three kit items (no `use_modifiers`). All office functions also
   exist as physical buttons, so this only affects convenience.
5. **Remote camera rendering**: whether feeds far from the player (up to 141 blocks) render terrain and puppets at a given
   render distance; ticking areas keep those chunks simulated, not necessarily rendered (docs/02 "Rendering reach").
6. **Visuals**: the `creaking_eyes` material for the glowing-eye layer, animation look and feel, model scale.
7. **Forms during a night**: forms do not pause the game; the clock keeps running while one is open.
8. **Builder duration and lag** on real hardware (about 2,500 plan operations, fills of at most 32,768 blocks each).
9. **Platforms**: designed for Windows (keyboard/mouse), controller and touch; **no platform has been tested in-game**.

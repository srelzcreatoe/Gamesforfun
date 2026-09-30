# Compatibility report — Grinshackle v2.0.0

## Target and dependencies

| Item | Value | Why |
|---|---|---|
| Minimum engine | `min_engine_version` 1.21.90 (both packs) | Baseline of the v1 project; first release with the stable `@minecraft/server` 2.0.0 module |
| Script modules | `@minecraft/server` **2.0.0**, `@minecraft/server-ui` **2.0.0** | Stable (non-beta) versions; kept from the v1 baseline. Both remain available on current releases because Bedrock keeps older stable module versions loadable. No Preview-only or beta API is referenced. |
| Entity / item / recipe format | `format_version` `"1.21.90"` | Matches the engine baseline; no experimental flags (`is_experimental: false`) |
| Client entity / controllers / animations | `1.10.0` / `1.10.0` / `1.8.0` | Standard stable formats |
| Experiments | **none required** | Holiday Creator Features, Beta APIs, custom biomes, etc. are all off |

The pack does not use custom item components, custom blocks, JSON UI overrides, `/camera`, dynamic lighting, block light levels, microphone
input, network requests or account data.

## Update identity

Both manifest header UUIDs and module UUIDs are the v1 values; the version is bumped to 2.0.0. Importing the v2 `.mcaddon` over a v1 world
updates the packs in place. The v1 entity `cr:chainreaver` is kept as a stub definition that despawns instantly; the v1 world properties
(`cr:active_id`, `cr:enabled`, `cr:muted`, `cr:fast`) are cleared once on first load (`gs:migrated_v1`).

## Approximations (documented honestly)

| Mechanic in the brief | Exact API available in stable 2.0.0? | Implementation |
|---|---|---|
| Light level at a position | No (no block light query in 2.0.0) | Counts placed light-emitting blocks in a 9×5×9 volume with up to 12 obstruction rays (`getBlockFromRay`). Called a "light approximation" everywhere; never a light-level reading. |
| Player attention / what is on screen | No | View-direction cone (cos > 0.91 ≈ 25°) plus a line-of-sight ray from the creature's eye to the player's head |
| Mining swings | No (only completed block breaks are events) | `playerBreakBlock` intervals (8–40 ticks) feed Answering the Mine |
| Footsteps | No footstep events | Derived from bounded movement samples (one step per 0.6 blocks on the ground); surface material read from the block under the imitation point |
| Loud events (bell etc.) | Partly | `playerInteractWithBlock` on a bell, `pressurePlatePush`, `leverAction`, `buttonPush` |
| Operator check | No (`Player.isOp` / `commandPermissionLevel` are not in 2.0.0) | `/scriptevent` and `/function` already require operator permission. Dial admin sections use the `gs_admin` tag (granted by the operator-only `/function grinshackle/admin`) or the recorded world owner (first player to join after install). |
| Script pathfinding / move-to | No | Native `minecraft:behavior.move_towards_target` steered by the player target tag or by one inert, self-expiring `gs:waypoint` helper entity (max 2 live, removed on every cleanup) |
| Selective vanilla-music ducking | No | `Player.playMusic` / `stopMusic` on the target player only; nothing else is stopped |
| Mineshaft recognition | No structure API | Nearby-block heuristic (fences, planks, rails, cobweb) that only biases spawn-point scoring |
| Radial configuration wheel | No custom UI without JSON-UI overrides (would conflict with other packs and could not be tested here) | Standard `ActionFormData` / `ModalFormData` / `MessageFormData` menus. The README does not claim a radial interface. |
| Death animation | The engine removes a dead entity after its vanilla death animation (about 1 s) | The entity carries a large engine health pool while the script tracks the configurable 80-point pool; at 0 it plays the full `collapse` clip, spawns the loot items and experience, then removes itself. `/kill` still works (engine loot table). |

## Facts confirmed on learn.microsoft.com (stable moniker) during this build

* `minecraft:timer`: `time`, `looping`, `time_down_event` as `{ "event": ... }` (waypoint helper expiry).
* `minecraft:experience_reward`: `on_death` accepts a Molang string or a number.
* `minecraft:damage_sensor`: triggers with `cause` (`"fall"` is a documented value) and `deals_damage: "no"`; `fall_damage` is not a cause and
  was removed from the entity file.
* `minecraft:cooldown` item component: `category` + `duration` (format ≥ 1.20.10) — used by the Rattle Lure.
* Animations: rotations are degrees applied X-then-Y-then-Z; channels are added component-wise across animations before the transform is built
  (which is why the run clip's wrapped Euler triple had to be re-expressed); `anim_time_update` is a documented animation field (the vanilla
  quadruped walk uses it); `loop: "hold_on_last_frame"` is documented.
* Molang: `query.ground_speed` is in metres/second; `query.target_x_rotation` / `query.target_y_rotation` need a current target (provided by the
  `nearest_attackable_target` goal); `query.property('gs:pose') == 'idle'` string comparison; `query.modified_move_speed` for moving/still.
* Script API: every member used exists in the shipped `@minecraft/server` 2.0.0 / `@minecraft/server-ui` 2.0.0 declarations (verified by
  TypeScript `checkJs` over all 22 modules; `Player.isOp`, `commandPermissionLevel`, block light and camera APIs are absent and not used).

## Animation conventions used by the audit

* Model forward is **-Z** (eyes, pupils and teeth sit on the -Z side of the head). Forward strikes were verified to travel toward -Z.
* Bedrock Euler rotations are evaluated as Rz·Ry·Rx with positive X pitching the front down; the toolkit renders the file coordinates
  un-mirrored (the mirror image of the Blockbench viewport), which does not affect forward/back or up/down checks.
* Rotation keys add to the bone's base rotation; position keys translate the pivot in the parent frame; keys are linearly interpolated (all
  supplied keys are dense 30/40 fps bakes with no molang and no Catmull-Rom).

## Known limitations

* No Minecraft client or dedicated server was available in the build environment: appearance, audio mix, mobile controls, native pathfinding and
  multiplayer latency were **not** playtested. See `test_report.md` for what was and was not tested.
* `anim_time_update` scales the locomotion clips with `query.ground_speed`; the clamp ranges were chosen from the clips' native stride speeds and
  may need a small in-game tweak.
* The light approximation counts placed blocks, so a lit area created by lava, glow lichen or sky light is not recognised.

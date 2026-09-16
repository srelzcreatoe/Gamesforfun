# Brief: PLAYER & UI engineer

Read COMMON.md first. Your contracts: ARCHITECTURE.md §6 (player) and §10 (UI); also §3, §4, §7, §12; game/docs/CUBIC_WORLD_UI_SPEC.md (the exact
HUD/camera/inventory design the user wants re-created, with numbers); DATA_SCHEMA.md (items, recipes, Profile); game/scripts/util/ProfileFactory.gd;
game/project.godot (input map, stretch). GUI art: game/assets/textures/gui/inventory.png, widgets.png, icons.png, accessibility.png (Minecraft-style HD
sheets — inspect with the Read tool to measure the HD scale: standard layout is inventory.png panel 176x166 at (0,0) of a 256x256 sheet, widgets.png
hotbar (0,0,182,22), selector (0,22,24,24), buttons (0,66)/(0,86), icons.png hearts at (16,0)... multiplied by the HD factor),
gui/hud/xenoversehud.png (+ gui/hd/hud/), gui/menu/*.png, gui/buttons/*.png, gui/radial/*.png, gui/quest/*.png, gui/scouter/*.png,
gui/background/*_panorama_0..5.png (cube panoramas per race), gui/mc/*, fonts/Monocraft.ttf (project theme), misc/crack_0..3.png, item icons in
assets/textures/items (`Textures.item_icon(item_id)`).

You own: game/scripts/player/** (Player.gd, PlayerInput.gd, KeyboardInput.gd, CameraRig.gd, Interaction.gd, PlayerStats.gd), game/scenes/player/Player.tscn,
game/scripts/inv/** (ItemStack.gd, Inventory.gd, Crafting.gd, ContainerStore.gd, FurnaceStore.gd), game/scripts/ui/** and game/scenes/ui/** (UiManager,
Hud, Inventory, MainMenu, WorldSelect, CreateWorld, CharacterCreation, Settings, Pause, Death, Loading, Toast, Dialog, QuestLog, StatsScreen, Radial,
WishScreen, SpaceMap, HudPreview, UiTheme.gd, UiUtil.gd), game/tests/test_inventory_*.gd, test_player_*.gd, test_ui_*.gd.

Other engineers call your screens through `Game.ui.open("dialog", {npc: node})`, `open("quests")`, `open("wish", {dragon: "shenron"})`,
`open("space_map")`, `toast(...)`; keep these stable and render sensibly with missing data.

Deliverables:
1. `Player.tscn/.gd` extending `Entity` (res://scripts/entity/Entity.gd, written concurrently; if missing at compile time use a temporary
   `scripts/player/PlayerBase.gd` with the §7 fields and note it): movement per §6 + spec §4 (walk/sprint/sneak/jump/step-up/swim/ladder; ki flight:
   double-tap jump or Fly button when skill fly ≥ 1, speed × skill, fly-fast = sprint while flying costs stamina, hover), planet gravity, hunger/oxygen/
   fall damage/regen (PlayerStats), footsteps by material (`Audio.play_sfx("step_<material>")`), swimming (buoyancy, bob, current push from
   `VoxelPhysics.fluid_at`, underwater tint via HUD), model: `BedrockModel` + `RaceSkin.compose(...)` when available (else a box), animations
   base.idle/walk/run/crouching/crouching_walk/jump/landing/fly_idle/fly_front/fly_fast/swimming/ki_charge/mining1 via `BedrockAnimation` when
   available, `write_profile/read_profile` (position, health, ki, hunger, inventory, hotbar), `inventory`, `selected_stack()`, `hotbar_index`,
   `eye_position()`, `aim_origin()/aim_direction()`, `interaction`, `input`, damage -> Events.player_damaged, death -> Events.player_died + Death screen
   -> respawn at spawn.
2. `CameraRig.gd` (§6 + spec §2): SHOULDER (default: right shoulder, distance 3.4, offset (0.55, 0.15), FOV from settings, voxel pull-in), FIRST, FRONT;
   cycle with the camera button / `camera_toggle`; look from PlayerInput.look_delta with per-mode sensitivity; pitch clamp ±89°; bobbing in FIRST;
   `shake(strength, duration)` (+ Events.screen_shake); lock-on easing toward `player.target`; FOV +8 when flying fast; near 0.08,
   far = render_distance*16+32; `cinematic_orbit(center, duration, distance, speed)` for the fx engineer; player model hidden in FIRST.
3. `PlayerInput.gd` (§6) + `KeyboardInput.gd` (WASD, captured mouse, actions) + `Hud.tscn` touch controls per spec §1 exactly (joystick with double-push
   sprint, look region with tap/hold semantics and hold-to-mine, buttons Jump/Sneak/Sprint/Attack/Ki Blast (tap = blast, hold ≥ 0.4 s = charged)/
   Charge Ki (hold)/Fly/Dash/Transform/Technique (opens Radial)/Lock-on/Pause/Camera/Quests/Stats/Bag; left-handed mirroring; button opacity; sizes
   with `s = Game.ui_scale()`), hotbar (widgets.png, selection frame, counts), hearts/hunger rows (icons.png), armor row, oxygen bar, ki + stamina
   bars (xenoversehud.png), level/TP label, form name, crosshair, mining ring, targeted-entity health bar, quest tracker (top-left; Events.quest_*),
   toasts (Events.toast; `toast_tutorial` sound), hint banner, damage numbers (Events.damage_number -> projected labels), "Saving..." indicator.
   Built from code + sheets, anchored to edges, scaled by `s`, re-layout on size change, safe area respected. Multitouch: own pointer tracking on
   InputEventScreenTouch/Drag (joystick + look + button simultaneously); mouse emulation lets the same HUD work for screenshots. Haptics via
   Input.vibrate_handheld per spec.
4. `Inventory.gd`/`ItemStack.gd`/`Crafting.gd`: 36 + 4 armor slots, stack limits, `add -> leftover`, `remove`, `count`, `has`, `move` per spec §3
   (tap-tap, split on second tap), shaped 2x2/3x3 + shapeless matcher, `craftable_list(inventory, station)`, furnace smelting with fuel/time ticking,
   container stores (chest 27 slots; persist through `Game.world.get_column(cx,cz).extra` if the voxel engineer exposes `extra`, else
   `Game.profile.containers` keyed "planet:x:y:z"), armor equip, `to_dict/from_dict`.
5. `Interaction.gd` (§6 + spec §5): reach 4.6 via `Game.world.raycast`, hold-to-mine (hardness / tool_speed by tier), crack overlay, target outline,
   drops via `World.spawn_entity("item_drop", pos, {item, count})` when Pickup exists else direct add, place with body/entity intersection check,
   sounds, tap on entity -> melee combo (3 hits, 0.35 s windows, combat.one_handed_punch_left/right + gutkick animations when available, damage from
   `scripts/combat/Stats.gd` if present else 5), tap on NPC -> `interact(player)`, use items: food (1.2 s hold), capsule_house (spawns a small house of
   blocks), radar/dragon_ball/vehicle -> quests/combat via Events / `Game.world.get_node_or_null("DragonBalls")`.
6. UI screens (§10 + spec §7): MainMenu ("DRAGON BLOCK SAGAS", rotating race panorama cube, Play/Settings/How to Play/Credits/Quit, `Audio.play_bgm("menu")`),
   WorldSelect (cards + create/rename/copy/delete via Game), CreateWorld, CharacterCreation (race/gender/class/body/hair/colours/name with a live
   BedrockModel+RaceSkin preview when available; `ProfileFactory.new_profile` then `Game.start_world`), Loading (`World.load_progress()` if present,
   tips), Settings (spec §6 + quality preset + shadows/bloom/clouds; Game.save_settings), Pause, Death, Inventory (inventory.png 9-slice, armor slots,
   character preview, 2x2/3x3 grid + output, touch-friendly recipe list), Chest/Furnace/Station screens, Dialog (portrait, typewriter text, choices
   Talk/Train/Quests/Shop/Leave; Events.dialog_closed), QuestLog (saga tree with locked/available/active/complete via gui/quest + questmenu.png;
   sidequest categories; details; Start/Track/Claim calling `Game.world.get_node_or_null("QuestManager")` can_start/start/claim/track), StatsScreen
   (stats + TP spend via `Game.player.stats.raise(stat)` if present; skills; techniques; forms with transform/mastery), Radial (8-slot wheel, drag to
   select), WishScreen (Registry.wishes[dragon]; callback), SpaceMap (planet icons + lock state; `Game.change_planet`). Android BACK closes screens;
   scale with `s`; 16:9, 20:9, 4:3; safe area; nearest filtering; Monocraft sizes in multiples of 8.
7. `UiManager.tscn/.gd` (§10): `open/close/is_modal_open/toast/show_hint`, `Game.paused_by_ui`, screen stack, HUD input blocked while modal.
8. Verification: screenshots of every screen via `--scene res://scenes/ui/<Screen>.tscn`, the HUD via `--args "--autoplay=5"` once the World exists
   (until then `scenes/ui/HudPreview.tscn` with a fake ground plane), at `--size 1280x720`, `1600x720` and `1024x768`. Fix overlaps, cut-off text,
   wrong sprite regions, blurry scaling.
9. Tests: inventory add/remove/merge/split/swap, crafting matcher, recipe list, PlayerInput edge flags, camera pull-in math, break time formula,
   profile roundtrip.

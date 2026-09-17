# Dragon Block Sagas — Architecture & Contribution Contract

This file is the single source of truth for how the game is put together.
Every subsystem is built by a different engineer/agent in parallel, so the
interfaces below are **contracts**: implement against them, do not redefine
them. If a contract is genuinely wrong, say so in your report instead of
silently changing it.

Working title: **Dragon Block Sagas** (a Dragon Block C / DragonMineZ inspired
voxel action-RPG). Target: **Android phones, landscape, 60 fps**, plus a Linux
desktop build used for automated verification.

## 0. Toolchain facts (environment of this repository)

| Thing | Where |
|---|---|
| Godot editor (4.4.1 stable, Linux x86_64) | `$GODOT` = `/tmp/claude-0/-home-user-Gamesforfun/a637a6ef-7708-59b3-aeb2-5b4698448421/scratchpad/godot/Godot_v4.4.1-stable_linux.x86_64` |
| Wrapper scripts | `tools/godot.sh` (runs the editor binary with env), `tools/run_tests.sh`, `tools/screenshot.sh`, `tools/export_android.sh`, `tools/sandbox.sh` |
| Android SDK (build-tools 34, platform-tools) | `/tmp/claude-0/-home-user-Gamesforfun/a637a6ef-7708-59b3-aeb2-5b4698448421/scratchpad/android-sdk` |
| JDK 21 | `/usr/lib/jvm/java-21-openjdk-amd64` |
| Export templates 4.4.1 | `~/.local/share/godot/export_templates/4.4.1.stable/` (android + linux) |
| Source packs (extracted) | `/tmp/claude-0/-home-user-Gamesforfun/a637a6ef-7708-59b3-aeb2-5b4698448421/scratchpad/ex/{dmz,dmzplus,dmzhd,fused,particles,shaders}` |
| Virtual display for screenshots | `xvfb-run -a -s "-screen 0 1280x720x24"` + `--rendering-driver opengl3` (llvmpipe) |

**Rendering method is `gl_compatibility` on every platform** (this is what the
phone runs and what the llvmpipe test rig can render). Do not use features the
compatibility renderer lacks: no SDFGI/SSR/SSAO/volumetric fog, no compute
shaders, no `Texture3D` sampling in fragment shaders on GLES3 devices that lack
it (avoid), no `GPUParticles3D` sub-emitters. `GPUParticles3D` itself works;
prefer `CPUParticles3D` for anything with < 200 particles. Glow works.
Custom `spatial`, `canvas_item` and `sky` shaders work.

**Physics engine is "Dummy"** (`physics/3d/physics_engine="Dummy"`). There are
no PhysicsBody/Area/RayCast nodes in gameplay code. All collision is voxel AABB
math in `scripts/world/VoxelPhysics.gd` and simple entity-vs-entity AABB tests.

## 1. Directory layout & ownership

```
game/                        Godot project root (res://)
  project.godot              (owner: integrator) settings, autoloads, input map
  export_presets.cfg         (owner: integrator)
  autoload/                  (owner: integrator; others may ADD signals to Events.gd
                              and request additions – see §3)
  data/                      JSON registries (schema: docs/DATA_SCHEMA.md)
     blocks.json items.json recipes.json biomes.json planets.json
     entities.json races.json forms.json skills.json techniques.json
     masters.json wishes.json audio.json structures.json
     quests/<saga_or_category>/*.json   sagas.json
  assets/                    produced by tools/build_assets.py – DO NOT hand edit
     textures/blocks/*.png   16x16 tiles (name = texture key in blocks.json)
     textures/items/*.png    item icons (16x16 or 32x32)
     textures/entity/**      DMZ + DMZ-HD entity/race textures
     textures/armor/**       armor layer textures
     textures/gui/**         inventory.png, widgets.png, icons.png, xenoversehud.png, DMZ menus
     textures/particles/**   particle sprites (DMZ + AAA particles)
     textures/environment/** planets, milky way, sun/moon, clouds
     models/**/*.geo.json    Bedrock geometry (verbatim from DMZ / DMZ-HD)
     animations/**/*.animation.json  Bedrock animations (verbatim)
     audio/sfx/*.ogg audio/bgm/*.ogg
     fonts/Monocraft.ttf     pixel font (OFL)
     misc/                   theme.tres, icons, colormaps
  shaders/                   *.gdshader / *.gdshaderinc   (owner: shaders agent, chunk/water
                              shaders co-owned with voxel agent – see §5)
  scenes/
     main/Main.tscn Main.gd  boot, scene switching, cmdline harness (integrator)
     ui/                     menus, HUD, inventory, quests, dialogs (UI agent)
     world/World.tscn        world root: chunks, sky, entities container (voxel agent)
     player/Player.tscn      (player agent)
     entities/               NPC/enemy/projectile scenes (entity + combat agents)
     fx/                     aura, transformation, explosions (fx agent)
  scripts/
     world/                  ChunkColumn, ChunkManager, ChunkMesher, Lighting,
                             Fluids, VoxelPhysics, World, SaveManager (voxel agent)
     worldgen/               WorldGen, planet generators, Decorator, Structures (worldgen agent)
     player/                 Player, PlayerInput, CameraRig, Interaction (player agent)
     entity/                 Entity, BedrockModel, BedrockAnimation, Npc, Enemy, AI (entity agent)
     combat/                 Stats, Damage, Ki, Techniques, Forms, Projectiles (combat/fx agent)
     quests/                 QuestManager, SagaManager, DragonBalls, Wishes, SpaceTravel (quests agent)
     inv/                    Inventory, Crafting, ItemStack (UI agent)
     ui/                     UI controllers (UI agent)
     fx/                     transformation cinematics, particles, screen fx (fx agent)
     audio/                  BGM director helpers (audio agent)
     util/                   Noise, Json, MathX, Pool, Profiler (shared; additions welcome)
  tests/                     headless GDScript tests, run by tools/run_tests.sh
  docs/                      this file, DATA_SCHEMA.md, CUBIC_WORLD_UI_SPEC.md
tools/                       python asset pipeline + shell wrappers
legacy/cubicworld/           the previous Kotlin/LibGDX game (reference only, never built)
```

Rule: **you only create/modify files inside the folders you own**, plus the
tests you add under `tests/`, plus new *signals* appended to
`autoload/Events.gd` (append-only, keep the existing ones). If you need a change
elsewhere, describe it precisely in your final report.

## 2. Conventions

* GDScript 2 with **static typing everywhere** (`var x: int`, typed arrays,
  `-> void`). `class_name` for every reusable class. No `@tool` scripts unless
  needed for the editor.
* File names `PascalCase.gd` for classes, `snake_case.gd` for scripts attached
  to specific scenes is also fine — but one class per file.
* Units: 1 block = 1 m. World Y up. **Entity position = centre of the feet.**
  Voxel `(x, y, z)` occupies `[x, x+1) × [y, y+1) × [z, z+1)`.
* World time: `World.time_ticks` in `[0, 24000)` like Minecraft: 0 = 06:00
  sunrise, 6000 = noon, 12000 = 18:00 sunset, 18000 = midnight. One full day =
  20 real minutes. `World.day_fraction()` returns `time_ticks / 24000.0`.
* Every stat/number that a designer might tune lives in `data/*.json`, not in
  code constants (except engine constants such as chunk size).
* Never call `get_node` with hard-coded deep paths across subsystems. Use the
  accessors in §3 (`Game.world`, `Game.player`, `Game.ui`).
* Threads: only `WorkerThreadPool` tasks; a task may read immutable snapshots
  and produce plain data (PackedArrays, Dictionaries). Only the main thread
  touches the scene tree, creates Nodes, or mutates `ChunkColumn`s. Hand results
  back through `call_deferred` or a mutex-protected queue drained in `_process`.
* Performance budget per frame on a mid-range phone: world update ≤ 4 ms,
  entities ≤ 2 ms, UI ≤ 1 ms. Mesh uploads ≤ 2 sections per frame. Never
  allocate large arrays in `_process` of hot paths; reuse buffers.
* No `print` spam in hot loops. Use `Log.d/i/w/e` (`scripts/util/Log.gd`).
* All user-facing text in English, plain strings (no i18n layer yet).

## 3. Autoload singletons (already implemented in `autoload/`)

### `Events` – signal bus (append-only)
See the file; every cross-subsystem notification goes through it. Emit with
`Events.block_changed.emit(pos, old_id, new_id)`.

### `Registry` – data registries
```gdscript
Registry.blocks: Array[Dictionary]         # index = numeric block id, 0 = air
Registry.block_ids: Dictionary             # "stone" -> 1
Registry.block(id: int) -> Dictionary
Registry.block_id(name: String) -> int     # -1 if unknown
Registry.items: Dictionary                 # "senzu_bean" -> item def (blocks auto-register as items with same id)
Registry.item(id: String) -> Dictionary    # {} if unknown
Registry.recipes: Array[Dictionary]
Registry.biomes: Dictionary                # id -> def
Registry.planets: Dictionary               # id -> def
Registry.entities: Dictionary              # id -> def
Registry.races, forms, skills, techniques, masters, wishes, structures, audio: Dictionary
Registry.sagas: Array[Dictionary]          # ordered
Registry.quests: Dictionary                # quest_id -> def (quest_id = "<category>:<id>", e.g. "saga_saiyan:1", "sidequest:roshi_basic_training")
Registry.validate() -> PackedStringArray   # returns human-readable problems; boot fails loudly if non-empty
```
Block ids are assigned by declaration order in `blocks.json` (max 255; id 0 is
`air`). **Never reorder blocks.json** once saves exist; append only.

### `Textures`
```gdscript
Textures.block_array: Texture2DArray       # one 16x16 layer per texture key, nearest filtering, mipmaps
Textures.layer(tex_key: String) -> int     # layer index for a texture key ("stone0"), 0 = missing/magenta
Textures.block_face_layers(block_id: int, face: int) -> int  # face: 0=+X east 1=-X west 2=+Y top 3=-Y bottom 4=+Z south 5=-Z north; handles variants by hash
Textures.item_icon(item_id: String) -> Texture2D
Textures.entity_texture(path: String) -> Texture2D   # cached, path relative to assets/textures/entity/
Textures.gui(name: String) -> Texture2D              # assets/textures/gui/<name>.png
Textures.particle(name: String) -> Texture2D
```

### `Audio`
```gdscript
Audio.play_sfx(name: String, volume_db := 0.0, pitch := 1.0) -> void   # assets/audio/sfx/<name>.ogg
Audio.play_sfx_at(name: String, pos: Vector3, volume_db := 0.0, pitch := 1.0) -> void
Audio.play_loop(name: String, key: String, volume_db := 0.0) -> void    # e.g. ki_charge_loop; stop with stop_loop(key)
Audio.stop_loop(key: String, fade := 0.2) -> void
Audio.play_bgm(context: String, fade := 1.5) -> void   # context from data/audio.json playlists ("menu","explore","battle","boss","transformation","space","otherworld","namek",...)
Audio.stop_bgm(fade := 1.0) -> void
Audio.set_volume(bus: String, linear: float) -> void    # "Master","Music","Sfx","Ambience"
```

### `Game`
```gdscript
Game.settings: Dictionary     # persisted user://settings.json (see Game.gd DEFAULT_SETTINGS)
Game.save_settings() -> void
Game.world: Node              # current World node or null
Game.player: Node             # current Player node or null
Game.ui: Node                 # UiManager (scenes/ui/UiManager) or null
Game.profile: Dictionary      # current character + progress (schema: DATA_SCHEMA.md §Profile), persisted per world
Game.world_info: Dictionary   # {name, seed, planet, created, last_played, mode:"story"|"creative", difficulty:"easy"|"normal"|"hard"}
Game.is_mobile() -> bool
Game.ui_scale() -> float      # clamp(viewport_height/480, 0.8, 3.0) * settings.ui_scale
Game.goto_main_menu(), Game.start_world(world_info: Dictionary, profile: Dictionary), Game.save_all(), Game.quit_to_menu()
Game.list_worlds() -> Array[Dictionary], Game.delete_world(name), Game.create_world(name, seed, mode, difficulty) -> Dictionary
Game.paused_by_ui: bool       # true while a modal UI is open; World and entities must freeze simulation
```

## 4. World & voxel engine contract (`scripts/world/`)

Constants (`scripts/world/WorldConst.gd`):
`CHUNK = 16`, `HEIGHT = 128`, `SECTIONS = 8`, `SEA_LEVEL = 62`,
`index(x, y, z) = x + 16 * (z + 16 * y)` for local coords (y-major so a
16-high section is a contiguous 4096-byte range starting at `section * 4096`).

`ChunkColumn` (RefCounted): `cx, cz: int`, `blocks: PackedByteArray(32768)`,
`meta: PackedByteArray(32768)` (fluid level 0-7 / bit 3 = falling; crop stage;
block rotation), `light: PackedByteArray(32768)` (high nibble sky, low nibble
block), `heightmap: PackedByteArray(256)` (highest non-air y + 1),
`biomes: PackedByteArray(256)` (biome index into `Registry.biomes` order),
`state: int` (EMPTY, GENERATED, DECORATED, LIT, MESHED), `dirty_sections: int`
bitmask, `modified: bool` (needs saving), `entities_pending: Array` (spawn list
from generation), `structure_marks: Array` (quest/structure anchors).

`World` (Node3D, scene `scenes/world/World.tscn`, script `scripts/world/World.gd`):
```gdscript
var planet_id: String; var seed: int; var time_ticks: float; var weather: String
func get_block(x: int, y: int, z: int) -> int          # 0 outside loaded/height
func get_block_v(p: Vector3i) -> int
func set_block(x: int, y: int, z: int, id: int, meta := 0, notify := true) -> void   # marks dirty sections (and neighbours on borders), relights, emits Events.block_changed
func get_block_meta(x, y, z) -> int ; func set_block_meta(x, y, z, v: int) -> void   # (not get_meta/set_meta: those collide with Object)
func get_light(x, y, z) -> int    # max(sky*daylight, block) 0..15 used for entity shading
func get_sky_light(x, y, z) -> int ; func get_block_light(x, y, z) -> int
func get_height(x: int, z: int) -> int      # first air above ground (spawn height)
func get_biome(x: int, z: int) -> String
func is_solid(x, y, z) -> bool ; func is_liquid(x, y, z) -> bool
func raycast(origin: Vector3, dir: Vector3, max_dist: float, ignore_liquid := true) -> Dictionary
     # {hit: bool, block: Vector3i, normal: Vector3i, point: Vector3, dist: float, id: int}
func get_column(cx: int, cz: int) -> ChunkColumn  # or null
func is_area_loaded(pos: Vector3, radius_blocks: float) -> bool
func set_view_center(pos: Vector3) -> void   # ChunkManager streams around this
func spawn_entity(entity_type: String, pos: Vector3, data := {}) -> Node   # instantiates scenes/entities per Registry.entities[type].scene, adds to $Entities
func get_entities() -> Array[Node]           # all Entity nodes
func entities_in_aabb(aabb: AABB) -> Array[Node]
func day_fraction() -> float ; func sun_direction() -> Vector3 ; func daylight() -> float # 0..1
func add_disturbance(pos: Vector3, strength: float, duration := 0.6) -> void  # parts grass/leaves
func load_progress() -> float ; func save_modified_chunks() -> void ; func flow_at(x, y, z) -> Vector3
func explode(center: Vector3, radius: float, power: float, source: Node) -> void  # destroys blocks (respecting hardness/unbreakable), damages entities, spawns fx via Events.explosion
```
`VoxelPhysics` (static helpers): `move_aabb(world, aabb: AABB, motion: Vector3, step_height: float) -> Dictionary {aabb, motion_done, on_ground, hit_x, hit_y, hit_z}` per-axis sweeps (Y, X, Z), `aabb_intersects_solid(world, aabb) -> bool`, `fluid_at(world, aabb) -> Dictionary {in_liquid, submerged_fraction, flow: Vector3}`.

Fluids: `Fluids.gd` ticks water/lava spreading every 5 world ticks (0.25 s)
Minecraft-style (levels 8=source, 7..1 flowing, downward flow), computes flow
vectors used by the water shader (UV2) and by `VoxelPhysics.fluid_at` to push
entities (this is the "water physics": currents, buoyancy, waterfalls, splash
particles via `Events.splash`). Water is also swimmable: see player contract.

Meshing: `ChunkMesher.build_section(snapshot) -> Dictionary` on worker threads
producing three surfaces: `opaque`, `cutout` (alpha-scissor: leaves, plants,
glass panes), `water` (translucent). Vertex layout: `POSITION`, `NORMAL`,
`UV` (0..1 tile uv), `UV2 = Vector2(layer_index, packed_light/255.0)` where
`packed_light = sky*16 + block`, `COLOR = Color(tint.r, tint.g, tint.b, ao)`
with `ao ∈ {0.55, 0.7, 0.85, 1.0}`. Materials are the shared ShaderMaterials in
`shaders/chunk_opaque.gdshader`, `chunk_cutout.gdshader`, `water.gdshader`
(uniforms: `sampler2DArray tiles`, `float daylight`, `vec3 sun_color`,
`vec3 fog_color`, `float fog_start`, `float fog_end`, `float time`, plus the
water ones). Face shading factor by normal (top 1.0, north/south 0.8,
east/west 0.6, bottom 0.5) is applied in the shader, not baked.

Wind & foliage (vertex shader only, free on mobile): the mesher tags every vertex with a
**sway mode** inside `UV2.x` (`layer + (frames + 64 * sway_mode) / 256`, `sway_mode` = 0 static,
1 plant, 2 leaves). `shaders/chunk_cutout.gdshader` moves them: plants bend at the tip
(anchored at the base), leaf blocks drift as a whole so a canopy never cracks open — the wave's
phase comes only from the vertex's world position, so vertices shared by neighbouring blocks
move identically. Uniforms (pushed by `World` on the **cutout material only**):
`vec2 wind_dir` (world xz direction, slowly rotating), `float wind_strength` (metres at full
gust, 0.06), `float wind_speed`, `float wind_gust` (0..1, slow wave + weather),
`vec4 disturb[6]` (xyz = world position, w = strength 0..1) and `int disturb_count`.
Slot 0 of `disturb` is the player's feet (0.6, or 1.0 while flying/sprinting); the rest are
recent impacts. Anything can part the foliage with
`World.add_disturbance(pos: Vector3, strength: float, duration := 0.6)`; `World` also registers
one for every `Events.explosion` and `Events.entity_damaged`. Radius is
`1.6 + strength * 3.0` m, and the push fades over `duration`.

Lighting: sky light flood-fill from the heightmap (15 at open sky, −1 per
block sideways/down through transparent blocks, blocked by opaque), block
light flood-fill from emissive blocks (`light` field in blocks.json). Both run
on the worker thread after generation; edits relight the affected 32³ region
on the main thread (budgeted, incremental).

Saving: `SaveManager` writes modified columns to
`user://worlds/<world>/<planet>/c_<cx>_<cz>.bin` (header + DEFLATE) and
world meta to `world.json`; unmodified columns regenerate from the seed.

## 5. Shader ownership

* `shaders/chunk_opaque.gdshader`, `chunk_cutout.gdshader`: written by the
  **voxel agent** (functional first), polished by the shaders agent (keep the
  uniform names).
* `shaders/water.gdshader`, `sky.gdshader`, `clouds.gdshader`,
  `post_process.gdshader`, `aura.gdshader`, `ki_beam.gdshader`,
  `shaders/lib/*.gdshaderinc`: shaders agent (aura/ki_beam co-owned with fx agent).
* Per-planet sky parameters live in `data/planets.json` → `sky` block
  (colors, star density, milky way, visible bodies, fog). `World` owns the
  `WorldEnvironment` + `DirectionalLight3D` and calls
  `SkyController.apply(planet_def, time_ticks, weather)` every frame
  (`scripts/world/SkyController.gd`, shaders agent).

## 6. Player contract (`scripts/player/`)

`Player` extends `Entity` (scenes/player/Player.tscn). Movement modes: walk /
sprint / sneak / swim / fly (ki flight, `fly` skill) / kinton (nimbus). Physics
constants come from `data/entities.json["player"]` and the Cubic World spec
(docs/CUBIC_WORLD_UI_SPEC.md §4) adapted: gravity 23 m/s², jump 7.4 m/s (× jump
skill), walk 4.2, sprint 5.6 (× sprint skill), sneak 1.6, swim 2.4, fly 12
(× fly skill, ×2.2 when "fly fast"), AABB 0.6×1.8. Water: buoyancy toward
surface when submerged fraction > 0.6 and not pressing sneak; current from
`VoxelPhysics.fluid_at` pushes at `flow * 1.5 m/s`.

`PlayerInput` (RefCounted) is the only input source the Player reads:
```gdscript
var move: Vector2        # -1..1 (x right, y forward)
var look_delta: Vector2  # pixels this frame
var jump, sneak, sprint, attack, use, ki_charge, ki_blast, fly, dash, lock_on: bool
var jump_pressed, attack_pressed, use_pressed, fly_pressed, transform_pressed, technique_pressed, dash_pressed, lock_on_pressed: bool  # edge triggers, cleared each frame
var hotbar_select: int = -1
```
The HUD (touch) and `KeyboardInput` both write into the same `PlayerInput`.

`CameraRig` (Node3D child of Player): modes `SHOULDER` (default, over the
right shoulder: pivot at eye height 1.62, offset `(+0.55, +0.15, 0)` in camera
space, distance 3.4, FOV 75), `FIRST`, `FRONT` (selfie). Voxel collision
pull-in identical to the Cubic World spec (§2). Aim direction = camera forward
through the crosshair; when `lock_on` target exists, camera yaw eases toward
the target. Shoulder swaps to the left when the player strafes left for > 0.6 s
(nice-to-have). Camera shake API: `CameraRig.shake(strength: float, duration: float)`
also driven by `Events.screen_shake`.

`Interaction.gd`: reach 4.6 blocks; hold-to-mine with break progress
(`hardness / tool_speed`), crack overlay (`assets/textures/misc/crack_0..3`),
tap-to-place with body-intersection rejection, tap-on-entity = melee attack
(combo of 3 punches/kicks using DMZ `combat.*` animations), tap-on-NPC = talk.

## 7. Entities contract (`scripts/entity/`)

`Entity` (Node3D): `world`, `entity_type: String`, `aabb_size: Vector3`,
`velocity: Vector3`, `on_ground: bool`, `in_liquid: bool`, `yaw: float`
(radians, 0 = facing −Z), `stats: Stats`, `health/max_health`, `ki/max_ki`,
`stamina/max_stamina`, `faction: String` ("player","z_fighter","villain","wild"),
`team_id: int`, `is_flying: bool`, `current_form: String` (`""` = base),
`model: BedrockModel` (child), `anim: BedrockAnimation`.
Methods: `take_damage(amount: float, source: Node, kind: String, knockback := Vector3.ZERO) -> float`
(returns damage actually applied after defense/ki protection; emits
`Events.entity_damaged`), `heal(amount)`, `die(killer)` (drops loot from
`Registry.entities[type].drops`, emits `Events.entity_died`), `set_target(node)`,
`play_anim(name: String, blend := 0.15, loop := true)`, `face(pos: Vector3)`,
`apply_physics(delta)` (uses VoxelPhysics; flying entities skip gravity).

`BedrockModel.gd`: builds the bone hierarchy (`Node3D` per bone, pivot &
rotation from geo.json, cubes → one `ArrayMesh` per bone with per-face box UVs,
inflate, mirror), 1 unit = 1/16 m, model faces −Z (Godot forward) with the
right arm on the entity's right side — verify visually. Supports texture
layering: `set_texture(image: Image)` where the race composer
(`RaceSkin.gd`) blends base body + body type + eyes/nose/mouth + tattoos + hair
colour + gi/armor into one 64x64 (or HD 1024x1024 for the DMZ-HD pack) image.
DMZ-HD textures are used whenever `assets/textures/entity/hd/<same path>.png`
exists (the pipeline places them there), else the DMZ 64x64 ones.

`BedrockAnimation.gd`: plays `.animation.json` clips: keyframes (linear +
catmullrom), loop modes, blend between clips, per-bone override channels, and a
small Molang evaluator supporting `query.anim_time`, `query.life_time`,
`query.head_x_rotation`, `query.head_y_rotation`, `query.is_on_ground`,
`query.ground_speed`, `math.sin/cos/abs/clamp/lerp/mod`, `+ - * / ( )`,
numbers, `variable.*` (default 0). Expressions are compiled once (tokenised to
RPN) and evaluated per frame; angle functions take degrees like Bedrock.

### Animation state API (what callers use instead of clip names)

Nothing outside `scripts/entity/` names a clip. Callers name a *state* and
`AnimSelect.gd` resolves it to the best clip the entity actually has, DMZ first
(`base.*`, `transf.*`, `skp.*`) and Serious Player Animations (MIT, imported as
`assets/animations/spa/player.animation.json`, every clip prefixed `spa.`) only
for the states the DMZ pack has no clip for. SPA clips never replace a DMZ clip.

* `Entity.set_locomotion(state: String, speed := 0.0, blend := 0.18) -> bool` —
  looping movement state; `speed` (m/s) scales the playback rate so walk / run /
  sprint read differently. Re-calling with the same state is free.
* `Entity.play_action(state: String, blend := 0.08) -> bool` — one shot
  (`attack1..3`, `ki_blast`, `technique`, `transform`, `hurt`, `death`, `mine`,
  `eat`, ...). States in `AnimSelect.UPPER_BODY` play on the override layer, so
  the legs keep walking.
* `Entity.clip_for(state) -> String` / `Entity.has_state(state) -> bool` — what
  a state resolves to on this entity ("" when neither pack has anything).
* `PlayerModel.gd` (static helpers): `state_for(snapshot: Dictionary) -> String`
  turns a physics snapshot (`velocity`, `move`, `on_ground`, `in_water`,
  `swimming`, `flying`, `fly_fast`, `sneaking`, `sprinting`, `climbing`,
  `crawling`) into a locomotion state; `drive(entity, snapshot)` picks it and
  plays it; `action(entity, state)`, `punch(entity, combo_index)`,
  `report(entity) -> PackedStringArray` (state -> clip, for debug screens).
  `scripts/player/PlayerAnimator.gd` is the player's thin wrapper over these.

The bone-name remap (`BedrockAnimation.REMAP_SPA`) maps the SPA rig
(`rightArm`, `leftLeg`, `torso`, `body`, `rightItem`, ...) onto the DMZ rig
(`right_arm`, `left_leg`, `body`, `root`, `right_hand_item`, ...);
`BedrockAnimation.load_clips(path, remap := {})` caches per (path, remap).

Entity types are declared in `data/entities.json` (model, texture(s),
animation sets, stats, AI tier, drops, sounds, scale, hitbox). `Npc.gd`
(masters, traders, quest NPCs: talk, train, shop) and `Enemy.gd` (AI: idle →
wander → chase → attack; attack patterns melee combo / ki blast / beam /
barrage / grab; flight; retreat; taunts; boss phases with mid-fight
transformation using the same cinematic as the player).

## 8. Combat, ki, forms (`scripts/combat/`)

`Stats` (RefCounted): `STR, SKP, STM, RES, VIT, PWR, ENE` (ints, raise with
TP), `level()` = 1 + total/5, derived: `max_health = 100 + VIT*10`,
`max_ki = 100 + ENE*8`, `max_stamina = 100 + STM*6`, `melee = 5 + STR*1.2`,
`ki_damage = 5 + PWR*1.4`, `defense = RES*0.9`, `speed_mult`, all ×
race multipliers (data/races.json) × form multipliers (data/forms.json) ×
class passive. TP gained from damage dealt/taken, training stations, quests.

`Techniques.gd`: executes `data/techniques.json` entries: kinds `blast`,
`beam` (charged, held, continuous mesh cylinder with `ki_beam.gdshader`),
`disc`, `barrage`, `explosion`, `buff` (kaioken/solar flare), `grab`. Each
has charge time, ki cost, damage multiplier, animations (DMZ `ki.*_cast`,
`ki.*_fire`), sounds (`ki_kame_charge`/`ki_kame_fire` etc.), color, size.
Projectiles are `scenes/entities/KiBlast.tscn` (moves with voxel raycast each
frame, explodes with `World.explode`).

`Forms.gd`: transformation state machine per entity: `can_transform(form_id)`
(skill level, mastery, ki ≥ cost), `transform(form_id)` → plays the cinematic
(`scripts/fx/TransformationDirector.gd`, fx agent) then applies multipliers,
model swap/scale, hair type/colour, eye colour, aura colour/lightning, drains
ki per second, mastery gains; `revert()`. Form data is converted from DMZ in
`data/forms.json`.

## 9. Quests contract (`scripts/quests/`)

`QuestManager` (Node under World or Game): loads `data/quests/**`, keeps state
in `Game.profile.quests` (`{active: {quest_id: {objectives: [progress...],
spawned: [...]}}, completed: [...], claimed: [...]}`). API:
`available_quests() -> Array`, `can_start(id) -> Dictionary {ok, reasons}`,
`start(id)`, `abandon(id)`, `claim(id)`, `track(id)`, `tracked_quest() -> String`,
`notify_kill(entity_type, entity_node)`, `notify_talk(npc_id)`,
`notify_item(item_id, count)`, `notify_location(pos, biome, planet)`,
`notify_summon(dragon_id)`, `notify_skill(skill_id, level)`.
Objective kinds: `KILL` (with `spawn: "QUEST"` → spawn the enemy near the
player in the required biome with the quest's health/damage scaling and AI
tier, `"NATURAL"` → count world kills), `TALK`, `OBTAIN`, `GO_TO` (biome /
structure / coords), `INTERACT` (block/structure), `SUMMON`, `SKILL`, `TRAIN`
(TP spent), `WAIT`. Requirements: `LEVEL`, `PLANET`, `BIOME`, `STRUCTURE`,
`SAGA_QUEST`, `SKILL`, `ITEM`, `ALIGNMENT`. Rewards: `TPS`, `ITEM`, `SKILL`,
`TECHNIQUE`, `FORM`, `ALIGNMENT`, `UNLOCK_PLANET`.
Sagas are ordered chains (`data/sagas.json`); story quests are the ported
DragonMineZ saga quests, sidequests the ported DMZ sidequests. Quest NPCs are
the DMZ masters placed by structures (Roshi at Kame House, Korin at the tower,
Kami/Dende/Popo at the Lookout, King Kai on his planet, Guru on Namek, Bulma at
Capsule Corp, etc. – see `data/masters.json`).

Dragon balls (`DragonBalls.gd`): 7 per set (earth / namek / super / cereal)
spawned as pickup entities at deterministic seeded positions within
`spawn_range`, radar item shows direction/distance (DMZ radar texture), placing
all 7 (use item on ground) summons the dragon entity (shenron/porunga/
super_shenron/toronbo geo models) → wish UI → reward → balls scatter as stone
for 1 in-game week.

Space travel (`SpaceTravel.gd`): space pod / Capsule Corp ship item → planet
select UI (DMZ spaceshipicons + DMZ+ planet textures) → `Game.change_planet(id)`
which saves the current planet and loads the target planet's world with the
player at the arrival point. Deep-space "orbit" view is a special planet
(`universe_7_deep_space`) with zero gravity, oxygen timer (space suit) and
planet bodies rendered in the sky; flying into a body's marker descends to it.

## 10. UI contract (`scenes/ui/`, `scripts/ui/`)

`UiManager` (CanvasLayer, `Game.ui`): `open(screen: String, args := {})`,
`close(screen)`, `is_modal_open() -> bool`, `toast(title, text, icon_tex)`,
`show_hint(text, seconds)`. Screens: `hud`, `inventory`, `crafting`,
`quests`, `stats` (Xenoverse-style stats/skills/forms/techniques tabs),
`dialog` (NPC), `pause`, `settings`, `death`, `wish`, `space_map`, `character_creation`,
`main_menu`, `world_select`, `loading`. Opening any screen except `hud` sets
`Game.paused_by_ui = true`.

Look & feel: Minecraft-style — `assets/textures/gui/inventory.png` (DMZ-HD)
9-slice panels, `widgets.png` hotbar + buttons, `icons.png` hearts/hunger/armor
rows, `xenoversehud.png` ki/stamina bars, DMZ `menu/*.png`, `quest/*.png`,
`radial/*.png`, `buttons/*.png`, Monocraft font, all textures nearest-filtered
and scaled by `Game.ui_scale()`. Touch HUD layout per
`docs/CUBIC_WORLD_UI_SPEC.md` §1 plus the DBZ buttons: right cluster
`Jump`, `Attack`, `Ki Blast` (tap; hold = charged shot), `Charge Ki` (hold),
`Fly` toggle, `Dash`; left-top `Transform`, `Technique` (opens radial),
`Lock-on`; top-right `Pause`, `Camera`, `Quests`, `Stats`. Hotbar 9 slots
bottom-centre with bag button. Health (hearts), hunger, armor, ki bar, stamina
bar, TP/level, form name, targeted entity health bar, quest tracker (top-left),
crosshair (only in shoulder/first mode), damage numbers (world-space labels).

## 11. Audio contract

`data/audio.json` maps logical sound names to files and BGM contexts to
playlists. DMZ SFX (GPL-3.0 mod assets) are copied verbatim; any missing sound
is synthesized by `tools/gen_sounds.py`. `Audio` autoload handles pooling,
positional playback (`AudioStreamPlayer3D`), loops and BGM cross-fades; the
audio agent adds `scripts/audio/BgmDirector.gd` that picks contexts from
world state (menu, planet, combat proximity, boss, transformation, space).

## 12. Testing & verification (mandatory before you report done)

* Parse/compile check: `tools/godot.sh --headless --path game --quit-after 2 2>&1 | grep -E "SCRIPT ERROR|Parse Error|ERROR"` must print nothing from your files.
* Unit tests: put `tests/test_<topic>.gd` (extends `TestCase` in `tests/TestCase.gd`; `add_node(n)` puts a node in the tree, `tree` is the SceneTree); run all with `tools/run_tests.sh <sandbox-name> [filter]` (runs `tests/TestRunner.tscn`, exit code 1 on failure).
* Visual check: `tools/screenshot.sh <out.png> [--scene res://scenes/xyz.tscn] [--seconds 6] [--args "..."]` renders under Xvfb and saves a PNG you can look at (Read tool). Use it for every visible feature.
* **Run Godot in a private copy** to avoid `.godot/` import races with other agents: `tools/sandbox.sh <your-name>` rsyncs `game/` to `$SANDBOX/<name>/game` and prints the path; run `tools/godot.sh --path <that path>` there. Edit only the real `game/` tree; re-sync before each run.
* Never commit; the integrator commits.

## 13. Content sources & licensing (what you may use)

| Source | Use | License |
|---|---|---|
| Fused Vanilla Texture/Model Pack (Bedrock, by Fused Bolt) – user supplied | block/plant/item textures, colormaps | user-supplied pack; credit author |
| DMZ HD Texturepack 2.1 (ZoneMC) – user supplied | HD entity/armor/gui textures | user-supplied pack; credit author |
| DragonMineZ 2.1.3 (dragonminez team) | quests, sagas, models, animations, sounds, gui, item/block textures, worldgen data | GPL-3.0-or-later (this project is GPL-3.0-or-later; keep CREDITS) |
| DMZ Plus 1.1.6 (Kiziro) – user supplied | planets, dimensions, worldgen, space, super dragon balls, sky textures | GPL-3.0-or-later; Milky Way image CC BY 4.0 ESO/S. Brunier |
| AAA Particles: World (ChloePrime) – user supplied | particle sprite sheets (lightning, explosion, missile boost, fireflies, loot beam) | MIT |
| Complementary Reimagined r5.9.2 – user supplied | **reference only**: study `shaders/lib/atmospherics/sky.glsl`, `colors/*`, `water*`, `clouds` and re-implement the *look* in original Godot shaders. Do not copy their code or textures. | Complementary License (no redistribution of modified code) |
| Monocraft (Idrees Hassan) | UI font | SIL OFL 1.1 |
| Anything else | must be generated procedurally by `tools/*.py` | ours |

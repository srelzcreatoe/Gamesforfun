# Brief: ENTITY & ANIMATION engineer

Read COMMON.md first. Your contract: ARCHITECTURE.md §7, and read §4 (world API you consume), §6, §8, DATA_SCHEMA.md (entities.json, races.json,
forms.json). Assets: Bedrock geometry under game/assets/models/** (verbatim DragonMineZ `.geo.json`: entity/races/human.geo.json,
entity/sagas/saga_raditz.geo.json, entity/master/master_roshi.geo.json, entity/dragon/shenron.geo.json, entity/races/kiaura.geo.json,
entity/raceparts.geo.json (hair/ears/horns/halo parts), armor/*.geo.json), animations under game/assets/animations/**
(entity/races/movement.animation.json: base.idle/walk/run/fly_*/ki_charge/jump/swimming/crouching..., combat.animation.json, ki.animation.json,
transf.animation.json, skp.animation.json, entity/sagas/saga_base.animation.json, entity/master/*.animation.json), textures under
game/assets/textures/entity/** (DMZ 64x64) and game/assets/textures/entity/hd/** (DMZ-HD 1024x1024 at the same relative paths), race layers under
game/assets/textures/entity/races/<race>/ (bodytype_*, faces/*_eye_*, *_nose_*, *_mouth_*, tattoos/, hair.png, hair_base.png), armor layers under
game/assets/textures/armor/. A data engineer concurrently writes game/data/entities.json, races.json, forms.json — code against the schema; use
fixtures in tests if the files are not there yet.

You own: game/scripts/entity/** (Entity.gd, BedrockModel.gd, BedrockAnimation.gd, Molang.gd, RaceSkin.gd, Npc.gd, Enemy.gd, Animal.gd, Dragon.gd,
Pickup.gd, EnemyAI.gd, Spawner.gd, ...), game/scenes/entities/{Enemy,Npc,Animal,Dragon,Pickup,Vehicle}.tscn, game/scenes/entities/ModelPreview.tscn,
game/tests/test_entity_*.gd, test_molang.gd, test_bedrock_*.gd. (KiBlast/KiBeam/KiDisc scenes belong to the combat engineer.)

Deliverables:
1. `Molang.gd`: compile Bedrock Molang strings to RPN once; evaluate per frame with a context Dictionary. Numbers, `+ - * /`, unary minus, parens,
   `math.sin/cos/abs/clamp/lerp/mod/sqrt/floor/pow/min/max/random(a,b)` (degrees like Bedrock), `query.anim_time`, `query.life_time`,
   `query.head_x_rotation`, `query.head_y_rotation`, `query.is_on_ground`, `query.ground_speed`, `query.modified_distance_moved`, `query.is_flying`,
   `variable.*` (default 0), `this`, comparisons, `? :`, `&& ||`. Tests with real expressions from the animation files (grep them, e.g.
   "-query.head_y_rotation*0.5", "math.cos(120-query.anim_time *180) *-7", "10+math.sin(query.anim_time*90*2-120)*-5").
2. `BedrockModel.gd` (Node3D): `load_geo(path_rel) -> bool` (assets/models relative, no extension; `minecraft:geometry[0]`), Node3D per bone (pivot,
   Bedrock rotation order/signs, parent hierarchy, mirror, inflate, per-cube rotation+pivot, box UV and per-face UV forms, texture_width/height
   normalisation — NOT the image size, so HD textures just work), one ArrayMesh per bone, shared StandardMaterial3D (per-pixel shading, nearest
   filter, ALPHA_SCISSOR 0.5, cull disabled for hair/cloth bones), scale 1/16, feet at y=0, model faces −Z (Godot forward) with the right arm on the
   entity's right — verify with a screenshot of entity/races/human + texture races/humansaiyan/bodytype_male_1 (face toward −Z). API:
   `set_texture(tex)`, `set_texture_image(img)`, `set_bone_visible(name, bool)`, `get_bone(name)`, `bones`, `hide_layer_bones([...])`, locators kept.
3. `BedrockAnimation.gd` (Node): `load_clips(path_rel)` (merge files), `play(name, blend := 0.15, loop_override := null, speed := 1.0)`, `stop`,
   `is_playing`, layered channels (full body + upper-body override), keyframes linear + catmullrom (`lerp_mode`), pre/post keys, shorthand, `vector`
   with Molang strings evaluated per frame, position/rotation/scale on top of the rest pose (Bedrock sign conventions — the walk cycle must swing legs
   forward/back correctly, verify visually), loop true/false/"hold_on_last_frame", `animation_length` computed when null, blend-out on transitions,
   `query.anim_time` seconds, head queries from the owner. < 0.1 ms per animated entity; cache compiled expressions; 20 Hz updates beyond 24 m.
4. `RaceSkin.gd`: compose a character texture from `Game.profile.character` (or an NPC def) per DATA_SCHEMA: base body layer for race/gender/body type,
   tint skin_color/2/3 (inspect the actual layer files to learn which are tint masks; document in the file header), eyes/nose/mouth/tattoo parts,
   hair (hair.png/hair_base.png tinted; hair TYPE = visibility sets of raceparts/accesories bones — support ≥ 6 styles + the ssj/ssj2/ssj3 hair types used
   by forms.json `hairType`, approximating with scaled parts if DMZ has no dedicated bones), armor/gi layers from equipped armor
   (assets/textures/armor/<layer>_layer1.png onto armorHead/armorBody/armorRightArm/... bones using the Minecraft armor layer UV convention).
   Returns ImageTexture, cached. Provide `apply_form_visuals(model, form_def)` (hair/eye colour, body tint, scale).
5. `Entity.gd` (Node3D, class_name Entity) per §7: fields, `take_damage` (`dmg * 100 / (100 + defense)`, ki protection hook, i-frames 0.25 s,
   knockback, hit flash, emits Events.entity_damaged), `heal`, `die` (death/faint clip else fall-over tween, fade, free after 1.5 s; drops via Pickup),
   `play_anim`, `face`, `apply_physics(delta)` via `VoxelPhysics.move_aabb` (guard with ResourceLoader.exists; fallback ground plane y=64 for tests),
   gravity 23 × planet gravity, flying hover, water buoyancy, `distance_to_player()`, LOD (no anim > 48 m, no AI > 64 m), `write_state/read_state`.
6. `Enemy.gd` + `EnemyAI.gd`: IDLE → WANDER → CHASE (aggro 24 m or damaged; keep 2 m) → ATTACK (melee combo with hit windows at 40% of the clip,
   damage `stats.melee`; ki blast at 6-20 m every 2-4 s via `Techniques` if `res://scripts/combat/Techniques.gd` exists else a placeholder fast sphere;
   beams for tier ≥ 2 with 1.2 s telegraph) → RETREAT (tier ≥ 2 under 20% hp: fly away, power up) → DEAD. Tier 1 slow windup 0.6 s, tier 2 dodges 30%
   (`base.evasion_*`), tier 3 blocks/counters. Bosses (`bgm: boss`) emit Events.boss_engaged/defeated; `phases`: at 0 hp spawn the next phase entity at
   the same spot with `TransformationDirector.play_for(entity, id)` if it exists, heal to full. Taunt via Events.toast on aggro.
7. `Npc.gd` (idle, looks at the player within 6 m via head queries, `interact(player)` emits Events.dialog_requested(self), carries `master_id`),
   `Animal.gd` (wander/flee/graze; dinos aggressive when hit), `Dragon.gd` (rises 3 s with Events.dragon_summoned, idle, interact -> dialog_requested),
   `Pickup.gd` (floating rotating item icon quad or dragon ball model assets/models/block/dball.geo.json + textures/misc/dball/dball1.png; picked up on
   AABB overlap -> Events.item_picked_up + `Game.player.inventory.add(...)` if present).
8. `Spawner.gd` (Node under World): natural spawning from `Registry.biome(biome).mobs` within sim distance (cap 24, despawn > 96 m, hostiles at night),
   `spawn_quest_enemy(entity_id, pos, stats_override, ai_tier) -> Enemy` for the quest engineer.
9. `ModelPreview.tscn`: `--args "--model=entity/sagas/saga_vegeta --texture=sagas/saga_vegeta --anim=entity/sagas/saga_base --clip=idle [--t=0.4]"`;
   screenshot and LOOK: human base facing camera correctly, walk mid-stride, Vegeta, Frieza forms, Shenron, Roshi, the ki aura model; UVs correct,
   hat/hair layers visible.
10. Tests: Molang, geo parser (human.geo.json: 30 bones, head pivot [0,24,0]), animation sampling (base.walk t=0.25 -> non-zero right_arm rotation),
    damage math, AI transitions with a fake target.

Report the exact Bedrock→Godot axis/sign conventions you settled on (others need them) and performance numbers.

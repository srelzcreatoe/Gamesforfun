# Brief: DATA CONVERSION engineer, part A (story & characters)

Read COMMON.md first. Then game/docs/ARCHITECTURE.md, game/docs/DATA_SCHEMA.md and game/autoload/Registry.gd (how JSON is loaded/validated).

Write the Python converter `tools/convert_dmz_data.py` (checked in, deterministic, re-runnable) that reads the extracted DragonMineZ 2.1.3 mod at
/tmp/claude-0/-home-user-Gamesforfun/a637a6ef-7708-59b3-aeb2-5b4698448421/scratchpad/ex/dmz (GPL-3.0, so its data may be ported) and DMZ Plus at
.../scratchpad/ex/dmzplus, and writes these registries into /home/user/Gamesforfun/game/data/:

1. `data/quests/<category>/<file>.json` — port EVERY quest in `data/dragonminez/previousQuests/quests/saga_*/` (121 story quests) and
   `.../sidequests/<category>/` (90 sidequests). Keep the DMZ structure (id, type, category, requirements, prerequisites, objectives, rewards,
   quest_giver, turn_in, claim_mode, party_scaling, secret) but: resolve `title`/`description` to English text using
   `assets/dragonminez/lang/en_us.json` (keys like dmz.quest.saiyan1.name) into `"name"` and `"desc"`; convert entity ids `dragonminez:saga_raditz`
   -> `saga_raditz` and add `"entity_name"` (English from lang `entity.dragonminez.<id>`); map vanilla mobs used by sidequests: zombie->bandit,
   skeleton->red_ribbon_soldier, spider->sabertooth, creeper->robot1, enderman->robotxv, other hostile->bandit, cow/pig/sheep/chicken->dino1/dinokid;
   convert item ids `dragonminez:x` -> `x`, `minecraft:x` -> `x`; convert requirement DIMENSION to `PLANET` with our planet ids
   (minecraft:overworld->earth, dragonminez:namek->namek, dragonminez:otherworld->otherworld, dragonminez:sacredkaiplanet->sacred_kai_planet,
   dragonminez:time_chamber->time_chamber, dmzplus:*->same id without namespace); keep BIOME requirement values as `quest_tag` strings exactly as in
   DMZ. Quest ids in the registry become `"<category>:<id>"` where category is the folder name (saga_saiyan, saga_frieza, ...; sidequests use
   `sidequest_<folder>`, e.g. `sidequest_training`) — set `"category"` in each file and write files under `data/quests/<category>/` with zero-padded names.
2. `data/sagas.json` — `{"sagas": [...]}` ordered saiyan_saga, frieza_saga, android_saga, future_saga, buu_saga, movies_saga with `id`, `name`
   (English from lang dmz.saga.*), `requirements.previousSaga`, `questFolder`, `"quests"` = ordered quest ids.
3. `data/entities.json` — `{"entities": [...]}`: an entry for EVERY DMZ entity that has a geo model under /home/user/Gamesforfun/game/assets/models/entity/**
   (masters, sagas, animals, enemies, dragons, kinton, spacepod, punchstation, races) plus `player`, `ki_blast`, `ki_beam`, `ki_disc`, `dragon_ball`,
   `item_drop`, `super_shenron`, `toronbo`, `zuno` (models under assets/models/dmzplus/entity/). Fields per DATA_SCHEMA entities.json: id, name (English
   from lang or Title Case), kind (player/enemy/master/npc/animal/dragon/projectile/pickup/vehicle), scene (enemy->res://scenes/entities/Enemy.tscn,
   master/npc->Npc.tscn, animal->Animal.tscn, dragon->Dragon.tscn, projectile->KiBlast.tscn, pickup->Pickup.tscn, vehicle->Vehicle.tscn),
   `model` = path relative to assets/models without extension (e.g. "entity/sagas/saga_raditz"), `texture` = path relative to assets/textures/entity
   without extension (CHECK the file exists; sagas may have suffix variants; race-based entities like saibaman use "races/saibaman"), `hd_texture` = true
   if the same relative path exists under assets/textures/entity/hd/, `animations` = animation files relative to assets/animations without extension
   (masters have their own file; sagas use "entity/sagas/saga_base" plus their own if present; saibamen "entity/sagas/saga_saibaman"; races
   ["entity/races/movement","entity/races/combat","entity/races/ki","entity/races/transf","entity/races/skp"]), `hitbox` [w,h] (from geo
   visible_bounds if sensible, default [0.6,1.8]), `scale`, `stats` {health, melee, ki, defense, speed} — saga enemies: values of the FIRST story quest
   that spawns them (health/meleeDamage/kiDamage), else sensible by tier; `ai_tier` (quest AITier, default 1), `faction` (villain for sagas/enemies,
   z_fighter for allied sagas like saga_goku*/gohan/krillin/piccolo/vegeta_end*/trunks, wild for animals, neutral for masters/npcs), `can_fly`,
   `techniques` (1-3 ids from data/techniques.json that fit: vegeta -> galick_gun, big_bang; frieza -> death_beam, supernova; cell -> kamehameha,
   solar_flare; piccolo -> special_beam_cannon, masenko; goku -> kamehameha, kaioken_attack, spirit_bomb), `phases` (boss transformation chain of
   entity ids, e.g. saga_frieza_first -> [saga_frieza_second, saga_frieza_third, saga_frieza_base] when the quest chain implies it), `drops`
   (senzu/kikono/scouter etc. with chance), `sounds` {hurt, death, attack} from DMZ sound names (golpe1..6, knockback_character, frieza_s_hurt...),
   `bgm` ("boss" for saga bosses), `taunt` (one-line in-character English intro you write), `master` id for masters (see 5).
4. `data/races.json` (`{"races": {...}}` keyed human, saiyan, namekian, frostdemon, majin, bioandroid) from previousConfigs/races/<race>/character.json +
   stats.json: keep character fields (default colours, hair type, headBones, model — map customModel "" to: human/saiyan/namekian -> "entity/races/human",
   frostdemon -> "entity/races/frostdemon", majin -> "entity/races/majin", bioandroid -> "entity/races/bioandroid"), `classes` (from stats.json),
   `form_groups`, `base_stats` (5 each + class base), `stat_multipliers` (saiyan STR/PWR 1.1, namekian regen, frostdemon ki, majin VIT, bioandroid
   balanced, human ENE), `textures` (body/face/hair layer file lists that exist under assets/textures/entity/races/<race>/ — enumerate the directory).
5. `data/forms.json` (`{"forms": {...}}`) flattened as `"<groupName>.<formName>"` from every forms json (races/*/forms/*.json and previousConfigs/forms/*.json).
   Keep ALL original fields, add `name` (English), `race` ("any" for kaioken/ultimate), `group`, `order`, `unlock_tp_cost` (from race
   formSkillsCosts when available, else scaled), `model_override` (customModel -> existing assets/models path: "buffed" -> "entity/races/hbuffed",
   "4arms" -> "entity/races/h4arms", "oozaru" -> "entity/races/oozaru", "frostdemon_third" -> "entity/races/frostdemon_third", "bioandroid_perfect" ->
   "entity/races/bioandroid_perfect", majin_* -> "entity/races/majin", etc. — only files that exist).
6. `data/skills.json` (`{"skills": {...}}`) for every `skill.dragonminez.*` in lang with id (snake_case), name, desc, max_level, tp_costs (geometric from ~500),
   effect object (e.g. fly speed_per_level 0.15), `unlock` (which master teaches it: roshi ki_control/kamehameha basics, korin jump/sprint, kami/popo
   ki_sense/meditation, king_kai kaioken/instant_transmission/spirit_bomb, guru potential_unlock, old_kai ultimate, whis ultra_instinct...).
7. `data/techniques.json` (`{"techniques": {...}}`) for every `technique.dragonminez.*` in lang plus `ki_blast`, `charged_ki_blast`: id, name, kind
   (blast/beam/disc/barrage/explosion/buff/grab/melee), charge (s), ki_cost (0.05..0.6 of max), damage_mult (1..12), cast_anim/fire_anim (names from
   assets/animations/entity/races/ki.animation.json: kameha_cast/kameha_fire, galick_*, finalflash_*, bigbang_*, masenko_*, makkako_*, kienzan_*,
   kienzandoble_*, barrage_*, explosion_*, large_ball_*, solarflare_fire; skp.* for melee specials), charge_sound/fire_sound (files in assets/audio/sfx),
   color (hex), size, speed, duration, unlock, owner_hint.
8. `data/masters.json` (`{"masters": {...}}`) for all 21 master_* entities: id -> entity id, name, structure (roshi_house, korin_tower, kami_lookout,
   goku_house, capsule_corp (Bulma: use `saga_bulma` model), king_kai_planet, elder_guru, gero_lab, babidi_ship, check_in_station (King Yemma),
   old_kai_pillar, cell_arena (Cell), frieza_ship (Frieza), ...), teaches (skill/technique ids), trains (bool), quests (from sidequest quest_giver/turn_in),
   3-6 short in-character dialog lines.
9. `data/wishes.json` (`{"wishes": {...}}`) keyed by dragon (shenron, porunga, super_shenron, toronbo) from DMZ dragonballs/{earth,namek}/definitions/wishes.json
   and DMZ Plus dragonballs/{super,cereal}/definitions/wishes.json with English names/descs (wish.* lang keys), mapped item ids, plus per dragon:
   `entity`, `ball_set`, `wish_count`, `summon_planets`.
10. `data/audio.json` — `{"sfx": {logical -> [files]}, "bgm": {context -> [files]}}` enumerating /home/user/Gamesforfun/game/assets/audio/sfx and bgm.
    Logical SFX: punch (golpe1..6), punch_crit (critico1..2), block (block1..3), parry, evasion, ki_blast (kiblast_shoot), ki_charge_loop, every ki_*
    pair, transform_on/off, aura_start, insta_form_on/off, senzu, shenron, dragonballssound, dragonradar, tp, tp_short, zanzoken, fusion, ship_open,
    landing_ship, ui_menu_switch, confirm_menu, pip_menu, toast_tutorial, switch_on/off, sword_slash..., plus generated: break_<material>,
    place_<material>, step_<material> (3 variants: step_stone_0..2), dig_<material>, click, pop, eat, hurt, fall_damage, splash, swim, bubbles,
    level_up, quest_start, quest_complete, skill_learned, dball_pickup, item_pickup, wish_granted, toast, error, thunder, explosion_big, shockwave,
    whoosh, dash, land, lightning_crack, power_up_burst, block_guard, heal, teleport, scouter_beep, capsule_pop, ship_engine, ambience_*, fly_loop,
    aura_loop. BGM contexts: menu, explore_earth (calm Dragon Ball OST tracks), explore_namek (bgm_namek + a few), battle (bgm_battle + energetic),
    boss (bgm_boss + ...), transformation, space, otherworld, heaven, hell, time_chamber — use lang keys `item.dragonminez.music_disc_menu_music_N`
    (OST titles) to sort tracks into calm vs battle.

Rules: ids consistent across files (entities used by quests exist; skills/techniques used by masters/forms exist); referenced textures/models MUST exist
(verify with os.path.exists; print substitutions). Do not modify blocks.json, items.json, recipes.json, biomes.json, planets.json, structures.json
(another engineer owns those; use DMZ item ids without namespace and vanilla ids as-is). After writing, run the converter, validate JSON with python,
then run `cd /home/user/Gamesforfun && tools/godot.sh --headless --path game --quit-after 3 2>&1 | grep -E "Registry|SCRIPT ERROR|\[E\]" | head -40`
(unknown-item warnings are expected until part B lands; unknown ENTITY references are yours). Report counts per file, substitutions, and unported data.

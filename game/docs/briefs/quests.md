# Brief: QUESTS, STORY, DRAGON BALLS & SPACE TRAVEL engineer

Read COMMON.md first. Your contract: ARCHITECTURE.md §9; also §3, §7, §8, §10; DATA_SCHEMA.md (quests, sagas, masters, wishes, planets travel,
Profile.quests). Data: game/data/quests/**, sagas.json, masters.json, wishes.json, entities.json, planets.json, structures.json (ported from
DragonMineZ). Read the entity engineer's Spawner.gd (`spawn_quest_enemy`), Npc.gd (`interact`, `master_id`, Events.dialog_requested), Enemy.gd
(`phases`, Events.entity_died), the UI engineer's UiManager/Dialog/QuestLog/WishScreen/SpaceMap APIs (`Game.ui.open(...)`), the worldgen engineer's
DragonBallPlacement.gd and `structure_marks`, and Game.gd (`change_planet`, profile).

You own: game/scripts/quests/** (QuestManager.gd, SagaManager.gd, Objectives.gd, Requirements.gd, Rewards.gd, DialogController.gd (drives NPC
conversations: master dialog lines, Talk/Train/Quests/Shop options, quest give/turn-in, teaching skills/techniques for TP), DragonBalls.gd (per-set
found state, pickup, radar direction/distance for the HUD, summoning ritual when 7 balls are placed on a `dragon_ball_altar` or dropped together:
sky darkens (SkyController `override_darkness` if present), `shenron` sound, dragon entity rises, WishScreen, reward, scatter as new positions for one
in-game week), SpaceTravel.gd (space pod / Capsule Corp ship / nimbus items: SpaceMap open, unlock rules from planets.json travel + quest flags,
`Game.change_planet` with arrival point, deep-space mode: zero-g flight, oxygen timer without a space suit, planet markers (`Events` + HUD compass),
descend when within 24 m of a body marker), StoryFlags.gd), game/scenes/entities/DragonBallAltar? (block interaction is via Interaction ->
`Game.world.get_node("QuestManager")`), game/tests/test_quests_*.gd.

Deliverables:
1. `QuestManager` (Node named "QuestManager" added under the World by `World.start` if the script exists — coordinate: if the voxel engineer's World
   does not add it, add yourself from `Events.world_loaded`): full API of §9; persistent state in `Game.profile.quests`; requirement evaluation
   (LEVEL from Stats.level(), PLANET, BIOME via `World.get_biome` + biomes.json quest_tag, STRUCTURE via structure_marks, SAGA_QUEST, SKILL, ITEM,
   ALIGNMENT); objectives (KILL with `spawn: QUEST` -> spawn the entity 12-20 m from the player in the required biome (search nearby columns for a
   matching biome, else at the player) with the quest's health/melee/ki override and AITier via `Spawner.spawn_quest_enemy`, track its death by
   instance; NATURAL kills counted from Events.entity_died; TALK via Events.dialog_closed/npc id; OBTAIN via inventory counts; GO_TO; INTERACT;
   SUMMON via Events.dragon_summoned; SKILL via Events.skill_changed; WAIT timers), `parallel_objectives`, failure when the player dies during a KILL
   objective (quest restart), rewards (TPS -> `Game.player.stats.add_tp` or profile tp, ITEM -> inventory, SKILL/TECHNIQUE/FORM unlocks, ALIGNMENT,
   UNLOCK_PLANET), `claim_mode` TREE_OR_NPC, toasts + sounds (quest_start/quest_complete), tracker updates.
2. `SagaManager`: saga order/unlock (`requirements.previousSaga`), `next_story_quest()`, auto-track the next story quest, Events.saga_completed with a
   celebratory toast; boss BGM via `Audio.play_bgm("boss")` on Events.boss_engaged and back to explore on defeat.
3. `DialogController`: on Events.dialog_requested(npc) -> `Game.ui.open("dialog", {...})` with lines from masters.json, options: Talk (rotating lines),
   Train (opens StatsScreen or a training dialog spending TP on the master's `teaches` list: skills/techniques with costs), Quests (list of quests this
   master gives/turns in with Start/Turn in), Shop (traders: buy/sell with a simple currency? DMZ has none — use item barter: senzu for kikono etc.,
   optional), Leave. Bulma handles space travel unlock quests.
4. `DragonBalls`: as above; radar item use shows a HUD overlay (arrow + distance + star count) using gui/radar.png / dmzplus super_radar.png (ask the
   UI via `Game.ui.open("radar")` if it exists else draw a simple CanvasLayer yourself); Events.dragon_ball_found; dragon summon + wishes (wishes.json
   types: item, tps, form, reset, recustomize, revive (full heal + respawn point), planet unlock); Super Dragon Balls in deep space; Porunga grants 3
   wishes with the Namekian language gate skipped.
5. `SpaceTravel`: item use (space_pod / saiyan ship / capsule corp ship) -> SpaceMap; launch cinematic (ship model `entity/spacepod` from
   assets/models if available rising with `ui_nave_takeoff` sound, fade to black) -> `Game.change_planet(id, arrival)`; arrival: landing crater
   structure is stamped by worldgen at the planet spawn; deep space flight mode (player `is_flying` forced, zero gravity from planet data, oxygen timer
   unless wearing the space_suit set -> damage), planet marker compass (Events.hint with direction), descending into a planet when near its marker.
   Quest `travel_requested` support for "Head to Namek".
6. Tests: requirement evaluation with fixture profiles, objective progress/completion, reward application, saga unlock order (full chain saiyan ->
   frieza -> android -> future/buu -> movies), dragon ball found/summon state machine, travel unlock rules.
7. Verify in-game: `tools/screenshot.sh ... --sandbox quests --seconds 15 --args "--autoplay=99 --quest=saga_saiyan:1"` — add handling in QuestManager
   for a `--quest=<id>` user arg that force-starts the quest at spawn so Raditz spawns; LOOK at the screenshot (Raditz visible, tracker on HUD).

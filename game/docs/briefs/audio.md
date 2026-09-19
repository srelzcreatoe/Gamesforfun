# Brief: AUDIO DIRECTOR engineer (small)

Read COMMON.md first. Contract: ARCHITECTURE.md §11 and game/autoload/Audio.gd, game/data/audio.json.
You own: game/scripts/audio/BgmDirector.gd (Node added by World.start if the script exists, else self-attach on Events.world_loaded), Footsteps.gd
(helper mapping block material -> step sound with pitch variation), Ambience.gd (biome/planet ambience loops on the "Ambience" bus: wind on
plains/mountains, ocean near water, cave underground (sky light 0), rain during weather, space hum, hell rumble, heaven choir — cross-fade by listener
position), game/tests/test_audio.gd.
BgmDirector picks contexts from world state: menu handled by Main; in-world: planet music (planets.json `music`), `battle` when a hostile enemy is
within 20 m and aggroed (Events.entity_damaged / boss_engaged), `boss` on Events.boss_engaged until boss_defeated, `transformation` during
Events.transformation_started..finished (then restore), `space` in deep space, `otherworld`, `heaven`, `hell`, `time_chamber`; hysteresis (no
flip-flopping: 8 s minimum per context, 3 s fade), volume ducking during dialogs. Also play UI sounds on Events.ui_opened/closed (ui_menu_switch),
quest_start/quest_complete on the quest events, level_up on Events.level_up, toast on Events.toast, item_pickup/dball_pickup on pickups. Verify with a
headless run (`--autoplay`) that no "Missing audio" warnings appear for the sounds you reference (grep the log). Tests: context decision function with
fake states.

# Feature Verification Matrix

Status key:
* **✅ Runtime** — exercised on Bedrock Dedicated Server 1.26.52.3 and asserted by an automated check (`[OTEST]` name given).
* **✅ Static** — verified by the official JSON schemas, cross-reference validator, type-checker, or offline FK renders.
* **🟡 Server-side ✅ / client ❔** — server logic verified at runtime; how it looks/sounds in a client is unverified.
* **⚪ Implemented, not asserted** — code reviewed and exercised indirectly, no dedicated assertion.

Test sources: `tests/bds/testkit_BP/scripts/suite.js` (integration suite), `proto.js` (capability probes),
`speed.js` (movement calibration), restart scenarios, `tools/validate.mjs`, `tools/integrate_supplied_assets.py`.

## Supplied model and animation integration
| Feature | Implementation | Trigger | Expected result | Test | Status |
|---|---|---|---|---|---|
| Supplied geometry integrated unchanged | `RP/models/entity/the_observer.geo.json`, `tools/integrate_supplied_assets.py` | build | identical bones/cubes/UVs, namespaced id | integration script assertions; validator (geometry/bone cross-refs) | ✅ Static; client render ❔ |
| Supplied texture | `RP/textures/entity/observer/the_observer.png` | build | byte-identical | SHA-256 check | ✅ Static |
| 5 supplied clips mapped to states | `RP/animations/the_observer.animation.json`, `animation_controllers/…`, `entity/…` | `observer:state` | idle/staring/pose/running/attack play per state | validator (all bones exist, controller states/short names resolve) | 🟡 Static ✅ / client ❔ |
| 5 supplemental clips | `tools/make_supplemental_anims.py`, `the_observer_supplemental.animation.json` | states walk/peek/recoil, stoop, head tracking | grounded walk, 2.81-block stoop | FK renders `docs/media/animation_states.png`, `stalk_walk.gif`; FK height report | 🟡 Static ✅ / client ❔ |
| Rotation convention | `tools/render_model.py` | — | renders match supplied previews | visual comparison with `dweller_preview.png`, `dweller_turnaround.png` | ✅ Static |
| Entity loads cleanly | `BP/entities/the_observer.json` | world load | no content-log errors | `load.txt` scenario (0 errors) | ✅ Runtime |
| State/stoop/side properties sync | `observer/body.js` | script | property values next tick | `set_get_property` | ✅ Runtime |
| Auto-stoop under low ceilings | `body.maintain` | headroom < 5 | `observer:stoop` true in 3-high tunnel | `closed_path_*_stooped_in_tunnel` | ✅ Runtime (visual ❔) |
| Modes & calibrated speeds | entity component groups | `setMode` | creep ≈1.5, pursue ≈4.6–4.8 | `approach_mode_moves_closer`, `pursue_mode_speed`, speed calibration, `pursuit_runs` (4.6 b/s), `pursuit_watched_slow` (1.45–1.49 b/s) | ✅ Runtime |
| Walking away | `body.withdraw` (scripted, validated steps) | end of an encounter | walks away from watchers, removed once unseen | `withdraw_walks_away` (10.6 blocks while watched), `withdraw_removed`. The vanilla `avoid_mob_type` retreat goal **failed** its probe (`retreat_mode_moves_away`) and is no longer used | ✅ Runtime (walk visual ❔) |
| Still mode floats (no gravity) | `observer:still` | spawn | stays at placed height | `still_mode_no_gravity`, `water_stands_on_surface` | ✅ Runtime |
| Damage immunity; hit reaction | entity `damage_sensor`, `items.js` | player hits it | health unchanged; recoil/withdraw | `hit_event_immune` | ✅ Runtime |
| Telegraphed strike synced to clip | `body.strike` | contact | damage at 0.6 s, capped, never lethal from > 50 % health | `pursuit_struck`, `pursuit_damage_nonlethal`, `closed_path_struck_*` (damage measured from hurt events) | ✅ Runtime |
| Glowing eyes | `render_controllers` eyes layer (ignore_lighting), `observer:dark`, `eye_glow` at locators `eye_1`/`eye_2` | always (layer); night or light ≤ 7 (glow) | eyes full-bright; glow at night | `eyes_glow_at_night`, `eyes_dim_at_noon` (property); vanilla-shape check | 🟡 Server ✅ / visual ❔ |
| Wisp aura (user-supplied sprites) | `particles/wisp.json`, aura controller | while shown | glowing wisps head to toe | vanilla-shape check; atlas built pixel-for-pixel | ✅ Static; visual ❔ |
| Vanish burst (user-supplied sprites) | `particles/vanish.json`, `body.despawn` | every removal | crimson shreds + rip sound | `vanish_effect_on_removal`, `lunge_tore_apart`, `showcase_ends_in_vanish` | 🟡 Server ✅ / visual ❔ |
| Its own sounds | `sounds.json` ambient, `observer.voice/presence/notice/shriek/vanish` | near it / arrival / seen / lunge / removal | heard in game | validator (files resolve), spectrogram and level check of each new file | 🟡 Static ✅ / audio ❔ |
| Peeks from cover | `body.maintain` auto-peek, `space.coverSide` | cover on one side | leans out; stands normally without cover | `auto_peek_leans_out`, `auto_peek_stands_without_cover` | ✅ Runtime (lean visual ❔) |
| Sounds on animation states | controller `sound_effects` | attack/recoil | wind-up / cloth | validator (effects resolve, string form) | 🟡 Static ✅ / audio ❔ |
| Client loads the entity files | `RP/entity`, `animation_controllers` | world load in a client | no content-log errors | `tools/check_vanilla_shapes.py` against Mojang's vanilla RP (0 mismatches). The first client load reported 3 errors (object `sound_effects`, empty `animations` list); both fixed | ✅ Static; client re-check ❔ |

## Presence and stalking
| Feature | Implementation | Trigger | Expected result | Test | Status |
|---|---|---|---|---|---|
| Valid placement only | `world/space.js` | every placement | solid ground, headroom, not in rock | `distant_watch_valid_ground`, `elevated_valid_ground` | ✅ Runtime |
| Deferral instead of forcing | `director.run` / `prepare` | no valid spot | outcome `deferred`, nothing spawned | observed in natural run (`borrowed_sound` deferred) | ✅ Runtime |
| Edge-of-attention, partly concealed | `distant_watch` | encounter | 12–48 blocks, peripheral | `distant_watch_distance`, `distant_watch_state` | ✅ Runtime |
| Withdraws out of sight | `body.withdraw` | after noticed / timeout | body removed | `distant_watch_withdrew`, `unnoticed_body_removed`, `withdraw_removed` | ✅ Runtime |
| Standing on water; sinks | `distant_watch` (water), `common.sink`, `space.standAt` (explicit surface scan) | player in water | body on water surface; sinks when seen | `water_stands_on_surface`, `water_sank` | ✅ Runtime |
| Below an elevated player | `distant_watch` (below) | player >12 blocks up | body on ground ≥12 below | `elevated_below` | ✅ Runtime |
| Caves / tunnels | `findSpot` yMode near | underground | spawns at tunnel level | `closed_path_*_arrived_ahead` | ✅ Runtime |
| Nether | all | player in Nether | valid Nether placement | `dimension_nether_body` | ✅ Runtime |
| Arrives unseen | `common.arriveUnseen` | echo/closed path | appears only when spot unwatched | `echo_ahead_arrived`, `closed_path_*_arrived_ahead` | ✅ Runtime |
| Dimension change aborts & follows | `main.js`, `portal_follow` | dimension change | abort, body removed, follow-up later | `dimension_abort`, `dimension_body_removed`, `dimension_follow`, `dimension_elsewhere_too` | ✅ Runtime |
| Restart mid-encounter | `recoverInterrupted`, `body.registerEvents` | server restart | stray body removed; changes restored | `interrupt_*`, `recovery_no_stray_bodies`, `recovery_veil_restored` | ✅ Runtime |
| Disconnect / rejoin state | `core/state.js`, `main.js` | player leaves | state saved at the moment of leaving (and every 5 s); fog/tag cleared on rejoin | saves exercised every run; reconnect not simulated | ⚪ |

## Director and progression
| Feature | Implementation | Trigger | Expected result | Test | Status |
|---|---|---|---|---|---|
| Grace period → stage 1, onboarding line | `director.ready` | play time | stage 1 after grace | trace "grace period over" in natural/TPS runs | ✅ Runtime |
| Natural scheduling & context selection | `director.tick` | timer | encounters start unforced | `natural_director_started_encounters`; TPS run started 2 | ✅ Runtime |
| Cooldowns, quiet periods, recovery, anti-repetition, tension, deferral back-off | `director.finish`, `eligibleWeight` | after encounters | spacing per DESIGN §9 | exercised in every run, rules not individually asserted | ⚪ |
| Multiplayer fairness / one body | `director.tick`, `start` | several players | longest-waiting eligible player first; ineligible players never block others; single body | `mp_fairness_survival_served` (two creative players who waited longer do not block a survival player); `second_witness` with 2 players | ✅ Runtime (ordering among several eligible players ⚪) |
| Stage gating | `eligibleWeight` | stage | tiers unlock by stage | forced triggers bypass; natural run at stage 3 | ⚪ |
| Exposure → stage advancement | `discoveries.expose` | encounter end | stage rises with exposure | `/observer:status` output | ⚪ |
| Death recovery | `director.onDeath` | player death | abort + 5 min recovery | — | ⚪ |
| Discoveries recorded | `discoveries.discover` | noticing/answering | page + Vestige | 20 of 22 asserted (not asserted: someone_was_home, the_window): the_figure, out_of_step, quiet_feet, put_back, small_likeness, something_facing, the_door, lights_out, light_it_doesnt_make, held_gaze, behind_left, borrowed_work, echo_ahead, wrong_way, breathing_room, second_witness, while_you_slept, elsewhere_too, close, through_the_lens | ✅ Runtime |
| First discovery gives Field Notes + Vestige | `discoveries.discover` | first page | items in inventory | `first_discovery_gives_notes_and_vestige` | ✅ Runtime |

## Encounters (19 + the lunge reaction)
| Encounter | File | Branches asserted | Status |
|---|---|---|---|
| The Figure at the Edge | `distant_watch.js` | noticed, unnoticed (+trace), water, elevated, Nether | ✅ Runtime |
| ★ Out of Step | `extra_step.js` | turn → glimpse; sneak → falters | ✅ Runtime (ignore/close-in branch ⚪) |
| ★ Someone Was Home | `home_visit.js` | staging (door, lights, turn, effigy), effigy → Vestige, put back → restores rest | ✅ Runtime |
| ★ The Closed Path | `closed_path.js` | escape through veil, held gaze, light, strike, aggression-0 contact | ✅ Runtime |
| Borrowed Work | `borrowed_sound.js` | source unoccupied, investigated | ✅ Runtime |
| Something Facing You | `turned_object.js` | turned, unnoticed + restored, noticed | ✅ Runtime |
| The Door | `door_ajar.js` | toggled, closed by player, player change kept | ✅ Runtime |
| Lights Out | `snuffed_lights.js` | snuffed, no drops, relit, restored | ✅ Runtime |
| Always the Same Place | `mirror_bearing.js` | behind-left/right placement, three catches | ✅ Runtime |
| Echo Ahead | `echo_ahead.js` | cue, unseen arrival ahead, noticed | ✅ Runtime (denied branch ⚪) |
| The Path Changed | `unfamiliar_route.js` | mimic behind, natural look, no dupes, cleared; carve at level 3 + restored | ✅ Runtime |
| Close | `close_breath.js` | placed behind, faced | ✅ Runtime (unaware branch ⚪) |
| Closer Each Time | `creeping.js` | frozen while watched, closer when unwatched, stared down, reaches and strikes (non-lethal) | ✅ Runtime |
| Lunge (on being seen, stage 3+) | `common.lunge` | charges from ~28 to ~3 blocks, tears apart, no damage below High | ✅ Runtime |
| Breathing Room (pursuit) | `pursuit.js` | in view, response window, runs, slows when watched, strike, water escape | ✅ Runtime |
| At the Window | `window_watch.js` | outside the house, noticed | ✅ Runtime |
| Second Witness | `second_witness.js` | witness sees, both see | ✅ Runtime |
| While You Slept | `night_visit.js` | staging, answered | ✅ Runtime (sleep trigger itself ⚪) |
| It Came Through | `portal_follow.js` | follow-up after dimension change | ✅ Runtime |
| The Vigil | `vigil.js` | three rounds found, Witnessed, Observer's Eye reward, changes restored | ✅ Runtime |

## Environmental manipulation and safety
| Feature | Implementation | Trigger | Expected result | Test | Status |
|---|---|---|---|---|---|
| M1 doors (linked halves) | `manipulate.toggleOpenable` | door/home/night | open_bit toggled, halves consistent | `door_ajar_toggled`, `door_ajar_upper_consistent` | ✅ Runtime |
| M2 lights | `snuffLight` | lights out etc. | removed/extinguished, restored | `snuffed_lights_*`, `home_visit_restored_lights` | ✅ Runtime |
| M3 turned objects | `turnToward` | turned object | cardinal direction faces player | `turned_object_*` | ✅ Runtime |
| M4 Veil | `placeVeil` | closed path, vigil | cross-section sealed, cleared | `closed_path_*_sealed`, `*_veil_cleared` | ✅ Runtime |
| M5 mimic route | `placeMimic` | path changed | natural-looking blocks behind | `unfamiliar_route_*` | ✅ Runtime |
| M6 effigy | `placeEffigy` | home/close/borrowed/night | effigy placed facing player | `home_visit_effigy_placed` | ✅ Runtime (model visual ❔) |
| M7 carve | `carve` | path changed at level 3 | opening in a wall face beside the path (not the floor), restored | `carve_opening_made`, `carve_restored` | ✅ Runtime |
| M8 animals turn | `animalsFace` | distant watch / dev hook | animals face the spot | `animals_face_it` | ✅ Runtime |
| Ledger: player change wins | `ledger.restore/scan` | player alters block | no later overwrite | `door_ajar_player_change_kept` | ✅ Runtime |
| Ledger: no drops / no duplication | `ledger` break handler | mining Observer blocks | cancelled, removed, no items | `break_cancel_no_drop`, `*_no_drops`, `unfamiliar_route_no_dupes`, `home_visit_no_item_drop` | ✅ Runtime |
| Ledger persists across restart | `ledger.save/load` | restart | restoration continues | `recovery_veil_restored` | ✅ Runtime |
| Never builds on anyone | `ledger.occupied` | veil/mimic/effigy placement, carve restore | occupied cells skipped / restore waits | `seal_occupied_friend_free` (a second player standing in the seal cross-section is left free) | ✅ Runtime |
| No gravity-block mimics | `MIMIC_AS` | path changed on sand/gravel | sandstone/andesite instead | code review | ⚪ |
| Ward Lantern protection | `space.isWarded`, `items` | ward placed | no changes within 12 blocks | `ward_placed`, `ward_protects_door`, `ward_no_ledger_change` | ✅ Runtime |
| Manipulation Off | `manip()` | setting 0 | no block changes | `manip_off_*` | ✅ Runtime |
| Allow-listed vanilla IDs | `core/constants.js` | — | all 141 exist in vanilla 1.26.52 | validator | ✅ Static |

## Tools, UI, settings, accessibility
| Feature | Implementation | Trigger | Expected result | Test | Status |
|---|---|---|---|---|---|
| Config Wheel item | `items/config_wheel.json`, `ui/wheel.js` | first join (only player / operator), or crafting | wheel in inventory; menu opens on use | `wheel_given_to_first_player`; menu itself needs a client (simulated players have no UI) | ✅ Runtime (menu ❔) |
| See it now (preview) | `encounters/showcase.js` | Config Wheel | appears in front, shows all 8 states, harmless, works in Creative | `showcase_body`, `showcase_in_front`, `showcase_all_states`, `showcase_outcome`, `showcase_harmless` | ✅ Runtime (visual ❔) |
| Encounter toggles | `settings.off`, `director.eligibleWeight`, `tryManual` | Config Wheel | switched-off types never chosen | `toggles_only_enabled_type` | ✅ Runtime |
| Start it now | `wheel.startNow` | Config Wheel | grace skipped, encounter within ~1 min | — (same state change as the tested `skipgrace` dev command) | ⚪ |
| Witness Lens | `items.useLens` | use while looking at it | recoil, discovery, withdrawal; 20 s cooldown | `lens_recoil`, `lens_discovery` | ✅ Runtime |
| Tally Chalk smudge | `items.useChalk`, `smudgeNear` | change within 4 blocks of a mark | smudge + message | `chalk_smudged_by_change` | ✅ Runtime (mark particles ❔) |
| Items / blocks / recipes load | BP items, blocks, recipes | world load | no errors | `load.txt` (0 errors) | ✅ Runtime (crafting UI ❔) |
| Field Notes / settings forms | `ui/forms.js` | item use / command | forms open | — (simulated players have no UI) | ⚪ client ❔ |
| Presets & settings | `core/settings.js` | command/form | values applied | used throughout (`preset`, `set`) | ✅ Runtime |
| Aggression 0 = no damage | `strikeDamage`, closed path | contact | blackout, hp unchanged | `aggression_zero_contact_no_damage` | ✅ Runtime |
| Peaceful forces aggression 0 | `settings.aggression` | difficulty | no damage | — | ⚪ |
| Captions | `encounter.caption`, `captionsOn` | critical cues | action-bar text | — | ⚪ client ❔ |
| Camera fade / shake gating | `encounter.fade/shake` | contact moments | only with camera setting | `camera_fade_api`, `camerashake_command` (APIs accepted) | 🟡 |
| Personal fog | `encounter.fog` | closed path, pursuit, vigil | `/fog` push/remove | `fog_command` | 🟡 |
| Dev commands & event channel | `dev/commands.js`, `util.emit` | `/scriptevent observer:*` | responses, events | used by every test | ✅ Runtime |

## Performance
| Measure | Result | Test |
|---|---|---|
| Server tick rate, 180 s walking player, director active (2 encounters ran) | 20.00 mean / 19.99 min TPS — identical to the add-on-free baseline (20.00 / 19.99) | `tps.txt` with and without `--no-addon` |
| No content-log or script errors during full suite | 0 errors (final run: 193/193 assertions, min 19.9 TPS between tests) | `run_bds.py` summary |

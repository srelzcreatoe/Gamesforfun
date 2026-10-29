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
| Peeks from cover — only from cover | `body.maintain` auto-peek, `body.spawn` (a peek without cover becomes a stance), `space.coverSide`, `preferCover` spot scoring | cover on one side | leans out; never peeks with nothing beside it | `auto_peek_leans_out`, `auto_peek_stands_without_cover`, `test_peek_needs_cover`, `showcase_no_peek_without_cover` | ✅ Runtime (lean visual ❔) |
| Relentless attack | `common.relentless`, `body.strike` (cap only on Low) | it reaches the player (chase, Closed Path, Closer Each Time, The Strike, High-aggression lunge) | telegraphed strikes until death; Witness Lens / a blow drives it off; Low = one capped strike | `relentless_keeps_striking` (3 hits, 18 damage), `relentless_full_strength`, `relentless_lens_drives_it_off`; Low single strike: `*_struck_*`, `*_nonlethal` | ✅ Runtime |
| Faster chase | entity `pursue` 1.30, `approach` 0.85 | chase | ~6.4 b/s running, ~2.8 b/s while watched | `pursuit_runs` (6.35 b/s), `pursuit_watched_slow` (2.80 b/s) | ✅ Runtime |
| Too close | `director.nearCheck` / `reactNear` | a player within 4–8 blocks (varies) | tears apart after a short random moment; sometimes strikes once (stage 2+, ~30 %, ≤ every 75 s) | `near_vanish_quickly` (14 ticks), `near_vanish_effect`, `near_strike_struck`, `near_strike_then_gone` | ✅ Runtime |
| Taiga shadows | `observer/illusions.js`, `observer:shadow` | in taiga biomes | far-off staring shadow; gone the instant it is looked at, with `ambient.cave` | `illusion_shadow_placed`, `illusion_far_off`, `illusion_vanishes_when_seen` (4 ticks), `illusion_no_burst`, `illusion_in_taiga`, `illusion_none_outside_taiga` (frozen ocean) | 🟡 Server ✅ / visual and sound ❔ |
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
| Lunge (on being seen, stage 2+, own 5/10-min cooldown) | `common.lunge` | charges from ~28 to ~3 blocks, tears apart, no damage below High (High: keeps attacking) | ✅ Runtime (chance/cooldown values not asserted) |
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
| Test-only behaviours | `encounters/tests.js` (strike, lunge, peek), `vigil.js` practice mode | Config Wheel → Test an encounter | each runs on demand, counts for nothing; practice vigil gives no Eye and records nothing | `test_strike_outcome`, `test_strike_nonlethal`, `test_lunge_outcome`, `test_peek_leans_out`, `test_peek_outcome`, `vigil_practice_outcome`, `vigil_practice_no_reward` | ✅ Runtime |
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

## 1.0.5: the Flare, escape learning, the silence, its pages, signs, inside, borrowed eyes, returns
| Feature | Implementation | Trigger | Expected result | Test | Status |
|---|---|---|---|---|---|
| Flare thrown and lit | `progression/flare.js`, `BP/items/flare.json`, `BP/entities/flare.json`, `RP/entity/flare.entity.json`, `RP/particles/flare.json` | use the item | flies (projectile), lights where it lands with a light block (level 15), one item used up | `flare_thrown`, `flare_flies`, `flare_lights_where_it_lands`, `flare_real_light`, `flare_used_up` | ✅ Runtime (sprite, glare particle and sounds ❔) |
| Flare drives it off | `flare.tick`, `main.js` `onFlared`, `director.cleanup` | burning flare within 16 blocks of the body | recoil, tears apart, outcome `flared` | `flare_drives_it_off`, `flare_tears_it_apart` | ✅ Runtime |
| Flare mid-attack | `body.strike` (`repelled`), `common.relentless` (`enc.check()`) | flare during the relentless attack | attack ends, a winding-up strike does no damage | `flare_mid_attack_ends_it`, `flare_mid_attack_no_damage_after` | ✅ Runtime |
| Flare burns out | `flare.burnOut`, ledger kind `flare` | 8 s after lighting | light block and entity removed | `flare_burns_out_light_goes`, `flare_entity_removed` | ✅ Runtime |
| Flare recipe | `BP/recipes/flare.json` | crafting table | glowstone dust + gunpowder + paper → 8 | loads without errors (`noexp.txt`, suite) | ✅ Runtime load (crafting UI ❔) |
| Escape learning | `observer/learn.js`, `director.finish` | a dangerous encounter ends by light/water/gaze/lens/hit/outrun/veil/flare | adapts after 3 uses, one way at a time, wears off; written in the notes | `learning_needs_three`, `learning_adapts_after_three`, `learning_written_in_notes`, `learning_one_at_a_time`, `learning_counts_real_escapes`, `learning_switch_off` | ✅ Runtime |
| Learned: flare / lens / hit | `learn.shrug`, `main.js` hooks | first repel of that kind in an encounter | only a flinch; the second works | `learning_flare_flinch_only`, `learning_second_flare_works` (lens/hit share the same code path) | ✅ Runtime (flare) / ⚪ (lens, hit) |
| Learned: light | `creeping.js`, `pursuit.js`, `closed_path.js` | adapted to light | lights near the player put out first; +2 light levels, 1.5× longer | `learning_light_snuffs_first` | ✅ Runtime (thresholds ⚪) |
| Learned: water / gaze / outrun / veil | `pursuit.js`, `creeping.js`, `closed_path.js`, `common.relentless` | adapted | waits at the shore / comes from behind / follows further / seals twice | — | ⚪ Implemented, not asserted |
| The world goes quiet | `observer/hush.js`, `director.tick`, `releaseHushes` | stage 4+, director picks pursuit / closed path / creeping | per-player music replaced by a near-silent track for 20–30 s, then the encounter; silence ends with it | `hush_before_attack`, `hush_music_call_ok`, `hush_then_it_comes`, `hush_ends_with_encounter` | ✅ Runtime (what the client hears ❔) |
| Silence: false alarms, switch | `hush.begin` | one in four / setting off | silence then nothing / no silence | `hush_false_alarm`, `hush_switch_off` | ✅ Runtime |
| Pages you didn't write | `observer/pages.js`, `memory.js` tallies, `ui/forms.js` | stage 2+, at most one per in-game day | a page quoting real tracked numbers; scrawl sound; Field Notes list | `pages_quote_real_numbers`, `pages_arrive_on_their_own`, `pages_not_more_than_daily`, `pages_switch_off` | ✅ Runtime (form ❔) |
| Signs | `encounters/sign.js` | stage 3+, near home | waxed standing sign by the door/bed, unseen; no drop when broken; gone after 20 min | `sign_placed`, `sign_block_and_text`, `sign_waxed`, `sign_by_door`, `sign_break_no_drop`, `sign_lasts_then_goes` | ✅ Runtime (rendered text ❔) |
| It's inside | `encounters/inside.js` | stage 4+, night, at home indoors | in the dark room, out of view; leaves when stared at 2 s or when the room is lit | `inside_body`, `inside_in_the_dark_room`, `inside_leaves_when_stared_at`, `inside_discovery`, `inside_leaves_when_lit` | ✅ Runtime |
| Borrowed eyes | `encounters/borrowed_eyes.js` | stage 2+, a creature ahead | it stands still and its head follows the player, then lets go | `borrowed_host`, `borrowed_follows_with_its_head`, `borrowed_stands_still`, `borrowed_lets_go` | ✅ Runtime (head pose ❔) |
| Returns what you threw away | `observer/returns.js` | stage 2+, item dropped far from home, player home | the same item entity moved outside the door, a knock; once per in-game day | `returns_sees_thrown_item`, `returns_to_doorstep`, `returns_same_item_no_copy`, `returns_once_a_day` | ✅ Runtime |
| New settings | `core/settings.js` `FEATURE_TOGGLES`, `ui/forms.js` | settings form | on by default, older worlds get them on | `learning_switch_off`, `hush_switch_off`, `pages_switch_off` | ✅ Runtime (form ❔) |
| No experiments | manifests (`@minecraft/server` 2.10.0, `@minecraft/server-ui` 2.2.0), all JSON | fresh world, every experiment off, no test kit | scripts run, entities/items/recipes load, 0 errors | `noexp.txt` with `--require-no-experiments` | ✅ Runtime |

## Performance
| Measure | Result | Test |
|---|---|---|
| Server tick rate, 180 s walking player, director active (2 encounters ran) | 20.00 mean / 19.99 min TPS — identical to the add-on-free baseline (20.00 / 19.99) | `tps.txt` with and without `--no-addon` |
| No content-log or script errors during full suite | 0 errors (final 1.0.5 run: 269/269 assertions, min 20.0 TPS between tests) | `run_bds.py` summary |

# Test report — Grinshackle v2.0.0

Three kinds of testing are distinguished below. Only the first two happened. **No Minecraft client or dedicated server was available in the
build environment, so no in-game playtest was performed.** Everything marked "in-game" is a checklist for the first real playtest.

## 1. Automated validation (performed)

| Check | Result |
|---|---|
| Every JSON file in both packs parses | pass |
| Manifest UUIDs unique and valid; BP depends on the RP UUID/version; script deps pinned to `@minecraft/server` 2.0.0 and `@minecraft/server-ui` 2.0.0 | pass |
| Entity: every event's component groups exist; no `minecraft:attack` / melee goals; `gs:pose`/`gs:action`/`gs:overlay`/`gs:track` client-synced; loot table path exists | pass |
| Client entity: every animation/controller short name resolves; every `scripts.animate` entry declared; all 21 supplied clips reachable from a controller state; `gs:pose` enum equals the pose controller states; action states match the `gs:action` range; geometry id, 77 bones (all animated bones exist), 64×64 texture, render controllers | pass |
| Sound definitions: 25 ids → existing Ogg files with valid categories; every `gs.*` id used by the scripts is defined | pass |
| Particles: 7 effects, textures resolve; every particle id used by the scripts is defined | pass |
| Items: icons in `item_texture.json` with PNGs; lang entries; recipes and loot reference known items | pass |
| Functions: every `.mcfunction` maps to `scriptevent gs:control` | pass |
| Scripts: 22 ES modules, all relative imports resolve, only `@minecraft/server` / `@minecraft/server-ui` imported | pass |
| TypeScript `checkJs` of all 22 modules against the published 2.0.0 declarations (`tsc --noEmit`) | pass (0 errors) |
| Official-doc verification of the entity components, item components, recipe/manifest fields, animation/controller/Molang facts | see `compatibility_report.md`; every item used was confirmed on learn.microsoft.com (stable) or on the shipped 2.0.0 declarations |

Animation audit (FK toolkit, 30 fps sampling, oriented-cube overlap tests): see `animation_usage_report.md` and `assets/fixlog.json`.
Key numbers after the corrections: no clip penetrates the floor beyond 0.5 units (crawl knees −0.47 u at the deepest dip); attack/slam start/end
blend pops 9.0 → 1.8 u; jaw-in-chest during the attack lean 25 % → 0 %; slam hands-in-horns 70 % → 3 %; run loop seam 4.4° → 0°; crawl seam
4.2° → 0°; crawl ↔ attack_crawl rest poses identical (0.0 u). Strike direction: hands travel toward model −Z (forward) in all three attacks.

The bbmodel round trip (`tools/update_bbmodel.py`) rewrote 100 881 keyframes with 0 mismatches against the corrected animation JSON.

## 2. Mock-API behaviour scenarios (performed on a Node.js mock of the 2.0.0 API — not a Bedrock playtest)

`tests/scenarios.mjs` runs the real behaviour-pack scripts against `tests/mock/` (a mock of `@minecraft/server` derived from the 2.0.0
declarations, with a block map, ray casts, entity queries, navigation stand-in, events, dynamic properties and forms).

**Result: 102/102 checks passed** (`tests/scenario_output.txt` has the raw log).

| Scenario | Result |
|---|---|
| S01 boots and runs 200 ticks without throwing | pass |
| S01 config loaded with defaults | pass |
| S01 dial given once on first join | pass |
| S02 grace period blocks natural spawn | pass |
| S02 gate opens after cooldown reset underground | pass |
| S02 Creative player is not eligible | pass |
| S02 Peaceful blocks the gate | pass |
| S02 natural OFF reported | pass |
| S02 player above Y=0 → wrong_habitat | pass |
| S03 natural encounter (omens or emerge) begins when the gate is open | pass |
| S03 creature eventually spawns (or the omen-only encounter ends cleanly) | pass |
| S03 natural spawn distance within 12..24 blocks | pass |
| S03 reservation written | pass |
| S04 test spawn creates the creature | pass |
| S04 emerge → stalk/observe | pass |
| S04 tension 100 → WARNING → HUNT | pass |
| S04 an attack starts when in reach | pass |
| S04 no damage before the impact tick | pass |
| S04 exactly one damage application at impact | pass |
| S04 attack deals base damage 10 on Normal | pass |
| S04 still one hit after the clip (no double hit, no native melee) | pass |
| S04 next attack respects the minimum gap | pass |
| S05 attack refused through a wall (no line of sight) | pass |
| S05 Creative target: no attack start and no impact damage | pass |
| S05 Spectator target: no attack start and no impact damage | pass |
| S05 dead target: no attack start and no impact damage | pass |
| S05 Peaceful difficulty: no attack start and no impact damage | pass |
| S05 dodging behind it before impact avoids the hit | pass |
| S05 out-of-range at impact is a miss | pass |
| S06 duplicate eggs are removed; exactly one creature remains | pass |
| S06 reservation survives reload and the same creature is re-adopted through emergence | pass |
| S06 a creature with a stale generation removes itself when loaded | pass |
| S07 master OFF during a wind-up: no damage | pass |
| S07 master OFF: creature removed, reservation released, markers cleared, no record | pass |
| S07 master OFF: music stopped | pass |
| S07 master OFF blocks test spawns | pass |
| S07 natural OFF still allows an authorised test spawn | pass |
| S08 fragments dropped during the hunt (bounded ≤ 12) | pass |
| S08 fragments expire within six seconds after the hunt pauses | pass |
| S09 hunt leaves HUNT within the 45 s cap (search/retreat) | pass |
| S09 encounter ends (vanish) and releases the reservation | pass |
| S09 cooldown scheduled after the encounter | pass |
| S09 looping audio stopped on retreat | pass |
| S10 target switching to Creative → retreat without an attack | pass |
| S10 target disconnect → retargets a nearby eligible player | pass |
| S11 muted: no Grinshackle sounds or music | pass |
| S11 muted: actionbar subtitle cues still appear | pass |
| S11 restore: sounds resume | pass |
| S12 four placed torches around the player make it hesitate at the threshold | pass |
| S12 it eventually withdraws instead of approaching a lit refuge | pass |
| S12 a single distant torch does not count as a strong refuge | pass |
| S13 preview spawns a creature with a preview reservation | pass |
| S13 preview plays a requested clip via the action property | pass |
| S13 preview loop cycles many clips | pass |
| S13 preview never targets or damages | pass |
| S13 preview expires after two minutes and releases the reservation | pass |
| S14 lure sets a redirect while observing | pass |
| S14 one lure consumed | pass |
| S14 repeat placement is weaker | pass |
| S14 visible feedback given | pass |
| S14 a lure never cancels a committed attack | pass |
| S15 footsteps omen available after walking then stopping | pass |
| S15 pick respects the omen toggles | pass |
| S15 borrowed footsteps play exactly 3 steps (two, pause, one) | pass |
| S15 footsteps come from 6..10 blocks away | pass |
| S15 mine rhythm listened (3 intervals) | pass |
| S15 answering_mine available (or another omen while the rhythm is fresh) | pass |
| S15 answer replays the rhythm plus one extra tap (3 intervals → 5 taps) | pass |
| S15 taps come from 14..20 blocks away | pass |
| S15 a bell raises tension by 8 | pass |
| S16 hurt reaction rate-limited (≤ one per 30 ticks) | pass |
| S16 80 virtual health reached 0 → COLLAPSE | pass |
| S16 collapse drops Broken Chain and Ink-soaked Scrap after the clip | pass |
| S16 creature removed and reservation released after defeat | pass |
| S16 no attack while collecting drops | pass |
| S16 longer cooldown after a defeat | pass |
| S17 unloaded creature: record dropped, reservation kept | pass |
| S17 spawn gate reports reserved_unloaded | pass |
| S17 lost reservation retired after the timeout | pass |
| S17 the returning stale creature removes itself (no second authorised encounter) | pass |
| S18 dial given on first join | pass |
| S18 hunt cap clamped to 45 | pass |
| S18 damage scale clamped to 0 | pass |
| S18 relentless keeps the 45 s hunt cap | pass |
| S18 showcase disables natural spawning and damage | pass |
| S18 config persisted as a world dynamic property | pass |
| S18 profile traits need confidence thresholds | pass |
| S18 forget clears the profile | pass |
| S18 learning OFF ignores observations | pass |
| S19 repeated end/reset/disable/enable stay safe | pass |
| S19 no waypoint helpers left behind | pass |
| S20 switching to Peaceful ends the encounter immediately | pass |
| S21 first player is the world owner → admin | pass |
| S21 dial opens the main menu with eight sections | pass |
| S21 Status section opens as a message form | pass |
| S21 Master OFF applied through the form and persisted | pass |
| S21 master OFF from the dial blocks spawns | pass |
| S21 Master ON again through the form | pass |
| S21 second player is not an admin | pass |
| S21 non-admin personal audio preference saved | pass |
| S21 non-admin gets the admin-only notice instead of the Master form | pass |
| S21 preset applied through the dial | pass |

Limits of the mock: navigation is a straight-line stand-in (no real pathfinding), there is no client, no latency, no chunk loading beyond an
explicit unload/reload helper, and no rendering. Timing, ordering and gating logic are exercised; feel and appearance are not.

## 3. In-game playtest (NOT performed — checklist for the first real test)

Fresh world, all experiments OFF, both packs active, Normal difficulty:

1. Content log clean on world load (`/function grinshackle/status` replies with the gate explanation).
2. `/function grinshackle/preview` shows the model 5 blocks ahead; `preview loop` cycles all 21 clips without a T-pose between clips; `preview
   walk/run/stalk/crawl` play in place.
3. Natural encounter below Y=0 after the grace period: omens (footsteps that are not yours / the extra tap / a distant drag), then emergence out of
   view, then a sighting or a stalk; check the chain drag is audible within ~12 blocks and that the Last Link variant goes quiet.
4. A full hunt: warning (chain whip / roar / release click), pursuit with `run`, fragments visible, stepping on one snaps a chain and speeds it up
   for 4 s, sneaking over one does not; attacks land only at the impact frame and only when the claws visibly reach you; stepping behind it or
   a wall before impact is a miss; the slam is slower and telegraphed; the 45 s cap ends the hunt.
5. Two-block tunnel: it crawls (collision 1.95), uses the low strike, stands up only with clearance.
6. Four torches around you: it hesitates at the edge and withdraws; one distant torch changes nothing.
7. Rattle Lure: redirects while it observes/searches; repeated placement gives the "barely turned its head" cue.
8. Corner watch: only a hand/horn/part of the grin visible from cover; head turns first, body follows; after ~6 s it tightens, then relocates by
   walking when you look away.
9. Save and reload mid-attack: the creature re-emerges, no double creature, no stuck loop audio.
10. Two spawn eggs: only one creature; the second dissolves with the actionbar note.
11. Multiplayer: target logs out or switches to Creative → it retargets or retreats; Peaceful ends it.
12. Master OFF during a wind-up: no damage; markers gone; music stops. Natural OFF still allows `spawn` and `preview`.
13. Dial on touch/controller: every section opens as a list form; non-admin sees Audio and Status only.
14. Mute: no sounds, subtitles still show.
15. Defeat it: collapse clip plays fully, drops appear, nothing attacks you while looting.

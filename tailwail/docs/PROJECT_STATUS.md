# Project status

Current version: **3.1.0** (its changes are in the second table).

**v3.0.0: the hunter.** Rebuilt after v2 feedback: "underwhelming", "the animations aren't
working, he's very still", "after the grab he just did damage and scurried off... then
completely stopped attacking", "make him fast", "spawn on the surface too", "the mash
jumping is too consistent".

| Feedback | v3 answer |
|---|---|
| Animations not working, very still | one generated animation file; default body state needs no property; `??` fallbacks; attacks via `Entity.playAnimation`; every pose loops with visible motion; resource-pack version check on join; `/tailwail:debug anim` showcase |
| Underwhelming, not intense | seconds-long opening and stand-off; scream; 8.4 blocks/s hunt (7.8 in 3.1); rakes, combos, slams, pounces, grabs (parked in 3.1); louder sounds heard from farther away; ceiling and corner ambushes; climbing; door and glass smashing |
| Scurried off after the bite, stopped attacking | no pursuit budget while it can see you; after every hit or finisher it savours it for 1-2 s and hunts on; verified on BDS (it attacked again after the bite) |
| Struggle too consistent | jump / sneak / alternate / don't-move, random counts and windows, grip shifts, rare unbreakable grabs (the whole struggle is parked in 3.1) |
| Surface spawns | night-surface setups (treeline watcher, runner) and surface haunting (runner, door banging, the window, distant screams) |
| Caves should do more | ceiling cling, corner heap, tunnel crawl, reaching into holes, scraping in the walls |

**v3.1.0** (after "get rid of the fake chat line", "remove the white pupils", "make the
chase animation a bit slower", "chase / attack speed the same as the Cave Dweller", "add
the stand-off / observation", "crawl through 1-block gaps, climb, break blocks, squeeze
through tunnels", "get rid of the mash feature but save it"):

| Request | 3.1 answer |
|---|---|
| Fake "joined the game" line | removed (event, setting and docs) |
| White pupils | the two pale pupil pixels painted with the black face colour; nothing else in the texture changed |
| Slower chase animation | gallop cycle 3.0 → 3.6 blocks: ~2.2 bounds a second instead of 2.8 |
| Cave Dweller chase / attack speed | 7.8 blocks/s on every preset (0.5 × 0.85 from its code), one attack a second |
| Stand-off / observation | idle, slow approach, and tests (bluff charge, sidestep, backing off, neck crane) whose outcome depends on how you react; set off by long stares, shots or thrown things, hits, coming close, turning away, or its own decision; provoked = a roar and an instant sprint |
| Advanced pathfinding | new 0.9-high squeeze posture and crushed-flat crawl through 1-block gaps; it reaches into your hole, then squeezes in after you; climbing, door/glass smashing and the tunnel crawl kept |
| Remove the mash, save it | the grab and its struggle are parked: kept and unit-tested, never used in game |

| Area | v3 state |
|---|---|
| Client | 5 distance-driven gaits, 23 body states (all loop except death), 17 one-shots, 14 overlays; one body controller + hurt + echo. `client_sim.py`: 0 errors |
| Encounter | stalk beats, observation stand-off, scream (or a roar when provoked), relentless hunt, 4 attacks at the Cave Dweller's rhythm, savor, search, return, flee, death, ambushes, climb, bash, reach-in then squeeze |
| Haunting | 17 presence events plus the bed visit, 4 escalation stages, eligible-time pacing |
| World | burnt-out torch block, hallucination entity, dread fog, snuff smoke |
| Audio | 43 synthesized sound events (95 files, loudness-normalised) + 2 streamed music loops |
| UX | Torn Journal (14 pages shown), settings (3 presets plus custom; breaking blocks, climbing, ambushes), operator diagnostics |
| Verification | validator 14/14, unit tests 51/51, BDS scenarios, mct |

## Next actions (need a game client)

1. First thing in a client: join and read the chat line. It must say "Resource pack 3.1.0
   active". Then run `/tailwail:debug anim` and watch every clip (including the squeeze).
2. Play through [TESTING.md §6](TESTING.md). Above all, watch the gallop, the stand-off's
   tests, the attacks and the squeeze on a real screen, shoot a real arrow at it, and
   listen to every sound.
3. Tune damage, stand-off timing and loudness from that session.
4. Profile client frame time with 1-2 creatures on a mid-range phone.
5. Playtest with people who have not read the guide: did they escape at least once, did
   they understand the stand-off, was it still scary after three encounters.

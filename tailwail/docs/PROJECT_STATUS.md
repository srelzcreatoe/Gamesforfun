# Project status

**v3.0.0: the hunter.** Rebuilt after v2 feedback: "underwhelming", "the animations aren't
working, he's very still", "after the grab he just did damage and scurried off... then
completely stopped attacking", "make him fast", "spawn on the surface too", "the mash
jumping is too consistent".

| Feedback | v3 answer |
|---|---|
| Animations not working, very still | one generated animation file; default body state needs no property; `??` fallbacks; attacks via `Entity.playAnimation`; every pose loops with visible motion; resource-pack version check on join; `/tailwail:debug anim` showcase |
| Underwhelming, not intense | seconds-long opening and stand-off; scream; 8.4 blocks/s hunt; rakes, combos, slams, pounces, grabs; louder sounds heard from farther away; ceiling and corner ambushes; climbing; door and glass smashing |
| Scurried off after the bite, stopped attacking | no pursuit budget while it can see you; after every hit or finisher it savours it for 1-2 s and hunts on; verified on BDS (it attacked again after the bite) |
| Struggle too consistent | jump / sneak / alternate / don't-move, random counts and windows, grip shifts, rare unbreakable grabs |
| Surface spawns | night-surface setups (treeline watcher, runner) and surface haunting (runner, door banging, the window, distant screams) |
| Caves should do more | ceiling cling, corner heap, tunnel crawl, reaching into holes, scraping in the walls |

| Area | v3 state |
|---|---|
| Client | 4 distance-driven gaits, 22 body states (all loop except death), 17 one-shots, 14 overlays; one body controller + hurt + echo. `client_sim.py`: 0 errors |
| Encounter | stalk beats, short stand-off, scream, relentless hunt, 6 attacks, varied grab, savor / stunned, search, return, flee, death, ambushes, climb, bash, reach-in |
| Haunting | 18 presence events plus the bed visit, 4 escalation stages, eligible-time pacing |
| World | burnt-out torch block, hallucination entity, dread fog, snuff smoke |
| Audio | 43 synthesized sound events (95 files, loudness-normalised) + 2 streamed music loops |
| UX | Torn Journal (17 pages), settings (3 presets plus custom; new options for breaking blocks, climbing, ambushes, struggle range), operator diagnostics |
| Verification | validator 14/14, unit tests 44/44, BDS scenarios, mct |

## Next actions (need a game client)

1. First thing in a client: join and read the chat line. It must say "Resource pack 3.0.0
   active". Then run `/tailwail:debug anim` and watch every clip.
2. Play through [TESTING.md §6](TESTING.md). Above all, watch the gallop, the attacks and
   the grab on a real screen, and listen to every sound.
3. Tune speed, damage, struggle counts and loudness from that session.
4. Profile client frame time with 1-2 creatures on a mid-range phone.
5. Playtest with people who have not read the guide: did they escape at least once, did
   they read the grab prompts, was it still scary after three encounters.

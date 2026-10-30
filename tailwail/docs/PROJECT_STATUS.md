# Project status

**v2.0.0: complete rebuild after v1 feedback** ("underwhelming", "the animations aren't
working").

| Area | v2 state |
|---|---|
| Client | 31 new baked clips, a hub controller on int properties, always-on breathing / tremor / look / jaw overlays, solved ground fixes for the tunnel crawl. Proven by `client_sim.py`: 0 errors |
| Encounter | stalk, stand-off (statue creep, mirror, performances, agitation readout), silent unfold, scream, windup, chase, grab and struggle (throw, bite), search (sniff, noise, hiding), frustrated howl, owl-turn retreat, death |
| Haunting | 12 presence events plus the bed visit, 4 escalation stages, eligible-time pacing |
| World | burnt-out torch block (relightable, returns the torch), hallucination entity, dread fog, snuff smoke |
| Audio | 30 synthesized sound events (69 files) + 2 streamed music loops, all original |
| UX | Torn Journal (13 unlockable pages), settings (3 presets plus custom; per-player camera, music, fog and captions), operator diagnostics, `/tailwail:debug restore` |
| Verification | validator 14/14, unit tests 40/40, BDS scenarios (statue, commit, grab, hide, escape, tunnel, presence, death, spawn site, perf), mct 0 errors |

## Next actions (need a game client)

1. Play through [TESTING.md §6](TESTING.md). Above all, listen to every sound and watch the
   stand-off and the grab on a real screen.
2. Tune loudness, fog density, FOV amounts and agitation rate from that session.
3. Profile client frame time with 1–2 creatures on a mid-range phone.
4. Run a playtest with people who have not read the guide, scored on the rubric:
   - did they discover the statue rule;
   - did they read the agitation signs;
   - did they escape at least once;
   - was it still scary after three encounters.

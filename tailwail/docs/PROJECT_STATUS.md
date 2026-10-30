# Project status (2026-10-30)

## Done
* Milestone 1 — asset audit (facts re-verified, every clip rendered and measured), version
  selection (Bedrock 1.26.60 / BDS 1.26.61.1, `@minecraft/server` 2.11.0, `-ui` 2.3.0),
  competitive baseline.
* Milestone 2 — playable creature: BP/RP, 1.5× scale, collision/hit profiles, lure
  navigation, spawn egg, lang, icons.
* Milestone 3 — full encounter loop: stalk → stand-off → unfold → 3.2 s wind-up → wail →
  chase → search → retreat; death; single damage authority; posture/tunnels; escape rules.
* Milestone 4 — memory and variety: per-player bounded memory, delayed imitation,
  remembered-gesture opener, rehearsal of learned gestures, six setups, scheduler.
* Milestone 5 — polish: 30+ derived/new clips with solved grounding, tail states,
  synthesised sound palette (36 files), field guide, settings forms, presets, captions,
  per-viewer effects.
* Milestone 6 — validator (0 errors), 29 unit tests (pass), BDS runtime scenarios
  (see [TESTING.md](TESTING.md)), packaging (`dist/`), documentation.

## Key decisions
* Server-driven entity properties + client controllers (state survives late joiners).
* Navigation via a script-placed lure and the engine pathfinder; never teleport the creature.
* Chase gait = supplied `crawl` knuckle-gallop; commitment = new unfold layered on
  `reveal`, then the untouched 3.2 s `windup`.
* No 1×1 pursuit (documented escape rule); two-high tunnels supported.
* Synthesised audio as the shipped v1 palette, flagged for a sound-design pass.

## Pending (needs a client, devices or people)
* In-client visual/audio verification and the manual test plan in TESTING.md §4.
* Device performance measurement (mobile included) and mane profiling.
* Playtests with the rubric; tuning from observations.

## Next concrete action
Import `dist/Tailwail_The_Rehearsal_1.0.0.mcaddon` into Minecraft 1.26.60+ on a test
device, create a Survival world with experiments off, run TESTING.md §4 steps 1–3 with
`/tailwail:debug log on`, and record content-log output and any visual problems.

## Rebuild / verify
`python3 -I tools/package.py` (validates first). `node --test tests/*.test.mjs`.
`python3 tools/bds_scenarios.py --server <scratch BDS>` for runtime scenarios.

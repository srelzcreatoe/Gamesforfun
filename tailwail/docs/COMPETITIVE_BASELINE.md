# Competitive baseline (checked 2026-10-30)

Scope: current Minecraft **Bedrock Marketplace** dweller / stalking-horror add-ons.
Java mods (for example the original Java "Cave Dweller" mod) are deliberately
excluded. This is a product-quality target, not a claim that Tailwail beats any
of them. No popularity ranking is implied; ratings are store figures copied by
third-party trackers.

## Evidence quality

| Tag | Source | Status |
|---|---|---|
| S1 | minecraft.net "Marketplace Spotlight: October 2026" (10/20/26) | fetched |
| S2 | minecraft.net "Let's Play: The One Who Watches" (2/2/26) | fetched |
| S3 | minecraft.net "Let's Play: DWELLERS 2.0" (7/7/25) | fetched |
| S4 | minecraft.net "Summer Sale 2026" (6/30/26) — names DWELLERS 2.1 | fetched |
| S5 | minecraft.net Marketplace PDP pages | page body is script-rendered; only the URL slug (with version) was readable |
| S6 | third-party catalog trackers that mirror listing text (chunk.gg, minecraftpal.com, bedrockexplorer.com) | fetched; their update dates disagree with each other |
| — | creator websites, official gameplay videos | none found |

"Advertised" = listing / creator text. "Observed" = what an official Let's Play
article reports actually happening. "Unknown" = implementation details no source
shows. None of the sources expose AI internals, persistence, multiplayer rules
or performance.

## Products

### CAVE DWELLER Add-On (Official) — XP GAMES (with Gargin)
* Version: not stated on the listing (one tracker shows a file version 1.0.29 — unverified). Requires 1.21.120+. 660 Minecoins.
* Advertised (S6): "advanced AI capable of learning and adapting", three stages (stalking, standoff, engage), custom caves/blocks, dynamic animations/sounds/music; latest changelog adds "new ambush tactics", tweaks to aggression/stalking, torch-extinguish fix.
* Observed (S1): watches from distance, cue sound, grows bolder; movement sounds stop when the player stops; stands in plain view; then chases "frighteningly fast across open ground"; a tight tunnel did not slow it.
* Unknown: what "learning" stores, stage triggers, settings, multiplayer.

### The One Who Watches Add-On 1.0.1 — Mythicus (article also credits Pixel Coder)
* Version: 1.0.1 (listing title / URL slug). Requires 1.21.120+. 660 Minecoins.
* Advertised (S6): stalker AI, doors and tight spaces, "armor, knockback, potions and shields are useless", jumpscares, hallucinations, lore structures.
* Observed (S2): long quiet opening, lore journal, constant knocking before first sighting, **first encounter was an instant kill**, phantom footsteps/gargling at night, a fear-mechanic explainer UI, emerging from a doorway, apparent daytime respite.
* Unknown: fear-meter inputs/effects, hallucination rules, settings.

### DWELLERS (2.1) Add-On — Panascais
* Version: **2.1** is the latest found (S4, URL slug, changelog head). No evidence of a later version as of 2026-10-30. 1,340 Minecoins.
* Advertised (S6/S4): roster of ~9 named dwellers + 6 mimics, Blood Moon, VFX/fog, 9 languages, 2.0 "improved mob AIs", 2.1 new mimics and Vibrant Visuals support; Cavern Dweller "waits for you in the depths".
* Observed (S3, v2.0): starter book + settings cog + flashlight; mimic sheep chase; blood-moon fog; fake trader reveal; Krampus built up with sound/crows; on-screen "YOU CAN'T HIDE!"; cog offers difficulty, scare-effect toggles and per-dweller toggles.
* Unknown: spawn pacing logic, difficulty growth, Cavern Dweller cave behavior.

### Creepy Plushies Add-On (Update 2.0) — Lofi Girl (secondary reference)
* Observed (S1): corner peek while mining, then vanish; lurks over several days; open chase in a dungeon, escaped by climbing. 2.0 changelog: reworked pathfinding, new settings.

## Category strengths an original competitor must match
1. Gradual escalation watch → bolder → chase (all three primaries).
2. Audio that makes players doubt themselves (sounds that stop when you stop, knocking, gargles).
3. Caves/tunnels/doors are not automatically safe.
4. Behavior that *feels* reactive (advertised as "learning"; internals unverified).
5. Breadth (DWELLERS roster/events) — Tailwail answers with depth of one creature instead.
6. In-game settings (difficulty, scare toggles) from an inventory item.
7. Pacing with relief periods.

## Comparison: competitor strength -> Tailwail v3 response -> observable acceptance test

Not a claim that Tailwail is better than any of these products: no side-by-side play
comparison has been done. "The Goatman" (named by the requester) was not reviewed: no
listing data was gathered for it.

| Dimension | Genre strength (source) | Tailwail v3 response | Acceptance test (status) |
|---|---|---|---|
| Doubt before the first sighting | footsteps that stop when you stop, knocking, gargles (S1, S2) | 17 presence events from the first minute: footsteps that stop a beat late and take one more step, heavy running steps that stop right behind you, your own sounds repeated, knocks and scraping in the walls, breath, whispers, torches going out, doors opening or being hammered, glimpses, the runner, a face at the window, distant screams, bed visits | BDS: all 17 exercised (verified) |
| Gradual escalation, then a fast chase | watch -> bolder -> chase; "frighteningly fast across open ground" (S1) | four stages; encounter: seconds of watching / peeking / running across view, the observation stand-off, the scream (or a roar when provoked), then a hunt at the Cave Dweller's chase speed, **faster than a sprinting player** | BDS: hunt measured at 7.8 blocks/s (verified) |
| A mechanic you can play against | stand-off / observation phases (S6) | it stands idle, approaches slowly, or tests you (bluff charge, sidestep, backing off, neck crane) and reads your reaction; long stares, shots or thrown things, hits, coming close or turning your back set it off | BDS: observation modes and reaction reading logged; charged 0.85 s after the turn; a shot aimed at it provoked it (stand-in arrow) (verified) |
| Being caught | instant kill (S2) | no grab in 3.1 (parked): one attack a second while in reach (rakes, combos), slams and pounces; then it hunts on | BDS: still hunting after hits (verified) |
| It keeps coming | tight tunnels do not slow it (S1) | no time budget while it can see you; crawls 2-high tunnels; **crushed flat through 1-block gaps**; climbs walls; smashes doors and glass; reaches into holes, then squeezes in; sometimes pretends to leave and returns | BDS: squeezed through a 12-block 1-high tunnel and attacked; climbed a 5-block pillar; broke a door; tunnel crawl (verified) |
| Ambushes | "new ambush tactics" (Cave Dweller changelog, S6) | spread on cave ceilings like a spider (drops when you pass under or stare); a heap in a corner that turns round; crouched behind you | BDS: clung 4.4 blocks up with gravity off, dropped and hunted (verified) |
| Surface threat | night stalking (S2) | night-surface openings: standing tall at the treeline, the runner; surface haunting | BDS: treeline encounter to hunt in 12.8 s at night (verified) |
| Escape and hiding | climbing out (S1) | break line of sight with distance, seal gaps behind you, crouch in the dark; noise and shots give you away | BDS: hidden player never found; escape through a 1-high gap sealed behind you (verified) |
| Fear you can read | fear meter UI (S2) | no UI meter: tail, breathing, tremor, clicks, jaw, heartbeat rate and FOV narrowing | client sim: properties drive overlays; in-client feel not yet checked |
| Persistent dread | evidence of the creature between sightings (S1, S2) | 3.2: claw marks on cave walls where it has been, tally marks by your bed (one per escape), your things moved while you were away, its nest with what it took from you | BDS: claw marks during a hunt; 7 strokes as 5 + 2 by the bed; torch, barrel, chest and bed each disturbed; nest built; 3 dropped stacks carried into its chest (verified) |
| Light | torch-extinguish (S6) | torches snuffed by presence, by the scream and along its path; relightable | BDS: snuff + relight verified |
| "Learning" | advertised, unverified internals (S6) | bounded per-player memory of gestures and reactions; it opens encounters with your own gesture and biases its openings by how you react | unit tests (verified offline) |
| Settings | difficulty + scare toggles (S3) | 3 presets + custom; haunting level, jumpscares, torches, breaking blocks, climbing, ambushes; per-player camera / music / fog / captions | form fields type-checked; in-client not yet checked |
| Atmosphere | VFX / fog / music (S3, S6) | per-player dread fog, stand-off drone, chase score, heartbeat; 43 original synthesized sound events, loudness-normalised | spectrogram and loudness review; in-client listening not yet done |

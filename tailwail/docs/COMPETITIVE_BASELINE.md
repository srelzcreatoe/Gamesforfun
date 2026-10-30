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

## Comparison: competitor strength -> Tailwail v2 response -> observable acceptance test

Not a claim that Tailwail is better than any of these products: no side-by-side play
comparison has been done. "The Goatman" (named by the requester) was not reviewed in this
pass: no listing data was gathered for it.

| Dimension | Genre strength (source) | Tailwail v2 response | Acceptance test (status) |
|---|---|---|---|
| Doubt before the first sighting | footsteps that stop when you stop, knocking, gargles (S1, S2) | 12 presence events from the first minute underground: footsteps that stop a beat late and take one more step, your own sounds repeated from the dark (real vanilla ids), knocks, breath behind you, whispers, torches going out, doors, glimpses that vanish once seen, peeks, fake join message, bed visits | BDS: footsteps 5 steps over 6 blocks; mimic replayed `dig.deepslate` 2.5 s after the break; glimpse removed after being seen then looked away from (verified) |
| Gradual escalation | watch -> bolder -> chase (S1, S2) | four stages (unease, watched, hunted, obsessed) gate events and openings; encounters: stalk -> stand-off -> unfold -> scream -> chase | unit-tested ladder; `/tailwail:debug status` shows stage (verified) |
| A mechanic you can play against | stand-off phases (S6) | **statue rule** (moves only while nobody has it on screen) vs **stare cost** (agitation): look away and it closes in, stare and it commits | BDS: 0 blocks moved while watched, 2.6-3.3 blocks per look-away with a new pose each time (verified) |
| Fear you can read | fear meter UI (S2) | no UI meter: tail drag/twitch/curl, breathing, tremor, clicks, jaw, heartbeat rate and FOV narrowing all track agitation | client sim: properties drive overlays; in-client feel not yet checked |
| The big moment | instant kills (S2), fast chases (S1) | silent rise to ~5 blocks -> 1.8 s scream (shake, darkness, all nearby torches out) -> drop to all fours -> chase above sprint speed | BDS: sequence and torch snuffing verified; never skipped on provocation (unit-tested) |
| Being caught | instant kill (S2) | **grab**: lifted to its face, view locked, mash Jump to tear free; else thrown, second time bitten; friends can make it drop you | BDS: struggle free with 8 presses, throw/bite damage, input always restored (verified) |
| Tunnels and doors are not safe | (S1, S6) | tall -> hunch -> belly crawl in 2-high tunnels; opens wooden doors; cannot fit 1-high gaps | BDS tunnel scenario (verified) |
| Escape and hiding | climbing out (S1) | break line of sight with distance -> search; crouch in darkness to hide; noise gives you away | BDS: hidden player never found; escape through a 1-high gap (verified) |
| Light | torch-extinguish (Cave Dweller changelog, S6) | torches snuffed by presence, by the scream and along its chase path; relightable burnt-out sticks | BDS: snuff + relight verified |
| "Learning" | advertised, unverified internals (S6) | bounded per-player memory of observed gestures and reactions; it opens encounters with your own gesture | unit + v1 BDS verification of the remembered opener |
| Settings | difficulty + scare toggles (S3) | 3 presets + custom, haunting level, grab, jumpscares, fake chat, torch snuffing; per-player camera/music/fog/captions | form fields type-checked; in-client not yet checked |
| Atmosphere | VFX / fog / music (S3, S6) | per-player dread fog, stand-off drone, chase score, heartbeat, all original and synthesized | spectrogram review; in-client listening not yet done |

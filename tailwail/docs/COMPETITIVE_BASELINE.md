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

## Comparison: competitor strength → Tailwail response → observable acceptance test

| Dimension | Competitor strength (source) | Tailwail response | Observable acceptance test |
|---|---|---|---|
| Cave pursuit | Cave Dweller is fast in open ground; tunnels don't stop it (S1) | Open-ground chase speed above player sprint; posture/collision profiles (tall → hunched → tunnel crawl) so 2-high tunnels and 1-wide corridors are followed; finite pursuit budget and line-of-sight memory make escape possible | In a test cave: sprinting player in open ground is caught up within ~6 s; player who breaks line of sight around corners for 8 s with ≥24 blocks separation ends the chase; Tailwail follows into a 1×2 tunnel (logged posture change) |
| Gradual psychological tension | Watch → bolder → chase (S1, S2) | Three-phase state machine with randomized stalking duration, partial sightings, silence windows, three readable agitation cue levels, no fear meter | Content log/diagnostics show STALKING → STANDOFF → (WINDUP or RETREAT); a calm player who backs off ends a stand-off without an attack in ≥1 trial |
| Encounter variety | DWELLERS roster/mimics (S3); Cave Dweller "ambush tactics" (S6) | Six setups (distant silhouette, corner peek, delayed imitation, low tunnel observation, full-height reveal, voluntary withdrawal) chosen by a scheduler that avoids back-to-back repeats | Over 6 forced encounters (`/tailwail:debug encounter` sequence) no setup repeats consecutively; outcomes include observe-only, calm disengage, interrupted approach, pursuit |
| "Learning"/reactivity | Advertised "learning and adapting" (S6), implementation unknown | Transparent, bounded per-player memory of *observed* gestures and outcomes; signature "remembered gesture" opener | After a player crouches in view during encounter N, encounter N+1 can open with Tailwail crouching before the player does (diagnostics print the memory record) |
| Fairness | One Who Watches first encounter was an instant kill (S2) | Mandatory telegraph: unfold (silent) + 3.2 s wind-up + wail before any damage; melee has wind-up, cooldown, reach and LOS check; attack while peaceful raises agitation but never skips the wind-up | Attacking a calm Tailwail never produces damage within 5 s; no damage through a 1-block wall in the wall test |
| Player settings | DWELLERS cog: difficulty, scare toggles, per-creature toggles (S3) | Field-guide item + `/tailwail:settings`-free UI: host/operator world settings (frequency, cooldown, grace, difficulty, damage, pursuit duration, imitation, cave/surface) and per-player presentation (volume, effects) | Non-operator sees only presentation settings; changing cooldown applies on next schedule check |
| Audio | Knocking, gargling, adaptive music, footsteps that stop (S1, S2) | Original synthesized palette: distant breath, tail scrape, nail scrape, throat click, agitated inhale, full wail, pursuit exertion, impacts, retreat; per-cue caps and silence as a state | Wail plays exactly once per real commitment; no cue repeats more than its cap within its window (unit test on audio limiter) |
| Animation | "Dynamic animations" (S6) | Supplied 31 clips kept; state-driven controller with explicit bone ownership; new overlays for delayed imitation, tail states, unfold, pursuit gait locked to distance moved | Preview renders and in-game check: crouch overlay keeps feet on the ground; tail visibly differs between drag/twitch/rigid |
| Long-session replay | DWELLERS breadth, Cave Dweller updates (S6) | Scheduler with grace period, randomized 6–10 min cooldown, quiet periods, post-death protection, variant history, memory decay | In a 60-minute session log, encounters are spaced by ≥ cooldown, never within the post-death window, and setups vary |

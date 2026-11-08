# Changelog

## 2.0.0 — overhaul
Fixes for the 1.0 report:
- Skull trophy: removed the render controller that read `context.item_slot` (the Molang error). The skull now binds to the head bone in its geometry and uses the vanilla armor render controller, like Microsoft's wearable samples.
- Den blocks no longer render untextured: every cube block declares `minecraft:geometry.full_block`, invalid boolean ambient occlusion removed, `blocks.json` lists their textures.
- Guide moths really lead to the den: they fly an A* route through open air, face the way they are going, wait and point at the den if you fall behind, and circle the Den Heart on arrival.

The creature, rebuilt:
- A persistent stalker brain: about a minute after you go underground it arrives out of sight and stays, shadowing you through the real cave, giving ground when approached, freezing when caught looking, catching up when left behind, withdrawing when nobody is underground.
- New movement controller: script-driven walking along a flood-filled map of the real cave (physics steering with a stepping fallback), so it moves in every situation; engine pathfinding is only used for hunts and falls back to a scripted chase if it stalls.
- Presence soundscape: two new original music beds (presence and close) driven by its real distance, soft footsteps from its walk cycle, ambient breathing, positional cues where it really is, and a heartbeat only when it is genuinely close.
- Faster pacing: first sound cue at ~2 minutes, first real encounter at ~3–5 minutes, dens grow after a few minutes underground.
- Creative players are stalked by default (never damaged); toggle in world settings. Peaceful worlds stay quiet.
- The invisible waypoint entity from 1.0 is gone.
- Validator now catches the 1.0 bugs; simulator reports presence, sound mix, guide moth routes and silent in-view teleports.

## 1.0.0
- First release of The Shaftbreaker for Minecraft Bedrock 1.21.120+ (stable Script API 2.3.0, no experiments).
- Director with per-player pacing, curiosity and provocation meters, novelty-aware selection and multiplayer witness sharing.
- 44 encounter templates covering all 140 design IDs (L01-L90, N01-N50); see FEATURES.md.
- 14-signal persistent memory with confidence, saturation, decay and counter-learning.
- Hunts with mandatory telegraphs, Breaker block clearing under strict provenance rules, Frenzy time cap, fair line-of-sight strikes.
- Shaft Dens, Shaft Moths, den cleansing and territory suppression; Shaftbreaker Skull trophy; Resonance Dial UI; admin commands.
- 50 new animation clips, original procedural audio and textures.

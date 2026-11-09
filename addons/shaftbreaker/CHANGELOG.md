# Changelog

## 2.1.0 — it wants to be seen
After 2.0 feedback ("he doesn't even stalk me at all, nor attack me"), the core loop is rebuilt around being seen and attacked:
- New visible stalker (`stalk_show`): about every minute or two it appears silently where you will notice it and stays perfectly still — on the ground, on a high ledge, hanging from a cave ceiling, right behind you — or hides behind a real tree trunk / pillar and peeks (ducks when looked at, peeks from the other side when you look away).
- When spotted it vanishes, flees, lunges, snaps into a rage or holds a standoff: neck crack (new sound), head tilt, one slow step while you watch, a little closer every time you look away, a lunge when you look back at it up close.
- Rage: stared down too long, shot or struck, it screams and chases faster than a sprint with heavier hits (rage mode, scripted fallback at rage speed). Run at it and it attacks or vanishes to ambush you later (`stalk_ambush`). Walk up to it and it strikes.
- Chases climb walls, pillars, ledges and ladders, crawl one-block gaps (crawl look-ahead), switch to scripted pursuit whenever the engine stalls, open doors/gates/trapdoors and smash glass and leaves, and find a way in when you hide indoors. Every change is restored afterwards (persisted across reloads).
- Night stalking on the surface (new world setting, on by default); a raging Shaftbreaker no longer stops at the surface at night, only in daylight. Shut indoors, it works from the ground outside.
- It vanishes in place instead of walking away (all passive exits and chase endings).
- Fairness: no hit within ~1.8 s of a scream; every lunge and close strike has a wind-up; strikes need line of sight.
- Fixes: stale step-mode paths re-plan when the world changed; ceiling hangs always drop properly before acting; teleports never happen while anyone has it in view.
- Simulator: surface forest and a house with door and windows, night scenario, bots that stare / charge / hit / shoot / hide, stalker and breach-restore reports, safe parallel runs.

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

# Changelog

## 3.1.0 — its home
After 3.0 feedback ("it doesn't chase me", "none of the music sounds like Sonic.exe or the Goatwalker", "the roar and jumpscare sound lame", "the music cuts out when I press it in settings"), plus your concept art for an infected cave biome:
- **Chases by day.** Chases no longer end at sunrise; that was why it never chased you on the surface in daylight. There is a new Wheel switch, *Daylight ends its chases*, to bring the old rule back. It now stalks the surface by day as well (*Day stalking*, on by default), and a *Relentless* frequency was added.
- **Its home, the infected caves**, from your concept art. Under the Hollows the caves are veinstone and cracked veinstone, fleshstone and pulsing flesh. There are organ chambers with organ cores, rib arches, skeletons, rotted mine supports, organ mounds and watcher nests. Bloodroot vines and dripfang stalactites hang from the ceilings; crimson thorns, glowspore clusters and bloodmoss cover the floors. The pools are blood-red, there is red fog and mist, and blood drips from the ceilings and the walls beat. Rib arches also stand on the surface. 13 new blocks in all.
  - **Watcher pods** open when you come near and tell it where you are, and it comes, sometimes as an ambush.
  - **Organ cores** wound it when broken, and it comes for you.
  - **Crimson thorns** cut and slow you.
  - **It is stronger at home**: harder hits, faster, sooner and longer chases, less patience, more scares. It heals in the Hollows, and its dens there are made of flesh, organ cores and watcher pods.
- **New behaviour, inspired by the most popular Java dweller mods** (written from scratch):
  - It screams or roars every few seconds in a chase (Cave Dweller).
  - Staring at its face makes it snap (Shy Dweller).
  - It visits you while you sleep: knocking, a whisper, then standing over your bed. If you don't wake, it strikes (The Knocker).
  - Chases come sooner the longer you stay underground.
- **The charge-lunge.** Spotted from far away, it screams and runs the whole distance at you, then lunges. A lunge you ask for on the Wheel always ends in a chase. It now appears right behind you, 3.5–9 blocks away.
- **New soundtrack: a cursed 16-bit cartridge**, all original. An emulated FM/PSG sound chip plays an original cheerful tune, which is then slowed, dropped in pitch, turned minor, reversed, bit-crushed and cut up by static and tape stops, over deep detuned stabs and a 40 Hz pulse. There are five new tracks: presence, close, standoff, a 170 bpm three-section chase, and the Hollows. They are mastered about 7 dB louder than 3.0, with heavy sub-bass. The Goatwalker pack was used only for measurement; none of its audio is used.
- **Deeper voice.** The roar is 8 semitones lower and about 5 s long, with a sub layer. The jumpscare has a sub drop to 24 Hz, a slowed bellow and a brass cluster. The rage scream and the reveal sting now have a low body. New sounds: the charge, beating flesh, a watcher pod opening, blood drips, and an organ core bursting.
- **The Wheel**:
  - Every action now works where you are standing: it falls back to the nearest workable spot, and forced reactions happen within 4 s.
  - New action: *Visit me when I sleep*.
  - Music previews play on without being cut off by the creature's own music cues.
- **Field notes**: 5 new entries (sleep, its home, watcher pods, organ cores, thorns), 32 in all.
- Needs Minecraft 1.26.30+, as 3.0 did. The infected caves only generate in newly generated land.

## 3.0.0 — as dark as it gets
After 2.1 feedback ("it still feels underwhelming"):
- **New soundtrack and voice**, all original: a broken lullaby for when it is near, a pounding clustered score when it is close, a winding-down standoff, a 175 bpm chase, and Hollows music; a new layered roar, rage scream and growl; new jumpscare, reveal sting, static, whispers and a distant scream; Hollows ambience (loop, moods, additions).
- **The Breaker's Wheel**: given on join and after death; makes it do any of 21 things to you on the spot; how hard it is (Easy / Normal / Hard / Nightmare / Harmless: damage, chase speed and length, patience, how readily it snaps) and how often (Rarely / Normal / Often / Relentless); switches for every scare; its mood and what it has learned; sounds and music; finding the Hollows; field notes.
- **The Hollows**: its own huge biome (windswept hills, stony peaks, savannas, badlands) with original structures: mine headframes over real shafts, dead timber, bone piles, cairns, cart wrecks, sinkholes, clawed boulders, plus lair-dressed caves underneath. Its own fog, colours, ambience and music. It is active by day there, its dens grow fast, and chases do not stop at daylight. Needs Minecraft 1.26.30+ and newly generated land.
- **Bigger dens**: flood-filled through the whole chamber: dust carpet, bone ring and clusters, skulls, dozens of hanging spines and webs, claw-scored walls.
- **Scares**: its face in yours (jumpscares), a sting when you spot it, red rage fog and screen shake, a dark fog and darkness pulses in standoffs, thicker air near dens, whispers, words and your name on screen, fourth-wall scares, eyes in the dark that go out when looked at.
- **Smarter**: waits ahead of you round the corner on your path; learns how you treat it (stare, rush, flee, fight, hide, turn your back) and adapts its patience, reactions and placement; targets the weakest player; presses when you are hurt; mimics your sounds; knocks on the door you hide behind at night, then waits outside it.
- **Field notes**: a 27-entry in-game journal unlocked as you witness things (FIELD_NOTES.md has the same text).
- Fixes and checks: engine hits scale with difficulty without double-scaling scripted strikes; the validator now checks biomes, features, structures (NBT palettes), fogs and music definitions; the simulator adds a Hollows scenario and scare/field-note reports.

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

# The Shaftbreaker — adaptive cave dweller for Minecraft Bedrock

An original horror add-on built from your Shaftbreaker model, texture and animations and the design bible. The Shaftbreaker is one tall, stone-boned stalker that follows you through caves (and, at night, through the trees around your house). It wants to be seen, tests you when you see it, creeps closer every time you look away, and snaps into fast, brutal chases — always with a warning first.

**Version 3.0** makes it as dark and frightening as it can be: a new soundtrack and roar, jumpscares, red rage fog, whispers and fourth-wall scares, eyes in the dark, a smarter stalker that learns how you react, **the Breaker's Wheel** to control it and set how hard it is, its own biome **the Hollows**, bigger dens, and in-game **field notes**. See [CHANGELOG.md](CHANGELOG.md) and [FIELD_NOTES.md](FIELD_NOTES.md).

![animation sheet](docs/animation_sheet.png)

- **No experimental toggles.** Stable Script API only: `@minecraft/server` 2.3.0 and `@minecraft/server-ui` 2.0.0.
- **Needs Minecraft Bedrock 1.26.30 or newer** (its custom biome needs it).
- Download: [`dist/Shaftbreaker.mcaddon`](dist/Shaftbreaker.mcaddon). (`tools/build.py` also writes the two packs as separate `.mcpack` files.)

## Install

1. Open `Shaftbreaker.mcaddon` (or import it) so Minecraft adds both packs.
2. In world settings, enable **both** the behavior pack *The Shaftbreaker* and the resource pack *The Shaftbreaker*.
3. Leave Experiments off. Cheats are only needed for the admin commands.
   Upgrading: Minecraft only replaces packs with a higher version, so delete the old *The Shaftbreaker* packs first (Settings > Storage), then import this one; both packs should show 3.0.0. The Hollows only grow in land generated after this version is installed, so use a new world (or travel far) to find them.
4. Go underground, or stay out after dark (any difficulty except Peaceful). About a minute in it arrives; the first time you see it is usually 2–3 minutes in, then every couple of minutes, and the first chase typically comes within 2–9 minutes.
5. You start with **the Breaker's Wheel** (a rusted winding wheel with an eye in it; you get it back after dying). Use it to set how hard it is, switch scares on and off, make it do anything to you on the spot, read its mood and your field notes.
6. Creative-mode players are stalked too, but are never damaged (chases become harmless). Switch it off on the Wheel.

## The Breaker's Wheel

- **Make it do something:** 21 things, on you, now: stand still where you'll see it, watch from a ledge, hang from the ceiling, be right behind you, wait ahead of you round a corner, hide and peek, a standoff, a lunge, snap and chase you, flee, a jumpscare, an ambush, a roar, a whisper, eyes in the dark, a mind game, mimic your sounds, knock on your door, grow a den, send a guide moth, or send it away.
- **How hard it is:** Easy, Normal, Hard, Nightmare or Harmless (damage, chase speed, chase length, patience, how often it snaps instead of leaving), and **how often**: Rarely, Normal, Often, Relentless.
- **Switches:** it can hurt you, jumpscares, mind games, darkness and fog, camera shake, eyes in the dark, mimicry, night stalking, creative-mode stalking, dens, chase music, giving out the Wheel, and what it may break (never / only in dens / natural stone, doors and glass, all put back).
- **Its mood:** how angry it is, whether a chase is due, what it has noticed about how you treat it, and the escapes it has learned; calm it, make it watch you, make it furious, or make it hunt you now.
- **Field notes**, **sounds and music** (hear every track and sound), **find the Hollows**, personal settings, and all the advanced world settings.

Operators get everything; other players get its mood, field notes, finding the Hollows and their personal settings.

## The Hollows (its land)

A huge biome painted over windswept hills, stony peaks, savannas and badlands: grey dust and dead soil, thick brown fog, dead colours, its own ambience and music. Dead timber, abandoned mine headframes over real shafts that drop twenty blocks into the dark, bone piles, cairns, cart wrecks, sinkholes and claw-scored boulders. Underneath, its caves are dressed like a lair: hanging spines, bones, grey dust, webs, claw-scored stone and the odd soul lantern somebody left behind. In the Hollows it is about **by day as well**, its dens grow fast, and a chase does not stop at daylight.

## What you will experience (light spoilers)

- **It arrives silently and stays perfectly still** where you will notice it: on the ground at the edge of your light, on a high ledge above you, hanging upside down from a cave ceiling, right behind you when you turn around, or waiting around the next corner on the path you are walking.
- **Its face in yours:** turn around at the wrong moment, open the door it knocked on, or let it creep close in a standoff, and it is suddenly right in front of you screaming while the screen blinks black.
- **The dark closes in:** red fog and a screen shake when it snaps, a dark fog that thickens during a standoff, darkness pulsing when it is close, thicker air near its dens and in the caves under the Hollows, and two pale eyes in the dark that go out when you look straight at them.
- **Mind games:** whispers just behind your head, words (and sometimes your name) on your screen, and the odd fourth-wall scare. All of it can be switched off on the Wheel.
- **It hides and peeks:** behind real tree trunks at night and behind pillars and corners in caves. Look at it and it ducks back; look away and it peeks out again, from the other side.
- **The standoff:** when you spot it, it tests you with a neck crack, a head tilt, or one slow step while you watch. Every time you look away it is a little closer, and if it gets close enough it lunges when you look back.
- **Its rage:** stare it down too long, shoot it or hit it and it snaps. It screams and comes faster than you can sprint, hitting hard (about four hearts a hit on Normal).
- **Nothing stops it reaching you:** in a chase it climbs walls, pillars, ledges and ladders, crawls through one-block gaps, opens doors, trapdoors and gates, and smashes glass and leaves. Shut yourself in and it goes for the nearest door or window. Everything it opens or breaks is put back afterwards.
- **Run at it** and it decides on the spot: attack, or vanish and ambush you later at a worse moment (when you are hurt, in the dark, with your back turned).
- **It learns how you treat it:** stare it down often and it loses patience sooner; rush it often and it stands its ground; run from chases and it chases harder; fight it and it lunges more; keep checking behind you and it waits ahead instead. It picks the weakest player (hurt, alone), presses harder when you are hurt, mimics your sounds (doors, chests, footsteps, someone eating, your own pickaxe, your hurt cry), and at night knocks on the door you are hiding behind.
- **Lunges and strikes:** it sometimes lunges the moment it is spotted, and strikes if you walk right up to it. It only occasionally vanishes or flees when seen.
- **It vanishes in place** instead of walking away.
- **The soundtrack:** a broken music-box lullaby on warped tape while it is near; a pounding, bit-crushed, clustered score with whispers and static bursts when it is close; a glass whine and a music box winding down to silence in the standoff; a 175 bpm distorted chase with a screaming lead you cannot outrun; and a sparse, haunted theme for the Hollows. It roars with subharmonic growl, a shriek at the peak and a metallic screech, and every sound comes from where it really is; a heartbeat only when it is genuinely close.
- **Scripted moments on top:** a second pickaxe echoing yours, one footstep too many, breathing behind stone, claw marks.
- **Five phases, one body:** Dormant, Stalking, Watching, Breaker, Frenzy. The model never changes shape; only posture, animation, eye glow, speed, sound and decisions change.
- **Chases are frequent but fair:** every chase opens with a scream (or roar), and nothing can hit you within about 1.8 seconds of it; every lunge has a coil and growl first, every close strike a wind-up. Chases have a hard time cap, never follow you into daylight, and end when you break line of sight long enough. Meat, company and preparation still matter.
- **It learns, slowly:** 14 signals (stairs/door/water/pillar/surface escapes, straight mining, stopping to listen, torch use, backing off after swings, shields, traps, grouping, den interference). Two observations make it curious; three or four unlock a cautious response. Signals decay, and failed tactics get weaker.
- **Ecology:** after a few minutes underground (much sooner under the Hollows) a Shaft Den grows through a real chamber nearby, up to about fifteen blocks across: a carpet of grey dust, a ring of bones around the Den Heart, bone clusters and skulls, dozens of hanging spines and webs, and walls scored by its claws. A **guide moth** then flutters up to you and flies toward the den along a real air route, nose pointing the way; if you fall behind it hovers and points at the den until you catch up, then circles the Den Heart. Break the **Den Heart** to quiet the territory for three in-game days. It remembers.
- **Trophy:** defeat it (112 HP; lethal hits turn into a scripted collapse) for the **Shaftbreaker Skull**: a wearable helmet (protection 2) with optional underground night vision.

## Settings

Craft the **Resonance Dial** (copper ingots + redstone + an amethyst shard or a Resonance Shard) and use it:

- **Status:** a resonance needle, encounter counts, what it has learned about *you* in plain words, and a rough direction to the nearest den.
- **Personal settings** (every player): reduced audio, reduced flicker, no chase music, threat captions in the action bar, heartbeat on/off, trophy filter.
- **World settings** (operators): preset (`atmospheric`, `balanced`, `relentless`, `harmless`, `accessibility`), frequency, stalking intensity, learning, memory decay, block destruction (`off` / `den` / `natural`), cosmetic build alteration, den generation, torch manipulation, max hunt length, death grace, chase music, quiet-hunt variant, surface mode, harmless preview, trophy drop, debug logging, creative-mode stalking, night stalking on the surface.

Admin commands (operators):

```
/shaftbreaker:sb status
/shaftbreaker:sb preset relentless
/shaftbreaker:sb set maxHuntSeconds=20
/shaftbreaker:sb debug                (action-bar overlay: state, phase, encounter, learned weights)
/shaftbreaker:sb list                 (all encounter templates)
/shaftbreaker:sb encounter corner_peek
/shaftbreaker:sb telemetry            (last encounters with trigger / tell / counterplay)
/shaftbreaker:sb stop
```

Every action also works as `/scriptevent shaftbreaker:<action> [value]`.

## How it works

| Part | File | Job |
|---|---|---|
| Scares | `scripts/scare.js` | Fogs (near, rage, territory), darkness pulses, camera shake, the reveal sting, jumpscares, whispers, mind games and eyes in the dark; every one behind a Wheel switch and rate-limited by difficulty. |
| Field notes | `scripts/notes.js` | The 27-entry journal and what unlocks each entry. |
| The Wheel | `scripts/ui.js` | The Breaker's Wheel and the Resonance Dial. |
| The Hollows | `tools/gen_world.py` | Biome, client biome, fogs, three blocks, original `.mcstructure` templates and the surface and cave features. |
| Stalker | `scripts/ai/encounters/stalk.js` | The visible stalker: show placement (still / ledge / ceiling / behind / peek behind trunks and pillars), the peek game, the standoff (tests, stare limit, creeping on look-away), reactions (vanish, flee, lunge, rage, standoff), run-at decisions, close strikes and the promised ambush. |
| Breaching | `scripts/world/breach.js` | Opening doors / gates / trapdoors and smashing glass and leaves during a chase, finding a way in when you are shut inside, and putting every change back (persisted across reloads). |
| Brain | `scripts/ai/brain.js` | The persistent stalker between shows: arrival out of sight, distance bands that depend on its mood, giving ground when approached, freezing when caught, catching up through the dark, positional sound cues, presence/close music and the proximity heartbeat. |
| Director | `scripts/ai/director.js` | The stalker clock (a show every ~1–3 minutes, a chase due every ~4–6.5 minutes, the ambush), rage on hits and shots, per-player pacing clocks for the other encounters (minor events every 1–2.5 min; occasional major encounters), a curiosity meter and an event-driven provocation meter that drive Dormant → Interested → Observing → Provoked → Hunting, novelty-aware weighted selection (design mix: stalking 30, uncanny 20, audio 15, environment 15, standoff 10, hunt 8, rare 2), multiplayer target choice and witness sharing. |
| Memory | `scripts/ai/memory.js` | The 14 bounded signals (score + confidence, saturation, decay, counter-learning), stored on each player. |
| Encounters | `scripts/ai/encounters/*.js` | 44 templates written as generators: each has a trigger, a tell and a counterplay recorded in telemetry. |
| Creature | `scripts/ai/creature.js` | The world singleton: phases, acts, eye glow, tunnel stance (stand / crouch in 2-high / spider-crawl in 1-high), script-driven movement along a flood-filled walk map of the real cave (physics steering with a step fallback, so it cannot get wedged), engine pathfinding only for hunts with a scripted chase fallback, stuck detection, the Breaker, strikes and the scripted defeat. |
| Space | `scripts/world/space.js` | Perception (line of sight, gaze angle, light, underground) and a flood-filled walk map of the real cave around you. It never places the creature in a sealed pocket or in anyone's direct view. |
| Protection | `scripts/world/protection.js` | Block provenance: natural cave materials only, never ores/containers/beds/portals/spawn, never anything you were seen placing, never anything next to something player-made, never the surface. |
| Dens | `scripts/world/den.js` | Den growth in real chambers (from the stalker's own walk map), guide moths with A* air routes, cleansing, territory suppression, retaliation, the hidden passage. |

### Fairness contract (enforced in code)

- Only one Shaftbreaker exists per world; a spawn egg either replaces it or is removed, never adding a second.
- Damage only in chases, lunges and close strikes, each with its tell; never through walls or closed doors (it opens or breaks them first), never during death/respawn grace.
- Spawns are dark, reachable, and outside every nearby player's view cone.
- Chases end on a time cap, a lost path, distance, daylight, death or a disabled world, and the creature then vanishes where it stands.
- Everything it opens or smashes (doors, gates, trapdoors, glass, leaves) is restored once the chase is over and nobody stands in the way; leftovers are restored on the next world load.
- Harmless preset: no damage and no block edits, even in forced hunts.

## Assets and originality

- **Model, texture and the 10 base animations** are the ones you supplied (`src_assets/model`).
- **50 new animation clips** (tunnel crouch/crawl, peeks, listening, prone drop, kneel, ceiling hang/reach/drop, wall climb, attacks, recovery, scramble, collapse, …) were authored in code against the rig (`tools/author_anims.py`), with the tunnel poses fitted by an optimizer so they really fit 2-high and 1-high passages.
- **All 98 sound files, including the five music tracks (presence, close, standoff, chase, the Hollows),** are procedurally synthesized (`tools/gen_audio.py`): original melodies and sound design in a 2000s creepypasta style. Nothing is sampled, sliced or transcribed from Minecraft, any other add-on, or any game. Mimicry plays a few of Minecraft's own sounds (doors, chests, footsteps, eating, mining, the player's hurt sound) by their vanilla sound IDs.
- **The Hollows' structures** are original designs written as `.mcstructure` files by `tools/gen_world.py`.
- **Moth, den blocks, item icons, particles** are generated (`tools/gen_textures.py`, `tools/gen_rp.py`).
- Inspired by the cave-dweller genre; it contains no code, assets or names from XP Games' or Gargin's work.

## What was and was not verified

Verified here:
- Every script API call type-checks against Mojang's official `@minecraft/server` 2.3.0 / `@minecraft/server-ui` 2.0.0 typings.
- `tools/validate.py`: every animation, controller, geometry, bone, locator, texture, sound event and file, particle, entity event, component group, property, loot table, recipe item and vanilla block/item/effect ID and vanilla render controller resolves (0 errors) — checked against Mojang's vanilla data for 1.26.60. It also fails the build on the two 1.0 bugs: render controllers reading `context.*` variables, and blocks with material instances but no geometry.
- `tools/sim`: the real scripts run unmodified against a mock of the Script API in a voxel world (caves, a surface forest, a house with a door and glass windows, a Hollows region) with bot players that stare at it, run at it, hit it, shoot it, flee and hide indoors; 30–60 simulated minutes per run in eight scenarios (1–3 players; mixed, stairs, learning, harmless, night and Hollows). 3.0 results: 0 script errors; never more than one Shaftbreaker; 0 spawns or silent teleports inside anyone's view (the only visible relocations are deliberate vanishes and jumpscares); 0 ticks inside blocks; every hit preceded by its tell; every opened door and smashed window restored; harmless preset with 0 hits and 0 block edits. Every new scare fired (paired fog pushes and removals, camera shakes, jumpscares, reveal stings, whispers, eyes in the dark, mind games, mimicry, door knocks), 15–23 field notes unlocked per solo hour, and in the Hollows scenario it stalked and chased by day on the surface. Against bots that never fight back it is lethal (3–13 deaths an hour on Normal); use the Wheel's difficulty if real play is too much or too little.
- Audio: every referenced sound file exists and decodes; peaks at or below −1 dBFS; the five music tracks mastered to the same loudness with seamless loops (measured at the loop seam).

Not verified: **it has not been run inside the Minecraft client** (no Bedrock client here; a Bedrock Dedicated Server test was not run). That includes the Hollows world generation, the fogs and the jumpscare timing, which only the real game can show; the sounds were checked by measurement and spectrogram, not by ear. The simulator models the API and approximates the engine's pathfinding and attacks, so in-game tuning may still be needed — most likely movement speeds, encounter frequency and the look of some new animations in motion. Please report what you see; the debug overlay and `/shaftbreaker:sb telemetry` exist for exactly that.

Known limitations:
- Dens are grown by script near players (not world-generation structures), so they appear in chambers you have been near.
- The Script API cannot tell whether a stone block was placed by a player before the add-on was installed. The Breaker therefore only touches natural materials with nothing player-made around them; set block destruction to `den` or `off` if your builds use raw stone or deepslate.
- Distance-based mob speeds are tuning targets, not measured in-game values.

## Building from source

```bash
python3 tools/build.py
```

Optional: `--audio` re-synthesizes all sounds; `--vanilla-data <path>` and `--vanilla-rp <path>` enable vanilla ID checks. Requires Python 3 with numpy and Pillow, and ffmpeg with libvorbis.

```bash
node tools/sim/run.js 120 1 7 mixed
```

Scenarios: `mixed`, `learn`, `harmless`, `stairs`, `door`, `night`; arguments are minutes, players, seed and scenario.

Type-check every API call against Mojang's official typings:

```bash
cd tools/typecheck && npm install && npx tsc -p .
```

See [FEATURES.md](FEATURES.md) for the L01–L90 / N01–N50 audit.

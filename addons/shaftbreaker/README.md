# The Shaftbreaker — adaptive cave dweller for Minecraft Bedrock

An original horror add-on built from your Shaftbreaker model, texture and animations and the design bible. The Shaftbreaker is one tall, stone-boned stalker that follows you through the caves, mostly *watches*, learns how you escape, and only rarely hunts — always with a warning first.

**Version 2.0** is a full overhaul after 1.0 feedback (skull Molang error, untextured blocks, a creature that rarely did anything, moths that never led anywhere). See [CHANGELOG.md](CHANGELOG.md).

![animation sheet](docs/animation_sheet.png)

- **No experimental toggles.** Stable Script API only: `@minecraft/server` 2.3.0 and `@minecraft/server-ui` 2.0.0.
- **Needs Minecraft Bedrock 1.21.120 or newer** (any 1.26.x release works).
- Download: [`dist/Shaftbreaker.mcaddon`](dist/Shaftbreaker.mcaddon). (`tools/build.py` also writes the two packs as separate `.mcpack` files.)

## Install

1. Open `Shaftbreaker.mcaddon` (or import it) so Minecraft adds both packs.
2. In world settings, enable **both** the behavior pack *The Shaftbreaker* and the resource pack *The Shaftbreaker*.
3. Leave Experiments off. Cheats are only needed for the admin commands.
4. Go underground (any difficulty except Peaceful). After roughly a minute below ground it arrives somewhere out of sight; you will start hearing it within the first couple of minutes, and the first real encounter usually comes 3–5 minutes in.
5. Creative-mode players are stalked too, but are never damaged (hunts become harmless chases). Operators can turn this off in world settings.

## What you will experience (light spoilers)

- **It is always somewhere near:** once it arrives it stays, shadowing you 20–40 blocks away through the real cave, keeping to the dark and out of your line of sight. Walk toward it and it gives ground; corner it and it is simply gone. Catch it looking and it freezes, stares, then slips away.
- **You can hear where it is:** clicks, scrapes, breathing, knocks and footsteps play from its real position. Two original music beds follow its real distance (a low *presence* bed while it is around, a tenser *close* bed when it is within ~14 blocks or you have just seen it), and a heartbeat only when it is genuinely close.
- **Scripted moments on top:** a second pickaxe echoing yours, one footstep too many, breathing behind stone, claw marks, a shape at the edge of your view, a figure that will not move. These borrow the same creature and hand it back afterwards.
- **Five phases, one body:** Dormant, Stalking, Watching, Breaker, Frenzy. The model never changes shape; only posture, animation, eye glow, speed, sound and decisions change.
- **Hunts are rare and fair:** every hunt opens with a roar (or, ultra-rarely, dust + breathing + a raised claw) and a 2–3 second window before anything can hit you. Frenzy has a hard time cap. Light, company, doors, water, height, bait and preparation all matter.
- **It learns, slowly:** 14 signals (stairs/door/water/pillar/surface escapes, straight mining, stopping to listen, torch use, backing off after swings, shields, traps, grouping, den interference). Two observations make it curious; three or four unlock a cautious response. Signals decay, and failed tactics get weaker.
- **Ecology:** after a few minutes underground a Shaft Den grows in a real chamber nearby. A **guide moth** then flutters up to you and flies toward the den along a real air route, nose pointing the way; if you fall behind it hovers and points at the den until you catch up, then circles the Den Heart. Break the **Den Heart** to quiet the territory for three in-game days. It remembers.
- **Trophy:** defeat it (112 HP; lethal hits turn into a scripted collapse) for the **Shaftbreaker Skull**: a wearable helmet (protection 2) with optional underground night vision.

## Settings

Craft the **Resonance Dial** (copper ingots + redstone + an amethyst shard or a Resonance Shard) and use it:

- **Status:** a resonance needle, encounter counts, what it has learned about *you* in plain words, and a rough direction to the nearest den.
- **Personal settings** (every player): reduced audio, reduced flicker, no chase music, threat captions in the action bar, heartbeat on/off, trophy filter.
- **World settings** (operators): preset (`atmospheric`, `balanced`, `relentless`, `harmless`, `accessibility`), frequency, stalking intensity, learning, memory decay, block destruction (`off` / `den` / `natural`), cosmetic build alteration, den generation, torch manipulation, max hunt length, death grace, chase music, quiet-hunt variant, surface mode, harmless preview, trophy drop, debug logging.

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
| Brain | `scripts/ai/brain.js` | The persistent stalker: arrival out of sight, distance bands that depend on its mood, giving ground when approached, freezing when caught, catching up through the dark, positional sound cues, presence/close music and the proximity heartbeat. |
| Director | `scripts/ai/director.js` | Per-player pacing clocks (minor events every 1–2.5 min; major encounters every 4–7.5 min for a solo player; 5–8 min grace after a hunt), a curiosity meter and an event-driven provocation meter that drive Dormant → Interested → Observing → Provoked → Hunting, novelty-aware weighted selection (design mix: stalking 30, uncanny 20, audio 15, environment 15, standoff 10, hunt 8, rare 2), multiplayer target choice and witness sharing. |
| Memory | `scripts/ai/memory.js` | The 14 bounded signals (score + confidence, saturation, decay, counter-learning), stored on each player. |
| Encounters | `scripts/ai/encounters/*.js` | 44 templates written as generators: each has a trigger, a tell and a counterplay recorded in telemetry. |
| Creature | `scripts/ai/creature.js` | The world singleton: phases, acts, eye glow, tunnel stance (stand / crouch in 2-high / spider-crawl in 1-high), script-driven movement along a flood-filled walk map of the real cave (physics steering with a step fallback, so it cannot get wedged), engine pathfinding only for hunts with a scripted chase fallback, stuck detection, the Breaker, strikes and the scripted defeat. |
| Space | `scripts/world/space.js` | Perception (line of sight, gaze angle, light, underground) and a flood-filled walk map of the real cave around you. It never places the creature in a sealed pocket or in anyone's direct view. |
| Protection | `scripts/world/protection.js` | Block provenance: natural cave materials only, never ores/containers/beds/portals/spawn, never anything you were seen placing, never anything next to something player-made, never the surface. |
| Dens | `scripts/world/den.js` | Den growth in real chambers (from the stalker's own walk map), guide moths with A* air routes, cleansing, territory suppression, retaliation, the hidden passage. |

### Fairness contract (enforced in code)

- Only one Shaftbreaker exists per world; a spawn egg either replaces it or is removed, never adding a second.
- Damage only during hunts or the two telegraphed counters, never in Dormant, never through walls or closed doors, never during death/respawn grace.
- Spawns are dark, reachable, and outside every nearby player's view cone.
- Hunts end on a time cap, a lost path, distance, daylight (unless surface mode), death or a disabled world, and the creature then retreats out of sight.
- Harmless preset: no damage and no block edits, even in forced hunts.

## Assets and originality

- **Model, texture and the 10 base animations** are the ones you supplied (`src_assets/model`).
- **50 new animation clips** (tunnel crouch/crawl, peeks, listening, prone drop, kneel, ceiling hang/reach/drop, wall climb, attacks, recovery, scramble, collapse, …) were authored in code against the rig (`tools/author_anims.py`), with the tunnel poses fitted by an optimizer so they really fit 2-high and 1-high passages.
- **All 70 sound files, including the four music tracks (presence, close, standoff, chase),** are procedurally synthesized (`tools/gen_audio.py`); no sound is taken from Minecraft or any other add-on.
- **Moth, den blocks, item icons, particles** are generated (`tools/gen_textures.py`, `tools/gen_rp.py`).
- Inspired by the cave-dweller genre; it contains no code, assets or names from XP Games' or Gargin's work.

## What was and was not verified

Verified here:
- Every script API call type-checks against Mojang's official `@minecraft/server` 2.3.0 / `@minecraft/server-ui` 2.0.0 typings.
- `tools/validate.py`: every animation, controller, geometry, bone, locator, texture, sound event and file, particle, entity event, component group, property, loot table, recipe item and vanilla block/item/effect ID and vanilla render controller resolves (0 errors) — checked against Mojang's vanilla data for 1.26.60. It also fails the build on the two 1.0 bugs: render controllers reading `context.*` variables, and blocks with material instances but no geometry.
- `tools/sim`: the real scripts run unmodified against a mock of the Script API in a voxel cave world with bot players for 30–60 simulated minutes per run (1–3 players, several seeds, mixed, stairs, learning and harmless scenarios). 2.0 results: 0 script errors; never more than one Shaftbreaker; 0 spawns inside a player's view; 0 ticks inside blocks; 0 silent teleports inside anyone's view (the only visible relocations are deliberate vanishes with their dust cloud and sound); every hit preceded by a telegraph; the creature present for ~90–97% of underground time at a mean 25–45 blocks and in view only 2–8% of it; first sound cue at ~2 min, first major encounter at 2.8–5.2 min, major gaps of ~5–8 min for a solo player; guide moths reach the Den Heart and face their direction of travel 100% of the time; harmless preset with 0 hits and 0 block edits.

Not verified: **it has not been run inside the Minecraft client** (no Bedrock client here; a Bedrock Dedicated Server test was not run). The simulator models the API and approximates the engine's pathfinding and attacks, so in-game tuning may still be needed — most likely movement speeds, encounter frequency and the look of some new animations in motion. Please report what you see; the debug overlay and `/shaftbreaker:sb telemetry` exist for exactly that.

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

Scenarios: `mixed`, `learn`, `harmless`, `stairs`, `door`; arguments are minutes, players, seed and scenario.

Type-check every API call against Mojang's official typings:

```bash
cd tools/typecheck && npm install && npx tsc -p .
```

See [FEATURES.md](FEATURES.md) for the L01–L90 / N01–N50 audit.

# TAILWAIL

*It lives in the dark under the world. It watches you for a moment. Then it comes, faster
than you can run.*

An original dweller-style horror add-on for **Minecraft: Bedrock Edition**, built around one
creature: Tailwail, a ~15-foot primate-like thing that folds itself small to fit in caves.
It watches you from the dark, hangs from cave ceilings, balls up in corners, runs across
the fields at night, crushes itself flat to come through 1-block gaps, and when it is
provoked it hunts you on all fours, faster than a sprinting player, until it gets you or
you break away.

Ordinary behavior + resource packs. Stable scripting only, **no experimental toggles**, no
cheats needed to play.

| | |
|---|---|
| Version | **3.1.0** |
| Game | Bedrock **1.26.60** or newer (manifest `min_engine_version [1, 26, 60]`); runtime-tested on Bedrock Dedicated Server **1.26.61.1** |
| Script modules | `@minecraft/server` **2.11.0**, `@minecraft/server-ui` **2.3.0** (both stable) |
| Download | [`dist/Tailwail_3.1.0.mcaddon`](dist/) (+ separate `.mcpack`s and `SHA256SUMS.txt`) |
| Ids | creature `tailwail:tall_wail` · spawn egg "Tailwail Spawn Egg" · journal `tailwail:field_guide` |

![Key states and attacks: offline renders of the shipped model and clips through the real controllers (not in-game screenshots)](docs/images/pose_board.png)

## Install (and upgrading from 1.x / 2.x / 3.0)

1. Open `Tailwail_3.1.0.mcaddon` on the device that runs Minecraft (it imports both packs).
2. World settings → **Behavior Packs** → activate **TAILWAIL 3.1.0 (Behavior)**, and check
   that **TAILWAIL 3.1.0 (Resources)** is active under Resource Packs. Leave every
   experiment off.
3. When you join, the chat shows **"Resource pack 3.1.0 active: animations and sounds
   loaded."** If it shows
   `TAILWAIL_RESOURCE_PACK_3.1.0_IS_NOT_ACTIVE-re-apply_TAILWAIL_Resources_to_this_world`
   instead, the world is still using an old copy of the resource pack: nothing will
   animate and the new sounds will be silent. Remove both TAILWAIL packs from the world,
   (on phones, also delete the old ones under Settings → Storage), re-import the
   .mcaddon and apply both 3.1.0 packs again.
4. Play in Survival. Go underground, or stay outside at night.

**Want to see it right away?** Use the spawn egg somewhere dark. An egg Tailwail gets to
the hunt quickly. Operators can also run `/tailwail:debug anim` to watch every animation
in turn on a harmless copy.

## What it does

**Before it hunts you (the haunting).** Things only *you* hear or see: footsteps that stop
when you stop and take one more step; heavy running steps that stop right behind you;
your own sounds repeated from the dark; claws scraping inside the rock; knocks; breathing
behind your head; your name, whispered; torches going out; a door opening by itself, or
something hammering on it; a tall shape at the edge of the light; something huge running
across the dark; a face at your window; a scream, far away; the bed visit. It escalates
through four stages the more you play.

**The encounter.**
1. **It shows itself**, for seconds: watching from the dark, standing at full height at
   the treeline, peeking around a corner, or running across your view. Spot it and it
   reacts in a quarter of a second: it charges, bolts and reappears closer, or holds your
   stare.
2. **Ambushes** (caves): spread flat on the ceiling like a spider, face rolled the right
   way up, it drops when you walk underneath; balled up in a corner like a heap of rock
   and hair, it whips round when you come close; or it is crouched right behind you.
3. **The stand-off is an observation.** It stands idle, watching; it approaches slowly; or it
   tests you: a bluff charge that stops dead in front of you, a sidestep, backing off to see
   if you follow, its neck craning toward you. It reads how you react. Staring at it too
   long, shooting at it (or throwing anything at it), hitting it, coming too close or
   turning your back sets it off. Or it simply decides.
4. **The scream**: silence, it unfolds to its full height, then the wail. The screen
   shakes, darkness pulses, every torch around goes out. Provoke it and there is no scream:
   a roar, and it is already running.
5. **The hunt**: the Cave Dweller's chase speed, **7.8 blocks per second** on all fours (you
   sprint at 5.6), and its rhythm: an attack every second while you are in reach. It rakes,
   combos, slams the ground, pounces from 10 blocks away. It climbs walls, smashes through
   doors and glass, squeezes through tight tunnels, and **crushes itself flat to crawl through
   1-block gaps**. After a slam or a pounce it stands over you for a moment, then hunts on.
   No time limit while it can see or hear you.
6. **Losing it**: break line of sight and get distance, wall off the gap behind you, or
   crouch in the dark. It searches, sniffing and listening, and howls when it gives up.
   Sometimes it only pretends to leave.
7. **Fighting it**: hurt it badly enough and it screams and runs. It remembers.

**Torches it puts out stay out** (a burnt-out stick) until you relight them with flint and
steel, a fire charge or another torch. **It remembers you**: your habits, what you did last
time, and it uses them.

Full rules: [docs/PLAYER_GUIDE.md](docs/PLAYER_GUIDE.md) (spoilers).

## Settings

The journal's **Settings** page (or `/tailwail:settings`) has two sections.
- **Per player:** volume, camera effects (off / reduced / full), music, fog, captions,
  forget-me.
- **Operators:** difficulty (Calm / Standard / Nightmare / Custom), encounter frequency,
  haunting level, jumpscares, torch snuffing, cave and night encounters, doors, what it
  breaks through (nothing / doors / doors and glass), climbing, ambushes, rake damage, how
  long until it loses you, and max creatures.

Full list: [docs/CONFIGURATION.md](docs/CONFIGURATION.md). Operator diagnostics:
`/tailwail:debug status | anim [clip] | spawn [setup] | presence [event] | stage <0-3> | end | restore`.

## What has been verified (and what has not)

- **Static:** `tools/validate.py` passes all 14 check groups with 0 errors:
  - the TypeScript check against the stable 2.11.0 / 2.3.0 typings;
  - every vanilla sound id checked against the 1.26.60 vanilla pack;
  - one-shot lengths and hit frames match the clips;
  - generator reproducibility (the whole animation file is re-baked and byte-compared).
- **Client:** `tools/client_sim.py` parses every Molang string and simulates the
  controllers at 60 fps: every act-to-act transition, random schedules, the failure mode
  where the pre-animation script does not run at all, grounding of every state and every
  one-shot, tunnel and 1-block-gap fit. 0 errors.
- **Unit tests:** 51/51 (`node --test tests/*.test.mjs`).
- **Runtime on BDS 1.26.61.1** with a scripted stand-in player: see
  [docs/TESTING.md](docs/TESTING.md) (the observation stand-off, provocation, hunt speed,
  attacks, the 1-block squeeze, ambushes, climbing, door smashing, night-surface
  encounter, haunting events, cleanup, performance).
- **Not verified:** nothing has been played on a real game client. Animations, sounds,
  fog, music and camera effects have only been checked offline (simulation, spectrograms,
  renders). See [docs/LIMITATIONS.md](docs/LIMITATIONS.md).

## Documentation

| | |
|---|---|
| [docs/PLAYER_GUIDE.md](docs/PLAYER_GUIDE.md) | Everything it does, every cue, every way out |
| [docs/CONFIGURATION.md](docs/CONFIGURATION.md) | Settings, presets, preferences, commands |
| [docs/DESIGN.md](docs/DESIGN.md) | Architecture, state machine, the observation, attacks, squeezing, ambushes, cleanup guarantees |
| [docs/ANIMATION_AUDIO.md](docs/ANIMATION_AUDIO.md) | The animation system (and why it cannot freeze), every clip, the sound palette |
| [docs/TESTING.md](docs/TESTING.md) | How to run every check, and the results |
| [docs/ASSETS.md](docs/ASSETS.md) | Asset inventory, generators, what changed in the supplied files |
| [docs/TARGET_VERSIONS.md](docs/TARGET_VERSIONS.md) | Version choice and the stable APIs used |
| [docs/COMPETITIVE_BASELINE.md](docs/COMPETITIVE_BASELINE.md) | What the genre does, and how Tailwail answers it |
| [docs/LIMITATIONS.md](docs/LIMITATIONS.md) | Known limitations |
| [docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md) | Status and next steps |

## Building from source

```bash
python3 -I tools/build_assets.py
```

```bash
python3 -I tools/anim_v3.py
```

```bash
python3 -I tools/gen_client_v3.py
```

```bash
python3 -I tools/gen_audio_v2.py
```

```bash
python3 -I tools/gen_assets_v2.py
```

```bash
python3 -I tools/package.py
```

In order: copy the model and texture from the supplied archive (the texture with its two
pale pupils painted out); bake every clip; write the
client entity, controllers and script ids; synthesize every sound; write the block, fog,
particle, lang and manifest files. `package.py` validates, then writes `dist/`.

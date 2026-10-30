# Design

## Goals

1. **Pressure, not just jumpscares.** The core loop is a dilemma the player feels every
   second: *look at it and it gets angry; look away and it comes closer.*
2. **Uncanny over gory.** It moves wrong, holds poses wrong, copies you wrong, breathes
   where nothing should be. It repeats *your* sounds.
3. **Readable and fair.** Every escalation has a visible and audible sign. The commitment
   (silent rise, then scream) is never a bluff and never skipped. It never hits through
   walls, and every chase can be escaped.
4. **It never leaves the player broken.** Camera, FOV, fog, music, input locks and HUD
   titles are tracked and always restored.

## Architecture

```
scripts/
  main.js              startup: custom block component, slash commands, world load
  config.js            every tuning number
  core/   (pure, unit-tested, no Minecraft imports)
    brain.js           encounter state machine
    agitation.js       stare / proximity / sprint / hit model
    gestures.js        gesture detection + delayed, distorted imitation
    memory.js          bounded per-player behavioural memory
    scheduler.js       eligible-time waits, escalation stages, cooldowns
    presence_rules.js  which haunting event, when; vanilla sound mapping for mimicry
    setups.js          the 8 encounter openings
    combat_rules.js    grab reach, strike resolution, struggle
    audio_rules.js     sound cue table + limiters
    journal.js         journal pages and unlock flags
    ids.js             GENERATED numeric ids shared with the client controllers
  mc/     (adapters)
    director.js        per-player scheduling, presence, spawning, events, sweep
    encounter.js       one live encounter: perception snapshot -> brain -> world
    presence.js        the haunting events
    grab.js            lift / hold / struggle / release with guaranteed unlock
    fx.js              player effects manager (music, fog, FOV, shake, heartbeat, input, titles)
    torches.js         snuff / relight + the block's custom component
    echo.js            hallucination entities
    mover.js           pathing via an invisible lure + posture selection
    perception.js      line of sight both ways, on-screen test, light, hiding
    spots.js           every position search (bounded, loaded chunks only)
    terrain.js, store.js, audio.js, ui.js, commands.js, log.js
```

The brain is pure. It receives a perception snapshot every 0.2 s and calls an adapter
(`ctx`) to move, play cues, request player effects, grab, strike and despawn. The same class
runs in Node unit tests with a mock adapter, and in the game.

## Encounter state machine

```
stalk ──notice+stare / walk up──▶ standoff ──agitation max / too close / hit──▶ unfold
  │                                  │                                          │ 2.0 s (1.2 low)
  │ hidden 12 s / slink / expired    │ calm + distance / hidden 8 s / timeout   ▼
  ▼                                  ▼                                        scream 1.8 s
retreat ◀───────────────────────── retreat                                      │
  ▲                                                                             ▼
  │                                                           windup 1.0 s (drops to all fours)
  │                                                                             │
frustrated ◀── search ◀── out of sight 6 s + 14 blocks / budget ── chase ◀──────┘
               (sniff, listen, noise)                               │  ▲
                                                     reach + room   ▼  │ struggle free / thrown
                                                                    grab (lift, hold 2.6 s, throw | bite)
```

Every state has a hard time ceiling, and overstaying always resolves somewhere safe.
`death` can interrupt anything: during a grab it releases the victim first.

**Statue creep.** In the stand-off, the adapter reports `anyInView`: any eligible player
has any body point within ~72° of their view centre with a clear line of sight. That
threshold covers every in-game FOV setting. While `anyInView` it holds and performs (head
tilt, neck stretch, owl turn, jaw unhinge, crouch) at a rate that rises with agitation.
After 0.3 s unwatched, it bursts toward the target along a line-of-sight-checked path
(≤ 3.5 blocks, ≤ 1.6 s, ~5.9 blocks/s). It stops the instant it is in view and takes a
new statue pose.

**Agitation** (0–100): staring beyond a 2 s grace budget (+4/s), being within 8 blocks,
approaching it, sprinting near it, and hitting it raise it. Backing away calmly lowers it.
It is shown through tail (drag, twitch, curl), breath (calm, heavy, frantic), tremor (0–3),
jaw angle, clicks, heartbeat rate and FOV.

**Grab.** Reach ≤ 2.9 blocks, line of sight, facing within ~72°, its headroom ≥ 4, and two
open blocks at the hold point. Otherwise it strikes. The grab controller:
- locks lateral movement, camera and sneak (Jump stays live for the struggle);
- applies slow falling;
- teleports the victim every tick into its hands, facing its face (offsets measured from
  the hold clip);
- shows the struggle bar.

Release paths: free, throw, bite, abort (death, end, disconnect), and lost (victim died,
left or changed dimension). Every one of them unlocks input and clears the title.

## Presence and escalation

The director ticks every player once a second. Two waits count down **only in eligible
time** (underground, or outside at night): the next encounter and the next haunting.
Hauntings are picked by `presence_rules.js`:
- filtered by escalation stage, per-event cooldowns, world facts (a torch behind you, a
  door nearby) and settings;
- never the same event twice in a row.

Stages only rise: 3 hauntings or 6 eligible minutes, then the first encounter, then 4
encounters or 2 escapes. Setups and hauntings unlock with stage.

## Multiplayer

- One authority per creature (the Encounter that owns it); at most 3 at once, default 2.
- A group within 24 blocks shares one encounter, targeting the player in the most
  darkness.
- Anyone watching freezes the statue, but only the target's behaviour raises agitation.
  A bystander's hit can retarget a stalking or stand-off encounter once.
- Hauntings, music, fog, FOV and heartbeat belong to the target alone. Screams shake
  everyone nearby.

## Cleanup guarantees

`fx.js` tracks music, fog, FOV, input locks, heartbeat and titles per player. They are
cleared:
- when an encounter ends (any outcome);
- when the player dies, joins or respawns: clearAll runs unconditionally, so a crash
  mid-grab cannot leave a player locked;
- on world load, for everyone.

Echoes never persist (swept on load and periodically). Lure entities without a live owner
are removed. `/tailwail:debug restore` is the manual override.

## Memory

Per player, bounded (≤ 900 bytes), versioned, decaying: gestures it saw (count, weight,
pitch), outcomes, reactions (approach, flee, attack, hide, stare) and recent setups. It
picks openings (never the same twice in a row), opens later encounters with a remembered
gesture, and makes the *rehearsal* replay your habits. It never raises damage and never
shortens the commitment.

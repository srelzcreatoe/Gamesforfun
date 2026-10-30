# Design

## Goals (v3)

v2 was "underwhelming": a statue that held still while you looked at it, a long stand-off,
and after one grab it bit you and wandered off. v3 is built around the opposite:

1. **Quick to action.** It shows itself in seconds, the stand-off lasts seconds, and once
   it screams it hunts you at 8.4 blocks/s (Standard), faster than you can sprint.
2. **Relentless.** No pursuit budget while it can see or hear you. After it hurts you it
   savours it for a moment and hunts on. It loses you only when you break line of sight
   and get distance, or hide in the dark, and even then it sometimes comes back.
3. **Never the same twice.** Several attacks chosen by range and chance. A grab struggle
   whose input, length and timing change every time, can shift halfway, and is sometimes
   unbreakable. Openings that differ between caves and the night surface.
4. **Always visibly alive.** Every animation loops with breathing, twitches and restless
   fingers. Nothing freezes on a held frame.
5. **It never leaves the player broken.** Camera, FOV, fog, music, input locks and HUD
   titles are tracked and always restored.

## Architecture

```
scripts/
  main.js              startup: custom block component, slash commands, world load
  config.js            every tuning number
  core/   (pure, unit-tested, no Minecraft imports)
    brain.js           encounter state machine (v3 hunter)
    combat_rules.js    attack choice, hit reach, struggle spec, finishers
    agitation.js       stand-off pressure model (stare / proximity / sprint / hit)
    gestures.js        gesture detection + delayed, distorted imitation
    memory.js          bounded per-player behavioural memory
    scheduler.js       eligible-time waits, escalation stages, cooldowns
    presence_rules.js  which haunting event, when; vanilla sound mapping for mimicry
    setups.js          the 11 encounter openings (cave / surface / anywhere)
    audio_rules.js     sound cue table + limiters
    journal.js         journal pages and unlock flags
    ids.js             GENERATED: act ids, one-shot table, resource-pack check key
  mc/     (adapters)
    director.js        per-player scheduling, presence, spawning, returns, events, sweep
    encounter.js       one live encounter: perception snapshot -> brain -> world
    actions.js         ceiling / corner ambush spots, runner path, climbing, door & glass
                       smashing, "is the player in a hole too low for it"
    presence.js        the haunting events
    grab.js            lift / hold / varied struggle / release with guaranteed unlock
    fx.js              player effects manager (music, fog, FOV, shake, heartbeat, input, titles)
    torches.js         snuff / relight + the block's custom component
    echo.js            hallucination entities
    mover.js           pathing via an invisible lure + posture selection
    perception.js      line of sight both ways, on-screen test, light, hiding
    spots.js           every position search (bounded, loaded chunks only)
    terrain.js, store.js, audio.js, ui.js, commands.js, log.js
```

The brain is pure. It receives a perception snapshot every 0.1 s and calls an adapter
(`ctx`) to move, play one-shot clips and cues, request player effects, grab, deal damage,
climb, bash, cling and despawn. The same class runs in Node unit tests with a mock
adapter, and in the game.

## Encounter state machine

```
stalk (1-3 beats: watch | tall | peek | cross) ──seen──▶ charge ─────────────┐
   │ bolt: out of sight, next beat closer                                    │
   └──beats done / held stare / walked up──▶ standoff (4-10 s) ──────────────┤
         creeps even while watched; turn away 0.8 s, too close, hit: charge  │
ambush: cling (ceiling) ──you pass under / stare──▶ drop ───────────────────┤
        huddle (corner)  ──you come close / stare──▶ turn ───────────────────┤
        behind you       ──you turn round──────────▶ roar ───────────────────┤
the hunter / the return ─────────────────────────────────────────────────────┤
                                                                             ▼
                                          engage: (rise) + scream | roar from all fours
                                                                             │
  ┌───────────────────────────────────────── hunt ◀─────────────────────────┘
  │   attack: rake L/R, combo, slam, pounce ──hit──▶ savor ──▶ hunt
  │   grab ──torn free──▶ stunned ──▶ roar ──▶ hunt
  │        ──stayed still──▶ (dropped) savor ──▶ hunt
  │        ──failed──▶ bite | throw | smash ──▶ savor ──▶ hunt
  │   climb (you are on a ledge)    bash (door / glass)    reach (you are in a low hole)
  │   lost sight 8 s + 18 blocks, or hidden 3 s ──▶ search (sniff, listen, noise)
  │                                                   found you ──▶ roar ──▶ hunt
  │                                                   gave up ──▶ howl ──▶ leave (+ maybe return)
  └── wounded below the flee line ──▶ flee      killed ──▶ death
```

Every state has a hard time ceiling, and overstaying always resolves somewhere safe.
`death` can interrupt anything: during a grab it releases the victim first.

**Attacks.** Every decision tick in range (`combat_rules.chooseAttack`):

| | Range | Notes |
|---|---|---|
| grab | ≤ 2.9, facing, line of sight, ≥ 4 headroom and room at the hold point | 45 % per decision, 9 s cooldown |
| slam | ≤ 3.6, ≥ 6 headroom | 25 %, 6 s cooldown; shockwave hurts everyone within 4.5 at half damage |
| combo / rake L / rake R | ≤ 3.3, facing | combo 35 %; every attack delays the next rake 0.75–1.25 s |
| pounce | 5–11 blocks, ≥ 3 headroom, not in a tunnel | 55 %, 7 s cooldown; `applyImpulse` toward you, sometimes ends in a grab |

Damage only lands at the clip's own impact frame (`core/ids.js SHOT.*.hits`, generated
from the baked clips), with reach, sight and facing checked there. It never hits through
walls.

**The grab struggle** (`combat_rules.struggleSpec`): kind weighted jump 3 / sneak 2 /
alternate 2 / still 1; presses in the preset's range; 2.2–3.4 s (still: 2.0–3.0 s); 30 %
chance the grip shifts at 35–55 % of the window (+0.8 s to read it); inescapable with the
preset's chance, never on the first grab of an encounter, which is also never "still".
The grab controller:
- locks lateral movement and camera (Jump and Sneak stay live: they are the struggle);
- applies slow falling;
- teleports the victim every tick into its hands, facing its face;
- shows the prompt and a bar, and reports success / failure / calm to the brain.

Release paths: free, drop, throw, smash, bite, abort (death, end, disconnect) and lost
(victim died, left or changed dimension). Every one of them unlocks input and clears the
title.

**Ambushes.** The ceiling spot is a column with 5–10 blocks of air under a ceiling, out
of your view, dark; it is placed 2.6 blocks under the ceiling with gravity off (a
`tailwail:float` component group) and plays the upside-down `cling` act. The corner is a
dark spot with two or more walls, out of view; it faces the wall.

**Climbing.** When it is stuck and you stand 2.5–14 blocks above it within 10 blocks, it
finds the wall toward you and its top, turns gravity off and moves up the face at 3.2
blocks/s (teleport every tick, `climb` act), then steps onto the top.

**Doors and glass.** If it stops moving within 20 blocks of you and the first block
between you is a wooden door, trapdoor or gate (or glass, with the setting), it hammers it
every 0.45 s (the `bash` act); after 3–5 hits it breaks it (`setblock … air destroy`, both
halves of a door). Iron doors are never broken.

## Presence and escalation

The director ticks every player once a second. Two waits count down **only in eligible
time** (underground, or outside at night): the next encounter and the next haunting.
Hauntings are picked by `presence_rules.js`:
- filtered by escalation stage, per-event cooldowns, world facts (a torch behind you, a
  door or window nearby) and settings;
- never the same event twice in a row.

Stages only rise: 3 hauntings or 6 eligible minutes, then the first encounter, then 4
encounters or 2 escapes. Setups and hauntings unlock with stage. The setup list depends
on where you are: caves (`stalker`, `corner_peek`, `tunnel_crawler`, `ceiling`,
`huddle`), the night surface (`treeline`, `runner`), or anywhere (`the_rehearsal`,
`behind_you`, `the_hunter`).

## Multiplayer

- One authority per creature (the Encounter that owns it); at most 3 at once, default 2.
- A group within 24 blocks shares one encounter, targeting the player in the most
  darkness.
- Only the target's behaviour raises stand-off agitation. A bystander's hit can retarget
  a stalking, stand-off or ambush encounter once. Slams hurt everyone close.
- Hauntings, music, fog, FOV and heartbeat belong to the target alone. Screams shake
  everyone nearby.

## The client: why it cannot freeze (v3)

- One generated animation file; the creature's body is one controller keyed on a single
  int property (`tailwail:act`).
- Its default state (`loco`) needs **no property at all**: it picks idle / walk / gallop
  from `q.ground_speed`. Every variable is read with a `??` fallback. `client_sim.py`
  proves the creature still idles, walks, gallops and breathes with the pre-animation
  script disabled entirely.
- Attacks, the scream and other one-shots are played by the script with
  `Entity.playAnimation`, a separate channel that needs no client logic.
- On join every player gets a chat line that is a translation key only the 3.x resource
  pack defines. With an outdated or missing resource pack the raw key itself says
  "TAILWAIL_RESOURCE_PACK_3.0.0_IS_NOT_ACTIVE".

## Cleanup guarantees

`fx.js` tracks music, fog, FOV, input locks, heartbeat and titles per player. They are
cleared:
- when an encounter ends (any outcome);
- when the player dies, joins or respawns: clearAll runs unconditionally on join, so a
  crash mid-grab cannot leave a player locked;
- on world load, for everyone.

Echoes never persist (swept on load and periodically). Lure entities without a live owner
are removed. Climbing and bashing controllers stop when their encounter ends; gravity is
restored on every new encounter. `/tailwail:debug restore` is the manual override.

## Memory

Per player, bounded (≤ 900 bytes), versioned, decaying: gestures it saw (count, weight,
pitch), outcomes, reactions (approach, flee, attack, hide, stare) and recent setups. It
picks openings (never the same twice in a row; starers get more treeline and behind-you
openings, runners more peeks and ambushes), adds or removes an opening beat depending on
how fast you usually notice it, opens later encounters with a remembered gesture, and makes
the *rehearsal* replay your habits.

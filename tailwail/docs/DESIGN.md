# Design

## Goals (v3)

v2 was "underwhelming": a statue that held still while you looked at it, a long stand-off,
and after one grab it bit you and wandered off. v3 is built around the opposite:

1. **Quick to action.** It shows itself in seconds and the stand-off lasts seconds. Once
   it is provoked, or decides, it hunts you at the Cave Dweller's chase speed, 7.8
   blocks/s, faster than you can sprint.
2. **Relentless.** No pursuit budget while it can see or hear you, and it goes where you
   go: tunnels, 1-block gaps, walls, doors. It loses you only when you break line of
   sight and get distance, or hide in the dark, and even then it sometimes comes back.
3. **Never the same twice.** An observation stand-off that tests you differently every
   time; several attacks chosen by range and chance; openings that differ between caves
   and the night surface.

3.1 (after "make his chase and attack speed the Cave Dweller's", "add the stand-off /
observation", "it can crawl through 1-block gaps", "get rid of the mash"): the Cave
Dweller's speed and attack rhythm, the observation stand-off with provocation, the squeeze
posture, and the grab struggle parked (kept in the code, never used in game).
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
    combat_rules.js    attack choice, hit reach (+ the parked grab's struggle spec, finishers)
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
                       smashing, "is the player in a low hole"
    presence.js        the haunting events
    grab.js            PARKED (kept for reuse, never started in game): lift / hold / varied
                       mash struggle / release with guaranteed unlock
    fx.js              player effects manager (music, fog, FOV, shake, heartbeat, input, titles)
    torches.js         snuff / relight + the block's custom component
    echo.js            hallucination entities
    mover.js           pathing via an invisible lure + posture selection (tall / hunch /
                       crawl / squeeze)
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
   │ bolt: out of sight, next beat closer          shot at / hit ──▶ roar ───┤
   └──beats done / held stare / walked up──▶ standoff: observation (6-13 s) ─┤
         idle | approach | test (bluff charge, sidestep, back off, crane)    │
         stared 5-9 s, shot at, hit, too close, turned away 0.8 s: charge    │
         after each mode: maybe it decides (agitation, stage, time, you ran) │
ambush: cling (ceiling) ──you pass under / stare──▶ drop ───────────────────┤
        huddle (corner)  ──you come close / stare──▶ turn ───────────────────┤
        behind you       ──you turn round──────────▶ roar ───────────────────┤
the hunter / the return ─────────────────────────────────────────────────────┤
                                                                             ▼
                                          engage: (rise) + scream | roar from all fours
                                                                             │
  ┌───────────────────────────────────────── hunt ◀─────────────────────────┘
  │   attack (one a second): rake L/R, combo ──▶ hunt;  slam, pounce ──hit──▶ savor ──▶ hunt
  │   climb (you are on a ledge)    bash (door / glass)
  │   reach (you are in a low hole) ──1.6-2.6 s──▶ hunt, crushed flat: it squeezes in after you
  │   lost sight 8 s + 18 blocks, or hidden 3 s ──▶ search (sniff, listen, noise)
  │                                                   found you ──▶ roar ──▶ hunt
  │                                                   gave up ──▶ howl ──▶ leave (+ maybe return)
  └── wounded below the flee line ──▶ flee      killed ──▶ death
```

Every state has a hard time ceiling, and overstaying always resolves somewhere safe.
`death` can interrupt anything.

**The observation** (`brain.update_standoff`). Modes run one after another: *idle* (1.5-3.2
s, tall / watching / head tilted), *approach* (2-3.6 s of slow advances, 1.7 blocks/s,
even while watched) and *test*: a **bluff charge** (3-4.5 blocks at full chase speed, then
it stops dead), a **sidestep** (±90°), **backing off** (to see if you follow) or a **neck
crane**. After a test it reads your reaction for 1.2-1.8 s: you ran (agitation +30, and
+0.25 to its chance to attack), you came at it (+20, +0.1), you held still (−10). After
every mode except the first it may decide to attack: 0.12 + agitation/200 + 0.05 × stage
+ 0.07 per mode so far (+ the reaction bonus), at most 0.85. Hard triggers: staring
straight at it for 5-9 s (per encounter; a glance with it at the edge of your view does not
count), any aggressive move, within 6 blocks, turning away for 0.8 s, agitation 100, or
the stand-off's own 6-13 s limit (× 0.6 from stage 2 on).

**Aggressive moves.** A projectile a player shoots or throws (arrow, snowball, egg, ender
pearl, trident, potions, wind charge, firework) is checked one tick after it spawns: if
its flight line passes within 3 blocks of a Tailwail's body (within 64 blocks), that is a
shot at it. A projectile landing within 4 blocks of it, or hitting it, counts too, and so
does a melee hit. During the stalk, the stand-off and the ambushes it is provoked at once:
one roar (no scream) and the hunt. While it searches, a shot gives your position away.

**Attacks.** Every decision tick in range (`combat_rules.chooseAttack`):

| | Range | Notes |
|---|---|---|
| slam | ≤ 3.6, ≥ 6 headroom, not squeezed | 25 %, 6 s cooldown; shockwave hurts everyone within 4.5 at half damage |
| combo / rake L / rake R | ≤ 3.3, facing | combo 35 % |
| pounce | 5–11 blocks, ≥ 3 headroom, not in a tunnel | 55 %, 7 s cooldown; `applyImpulse` toward you |

**The rhythm** is the Cave Dweller's: whatever the attack, the next one waits at least
1.0 s (its melee goal attacks every 20 ticks). Rakes and combos go straight back to the
hunt; slams and pounces that land are followed by a 1-1.8 s *savor*.

Damage only lands at the clip's own impact frame (`core/ids.js SHOT.*.hits`, generated
from the baked clips), with reach, sight and facing checked there. It never hits through
walls.

**The parked grab.** The grab and its mash-to-escape struggle (`combat_rules.struggleSpec`,
`mc/grab.js`, the brain's `grab` state, the `lunge_grab` / `throw` / `smash` / `bite`
clips) are kept and unit-tested, but `settings.grab` is forced off when settings load and
no setting exposes it, so it never starts in game. Its journal pages are hidden. It is
there to be reused for something else.

**Ambushes.** The ceiling spot is a column with 5–10 blocks of air under a ceiling, out
of your view, dark; it is placed 2.6 blocks under the ceiling with gravity off (a
`tailwail:float` component group) and plays the upside-down `cling` act. The corner is a
dark spot with two or more walls, out of view; it faces the wall.

**Climbing.** When it is stuck and you stand 2.5–14 blocks above it within 10 blocks, it
finds the wall toward you and its top, turns gravity off and moves up the face at 3.2
blocks/s (teleport every tick, `climb` act), then steps onto the top.

**Squeezing.** Postures are tall (3.9 high), hunch (2.8), crawl (1.8) and **squeeze
(0.9)**, each a collision-box component group. The mover measures the headroom where it
stands and 1.2 / 2.4 blocks ahead toward its goal; a 1-high opening (a column with
exactly 1 block of air) selects the squeeze, so the engine's pathfinder can route it
through 1×1 gaps. Squeezed, it drags itself at 1.7 blocks/s whatever its hurry, shows the
`loco_squeeze` act (the belly-crawl with the whole body scaled flat, under 1.05 blocks with
every overlay on) and rakes only. When you crawl into a low hole it first reaches in with
one arm for 1.6-2.6 s, then asks for the squeeze posture for 10 s and comes in after you.

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
  "TAILWAIL_RESOURCE_PACK_3.1.0_IS_NOT_ACTIVE".

## Cleanup guarantees

`fx.js` tracks music, fog, FOV, input locks, heartbeat and titles per player. They are
cleared:
- when an encounter ends (any outcome);
- when the player dies, joins or respawns: clearAll runs unconditionally on join, so a
  crash mid-encounter cannot leave a player locked;
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

# 04 · Animatronic AI design

All AI lives in `packs/FredbearBP/scripts/core/` and is pure JavaScript with no Minecraft imports, so the
same code runs in the game, in the balance simulator and in the tests. Every state change is logged
(`session.log`: tick, who, from, to, reason) and shown live by the developer overlay.

## Shared machinery

* **Route graph** (`data/nodes.js`): 47 nodes, 57 edges. Each edge has an access mask (which characters may use it),
  a mode (`walk`, `vent`, `crawl`, `climb`), an optional gate (`diner_seal`, `chamber_wall`) and a waypoint polyline.
  Puppets move along the polyline at the edge's speed, so they follow doorways, corners and stairs and never cut
  through walls. `tools/validate_map.mjs` samples every polyline every 0.5 blocks against the voxel model of the built
  map (body and head cells passable), and the in-game self-test repeats it against the real blocks.
* **Blocked routes**: a gate closing mid-edge reverses the move; an occupied target node is refused (node occupancy);
  a failed approach releases the entry and returns to `STALK`/`PATROL`. Puppet integrity snaps or respawns invalid entities.
* **Movement opportunities** (FNAF-style): every `moInterval` ticks (±10 % jitter), a d20 roll ≤ aggression lets the
  character act. Aggression is 0-20 (night table + hourly ramp from 2 AM on nights ≥ 2). Seeded mulberry32 RNG: the same
  seed replays a night exactly (**deterministic mode**: lobby *Settings* or `/fb:debug seed <n>`; scenarios use seed 4242).
* **Weighted steps**: neighbours that reduce the graph distance to the goal get weight × (1 + A/4); moves away get
  × max(0.15, 1 − A/25); going straight back × 0.35; then character-specific multipliers.

## What the AI can observe (measurable inputs only)

| Input | Exact definition | Used by |
|---|---|---|
| Camera exposure | the current feed (monitor up, not disrupted, not audio-only, signal present) lists the node the character is on or moving between (`camera.sees`, line of sight verified by voxel ray casts in `validate_map.mjs`) | Freddy freezes; Bonnie agitation (60 watched ticks ⇒ next move guaranteed); Fredbear disruption chance |
| Barrier state | door closed / hatch sealed / jammed, per entry | all attacks |
| Noise heat (0-10) | +2 door, +1 light, +1 camera toggle, +3 strobe, +2 hatch, +2 breaker; −1 every 80 ticks | door attackers investigate the halls (heat ≥ 4, chance min(0.4, heat/25)); Freddy favours near nodes (×1.2) |
| Door use (0-10 per entry) | +1 per closing, −1 every 600 ticks | Bonnie flank choice; Fredbear entry choice (prefers less-defended entries) |
| Camera focus | ticks spent on each camera, decayed × 0.999 per tick | Freddy avoids the nodes of the most-watched cameras (×0.5) |
| Repel memory (0-5 per entry) | +1 each time repelled at that entry, per night | Bonnie flank probability |
| Distance to the office | Euclidean, y weighted ×2 | footstep volume, captions, Freddy's laugh range |

There is no hearing of arbitrary sounds, no ray-cast vision of the player and no learning across nights:
all memory above is per night and capped.

## Director (`core/director.js`)

* At most **2 entries engaged** at once; nobody may engage an entry next to the one Fredbear is using; one **attack token**
  (a character holding a lethal window without the token waits up to `holdMax` and is then repelled).
* Grace periods: 60 ticks after a blackout, 200 ticks after maintenance. Maintenance waits until no entry is engaged.
* Scheduled night events: foreshadowing, maintenance sections, the Night 6 finale.

## Bonnie — the aggressive flanker (`ai/bonnie.js` + `ai/door_attacker.js`)

| From | To | Condition | Timing |
|---|---|---|---|
| DORMANT | PATROL | tick ≥ activation and A > 0 | — |
| PATROL / STALK | (move) | movement opportunity succeeds; step chosen toward his target entry | every 90 ± 9 ticks |
| PATROL / STALK | INVESTIGATE | not near the office, noise heat ≥ 4, chance min(0.4, heat/25) | walks ≤ 2 nodes toward the hall, pauses 30 ticks per node |
| PATROL / STALK | APPROACH | adjacent to the entry node and the director reserves the entry | walks the final edge (stalk speed) |
| APPROACH | TELEGRAPH | arrives at the door corner | window `max(70, 150 − 4A)` |
| TELEGRAPH | RETREAT | barrier closed for 40 consecutive ticks, or closed when the window ends | door bang |
| TELEGRAPH | ATTACK | barrier open when the window ends and the attack token is free | jumpscare |
| RETREAT | RECOVER | reaches a retreat node (Party Room A, dining west, backstage, Party Room C) | `max(240, 480 − 12A)` |
| RECOVER | PATROL | timer ends; new target chosen | — |

Identity: primary entry **left**; from A ≥ 5 he can **flank right** through Party Room A with
p = clamp(0.25 + 0.15·repelled[last] + 0.03·(doorUse[last] − doorUse[other]), 0.15, 0.75); from A ≥ 6 he uses the
**supply-closet vent** (hidden from CAM 07, announced by a vent clank). Cues: footsteps with side captions, a groan in the
corner (probability max(0.3, 1 − A/25)), his silhouette in the lit corner.

## Chica — resource pressure (`ai/chica.js` + `ai/door_attacker.js`)

Same telegraph/retreat rules as Bonnie with her own numbers (window `max(80, 160 − 4A)`, recovery `max(260, 520 − 12A)`).
After every retreat she returns to the **kitchen** and lingers 200-600 ticks, making pot-and-pan clatter every 60-140 ticks
(a sound only Chica makes, relayed by audio-only CAM 10). While lingering, each opportunity may **trip the hall-light
breaker** (chance A/40, at most 1-3 per night, 1,200 ticks apart): both hall lights fail until RESET BREAKER (40 ticks,
1 % power). Doors, cameras and the strobe are never affected, so the defence that stops her always remains.
Approach tells: footsteps, heavy breathing at the right door.

## Freddy — the patient stalker (`ai/freddy.js`)

| From | To | Condition | Timing |
|---|---|---|---|
| DORMANT | PATROL | activation | — |
| PATROL / STALK | (move) | opportunity succeeds **and the current feed does not show him** (he freezes mid-walk) | every 60 ± 6 ticks, effective A = A + ignore bonus (+1 per 600 unwatched ticks, max +4) |
| STALK at the east-hall end | APPROACH → LURK | right entry reserved | laugh cue |
| LURK | RETREAT | right door closed 100 consecutive ticks | — |
| LURK | ATTACK | door open and the player on cameras (any feed but CAM 13) for 40 ticks ⇒ he slips in (hidden) and attacks when the monitor goes down or 100 ticks later | — |
| LURK | ATTACK | door open, player not on cameras, patience `max(120, 320 − 10A)` runs out (laugh at half) | — |
| RETREAT → RECOVER → PATROL | | as above | recovery `max(260, 540 − 12A)` |
| any | POWEROUT | power reaches 0 (after the reserve window on nights 3+) | music box at the left door 100-400 ticks, darkness 40-80 ticks, then attack unless 6 AM comes first |

Weights: dark nodes ×1.5, nodes no camera covers ×1.3, nodes of the most-watched cameras ×0.5.

## Fredbear — the central threat (`ai/fredbear.js`)

Phases by night: **0** foreshadow only (N1-3: a golden figure briefly shown on CAM 04 Starlight Cove, in the sealed
diner on CAM 16, and in the west hall on CAM 07, each only while the player happens to watch that feed); **1 Stirring** (N4: hatch only, camera disruption); **2 Haunting** (N5: all three entries,
relocation, false camera events, blackouts); **3 Golden Hour** (N6: shorter cooldowns plus the finale). He alone may use
the diner seal and the chamber wall (gated edges, open from N4).

| State | Meaning and exit |
|---|---|
| DORMANT | in the chamber until activation |
| STIR | walks to the diner stage and stands there (`stir` ticks, visible on CAM 16) → PATROL |
| PATROL | chooses an entry (prefers less-defended entries, halves the last one) and hunts there on foot through hidden basement routes, or by RELOCATING |
| RELOCATING | **warned teleport** between designated golden nodes only: 40 ticks of chime + golden shimmer + static on the destination camera, then he appears there |
| APPROACH | walks/climbs the last edge into the entry |
| TELEGRAPH (W1) | music box + golden glow at that entry for `max(100, 180 − 4A)` ticks. Barrier **open** at the end → ATTACK. **Closed** → FORCING |
| FORCING (W2) | `max(60, 100 − 2A)` ticks of pounding. Opening the barrier → ATTACK. End → the barrier is forced open (**JAMMED**) |
| JAMMED (W3) | 60 ticks with the barrier stuck open → ATTACK unless repelled |
| RECOVER | after a repel; he vanishes back to the diner stage; powers keep working; cooldown per night (1,400 / 1,100 / 900; 500 in the finale) |
| SPENT | mercy cap: after `maxAttempts` repelled attempts (2 / 3 / 4) he stays in the diner (the finale grants 2 more) |

**Countermeasure (learnable, unique to him):** identify the real entry (music box, glow, caption), **close that barrier**,
then fire the **EMERGENCY STROBE** while he is in TELEGRAPH, FORCING or JAMMED. Barrier closed or jammed + strobe = repelled.
Strobe with the barrier open = stunned 40 ticks once per attempt. He never attacks through a closed barrier: it is first
visibly forced open, and the strobe still works during W3. Strobe charges: 3 / 3 / 4 (+2 in the finale), cooldown 200 ticks, 2 % power.

### Powers (concrete values; phase 1 / 2 / 3)

| Power | Trigger | Signal | Duration | Cooldown | Counterplay |
|---|---|---|---|---|---|
| Camera disruption | every 40 ticks: chance 0.3 if the monitor is up (0.06 otherwise), +0.5 if he has been watched > 100 ticks | glitch sound, caption, static on every feed | 100 / 120 / 140 | 900 / 700 / 600 | use the hall lights and audio; feeds return |
| False camera event (N5+) | chance 0.2 per check | a purple, scan-lined **ECHO** puppet on a camera where he is not; captioned and labelled | 100 / 100 | 900 / 700 | ignore echoes; they cannot attack |
| Local blackout (N5+) | chance 0.2 per check, at most once per in-game hour, only when the director allows | 40-tick electrical whine + caption first | 60 / 80 | 1,500 / 1,200 | lights and monitor go down; doors keep working; the telegraph windows (Bonnie, Chica, Freddy's lurk, Fredbear's W1) **pause** during the blackout, plus a 60-tick grace |
| Relocation (N5+) | hunting toward a far entry | chime + shimmer + static on the destination feed for 40 ticks | instant after the warning | 400 / 300 | watch for the warning; the telegraph that follows is the normal full W1 |

Powers never stack to remove every defence: doors work during blackouts and disruption, telegraph windows pause in
blackouts, the director forbids a second entry beside Fredbear's, and only one attack token exists.

## Night 6 finale

At 5 AM (tick 8000) **The Golden Hour** begins: Bonnie, Chica and Freddy withdraw to the stage (`WITHDRAWN`),
Fredbear gains 2 attempts and 2 strobe charges with a 500-tick cooldown. Surviving to 6 AM plays the ending
(chamber shot, the dormant suit's eyes going dark, the building at dawn, credits) and marks the campaign complete.

## Fairness guarantees (tested)

`tests/core.test.mjs`: every lethal attack is preceded by its telegraph state and never passes a closed barrier; a closed
door always repels Bonnie; Fredbear's windows respect the floors for every aggression; the mercy cap holds; at most two
entries engage; Freddy never moves while watched; won/lost sessions are inert; same seed ⇒ same night.

# 04 · Animatronic AI design

All AI lives in `packs/FredbearBP/scripts/core/` and is pure JavaScript with no Minecraft imports, so the
same code runs in the game, in the balance simulator and in the tests. Every state change is logged
(`session.log`: tick, who, from, to, reason) and shown live by the developer overlay.

## Shared machinery

* **Route graph** (`data/nodes.js`): 55 nodes, 61 edges. Each edge has an access mask (which characters may use it:
  B Bonnie, C Chica, F Freddy, G Fredbear, M Morgrave; Valek has no edges, he steps along `VALEK_LADDER`), a mode (`walk`,
  `vent`, `crawl`, `climb`), an optional gate (`diner_seal`, `chamber_wall`, and in 1.3 `vent_seal` / `shaft_seal`, closed
  while the player seals the duct or the shaft) and a waypoint polyline.
  Puppets move along the polyline at the edge's speed, so they follow doorways, corners and stairs and never cut
  through walls. `tools/validate_map.mjs` samples every polyline every 0.5 blocks against the voxel model of the built
  map (body and head cells passable), and the in-game self-test repeats it against the real blocks.
* **Blocked routes**: a gate closing mid-edge reverses the move; an occupied target node is refused (node occupancy);
  a failed approach releases the entry and returns to `STALK`/`PATROL`. Puppet integrity snaps or respawns invalid entities.
* **Never idle at a door (1.3 fix)**: in 1.2, Freddy or Bonnie could stand at a door corner in their idle pose and never
  leave (owner report, item 64). Two causes: a retreat was refused when the next hall node was occupied, and a character
  that reached the door outside its warning state had no rule to leave. Now retreats and withdrawals may walk past an
  occupied node (`beginEdgeMove(..., { pass: true })`), and any door attacker or Freddy found standing on an entry node
  outside APPROACH / TELEGRAPH / LURK / ATTACK / RETREAT leaves at once (`idleAtEntry` + `leaveEntry`).
  `tests/nights_8_9.test.mjs` checks every tick of nights 2-8 for this.
* **The stare (1.3, presentation only)**: whoever the player watches on a feed for 2 s slowly turns their head to the lens
  (`fb:look_yaw/pitch/tilt` entity properties, eased in the client animation). It does not change any AI decision.
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
* **Double trouble (1.3)**: from A ≥ 8, while Bonnie, Chica or Freddy holds the right door, Bonnie or Chica may join as its
  **partner** (`reservePartner`, node `E_DOOR_B` beside the door; chance 0.35 per check). While a pair stands at a door each
  needs **twice** the repel time; when the holder leaves the partner becomes the holder. The partner is not a third
  engaged entry and never holds the attack token at the same time.
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
**supply-closet vent** (hidden from CAM 07, shown by CAM 18 in the duct, announced by a vent clank; a sealed duct turns him
back). Cues: footsteps with side captions, a groan in the corner (probability max(0.3, 1 − A/25)), his silhouette in the lit
corner. **Teamwork (1.3)**: from A ≥ 8 (chance 0.4, at most every 2,400 ticks), while he waits at the left door and the right door is free,
he pounds on the left door (captioned) to hold the player's attention while Chica sneaks to the right one without footsteps.

## Chica — resource pressure (`ai/chica.js` + `ai/door_attacker.js`)

Same telegraph/retreat rules as Bonnie with her own numbers (window `max(80, 160 − 4A)`, recovery `max(200, 420 − 12A)`).
**1.3**: she reached the office far less often than Bonnie (owner report, item 65), so she now moves at Bonnie's pace
(opportunities every 70 ticks, ×1.25 walking speed), retreats to closer nodes, visits the kitchen first only half the time and
after a retreat only a quarter of the time, and from A ≥ 8 flanks to the LEFT door when the right one is taken (chance 0.4).
In the human-model simulation she now reaches a door about as often as Bonnie. In the **kitchen** she lingers 60-180 ticks,
playing the owner's *Chica in the Kitchen* recording (five takes, every 120-180 ticks; a sound only Chica makes, relayed by
audio-only CAM 10). While lingering, each opportunity may **trip the hall-light breaker** (chance A/30, at most 1-3 per night,
1,200 ticks apart): both hall lights fail until RESET BREAKER (40 ticks,
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
relocation, false camera events, blackouts); **3 Golden Hour** (N6: shorter cooldowns plus the finale; N7 the same
phase, alone, with 7 attempts and a 700-tick cooldown). He alone may use
the diner seal and the chamber wall (gated edges, open from N4).

| State | Meaning and exit |
|---|---|
| DORMANT | in the chamber until activation |
| STIR | walks to the diner stage and stands there (`stir` ticks, visible on CAM 16) → PATROL, with his **laugh** |
| PATROL | chooses an entry (prefers less-defended entries, halves the last one) and hunts there on foot through hidden basement routes, or by RELOCATING |
| RELOCATING | **warned teleport** between designated golden nodes only: 40 ticks of chime + golden shimmer + static on the destination camera, then he appears there |
| APPROACH | walks/climbs the last edge into the entry |
| TELEGRAPH (W1) | music box + golden glow at that entry for `max(100, 180 − 4A)` ticks. Barrier **open** at the end → ATTACK. **Closed** → FORCING |
| FORCING (W2) | `max(60, 100 − 2A)` ticks of pounding. Opening the barrier → ATTACK. End → if that door / the hatch has not held yet tonight it **holds** (YIELD); otherwise it is forced open (**JAMMED**) |
| YIELD | the barrier held: 40 ticks bowing at the entry, then he vanishes to the diner stage (counts as an attempt). **Each door and the hatch hold once per night; nothing holds in the Golden Hour** |
| JAMMED (W3) | 60 ticks with the barrier stuck open → ATTACK unless repelled |
| RECOVER | after a repel or a hold; he vanishes back to the diner stage; powers keep working; cooldown per night (1,400 / 1,100 / 900 / 700 on N7; 500 in the finale). Every new hunt starts with his **laugh** |
| SPENT | mercy cap: after `maxAttempts` attempts, repelled or held (2 / 3 / 4 / 7 on N7), he stays in the diner (the finale grants 2 more) |
| RISE | Golden Hour: a 60-tick showman pose on the diner stage, then the hunt |
| POWEROUT | on nights he is awake (phase ≥ 1) the power-out is his: he appears at the left door with his own music box and golden eyes (instead of Freddy) |

**Countermeasure (learnable, unique to him):** identify the real entry (music box, glow, caption), **close that barrier**,
then fire the **EMERGENCY STROBE** while he is in TELEGRAPH, FORCING or JAMMED. Barrier closed or jammed + strobe = repelled.
Strobe with the barrier open = stunned 40 ticks once per attempt. He never attacks through a closed barrier: it is first
visibly forced open, and the strobe still works during W3. Strobe charges: 4 / 5 / 6 on nights 4 / 5 / 6 (+2 in the finale)
and 6 on night 7, cooldown 200 ticks, 2 % power.

**Hold rule.** The first time Fredbear forces a given door (or the hatch) in a night, it holds: W2 ends in YIELD,
not JAMMED. So a player out of strobe charges still survives one attempt per entry. The second attempt at the same
entry jams it as before. In the Golden Hour nothing holds.

**Cues.** His laugh (one of four recordings, at the office) marks every hunt start. The office lamps flicker (module
`env.flicker_office`: two lamps dim, then return) every 40 ticks while he is on a node next to the office or relocating
to one, and every 16 ticks while he walks or climbs into an entry. No flicker during a blackout and never for an echo.

### Powers (concrete values; phase 1 / 2 / 3)

| Power | Trigger | Signal | Duration | Cooldown | Counterplay |
|---|---|---|---|---|---|
| Camera disruption | every 40 ticks: chance 0.3 if the monitor is up (0.06 otherwise), +0.5 if he has been watched > 100 ticks | glitch sound, caption, static on every feed | 100 / 120 / 140 | 900 / 700 / 600 | use the hall lights and audio; feeds return |
| False camera event (N5+) | chance 0.2 per check | a purple, scan-lined **ECHO** puppet on a camera where he is not; captioned and labelled | 100 / 100 | 900 / 700 | ignore echoes; they cannot attack |
| Local blackout (N5+) | chance 0.2 per check, at most once per in-game hour, only when the director allows | 40-tick electrical whine + caption first | 60 / 80 | 1,500 / 1,200 | lights and monitor go down; doors keep working; the telegraph windows (Bonnie, Chica, Freddy's lurk, Fredbear's W1) **pause** during the blackout, plus a 60-tick grace |
| Relocation (N5+) | hunting toward a far entry | chime + shimmer + static on the destination feed for 40 ticks | instant after the warning | 400 / 300 | watch for the warning; the telegraph that follows is the normal full W1 |

Powers never stack to remove every defence: doors work during blackouts and disruption, telegraph windows pause in
blackouts, the director forbids a second entry beside Fredbear's, and only one attack token exists.

## Shadow Fredbear (nights 2+)

A rare black silhouette with white eyes on the show stage (`STAGE_FRONT`, seen on CAM 01/02). From 1 AM, once per
in-game hour, chance 5 %, from its own RNG stream (`mixSeed(seed, 7700 + night)`, so it never shifts the AI rolls).
It stays 600 ticks. Watching it for 60 ticks in total costs 1 % power and it vanishes with a glitch and a caption.
Harmless otherwise: it never moves or attacks, and never appears during the finale, an echo or the training shift.

## Challenge modifiers

| Modifier | Effect |
|---|---|
| `noDoors` | doors and hatch are welded open; a lit hall light on the corner acts as the barrier for Bonnie, Chica and Freddy |
| `strobeNoBarrier` | the strobe repels Fredbear without a closed barrier |
| `lightAutoOff` | hall lights stay on 200 ticks instead of 100 |
| `deviceDrainMult` | doors, lights and the monitor use × N power (base drain unchanged) |
| `reserveAmount` | the reserve lever gives this many power units |
| `noCams` | the monitor has no signal at all |
| `loudSteps`, `captions` | footsteps louder and captions forced on |

## Jumpscares by place (1.3)

`NightSession.jumpscareStyle(who)` tells the game where an attack comes from: **below** for any attack at the hatch
(Fredbear, Morgrave: the puppet rises out of the floor in three steps), **vent** for an attacker that came out of the duct
to the left door (Bonnie's vent route, Morgrave's L route: it rises out of the vent), otherwise **front**. Power-out attacks
are always front.

## Night 6 finale

At 5 AM (tick 8000) **The Golden Hour** begins: Bonnie, Chica and Freddy withdraw to the stage (`WITHDRAWN`),
Fredbear gains 2 attempts and 2 strobe charges with a 500-tick cooldown. Surviving to 6 AM plays the ending
(chamber shot, the dormant suit's eyes going dark, the building at dawn, credits) and marks the campaign complete,
unlocking night 7.

## Night 7 — Fredbear's Revenge

Fredbear alone, at aggression 20, phase 3, from tick 200, with 7 attempts, a 700-tick cooldown, 6 strobe charges and the
reserve lever. The hold rule applies (it is not the Golden Hour). **1.3**: Freddy, Bonnie and Chica start the night switched
off in Parts & Service (`store`, nodes `PARTS_F/B/C`, CAM 06), and Fredbear is **omnipresent**: between attempts he
**haunts** - every 180-320 ticks he vanishes and reappears on another `haunt` node anywhere in the pizzeria (the main stage
too), and his warned relocations may start from any node. Surviving to 6 AM asks the player to **seal** the chamber or
**burn** the pizzeria; each choice has its own ending scene, both are recorded in Extras, and the last one decides night 8.

## Morgrave — the rabbit in the walls (`ai/morgrave.js`, nights 8 and 9)

Fredbear's partner from the 1983 diner, walled in with him. He never walks the halls and makes no footsteps.

| From | To | Condition | Timing |
|---|---|---|---|
| DORMANT | WALLS | tick ≥ activation, A > 0 | hidden in Fredbear's chamber (`M_HOME`, CAM 19) until then |
| WALLS | CRAWL | cooldown ends; comes out at the start of a route (scraping inside the walls, captioned with the route) | route L (supply closet → duct `VENT_W` → left door) or H (crawlspace → subfloor `SUB_N` → hatch); prefers the less-defended route, ×0.6 for the one he last used |
| CRAWL | (move) | movement opportunity succeeds (d20 ≤ A every 80 ± 8 ticks); a vent clank on every move | — |
| CRAWL | WALLS | the next edge is sealed (`vent_seal` / `shaft_seal`) for 160 ticks | "Something gave up inside the vents"; recovery `max(240, 560 − 12A)` |
| CRAWL | APPROACH | next node is the entry and the director reserves it | "climbing out of the vent — LEFT corner" / "Scraping beneath the office floor" |
| APPROACH | TELEGRAPH | arrives at the left door corner or under the hatch | window `max(50, 110 − 3A)`; a scratch at the entry (captioned) **75 % of the time** |
| TELEGRAPH | WALLS | barrier closed 40 ticks, or closed at the end of the window | door bang, "Scraping fades back into the walls" |
| TELEGRAPH | ATTACK | barrier open at the end of the window | jumpscare rising out of the vent / the hatch |

Counterplay: watch CAM 18 / CAM 17, **seal** the duct or the shaft in front of him (cheaper than holding a door), or close
the left door / the hatch when he arrives. The 25 % silent arrivals are what make him dangerous: remember where you last
heard him.

## Valek — the gray bear in the dark (`ai/valek.js`, nights 8 and 9)

Nobody remembers ordering him; he was found in Parts & Service (`V_HOME`, CAM 06) the week the 1987 guard went missing. On the
hunt only his two small eyes show (`fb:variant` 1 hides the body).

| From | To | Condition | Timing |
|---|---|---|---|
| DORMANT | VANISH | tick ≥ activation, A > 0 | — |
| VANISH | STEP | timer ends; appears on a rung of the West or East Hall ladder (`VALEK_LADDER`: far room → hall north → middle → south), as many rungs closer as his anger (0-2) | prefers the side whose door you use least; angrier ⇒ changes sides more |
| STEP | (step) | every 90 ± 9 ticks, **only if the spot he stands on is not on the feed you are watching**, d20 ≤ A: one rung closer, silently | half of his steps play another animatronic's sound on the **other** side of the building, captioned as theirs (mimicry) |
| STEP | CORNER | the next rung is the door corner and the director reserves the entry | window `max(60, max(80, 170 − 4A) − 20·anger)`; a faint hum (captioned) 60 % of the time |
| CORNER | VANISH | that hall light is on | at once; **anger + 1** (max 2), back in 200 ticks |
| CORNER | VANISH | door held closed 60 ticks, or closed at the end of the window | anger − 1; recovery `max(300, 600 − 12A)` |
| CORNER | ATTACK | dark and open at the end of the window | jumpscare |

He is the night for players who trust the captions: his only honest sound is the hum.

## Nights 8 and 9

* **Night 8** (unlocks after night 7) has two versions, chosen from the **last night 7 ending** in the save
  (`nightVariant(8, lastEnding)`): *Walled In* (seal → Morgrave, A 13 from tick 600) or *Out of the Smoke* (burn → Valek,
  A 15 from tick 600). The trio play as on night 3 (A 7/8/7, hourly ramp), the hatch and the basement are open, no strobe.
* **Night 9 — Three Below** (unlocks after night 8, whatever the ending): Fredbear (A 16, omnipresent, 5 attempts, 6 strobe
  charges), Morgrave (A 13 from tick 200) and Valek (A 13 from tick 800) together; the trio switched off in Parts & Service; no
  night music. Surviving it plays its own ending (`NIGHT_NINE_ENDING`): the three of them in the old diner, turning to look at you, then the morning.

## Fairness guarantees (tested)

`tests/core.test.mjs`: every lethal attack is preceded by its telegraph state and never passes a closed barrier; a closed
door always repels Bonnie; Fredbear's windows respect the floors for every aggression; the mercy cap holds; at most two
entries engage; Freddy never moves while watched; won/lost sessions are inert; same seed ⇒ same night.
`tests/nights_8_9.test.mjs` (1.3): nights 8 (both versions) and 9 are winnable with a valid defence; Morgrave and Valek
attack only from their warning state through an open entry; seals cost power, expire and turn Morgrave back; Valek never
steps while watched, vanishes when lit and attacks from a dark open corner; nobody stands idle at a door; double trouble
needs twice the repel time.

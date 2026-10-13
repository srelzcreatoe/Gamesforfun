# 04 · Animatronic AI design

All AI lives in `packs/FredbearBP/scripts/core/` and is pure JavaScript with no Minecraft imports, so the
same code runs in the game, in the balance simulator and in the tests. Every state change is logged
(`session.log`: tick, who, from, to, reason) and shown live by the developer overlay.

## Shared machinery

* **Route graph** (`data/nodes.js`): 60 nodes, 66 edges (1.6: the rebuilt ground floor - the theatre, the play place,
  the party wing, and two winding halls whose bends `WH_T` / `EH_T` the hall cameras cannot see). Each edge has an access mask (which characters may use it:
  B Bonnie, C Chica, F Freddy, G Fredbear; since 1.4 Morgrave and Valek walk no edges: they appear at fixed spots,
  `data/visitors.js`), a mode (`walk`,
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
| RETREAT | RECOVER | reaches a retreat node (Party Room B, dining west, backstage, Party Room 3) | `max(240, 480 − 12A)` |
| RECOVER | PATROL | timer ends; new target chosen | — |

Identity: primary entry **left**; from A ≥ 5 he can **flank right** through Party Room B (1.6: the cross-link between the bends of the two halls) with
p = clamp(0.25 + 0.15·repelled[last] + 0.03·(doorUse[last] − doorUse[other]), 0.15, 0.75); from A ≥ 6 he uses the
**supply-closet vent** (hidden from CAM 16, shown by CAM 18 in the duct, announced by a vent clank; a sealed duct turns him
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

Phases by night: **0** foreshadow only (N1-3: a golden figure briefly shown on CAM 05 Starlight Cove, in the sealed
diner on CAM 24, and in the west hall on CAM 16, each only while the player happens to watch that feed); **1 Stirring** (N4: hatch only, camera disruption); **2 Haunting** (N5: all three entries,
relocation, false camera events, blackouts); **3 Golden Hour** (N6: shorter cooldowns plus the finale; N7 the same
phase, alone, with 7 attempts and a 700-tick cooldown). He alone may use
the diner seal and the chamber wall (gated edges, open from N4).

| State | Meaning and exit |
|---|---|
| DORMANT | in the chamber until activation |
| STIR | walks to the diner stage and stands there (`stir` ticks, visible on CAM 24) → PATROL, with his **laugh** |
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

A rare black silhouette with white eyes on the show stage (`STAGE_FRONT`, seen on CAM 01/08). From 1 AM, once per
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

## Jumpscares by place (1.3, 1.4)

`NightSession.jumpscareStyle(who)` tells the game where an attack comes from: **below** for any attack at the hatch
(Fredbear: the puppet rises out of the floor in three steps), **vent** for an attacker that came out of the duct to the
left door (Bonnie's vent route: it rises out of the vent), **above** (1.4) for Morgrave or Valek at the ceiling vent (it
drops from the ceiling), otherwise **front**. Power-out attacks are always front.

**Jumpscare view (1.4 fix).** In 1.3 the camera sat 1.15 blocks from every animatronic, but the attack clips move the head
up to 1.15 blocks forward (Freddy) and the arms up to 1.9, so the face could pass through the camera; the free camera also
showed the player's own body. Now `tools/gen_jumpscare_reach.py` poses each model through its attack clip (the same bone
maths as the preview renderer) and measures how close the head and anything in the line of sight come; the puppet stands
so that the face stays ≥ 0.55 blocks and everything else ≥ 0.3 blocks from the camera
(`data/jumpscare_reach.generated.js`: Freddy 2.21, Bonnie 1.59, Chica 1.3, Fredbear 1.42 / 1.83 / 1.93 by variant,
Morgrave 1.44, Valek 1.5). For the jumpscare the player is invisible (5 s, removed when the view is restored) and an empty
hotbar slot is selected.

## Night 6 finale

At 5 AM (tick 8000) **The Golden Hour** begins: Bonnie, Chica and Freddy withdraw to the stage (`WITHDRAWN`),
Fredbear gains 2 attempts and 2 strobe charges with a 500-tick cooldown. Surviving to 6 AM plays the ending
(chamber shot, the dormant suit's eyes going dark, the building at dawn, credits) and marks the campaign complete,
unlocking night 7.

## Night 7 — Fredbear's Revenge

Fredbear alone, at aggression 20, phase 3, from tick 200, with 7 attempts, a 700-tick cooldown, 6 strobe charges and the
reserve lever. The hold rule applies (it is not the Golden Hour). **1.3**: Freddy, Bonnie and Chica start the night switched
off in Parts & Service (`store`, nodes `PARTS_F/B/C`, CAM 03), and Fredbear is **omnipresent**: between attempts he
**haunts** - every 180-320 ticks he vanishes and reappears on another `haunt` node anywhere in the pizzeria (the main stage
too), and his warned relocations may start from any node. Surviving to 6 AM asks the player to **seal** the chamber or
**burn** the pizzeria; each choice has its own ending scene, both are recorded in Extras, and the last one decides night 8.

## The ceiling vent (1.4)

A 3 × 3 hole in the office ceiling, centred across the office over the desk (1.6.2; it was a 2 × 2 off to the east), under a grate of iron trapdoors in the crawlspace floor
(`data/visitors.js` `CEILING_VENT`). The **VENT GRATE** button on the back counter (1.6; it was on the desk) opens and closes it (lamp on the back wall
above it: green = open, amber = closed); since 1.6.2 it starts every night open and never costs power. CAM 14 looks
along the crawlspace at it. Morgrave and Valek are the only ones who use it; they also use both doors, and nothing else.

## Morgrave — the rabbit who wants to be let in (`ai/morgrave.js`, nights 8 and 9, 1.4)

Walled in with Fredbear below the 1983 diner (Springbonnie was Fredbear's stage partner). He never walks the halls and makes no footsteps: he comes out
of the walls at the **left door**, the **right door** or the **ceiling vent** and knocks. He only wants to be let in.

| From | To | Condition | Timing |
|---|---|---|---|
| DORMANT | WALLS | tick ≥ activation, A > 0 | hidden in the workshop (`M_HOME`, CAM 21, since 1.5) until then |
| WALLS | KNOCK | cooldown ends and a visit may start (running, past the grace, no blackout, Fredbear not engaged, not the finale) | picks an entry: the vent with weight 1.2; a door with 1 + door use / 4, + 2 while it is shut; × 0.6 for the last one used |
| KNOCK | PASS | that entry is **open** when the three soft knocks end | soft knocks 30 ticks, captioned "Three soft knocks — LEFT DOOR / RIGHT DOOR / CEILING VENT" |
| KNOCK | ANGRY 1 | it is shut | "Knocking — …, louder"; each angry stage `max(50, 120 − 5A)` ticks |
| ANGRY 1 | ANGRY 2 | still shut | "Pounding — …!" |
| ANGRY | PASS | the entry is opened at any point | "let in late" |
| ANGRY 2 | ATTACK | still shut at the end | he breaks through: the door is forced open (jammed) or the grate bursts open; jumpscare (front, or above at the vent) |
| PASS | WALLS | after 50 ticks walking past the doorway / crawling past over the grate | he shuts the grate behind him ("The vent grate clangs shut"); recovery `max(160, 440 − 14A)` |

**The risk** is the other animatronics: on night 8 the trio is hunting, so opening a door for him can let Bonnie, Chica or
Freddy in. Fairness: while another animatronic is engaged at that same door (holding it, or beside it as a partner), he
never breaks through; once they leave he still waits at least 60 ticks (3 s), so there is always time to check the light
and open up. The angry stages pause during a blackout.

## Valek — the staring contest (`ai/valek.js`, nights 8 and 9, 1.4)

Nobody remembers ordering him; he was found in Parts & Service the week the 1987 guard went missing; between nights he waits in the black
corner of the workshop (`V_HOME`, CAM 21, since 1.5).
On the hunt only his two small eyes show (`fb:variant` 1 hides the body). Doors and the grate do not stop him; looking
straight back at him does.

| From | To | Condition | Timing |
|---|---|---|---|
| DORMANT | VANISH | tick ≥ activation, A > 0 | — |
| VANISH | STARE (far) | timer ends and he may appear (same rules as Morgrave) | eyes in the dark through the window beside the left or right door, or through the vent grate; "Two small eyes in the dark — …"; a hum; × 0.5 for the last entry |
| STARE | LEAVE | the player looks straight at his eyes and keeps looking for a random `hold(A)` = 60 to `100 + 5A` ticks | **he looks away first** ("He looks away first…") |
| STARE far | STARE near | not looked at within `max(60, 140 − 3A)` ticks; or, once the contest started, looked away for more than 16 ticks; or the **cameras** opened | "The eyes are closer — …"; a new contest, `max(40, 100 − 2A)` ticks to look |
| STARE near | ATTACK | the same, but the glance allowance is 8 ticks | jumpscare (front, or above at the vent) |
| LEAVE | VANISH | 20 ticks: he slowly turns his head away | recovery `max(180, 520 − 16A)` |

**Gaze.** The game compares the player's view direction with the line from the player's eyes to his eye point
(`mc/game.js` `gazeAt`): within 12° counts as looking at him; the cameras up never does. **Head lock.** While he stares,
his head follows the player around the office (`fb:look_yaw/pitch/tilt`), and when the player moves more than 70° to one
side his whole body turns too (`valekLooks`). When he loses he turns his head away before he is gone.
`tools/validate_map.mjs` checks that every eye point is visible from the office seat.

## Nights 8 and 9

* **Night 8** (unlocks after night 7) has two versions, chosen from the **last night 7 ending** in the save
  (`nightVariant(8, lastEnding)`): *Walled In* (seal → Morgrave, A 13 from tick 600) or *Out of the Smoke* (burn → Valek,
  A 15 from tick 600). The trio hunt too (A 13/14/13 with Valek, 15/16/15 with Morgrave, hourly ramp); the hatch and the
  basement are open, no strobe.
* **Night 9 — Three Below** (unlocks after night 8, whatever the ending): Fredbear (A 16, omnipresent, 5 attempts, 6 strobe
  charges), Morgrave (A 20 from tick 200) and Valek (A 20 from tick 800) together; the trio switched off in Parts & Service; no
  night music. Surviving it plays its own ending (`NIGHT_NINE_ENDING`): the three of them in the old diner, turning to look at you, then the morning.

## Fairness guarantees (tested)

`tests/core.test.mjs`: every lethal attack is preceded by its telegraph state and never passes a closed barrier; a closed
door always repels Bonnie; Fredbear's windows respect the floors for every aggression; the mercy cap holds; at most two
entries engage; Freddy never moves while watched; won/lost sessions are inert; same seed ⇒ same night.
`tests/nights_8_9.test.mjs` (1.4): nights 8 (both versions) and 9 are winnable with a valid defence; Morgrave only attacks
from ANGRY after a shut entry stayed shut, Valek only from STARE; an open door lets Morgrave pass, opening late lets him
pass, the vent grate lets him crawl past and is shut again behind him; he never breaks a door while someone else is held at
it and leaves 3 s once they go; nobody comes knocking while Fredbear is engaged; Valek looks away when stared down, steps
closer when ignored or when the player looks away or opens the cameras, and a closed door does not stop him; seals cost
power and expire; nobody stands idle at a door; double trouble needs twice the repel time.

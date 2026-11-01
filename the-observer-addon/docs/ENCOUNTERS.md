# Encounter Library

Every encounter is built from the same formula:

**Context + Location + Cue + Observer intention + Manipulation + Player response + Consequence**

Implemented encounters live in `packs/TheObserver_BP/scripts/encounters/` (one file each) and register themselves with
the director. Concepts marked *planned* are design-ready but not implemented in 1.0.0 — they are not advertised as
features. "Tier" is intensity (1 subtle … 4 peak); "Stage" is the minimum stage at which the director may choose it.

## Implemented (30 mechanically distinct types)

| # | Encounter (file) | Tier / Stage | Context | Location | Cue | Intention | Manipulation | Player response | Consequence |
|---|---|---|---|---|---|---|---|---|---|
| 1 | **The Figure at the Edge** (`distant_watch`) | 1 / 1 | anywhere; adapts to water, height, caves | 26–44 blocks at the edge of attention (14–28 in caves); since 1.0.9 also on a high ledge 4+ blocks above you, or (underground) hanging upside down from a ceiling 6+ blocks high; on water; on the ground below a high player; at the favoured bearing | arrives silently; a still silhouette, partly behind cover; the animals near it turn to it (1.1.1: any appearance); eye glints in darkness | to be noticed — or not | — | look at it ~1 s / walk toward it / ignore | noticed or approached: the standoff (below); on water it sinks; ignored, footprints where it stood |
| 2 | **Out of Step** ★ (`extra_step`) | 2 / 2 | walking on land | behind, 7 → 3.4 blocks (sound); 15–24 blocks (body) | footsteps in your rhythm and ground material; one extra heavier step | to see whether you notice an imitation | — | turn around / sneak / ignore | glimpse and it steps away (*Out of Step*); falters (*Quiet Feet*); closes in → right behind you (*Close*) |
| 3 | **Someone Was Home** ★ (`home_visit`) | 2 / 2 | returning (40–96 blocks) to your main haunt after 4+ min away | your most-visited 16×16 area / bed | door creak from inside; arranged objects | to show it knows where you live | M1 door, M2 entrance lights, M3 object turned toward your approach, M6 effigy | put something back / break the effigy / study the changes / ignore | it restores the rest (*Put Back*); Vestige (*Small Likeness*); *Someone Was Home*; ignored → changes stay 8 min, tension rises |
| 4 | **The Closed Path** ★ (`closed_path`) | 3 / 4 | moving through a tunnel or dark enclosed corridor | seal 3–7 blocks behind; body 12–20 ahead | hum, lights dying, fog, seal sound | to corner you and see what you do | M2 lights, M4 Veil seal | break through and leave / stand in light / hold its gaze / lens / strike | escape (*Wrong Way*); repelled (*Light It Does Not Make*); backs off (*Held Gaze*); telegraphed strike or (aggression 0) a blackout |
| 5 | **Borrowed Work** (`borrowed_sound`) | 1 / 1 | anywhere with a habit on record | where you last did your dominant habit, or a breadcrumb 14–40 blocks away, out of view | your own work sounds (mining, chopping, doors, chests, eating, fighting…) | imitation; to draw you back | M6 effigy (stage 3+, 40%) | go and look / ignore | sounds stop, footprints (*Borrowed Work*); sometimes an effigy |
| 6 | **Something Facing You** (`turned_object`) | 1 / 1 | a pumpkin/jack o'lantern/stonecutter/anvil within 14 blocks, out of view | the object | faint scrape, dust | a small, deliberate wrongness | M3 turn | look at it / turn it back | *Something Facing You*; reverts in 10 min if untouched |
| 7 | **The Door** (`door_ajar`) | 1 / 1 | a door/trapdoor/gate within 16 blocks, out of view | the door | its open/close sound from exactly there | invitation | M1 door | close it / look / ignore | a single knock answers (*The Door*); stage 4+: it stands beyond the doorway as you come |
| 8 | **Lights Out** (`snuffed_lights`) | 2 / 2 | night, underground or indoors with ≥2 lights | lights within 12 blocks, farthest first | snuffs in sequence; soft fog | to test your reliance on light (weight ×1.5 if you place many lights) | M2 lights (≤4) | relight / bring any light / sit in the dark | it acknowledges from the edge of the dark (*Lights Out*); otherwise lights return after 2.5–4 min |
| 9 | **Always the Same Place** (`mirror_bearing`) | 2 / 2 | anywhere | the player's favoured bearing (behind-left/right) and distance | a chime from that direction 2 s before | a learnable pattern | — | turn to the side | each catch counts; three → *Always the Same Place* |
| 10 | **Echo Ahead** (`echo_ahead`) | 2 / 3 | moving | 20–32 blocks ahead | dark motes rising + chime at the spot | prediction tell | — | watch the spot / look away then back | it arrives only unwatched (*Echo Ahead*); denied → it shows itself behind you instead |
| 11 | **The Path Changed** (`unfamiliar_route`) | 2 / 3 | on a route walked ≥ 3 separate times | 8–14 blocks behind (the way back) | the way back is wrong | to make the familiar unfamiliar | M5 mimic blocks, M1 a door on the route, M7 a carved opening (level 3) | dig through / study it | *Wrong Way*; mimic blocks drop nothing; reverts ~2.5 min later |
| 12 | **Close** (`close_breath`) | 3 / 3 | standing still 6+ s | 2.6–4 blocks behind (8–11 with scares off) | cloth, then a slow exhale | contact without harm | M6 effigy if you never turn (60%) | turn around / don't | it is there, head tilted, then gone (*Close*); otherwise it leans in and leaves an effigy |
| 13 | **Breathing Room** (`pursuit`) | 4 / 4, aggression ≥ 1 | night/underground/dark (more likely underground), health ≥ 50 % | appears in view 24–34 blocks | rising hum, lights die, fog, 3 s stare | to hunt: since 1.0.6 it **floats** (surges ~6.2 b/s unwatched, drifts ~2.6 b/s watched, no footsteps, a rush of air) and **climbs** after you; keeps attacking once it reaches you | M2 lights | keep it in view / light / water (it hovers at the shore) / lens / flare / strike; climbing does not help | escape (*Breathing Room*); repelled; the telegraphed strike, from the wall if you climbed |
| 14 | **At the Window** (`window_watch`) | 2 / 2 | indoors (roof, sky light outside) | outside, framed by a window or opening | a figure at the window | walls do not stop it | — | look / don't | it steps out of the frame (*The Window*); footprints under the window |
| 15 | **Second Witness** (`second_witness`) | 2 / 2 | ≥ 2 players within 40 blocks | hidden from the target, visible to the other | chime to the witness | to be seen by the wrong person | — | the witness warns the target | both see it (*Second Witness*) |
| 16 | **While You Slept** (`night_visit`) | 2 / 2 | the player sleeps (event-triggered) | the bed and nearest door | door creak on waking; footprints door → bed | it came in | M1 door, M2 a light, M6 effigy at the foot of the bed | close the door / break the effigy | *While You Slept*; reverts in 5 min |
| 17 | **It Came Through** (`portal_follow`) | 1 / 2 | 60–150 s after a dimension change | the arrival point | heavy arrival, two steps, footprints away | continuity | — | — | *Elsewhere Too* (Nether/End) |
| 18 | **The Vigil** (`vigil`) | finale | player-initiated: 12 pages, a Witness Lens, night, near home | the home grounds | chime per round, title cards | to be witnessed | M1, M2, M4 screens; optional global rain | find it and hold it three times | **Witnessed** + The Observer's Eye; or blackout and retry |
| 19 | **Closer Each Time** (`creeping`) | 3 / 3 | night, darkness or a cave, on open ground | appears in view 20–30 blocks ahead; then wherever it gets to | a low hum, soft fog, glowing eyes, a click each time it has moved | to come for you, but only unseen | — | keep it in view (8 s backs it off), stand in bright light, use the lens, or get 56 blocks away | it is closer every time you look away; if it reaches you: a shriek and the telegraphed strike (aggression "never": only darkness). *Held Gaze* |
| 20 | **It's Inside** (`inside`) | 3 / 4 | at home (within 14 blocks of your main haunt) at night, indoors under a roof | the darkest spot (light ≤ 7) of the same room, 3–10 blocks away, out of your current view | nothing: it arrives silently; its eyes glow | to be found where you feel safe | — | light the room (light 10+ where it stands: a torch, a flare) / stare at it 2 s / walk right up to it (2–4 blocks) | it recoils and tears apart / tilts its head and leaves / tears apart (*It Was Inside*). At most every 60 min (3 in-game nights); never inside a Ward Lantern's radius |
| 21 | **Signs** (`sign`) | 2 / 3, manipulation ≥ 1 | within 48 blocks of your home | an empty floor cell beside your bed (spawn point) or a door of the home, out of everyone's sight | a standing sign, waxed, its text facing the bed or door: your name, "I was here", "Don't turn around", "Again tomorrow", the time you last slept, "You left the door open", how often you saw it | to show it was there | M9 sign (ledger, drops nothing) | read it / break it | read → noticed; it disappears after 20 minutes. At most every 60 min (3 in-game days) |
| 22 | **Borrowed Eyes** (`borrowed_eyes`) | 1 / 2 | an animal, villager, trader or zombie/skeleton 6–24 blocks ahead, in view | the creature | it stops what it is doing and its head follows you, wherever you go, for 7–11 s | to watch through something else | none (heavy slowness, rotation only) | look back at it | held 2 s: it holds a moment longer, then walks on as if nothing happened. At most every 10 min |
| 23 | **In the Mire** (`mire_watcher`) | 1 / 1 | in the Weeping Mire, its home (weight 16 there, 0 anywhere else); also after a torn page | among the weeping trees 20–48 blocks away, peeking from behind a trunk when there is one: where you can see it first, 12–24 blocks if the trees allow nothing further, deep among them as a last resort; after a torn page 16–24 blocks behind you, after the last of the eight 12–14 (closer, from 8, if the trees allow nothing further) | a still figure between the trunks | the Mire's old watcher, now the Observer itself: to be seen at home | — | look at it ~1 s / walk up to it / ignore it | seen: *Its Home*, then the standoff (since 1.0.9) — look away and it is gone in black mist with a cave sound; stare too long or shoot it and it snaps; from stage 2 it may lunge at once instead; within 9 blocks it does not wait (too close, or a strike); ignored, it fades after 90–180 s |
| 24 | **At the Foot of the Bed** (`paralysis`, 1.1.1) | 3 / 3, camera effects ≥ reduced | the player falls asleep (event-triggered: decided once per sleep after 1.5 s in bed, ~30 % at stage 3, +5 % per stage; at most every 90 min of play); from the Config Wheel, a bed within 8 blocks | beyond the foot of the bed, 2.6–3.8 blocks from the pillow, in full view (in a room too small for that, beside the bed by the knees) | the dark comes down as sleep takes them; their own heart, loud; its breath | sleep paralysis: to be seen while they cannot move | — (camera, input and HUD only; nothing in the world changes) | none possible: they try to turn their head and cannot | it tilts its head, leans two-thirds of a block closer; a blink and it is gone; they stand beside the bed looking at where it stood (*At the Foot of the Bed*). No damage; the night is not skipped |
| 25 | **Not Yours** (`not_yours`, 1.2.0) | 2 / 3 | a hostile creature hurts the player (event-triggered: always for a kind marked its rival, else one time in two; at most every 8 min); from the Config Wheel, the nearest hostile creature within 16 blocks | right behind the creature, as seen from the player, its head in their sight | it is suddenly there; the creature stops and turns round to it | it does not share: the player is its prey | — | none needed | the creature is torn apart (crimson shreds, a crack); it looks at the player a moment and is gone (*Not Yours*). It never touches the player |
| 26 | **Its Eyes** (`its_eyes`, 1.2.1) | 2 / 2 | a creature that answers to it 8–28 blocks ahead, in sight (weight 6 at night or in the dark, else 3; 0 with none, so it never defers for lack of one) | the creature | it stops and stares at the player, perfectly still, its eyes in it | it watches through them | — | look straight at it (12°, 0.5 s) / don't | looked at: it comes apart and it is standing where it stood — a sighting (*Its Eyes*); not looked at within 14 s: the creature is let go, and nothing else happens. It never hurts the player |
| 27 | **Knocking** (`knocking`, 1.3.0) | 2 / 3 | night, at home (within 16 of your main haunt), indoors; a door of the home within 12 blocks; a creature that answers to it within 48 | outside the door (the side away from you), put there unseen | three knocks, twice more (`observer.knock`, a caption) | its creatures at your threshold | — | open the door / leave it | opened: one of its creatures is standing there, looking at you, and comes apart (*Who Knocks*); left shut: the knocking stops and there is nothing outside (the creature is removed). It never comes in |
| 28 | **Bait** (`bait`, 1.3.0) | 2 / 3 | night or dark; a villager within 48 blocks (not name-tagged) | a dark place (light ≤ 7) 14–26 blocks off, to the side or behind, unseen | the villager crying out (`mob.villager.hit` / `no`, every 3 s) | to lure you into the dark | — | go to it / don't | close (7 blocks): it turns to you with its eyes and it is standing right behind it in the dark — a sighting (*The Voice in the Dark*); the villager is put back where it was, unharmed. Not gone to within 45 s: the calling stops |
| 29 | **One of Them** (`among_them`, 1.3.0) | 2 / 3 | two or more creatures that answer to it within 6 blocks of each other, 12–32 blocks off, in sight | one of the group | none but its eyes (no wisps, no shreds, no voice: it is not to stand out) | it wears them | — | come within 6 blocks of it, or look straight at it for 1.5 s | it comes apart and it is standing among them — a sighting (*One of Them*); unnoticed in 45 s, it lets the creature go |
| 30 | **What Was Left** (`rival_hunt`, 1.3.0) | 1 / 2 | a creature of a kind marked as its rival within 64 blocks, 16+ away, that nobody can see | behind the rival, unseen | far off, a crack and a scream (for that player, from there; a caption) | it hunts its rivals | — | go and look | the rival is torn apart; its footprints lead there and crimson shreds show to whoever finds the place within 5 min (*What Was Left*) |

**Lunge (shared reaction, stage 2+).** When it is noticed in *The Figure at the Edge*, *Always the Same Place* or *Echo
Ahead*, it may shriek and come at the player through the air in jerks (~14 blocks/s, floating a block up), then tear
apart right in front of them. Chance per
sighting: 25 % at stage 2; 50 % from stage 3 on Standard scares, 30 % on Rare; never with scares off or aggression
"never". Its own cooldown: 5 min (Standard scares) / 10 min (Rare). On High aggression it does not stop at a scare: it
keeps attacking.

**The standoff (1.0.9, shared).** In *The Figure at the Edge*, *Always the Same Place* and *In the Mire*, being seen
(or walked toward) starts a standoff instead of an exit. It watches; every ~3 s while stared at it may test the player
(a neck crack, a head tilt, one slow step closer); every second it is unwatched it creeps 2–3.5 blocks closer (never
inside the too-close distance + 2.5 blocks; from a ceiling it first drops to the floor). Anger rises only while it is
stared at: `380 / max(8, distance) × 0.2 × (0.7 + 0.15 × stage)` per 4 ticks, so about 4 s at 10 blocks, 9 s at 30 and
12 s at 45 (stage 2); it cools while unwatched. At 100 — or at once when shot (any projectile) or hit — it is provoked.
Otherwise it ends after 20–35 s, or sooner once it has been looked away from for 3 s (8 % a check): it is simply
gone. Provoked: from stage 2 (effective, so stage 1 in the Mire) and aggression ≥ 1 it is a rage — the relentless
attack in rage mode (~8 b/s, a shriek and a camera shake at the start, a shriek or a groan every 3 s); otherwise a
harmless lunge.

**Through tight spaces (1.0.9, shared).** In the relentless attack, the chase and the test strike: when it has gained
nothing for 1.5 s and the target is within 28 blocks, `observer/squeeze.js` searches a way block by block (A*, up to
5000 cells) through gaps a block high, closed doors (opened, manipulation ≥ 1) and glass, panes, leaves, webs, vines
and bamboo (broken, manipulation ≥ 2, never inside a Ward Lantern's radius). Doors and broken blocks are ledger
changes: put back afterwards, nothing dropped. Where the way is lower than three blocks it crawls (`crawl`, a
collision box a block high); it stands up again inside before it strikes.

**It rules them (1.2.0, shared — every appearance of its body).** `observer/dominion.js`, every tick while its body
exists: hostile creatures (family `monster`: Minecraft's own and any other add-on's) within 24 blocks of it, with a
player within 48, answer to it — at most 12 per appearance, once each, the nearest first (0.3 s + 1.2 ticks per block
+ up to 0.5 s after it arrives). Each turns to it (14°/tick at most) and is held still and harmless (Slowness VIII,
Weakness V, a creeper's fuse put out) for 1–2 s, then walks away — away from it and from the nearest player both —
at a held 2 b/s for 2.5–5.5 s, stopping at walls, drops, water or lava, then stands, still and harmless, until nobody
can see it for half a second, and is removed (no drops). Kinds marked its rival (up to 4 per appearance) are torn apart
instead, in its crimson shreds. A creature that hurts a player within 24 blocks of its body is torn apart at once.
Left alone: players, its own kind, tamed and name-tagged creatures, Minecraft's bosses (ender dragon, wither, warden,
elder guardian) and anything with 300+ health, and kinds marked "leave it alone". Marks are per kind (type id), set
on the Config Wheel → *Other creatures* by looking at one. It never reads or changes another add-on's files or
scripts — only the creatures in the shared world. Setting: *Other creatures answer to it*.

**Its puppets (1.3.0, shared).** `observer/puppets.js` takes a creature for its own (any creature but players and
its own kind; `possession.js` and the encounters choose which) and drives it: *stand* (held still and harmless, facing
the player or a point), *walk* (in its twitches — bursts and stops — to a place), *lurk* (closer only while the player
is not looking at it, never nearer than it keeps), *follow* (keeping a distance), *hunt* (Strength II, Speed II,
Resistance I, Fire Resistance, steered at the player so it cannot turn back), *free* (its own AI, harmless). Its tells:
`observer:servant_eyes` every 0.5 s, `observer:puppet_wisp` every second, `observer:puppet_shred` as it moves, its voice
out of it every 8–16 s (`observer.voice`, `observer.crack`, or a whisper to the player), the heartbeat (dread up to 0.7
within 24 blocks) and its theme (within 32) near it, the animals reacting to it, other creatures nudged away from it
(4 blocks), and through the Witness Lens a burst and blazing eyes (discovery *Its Puppets*). It notes `observer:puppet`
on the creature; released, every effect it gave is taken off and the note cleared (and, where asked, the creature is
put back where it was taken); a creature still noted when the game stopped is given back as it loads
(`entityLoad`) or when the scripts start. *Shared senses*: a puppet with the player in front of it and in sight within
24 blocks pulls their next encounter to within 15–30 s (at most every 5 min). Up to 32 at once; setting *It takes
creatures for its own*.

**Its puppets outside its encounters (1.3.0, `observer/possession.js`, every second).** *Marked puppets*: a kind marked
"Its puppet" (Config Wheel → Other creatures) within 64 blocks, stage 3+, one at a time, 35 % per opportunity, 10–15 min
apart: taken (3 s), brought up unseen 16–28 blocks from a player on the surface if it is underground or 32+ away, lurks
(keep 10) for 30–60 s or until the player is within 9, then (stage 4+, aggression Standard/High) hunts for up to 30 s,
then is put back where it was taken. A kind marked "Its puppet" is not sent away or torn apart by the 1.2.0 logic.
*The one cow*: at home (within 24 of the main haunt), stage 2+, 10 % per 10 s at most every 25–40 min: one cow,
mooshroom, sheep, pig, goat or chicken within 20 follows at 7 blocks (2.4 b/s), always facing the player, for up to 5
min; hit by the player, the possession is torn out (a burst; the animal is unharmed; *Its Puppets*). *Guards*: in the
Weeping Mire, stage 2+, up to two creatures that answer to it are posted behind weeping trunks (or hidden spots) inside
the Mire, unseen, facing the player; stage 4+ a guard within 6 blocks hunts; leaving the Mire releases them. *The night
they turn*: stage 5, once per player, at midnight (17600–18800) within 64 of home: every creature that answers to it
within 64 of home (up to 24, newcomers too) stands facing the home until dawn (or 7 min); discovery *The Night They
Turned*. *Tribute*: when a creature is sent away unseen (1.2.0), 30 % (at most every 10 min per player), the newest thing
a player within 64 blocks threw away (20+ blocks from them) is moved to where it was. *Its herald* (`observer/herald.js`,
with the director): before a tier 2+ encounter from stage 3, 40 %, a creature that answers to it 10–40 blocks off walks to
~16 blocks from the player and stares; the director waits 12 s (as for a silence), starts the encounter if it still fits,
and lets the herald go.

**They are its (1.2.1, shared).** From stage 3 the first three creatures that answer to it (four at stage 5), at least
5 blocks from the player, are kept as its *watchers*: after turning to it they walk (held 2.4 b/s) to places around
the player — ±70° and ±140° from the line to it, ~10 blocks out, the nearest standing spot — and stand there staring
at the player, held still and harmless, with its eyes (`observer:servant_eyes`, two glints refreshed every 0.5 s).
From stage 4 a watcher moves toward the player at 2.8 b/s only while that player is not looking at it (40° cone, line
of sight), stops dead when looked at, and never comes nearer than 4 blocks (it steps back if it is). When its body
goes, its watchers stay where they are, still, until nobody can see them for half a second (then they are removed),
for at most 30 s. **Its rage**: when it snaps (`relentless` with `rage`, stage 4+, aggression Standard or High), up to
four creatures it holds within 24 blocks of the player are let go — every effect removed — and keep its eyes for 10 s.

**The animals know (1.1.1, shared — every appearance of its body).** `observer/animals.js`, every tick while its body
exists: animals within 20 blocks of it (when a player is within 64) react once per appearance, at most eight at a time
and twelve in all, the nearest first — each 0.3 s + 1.5 ticks per block + up to 0.8 s after it arrives, so it ripples
through a herd. Each turns to it (14°/tick at most, looking up at its head when close) and is held still (Slowness VIII,
no particles, horizontal velocity cancelled). Grazing animals (cow, mooshroom, sheep, pig, goat, llama, horse, donkey,
mule, camel, chicken, rabbit, fox, armadillo), after 1–4 s, edge away (70 %) at a calm, held speed (1.5–2.2 b/s) for
2–3.5 s, stopping at a wall, a drop of two or more, water or lava, then stand and look back at it for 2–3 s. Dogs
(wolves) face it for up to 20 s and growl up to three times; cats hiss and back off; a villager only turns and looks;
one of a herd may call out (at most once). A tamed dog that growled at it whines once 1–2.5 s after it has gone.
Sitting pets stay sitting, leashed and ridden animals are left alone. Replaces M8 (1.0.x: a 30 % chance in *The
Figure at the Edge* that animals turn). Setting: *Animals sense it*.

**Hiding behind trees (1.1.0, shared).** *The Figure at the Edge* (45 % above ground when a trunk is in reach),
*In the Mire* (weeping trees first) and the test *Peeking from cover* use `space.hideSpot`: every log, wood and stem
within reach is found in one block query; it stands straight behind a trunk at least three logs high, where the
trunk hides its chest from the player, on a side where its leaning head (a block out at head height) is in sight both
ways. It looks round the edge (`peek`, with `look_at_target`); looked at for ~0.7 s it ducks back (`watch`, hidden) for
1.5–3.5 s and until the player stops looking at the tree; caught twice on one side, it looks round the other.
Wall-corner peeks now lean away from the wall (the lean used to go into it).

**Running at it (1.1.0, shared).** Sprinting straight at it (4.6+ b/s closing for 0.5 s, within 32 blocks, while
looking at it) during any still body encounter: `observer/charge.js` decides. From stage 2 (effective) and aggression
≥ 1 the chance to attack starts at 30 % and moves with the moment — dark +20 %, bright −20 %, the player hurt +15 %,
alone +10 % / with company −15 %, a Witness Lens or Flare in hand −35 %, its anger up to +25 %, and up to +35 % as it
learns this player charges (`profile` habit). Attack: a neck crack, then the rage. Otherwise it is gone at once and
sets an ambush: within 30 min, the first time the moment favours it (night, light ≤ 7, underground or the player
below half health), at least 30 s later, the next encounter comes within 5–15 s, quiet periods cut short, with tier
3+ encounters weighted ×3 (tier 2 ×1.5, tier 1 ×0.5).

**It knows you (1.1.0, shared).** `observer/profile.js` counts what the player does (each repetition strengthens a
habit, 1 − e^(−n/3); a tenth fades every 2.5 h of play): *stare* (provoked by a stare) → anger ×(1 + 0.6 h); *look away*
(left it until it was gone) → creep steps ×(1 + 0.8 h); *charge* → attack chance +0.35 h; *attack* (shot or hit it)
→ distant placement +10 h blocks; *flee* (outran it) → the chase starts 8 h blocks closer; *ignore* (encounters
unnoticed) → distant placement −8 h blocks and, past 0.5, an audible arrival. Each minute it samples where the
player is (caves / home / surface) and whether it is night, and counts lights placed; the director weighs each
encounter by place (×0.8–1.7), night (×1–1.5), lights (*Lights Out* ×1–2) and how well that encounter has worked on
this player before (×0.6–1.4), all within ×0.5–2.2.

**It vanishes (1.0.9, shared).** When an encounter is over it no longer walks away: it holds where it is for a
breath and is gone, torn apart where it stood.

**Too close (shared reaction).** Walk up to it (4–8 blocks, varying; 9 in the Weeping Mire; room-sized in *It's
Inside*) and it tears apart after a short random moment — or, now and then (stage 2+, ~30 %, at most every 75 s),
rises and strikes once first, from the air.

**It never runs (1.0.8, shared).** Every time it comes at someone — the chase, the lunge, the relentless attack (from
*The Closed Path*, *Closer Each Time*, *Breathing Room* and the test strike), the too-close strike — it floats: a
block off the ground (`surge`), no footsteps, a rush of air every 2 s, and the strike, the recoil and the stares in
between stay in mid-air with the legs hanging limp (`observer:afloat` + the `float_hang` overlay). It still walks
when it is only stalking or leaving.

**Its home: the Weeping Mire (1.0.7).** In the Mire the director treats the player as one stage further along (so the
chase, *The Closed Path* and *It's Inside* can come from stage 3, and the silence before attacks from stage 3), shortens
every gap between encounters (mood ×0.7, floor 0.45 instead of 0.6), and ends the grace period after 30 s spent there.
*In the Mire* is its most likely encounter there. A torn page that is new to the player brings it up behind them one
time in five; the last of the eight always does, whatever its cooldown.

**Climbing after you (1.0.6, shared).** In the chase, the relentless attack and *Closer Each Time*: when the player
stands 2.5+ blocks above it within 7 blocks (a pillar, a ledge, a wall top, a ladder, a cliff) it climbs the open face
beside them (~4 b/s, the `climb` clip, staring up at them). At an edge it hangs 1.5 blocks below them and strikes from
the wall; further back on a plateau it climbs the nearest face, pulls itself over the top and comes on. A roof, an
overhang or a sealed tower stops it; if the player comes down or moves off it lets go and drops.

**It learns how you escape (1.0.5).** Every way a dangerous encounter ends is counted per player: light
(*repelled by light*), water (*escaped into water*), gaze (*stared down / held off*), lens, hit, outrun (*escaped*),
veil (*broke through The Closed Path*) and flare. After the same way is used 3 times — and more than any other — it
adapts to that one way only: **light** it puts the lights near you out before it comes and needs 2 more light levels,
held 1.5× longer; **water** it waits at the shore up to 15 s and comes on if you climb out; **gaze** *Closer Each
Time* starts behind you and every stare must be held 1.5× longer; **lens / hit / flare** the first one in an
encounter only makes it flinch; **outrun** it follows 16 blocks further; **veil** the way back is sealed twice. Using
another way takes half a point off the others; a way not used for 20 minutes fades (about half per further 20
minutes), so three uses close together always teach it. It writes what it
learned into the Field Notes ("What I have learned", and a page in its own hand). Setting: *It learns how you escape*.

**The world goes quiet (1.0.5, stage 4+).** Before *Breathing Room*, *The Closed Path* or *Closer Each Time*, the
director first silences that player's music (`Player.playMusic` of a near-silent looping track: a faint ringing that
rises over 8 s) for 20–30 s. Then the announced encounter starts (or another dangerous one that fits where the player
is now); one time in four nothing follows. The silence lasts until the encounter ends. Setting: *The world goes quiet*.

**Pages you didn't write (1.0.5, stage 2+).** At most one per in-game day (20–35 min of play, scaled by frequency),
never during an encounter, only once the player has Field Notes: a page in another hand built from tracked numbers —
blocks mined/chopped/dug, lights placed, doors and chests used, meals, creatures hurt, the time they last slept, looks
behind them, blocks walked, sightings, deaths, the coordinates of home, the lens. Stage 4+ uses a darker variant of
each. Setting: *Pages you didn't write*.

**It returns what you threw away (1.0.5, stage 2+).** An item a player drops by hand and leaves (45 s+, 24+ blocks
from both home and the player) is moved — the same item entity, so nothing is duplicated — to the outside of a door of
their home (else beside the bed) once they are home, out of everyone's sight, with a knock. At most once per in-game
day. Needs manipulation above off. Setting: *It returns what you threw away*.

**The Flare (1.0.5, an item).** Thrown; burns 8 s where it lands with a real light block (ledger-recorded, removed
when it burns out) and a hissing glare. The Observer within 16 blocks of a burning flare recoils and tears apart
(outcome *flared*), even mid-attack: a strike already winding up does no damage. Taiga shadows near it vanish.

**Taiga shadows (ambient, not an encounter).** In taiga biomes only: a harmless shadow of it stares from 32–60 blocks
among the trees, always 40°+ off to the side of where you are looking, and vanishes the instant it is looked at, with a vanilla cave noise for that player.

**Peeking.** Whenever it stands still beside cover (a trunk, a wall corner, a door frame) relative to the player, it
leans out from behind it; without cover it stands normally.

★ = signature encounter (combines stalking, a noticeable discrepancy, environmental manipulation and a meaningful
choice). Context-adaptive placement (water surface, ground below elevated players, caves, Nether/End) is part of
encounter 1 rather than counted as separate types.

## Planned concepts (16)

| # | Concept | Context → cue → intention → manipulation → response → consequence |
|---|---|---|
| 23 | **Rooftop** | indoors under a roof → heavy steps directly above your head that stop when you stop → closeness → none → go outside and look up → footprints on the roof |
| 24 | **Held Door** | you open a door it is behind → the door will not open for two seconds (state reset each tick) → it is on the other side → M1 → step back / use the lens → it lets go; knock |
| 25 | **Lantern Trail** | night travel → a line of lanterns (temporary, no drops) leading into darkness → to lead you somewhere → place lights → follow / ignore → at the end: an effigy or it, waiting |
| 26 | **Imprint** | returning to bed → footprints lead to your bed and stop → it lay where you sleep → none → move your bed / ward the room → *Imprint* page |
| 28 | **Swap** | two identical decorative blocks nearby → they exchange places → is it the same room? → two linked ledger changes → notice / put back → *Put Back* |
| 29 | **Borrowed Voice** | near villagers → villager sounds carry your habit sounds → imitation through others → positional sounds at mobs → investigate → footprints between them |
| 30 | **The Waypoint** | open terrain → a locator-bar waypoint (script Waypoint API) flickers once, pointing at it → being findable → none → follow it → it is gone when you arrive; effigy |
| 31 | **Where You Fell** | after a death → an effigy stands at the death location facing where you fell → memory → M6 → retrieve your items / break it → *Where You Fell* page |
| 32 | **Night Shift** (multiplayer) | one player sleeps, another is awake → it visits the one who is awake, near the sleeper → protectiveness? → M1/M2 → wake the sleeper / guard → shared discovery |
| 33 | **Copy Cat** (Unsettling) | branch mining → a parallel tunnel appears beside yours (carved, restored later) → imitation → M7 → explore it → it stands at the end |
| 34 | **Undertow** | swimming far from shore → a gentle current pulls toward where it stands on the water → isolation → small impulses → swim against it / get in a boat → it sinks |
| 35 | **Distant Lights** | night on high ground → torches lit far away in a line pointing at you → announcement → temporary placed lights → go and look / ward → the line points somewhere new |
| 36 | **The Visitor's Chair** | your work spot (crafting/furnace) → a stair block placed facing it, as if someone sat watching → it watched you work → mimic placement → sit in it / remove it → *The Visitor's Chair* page |
| 37 | **Counted** | after 7+ in-game days → seven knocks at the door at dusk → it counts with you → none → open the door → nothing but footprints |
| 38 | **Map Edge** | exploring new chunks → the first new area you enter has its footprints already in it → it went ahead → traces → follow the trail → *It Went Ahead* page |
| 39 | **Second Echo** (multiplayer) | two players far apart → each hears the other's work sounds where they are → it carries you to each other → borrowed sounds across players → compare notes → shared *Borrowed Work* |

## Adding a new encounter

See [DEVELOPER_GUIDE.md §4](DEVELOPER_GUIDE.md#4-adding-an-encounter). Rules that keep new events consistent with the
character:

1. Lead with a discrepancy; show the body only if it adds something.
2. Use the ledger for every block change; give each change a purpose the player can read.
3. Give every dangerous moment a warning, a response window and at least two outs.
4. Make the "right answer" learnable and write it down as a discovery lesson.
5. Defer instead of forcing: if `prepare()` cannot find valid positions or blocks, return `false`.

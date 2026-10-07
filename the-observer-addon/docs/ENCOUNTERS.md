# Encounter Library

Every encounter is built from the same formula:

**Context + Location + Cue + Observer intention + Manipulation + Player response + Consequence**

Implemented encounters live in `packs/TheObserver_BP/scripts/encounters/` (one file each) and register themselves with
the director. Concepts marked *planned* are design-ready but not implemented in 1.0.0 — they are not advertised as
features. "Tier" is intensity (1 subtle … 4 peak); "Stage" is the minimum stage at which the director may choose it.

## Implemented (18 mechanically distinct types)

| # | Encounter (file) | Tier / Stage | Context | Location | Cue | Intention | Manipulation | Player response | Consequence |
|---|---|---|---|---|---|---|---|---|---|
| 1 | **The Figure at the Edge** (`distant_watch`) | 1 / 1 | anywhere; adapts to water, height, caves | 26–44 blocks at the edge of attention; on water; on the ground below a high player; at the favoured bearing | a still silhouette, partly behind cover; animals facing it (stage 2+); eye glints in darkness | to be noticed — or not | M8 animals turn (30% at stage 2+) | look at it ~1 s / approach / ignore | noticed → it steps away (*The Figure*); water → it sinks; ignored → footprints remain where it stood |
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
| 13 | **Breathing Room** (`pursuit`) | 4 / 5, aggression ≥ 1 | night/underground/dark, health ≥ 50 % | appears in view 24–34 blocks | rising hum, lights die, fog, 3 s stare | to hunt | M2 lights | sprint / keep it in view / light / water / lens / strike | escape (*Breathing Room*); repelled; one telegraphed strike then it leaves |
| 14 | **At the Window** (`window_watch`) | 2 / 2 | indoors (roof, sky light outside) | outside, framed by a window or opening | a figure at the window | walls do not stop it | — | look / don't | it steps out of the frame (*The Window*); footprints under the window |
| 15 | **Second Witness** (`second_witness`) | 2 / 2 | ≥ 2 players within 40 blocks | hidden from the target, visible to the other | chime to the witness | to be seen by the wrong person | — | the witness warns the target | both see it (*Second Witness*) |
| 16 | **While You Slept** (`night_visit`) | 2 / 2 | the player sleeps (event-triggered) | the bed and nearest door | door creak on waking; footprints door → bed | it came in | M1 door, M2 a light, M6 effigy at the foot of the bed | close the door / break the effigy | *While You Slept*; reverts in 5 min |
| 17 | **It Came Through** (`portal_follow`) | 1 / 2 | 60–150 s after a dimension change | the arrival point | heavy arrival, two steps, footprints away | continuity | — | — | *Elsewhere Too* (Nether/End) |
| 18 | **The Vigil** (`vigil`) | finale | player-initiated: 12 pages, a Witness Lens, night, near home | the home grounds | chime per round, title cards | to be witnessed | M1, M2, M4 screens; optional global rain | find it and hold it three times | **Witnessed** + The Observer's Eye; or blackout and retry |

★ = signature encounter (combines stalking, a noticeable discrepancy, environmental manipulation and a meaningful
choice). Context-adaptive placement (water surface, ground below elevated players, caves, Nether/End) is part of
encounter 1 rather than counted as separate types.

## Planned concepts (17)

| # | Concept | Context → cue → intention → manipulation → response → consequence |
|---|---|---|
| 19 | **Rooftop** | indoors under a roof → heavy steps directly above your head that stop when you stop → closeness → none → go outside and look up → footprints on the roof |
| 20 | **Held Door** | you open a door it is behind → the door will not open for two seconds (state reset each tick) → it is on the other side → M1 → step back / use the lens → it lets go; knock |
| 21 | **Lantern Trail** | night travel → a line of lanterns (temporary, no drops) leading into darkness → to lead you somewhere → place lights → follow / ignore → at the end: an effigy or it, waiting |
| 22 | **Imprint** | returning to bed → footprints lead to your bed and stop → it lay where you sleep → none → move your bed / ward the room → *Imprint* page |
| 23 | **Herd Watch** | farm or pasture → every animal stops and faces one spot → that is where it stands → M8 extended → look where they look → it steps out of sight |
| 24 | **Swap** | two identical decorative blocks nearby → they exchange places → is it the same room? → two linked ledger changes → notice / put back → *Put Back* |
| 25 | **Borrowed Voice** | near villagers → villager sounds carry your habit sounds → imitation through others → positional sounds at mobs → investigate → footprints between them |
| 26 | **The Waypoint** | open terrain → a locator-bar waypoint (script Waypoint API) flickers once, pointing at it → being findable → none → follow it → it is gone when you arrive; effigy |
| 27 | **Where You Fell** | after a death → an effigy stands at the death location facing where you fell → memory → M6 → retrieve your items / break it → *Where You Fell* page |
| 28 | **Night Shift** (multiplayer) | one player sleeps, another is awake → it visits the one who is awake, near the sleeper → protectiveness? → M1/M2 → wake the sleeper / guard → shared discovery |
| 29 | **Copy Cat** (Unsettling) | branch mining → a parallel tunnel appears beside yours (carved, restored later) → imitation → M7 → explore it → it stands at the end |
| 30 | **Undertow** | swimming far from shore → a gentle current pulls toward where it stands on the water → isolation → small impulses → swim against it / get in a boat → it sinks |
| 31 | **Distant Lights** | night on high ground → torches lit far away in a line pointing at you → announcement → temporary placed lights → go and look / ward → the line points somewhere new |
| 32 | **The Visitor's Chair** | your work spot (crafting/furnace) → a stair block placed facing it, as if someone sat watching → it watched you work → mimic placement → sit in it / remove it → *The Visitor's Chair* page |
| 33 | **Counted** | after 7+ in-game days → seven knocks at the door at dusk → it counts with you → none → open the door → nothing but footprints |
| 34 | **Map Edge** | exploring new chunks → the first new area you enter has its footprints already in it → it went ahead → traces → follow the trail → *It Went Ahead* page |
| 35 | **Second Echo** (multiplayer) | two players far apart → each hears the other's work sounds where they are → it carries you to each other → borrowed sounds across players → compare notes → shared *Borrowed Work* |

## Adding a new encounter

See [DEVELOPER_GUIDE.md §4](DEVELOPER_GUIDE.md#4-adding-an-encounter). Rules that keep new events consistent with the
character:

1. Lead with a discrepancy; show the body only if it adds something.
2. Use the ledger for every block change; give each change a purpose the player can read.
3. Give every dangerous moment a warning, a response window and at least two outs.
4. Make the "right answer" learnable and write it down as a discovery lesson.
5. Defer instead of forcing: if `prepare()` cannot find valid positions or blocks, return `false`.

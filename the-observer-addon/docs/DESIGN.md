# The Observer — Design Document

> *It follows you wherever you go. You rarely notice it directly. You notice that something around you is wrong.
> Over time, you realize it can manipulate your surroundings — and that the changes have a purpose.*

This document is the source of truth for The Observer's identity, rules and systems. Every mechanic described here
is implemented; the file that implements it is named next to it. Runtime evidence is in [TEST_REPORT.md](TEST_REPORT.md)
and the per-feature status is in [FEATURE_MATRIX.md](FEATURE_MATRIX.md).

---

## 1. Identity

The Observer is a tall (4 blocks), gaunt figure in a black hood with two pinprick white eyes and no mouth — the model
supplied with this project (the "Hollow Dweller" Blockbench pack). It is silent: it has no voice, only cloth, weight
and breath.

It is not a hunter. It is a **student of one person at a time**. Everything it does is a test of whether you are paying
attention: it imitates you, rearranges your things, closes your paths, and watches what you do about it. It is
dangerous when ignored and when cornered, and it can be understood. The long-term goal of the add-on is to understand it
well enough to *witness* it properly (see §10).

**Tone rules** used when designing every encounter:

* Discrepancy before presence — players should usually notice that *something is wrong* before they see *it*.
* Its changes are deliberate and few. Never random vandalism; always an arrangement with a purpose.
* No screaming. Threat is expressed by stillness, closeness, breath, and the hum.
* Every dangerous moment is announced, has a response window, and has more than one way out.

## 2. The three pillars → systems

| Pillar | Player experience | Systems |
|---|---|---|
| **Presence** — it follows you everywhere | It is behind you on the road, in the cave, outside your window, on the water, below your sky base, in the Nether | Director (`director/director.js`), placement (`world/space.js`), body (`observer/body.js`), memory (`observer/memory.js`), dimension follow-up (`encounters/portal_follow.js`) |
| **Discrepancy** — you notice it through inconsistencies | An extra footstep, your own sounds from an empty place, a pumpkin now facing you, a door open, lights out in order, footprints | Personal audio/visual cues (`director/encounter.js`), evidence traces (`main.js tickTraces`), the tells in §6 |
| **Manipulation** — it changes the world with intent | It stages your home, seals the tunnel behind you, changes your route, takes your light | The ledger (`world/ledger.js`) and eight manipulation mechanics (`world/manipulate.js`, §7) |

## 3. The Observer's rules

These are the rules the code enforces. Players can learn all of them; the Field Notes write them down as they are
discovered (each discovery has a *lesson* line — see `texts/en_US.lang`).

### 3.1 What it perceives
* Each player's position, dimension, view direction, movement speed, sneaking, swimming/boat, gliding, sleeping,
  health, game mode, the light level and sky light at their head, whether they are under a roof, underground, or
  high above the ground (`director/context.js`).
* Whether any player is looking at it: three sample points on its body are tested against each player's view cone and
  line of sight; glass, panes, bars, fences and similar blocks are seen through (`world/sight.js`).
* Block changes players make near its own changes (interaction, placement, breaking, explosions, and a 10-tick scan of
  its own ledger entries that catches redstone/pistons/other add-ons) (`world/ledger.js`).
* Blows and Witness Lens use (`progression/items.js`).

### 3.2 What it remembers (bounded, per player, persistent)
Stored as JSON in the player's dynamic properties (`core/state.js`), all derived from observable play:

| Memory | Bound | Signal | Used for |
|---|---|---|---|
| Breadcrumbs | 32 points | position every ~6 blocks moved | borrowed sounds, footprint evidence |
| Haunts | 6 cells (16×16) | seconds spent per cell, ×2 for the cell with your bed | home visits, the vigil |
| Route familiarity | 96 cells (8×8) | distinct visits (≥2 min apart) | route alteration |
| Habits | 8 decaying counters | mining / chopping / digging / farming / building / lighting / doors / storage / eating / fighting events | which sounds it borrows, how often it takes your light |
| Last activity locations | one per habit | where the habit last happened | where borrowed sounds come from |
| Attentiveness | 0..1 EMA | noticed vs. ignored encounters | context for future tuning; shown in `/observer:status` |
| Favoured bearing | one angle + distance | assigned on first use | the "always the same place" tell |
| Encounter history | 12 entries + per-type timestamps | every encounter | anti-repetition, cooldowns |
| Lifetime tallies | ~12 counters | blocks mined/chopped/dug, lights placed, doors, chests, meals, creatures hurt, nights slept (and the time), sharp looks behind, blocks walked | the pages it writes (1.0.5) |
| Ways out | 8 decaying counters + the one it adapted to | how each dangerous encounter ended | escape learning (1.0.5) |

"It learns your habits" therefore means, concretely: it borrows the sound of whatever you have done most recently and
most often, plays it from where you last did it, visits the 16×16 area where you spend the most time, alters routes
you have walked at least three separate times, and takes your light more often if you place a lot of it.

### 3.3 What it can influence
* **Personal** (only the target perceives): positional sounds, particles, footprint trails, fog (`/fog` per player),
  camera fades and shakes, action-bar captions.
* **Shared** (everyone present perceives): its body; real block changes (§7); nearby animals turning toward it;
  sounds of real blocks moving.
* **Global** (whole world): rain during the vigil only, if "world-wide effects" is enabled; announced in chat as a
  world event. Nothing else it does is global.

### 3.4 What it does — behavioural rules
1. **It avoids being looked at.** When a player holds their gaze on it (about 1 s), it acknowledges and steps out of
   sight. It never walks while watched except when hunting, and then only at a slow walk.
2. **It only advances while unwatched.** In the Closed Path and the Pursuit, being looked at freezes or slows it; a long
   enough stare drives it back.
3. **It will not step into light it did not make.** Block light ≥ 11 at its next position stops it; a player standing in
   light ≥ 11 drives it away.
4. **It answers being answered.** Restoring one of its changes ends a test peacefully and it restores the rest itself.
5. **It returns to the same relative place.** Each player has a favoured bearing (behind-left or behind-right) and
   distance that it reuses everywhere.
6. **It announces itself.** A chime precedes its arrival at the predicted place; a hum precedes any danger.
7. **It does not destroy.** All its block changes are recorded and reversible (§8).
8. **It cannot be killed.** It takes no damage; blows and the Witness Lens make it recoil and withdraw, and enough
   pressure (3 blows/lens uses) buys a 15-minute withdrawal. A burning **Flare** within 16 blocks drives it off
   outright — even mid-attack.
9. **It learns how you escape (1.0.5).** The way each dangerous encounter ends is counted; after the same way three
   times it adapts to that one way (light → it snuffs your lights first and needs more; water → it waits at the
   shore; gaze → it comes from behind and must be stared at longer; lens/hit/flare → the first in an encounter only
   makes it flinch; outrun → it follows further; veil → a double seal). One adaptation at a time, so there is always a
   way out; it wears off when the player changes habits. It says what it learned in the Field Notes.
10. **It announces danger with silence (1.0.5).** From stage 4 its dangerous encounters are preceded by 20–30 s in
   which the player's music stops and a faint ringing rises; one time in four nothing follows.

## 4. The body (supplied model integration)

The supplied ZIP (`source_assets/supplied/`, preserved byte-for-byte with SHA-256 sums) contains a Blockbench project,
a Bedrock geometry export (`geometry.hollow_dweller`, 36 bones, 185 cubes, 1024×512 texture, ~4.02 blocks tall) and a
Bedrock animation export with five clips. `tools/integrate_supplied_assets.py` writes namespaced copies into the
resource pack (only identifiers change; it asserts every bone, cube, UV and keyframe is identical).

### 4.1 Animation mapping
| Entity state (`observer:state`) | Animations | Origin | Used when |
|---|---|---|---|
| `watch` | `idle` + `look_at_target` | supplied + new | standing observation |
| `stare` | `staring` + `look_at_target` | supplied + new | contact, the response window |
| `tilt` | `pose` (hold) | supplied | acknowledgement: the crooked head-tilt when it has been seen |
| `walk` | `stalk_walk` + `look_at_target` | **new** | creeping approach, retreat, walking away |
| `run` | `running` | supplied | the relentless attack (running you down between strikes), the lunge |
| `float` | `float_drift` + `look_at_target` | **new (1.0.6)** | the chase while watched: a block off the ground, legs hanging limp, toes down, almost still — then broken by sudden one-frame snaps (the head jerking to a wrong angle and holding there, a shoulder hitching, the whole body dropping and catching, a limb spasming), each with a crack (`observer.crack`); 4.8 s loop |
| `surge` | `float_surge` | **new (1.0.6)** | the chase when unwatched: rushing through the air, pitched forward, arms and legs streaming behind |
| `climb` | `climb` | **new (1.0.6)** | climbing a wall, pillar or cliff after a player, hand over hand, staring straight up at them |
| `attack` | `attack` (once) | supplied | telegraphed strike; damage applied at the clip's strike frame (0.6 s) |
| `peek` | `idle` + `peek` | supplied + **new** | leaning out from cover; side from `observer:side` |
| `recoil` | `recoil` | **new** | witnessed through the lens, struck, driven back by light |
| `hidden` | — (no parts) | — | momentary vanish |
| `observer:stoop` = true (overlay) | `stoop` | **new** | automatically when headroom < 5 blocks |

Supplemental clips are generated by `tools/make_supplemental_anims.py` using only the supplied bones. Before writing
them, the rotation convention was verified by rendering the supplied clips with an offline forward-kinematics renderer
(`tools/render_model.py`) and comparing against the supplied previews (arm splay in the turnaround, head tilt in the
preview). The walk and stoop root heights are solved numerically so the lowest foot rests on the ground; the stoop
lowers the figure to 2.81 blocks so it fits its 2.9-block collision box. The floating clips lift only the model (the
root bone, 1 block, less under a low ceiling: `16 * (1 - q.property('observer:stoop'))`); its collision box stays on
the ground, so it keeps the normal pathfinding around walls, trees and doors. Previews of every new clip are rendered
by `tools/preview_anims.py` (`docs/media/1.0.6/`).

### 4.1.1 The floating chase and climbing (1.0.6)
* **The chase floats.** *Breathing Room* no longer runs: unwatched it surges (`surge`, ~6.2 b/s measured), watched it
  drifts (`float`, ~2.6 b/s). Its footsteps are silenced (`minecraft:movement_sound_distance_offset` 1000 through the
  `observer:steps_off` event) and a rush of air (`observer.drift`) is heard every 2 s instead. Walking away afterwards,
  it drifts rather than walks. The attack that follows when it reaches you keeps floating.
* **Water still saves you.** It never crosses water: it floats to the last dry ground between it and you and hovers
  there, watching (with the *water* adaptation it waits there up to 15 s and comes on if you climb out).
* **Climbing does not.** `observer/climb.js`: when the player it is after stands 2.5+ blocks above it within 7 blocks
  (a pillar, a ledge, a wall top, a ladder, a cliff), it goes to the open face beside them and climbs it at ~4 b/s:
  at an edge it hangs 1.5 blocks below them — close enough to strike — and strikes from the wall; further back on a
  plateau it climbs the nearest face toward them, pulls itself over the top and comes on across it. Every cell its
  body passes through must be empty, so a roof, an overhang or a sealed tower stops it. If the player comes down or
  moves off, it lets go and drops. Used by the chase, the relentless attack and *Closer Each Time* (which, unwatched,
  is simply on the wall below you next time you look).

### 4.2 Physical properties (`entities/the_observer.json`)
* Collision 0.8 × 2.9 (fits 3-high corridors stooped; cannot pass 2-high doors — it opens them to look in instead).
* Immune to damage, knockback and status effects; not pushable; fire-immune; breathes water.
* Modes (component groups): **still** (no gravity — it can stand on water and ledges), **approach** (~2.8 b/s, what it
  does while watched), **pursue** (~6.4 b/s measured: faster than sprinting at 5.6 — it cannot be outrun). Speeds were
  calibrated on the dedicated server (speed ≈ 3.88 × multiplier² b/s for this entity). Walking *away* is script-driven (validated 0.18-block
  steps at ~1.8 b/s, at most one block up or down, three open blocks overhead): the vanilla `avoid_mob_type` goal in
  the unused `retreat` group did not move it away from players in the capability probe.
* Head tracking and auto-stoop by headroom.
* **Eyes**: a second render layer holds only the two white eye cubes and is drawn at full brightness, so the eyes
  glow in darkness the way the vanilla Creaking's do. At night or in light ≤ 7 (`observer:dark`), a soft glow is also
  attached to two locators on the eye cubes, so it follows every head movement.
* **Aura**: while it is shown, glowing wisps (the user-supplied wisp sprites, additive, unlit) drift around it from
  feet to head (`observer:wisp`, bound to the entity).
* **Vanish**: every time it is removed — leaving, being stared down, a lunge, an abort — it tears apart into the
  user-supplied crimson shreds (`observer:vanish`) with a ripping sound.
* **Its own sounds**: an ambient voice every 5–12 s (a creaking groan through cloth with a wet inhale and throat
  clicks, `observer.voice`), a pressure swell when it arrives (`observer.presence`), a rattle of clicks and a neck crack
  the moment it is seen (`observer.notice`), a rising distorted shriek when it comes at you (`observer.shriek`), and the
  rip when it vanishes (`observer.vanish`). All synthesized for this project.
* **Peeking**: only ever from behind something. Whenever it stands still with cover on one side relative to the
  player, it leans out from behind it; with nothing beside it, it never peeks (a requested peek becomes a plain stance),
  and lookout spots strongly prefer a trunk or wall corner.
* **Attacks**: every strike is telegraphed (0.6 s wind-up; stepping back makes it miss). On Standard (3 hearts) and High
  (4.5 hearts) aggression, once it reaches a player it keeps attacking — running them down between strikes — until
  they are dead or drive it off with the Witness Lens or a blow (40 s limit; it also gives up beyond 64 blocks). Low
  aggression: a single strike, never more than 70 % of current health above half health. "Never attacks" and Peaceful:
  no damage, only darkness.
* **Too close**: walk up to it (the trigger distance varies 4–8 blocks per appearance) and after a short random moment
  it tears apart before you can touch it — or, now and then (stage 2+, about 30 %, at most every 75 s per player), it
  steps in and strikes once first. Encounters that bring it close on purpose (the chase, *The Closed Path*, *Closer Each
  Time*, *Close*, *Out of Step*, the vigil) are exempt.
* **Taiga shadows** (`observer/illusions.js`): in taiga biomes only, a harmless shadow of it (`observer:shadow`, a
  near-black silhouette with white eyes) stands 32–60 blocks off among the trees, staring, about every 1–3 minutes
  (sooner at night). The instant anyone looks straight at it, it is removed — no burst — and that player hears the
  vanilla cave ambience (`ambient.cave`). Unseen, it fades after 25–45 s. One per player; never in other biomes.

## 5. Presence and stalking

Stalking is **logical, not a permanently loaded entity.** Between encounters there is no body in the world; the
director keeps a per-player relationship (stage, tension, history, memory, favoured bearing) and decides when and where
it next shows itself. When it does, there is exactly one physical body in the world, and every placement is validated.

### 5.1 Valid placement (`world/space.js`)
A position is accepted only if: its chunk is loaded; it starts in open space (never inside rock); the ground is solid
and not dangerous (lava, fire, magma, cactus, berry bushes, powder snow, cobweb, campfires, portals, leaves…); the feet
block is clear; headroom is ≥ 3 blocks (stooped) or ≥ 5 (upright); no lava/fire adjacent; it is not within 12 blocks of
a Ward Lantern; and, depending on the encounter, it is hidden from / partially visible to / visible to specific players
and has line of sight to the player's head or to another point (e.g. their home).

Candidates are sampled on rings around the player at encounter-specific bearings and distances, scored for partial
concealment, adjacent cover, darkness and level, and the best is used. **If nothing qualifies, the encounter is
deferred** (the director tries something else soon) — it never forces an invalid spawn.

### 5.2 Placement strategies by context
| Context | Behaviour |
|---|---|
| Open ground | 26–44 blocks, at the edge of attention (60–125° off the view direction), partly behind cover |
| Caves / Nether | 14–26 blocks, same level as the player (scan starts at head height, never inside rock) |
| Water / boat | stands **on the water surface** 26–42 blocks away; sinks when noticed or approached |
| Elevated (>12 blocks above ground) | stands on the ground below, looking up |
| Indoors | outside a window or opening, framed by the wall (`window_watch`) |
| Moving | ahead along the travel direction (`echo_ahead`), or behind (`extra_step`) |
| Still for 6+ s | right behind them (`close_breath`) |
| With other players | hidden from the target but visible to a nearby friend (`second_witness`) |

### 5.3 Relocation
It is moved by teleport only while no player can see the destination (`arriveUnseen`) or the encounter deliberately
repositions it out of view. Visible approaches use real pathfinding (approach/pursue modes). It leaves a scene by
walking away from its watchers in validated steps and is removed once no watcher can see it; only if it is still
watched after 6 s does it "unravel" in place (with a smoke burst).

### 5.4 Continuity
* **Travel and fast movement**: placement is computed from the player's current position each encounter; the director
  does not need a body to keep up.
* **Dimension changes**: the running encounter aborts and its changes revert after 30 s; 60–150 s later a
  "It Came Through" follow-up plays at the arrival point (heavy arrival, two steps, footprints) — stage ≥ 2.
* **Disconnect / rejoin**: per-player state is saved every 5 s, on shutdown and at the moment the player leaves; on
  rejoin it continues from the same stage, tension, history and memory. Any fog layer or chase tag left on a player
  who disconnected mid-encounter is cleared when they rejoin.
* **Reload / crash**: the active encounter is recorded in world state. On load it is treated as interrupted, its
  changes are scheduled for restoration in 20 s, and any Observer entity that does not belong to a running encounter is
  removed when its chunk loads (`body.registerEvents`, `sweepStrays`).
* **Unloaded areas**: restoration waits until the chunk is loaded again.

## 6. Discrepancy: the tells

| Tell | Where | What a careful player learns |
|---|---|---|
| Footsteps in your rhythm, on the ground material behind you, then one extra heavier step | `extra_step` | turn around when the steps stop after you |
| Steps falter when you sneak | `extra_step` | it copies your rhythm |
| Your own habitual work sounds from an empty, earlier place | `borrowed_sound` | go and look; footprints remain |
| An object with a face now faces you | `turned_object` | things with a front can turn |
| A door/trapdoor/gate in the wrong state, with its sound from there | `door_ajar` | close it; it knocks once |
| Lights going out in order, farthest first | `snuffed_lights` | relight one |
| A faint chime from behind-left/right two seconds before it arrives | `mirror_bearing` | check your side |
| Dark motes and a chime at a spot ahead | `echo_ahead` | watch the spot and it cannot arrive |
| A tunnel or path that ends where it did not | `unfamiliar_route` | dig through; the stone drops nothing |
| Animals all facing one way | `distant_watch` (stage ≥ 2) | look where they look |
| Two white eyes glowing in the dark | eye layer + eye glow | it is there, and it is looking at you |
| A groan through cloth nearby | its ambient voice | it is close, even if you cannot see it |
| A rattle of clicks and a crack | `observer.notice` | it knows you have seen it |
| A shriek | lunge, *Closer Each Time* | it is coming at you: hold your ground and look, or step back from the strike |
| Footprints that appear when you return to where it stood | evidence traces | it was here |
| A low rising hum | `closed_path`, `pursuit` | danger: find light, keep it in view, or leave |
| Cloth shifting, then breath | `close_breath` | turn around |

**Accessibility.** Critical cues have optional action-bar captions (per player, from the Field Notes, or world
default in settings). Visual tells never depend on colour alone; the hum always comes with fog and lights going out.
The Tally Chalk turns "was that changed?" into an explicit, always-shown message.

## 7. Environmental manipulation

All block changes go through the **ledger** (§8). Intensity is set by the *Environmental manipulation* setting:
0 off (sound/sight only), 1 subtle, 2 standard (default), 3 unsettling.

| # | Mechanic | Purpose | Activation | Scope / max | What physically changes | Audio-visual only | Duration / cooldown | Warning → response | Multiplayer | Cleanup | Verified by |
|---|---|---|---|---|---|---|---|---|---|---|---|
| M1 | **Doors** (`toggleOpenable`) | invitation / evidence of entry | door_ajar, home_visit, night_visit, unfamiliar_route, vigil; level ≥ 1 | 1 per encounter (vigil 3), ≤ 16 blocks | `open_bit` of doors (both halves, linked), trapdoors, fence gates; iron doors excluded | door sound at the door | reverts 4–10 min later; type cooldowns 7–40 min | sound from the door → close it (knock answers) | everyone sees the door | restored only if still in its changed state | `door_ajar`, `night_visit`, `ward` tests |
| M2 | **Lights** (`snuffLight`) | isolation, test | snuffed_lights, home_visit, closed_path, pursuit, night_visit, vigil | ≤ 4 (home 3, tunnel 6), ≤ 12 blocks | torches/lanterns removed (level ≥ 2), candles `lit=false` / campfires `extinguished=true` (level ≥ 1) | snuff sound + smoke at each | reverts 20 s–8 min; cooldown 15 min | lights die farthest-first → relight or place any light | shared | torch returns only to an empty spot; never drops items | `snuffed_lights`, `home_visit` tests |
| M3 | **Turned objects** (`turnToward`) | "something facing you" | turned_object, home_visit; level ≥ 1 | 1 object ≤ 14 blocks | `minecraft:cardinal_direction` of pumpkins, jack o'lanterns, stonecutters, anvils (no inventories, no redstone) | scrape + dust | reverts 10–12 min; cooldown 6 min | look at it / turn it back | shared | restored unless the player turned it | `turned_object*` tests |
| M4 | **Veil** (`placeVeil`) | obstruction, sealed route | closed_path (seal), vigil (sightline screens); level ≥ 1 | ≤ 10 cells per seal, only into air/grass | custom `observer:veil` block (dark, light-blocking, breakable by hand in 0.4 s, immovable, no drops) | smoke burst, seal sound | removed 5 s after the encounter | hum + lights out + seal sound → break through / light / hold its gaze | shared | always removed; broken veil leaves nothing | `closed_path_*` tests |
| M5 | **Mimic route** (`placeMimic`) | familiar route made unfamiliar | unfamiliar_route; level ≥ 2 | ≤ 10 cells, 8–14 blocks behind on a route walked ≥ 3 times | natural blocks imitating the surroundings (stone, deepslate, dirt…) placed into air only | — | reverts ~2.5 min after the encounter | the way back is wrong → dig through | shared | mining it is cancelled and the block removed without drops | `unfamiliar_route` test |
| M6 | **Effigy** (`placeEffigy`) | staged evidence, a calling card | home_visit, close_breath, borrowed_sound, night_visit; level ≥ 1 | 1 per encounter, floor cell near the scene | custom `observer:effigy` block facing the player | — | crumbles after 45 min if unbroken | find it → break it for a Vestige | shared (any player can claim it) | removed on expiry; loot-free, Vestige granted once by script | `home_visit` test |
| M7 | **Carve** (`carve`) | "is that opening different?" | unfamiliar_route; level 3 only | a 1-wide, 2-high, up to 2-deep opening in a natural wall face beside the path, 4–10 blocks away, out of view (never the floor) | natural blocks → air | — | reverts ~2.5 min after the encounter | a new opening → notice it | shared | restored only if the space is still empty (a player's later block wins) and nobody stands in it | `carve_opening_made`, `carve_restored` |
| M9 | **Signs** (`encounters/sign.js`, 1.0.5) | "it was here" | sign encounter, stage 3+, level ≥ 1 | 1 sign, an empty floor cell beside the bed or a door of the home, out of everyone's sight | a waxed oak standing sign (`ground_sign_direction` toward the bed/door) with a short text: the player's name, the time they last slept, "I was here"… | — | removed after 20 min; at most every 60 min | find it → read it / break it | shared | breaking it is cancelled and the cell emptied (no drop); Undo removes it | `sign_*` tests |
| M8 | **Animals turn** (`animalsFace`) | entity interaction tell | distant_watch at stage ≥ 2 (30%) | ≤ 12 passive mobs within 24 blocks | rotation only, for 8 s | — | per encounter | look where they look | shared | nothing to clean | code review (not separately asserted) |

Additional non-block manipulation: personal fog (`observer:dread`, `dread_soft`, `vigil`), camera fades/shakes
(camera setting), the vigil's optional world-wide rain (global, announced), per-player music silence (1.0.5),
**returned items** (1.0.5: an item entity the player threw away is teleported — never copied — to the outside of their
door), and **borrowed eyes** (1.0.5: one creature is held still with heavy slowness and turned to follow the player
for 7–11 s, then released). The Flare's light block is the player's own change, recorded in the ledger (kind
`flare`, owner −1) only so that it is removed when the flare burns out; it never smudges chalk marks.

## 8. Keeping the world safe (`world/ledger.js`)

* **Allow-list, not deny-list**: only the block types listed in `core/constants.js` (verified against vanilla data
  1.26.52) can be touched. Containers, beds, signs, redstone components, portals, spawners, command blocks and every
  other block are never modified. Iron doors are excluded.
* **Record before edit**: each change stores the original permutation (type + all states), what it set, the owning
  encounter, a restore time and flags. One entry per position: a recorded position is **locked** to other encounters.
* **Player changes win**: restoration only happens if the block still holds what the Observer set. If a player (or
  redstone, pistons, another add-on) changed it, the entry is dropped and the player's version stays.
* **No duplication**: Observer-placed blocks (veil, mimic, effigy) cancel the break event and remove themselves without
  drops; removed torches/lanterns never drop; the effigy's Vestige is granted by script exactly once. Mimic blocks are
  never gravity blocks (sand → sandstone, red sand → red sandstone, gravel → andesite), so nothing can fall out of its
  recorded cell.
* **Never on anyone**: Veil, mimic and effigy blocks are never placed into a cell occupied by a player, mob or the
  Observer, and a carved opening is not refilled while someone stands in it (it waits). Carving only opens wall faces
  at feet and head height beside open space — never a pit in the floor.
* **Persistence**: the ledger is saved in world dynamic properties every 5 s and on shutdown; restoration continues
  after reloads; unloaded positions wait.
* **Limits**: ≤ 800 open entries world-wide (entries waiting in areas no one revisits count toward this; when full, no
  new changes are made and a debug warning is logged); per-encounter caps above; Ward Lanterns protect a 12-block radius and
  release anything already changed inside it when placed.
* **Turning it off**: setting manipulation to Off or disabling the add-on restores every loaded change immediately
  (`/observer:restore` does the same on demand). Before uninstalling, run `/observer:restore` so no Veil/Effigy blocks
  remain.

## 9. The horror director (`director/director.js`)

**Progression per player**: grace → 1 *anomaly* → 2 *suspicion* → 3 *evidence* → 4 *contact* → 5 *escalation*
(→ *witnessed*). Stages advance on exposure points (encounter tier, +1 when noticed) with a minimum encounter count:

| Stage | Exposure | Encounters | Unlocks |
|---|---|---|---|
| 1 | grace ends (12 min standard) | — | distant watch, borrowed sound, turned object, door |
| 2 | 3 | 2 | extra step, home visit, lights out, bearing, window, second witness, night visit, follow-ups |
| 3 | 8 | 3 | echo ahead, path changed, close, **closer each time** (the **lunge** when it is noticed starts at stage 2) |
| 4 | 14 | 5 | the closed path, pursuit (aggression ≥ 1) |
| 5 | 22 | 8 | everything, at its most frequent |

**Pacing**: after each encounter the next is scheduled `rand(110, 240) s ÷ frequency × (1 − 0.04·stage) × mood × (1 + tension/150)`,
where mood is shorter at night, underground, in darkness, in other dimensions and in the Weeping Mire (§16). Every 3–5 encounters a genuine quiet
period of 4–8 min follows. Tier ≥ 3 encounters add 3–4 min recovery; death adds 5 min recovery and relieves tension.
The chase is weighted higher underground.
A global gap (≈ 52 s after body encounters, ≈ 21 s after body-free ones) separates any two starts in the world.
Tension rises by tier and decays 3/min; high tension steers selection toward subtle encounters.

**Selection**: `weight = base(context) × stage/setting gates × per-type cooldown × anti-repetition (×0.15 if last, ×0.45 in last 3, ×0.75 in last 6) × tension fit`.
Each encounter's `prepare()` must find valid positions/blocks; if not, it is **deferred**: the global gap is released
at once (other players are not held up), that type is skipped for this player for 90 s + 30 s per consecutive
deferral, and the player's next attempt backs off 15, 30, 60, 120, then 240 s.

**Multiplayer targeting**: one body. The eligible player who has waited longest (× 1 + 0.15·stage, ±15%) goes first
(players in creative/spectator, asleep or dead are skipped and never use up a turn);
body-free encounters (turned object, door, night visit, follow-ups) can run for other players at the same time.

## 10. Signature encounters

1. **Out of Step** (`extra_step`) — *stalking + discrepancy.* Its footsteps match your rhythm and the ground behind you;
   you stop, it stops — then one more, heavier step. **Choices:** turn around (it is between the trees, steps away:
   peaceful, *Out of Step*); sneak (its rhythm falters: *Quiet Feet*); ignore it (the steps close in; at stage 4+ it is
   right behind you when you finally turn — *Close*).
2. **Someone Was Home** (`home_visit`) — *memory + manipulation.* Heading back to the place you spend most time, it gets
   there first: a door in the wrong state, the lights by the entrance out, an object turned toward the way you come
   in, an effigy of itself; it watches from outside. **Choices:** put one thing back (it restores the rest:
   *Put Back*), break the effigy (a Vestige: *Small Likeness*), study the changes or catch it watching
   (*Someone Was Home*), ignore it (the changes stay for 8 min; tension rises).
3. **The Closed Path** (`closed_path`) — *stalking + manipulation + threat.* In a tunnel: a hum, the nearby lights die,
   the way you came is sealed with Veil; when you look back toward where you were going, it is there. **Choices:**
   break through the veil and get away (*Wrong Way*), stand in light ≥ 11 (*Light It Does Not Make*), hold its gaze
   until it backs off (*Held Gaze*), use the Witness Lens, strike it. If it reaches you: a 0.6 s wind-up you can step
   out of; at aggression 0 it only touches you and the screen goes dark.

All 18 implemented encounters and 17 further concepts are catalogued in [ENCOUNTERS.md](ENCOUNTERS.md).

## 11. Progression, tools and the ending

* **Discoveries** (22, `progression/discoveries.js`): earned only by noticing or answering — never by exposure. Each
  writes a page in the Field Notes (entry text + the rule it teaches) and gives a **Vestige**.
* **Tools** (`progression/items.js`): *Field Notes* (journal; first discovery gives one, or craft book + charcoal);
  *Tally Chalk* (mark up to 8 spots; a mark smudges and tells you when it changes anything within 4 blocks);
  *Witness Lens* (spyglass + 2 Vestiges + amethyst shard: makes it recoil and withdraw, or reveals its trails and
  effigies when there is nothing to hold; 20 s cooldown); *Ward Lantern* (lantern + 2 Vestiges: it will not stand or
  change blocks within 12 blocks); *Flare* (glowstone dust + gunpowder + paper → 8: thrown, burns 8 s with real light;
  drives it off within 16 blocks, even mid-attack; consumed).
* **The Vigil** (`encounters/vigil.js`) — the achievable long-term objective. With 12 pages and a Witness Lens, at
  night, near the place you return to most, the Field Notes offer to keep the vigil. Three rounds: it rearranges the
  grounds (lights, a door, Veil screens breaking sightlines) and hides; a chime gives the direction; hold it in the lens
  (or hold its gaze for 3 s) within a minute. Success: it stands in the open, tilts its head, and walks away —
  **Witnessed**, with *The Observer's Eye*. Failure: it is behind you, blackout, no damage; try another night.
* **After the vigil** (Field Notes / the Eye): *Attendant* (gentle encounters only — default), *Endless* (full
  intensity, stage 5), or *Rest* (no more encounters for that player).

## 12. Multiplayer

| Question | Answer |
|---|---|
| Who is targeted? | One target per body encounter; longest-waiting eligible player first (§9) |
| Do nearby players share it? | Yes: the body, block changes and real door/block sounds are shared; cues (steps, breath, chimes, fog, captions) are personal to the target |
| How can players help? | Any player's gaze counts for holding it and noticing it; any player can relight, close doors, break veils/effigies, use a lens or a ward; *Second Witness* rewards warning each other |
| Target leaves / dies / changes dimension | Encounter aborts; body removed; changes revert in ≤ 30 s; death adds a 5-minute recovery |
| Conflicting world changes | One body encounter at a time; ledger positions are locked per encounter; ≤ 800 entries |
| Is it one Observer per player? | No. One physical body; per-player logical relationships |

## 13. Settings, presets and accessibility

| Preset | Frequency | Aggression | Manipulation | Sudden scares | Camera | Grace |
|---|---|---|---|---|---|---|
| Atmosphere | 0.6× | never attacks | subtle | off | reduced | 15 min |
| Standard | 1.0× | standard (6 dmg, capped) | standard | standard | full | 12 min |
| Relentless | 1.5× | high (9 dmg) | unsettling | standard | full | 5 min |

Independent controls (operators, Field Notes → Settings or `/observer:settings`): enabled, frequency 25–200 %,
aggression 0–3, manipulation 0–3, sudden scares 0–2 (≤ 1 sting per 25/15 min), camera 0–2 (none / fades only / fades +
shakes), caption default, grace minutes, world-wide weather, developer tracing, and (on by default) taiga shadows, escape
learning, the silence before attacks, pages you didn't write, returned items. Peaceful difficulty forces aggression 0.
On Low aggression a strike is capped: above half health it cannot take more than 70 % of current health, and it
strikes once; on Standard and High it keeps attacking (§3.4).

## 14. Audio

All 42 sound files are original, synthesized by `tools/synth_sounds.py` (no samples) — including its own voice,
arrival, notice, shriek and vanish sounds: heavy cloth-and-weight footsteps
(4 variants), the hum (detuned 46/47.3/69.5 Hz drone with a swell), the tell (an inharmonic, tuning-fork-like chime),
breath (band-passed exhale), cloth rustles, knocks, snuff, wind-up/strike/whiff, the sting (a dissonant swell, cut
short — not a scream), the seal, the arrival, chalk, the discovery scribble-and-bell, the lens shimmer, effigy crumble,
the vigil drone with bells, stone scrape, sinking bubbles, a quiet tinnitus ring, and (1.0.5) *silence* — a 30 s
looping music track that is almost nothing, a faint 7.35 kHz ringing that rises out of silence — and *scrawl*, hard
pencil strokes for a page written in another hand. The Flare uses vanilla sounds (`random.bow` to throw,
`firework.blast` and `random.fuse` as it lights and hisses, `random.fizz` as it dies). Borrowed sounds and matched
footsteps intentionally use vanilla sound events (`dig.*`, `step.*`, `random.door_*`, `random.chest*`…), because the
point is that they are *your* familiar sounds.

## 15. Its own hand: pages, signs, returned things, borrowed eyes, inside (1.0.5)

These make it personal without making it louder. Each is rare by design and can be switched off.

| Feature | Stage | At most | Built from | Off switch |
|---|---|---|---|---|
| **Pages you didn't write** (`observer/pages.js`) | 2+ | one per in-game day; never during an encounter | the lifetime tallies, sightings, deaths, home coordinates, what it learned; darker text from stage 4 | setting *Pages you didn't write* |
| **Signs** (`encounters/sign.js`) | 3+ | every 60 min (3 in-game days) | the player's name, last sleep time, sightings | encounter toggle *Signs* |
| **It returns what you threw away** (`observer/returns.js`) | 2+ | once per in-game day | an item the player dropped by hand 24+ blocks from home and from themselves, 45 s+ ago | setting *It returns what you threw away* |
| **Borrowed eyes** (`encounters/borrowed_eyes.js`) | 2+ | every 10 min | a creature 6–24 blocks ahead in view | encounter toggle *Borrowed Eyes* |
| **It's inside** (`encounters/inside.js`) | 4+ | every 60 min (3 in-game nights) | the darkest spot (light ≤ 7) of the player's own roofed room at night; leaves on light, a 2 s stare, or approach | encounter toggle *It's Inside* |

## 16. Its home: the Weeping Mire (1.0.7)

The Weeping Mire is the user's own biome add-on (1.2.6), merged into The Observer by `tools/merge_weeping_mire.py`
with its world generation, blocks, structures, look and pages unchanged (identifiers keep their `wmire:` namespace, so
worlds that had the stand-alone Mire keep their blocks). It is the Observer's home.

* **The Mire's watcher is the Observer.** The stand-alone Mire had its own faceless watcher mob (spawn rule every 2–4
  min, 40 %, 20–48 blocks). That mob is gone; its appearances are the encounter *In the Mire* (`mire_watcher`), with
  the same rules: it stands still among the trees 20–48 blocks off, peeking from a trunk when it can; looked at for a
  second it holds the gaze and is gone in black mist (`wmire:black_mist`) with a cave sound; it does not let you come
  within 9 blocks; ignored, it fades after 90–180 s. Being the Observer, it can also lunge when seen (stage 2+).
* **Where it stands.** Placement prefers spots the player can actually see (line of sight is checked both ways: its
  head must not be inside the canopy); in thick trees it comes closer (12–24 blocks; behind the player from 8) before
  falling back, as the old watcher did, to standing deep among the trees whether or not it can be seen yet.
* **The torn pages** (`mire/mire.js`, ported from the Mire's script): reading a new page brings it up 16–24 blocks
  behind the player one time in five; the eighth always does, 12–14 blocks behind, with the title *it knows your name*
  (this one ignores quiet periods, recovery and the encounter's cooldown, and if the Observer is busy elsewhere it
  comes as soon as it is free, for up to a minute). Pages found are kept per player in the
  Mire's own dynamic property, so pages found with the stand-alone Mire still count.
* **More active there.** `context.mire` (the player's biome is `wmire:weeping_mire`):
  * the director treats the player as one stage further along when choosing encounters (`effectiveStage`), including
    the silence before attacks;
  * mood ×0.7 with a floor of 0.45 (elsewhere 0.6), so every gap is shorter;
  * the grace period ends after 30 s spent in the Mire without leaving it;
  * *In the Mire* has weight 16 there (the highest of any encounter) and 0 anywhere else.
* **Unchanged from the Mire:** wind gusts every 25–55 s with leaves and streaks for players in the Mire, leaves drifting
  off weeping leaves, its fog, lighting, colour grading and water, and its music volume set to 0 (silence is the Mire's
  sound).


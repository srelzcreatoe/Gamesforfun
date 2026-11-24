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
| `run` | `running` | supplied | unused since 1.0.8 (kept in the enum): every run, chase and attack floats (`surge`) |
| `float` | `float_drift` + `look_at_target` | **new (1.0.6)** | the chase while watched: a block off the ground, legs hanging limp, toes down, almost still — then broken by sudden one-frame snaps (the head jerking to a wrong angle and holding there, a shoulder hitching, the whole body dropping and catching, a limb spasming), each with a crack (`observer.crack`); 4.8 s loop |
| `surge` | `float_surge` | **new (1.0.6)** | coming at someone through the air, pitched forward, arms and legs streaming behind: the chase unwatched, and since 1.0.8 every attack approach, the lunge and the too-close strike |
| `climb` | `climb` | **new (1.0.6)** | climbing a wall, pillar or cliff after a player, hand over hand, staring straight up at them |
| `attack` | `attack` (once) | supplied | telegraphed strike; damage applied at the clip's strike frame (0.6 s) |
| `peek` | `idle` + `peek` | supplied + **new** | leaning out from cover; side from `observer:side` |
| `recoil` | `recoil` | **new** | witnessed through the lens, struck, driven back by light |
| `hidden` | — (no parts) | — | momentary vanish |
| `hang` | `hang` | **new (1.0.9)** | stalking from a cave ceiling: hanging upside down by its feet (the root turned over and raised 4 blocks), arms dangling toward the floor, a slow sway, a neck crack |
| `crawl` | `crawl` | **new (1.0.9)** | flat on its front through a gap a block high (collision box 0.6 × 0.9 while it lasts), head raised, dragging itself hand over hand |
| `observer:stoop` = true (overlay) | `stoop` | **new** | automatically when headroom < 5 blocks |
| `observer:afloat` = true (overlay, 1.0.8) | `float_hang` | **new** | while it floats, on any state that is not itself a floating clip: the strike, the recoil, a stare between strikes stay a block up with the legs hanging limp (legs and root only, so the supplied attack clip plays unchanged above it) |

Supplemental clips are generated by `tools/make_supplemental_anims.py` using only the supplied bones. Before writing
them, the rotation convention was verified by rendering the supplied clips with an offline forward-kinematics renderer
(`tools/render_model.py`) and comparing against the supplied previews (arm splay in the turnaround, head tilt in the
preview). The walk and stoop root heights are solved numerically so the lowest foot rests on the ground; the stoop
lowers the figure to 2.81 blocks so it fits its 2.9-block collision box. The floating clips lift only the model (the
root bone, 1 block, less under a low ceiling: `16 * (1 - q.property('observer:stoop'))`); its collision box stays on
the ground, so it keeps the normal pathfinding around walls, trees and doors. Previews of every new clip are rendered
by `tools/preview_anims.py` (`docs/media/1.0.6/`; the strike and recoil in mid-air, layered as the client layers
them: `docs/media/1.0.8/`).

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
* **It never runs (1.0.8).** What 1.0.6 did for the chase now holds for every approach with intent: the relentless
  attack (whatever started it), the lunge, the too-close strike and the test strike all come through the air
  (`body.surge()`: `observer:afloat`, silent steps, the `surge` clip, the rush of air every 2 s). While afloat, any
  other state — the strike wind-up, the recoil, a stare between strikes — gets the `float_hang` overlay, so it strikes
  and flinches a block up with its legs hanging instead of dropping to the ground. Stalking, peeking, the creeping
  approach and walking away while not afloat still walk.

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
| M8 | **Animals sense it** (`observer/animals.js`, 1.1.1; was `animalsFace`) | entity interaction tell: the animals show where it is | every appearance of its body (setting *Animals sense it*) | ≤ 8 at a time, 12 per appearance, within 20 blocks of it | rotation, heavy slowness, and a few blocks of held-speed walking away; vanilla growl/hiss/call sounds | — (no block changes; effects removed when it is over) | once per animal per appearance | look where they look |

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

All 30 implemented encounters and 16 further concepts are catalogued in [ENCOUNTERS.md](ENCOUNTERS.md).

## 11. Progression, tools and the ending

* **Discoveries** (24, `progression/discoveries.js`): earned only by noticing or answering — never by exposure. Each
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

The synthesized sounds (`tools/synth_sounds.py`, no samples) include its voice and notice clicks (until 1.1.2 also
its arrival, shriek and vanish): heavy cloth-and-weight footsteps
(4 variants), the hum (detuned 46/47.3/69.5 Hz drone with a swell), the tell (an inharmonic, tuning-fork-like chime),
breath (band-passed exhale), cloth rustles, knocks, snuff, wind-up/strike/whiff, the sting (a dissonant swell, cut
short — not a scream), the seal, the arrival, chalk, the discovery scribble-and-bell, the lens shimmer, effigy crumble,
the vigil drone with bells, stone scrape, sinking bubbles, a quiet tinnitus ring, and (1.0.5) *silence* — a 30 s
looping music track that is almost nothing, a faint 7.35 kHz ringing that rises out of silence — and *scrawl*, hard
pencil strokes for a page written in another hand. **1.1.2: the user's own recordings.** Its arrival (a grunt, as if
it stepped out of nowhere), its scream (when it snaps, lunges or rages — once every 12 s in a rage, groans between —
and over the blow that kills), the sting for whoever spots it (over its clicks), its vanish, its whisper (now and then
when it is within 12 blocks and out of view: two appearances in five, at most every 3 minutes, never while it is
coming for you; and in sleep paralysis), and two themes played in place of the game's music while it is around
(`hush.presence`; *lurking* in the Weeping Mire, the other everywhere else; looping, crossfading between them, the
game's music fading back 3 s after it has gone). The mix was rebalanced around them by integrated loudness: creature
sounds −17 to −21 LUFS, its scream −12, themes −21 / −23 (music channel: they follow the player's music volume); the
synthesized strike was raised ~5 dB, the lens and the vigil drone brought down. The Flare uses vanilla sounds (`random.bow` to throw,
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
* **Near the player, never where they start (1.0.8).** The biome's `replace_biomes` rule is tuned (by
  `tools/merge_weeping_mire.py`, the only merged file that is not a byte copy): 40 % of each target biome instead of
  25 %, patches about half the size (noise frequency 2.0 instead of 0.4), and meadows, the pale garden, cherry
  groves, savannas and jungles added to the plains, forests, swamps and rivers it already took (not the taigas: they
  keep their shadows). Over 8 seeds the nearest Mire to 0,0 went from 290–2270 blocks (6 of 8 over 1200) to 45–595
  (4 of 8 right there). A new player's first spawn in a world (one who has not played with the add-on there yet, so nobody returning
  from an earlier version is moved), when it is at the world spawn (in a new world, whose spawn is still unset,
  wherever the game put them) and inside the Mire, is moved
  to the nearest dry ground at least 6 blocks outside its edge (searched outward to 160 blocks, one ring a tick),
  facing the Mire, and the world spawn moves there too (`mire/mire.js`, `firstSpawn`).
* **Unchanged from the Mire:** wind gusts every 25–55 s with leaves and streaks for players in the Mire, leaves drifting
  off weeping leaves, its fog, lighting, colour grading and water, and its music volume set to 0 (silence is the Mire's
  sound).

## 17. Stalking, the standoff, and the attack (1.0.9)

Three phases, in the user's design, built into the encounters that show it from afar.

* **Stalking.** *The Figure at the Edge* arrives silently and stands perfectly still. Besides the ground, it may
  stand on a high ledge (4+ blocks above the player, in sight: `findSpot` `minRise`), or underground hang upside
  down from a ceiling with 6+ blocks of open space under it (`common.hangSpot`: its feet at the ceiling, its origin
  4.05 blocks below; the `still` mode has no gravity, so it stays there). It does nothing until it is seen or
  approached.
* **The standoff** (`common.standoff`, also in *Always the Same Place* and *In the Mire*). It watches, tests the
  player while looked at (neck crack, head tilt, one slow step), and creeps 2–3.5 blocks closer each second it is
  unwatched (off a ceiling it first drops to the floor). Its anger rises only while it is stared at — faster the
  closer and the higher the stage (about 4 s at 10 blocks to 12 s at 45 at stage 2) — and cools while it is not. A
  projectile or a blow provokes it at once (`projectileHitEntity` / `entityHitEntity` while `enc.data.standoff`).
  Unprovoked it ends after 20–35 s, or once it has been looked away from for a while: it is simply gone. This sits
  beside the older rule that a held gaze holds it off: once it is already coming (the chase, the sealed tunnel,
  *Closer Each Time*), a stare is still a defence; while it is only watching, a long stare is a provocation.
* **The attack** (`common.provoke` → `relentless(enc, {rage:true})`). From stage 2 (effective) and aggression ≥ 1:
  its head snaps (a crack), it shrieks (camera shake, caption) and comes in `rage` mode (the `observer:rage` group,
  ~8 b/s measured, against ~5.6 for a sprint), floating, a shriek or a groan every 3 s. Otherwise a harmless lunge.
  Nothing keeps it out (`observer/squeeze.js`, also in the ordinary attack and the chase): stuck for 1.5 s within
  28 blocks, it plans a way through gaps a block high, closed doors (opened) and glass/panes/leaves/webs/vines/
  bamboo (broken), all as ledger changes (restored, no drops, never in a ward), crawling where the way is lower than
  three blocks and standing up again before it strikes. It still climbs walls (§4.1.1) and floats (it never runs).
* **Exits.** It never walks away any more (`body.vanish`): when an encounter is over it holds a breath and is gone,
  torn apart where it stood.

## 18. It knows you; its presence, felt (1.1.0)

* **The music** (`hush.presence`, every second): while one of its encounters runs for a player, or its body is within
  64 blocks of them, their music is replaced by a silent track; 3 s after it is gone the game's own music for their
  dimension (`music.game`, `music.game.nether`, `music.game.end`) fades back in over 4 s. Per player; part of the
  "The music stops while it is around" setting.
* **The heartbeat** (`observer/dread.js`, every 2 ticks): a dread level per player — its body within 48 blocks
  (more when unseen), any encounter of theirs (0.3+), a standoff (0.35 + anger/160), a dangerous encounter or an attack
  (0.85), a pending silence (0.4) — rising quickly and settling slowly. From 0.18 a heartbeat only that player hears,
  58–150 bpm; from 0.55 a positional camera shake on each beat of at most 0.025 (reduced) or 0.05 (full camera
  effects), none with camera effects off. Setting "Heartbeat" (on).
* **Running at it** (`observer/charge.js`, detected in `director.nearCheck`): attack (rage) or vanish and ambush; see
  ENCOUNTERS.md.
* **It knows you** (`observer/profile.js`): habits and per-encounter effectiveness, applied in the standoff, the
  placements, the charge decision and the director's weights; shown in the Field Notes (*Lessons → It knows me*). All
  of it is off with "It learns how you escape" off.
* **Hiding behind trees** (`space.hideSpot`, `body.peekaboo`): see ENCOUNTERS.md. It stands straight behind the
  trunk, a touch away from the side it looks round, so the trunk covers its body and only its head, a shoulder and
  the hand on the bark come round the edge. The peek clip was rebuilt (hips shifted and waist bent so the head clears
  the trunk, head held level and turned to the player, the near
  hand gripping the trunk's edge beside its face, the other on the bark), and the gaze now counts its peeking head
  (`sight.visibility` `points`), so it can be noticed while its body is hidden.
* **The Weeping Mire's wood as fuel**: items with the blocks' own identifiers and `minecraft:block_placer`
  `replace_block_item` (the block is still drawn as the icon) carry `minecraft:fuel` (15 s, like a log) and the vanilla
  `minecraft:logs` / `minecraft:logs_that_burn` / `minecraft:planks` tags; Bone Root → 3 bone meal (shapeless).

## 19. At the foot of the bed; the animals know (1.1.1)

* **Sleep paralysis** (`encounters/paralysis.js`, encounter *At the Foot of the Bed*, tier 3, stage 3+, manual): the
  fast loop checks every 5 ticks who is asleep; after 30 ticks in bed (the night is skipped at 100) it is decided once
  for that sleep — 30 % at stage 3, +5 % per stage — and started through `director.tryManual` (so stage, quiet and
  recovery periods, its 90-minute cooldown, the per-type toggle and a free body all apply). Never with camera effects
  off. The bed is found with one block query (the head cell and its partner); it stands where a stand spot beyond the
  foot (2.6–3.8 blocks from the pillow, up to 1.3 to the side) or, failing that, beside the bed has its head and chest
  in sight of the pillow both ways. Sequence (ticks): fade to black (0.8 s in, 2.2 s hold, 2.8 s out); at 16, under
  the black, the sleeper is woken by a teleport onto the bed's head cell (a teleport wakes a sleeper and does not skip
  the night), movement, camera, jump and sneak are disabled (`inputPermissions`, previous values kept in the player
  property `observer:paralysis`), the HUD is hidden, and a `minecraft:free` camera is set 0.45 down the bed from the
  pillow, 0.85 above the bed's floor (their body is behind it, out of view), framed so its head is near the top of the
  view and the foot of the bed at the bottom; the body is spawned silently (`stare`, stooped under a ceiling below
  five blocks) facing the camera. At 60 its breath; ~104 the view is up; then the camera eases 5° to one side and back
  (they try to turn their head), it tilts its head (`tilt`, 2.2 s), and glides two-thirds of a block closer (1.5 s).
  At ~260 a blink (0.15 s in, 0.7 s hold): under it the body is removed without its vanish burst (`despawn("blink")`),
  everything is handed back, and the player is stood on the floor beside the bed facing where it stood. Discovery
  *At the Foot of the Bed*. A `finally` hands everything back however it ends; on joining or a script reload any
  `observer:paralysis` left on a player is handed back too. The heartbeat's dread is held at 0.7 throughout.
* **The animals know** (`observer/animals.js`, every tick): see ENCOUNTERS.md. Turning is limited to 14° a tick so
  nothing snaps round; standing still is Slowness VIII (refreshed, no particles) with horizontal velocity cancelled
  each tick; walking away holds a set velocity (impulse = wanted − current), because a plain impulse ran away with
  some animals (up to 10 b/s in a probe) while barely moving others. A wall, a drop of two, water or lava ahead ends
  the walk. Vanilla sounds: `mob.wolf.growl`, `mob.wolf.whine`, `mob.cat.hiss`, `mob.cow.say`, `mob.sheep.say`,
  `mob.pig.say`, `mob.goat.ambient`, `mob.horse.angry`, `mob.horse.donkey.angry`, `mob.llama.angry`.

## 20. It rules them (1.2.0)

* **Other creatures** (`observer/dominion.js`): who answers to it is decided per creature by `standing(e)` — a mark
  for its kind first ("ignore" → left alone; then name tags and tamed creatures are always left alone; "rival";
  "kin"), then Minecraft's bosses and anything with 300+ maximum health are left alone, then anything of family
  `monster` answers to it. Phases per creature: *wait* (the ripple), *face* (turned to it, held: Slowness VIII,
  Weakness V, `minecraft:stop_exploding` for creepers, horizontal velocity cancelled each tick), *leave* (a held
  velocity of 0.1 b/tick away from it and the nearest player, Weakness refreshed), *hold* (still and harmless again),
  then *sent* once out of every player's sight for 10 ticks (`seenByAny` with three points up its height) —
  `remove()`, no drops. Rivals skip to `tearApart` (its vanish particle, the crack and its vanish sound, `remove()`).
  When its body is gone everything still held is let go (effects removed). The same velocity-held walking and
  `clearAhead` as the animals (§19).
* **Not Yours** (`encounters/not_yours.js`): `world.afterEvents.entityHurt` (players only) → `onHurt`: within 24 blocks
  of its body the attacker is torn apart at once; otherwise, for a kind that answers to it or a rival, the encounter
  is tried (`tryManual`, so stage 3, quiet and recovery periods and its 8-minute cooldown apply). It stands 1.2–2.8
  blocks behind the attacker on the player's line (head in sight both ways), holds it, turns it round, tears it
  apart, and looks at the player for 2 s. Discovery *Not Yours*.
* **Nothing taken from other add-ons**: no other add-on's files, scripts or assets are read, copied or required. It
  acts on their creatures only through the shared world (queries, rotation, effects, impulses, an event every creeper
  has, removal). Tests use stand-in creatures that live only in the test kit (`otest:dweller`, `otest:great_dweller`).

## 21. They are its (1.2.1)

* **Roles** (`observer/dominion.js`): each creature that answers to it is *sent* (1.2.0), a *watcher*, or a *rival*.
  Watchers are chosen at the scan (stage of the player it came for: 3 → three, 5 → four), walk to a slot around that
  player (`take`, `goTo`) and then `watch`: turned to the player's eyes every tick, held (Slowness VIII refreshed
  every 10 ticks — a single application expired after 1.5 s in the first test run and let them walk on), harmless,
  its eyes as particles. At stage 4 the hold is lifted only while the player is not looking at it (`visibility` with a
  40° cone at its head and middle, every 2 ticks), and closer than 3.6 blocks it is pushed back. *Dismiss* when its
  body is gone; *unleash* on its rage.
* **Its Eyes** (`encounters/its_eyes.js`): the weight function itself looks for a creature in sight (so the director
  never chooses it without one), `prepare` takes the nearest; the creature is held, turned to the player and given its
  eyes each tick; 0.5 s of being looked at → `tearApart`, the body spawned on its spot (silent), a normal sighting.
* **Load order**: `encounters/common.js` now loads the creature module, which the director loads in turn. A module
  the director reaches must not register an encounter at load (the registry does not exist yet): the first build did
  (through `animals.js` → `borrowed_eyes.js`) and the whole script stopped on the server. The shared walking check
  moved to `world/walk.js`, and `tools/validate.mjs` now fails on any such chain.

## 22. Its puppets (1.3.0)

* **Possession without touching anyone's code** (`observer/puppets.js`): a puppet is a record (the creature, why it was
  taken, whom it is used on, where it was taken, a deadline, a mode) and a note on the creature (`observer:puppet`, a
  dynamic property of this pack's own — another pack cannot see it, and this one never reads theirs). Everything it does
  to a creature is through the shared world: `teleport`, `setRotation`, `applyImpulse` (velocity held, not pushed),
  effects (only the ones it gave are taken off again: `fx`), `remove` (only for the hostile creatures it sends away or
  tears apart — never a villager or an animal), and one event every creeper has (`minecraft:stop_exploding`). It never
  triggers another add-on's events or reads its files, and it does not name any other add-on: a kind becomes its puppet
  only when a player marks it on the Config Wheel.
* **Its tells** are deliberately consistent with its own body: the same eyes as its watchers (1.2.1), one-shot versions
  of its wisps and its crimson shreds (`observer:puppet_wisp`, `observer:puppet_shred`, `observer:puppet_burst` — new
  one-shot particles from its existing textures, so nothing loops on another add-on's creature), its voice and whisper,
  and the same heartbeat, music and animal reactions as its body (`dread.target`, `main.isAround`, `animals.presence`).
* **Robustness**: one tick routine for all puppets (`puppets.tick`), behaviours as small timed routines that re-check
  their puppet at every step (`possession.js`); a hard deadline on every puppet; all of it released when switched off;
  recovery from a stop mid-possession (`entityLoad` and a scan on script start). Simulated in the tests by forgetting
  the records without releasing (`puppet orphan`) and recovering.
* **Load order**: the director now loads `observer/herald.js` (and through it `puppets.js` and `dominion.js`); none of
  them, nor anything they load, registers an encounter — `tools/validate.mjs` checks this on every build.
* **Not Yours, fixed**: a blow that does no damage (a creature too weak to hurt you — as every creature it holds is) no
  longer counts, and nothing it holds or has taken for its own can set it off.

## 23. Its hold; the chase; its pack, the mirror, the guide, the procession, mine first, cold eyes (1.4.0)

The player's report on 1.3.0 was that possession held when started by hand but slipped in survival: another add-on's
scripts teleported their creature away, did their own things to it, and it sometimes hurt them while held. 1.4.0 makes
the hold total — still without reading, copying or changing anything of the other add-on.

* **Its legs are its** (`puppets.refresh`): Slowness VIII (movement 0) stays on every puppet that is not hiding among
  its kind — standing, walking, lurking, hunting — renewed every 4 ticks (every 2 for a kind that fights it). The
  creature's own AI can still choose targets, but it can no longer move the body; the Observer moves it with
  `applyImpulse` (velocity held). Lurk, follow, mirror and lead keep their own steering; walking and hunting go through
  `observer/chase.js`.
* **Pulled back** (`puppets.hold`): each puppet remembers where it was left at the end of its own step (`at`, `atDim`).
  Moved further than any step it takes (2 blocks, 1.2 for a kind that fights it; up 2.5, down 5) or into another
  dimension, it is teleported straight back, with its shreds where it went and a neck-crack. Standing puppets also keep
  an anchor and are put back if pushed 0.7 blocks off it. A creature carried into another dimension keeps its id:
  `world.getEntity` finds it again before anything is brought back, so nothing is duplicated.
* **The second look** (`LATE`): script packs are ticked one after another, so an add-on whose scripts move its creature
  every tick after ours would win every frame. While a puppet is being fought over, it sends itself a script event each
  tick (`observer_hold:late`, its own namespace — nothing else listens to it); after-events are delivered once every
  pack's scripts have run, so the second look lands last, and the creature is where it should be when the tick ends.
* **Held means harmless** (`world.beforeEvents.entityHurt`, stable in @minecraft/server 2.10): harm to a player from a
  puppet that is not hunting, or from a creature dominion holds (watchers, those it sends away), is cancelled before it
  lands — melee, projectiles (the shooter is the damaging entity) and script `applyDamage` naming the creature. Harm with
  no damaging entity, of the causes scripts use (`entityAttack`, `none`, `override`, `magic`, `projectile`, …), within
  4.5 blocks of a held puppet and with no hunting one near, is cancelled too. Weakness V stays as a second line.
* **Its own are untouchable**: harm to a puppet is cancelled unless it comes from a player (or the Observer), or is the
  void or `selfDestruct`. Fire is put out. `world.beforeEvents.effectAdd` cancels invisibility on a puppet, and any that
  slips past is removed within two ticks.
* **Brought back** (`puppets.bringBack`): `world.beforeEvents.entityRemove` notes a puppet that is being removed (where it
  was, which way it faced, its health and name); `entityDie` does the same for a death that was not a player's (and
  removes the body). On its next tick, if a player is within 56 blocks (otherwise the world is only unloading the place,
  and the existing recover-on-load path applies), it spawns the same type there with `spawnEntity`, puts its note, name,
  health and effects back, and re-keys the record (the old id stays an alias, so encounters holding it carry on). Taken
  five times in ten seconds it waits three seconds between; it never gives up, except for a type that cannot be spawned.
  Killed by a player, it stays dead and drops `observer:cold_eye`.
* **It learns each kind** (`W.kinds`: fights, removed, removedUp, removedDown, blocked, back): a kind with 3+ fights or
  2+ removals is held tighter from the moment it is taken (`strict`); a kind removed on the surface twice more than
  below is kept below (`keepBelow`: marked puppets of that kind are only taken while the player is underground). The
  Field Notes write it out per kind, by the creature's own name.
* **The chase** (`observer/chase.js`, `world/path.js`): every half second (sooner when the goal moves) it checks whether
  the straight way is walkable (steps up of one, drops of up to three, no corner-cutting, no water); if so it drives
  straight at the goal. Otherwise a route is searched (A* over feet cells, 8 directions, steps, drops, wooden doors and
  gates as passable at a cost, wall faces of 2-5 blocks as a climb, 2,500 nodes, 40 blocks) as a `system.runJob`
  generator, 120 nodes a slice, so a long search never stalls a tick; the route's closest cell is used if the goal is not
  reached. Doors on the route are opened through the ledger (restored 15 s later); climbs set an upward velocity along
  the face; a step up is a hop; 16 ticks without progress twitch it up to three blocks along the route. Hunt speed is
  0.42 blocks/tick set (≈ 5.8 b/s after ground friction, measured; 0.48 on High), ramping in over 8 s; a lunge from
  3.4 blocks; and if its own blow has not landed for 1.5 s while within 2.1 blocks, it strikes through it (4, or 6 on
  High) — so a creature with no attack of its own still hunts.
* **Its pack** (`possession.packHunt`, `dominion.hooks.pack`): `dominion.unleash` hands the creatures it lets go to the
  pack instead of only letting them go; with any of its own already hunting that player, they are sorted by distance:
  driver (straight at them), cutter (to where they will be: their velocity times the time it takes to get there, at
  most 10 blocks ahead, then straight at them), blockers (`path.chokepoint`: a door, or a cell walled on both sides with
  a gap of one or two, 5-14 blocks ahead along their run — or away from the driver — re-chosen every 3 s; they wait in it,
  and become drivers once within 4.5 blocks).
* **The mirror** (puppet mode `mirror`): the player's horizontal velocity reflected in the plane between them (the
  component toward it negated, the sideways component kept), capped at walking pace; jumps copied; facing reflected the
  same way (so looking at it, it looks back). The encounter (`encounters/mirrored.js`) ends torn out when the player gets
  within 6.5 blocks.
* **The guide** (puppet mode `lead`, `encounters/guide.js`): drives toward a hidden spot 26-42 blocks away while the
  player is within 12 blocks, otherwise stands looking back; arriving, it waits. The payoff: the newest thing the player
  threw away (`returns.takeAway`, moved there as it arrives), one of its pages (`pages.write`), or its body behind the
  guide.
* **The procession** (`possession.procession`): stage 4+, once in a few nights (a 30% roll, then three nights' rest),
  between 17600 and 18800: up to 8 villagers within 64 blocks walk to slots 1.7 blocks apart across the way, 5 blocks
  past the furthest of them, facing the Mire (`W.mireAt`, the last place a player stood in it) or away from the player;
  released home at dawn.
* **Mine first** (`possession.fast`, every 4 ticks): a hostile creature (answers to it, marked, or a monster) 2-7 blocks
  from a stage-2+ player, closing (velocity toward them or distance falling), in line of sight: 35% (else re-rolled after
  20 s), then 3-6 minutes' rest. Taken, held 1.5 s facing them, walked 16-24 blocks away (darkest of a few spots), let
  go there (Minecraft's own, unseen, removed).
* **Cold eyes** (`progression/charm.js`): the charm is found anywhere in the inventory or the off hand (looked for once
  a second); the nearest puppet within 32 blocks — hidden ones included — sets the hum's volume (by distance, and by how
  directly the player faces it) and pitch, every 0.5-2 s.

## 24. Overwhelming; it talks; it glitches; the takeover; the corruption; ahead of you; its music; the Mire's ruins (1.5.0)

The user asked for the Observer to be far more intelligent and overwhelming — more than the Goatwalker add-on of theirs —
with uncanny, distorted music in the spirit of the "exe" horror games, a glitch over everything it controls, unique
abilities that chill, and for it to talk with the player; and for the Weeping Mire to have structures with good loot.

* **Pacing** (`core/settings.js`, `director/director.js`, `progression/discoveries.js`): Standard is frequency 1.25 and a
  4-minute grace (was 1.0 and 12); *Relentless* 1.7 and 2; new *Nightmare* 2.0 and 1, aggression High. The gap after an
  encounter is `rand(60, 140) / freq × (1 − 0.07·stage) × mood × (1 + tension/200)` (was 110-240, 0.04, /150); quiet
  spells every 4-7 encounters for 2-4 min (were every 3-5 for 4-8); recovery after a tier-3 encounter 90-150 s (was
  180-240). Stages at exposure 2 / 5 / 9 / 14 with 1 / 2 / 3 / 5 encounters (were 3 / 8 / 14 / 22 with 2 / 3 / 5 / 8).
* **It talks** (`observer/talk.js`): lines by occasion (low / mid / high by stage; greet, chase, ahead, hideout, escaped,
  repelled, died, killed one of its own, takeover, the Mire, sleep, the lens, each new stage) with `{name}`, `{hx} {hz}`
  (the primary haunt), `{deaths}`, `{days}`, `{item}` (in hand), `{slept}`, `{mined}`, `{doors}`, `{here}` filled from
  what it already tracks; the last eight lines per player are not repeated. Three ways: chat (a speaker name that varies,
  `§k` included), the action bar with a whisper, and a title at stage 4+. `glitch(text, level)` turns words and parts of
  words into `§k` and stutters; level = 0.1 + 0.12·stage + tension/300. Ambient talk every 300/200/140/90/60 s × 0.75-1.5
  by stage (2-5). Questions (`ActionFormData`) from stage 3, every 20-40 min, at a fair moment (health ≥ 60 %, not
  flying, gliding, swimming, sleeping or riding, no monster within 12); six questions, each answer with a reply and an
  act: `show` (Close, or the Figure at the Edge), `angry` (tension +30, next encounter within 15 s, quiet spell ended,
  the corruption, and at stage 4+ the takeover), `inside` (It's Inside, else Knocking), `knock`, `calm` (5 quiet
  minutes). A lie (alone, with another player within 48) is caught. Unanswered for a minute (or closed), it closes the
  form (`uiManager.closeAllForms`) and says "Answer me." The add-on never reads chat (that needs the Beta APIs
  experiment). Fourth wall (`fourth`): a yellow "joined the game" line, a `<name>` line, a black camera fade with an
  error title and static. Settings `talks`, `fourthWall`.
* **Its glitch** (`puppets.glitchStep`, `body.maintain`): `observer:glitch_aura` (3 fragments of a 64×64 sheet of torn
  red/cyan/white bars, alive 0.1-0.3 s) every 6 ticks on its puppets and every 10 on its body; a stutter every 50-140
  ticks per puppet: jitter (0.4-0.8 blocks sideways for 2 ticks), freeze (8-16 ticks, nothing moves it), snap (head
  turned 180° for 3 ticks), name (`§4§k…` for 30 ticks), static (burst and sound only), each with
  `observer:glitch_burst` and `observer.glitch`. The creature's own name is kept (`name0`, also in its note, so a
  restart mid-glitch gives it back); the hold is unaffected.
* **The takeover** (`possession.takeover`): every mob (family `mob`, not anyone's, not a boss, villager, trader or
  golem, under 300 health) within 24 blocks, up to 12, taken in stand mode facing the player for 16 s; one (a non-monster
  if there is one) wears the player's name and follows at 3 blocks (`puppets.wearName`); after 8 s, from stage 4 at
  Standard/High, the monsters among them are handed to `packHunt`. Ambient: stage 4+, overworld, night, a 6 % roll a
  minute once 20-40 min have passed; also its rage at stage 5 (`dominion.hooks.takeover`) and an `angry` answer.
* **The corruption** (`observer/corrupt.js`): up to 12 natural ground blocks 1.5-7 blocks from the player (the `NATURAL`
  set only — never builds or block entities; never warded, never a cell already in the ledger) become black concrete, red
  concrete, crying obsidian or redstone block for 3-4.5 s through the ledger (kind `corrupt`), with bursts and static.
  Its rage, an `angry` answer, the takeover, and at stage 4+ a 1-in-900 chance a second (at most every 10 minutes).
* **Ahead of you** (`common.chaseState`, `outthink`, `cutAhead`, `glitchStep`, `noteHideout`), in every chase (Breathing
  Room, its rage and attack, the test chase), Standard/High aggression: each second, if the player is 12+ blocks off and
  pulling away, it moves 9-13 blocks ahead along their travel direction (±18°, ±35° if blocked) — or to a remembered
  hideout (the last four places a player escaped or drove it off) when one lies 10-40 blocks away within 35° of where
  they are running — at most 3 times a chase (4 on High), 5-7 s apart. Getting no closer for 3.5 s, it runs a quick A*
  (`world/path.js`, 900 nodes, climbs allowed) and glitches 3-5 cells along it.
* **Possession reach**: marked kinds within 96 blocks (was 64), every 4-7 minutes (was 10-15), a 60 % roll (was 35 %).
* **Its music** (`hush.trackFor`, `tools/synth_music.py`): stage 1-3 the user's themes (around / lurking); stage 4
  `observer.music.stalk` (in the Mire `observer.music.mire`), stage 5 `observer.music.end`, and `observer.music.chase`
  whenever a chase or its pack is on (`hush.chase(pid, on, source)`). All original: a C-major chip tune and an A
  harmonic-minor music box written in the script, rendered from oscillators, then slowed, detuned, wow-and-fluttered,
  bit-crushed, partly reversed, stuttered, tape-stopped and cut with static; the chase is 152 BPM on an E / B♭ tritone.
* **The Mire's ruins** (`tools/make_structures.py`, `tools/nbt_le.py`): five jigsaw structures in one structure set
  (`wmire:mire_ruins`, random spread 8 / 3 chunks, Mire biome tag only, `beard_thin`): the drowned chapel (11×11×15),
  the watcher's spire (7×20×7), the bone altar (11×6×11), the sunken archive (11×7×9, four deep), the surveyors' camp
  (9×5×9). The .mcstructure files are written from Python with the server's own full default block states; chests and
  barrels carry `LootTable` (six tables), lecterns carry original journals. Located in a fresh world 80 and 144 blocks
  from spawn.

## 25. Real cover; its pace; a bigger Mire; the Mire Eyebloom; the Sound Test (1.5.1)

* **It only peeks from behind real cover.** A peek used to accept "a solid block beside it" — and leaves counted — so it
  could lean out beside a bush in the open. Now the peek pose needs `space.peekCheck`: its whole body (feet, chest, the
  top of its head) behind *solid* cover from the player's eye — leaves, glass, bars, fences and plants do not count —
  and a side where its head, leaning a block out, is in sight both ways (its middle or its outer half). `hideSpot` finds
  such places round trees and, now, any column of building blocks or rock three or more high with open air on two sides
  at right angles (a house corner, a wall's end, a pillar): straight behind it, or up to three blocks along the walls that
  meet there, on the far side. `body.spawn` turns any requested peek without such cover into a plain stand; a body
  standing behind cover gets the tree peek-a-boo (duck when looked at, switch sides); if the cover stops hiding it, it
  stops hiding. The engine's own ray (`getBlockFromRay`) steps about a block at a time and slips past blocks a line only
  clips, so the last five blocks before the body (four before its head) are walked exactly, cell by cell
  (`space.cellsAlong`), and every ray is cast a little past its end with only hits before the end counted (also in
  `sight.lineOfSight`).
* **Its pace** (`body.pace`, every 5 ticks): its target's speed from their position over the last moment (smoothed; a
  teleport is ignored), and its movement value set so it comes at [slowest, × theirs, fastest] — approach [1.3, 1.05,
  6.4], pursuit [1.6, 1.12, 7.4], rage [8.0, 1.2, 9.4] b/s (the rage stays faster than a sprint); within 6 blocks, pursuing or enraged, it closes at 6.5 b/s at least — it creeps up, then lunges — from the calibration speed = 43.1·(value·goal multiplier)²
  (measured on BDS at 0.2-0.4: 2.92, 4.56, 6.57, 8.94, 11.26 b/s at ×1.3).
* **A bigger Mire**: `replace_biomes` amount 0.4 → 0.55, noise frequency 2.0 → 0.5, and 13 more targets (the other
  jungles, hilly forests, savanna plateaus, deserts; still not the taigas). Measured with the test kit's `otest:miremap`
  (ticking areas over a 960-block square, the biome every 16 blocks): the biggest stretch 60,000-100,000 → 130,000-
  300,000 square blocks, in 5-14 pieces (most of them single samples at a border), still 45-101 blocks from 0,0.
* **The Mire Eyebloom** (`wmire:eyebloom_stalk` ×2 under `wmire:eyebloom`): the stalk a cross plant; the flower a
  custom model — a short stem, a halo of petals, an 8-pixel eyeball whose front face is a flipbook (8 frames: ahead,
  left, right, up, half shut, shut, down, wide; 40-step sequence at 4 ticks a frame), light 4. States: the
  `minecraft:cardinal_direction` placement trait (rotations 0/90/180/-90) and `wmire:shut` (the lid texture). Placed by
  `structure_template_feature` (1×3×1 template), 4 tries a chunk at 2 in 3, in the Mire, on dry ground only. Every
  second, for each player in the Mire, the heads within 20 blocks: face the player when more than 50° from their view;
  shut while looked at from within 10 blocks (within 9°), open 1.5 s after; spores and drops at random. Breaking any
  part takes the rest down (`setblock … destroy`, so the eye can drop its spider eye).
* **Also in 1.5.1**: a line to a point inside a block (a pumpkin it turns, a door) is not blocked by that block itself
  (`sight.lineOfSight`, `space.solidBlocked`); the corruption takes only bare ground (nothing standing on it — grass,
  flowers, pages, eyeblooms would drop off and not come back); within 2.5 blocks the lens takes a 70° look instead of 15°.
* **The Sound Test** (`ui/sounds.js`): the six tracks by `playMusic` (looping, this player only) and sixteen sounds by
  `playSound`; a stop button. Open to every player.

## 26. Its dwellers: the Goatwalker, the Shaftbreaker and the Brinesleeper, merged in (1.6.0)

The user's own three add-ons (supplied as `.mcaddon` files, kept with their hashes in `source_assets/supplied_dwellers/`)
are merged into this one pack by `tools/merge_dwellers.py`, each still itself — its own entities, blocks, items,
biome, encounters, music and settings wheel — with as few changes to their code as the merge needs, every one of them
made by the tool (re-runnable; `--check` reports any merged file that differs from what the tool would write; the list
of merged files is `tools/merged_dweller_files.txt`):

* **One namespace for slash commands.** A pack may register custom commands under one namespace only: the
  Brinesleeper's `brine:*` commands become `observer:brine_*` (its enum `observer:brine_encounter_name`), the
  Shaftbreaker's `shaftbreaker:sb` / `shaftbreaker:action` become `observer:sb` / `observer:sb_action`.
* **Merged resource files**: `blocks.json`, `sound_definitions.json`, `music_definitions.json`, the texture lists of
  `terrain_texture.json` and `item_texture.json` (not their headers), `flipbook_textures.json`, and the language files
  (each dweller's lines in a marked block). The Goatwalker's `void_fence` had booleans in `bone_visibility`, which this
  game version rejects: they become Molang strings.
* **Who they see**: every `world.getAllPlayers()` in their code becomes `__dw.players("<name>")` (`link/shared.js`):
  nobody while that dweller is switched off, and never anyone in the Rift.
* **One music channel** (`link/shared.js`): their `playMusic`/`stopMusic` calls become `musicPlay(src, …)` /
  `musicStop(src, …)`. A dweller stopping its music does not cut off another's; the newest track still wanted plays
  again when the one playing stops; the Observer's silence and themes (`observer/hush.js`) take the channel first
  (`observerTake`) and give it back (`observerRelease`).
* **Their own wheels** are no longer handed out unasked (`GIVE_OWN_WHEELS = false`); the Config Wheel opens them.
* **Hooks appended** to the Goatwalker's `main.js` so it can be switched off cleanly (`__shutdown`: its encounters
  finished, its creatures removed, its fogs cleared), sent after someone (`__command`) and its wheel opened (`__open`).

`link/dwellers.js` holds the three together: per dweller, its creatures, its own on/off flag (kept in step with the
Observer's settings `dwGoatwalker`/`dwBrinesleeper`/`dwShaftbreaker`), "how often" and "how dangerous" as fixed lists
taken from its own settings (the Goatwalker's pace and aggression names; the Brinesleeper's frequency 50/75/100/150/200
and threat 1-3; the Shaftbreaker's frequency and difficulty enums), its wheel, shutdown and command. Off: its shutdown
runs, its music is silenced, its creatures in every dimension are removed and any that turns up later (natural
spawning, an egg, its own scripts) is removed on `entitySpawn`. **They answer to it**: every second, a dweller's main
creature within 48 blocks of the Observer's body gets Strength II, Speed I, Resistance I and Regeneration I for three
seconds (renewed while it is near), its glitch and its servants' eyes; and, if the Observer has a target within 96
blocks of it, it is sent after them (at most every 75 s per dweller and player). The Observer's dominion and its
possession never claim a dweller's creature unless the player marked it *Its puppet*.

**The biomes kept apart**: the Weeping Mire (`tools/merge_weeping_mire.py`), the Stellar Taiga and the Hollows each take
their ground from a different set of vanilla biomes (`replace_biomes` targets): the Mire 25 (plains, sunflower plains,
dappled forest, the swamps, the river, pale garden, cherry grove, the jungles, bamboo, the deserts, the birch, roofed and
hilly birch forests), the Taiga 16, the Hollows 16 — no target in two lists, so they can never be laid over each other
or blended into one. Measured with `otest:miremap` on two seeds: the Mire 20-22 % of a 960-block square (its biggest
stretch 160,000-190,000 square blocks), the Taiga 4-25 %.

## 27. The Rift (1.6.0)

**The dimension** (`rift/dimension.js`): `system.beforeEvents.startup` → `dimensionRegistry.registerCustomDimension(
"observer:rift")` — the stable custom-dimension API, a void world (y −64…320, reads as `minecraft:ocean`), no
experiments; nothing spawns there of itself (a minute on a stone floor in the dark: nothing). Ticking areas, `fill`,
structure placement, teleporting a player in with `{ dimension }`, and fog all work there (verified on BDS 1.26.52).
`constants.DIMENSIONS` lists it fourth, so nothing that happens there is filed under the overworld.

**The realm** (`rift/realm.js`; pieces drawn by `tools/rift_world.py`): a 5 × 5 grid of 48 × 52 × 48 pieces (world
y 48-99, the ground at 64) from (−128, −128): the landing in the middle, the church and the castle in two of the eight
cells round it, the dead woods (four kinds) in the other six, and the edge pieces (three kinds) and corner pieces (two)
all the way round, turned so their crumbling edge faces out (a quarter turn takes the drawn north to east — checked by
`otest:riftedge`). Every cell of a piece is written, air included, so laying it down again restores it exactly. Each
time a rift opens with nobody inside, the realm is laid out again, shuffled (church and castle elsewhere, every inner
piece turned at random): three ticking areas of 80 × 240 (75 chunks each) hold it, everything but players lying in it
is removed, and the pieces go down one every other tick — about 100 ms each, 3.2-3.5 s for all 25 on BDS. The layout
is kept in a world property (`observer:rift_realm`).

**What it is made of** (`tools/rift_world.py`; block states are the server's own defaults, `tools/rift_states.json`,
asked of a dedicated server with `otest:states`, which also gives each name's current id — `minecraft:chain` is
`minecraft:iron_chain` now): ground from two noises tapered to exactly 64 at every piece's border (so pieces meet in any
arrangement), a mosaic of the Rift's moss, podzol, the Goatwalker's ashen podzol, coarse dirt, the Mire's moss and
gravel; puddles (water at the lowest ground round them, mud under and round them); boulders of stone, cobble, tuff and
the Goatwalker's rift stone; trees on a Poisson disc 3.6 apart — dead pines (78 %: grey bark 13-25 high, bare
branches, dead needles thinning at the top, a fifth of them snapped), the Mire's weeping trees with their tendrils
(8 %), the Goatwalker's void trees with hanging moss (7 %), fallen logs (7 %); plants only on soils their placement
rules accept (ferns, grass, dead bushes; the Goatwalker's ferns, stellar grass, mooncaps and bleeding shrubs; the
Mire's bone grass and eyeblooms); and the dead (blood, bodies, skeletons, the Goatwalker's blood ash, skulls on stakes,
bodies hanged from branches). Edge pieces: the ground ends along a ragged line about 16 blocks in (exactly 16 at both
ends), thinning to a crumbling lip; an invisible barrier rail along the lip; torn rocks hanging in the void beyond,
some with void crystals. **The church**: a nave 15 × 27 of rift bricks with buttresses, tall pointed windows of crimson
glass, a steep broken roof, pews, an aisle of red carpet and a trail of blood to an altar on a raised chancel with a
body on it and candles round it; behind the altar a window of crimson glass shaped as an eye, two chests, a lectern
(*The Rift*); a crypt under the nave (stairs down in the corner, niches with the dead, sarcophagi, an ossuary wall, a
chest, *Ossuary*); a bell tower with a ringing chamber, an open belfry with a bell, a rose window, a spire and a crimson
lamp on its tip; a graveyard (stones in rows, open graves, a fence of bars, a gate), a mausoleum with a chest, dead
trees with the hanged. **The castle**: curtain walls two thick and twelve high with a walk and battlements, arrow slits,
four corner towers 8 × 8 with ladders and doors onto the walls, a gatehouse with a rusted portcullis, stairs up to the
walk, a courtyard with a gallows and three hanged, a well, a pyre of the dead, cages, a dead tree; a keep 24 × 20 of
three floors — the great hall (a throne on a dais under a crimson eye, feast tables with skulls and candles, the
Goatwalker's trophies and torn cloth on the walls, a hearth of soul fire), the armoury (barrels, an anvil, racks) and
the treasury behind bars (three chests, gold, a diamond and a netherite block, dead thieves), the lord's chamber (a
body in the bed, a chest) and the library (shelves, *The Castellan's Account*, a ritual drawn on the floor) — a roof,
a tower on it with a crimson lamp, and a dungeon below (a corridor, cells behind bars with the dead, chains, the
warden's chest, a cauldron of lava). Bars, panes, fences and walls are joined to their neighbours as drawn.
**Loot** (`loot_tables/rift/`): altar, crypt, mausoleum, treasury, armoury, lord, dungeon and traveller tables, 5-12
rolls of riches (diamonds, netherite, blocks of emerald, gold and diamond, enchanted golden apples, totems, ender
pearls, bottles of experience) plus 1-4 rolls of maxed gear (`specific_enchants`: netherite sword, axe, pickaxe and
armour, bow, crossbow, trident, mace, elytra) and enchanted books; the treasury adds nether stars, beacons, hearts of
the sea, shulker shells. Every table checked with `/loot spawn` (`otest:riftloot`).

**New blocks** (`tools/rift_assets.py`, all original): Rift Bark (a log), Dead Needles, Rift Moss, Rift Bricks and
Cracked Rift Bricks, Crimson Glass, a Crimson Lamp (light 12), Blood (four splashes), a Corpse, a Hanged Body (two
blocks: `observer:part`), a Skeleton and a Gravestone (the last four turn with the cardinal placement trait).

**The rift** (`rift/portal.js`; art by `tools/rift_portal.py`): the entity `observer:rift_portal` (no gravity, no
collision, invulnerable, persistent; property `observer:phase` 0 growing, 1 open, 2 shutting). Its model is three
pairs of planes: the void (80 × 112 model pixels — five blocks by seven; `entity_alphatest`, lit by nothing but
itself), an eight-frame flipbook chosen by its render controller (`Array.frames[math.mod(math.floor(q.life_time * 7),
8)]`): a torn oval, deep purple turning round a dark middle, stars that come and go, crimson veins running in from the
rim; a halo round it (`entity_alphablend`), pulsing; and a crimson eye in the middle (`entity_alphablend`) whose scale
opens it for a moment about every nine seconds. An animation controller grows it from a crack over six seconds, holds
it, and shrinks it back into one. Sparks off its rim and motes round it are its own looping particles (additive). It
opens on open ground 8-15 blocks from the player, mostly ahead of them (three wide and seven high clear; plants do not
count), with six invisible light blocks (level 14) in the air round it, taken away when it shuts (where the chunk is
not loaded then, the next time it is: `riftUnlight` in the world state). Opening: the realm is laid out (unless someone
is inside), then it opens (6 s), stands for 150 s, and shuts. Every 12 ticks it turns up to 12° toward the nearest
player. A player within 1.5 blocks of its middle (and within its height) is through: their way back is stored on them
(`observer:rift_return`: where they went in, a step out of the rift), and they arrive at the stones, a few steps from
the way out, facing away from it. **The way out** is the same entity with the tag `observer_rift_exit` in the middle of
the landing, there while anyone is inside (a ticking area holds its chunks), gone when nobody is. A player who comes
back into the world inside the Rift after it was laid out again (`observer:rift_gen` ≠ the realm's) is put back at the
stones. **The schedule**: the Rift setting 0-5 — the average wait [never, 90, 45, 24, 12, 5] minutes of play, each wait
× 0.6-1.4 at random; when it is due, a rift opens near a random player who can go (Survival or Adventure, alive, not
asleep, not already in the Rift); no room there, it tries again in 30 s. The Config Wheel's *The Rift* page sets it and
can open one now (forced) or shut the open one.

**Its weather and rules** (`rift/atmosphere.js`, every second): the fog `observer:rift` (grey-violet, 2-30 blocks) for
everyone in the Rift and off again when they leave or die there; rain (a particle emitter 26 × 26 round each player,
260 streaks a second falling at 22 b/s that end on whatever they hit, so roofs keep it off) and the sound of it; embers
drifting up; lightning every 14-40 s — thunder near or far and, on the camera-effects setting, a flash (a pale camera
fade of a quarter to two-thirds of a second); anything in the Rift that is not a player, its own (`observer:*`) or a
thing dropped, thrown or shot (`STAYS`) is removed; a player below y 42 or more than 14 blocks outside the realm is put
back at the stones (with a moment of slow falling).

**Its hunt** (`rift/hunt.js`): rounds of the encounter `rift_hunt` (manual; `rift: true` — no history, pacing or
progress, no global cooldown for anyone else, ended when they leave the Rift), started one after another by the
module's own tick for whoever in the Rift is due (the one waiting longest first; forced: the body leaves whatever it
was doing elsewhere). A round: first it toys with them for a while — every 2.5-4.5 s one of: a glimpse (behind a trunk
14-26 blocks ahead, peeking, gone when looked at for half a second or after 3-4 s), right behind them (3.5-6 blocks;
if they turn round in time it shrieks and charges from there), a laugh or a whisper off in the rain or its steps
circling them, the trees bleeding round them (red drops down a trunk, blood at its foot), or lightning with it standing
7-12 blocks off in the flash — then it charges: between them and the way out if they are heading for it (by chance by
level), at the chests if they are near one, else from behind them out of sight or ahead of them; a warning (a stare and
its hum, shorter by level; none at the top); then `common.relentless` with the Rift's options — how far they must get
to lose it, how often it cuts ahead (`chaseState`'s `think`), how soon it strikes again — and the body's **boost**
(`body.setBoost`): its pace [slowest, × theirs, fastest] whichever way it comes, its blow (never on aggression *never*:
then a catch throws them back to the stones) and its wind-up. By level (the Rift setting):

| Level | toys | rests | pace b/s | blow | wind-up | lose it at | cut-aheads | behind / ambush / guard | warning |
|---|---|---|---|---|---|---|---|---|---|
| 1 rarely | 13-20 s | 21-32 s | 4.6, ×1.0, 6.0 | 4 | 12 t | 72 | 1 | 15 / 15 / 0 % | 2 s |
| 2 sometimes | 10-16 s | 16-25 s | 5.4, ×1.08, 7.2 | 6 | 11 t | 96 | 2 | 30 / 25 / 20 % | 1.5 s |
| 3 often | 7-12 s | 11-18 s | 6.4, ×1.16, 8.6 | 8 | 10 t | 140 | 3 | 45 / 40 / 45 % | 0.9 s |
| 4 very often | 4.5-8.5 s | 7-13 s | 7.4, ×1.25, 10.2 | 10 | 8 t | never | 5 | 60 / 55 / 70 % (enraged) | 0.4 s |
| 5 constantly | 2.5-5.5 s | 3.5-7.5 s | 8.6, ×1.35, 12.0 | 13 | 7 t | never | 8 | 75 / 70 / 90 % (enraged) | none |

Measured on BDS (`rift_levels`): closing in at 4.6 b/s and a first blow of 4 on level 1; 8.3 b/s and 13 on level 5.
Driven off (a flare, the lens, a blow), the next round waits 1.6 times as long. Elsewhere: the director's context makes
nobody in the Rift eligible for its other encounters, `tryManual` starts nothing there but its hunt, a trip through a
rift and back is not a portal it follows you through, its theme plays in there (`isAround`, the Mire's *lurking* theme
while it stalks, the chase while it comes), the Mire's eyeblooms watch in the Rift too, and it hides behind the Rift's
dead pines and the Goatwalker's void trees as it does behind any trunk. Its lines there (`talk.js`: `rift_arrive`,
`rift_taunt`, `rift_loot`, `rift_guard`, `rift_back`, `rift_left`) and three discoveries: *The Rift*, *Right Behind You*,
*Out of the Rift*.

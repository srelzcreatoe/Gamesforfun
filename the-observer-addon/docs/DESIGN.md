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
   pressure (3 blows/lens uses) buys a 15-minute withdrawal.

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
| `run` | `running` | supplied | pursuit |
| `attack` | `attack` (once) | supplied | telegraphed strike; damage applied at the clip's strike frame (0.6 s) |
| `peek` | `idle` + `peek` | supplied + **new** | leaning out from cover; side from `observer:side` |
| `recoil` | `recoil` | **new** | witnessed through the lens, struck, driven back by light |
| `hidden` | — (no parts) | — | momentary vanish |
| `observer:stoop` = true (overlay) | `stoop` | **new** | automatically when headroom < 5 blocks |

Supplemental clips are generated by `tools/make_supplemental_anims.py` using only the supplied bones. Before writing
them, the rotation convention was verified by rendering the supplied clips with an offline forward-kinematics renderer
(`tools/render_model.py`) and comparing against the supplied previews (arm splay in the turnaround, head tilt in the
preview). The walk and stoop root heights are solved numerically so the lowest foot rests on the ground; the stoop
lowers the figure to 2.81 blocks so it fits its 2.9-block collision box.

### 4.2 Physical properties (`entities/the_observer.json`)
* Collision 0.8 × 2.9 (fits 3-high corridors stooped; cannot pass 2-high doors — it opens them to look in instead).
* Immune to damage, knockback and status effects; not pushable; fire-immune; breathes water.
* Modes (component groups): **still** (no gravity — it can stand on water and ledges), **approach** (~1.5 b/s),
  **pursue** (~4.8 b/s: faster than walking 4.3, slower than sprinting 5.6). Speeds were calibrated on the dedicated
  server (speed ≈ 3.88 × multiplier² b/s for this entity). Walking *away* is script-driven (validated 0.18-block
  steps at ~1.8 b/s, at most one block up or down, three open blocks overhead): the vanilla `avoid_mob_type` goal in
  the unused `retreat` group did not move it away from players in the capability probe.
* Head tracking, auto-stoop by headroom, and eye glints: when it stands in light ≤ 6, players in front of it see two
  faint unlit glints where its eyes are — the model's eyes are texture-only, so this is how observant players can spot
  it in darkness.

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
| Two pale glints in the dark | body maintenance | its eyes |
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
| M8 | **Animals turn** (`animalsFace`) | entity interaction tell | distant_watch at stage ≥ 2 (30%) | ≤ 12 passive mobs within 24 blocks | rotation only, for 8 s | — | per encounter | look where they look | shared | nothing to clean | code review (not separately asserted) |

Additional non-block manipulation: personal fog (`observer:dread`, `dread_soft`, `vigil`), camera fades/shakes
(camera setting), and the vigil's optional world-wide rain (global, announced).

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
| 2 | 4 | 2 | extra step, home visit, lights out, bearing, window, second witness, night visit, follow-ups |
| 3 | 10 | 4 | echo ahead, path changed, close |
| 4 | 18 | 7 | the closed path |
| 5 | 30 | 10 | pursuit (aggression ≥ 1) |

**Pacing**: after each encounter the next is scheduled `rand(150, 320) s ÷ frequency × (1 − 0.04·stage) × mood × (1 + tension/150)`,
where mood is shorter at night, underground, in darkness and in other dimensions. Every 3–5 encounters a genuine quiet
period of 6–12 min follows. Tier ≥ 3 encounters add 4–6 min recovery; death adds 5 min recovery and relieves tension.
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
  change blocks within 12 blocks).
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
| Standard | 1.0× | standard (6 dmg, capped) | standard | rare | full | 12 min |
| Relentless | 1.5× | high (9 dmg) | unsettling | standard | full | 5 min |

Independent controls (operators, Field Notes → Settings or `/observer:settings`): enabled, frequency 25–200 %,
aggression 0–3, manipulation 0–3, sudden scares 0–2 (≤ 1 sting per 25/15 min), camera 0–2 (none / fades only / fades +
shakes), caption default, grace minutes, world-wide weather, developer tracing. Peaceful difficulty forces aggression 0.
Strike damage is capped: above half health a strike cannot take more than 70 % of current health.

## 14. Audio

All 28 sound files are original, synthesized by `tools/synth_sounds.py` (no samples): heavy cloth-and-weight footsteps
(4 variants), the hum (detuned 46/47.3/69.5 Hz drone with a swell), the tell (an inharmonic, tuning-fork-like chime),
breath (band-passed exhale), cloth rustles, knocks, snuff, wind-up/strike/whiff, the sting (a dissonant swell, cut
short — not a scream), the seal, the arrival, chalk, the discovery scribble-and-bell, the lens shimmer, effigy crumble,
the vigil drone with bells, stone scrape, sinking bubbles, and a quiet tinnitus ring. Borrowed sounds and matched
footsteps intentionally use vanilla sound events (`dig.*`, `step.*`, `random.door_*`, `random.chest*`…), because the
point is that they are *your* familiar sounds.

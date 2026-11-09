# The Brinesleeper 3.0: "The Water Remembers"

The full horror add-on, built on the existing Brinesleeper model and its home biome, the
[Stillwater Caves](README.md#stillwater-caves-biome). A hidden director script stages every
encounter. The creature is meant to frighten you while it does nothing. It is rarely seen,
almost never chases, and leaves signs that the water is not what it seems.

**What was tested:** everything here passed static checks (listed under
[Testing report](#testing-report)). It has **not** been run inside Minecraft from this
environment. The [runtime checklist](#runtime-checklist-not-yet-verified-in-game) lists what
still needs an in-game pass.

---

## What's new in 3.0: "The Deep"

**A summoned or natural Brinesleeper now has a mind of its own.** It no longer just wanders.
It roams both the water and the shores, picks someone, and stalks them, on land as well as in
the water:
* **Stalk:** it creeps after you in its crouched walk, and its eyes glint in the dark.
* **Closing in:** while you aren't looking, it is suddenly closer.
* **Breathing:** if you don't turn around, you hear it breathe behind you.
* **Stand-off:** it stops and stares, with only its head above the water if it's swimming.
* **Break or charge:** walk at it and it either breaks and runs or comes for you. Stare it down
  too long and it does the same.
* **Chase:** it roars and charges. It is faster than you and leaps at you, with the chase theme
  playing.
* **Ambush:** it waits under the water by the edge where you stand. Bubbles give it away, then it
  bursts out roaring and drags you toward the water.
* **Drag under:** in the water it is much faster than you. It circles, grabs you and drags you
  down, with a black-out flash. Break free by hitting it or kicking up (jump).
* **Grudge:** it remembers who hurt it. Kill it and a few minutes later another one comes back
  for you.

**The water is the horror.** Something is in it, and it wants you:
* **The water is murky:** 92% opaque, and 9 blocks of near-black visibility underneath.
* **While you swim over deep water:**
  * a huge dark shape glides beneath you with a moan, and the light dims as it passes over
  * something bumps you
  * or the real creature starts circling you
* **Lures and knocking:** from the water come sounds that shouldn't be down here (someone hurt, a
  villager, a cat). There is knocking from the stone.

**Atmosphere:**
* Your **heartbeat** speeds up as it gets closer: 68 to 150 bpm, played to you alone.
* The caves now have **their own music**: four slow dark tracks with long silences between
  them.
* There is a **chase theme** and **sighting stings**.
* Small **screen effects:** a little shake on a roar, darkness as the shape passes, a black-out
  when grabbed.
* Rare **whispers**.
* **It takes your lights:** torches and lanterns you aren't looking at fall to the floor, and
  candles and campfires go out. Nothing is lost; you find the torch on the ground.

**Stronger:**
* Three threat levels:

  | Threat level | Health | Melee | Lunge |
  |---|---|---|---|
  | Dangerous | 100 | 6 | 10 |
  | Deadly (default) | 150 | 8 | 12 |
  | Apex | 220 | 11 | 15 |

* Faster on land and much faster in the water.
* It steps up full-block ledges, so it doesn't get stuck in the water.
* If it is still stuck after 10 s and nobody can see it, it repositions.

**Faster pacing:**
* Balanced: the first sign within 45–90 s in the caves, and big encounters every 3–6 minutes.
* A summoned creature starts stalking within 5–15 s.
* There is a new **Nightmare** preset.

**Settings wheel:** the *Brinesleeper Settings* item, a dark cog with a red hub. Operators get
it on first join, or with `/brine:wheel`. Right-click it to open the menus:
* presets and pacing
* the creature (threat, grasp, lights)
* atmosphere (heartbeat, music, screen effects, whispers, lures)
* the caves (block hostiles, repairs)
* a test page to stage any encounter or summon one in front of you

**Biome fixes:**
* **Murky water.**
* **No other hostile mob ever spawns** in the Stillwater Caves. The biome has no `monster` tag,
  and the script removes any that slip through (spawners, slimes). Mobs you summon nearby are
  left alone.
* **Floating vines, stalactites and plants are repaired.** They came from flooded halls carved
  later by a neighbouring chunk. Each chunk around you is checked once, as you explore.
* **Leaking lake edges are sealed with stone.** These are the "water walls" where a hall cut
  into an older cave.

**Test it in Survival.** Minecraft mobs can't target players in Creative, so in Creative it
can only stalk you by jumping closer while you aren't looking. It can't walk after you, chase
or grab you.

---

## Contents
1. [Install and quick start](#install-and-quick-start)
2. [Version and compatibility](#version-and-compatibility)
3. [How it plays: states and pacing](#how-it-plays-states-and-pacing)
4. [Mechanics report](#mechanics-report)
5. [Animation inventory](#animation-inventory)
6. [Configuration guide](#configuration-guide)
7. [Multiplayer and robustness](#multiplayer-and-robustness)
8. [Testing report](#testing-report)
9. [File structure](#file-structure)
10. [Originality report](#originality-report)
11. [Honest limits](#honest-limits)

---

## Install and quick start
1. Open `Brinesleeper.mcaddon` (or import both packs).
2. Make a **new** world. Activate **Brinesleeper Resources** and **Brinesleeper Behaviors**. No
   experimental toggles are needed.
3. Find the caves with `/locate biome brine:stillwater_caves`, then teleport there.
4. Spend time in the caves. Nothing happens for the first 6 to 10 minutes. That quiet is
   deliberate.

**Testing shortcut (operators, cheats on):** `/brine:encounter <name>` stages any encounter
for you at once, and `/brine:status` shows the hidden director state. Settings are in
`/brine:settings`.

## Version and compatibility

| | |
|---|---|
| Pack version | 3.0.0. It imports over 1.x and 2.x. |
| Minimum game version | Minecraft Bedrock **1.26.40** (manifest `min_engine_version`). |
| Script modules | `@minecraft/server` **2.9.0** and `@minecraft/server-ui` **2.1.0**, the stable versions that ship with 1.26.40. No beta APIs and no experimental toggles. |
| Custom biome | Non-experimental `minecraft:replace_biomes`, available since 1.26.30. |
| Newer game versions | Bedrock keeps supporting older stable script module versions, so 2.9.0 should keep working. This has not been checked against unreleased versions. |
| Other add-ons | No vanilla files are overridden. Everything uses the `brine:` namespace. It only replaces part of the Dripstone Caves biome. |
| Worlds | The biome only appears in chunks generated after the pack is added. Back up existing worlds first. |

## How it plays: states and pacing

The director keeps a hidden **tension** value for each player. It is never shown: there is no
anger meter, no scoreboard and no HUD. Tension rises with time in the caves, swimming,
sprinting, splashing, and breaking or placing blocks. It rises faster in a fresh
**Stillwater Territory**, and it drops after each encounter. Only `/brine:status` reveals it,
and that command is for operators.

| State | What happens | In the script |
|---|---|---|
| **Dormant** | The first 6 to 10 minutes of a player's time in the caves (Balanced preset). Nothing happens. | `firstQuiet`, counted in seconds spent in the biome and saved per player |
| **Disturbance** | Your own noise is noticed: the Third Splash, the Wrong Echo, the Stolen Wake, the Last Safe Step. | Triggers on water entries, water exits and block changes |
| **Observation** | It watches from somewhere you could see if you turned. The first sighting comes 8 to 15 minutes in. | Major scenes: stationary predator, waterline deception, hidden shoreline, unfinished crawl |
| **Investigation** | It shows up at places you have already been. | The Water Remembers (up to 8 remembered water spots per player) |
| **Contact** | It is seen close: it emerges, rises upright, or slips into the water. Contact never starts a chase by itself. | Unfinished emergence, the revelation. Being struck makes it flinch away, and only a rare high-tension case turns into a hunt. |
| **Hunt** | A short, fair chase of 10 to 20 s, with a clear warning first. | `sceneHunt`: needs tension ≥ 70, is never the first encounter, and depends on the preset's chance. Survival or Adventure only. |
| **Withdrawal** | It backs off into the water and sinks. It never vanishes in plain sight. | The `withdraw` AI mode. Removed once submerged or out of view. |
| **Aftermath** | Wet drips trace where it stood. The territory stays awake for 3 to 5 minutes. | `wetTrail`, `markTerritory` |
| **Recovery** | A long cooldown before the next major encounter (12 to 20 minutes on Balanced). Minor signs still happen. | `nextMajor` / `nextMinor` for each player |

**Pacing (Balanced Horror):**
* Quiet for the first 6 to 10 minutes.
* Minor events every 80 to 170 s after that.
* First sighting at 8 to 15 minutes.
* 12 to 20 minutes between major encounters.
* Chases last 10 to 20 s.
* The two-legged revelation is 8% of major encounters, and never the first.
* Hunts are at most 35% of major encounters, and only at high tension.

**Respawn protection:** for two minutes after a respawn nothing major happens. If a player
dies, the current scene ends and their tension drops.

## Mechanics report

There are 26 mechanics. All of them are implemented in `scripts/main.js` and run on the
stable API. "Minor" mechanics need no creature. "Major" mechanics use the one real creature.
Every one can be triggered with `/brine:encounter <name>`. In the table, "minor interval" and
"major interval" mean the preset's spacing between minor and major events.

| Name | Trigger | Behavior | Animation | Sound | Cooldown | Escape / counterplay | Technical implementation |
|---|---|---|---|---|---|---|---|
| **False Reflection** | Minor event while within 6 blocks of water | A dark inverted figure stands under the surface 3–6 blocks ahead, where your reflection would be | Shade, inverted (`invert` + a standing pose) | ripple | minor interval | Stare at it for 1 s and it is gone in a ripple | `brine:apparition`, form 1 (inverted, shade texture) placed at the waterline, removed on look or after 2.5–4 s. It is a figure in the water, **not** a real reflection. |
| **The Water Remembers** | Always on | It appears at places you have been in or beside the water, never right next to you | — | — | — | Avoid the water and it has fewer places to wait | Up to 8 remembered water positions per player feed the Waterline Deception and the Empty Pool |
| **Stolen Wake** | Leaving the water after swimming ≥ 4 s (30%) | 2.5 s later your wake keeps moving along the path you swam | — | ripple | minor | — | Swim path sampled every 1.5 blocks and replayed as `brine:ripple` |
| **The Third Splash** | Your second water entry within 25 s (60%) | A third splash you didn't make, 8–16 blocks away, behind you | — | splash_far | per pair of entries | — | Counts water entries, then sound and particles at a found water surface |
| **The Unfinished Emergence** | Major event | It starts to rise from the water ahead of you. If you are watching halfway up, it stops and sinks back. | emerge → submerge (0.6 s blend) | emerge, click, submerge | major interval | Look at it to stop it | Held creature at the waterline. Looking is tested with a view cone plus a raycast. |
| **The Stationary Predator** | Major event | It stands still 18–34 blocks away while watched. While unwatched it moves closer, at most twice and never within 10 blocks. | distant_observer, corner_watch, ledge_watch, behind_cover, head_tilt, patient_strike | click | major interval | Walk at it and it slips away. Keep watching and it can't move. | `hold` AI mode (no movement, no gravity). Moves by teleport only while unseen. |
| **Two-Legged Revelation** | Major event, rare (5–9%, never first) | It rises onto two legs, full 3.5-block height, holds 3–5 s with a low call, drops to all fours and leaves | hunting_stance → full_stand (1.2 s blend, no snap) → hunting_stance → retreat | click, call | major interval | It never attacks during this | Act controller transitions blend 1.2 s between the quadruped and upright poses |
| **Waterline Deception** | Major event | Only its head shows above the water, at a remembered spot 12–40 blocks away | submerged_watch | breathe | major interval | Come within 9 blocks, or stare 4 s, and it sinks silently | Held at 2.06 blocks below the waterline (the pose's own calibration) |
| **Drowning Grasp** | During a hunt, you in water within 2.6 blocks, health > 8 | For 2 s it pulls you down: Slowness III and 3 damage | grasp | grasp | Once per hunt, toggle in settings | Hit it, or kick upward (jump), to break free | Downward `applyKnockback` every 4 ticks, then it recoils. Never at low health, never a kill. |
| **The Last Safe Step** | Leaving the water after swimming ≥ 4 s (≈21%) | About 1 s after you climb out, the water surges where you stood | — | surge, bubbles | minor | — | Splash and bubble particles at the exit point |
| **The Dryland Imitation** | Minor event on land | Your footsteps repeat 5–7 blocks behind you, half a second late, and once more after you stop | — | step (wet) | minor | Stop walking | Plays the step sound behind the player while they move |
| **The Silent Water Event** | Minor event | For 8–12 s the add-on's own sounds stop, then one deep splash comes behind you | — | splash_far | minor | — | Silences all add-on sounds within 48 blocks. **Vanilla audio is not muted.** The biome already has no music. |
| **The Reverse Wake** | Minor event near water | A wake crosses the water toward you and stops about 3 blocks short | — | ripple | minor | — | Ripples stepped along the surface from 18–24 blocks out |
| **The Hidden Shoreline** | Major event | It lies low on a shore 12–24 blocks away | shoreline_stalk → submerge | surge, submerge | major | Approach (< 8) or stare and it slips into the water | Finds a floor block next to water, then the nearest surface for the dive |
| **The False Retreat** | End of a hunt (tension > 60, 35%) | It withdraws and sinks, everything goes silent, then 8–14 s later it rises once more from behind for 5–7 s | water_rise, run/stalk | emerge, lunge | once per hunt | The same counterplay as the hunt | A second, shorter `sceneHunt(…, second = true)` with the silence zone |
| **Stillwater Territory** | Each major encounter | The water around that spot stays awake for 3–5 min: more frequent signs (×1.6) and faster tension (×1.5) | — | — | expires | Leave the area | Territory list with expiry. **No blocks are changed.** |
| **The Head That Doesn't Follow** | During Stationary Predator | It keeps facing where you were. When you have moved 6+ blocks, a bone-crack and its head snaps to you. | the held pose | click | — | — | Held creature keeps its rotation, then turns with a teleport `facingLocation` |
| **The Final Reflection** | Leaving the caves after ≥ 60 s inside (60%) | If you look back, it is standing under the water where you were | Shade, inverted | — | once per visit | Don't look back | Apparition at your last biome position's water surface, up to 10 s |
| **The Watching Hand** *(new)* | Minor event near water | A grey hand rises out of the water 7–14 blocks away, holds, and sinks | Hand-only geometry, inverted | ripple | minor | — | `brine:apparition` form 2 (hand geometry), raised and lowered by teleport |
| **The Standing Silhouette** *(new)* | Minor event on land | A tall dark shape at the edge of sight, 24–40 blocks away | full_stand, shadow_hide, head_tilt (shade) | — | minor | Look properly (1.5 s) or come within 16 blocks and it is gone | Apparition form 0 |
| **The Unfinished Crawl** *(new)* | Major event | Something crawling in a low space 10–20 blocks away stops when seen | tunnel_crawl | click | major | Look away and it is gone | Held creature in a low-ceiling spot |
| **The Empty Pool** *(new)* | Minor event, needs a remembered pool | A pool you swam in bubbles, and wet drips lead out of it | — | drip | minor | — | Memory, bubbles, drip trail |
| **Breath on the Water** *(new)* | Standing still ≥ 6 s at the edge | Bubbles and an exhale right beside you | — | bubbles | minor | Keep moving | Stillness counter for each player |
| **The Wrong Echo** *(new)* | Breaking or placing blocks in the caves (35%) | Your noise is answered from across the water, lower | — | step (pitched down) | 60 s | Work quietly | Block break and place after-events |
| **The Wet Trail** *(new)* | After observer and hunt scenes | Drips trace the way it went | — | — | — | — | `brine:drips` along a line |
| **The Lunge** *(new)* | During a hunt, 2.4–5.5 blocks with line of sight | A long reaching strike for 7 damage, with a visible wind-up and a shriek | lunge | lunge | 4–7 s | Back off, or break line of sight | Played with `playAnimation`. Damage lands 0.35 s later only if you are still within 3.6 blocks. |

**Balance:**
* Health 70.
* Melee 5, lunge 7 (both scaled by the preset; 0 on Observation Only).
* Collision 1.1 × 3.4 blocks (the model is 3.5 tall).
* Chases last 10 to 20 s and are abandoned past 40 blocks, or when it makes no progress for
  6 s while out of sight.
* Exactly one real creature per world. A natural spawn while another exists is undone.
* No instant kills, no permanent effects, no screen shake, no blindness.

## Animation inventory

The model's 29 animations are reused. Each pose is a looping hold the director can blend to.
Two things were added:
* `invert`, which flips the root so apparitions hang upside down from the waterline.
* "Hold on last frame" on the one-shot poses: emerge, submerge, water_rise, retreat and
  emerge_roar. A scripted pose then never snaps back to the bind pose.

Scripted poses use the client-synced property `brine:act` (21 poses). The act animation
controller can blend from any pose to any other, so every change is animated:
* 0.4 s for emerge.
* 0.6 s for submerge and retreat.
* 0.8 s for water_rise and most others.
* 1.0 s into hunting_stance.
* 1.2 s into full_stand, which is the **crawl-to-stand rise**. Dropping back takes 1.0 s.

| Animation | Used for |
|---|---|
| watch, hunting_stance, walk, crouch_stalk, run | Locomotion: idle on land, stalking, chasing |
| idle_water, swim | Locomotion in water |
| lunge | Melee swing and the scripted 7-damage lunge |
| grasp | Melee in water and the Drowning Grasp |
| emerge, water_rise, emerge_roar | Unfinished Emergence, hunt start, False Retreat |
| submerge, retreat | Withdrawal and every sink-away |
| submerged_watch | Waterline Deception |
| shoreline_stalk | Hidden Shoreline |
| distant_observer, corner_watch, ledge_watch, behind_cover, head_tilt, patient_strike | Stationary Predator and Head That Doesn't Follow |
| full_stand | Two-Legged Revelation, silhouettes, reflections, the hand |
| shadow_hide | Standing Silhouette |
| tunnel_crawl | Unfinished Crawl |
| reflection_lurk, veil_stalk, slow_approach, ceiling_lurk | Available poses. ceiling_lurk is not staged yet because it needs ceiling placement. |
| look_at_target | Head tracking while it is not held |
| invert *(new)* | False Reflection, Final Reflection, Watching Hand |

**Clipping and limb checks:** these 29 animations passed the model's anatomy audit (`tools/audit.py`) in
version 3. No limb bends backward and every hand settles on a surface. Blends only interpolate
between audited poses.

## Configuration guide

Open the settings with `/brine:settings` (operators), or `/scriptevent brine:settings`.
Settings are saved with the world.

| Setting | Effect |
|---|---|
| Enabled | Turns the director off or on. The biome and natural spawns are unaffected. |
| Preset | See the presets table below. |
| Drowning grasp | Turns the grasp on or off. |
| Encounter frequency | 50–200%. Scales how often minor and major events happen. |
| Debug messages | Operators see which scene or event started in chat. |

**Presets:**

| Preset | First quiet | Minor signs | Big encounters | Free creature rests between stalks | Hunt chance | Damage |
|---|---|---|---|---|---|---|
| Quiet Dread | 3–5 min | 90–180 s | 8–14 min | 150–300 s | 20% | 80% |
| **Balanced Horror** (default) | 45–90 s | 35–80 s | 3–6 min | 50–120 s | 45% | 100% |
| Relentless | 20–40 s | 20–45 s | 1.5–3 min | 25–60 s | 70% | 100% |
| Nightmare | 5–15 s | 12–30 s | 1–2 min | 12–35 s | 85% | 125% |
| Observation Only | 45–90 s | 35–80 s | 3–6 min | 50–120 s | none | none |

**Settings wheel pages:**

| Page | Settings |
|---|---|
| Presets & pacing | Awake on/off, preset, encounter frequency 50–200% |
| The creature | Threat (Dangerous, Deadly, Apex), drowning grasp, takes your lights |
| Atmosphere | Heartbeat, chase music and stings, screen effects, whispers, lures |
| The caves | Block other hostile mobs, repair floating plants and seal leaking lakes, debug messages |
| Test an encounter | Stage any encounter now, or summon a creature in front of you |

The caves' background music is part of the biome. Use Minecraft's own Music volume slider for
it. The menu's music switch covers the chase theme and stings.

**Commands (operators):**
* `/brine:settings` opens the menu.
* `/brine:wheel` gives you the wheel.

**Testing commands (operators, cheats on):**
* `/brine:encounter <name>` stages one encounter now. The names are: third_splash,
  silent_water, reverse_wake, false_reflection, watching_hand, standing_silhouette,
  empty_pool, breath_on_the_water, dryland_imitation, waterline_deception,
  unfinished_emergence, stationary_predator, hidden_shoreline, two_legged_revelation,
  unfinished_crawl, hunt, stolen_wake, last_safe_step and final_reflection.
* `/brine:status` shows your hidden state: time in the caves, tension, the next events and
  memories.
* The same encounters work through `/scriptevent brine:encounter <name>`.

## Multiplayer and robustness
* **One creature for everyone.**
  * There is one real creature and one creature scene at a time.
  * Minor events run per player, one at a time.
  * Tension, cooldowns, memories and quiet time are tracked per player. Time in the caves,
    tension and quiet time are saved on the player.
* **When the player in a scene changes state:**
  * Death, leaving the game or changing dimension ends the scene.
  * The creature withdraws, or is removed if no one can see it.
  * Apparitions are removed.
* **Reload or restart:** every staged creature and apparition is cleaned up. Each apparition
  also removes itself after 40 s through its own timer, even without the script.
* **Never in sight:** it is never removed or teleported while someone can see it. During a
  visible chase it moves only by walking or swimming.
* **Spectators:** they trigger nothing.
* **Creative players:** they can witness sightings but are never hunted.
* **Performance:**
  * The director runs every 10 ticks.
  * Scenes are generator scripts woken only when due.
  * Place searches are capped at 28 samples.
  * Everything is cleaned up when it ends.

## Testing report

### Static validation performed (all passing)
* `tools/validate_packs.py <pack root> mojang-blocks.json` reports no problems:
  * every JSON file parses
  * every feature, rule, structure, block, texture, fog and sound reference resolves
  * 33 structure files decode
  * every vanilla block and state in features and structure palettes matches Mojang's
    `mojang-blocks.json`
  * The director script cross-check passes. Every particle, sound event, entity event, property
    and animation the script uses exists in the packs. The script's pose ids match the
    animation controller's ids exactly.
* **TypeScript check** of `scripts/main.js` against the official `@minecraft/server@2.9.0`
  and `@minecraft/server-ui@2.1.0` typings from npm (`tsc --checkJs`): 0 errors. That rules
  out misspelled API names, wrong argument types and calls missing from those versions.
* **Mojang's JSON schemas** (`tools/schema_check.py`):
  * Both entity files, both client entities, the four particles and the render controllers
    pass.
  * The remaining reports are known schema bugs, such as weighted lists, list-style
    `allowed_faces` and the geometry array form. These forms are used by Mojang's own samples.
* **Biome previews:** produced by simulating the pack's own generation rules
  (`tools/biome_preview.py`).

### Runtime checklist (not yet verified in-game)

These need an in-game pass, ideally on Balanced and with `/brine:encounter` for each
mechanic.

| Check | What to look for |
|---|---|
| Packs load on 1.26.40 with no content-log errors | The script logs nothing at startup. `/brine:settings` opens. |
| Biome halls generate | Lakes at y -24 and y 12, pillars, ribcages, shrines with lit candles |
| The creature holds water poses at the right height | Waterline Deception shows only the head, and emergence starts at the surface |
| Pose blends | full_stand rises over about 1.2 s with no snapping. Held one-shot poses don't snap back. |
| Apparitions | The reflection hangs upside down under the surface. The hand rises above the water. The silhouette is dark. |
| Hunts | Warning, chase, lunge timing and damage, abandoning past 40 blocks, withdrawal into water |
| Drowning Grasp | The downward pull is strong enough to feel and weak enough to escape (knockback strength may need tuning) |
| Multiplayer | Scenes end cleanly on death, leaving and dimension change. Only one creature exists. |
| Performance | No noticeable tick cost with several players in the caves |

## File structure
```
minecraft/brinesleeper/
├── Brinesleeper.mcaddon            # both packs, ready to import
├── ADDON_REPORT.md                 # this report
├── README.md
├── behavior_pack/
│   ├── manifest.json               # data + script modules (@minecraft/server 2.9.0, server-ui 2.1.0)
│   ├── scripts/                    # index.js (entry), main.js (director), brain.js (the creature's mind),
│   │                               # care.js (no hostiles, repairs), menu.js (settings wheel), config.js
│   ├── items/config_wheel.json     # the Brinesleeper Settings wheel
│   ├── entities/brinesleeper.json  # 70 HP, AI modes, brine:act property
│   ├── entities/apparition.json    # untouchable shapes (silhouette / reflection / hand)
│   ├── spawn_rules/                # Stillwater Caves only
│   ├── biomes/ blocks/ features/ feature_rules/ structures/brine/   # the Stillwater Caves
├── resource_pack/
│   ├── entity/                     # brinesleeper + apparition client entities
│   ├── animation_controllers/      # move, attack, look, act (21 scripted poses)
│   ├── animations/                 # 29 model animations + invert
│   ├── models/entity/              # brinesleeper and the hand-only geometry
│   ├── render_controllers/         # creature, and apparition (shade texture / hand geometry)
│   ├── particles/                  # brine:ripple, bubbles, drips, splash
│   ├── sounds/ sounds.json         # creature, water effects, cave ambience
│   ├── textures/                   # model, its shade, block textures, particle sheet
│   ├── biomes/ fogs/ blocks.json texts/
├── preview/                        # renders, sheets, MP4, viewer
└── tools/                          # generators: pack.py, horror.py, biome.py, biome_shapes.py,
                                    # scripts/main.js, validate_packs.py, schema_check.py, previews
```

## Originality report
* **The creature:** the user's own Brinesleeper concept. Model, texture and animations were
  made for this project.
* **The mechanics:** written for this add-on. They don't copy another mod's design.
* **Common horror tropes:** the stationary predator never moves while watched, but it
  doesn't creep up on you in jump cuts. It moves at most twice, never closer than 10 blocks,
  and leaves if you approach. There are no jumpscare screens, no scripted screams in your
  face and no chase music.
* **Assets:**
  * All textures are original pixel art.
  * Sounds were synthesized for this pack or derived from the repository's own recordings
    (`assets/audio`).
  * No Mojang files are shipped. Vanilla blocks are used only by identifier.
* **Reference material:** Microsoft's Bedrock documentation, Mojang's bedrock-samples
  metadata, and [featurelab](https://github.com/stirante/featurelab)'s in-game feature
  measurements. These were used only as reference.

## Honest limits
* **The reflection effect** is a dark inverted figure placed under the water. Bedrock has no
  scriptable real reflections.
* **The Silent Water Event** only silences this add-on's sounds. Vanilla audio cannot be muted
  by a script.
* **Detecting a player's view** uses a view cone and a block raycast. Transparent blocks
  (glass, leaves) count as blocking.
* **Staging needs nearby water or floor inside the biome.** If none is found, the encounter
  is skipped quietly rather than forced.
* **The grasp's pull strength and the hunt movement speeds** are best guesses until
  play-tested.
* **Creative mode:** vanilla AI can't target players in Creative. Stalking, chases and grabs
  need Survival or Adventure.
* **Repairs change blocks:** they remove floating decorations and seal leaking lake edges with
  stone. They only touch the hall bands, and only once per chunk. Turn them off on the
  settings wheel.
* **The music is synthesized** for this pack. It is dark ambient, not orchestral.

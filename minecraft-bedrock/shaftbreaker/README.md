# The Shaftbreaker

A **Minecraft Bedrock Edition** add-on: a three-block-tall stone cave dweller that sleeps in the dark
under the mineshafts. It wakes when you come near, creeps after you, freezes when you look at it, and
attacks when you stare too long or let it get close. If it can't reach you, it tears through the rock.

It has five behaviour phases, and each one has its own animation set, matching the concept art in
`tools/reference/concept_art.jpg`: **Dormant, Stalking, Watching, Breaker, Frenzy**.

This folder is the whole add-on. It is unrelated to the CubicWorld game in the repository root.

---------------------------------------------------------------------------------------------------
## Install

You need **Minecraft Bedrock 1.26.30 or newer** (Windows, Android, iOS, Xbox, PlayStation, Switch).
The behaviour pack uses format version 1.26.30, the version where `minecraft:pushable_by_entity` and
`minecraft:pushable_by_block` became stable. No experimental toggles are needed.

1. Get `dist/Shaftbreaker.mcaddon`. To build it yourself, see [Rebuilding](#rebuilding).
2. Open it with Minecraft. On Windows, double-click it; on mobile, use *Open with → Minecraft*. You can
   also go to *Settings → Storage → Import*. Minecraft imports **The Shaftbreaker (Behavior)** and
   **The Shaftbreaker (Resources)**.
   You can also install the two packs on their own: `dist/Shaftbreaker_RP.mcpack` and `dist/Shaftbreaker_BP.mcpack`.
3. Open the world settings (or *Create New World*), go to **Behavior Packs**, and activate
   **The Shaftbreaker (Behavior)**. The resource pack is a dependency, so Minecraft adds it to
   *Resource Packs* automatically. Check that both packs are active.
4. Get a Shaftbreaker in one of these ways:
   * **Spawn egg**: in the creative inventory, under *Spawn Eggs*, use **Shaftbreaker Spawn Egg**
     (mauve stone with orange spots).
   * **Command** (cheats on): `/summon shaftbreaker:shaftbreaker`
   * **Naturally** (rare): see [Spawning](#spawning).

> The Shaftbreaker ignores players in **Creative** and **Spectator** mode, as vanilla hostile mobs do.
> Switch to **Survival** or **Adventure** (`/gamemode survival`) to watch it hunt.

---------------------------------------------------------------------------------------------------
## Behaviour

The behaviour pack stores the current phase in the client-synced entity property
`shaftbreaker:phase` (`dormant | stalking | watching | breaker | frenzy`). The resource pack plays the
matching animations from that property, with a 0.4–0.6 s cross-fade between phases.

| Phase | What it does | Leaves the phase when |
|---|---|---|
| **Dormant** | Stands unnaturally still, staring forward. It cannot move or turn, is silent, and has full knockback resistance. | A survival/adventure player comes within **24 blocks** in line of sight → **Stalking** (stony "activate" groan). |
| **Stalking** | Hunches and creeps slowly after its target (≈ 0.18 speed), quietly following through the caves. | The player **looks at it** (crosshair within ~22° for 0.35 s, line of sight required) → **Watching** (it freezes). The player gets within **5.5 blocks** → **Frenzy**. It is stuck for ~4 s → **Breaker**. It loses its target → **Dormant**. |
| **Watching** | Frozen, partly turned, head tracking you, twitching and on edge. | You **keep staring for 4–7 s** → **Frenzy**. You come within **6 blocks** → **Frenzy**. You look away (for ≥ 0.75 s) → back to **Stalking**. |
| **Breaker** | Slow, heavy shove toward the target that **tears through stone, deepslate and mineshaft blocks** (`minecraft:break_blocks`). Claw strikes throw stone debris. | After 6–10 s → **Frenzy**. It reaches you (< 3.5 blocks) → **Frenzy**. `mobGriefing` turned off → **Frenzy**. It loses its target → **Dormant**. |
| **Frenzy** | Full attack: fast sprint (≈ 0.38 speed, about Warden speed), melee lunges (9 damage) and leaps, roaring. | It is stuck (target > 4 blocks away, not moving, 2 checks in a row) → **Breaker**. Underground and target > 8 blocks away, 1-in-6 chance every 2 s → **Breaker**. Target > 24 blocks away → **Stalking**. It loses its target → **Dormant**. |

Taking damage from a player or mob in **any** phase sends it straight to **Frenzy**.
A **carved pumpkin** on your head stops it from noticing your gaze, as with an Enderman.

### Stats

| | |
|---|---|
| Health | 80 (40 hearts) |
| Attack | 9 (Bedrock scales it by difficulty) |
| Size | 0.9 × 2.9 blocks collision box. The model is ~3 blocks tall (geometry scaled by 0.58 on the client). |
| Follow range | 32 blocks (acquires targets within 24) |
| Knockback resistance | 1.0 dormant / 0.6 stalking / 0.9 watching / 1.0 breaker / 0.8 frenzy |
| Immunities | Fire and lava, suffocation (it pushes through rock), half fall damage |
| XP | 15 when killed by a player |
| Drops | 2–5 cobbled deepslate, 0–2 flint, 1–3 glowstone dust (its glowing eyes). If killed by a player: 35 % raw iron, raw gold or amethyst shards, and a 4 % chance of a diamond (looting helps). |

### Spawning

The Shaftbreaker spawns rarely (weight 3 in the monster pool, one at a time, at most one per area
underground). It needs all of the following:
* overworld cave biomes (not the Deep Dark or Mushroom Fields), on Easy difficulty or harder;
* **underground** spots with a **light level of 0** (block and sky light);
* below **y = 40**;
* standing on stone, granite, diorite, andesite, tuff, deepslate, gravel, cobblestone or oak / dark-oak planks
  (cave floors and mineshafts).

It despawns like vanilla monsters when far from every player, unless it has been named with a name tag.

### Block breaking and `mobGriefing`

The Breaker phase can break these blocks:
stone, cobblestone, mossy cobblestone, granite, diorite, andesite, tuff, deepslate, cobbled deepslate,
infested stone / cobblestone / deepslate, dripstone block, pointed dripstone, gravel, dirt, coarse dirt,
rooted dirt, clay, moss block / carpet, glow lichen, all overworld planks and wooden fences, oak / spruce /
dark-oak logs, rails, cobwebs, torches, lanterns, soul lanterns, chains and ladders.

It never breaks ores, chests, spawners, obsidian, bedrock or other built blocks.

The phase only starts when the `mobGriefing` game rule is on. To keep it out of your builds, run:

```
/gamerule mobgriefing false
```

With the rule off, the Shaftbreaker never enters the Breaker phase.

### Testing phases with commands

Every phase change is a public entity event, so you can force a phase with `/event`:

```
/event entity @e[type=shaftbreaker:shaftbreaker] shaftbreaker:become_stalking
/event entity @e[type=shaftbreaker:shaftbreaker] shaftbreaker:become_watching
/event entity @e[type=shaftbreaker:shaftbreaker] shaftbreaker:become_breaker
/event entity @e[type=shaftbreaker:shaftbreaker] shaftbreaker:become_frenzy
/event entity @e[type=shaftbreaker:shaftbreaker] shaftbreaker:become_dormant
```

Without a target it falls back to **Dormant** at once. To hold a phase, you need a survival-mode player
nearby. Use the `/event` commands to preview each phase's animations.

---------------------------------------------------------------------------------------------------
## Technical overview

```
Shaftbreaker_RP/                      resource pack (min engine 1.21.0)
  manifest.json, pack_icon.png
  entity/shaftbreaker.entity.json     client entity: material entity_emissive_alpha, scale 0.58
  models/entity/shaftbreaker.geo.json        generated by tools/build_model.py
  textures/entity/shaftbreaker.png           generated by tools/build_model.py (4x HD, alpha = glow)
  animations/shaftbreaker.*.animation.json   one file per phase group (SPEC §7)
  animation_controllers/shaftbreaker.animation_controllers.json
  render_controllers/shaftbreaker.render_controllers.json
  particles/  shaftbreaker:stone_debris (vanilla stone texture), shaftbreaker:step_dust
  sounds.json, sounds/sound_definitions.json   only vanilla sound files, re-pitched
  texts/en_US.lang, texts/languages.json
Shaftbreaker_BP/                      behavior pack (format 1.26.30, min engine 1.26.30)
  manifest.json (depends on the RP), pack_icon.png
  entities/shaftbreaker.json          five component groups + events, see table above
  spawn_rules/shaftbreaker.json, loot_tables/entities/shaftbreaker.json
  texts/en_US.lang, texts/languages.json
tools/                                build, validation, packaging, preview
```

**Animation wiring (client entity → controllers).** `scripts.animate` runs:
1. `phase_controller` (`controller.animation.shaftbreaker.phase`). It has one state per value of
   `query.property('shaftbreaker:phase')`, with `blend_transition` 0.4–0.6 s. Stalking blends
   `stalk_idle`/`stalk_walk`, Breaker blends `breaker_smash`/`breaker_walk`, and Frenzy blends
   `frenzy_idle`/`frenzy_run`, all weighted by `variable.move_blend = clamp(query.modified_move_speed * 6, 0, 1)`.
   Walk and run animations advance with `query.modified_distance_moved` (set in the animation files).
2. `look_at` (additive head and neck tracking with `query.target_x_rotation` / `query.target_y_rotation`), at
   weight `variable.look_weight`. The weight fades to 0 in Dormant, so it stares straight ahead, and to 1
   in the other phases.
3. `attack_controller` (`controller.animation.shaftbreaker.attack`). It plays the one-shot `frenzy_lunge`
   when `variable.attack_time > 0` and returns to the default state on `query.all_animations_finished`.
   While the lunge plays, `variable.lunging` is 1. Through `variable.lunge_blend` and
   `variable.base_weight`, this fades out the phase animations, so the lunge is a complete pose of its own.

Timeline effects available to animations:
* particles: `debris` → `shaftbreaker:stone_debris`, `step_dust` → `shaftbreaker:step_dust`
* sounds: `step`, `smash`, `scrape`, `screech`

**Sounds.** Every sound reuses audio that ships with Minecraft (warden, creaking, iron golem, ravager,
zoglin, ghast, deepslate, grindstone, mace), re-pitched and given its own `shaftbreaker.*` event and
subtitles. The add-on contains no audio files.

---------------------------------------------------------------------------------------------------
## Rebuilding

Run everything from `minecraft-bedrock/shaftbreaker/`.

```
python3 tools/build_model.py      # regenerate geometry + HD texture (deterministic)
node tools/validate.mjs           # schema + cross-reference validation (exit code 1 on errors)
python3 tools/package.py          # validate, then write dist/Shaftbreaker.mcaddon + the two .mcpack files
```

Set up the tooling once:

```
cd tools && npm install && cd ..  # three + ajv (validator, renderer)
```

**Validator caches.** `tools/validate.mjs` uses two caches. Both are git-ignored.
* `tools/.cache/bedrock-schemas/`: the Blockception JSON schemas
  (`git clone --depth 1 https://github.com/Blockception/Minecraft-bedrock-json-schemas tools/.cache/bedrock-schemas`).
* `tools/.cache/vanilla/{resource_pack,behavior_pack}/`: copied from Mojang's
  [bedrock-samples](https://github.com/Mojang/bedrock-samples), tag `v1.26.60.5`. The validator uses them
  to check vanilla sound files, sound event names, particles, textures and Molang queries.

If a cache is missing, the validator says so and skips only the checks that need it. The list of current
vanilla block and item IDs is committed in `tools/data/vanilla_ids.json`, taken from bedrock-samples
`metadata/vanilladata_modules`.

The validator checks the following:
* Every pack JSON against its Blockception schema (`// comments` are allowed).
* Animation and controller names, against the SPEC §7 contract.
* Bones and locators used by animations against the geometry, and timeline effect names against the
  client entity.
* Every Molang string, using `tools/lib/molang.js`. It also flags unknown `query.*` names and variables
  that are read but never assigned.
* Property names and enum values used in controllers and events, plus events and component groups.
* Block and item IDs, textures, the geometry identifier, UV bounds, and the 4× PNG density.
* That manifest UUIDs are unique and that the BP dependency matches the RP header.
* Lang keys and sound references.

Options: `--quiet`, `--strict` (warnings count as errors), `--no-schema`.

**Preview rendering.** `tools/render.mjs` renders the real pack files headlessly. It needs Playwright
with Chromium; `ffmpeg` is also needed for video. For example:

```
node tools/render.mjs views   --anim none --views front,threequarter,right,back --out tools/_scratch/rest.png
node tools/render.mjs strip   --anim animation.shaftbreaker.frenzy_run --frames 8 --view right --out tools/_scratch/run.png
node tools/render.mjs compare --anim animation.shaftbreaker.watch --t 1.0 --ref watch_full.png --azimuth -35 --out tools/_scratch/c.png
node tools/render.mjs video   --plan tools/preview_plan.json --out preview/shaftbreaker_preview.mp4
```

`tools/blockbench.mjs` loads the same files into the real Blockbench editor (web version, so it needs
network access). It can export an editable `.bbmodel`, or take screenshots and recordings to cross-check
the result.

`SPEC.md` is the single source of truth for coordinates, rig, scale, texture density, materials,
identifiers and animation names.

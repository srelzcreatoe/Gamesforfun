# Known limitations and outstanding polish

Honest list, ordered by impact. Nothing here requires experiments to fix.

## Not yet verified in a game client

* **No Minecraft client was available.** Rendering, client animation controllers, Molang
  evaluation, sound playback, forms, the field guide item, captions and camera shake have
  only been checked statically (validator, renders from the repo's own evaluator) — not
  seen in game. The behavior pack, scripts and server-side gameplay were exercised on
  Bedrock Dedicated Server 1.26.61.1 with a scripted stand-in player
  ([TESTING.md](TESTING.md)). First in-client session should follow the manual plan there.
* **No real players / devices / playtesters yet.** No frame rates, mobile performance,
  multiplayer sight-line behaviour or scare ratings have been measured. Server-side script
  cost was measured on BDS only (≈ 1.6 ms per decision tick for three encounters on a
  2.1 GHz Xeon).
* The repo's preview renderer approximates Bedrock's transform conventions (Blockbench
  codec: X mirrored, Euler Z·Y·X). Side-face texture orientation and any rotation-order
  edge cases may differ slightly in game.

## Design limitations (deliberate, documented)

* **1 × 1 passages are not followed.** The collision crawl profile is 1.8 high; no pose
  of this rig fits one block (torso + mane ≈ 1.1 blocks thick at 1.5×). Two-block-high
  tunnels, including one-wide ones, are followed (verified in BDS). One-high gaps are
  therefore a learnable escape route.
* **Limb clipping in one-wide tunnels.** Collision is 0.9 wide, but the flattened crawl's
  elbows and knees span ≈ 3.4 blocks; in a one-wide tunnel the limbs pass into the walls
  (hidden from the player inside the tunnel, visible from outside).
* **No wall climbing, leaping or pounce.** The supplied `climb` and `pounce` clips have no
  collision-aware stable movement behind them; adding them would risk unfair or broken
  pursuit. Essential pursuit does not need them.
* **Doors:** wooden doors only (engine door annotation); trapdoors, gates and iron doors
  stop it. Hosts can disable door opening.
* **Block solidity heuristic.** The stable API has no `isSolid`; walkable space uses an
  explicit passable-block list (`mc/terrain.js`). Exotic or future blocks may be
  misclassified for spawn/spot finding (navigation itself is the engine's).
* **Observation spots** are chosen from 10 sampled candidates per reposition; in very open
  or very cramped caves it may hold still longer than ideal (it never moves into plain sight).
* **Night woodland encounters** reuse the cave logic with a biome check; spawning still
  requires light ≤ 7, so they mostly occur under dense canopy. Off by default, less tested.
* **Manual spawns** (egg, `/summon`) may target Creative players for showcases; damage
  does not apply to them.
* **Camera shake** (optional "Full" effect) is issued with the `camerashake` command from
  script and is wrapped so that, if a world or platform rejects it, the effect simply does
  not happen; it was not observed in a client.
* **Peaceful** removes every Tailwail, including ones placed with a spawn egg.
* **Health/toughness** is a damage divisor (stable API cannot change max health at runtime).
* **Memory** is lost for a player who disconnects mid-encounter (it is saved at the end of
  an encounter, which cannot write to an offline player).
* **Field-guide hand-out** happens once per player on first join if a slot is free;
  otherwise use the recipe or `/tailwail:guide`.

## Outstanding polish

1. **Audio:** the synthesised palette is functional and original but should get a sound
   designer's pass (recorded/processed vocal layers for the wail and snarl, more breath
   variants, proper room tone) after listening tests on headphones and phone speakers.
2. **In-client animation review:** blend times, the tunnel crawl and unfold poses, mimic
   overlay amplitudes and head-tracking smoothing need tuning by eye in game.
3. **Playtests** with the rubric in [TESTING.md](TESTING.md) to tune agitation rates,
   pursuit budget, chase speed and cooldowns (current values come from design reasoning and
   BDS timing runs, not from player data).
4. **Mane profiling:** 183 of 268 cubes are mane strands. Do not simplify without device
   profiling; if mobile frame cost proves high, merge strand pairs symmetric about the
   neck first (preserves the silhouette).
5. **Localization:** only `en_US` text exists.
6. Optional future features once verified: physics-backed lunge using the supplied
   `lunge`/`pounce` clips with a valid landing check and a telegraph.

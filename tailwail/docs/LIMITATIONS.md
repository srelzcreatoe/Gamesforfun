# Known limitations

## Not verified in a real game client

- **No client test has been done.** Everything visual and audible was verified offline:
  - the controller and Molang simulator (including the "pre-animation script never runs"
    failure mode) plus grounding checks of every state and one-shot;
  - software renders of the composite poses;
  - spectrogram and loudness review of every sound;
  - Mojang Creator Tools schema validation.

  Gameplay was verified on a dedicated server with a stand-in player (an armor stand that
  records every player-only call). Things that can only be judged in a client:
  - whether the animations read as frightening at game distances and lighting (v1 and v2
    were reported as "not animating"; v3 rebuilt the client so that a failure of the
    property/variable pipeline still leaves it idling, walking, galloping and breathing,
    and it plays attacks through `Entity.playAnimation`, but this has not been seen on a
    screen);
  - the actual loudness of each sound against vanilla;
  - how strong the fog, FOV and shake feel; music looping;
  - whether teleport-every-tick during the climb looks smooth or jittery;
  - how the squeeze (the whole body scaled flat) looks in a real 1-block gap.
- **A stale resource pack** (an older copy applied to the world) makes the creature look
  frozen and its new sounds silent. v3 cannot fix that from the behavior pack, but it
  *reports* it: the join message is a translation key only the 3.x resource pack defines.
  Also `/tailwail:debug anim` plays every clip on a harmless copy.
- **Nobody has listened to the sounds** on speakers or headphones. They were designed and
  checked numerically and normalised to loudness targets.
- **Camera FOV reset** uses `/camera @s fov_clear` (documented syntax; it parses on BDS)
  because the script API does not document how to clear a scripted FOV. If it ever fails
  on a client, players can set Camera effects to *Reduced* (no FOV changes), or run
  `/tailwail:debug restore`.

## Behaviour

- It is **faster than a sprinting player** on every preset: the Cave Dweller's chase speed,
  7.8 blocks/s (Custom can change it). The value comes from Gargin's mod as found in a
  public port of its code (movement speed 0.5 × chase modifier 0.85); it was not measured
  in the original mod. In open terrain it will catch you; escaping means breaking line of
  sight, sealing gaps behind you, or hiding in the dark. Calm is the gentler preset (less
  damage, slower escalation), not a slower creature.
- **Aggressive moves** are detected from projectiles a player shoots or throws: the flight
  line one tick after launch (a straight line, so a long, high lob can be missed), where
  it lands, and direct hits. Drawing a bow or swinging at the air does not count. A real
  player's arrow has not been tested (BDS has no players); the aim test ran on BDS with a
  stand-in arrow, and a real ownerless arrow was correctly ignored.
- **Squeezing.** It fits 1-high gaps (collision 0.9 high), but its model is still wider than
  one block: limbs clip into the walls, and attacks made while squeezed play over the
  flattened body. It chooses the squeeze from the headroom along the straight line to its
  goal, so a low overhang on that line can make it flatten for a moment where it did not
  need to. Gaps narrower than one block, or entered through a partial block, may still
  stop it; then it searches.
- The "on screen" test uses a generous ~72° cone with line of sight to three body points.
- It never appears where you are looking: a spawn site is rejected if any point of it is
  within about 78° of a player's view direction with a clear line. It must also be dark
  (light 7 or less) and at least 14 blocks from every player. On open flat ground at night
  this usually puts it 20-30 blocks **behind you, in the open** (verified on BDS: 27 blocks
  away at light 4), so turning around can show it standing there.
- Navigation is the engine's own pathfinder toward an invisible lure. Complex terrain can
  still cost it time: stuck detection, sidestep recovery, climbing, door smashing and a
  give-up into search exist, but caves with drops, scaffolding or water may look clumsy.
- **Climbing** needs a solid face toward you and an open column to climb in; it climbs
  straight up the face (teleported 3.2 blocks/s with gravity off) and steps onto the top.
  Overhangs or a blocked column make it give up and search instead.
- **Breaking blocks** is limited to wooden doors, trapdoors, fence gates and (setting)
  glass that is directly between it and the player it hunts. Iron doors are never broken.
  Nothing else is griefed. Broken blocks drop as items.
- The pounce is a physics impulse; on slopes or into low ceilings it can fall short.
- Hiding is based on block light at your head and crouching. Dynamic light from a held
  torch does not exist in Bedrock, so holding a torch does not give you away by itself.
- Presence events and ambushes pick positions from loaded terrain with bounded searches.
  In very open or very cramped places some are skipped (the knock and scrape need a wall;
  the peek needs a corner; the ceiling needs 5-10 blocks of air under a ceiling; the
  window needs glass in front of you).
- The grab and its mash struggle are parked: the code is kept and unit-tested, but it never
  happens in game.

## Content and performance

- **One creature.** Depth over breadth: there is no roster of dwellers.
- No custom structures, biomes or lore buildings.
- Decision-tick cost was measured only on BDS (2.95 ms average for three encounters at
  10 decisions per second, on a development container CPU). Client rendering cost of the
  268-cube model with a body clip, a one-shot and up to 13 overlay layers has not been
  profiled. The 183-cube mane was not simplified.
- Sounds are mono, 44.1 kHz Ogg Vorbis (~3 MB total). Music streams.

## Compatibility

- Needs Bedrock 1.26.60+ (stable script modules 2.11.0 / 2.3.0). On older clients the packs
  will not load.
- Other add-ons that also use `player.playMusic`, fog stacks or input permissions can
  interfere during an encounter. Tailwail only removes fog entries carrying its own tag.

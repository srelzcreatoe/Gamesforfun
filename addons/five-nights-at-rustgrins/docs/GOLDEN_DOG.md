# The Golden Dog and the cellar (1.1.0)

This is the design and the contract for the 1.1.0 update. Four pieces of work are built against it at the
same time, so the names, numbers and file ownership below are fixed. The data half of the contract is
`packs/BP/scripts/data/cellar.js`; read it together with this file.

Reference picture for the model: `assets/reference/golden_dog.webp`.

## Who he is

Before Rustgrin's Pizza Revue opened in 1984 there was another place on this lot: a supper theatre, long
closed, whose mascot was a big golden dog in a top hat and a red tailcoat. The Revue was built on top of
it. The old theatre's main room is still down there under the Dining Hall (the **Gold Room**), with its
little stage, and he is still standing on it. Nobody listed him for the auction. Nobody goes down there.

He is the oldest thing in the building and the biggest: about **3.5 blocks** tall where the rest of the
cast is 3. The others are afraid of him. The Ringmaster, who talks about everything, will not talk about
the cellar until he has to.

He is this game's own take on the "golden one" of the genre, and he is **not** a copy of anybody else's:
he does not slump in the office as a hallucination (the Rusted one already does that here), and he does
not walk the halls. He never comes up the stairs. He does not need to. **He bends the place**: what the
clock says, what the cameras show, which hand is which, and in the end where the office is.

One rule holds for everything he does, and the player can learn it:

> **Never look at the Golden Dog.** He does not like to be seen.

In-game name: **the Golden Dog**. Ids: cast id `golden_dog`, entity `fnar:golden_dog`.

## The model (owner: models)

From the reference picture:

- Head: wide, rounded, golden-brown; a tan muzzle with a black nose and a wide grin of square teeth; deep
  black eye sockets with small pale pupils; thin black rods with beads at the corners of the mouth; long
  floppy ears hanging from the sides of the head, darker and redder than the body.
- A small dark top hat with a maroon band and a brass buckle.
- A black bow tie; a maroon tailcoat-vest with dark lapels and gold piping; a tan belly panel with two
  black buttons; a brass paw-print badge; a pocket-watch chain at one pocket.
- Segmented limbs with black ball joints at the shoulders, elbows, wrists, knees and ankles; brass cuffs
  at the wrists; big hands with jointed fingers and dark fingertips; big rounded paws with toes; a curled
  tail.
- The fur is "rusty gold": orange-brown, mottled in two or three tones with darker worn patches.

Requirements:

- Same rig as the other six (`assets/source_models/README.txt`: root > waist > torso > head > jaw / hat /
  ears, arms with forearm / hand / fingers / thumb, legs with shin / foot, tail_1..n) so every animation
  name the game uses exists: the eight source animations (idle, perform_1, perform_2, walk, run,
  jumpscare, pose_1, pose_2) plus the generated ones (crawl, peek, look, stoop, lean, wave, bow).
  A fourth finger is welcome if the hand checks still pass.
- Delivered the same way as the other models: a source pack `assets/source_models/Golden_Dog_RP/` in the
  same layout, built by a generator script under `tools/entities/`, and picked up by
  `tools/entities/build_entities.py` (which today writes a server-side placeholder for him; remove it).
- **Bigger than the rest by a bit:** he stands about 3.5 blocks tall in game (the others 2.9 to 3.0) and
  is broader. This needs a per-model render scale and collision box in `build_entities.py`.
- The same texture layers as the others: body, `_eyes` (glowing pupils), `_mer`, texture set, and the
  hollow-eyed look (`_hollow`, `_pinprick`).
- How he moves: slow, heavy, deliberate. He barely moves when idle: a head tilt like a dog listening.
  `pose_2` (the game's `slump`) is him powered down on his stage, chin on his chest.
- The hand-back must report his measured standing eye height, jumpscare eye height and total height in
  blocks (the game keeps these in `mc/game.js` and `mc/puppets.js`).

## The cellar (owner: cellar)

Local coordinates as in `data/layout.js`. Down here you stand at **y = -7** (floor blocks y = -8); rooms
are 5 tall (air y -7..-3, ceiling y = -2); the pizzeria's own floor (y = -1) lies on top. The lot is dug
and filled down to y = -9.

Fixed by `data/cellar.js` (the game reads these by name, so the numbers there are the truth):

| | Interior box [x1, z1, x2, z2] | What it is |
|---|---|---|
| `GOLD_ROOM` | 26, 16, 46, 38 | the old supper theatre: a little stage at its north end, his spot `CEL_STAGE` (36.5, -7, 18.5) facing south |
| `LONG_HALL` | 35, 40, 37, 59 | three wide, from the Gold Room's south doorway (z 39) straight south |
| `OTHER_OFFICE` | 32, 60, 40, 70 | the security office again, cell for cell, 7 blocks below the real one, but decades older |

- **The Other Office** is the real office moved by (0, -7, 0): the same walls, desk, seat, windows and
  door openings in the same cells, in old, rotten finishes. Differences that matter:
  - there is **no wall behind its desk**: the opening `desk_gap` (x 35..37, y -7..-3, z 59) is the mouth
    of the Long Hall, so from the seat (36.5, -7, 63.5, facing north) you look over the desk, down the
    hall, across the Gold Room and straight at the stage, 45 blocks away;
  - nothing on or above the desk blocks that view (no monitor wall on the desk in the middle);
  - the desk phone is in the same cell as upstairs (+ offset) and is a real `fnar:desk_phone`
    (the game uses it as the way back);
  - its controls do nothing: the door and light buttons are dead props (not the clickable control blocks).
- **The aisle** x 35..37 from the stage (z 19) to the desk (z 59) stays clear of everything, floor to
  ceiling: it is the line he walks (`CELLAR.walk`) and the line the guard sees him on.
- **CAM 11 · THE CELLAR** (`data/cameras.js`) looks at the stage from the Gold Room's south-east. It gets a
  camera prop like the others. It must see `CEL_STAGE` and `CEL_PIT`.
- **Stairs** from Parts & Service (the west half of its middle aisle, x 49..56, z 65..67, is reserved for
  the stairwell) down to a landing, with a way from the landing to the Gold Room and to the Other
  Office's right door. The rest of the cellar (a boiler room, old props and signs of the supper theatre,
  whatever makes the place) is free, as long as it stays under the building and out of the fixed boxes.
- By day (Free Roam) the cellar door is open and the player can walk the whole cellar. Guests never go
  down. At night the guard cannot leave the office anyway.
- **Depth.** The lot now reaches 9 blocks below the origin. In a world where there is no room for that
  under the player (a flat world: 4 layers), the origin is raised so the whole lot sits higher, both for a
  first build and when an existing world is rebuilt for this version.
- **Gilding** (`CELLAR.gild`): a list of cells upstairs with alternate blocks that the game shows for a
  moment while he bends the place: his show poster where a Revue poster hangs in the office, a child's
  drawing of a big yellow dog, paw prints on a hall floor. The map provides the cells and the blocks; the
  game only swaps them in and puts back what was there.
- When the cellar is really built, set `CELLAR_BUILT = true` (the map validator then checks its camera,
  nodes, the clear aisle and the sight line from the seat to the stage).

## What he does at night (owner: gameplay)

All of it is in the pure core (`core/ai/golden_dog.js`, driven by the session like the rest of the cast, with
effects for the Minecraft layer to render in `mc/golden.js`) so the simulations and the bots can play it.
Like every trick in this game, **each shift gives itself away before it can hurt**, and has an answer.

- **His tell** is a pocket watch: a loud ticking that speeds up for about 2.5 seconds before every shift,
  with a caption. Nothing else in the building ticks.
- **While he is at work the rest of the cast holds still.** They are afraid of him too. (This is what makes
  looking at the floor fair: nothing else moves on you while you do.) The halls go silent; only the watch.
- CAM 11 shows him on his stage. Through the week he changes: slumped on night 1, head up on night 2,
  standing from night 3. **Watching CAM 11 is looking at him**: a few seconds at a time is safe, but stare
  and he turns to the lens, and his next shift comes sooner. An empty stage on CAM 11 means he is at work.

The shifts, mildest first:

| Shift | From | What happens | The answer |
|---|---|---|---|
| **Gilding** | night 2 | cosmetic: for a few seconds a poster, a drawing or a hall floor is his | none needed |
| **False dawn** | night 3 | the clock jumps to 6 AM, the chime plays off-key, the 6 AM card starts, and tears away: it is still night | nothing was real; the watch ticked first, and the real 6 AM never ticks |
| **Wrong feed** | night 3 | on the monitor, every camera you pick shows the cellar's empty stage | lower the monitor; picking three cameras in a row brings him up (a visit) |
| **Mirror** | night 4 | for about 10 seconds left is right: the left buttons work the right door, light and vent, and the other way round | use the other hand, or wait it out |
| **The visit** | night 4 | he is standing in the office **behind you** (`OFF_GOLD`), breathing. About 7 seconds | do not turn around; do not raise the monitor (it shows only his face). Keep your eyes forward or on the floor. Look at him for more than about a second and a half in total and he takes you |
| **The Other Office** | night 5, once | the lamp stutters and you are sitting in the Other Office. He is on his stage, far down the hall, and **he walks while you watch him** | look down at the desk. The phone rings: pick it up and you are back upstairs. Watch him all the way to the desk and he takes you |

- "Looking at him" is decided by the Minecraft layer from the player's view direction and handed to the
  session as a boolean each tick; the bots model it (a good guard looks away after the tell).
- During the visit and the Other Office the night's clock keeps running but the cast is held, so each one
  costs a little power instead ("the lights dim while he is in the room").
- He is off on the training night and in the Final Act. Custom Night gets a seventh slider for him.
  The week's memory (`core/ai/memory.js`) does not track him.
- The week's balance targets do not move: a good guard still wins nights 1-5 every time, an average one
  about 86 / 74 / 61 / 49 % on nights 2-5 (plus or minus 8).

By day (Free Roam) he stands on his stage in the Gold Room. He does not talk. His head follows you, and
if you look away and back he is not quite as he was.

## Who owns which files

So the four pieces of work merge cleanly, each keeps to its own files. Anything not listed: ask in the
hand-back instead of editing.

| Work | Owns |
|---|---|
| **Models** | `tools/entities/**`, `assets/source_models/Golden_Dog_RP/**`, `assets/portraits/**`, the generated entity files under `packs/RP` (models, textures/entity, animations, animation_controllers, entity, render_controllers), `packs/BP/entities/**`, `packs/BP/scripts/data/head_aim.js` (generated), `tools/render/portraits.mjs` |
| **Cellar** | `packs/BP/scripts/data/cellar.js`, a new `data/cellar_plan.js` (called from `build_plan.js` with one line), the CAM 11 entry in `cameras.js`, the cellar nodes in `nodes.js`, `LOT.baseY` and the Parts & Service room, `mc/builder.js` (BUILD_VERSION, the depth guard) and the origin choice in `mc/game.js` `setup`, new block modules under `tools/blocks/**`, a `// ---- cellar` section at the end of `data/palette.js`, CAM 11 on the camera map (`tools/ui/gen_ui.py`), cellar checks in `tools/map/validate_map.mjs`, preview scenes named `60_`..`69_`, a marked cellar section in `tools/mock/run_game.mjs` |
| **Pizzeria rework** | everything above ground in `data/build_plan.js`, `data/layout.js` rooms, existing nodes / cameras / guests data when a room changes, coordinates in `mc/nightset.js`, `mc/dread.js`, `mc/lean.js`, new block modules under `tools/blocks/**`, a `// ---- rework` section at the end of `data/palette.js`, the existing preview scenes, existing mock checks tied to coordinates. **Not** the office (its box, seat, desk, controls: the Other Office copies it), **not** Parts & Service, nothing below y = -1, not BUILD_VERSION |
| **Gameplay** | `core/ai/golden_dog.js`, `mc/golden.js`, their hooks in `core/session.js`, `core/config.js`, `mc/game.js`, `mc/puppets.js`, `mc/camera_view.js`, `mc/ui.js`, `mc/hud.js`, `data/story.js`, `tools/sounds/**`, `tools/sim/**`, a marked Golden Dog section in `tools/mock/run_game.mjs`. Reads `data/cellar.js`, `cameras.js`, `nodes.js` by name and never edits them |

# FIVE NIGHTS AT RUSTGRIN'S — design document

An original FNAF-style horror add-on for Minecraft Bedrock (target 1.26.50+,
`@minecraft/server` 2.10.0, `@minecraft/server-ui` 2.2.0). Namespace: `fnar`.
Not affiliated with Scott Cawthon or Mojang.

## 1. Look and feel

Two references drive every visual decision:

* **FNAF 1 Remake** — the classic FNAF 1 pizzeria plan and mechanics (office
  with two steel shutter doors, hall lights, a CRT camera monitor, a power
  meter, 12 AM – 6 AM), rebuilt with modern detail: glossy black-and-white
  checker floors that catch the light, checker wainscot bands on the walls,
  drop ceilings with buzzing fluorescent panels, posters, kids' drawings,
  party tables with hats, a curtained side stage, deep shadows.
* **"Soulless" look** — the place is dying. Everything is worn, grimy and
  desaturated: water stains, peeling paint, cracked tiles, dead bulbs,
  flickering tubes, dust. Light is scarce and pools; most of the building is
  black. The animatronics look tired and hollow-eyed, their eyes glow.

Textures are **vanilla-like**: 16×16 pixel art per block face (posters use
several 16×16 tiles), the same limited palettes, soft noise and 1-px details as
Mojang's own blocks. Most of the building is made from real vanilla blocks;
custom blocks only exist where vanilla has nothing suitable.

**Vibrant Visuals:** the resource pack declares the `pbr` capability. Every
custom texture ships a texture set (color + MER + heightmap): glossy tiles
(low roughness), metal doors/vents (metalness), emissive lamp panels, monitor
screens, EXIT signs and animatronic eyes. Lamps are VV point lights
(`local_lighting/local_lighting.json`). A custom fog adds a thin volumetric
haze inside the pizzeria so light shafts show. Classic (non-VV) rendering must
look good too: lit blocks use `minecraft:light_emission`.

Palette guide (approx.):
* tiles: off-white `#cfcac0`, black `#1b1b1e`, grout `#5a5650`, grime `#4b4234`
* walls: blue-grey plaster `#5d6670`, dark trim `#2a2d33`, accent red `#7a1f1f`
* dining/stage: maroon `#5a1c22`, gold trim `#b08a2e`, stage wood (dark oak)
* the Grand Marquee, the Ringmaster's stage (once Kitty's Cabaret): purple velvet `#3e1f4f`, gold stars `#d4a93c`, crimson marquee board
* Midway (circus): red `#8e1d1d` / cream `#d8cfb5` stripes
* light colors: fluorescent `#dfe8ff`, warm bulb `#ffc98a`, EXIT green `#3cff6e`

## 2. Story (original)

**Rustgrin's Pizza Revue** opened on Route 6 in 1984 with the *Rusty Revue*
band: **Rustgrin** the bear (lead singer), **Mirehop** the rabbit (guitar) and
**Noxbriar**, the band's lady bear (backup vocals). In 1986 Aurelio Marvello, owner of the
travelling *Midnight Midway*, vanished during a matinee; his animatronic
**Ringmaster** kept the show running for three days to an empty tent. In 1987
the pizzeria bought the troupe: the Ringmaster, the nervous **Purple Rat**
(maracas) and **the Cat** (dancer). The Cat and the Purple Rat share the
Midway ring; after the show "would not stop" in 1990, the Ringmaster was moved
into the old Kitty's Cabaret, renamed the Grand Marquee: his own stage.

The player is the night guard for the pizzeria's last week (November 1991). The
Ringmaster replaced the day manager on the office line: he calls every night,
calls the guard by name, teaches the job, and grows more possessive of "his"
show as the auction of lots one through six approaches. Hanging up on him is
remembered the next night.

Night 5 at 4 AM: a fake *6 AM / thank you for playing* screen, torn apart by
the Ringmaster; CAM 1C shows his stage empty; **Night 6 - The Final Act**
begins at once. Its three acts are his show (see section 3). Endings: *The
Final Act* (first clear), *Encore* (replays), *Showstopper* (Custom Night at
all 20s).

Newspaper clippings (one per night survived) tell the history, from the grand
opening to the cancelled auction and a ticket stub reading ADMIT ONE - ENCORE.
No gore: dread, implication, and things that should not move. All writing is
original and lives in `packs/BP/scripts/data/story.js`.

## 3. Cast and mechanics

All six use FNAF-style **AI levels 0–20**: every movement opportunity rolls
1–20; the animatronic acts when `AI >= roll`. Levels rise at 2, 3 and 4 AM on
nights 2+.

| Animatronic | Role | Threat | Counter | Tells |
|---|---|---|---|---|
| **Mirehop** (green rabbit) | guitarist | LEFT door | hall light + LEFT door | guitar string twangs at the left door; cameras glitch when he moves |
| **Noxbriar** (black bear) | backup vocals | RIGHT door | hall light + RIGHT door | almost invisible in dark rooms on camera — only her eyes glow; soft humming at the right window |
| **Rustgrin** (grey bear) | lead singer | RIGHT door, late nights | watch him on camera (he only moves unseen); shut RIGHT door when he is in the E. Hall Corner — he is never visible by the hall light | mic feedback squeal when he moves; at power-out he plays his song at the left doorway |
| **Cat** (maroon cat) | dancer, Midway ring | sprints down a hall | keep the **show tape** on CAM 8 playing (PLAY SHOW); she dances while it plays, advances while unwatched when it slows, leaves the ring when it stops; shut the door she runs at | stages: dancing, staring at the camera, off the ring, gone; collar-bell jingle from the hall she takes; a shut door makes her bang (power drain grows each time) |
| **Purple Rat** | maracas, Midway ring | ceiling VENTS (left/right) | listen for maracas in the ducts, watch CAM 9/10, close that VENT COVER while he is at the vent | maraca rattle from the duct side, louder as he nears; bolder when the tape slows (+3) or stops (+7); twitchy — he can reverse direction |
| **The Ringmaster** (Top-Hat Rat) | host, the Grand Marquee on CAM 1C | night 6 and the Custom Night | nights 1-5: never moves (only glimpsed peering through his curtains); night 6: obey his acts, and SPOTLIGHT him from a camera that sees him | the PA chime before every announcement; his cane on the tiles |

**The Final Act (night 6).** Only the Ringmaster thinks; the others move on
his cue. Act I (12-2 AM) *Meet the Performers*: one performer at a time is sent
to a door or vent with a 10-second warning (the HUD shows who and where; the Cat
and the Purple Rat pick a side you must hear). Act II (2-4 AM) *Audience
Participation*: Simon-says games against a 10-second timer (touch nothing, show
CAM X, find him on CAM 1C, close both doors then open them, light a hall, seal
both vents); a failed game sends a performer at once. Act III (4-6 AM) *The
Ringmaster*: he walks to the office and doors do not stop him; a SPOTLIGHT from
a camera that sees him drives him back one spot (3 % power; a miss costs 1.5 %).
In the Custom Night his AI level sets his walking pace and a SPOTLIGHT sends
him all the way back to his booth.

**Power:** 100 % at 12 AM. Usage bars (1–6): base + each closed door + each
lit hall light + monitor up + each closed vent cover. When power hits 0 every
door opens, lights die, and Rustgrin performs at the left doorway; survive
until 6 AM or be caught.

**Nights** (AI at 12 AM): see `tools/sim` for balance.

| Night | Mirehop | Noxbriar | Rustgrin | Cat | Purple Rat | Top-Hat Rat | New |
|---|---|---|---|---|---|---|---|
| 1 | 3 | 2 | 0 | 0 | 0 | booth | doors, lights, cams, power |
| 2 | 4 | 3 | 0 | 2 | 0 | booth | the Midway ring and its show tape; Mirehop's knock |
| 3 | 6 | 5 | 1 | 5 | 4 | booth, "places!" | vents, Purple Rat, Rustgrin; the thrown voice, the tape deck, playing dead |
| 4 | 9 | 9 | 3 | 7 | 7 | booth, "places!" | everyone restless, the Rusted one; the burnt feed, the racket |
| 5 | 17 | 17 | 8 | 14 | 14 | booth, "places!" | until 4 AM: the takeover; trading places |
| 6 | cue | cue | cue | cue | cue | 20 | The Final Act |
| 7 | custom | custom | custom | custom | custom | custom | Custom Night (0–20 sliders, presets) |

Stars on the time clock: the end of night 5 (the takeover), the Final Act,
Custom Night "20/20/20/20/20/20".

**How they think** (`scripts/core/ai/`, all pure and deterministic; checked by
`tools/sim/ai_checks.mjs`). They notice what the guard does tonight
(`guard_model.js`: light rhythm, camped doors, watched cameras, monitor up), plan
their way over the route graph (`graph.js`) and are kept fair by the director
(`director.js`: one animatronic per way in, strikes spaced apart, a breather after
a close call, less pressure when power runs short). On top of that:

*Memory across the week* (`memory.js`, `save.memory`). When a night of the week
(1-5) ends, a summary of it is folded into a few clamped numbers in the save: the
share of the night each door and each vent was shut, light checks per hour for
each hall, the share of the night the monitor was up, and how the guard was caught
last time (who, which door or vent) with the deaths in a row. Each new night
counts as much as everything before it together, a night cut short counts for
less, and tonight's beliefs fade to nothing by 3 AM. Night 1 (and so a New Game,
and a fresh save) starts blank; the Final Act, the Custom Night, the challenges and
the Encore neither read nor write it. The next night opens with the stalker on the
neglected side heading straight for its door while the other holds back; the
Purple Rat and the Cat lean towards the neglected vent or hall; the Ringmaster
hints at it in his call (`story.js` `MEMORY_CALLS`). A death never makes the retry
harder: the director takes a step off per death in a row, and whoever caught the
guard comes back first, by the same way, announced by its own sound (the `grudge`
cue).

*One signature trick each*, never on the training night or in the Final Act, each
with a tell and a counter:

| Who | Trick | Tell | Counter |
|---|---|---|---|
| Rustgrin | **the burnt feed**: stared at too long in all, he burns out the camera he is watched on; a dead feed does not hold him, not even in the nook | feedback squeal through the monitor 2.5 s before | look away when it squeals; the right door for the nook |
| Mirehop | **the knock**: at the corner with no good moment in sight he raps on the wall; when the guard's light goes off again he steps into the doorway | three quick knocks, no twang, nobody in the light | look again a few seconds later (or CAM 2B); the twang and the grace still come first |
| Noxbriar | **the thrown voice**: a hum from the wrong hall; if the guard lights that hall she steps up to her window | a hum too clear and too close | check her side instead, twice |
| Purple Rat | **playing dead**: a move won under the duct camera is held back, then spent as a bolt of up to two sections | the maracas stop dead; a frantic rattle when he bolts | keep the camera on him until he squeaks; seal the vent at the rattle |
| The Cat | **the tape deck**: CAM 8 ignored for long, she slips behind the curtain and pulls the tape (it runs down 2.2x as fast) | the show music warbles; CAM 8 shows the ring without her | PLAY SHOW on CAM 8 puts her back at once |
| The Ringmaster | **"places!"** (booth, from night 3): once a night he calls two of the band back to the stage and sends them out together | two cane raps and his voice over the PA, twice | they only step off the stage unwatched: keep CAM 1A on them; then expect both halls, never at the same moment |

*Group tactics* from night 4: **the racket** (pots crash in the kitchen, audio-only
CAM 6, made by one stalker on its way past to cover the other one's footsteps down
its hall and its step up to the door) and, on night 5 and hard custom nights,
**trading places** (Mirehop and Noxbriar swap halls for one trip: a twang and a
hum together, far off; every tell at a door carries the side it really comes from).

*Signs of life* (`liveliness.js`): sparse cosmetic `idle` effects (a head tilt, a
pose for a while, a shuffle out and back while nobody watches) on a random stream
of their own, so the night is the same night with or without them.

Unique extras: hallucination flashes (posters that change, the Ringmaster's
face over the monitor, "SHOWTIME" text), animatronics turning their heads to
the camera when watched, a rare *Rusted Rustgrin* sighting, Free Roam daytime
mode with the band performing and the pizzeria full of guests, an Animatronic
Gallery, clippings board, accessibility remote and captions.

### Free Roam by day: the guests

By day the pizzeria is open and people are in it (`mc/guests.js`, data in
`data/guests.js`): 14 to 20 at a time, in small groups (a parent with a child or
two, couples, teenagers). A group appears across the street or at the far end of
the front walk, where no player is looking, walks in through the front doors (the
bell over them rings), stops at the hand-stamp podium, and then goes round a few
stops of its own: a table in the Dining Hall (they sit, eat, talk), the arcade
cabinets and the skee-ball lanes, the Prize Corner's counter, the edge of the
ball pit, the front of the stage. After a few minutes it walks out to the street
and is gone; new groups keep coming while there is room. When a show is announced
the ones who are wandering head for the Dining Hall; during the show everyone
there watches the stage (seated guests turn on their chairs, the others stand in
front, children in the first row, never in the middle aisle the band looks down)
and they clap and cheer, loudest at the bow. They glance at a player who comes
close, and some wave; a walking guest waits a moment for a player in its way.

Between shows one of the band (Rustgrin, Mirehop or Noxbriar) steps off the
stage, walks down the middle aisle among the tables, turns to the nearest child
and waves, and is back on its mark well before the next show is announced. The
guests near it turn to watch, a child waves back, the ones walking let it pass.

At closing time (the Time Card) the murmur dies with the music, everyone stops
and looks at the stage, then every group gets up and leaves through the front
doors: each grown-up takes a child or two by the hand, and they run once the
lights start going out. Every room goes dark in turn, the Entrance Hall last, at
the moment the last child stops in the doorway and looks back at the stage. The
night does not start until it has gone too. Guests exist only in Free Roam and
during closing time: the lobby, a night, a rebuild and a script reload remove
them (by type and tag).

* **Entity** `fnar:guest` (built by `tools/entities/build_guest.py`, nothing
  borrowed): a humanoid geometry of our own with elbows and knees; 24 painted
  64 x 64 skins (16 adults and teenagers, 8 children; `previews/guest_skins.png`)
  picked by `fnar:skin` through a render-controller texture array; `fnar:size`
  (percent of adult height: the root bone scales, a child's head a little less);
  `fnar:anim` (idle, walk, hurry, clap, cheer, wave, point, play, talk, sit, eat,
  sit_clap, sit_talk, sit_wave, sit_cheer: all looping Molang animations, offset
  per guest so a crowd is never in step); `fnar:hold` (a hand held out, for
  walking hand in hand); `fnar:look_yaw` / `fnar:look_pitch` (head turn, like the
  animatronics'). No gravity, no collision, no damage, not pushable, persistent:
  it is moved by teleport, like the animatronics.
* **Walkways**: a graph of waypoints with a half-width at each one. A guest keeps
  a lane of its own, right of the middle, so a crowd is never a parade and people
  going opposite ways pass each other. Seats and arcade cabinets are found in the
  build plan; each has the spot where a guest steps off the walkway.
  `tools/map/validate_guests.mjs` (run by the build) clears every corridor, every
  step and every slide onto a seat in the built voxel model, from the feet to the
  top of the head: no guest walks through a table, a wall, a rope or a closed door
  leaf. `--plot out.png` draws the whole map.
* **The front doors**: the facade's plinth runs across the doorway at foot level
  in the build plan, so the two open leaves are opened down to the floor while
  guests are about (two blocks, `DAY_OPEN`) and put back as built for the night.
* **Cost**: only walking guests are moved every tick; the others are looked at
  every second or two, staggered.

## 4. Map

Pizzeria built by script into the world (Flat world recommended; any world
works — the lot is cleared). Single storey + crawl ducts above the ceilings.
Local coordinates: +X east, +Z south, floor level y = 0 (floor blocks at
y = -1). Building 100 × 72 blocks; the street front (east) faces a fenced
parking lot, a roadside pylon sign and the road: long, low and symmetric, teal
cladding over a red trim line, pale stone pillars washed by uplights, dark
arched windows in the wings, a checker band at the base, taller end towers, and
the glass doors under the big neon sign with Rustgrin waving over the roofline.

The look is a big, abandoned 80s family pizzeria (a big-screen haunted pizzeria
crossed with a classic family fun centre, all original): dusty, faded, warm pools
of light by day and near darkness at night.

Rooms:
* **Dining Hall** (the showroom; north/center, 48 × 37, 9 tall under a dark
  ceiling): confetti carpet, a checker dance floor in front of the stage and a
  checker aisle, long party tables (red-and-white hats, balloons), cafe tables
  with star-back chairs, diner booths along the east and south walls, pendant
  lamps, a truss of PAR cans, the round drum in the ceiling with the mirror
  ball, framed posters over a checker band, SHOWTIME! and RESTROOMS neon, the
  red ARCADE neon over the passage to the Game Room, the order counter with the
  kitchen's window and the menu board, a salad bar; the **Show Stage**: a curved
  front lip with round footlights, a cream soffit with red stars following it,
  coloured PAR cans, red side drapes, a starry midnight backdrop and the big
  marquee sign RUSTGRIN'S PIZZA REVUE.
* West side: Backstage (spare heads), the Midnight Midway showroom (the Cat +
  Purple Rat on the ring), the **Grand Marquee** (the Ringmaster's curtained side
  stage, SORRY! OUT OF ORDER on the closed half of the curtain), the Gallery,
  the Staff Room (time-clock lobby).
* East side: Kitchen, Restrooms, the **Prize Corner** (prize cases, the plush
  wall, token and claw machines), the long **Entrance Hall** (yellow walls, plum
  carpet and a checker path from the glass doors to the WELCOME arch framed in
  marquee bulbs; the curved token counter under a starry soffit with the plush
  slatwall, a popcorn machine and the price board; brass stanchions with velvet
  ropes, the height chart, the ticket booth, a photo booth).
* South-east: the **Game Room** (skee-ball, rows of arcade cabinets, air hockey,
  token machines, a ticket counter, a crawl tube overhead), the **Fun Zone**
  (two padded play towers, crawl tubes overhead, a slide into the ball pit,
  kiddie rides), Parts & Service behind them (the auction crates).
* South: Supply Closet, West Hall + W. Hall Corner, the **Party Room** between
  the halls, the Office (south center; a bank of dead CRT monitors over the
  desk), East Hall + E. Hall Corner.
* Crawl ducts West/East (y 9–10, never over the Dining Hall or the Fun Zone)
  ending in two ceiling vents in the office.

Heights: the cast stands about 3 blocks tall; every room they walk is 6+ tall
(the map validator keeps a conservative 5.1 of head room) and the rooms where
they perform on a 1-high ring or stage are 7+ (the Dining Hall is 9); the office
and the front-of-house rooms can be lower.
Doorways are deliberately short (3 blocks): the animatronics stoop through them
and lean in at the office doors and the right window. At night the halls, the
hall corners and the door areas are dark (block light 0–1, checked by
`tools/map/validate_map.mjs`); only the hall-light switch lights them.

Cameras: 1A Show Stage · 1B Dining Area · 1C Grand Marquee · 2A West Hall ·
2B W. Hall Corner · 3 Supply Closet · 4A East Hall · 4B E. Hall Corner ·
5 Backstage · 6 Kitchen (audio only) · 7 Restrooms · 8 Midway · 9 West Duct ·
10 East Duct.

## 5. Camera mechanic (same as FREDBEAR: Six Nights Below)

Monitor up → the guard's view moves to the camera with the `minecraft:free`
camera preset (lateral movement and jump disabled, sneak = lower), night
vision + a clear "camera feed" fog, slow security-camera pan, CRT hum. The HUD
draws a pizzeria map bottom-right with the live camera blinking (title-text
binding), and a clickable camera-map form (mouse, controller, touch) switches
feeds. Hotbar scroll / LB-RB steps through cameras. Disrupted feeds show
static; CAM 6 is audio only.

## 6. Technical layout

```
packs/BP   behavior pack: manifest, scripts/, entities/, blocks/, items/
packs/RP   resource pack: manifest, textures/, models/, entity/, animations/,
           animation_controllers/, render_controllers/, sounds/, ui/, fogs/,
           local_lighting/, lighting/, texts/
tools/     generators, validators, simulation, preview renderer
docs/      this file and the other docs
previews/  rendered preview images
dist/      the packaged .mcaddon
```

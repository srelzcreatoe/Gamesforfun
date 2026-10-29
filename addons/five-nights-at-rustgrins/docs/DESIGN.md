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
* the Ringmaster's booth (the old Kitty's Cabaret): purple velvet `#3e1f4f`, gold stars `#d4a93c`
* Midway (circus): red `#8e1d1d` / cream `#d8cfb5` stripes
* light colors: fluorescent `#dfe8ff`, warm bulb `#ffc98a`, EXIT green `#3cff6e`

## 2. Story (original)

**Rustgrin's Pizza Revue** opened on Route 6 in 1984 with the *Rusty Revue*
band: **Rustgrin** the bear (lead singer), **Mirehop** the rabbit (guitar) and
**Noxbriar** the bear (backup vocals). In 1986 Aurelio Marvello, owner of the
travelling *Midnight Midway*, vanished during a matinee; his animatronic
**Ringmaster** kept the show running for three days to an empty tent. In 1987
the pizzeria bought the troupe: the Ringmaster, the nervous **Purple Rat**
(maracas) and **the Cat** (dancer). The Cat and the Purple Rat share the
Midway ring; after the show "would not stop" in 1990, the Ringmaster was moved
into the old Kitty's Cabaret, now his private booth.

The player is the night guard for the pizzeria's last week (November 1991). The
Ringmaster replaced the day manager on the office line: he calls every night,
calls the guard by name, teaches the job, and grows more possessive of "his"
show as the auction of lots one through six approaches. Hanging up on him is
remembered the next night.

Night 5 at 4 AM: a fake *6 AM / thank you for playing* screen, torn apart by
the Ringmaster; CAM 1C shows his booth empty; **Night 6 - The Final Act**
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
| **The Ringmaster** (Top-Hat Rat) | host, booth on CAM 1C | night 6 and the Custom Night | nights 1-5: never moves (only glimpsed peering through his curtains); night 6: obey his acts, and SPOTLIGHT him from a camera that sees him | the PA chime before every announcement; his cane on the tiles |

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
| 2 | 5 | 4 | 0 | 2 | 0 | booth | the Midway ring and its show tape |
| 3 | 7 | 6 | 1 | 5 | 4 | booth | vents, Purple Rat, Rustgrin |
| 4 | 8 | 8 | 3 | 7 | 7 | booth | everyone restless, the Rusted one |
| 5 | 15 | 15 | 7 | 13 | 13 | booth | until 4 AM: the takeover |
| 6 | cue | cue | cue | cue | cue | 20 | The Final Act |
| 7 | custom | custom | custom | custom | custom | custom | Custom Night (0–20 sliders, presets) |

Stars on the time clock: the end of night 5 (the takeover), the Final Act,
Custom Night "20/20/20/20/20/20".

Unique extras: hallucination flashes (posters that change, the Ringmaster's
face over the monitor, "SHOWTIME" text), animatronics turning their heads to
the camera when watched, a rare *Rusted Rustgrin* sighting, Free Roam daytime
mode with the band performing, an Animatronic Gallery, clippings board,
accessibility remote and captions.

## 4. Map

Pizzeria built by script into the world (Flat world recommended; any world
works — the lot is cleared). Single storey + crawl ducts above the ceilings.
Local coordinates: +X east, +Z south, floor level y = 0 (floor blocks at
y = -1). Building ≈ 80 × 70 blocks inside a fenced lot with a parking area.

Rooms: Show Stage + Dining Area (north/center), Backstage (NW), Midway (W, the
Cat + Purple Rat on the ring), the Ringmaster's booth (W, the old Kitty's
Cabaret, curtains parted), Supply Closet (SW),
West Hall + W. Hall Corner, Office (south center), East Hall + E. Hall Corner,
Kitchen (NE), Restrooms (E), Arcade / Prize Corner (E), Staff Room (time clock
lobby), entrance foyer, crawl ducts West/East (y 5–6) ending in two ceiling
vents in the office.

Cameras: 1A Show Stage · 1B Dining Area · 1C Ringmaster's Booth · 2A West Hall ·
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

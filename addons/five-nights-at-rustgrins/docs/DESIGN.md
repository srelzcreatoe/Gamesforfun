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
* Kitty's Cabaret: purple velvet `#3e1f4f`, gold stars `#d4a93c`
* Midway (circus): red `#8e1d1d` / cream `#d8cfb5` stripes
* light colors: fluorescent `#dfe8ff`, warm bulb `#ffc98a`, EXIT green `#3cff6e`

## 2. Story (original)

**Rustgrin's Pizza Revue** opened on Route 6 in 1984 with the *Rusty Revue*
band: **Rustgrin** the bear (lead singer), **Mirehop** the rabbit (guitar) and
**Noxbriar** the bear (backup vocals). In 1987 the owners bought the
animatronics of *Marvello's Midnight Midway*, a travelling show that had
closed after "an incident at a matinee": **the Ringmaster** (Top-Hat Rat), his
nervous partner **Purple Rat** (maracas) and **the Cat** (dancer). The circus
troupe got its own corner — the Midway — and the Cat got a curtained booth,
**Kitty's Cabaret**.

Since the Midway troupe arrived, the band moves at night. The Ringmaster's
show-control tape ("SHOWTIME PROTOCOL") has to keep running or he goes looking
for an audience. Business is failing, the building is falling apart, and the
pizzeria closes at the end of the week. The player is the new night guard for
that final week (Nov 1991). A day manager leaves a phone message each night.

Newspaper clippings (one per night survived) tell the history: the grand
opening (1984), the Midway purchase (1987), health complaints about "the smell
from the stage", a matinee where a performer "would not stop the show", the
previous night guard who "left in the middle of a shift", and the closing
notice. No gore — dread, implication, and things that should not move.

## 3. Cast and mechanics

All six use FNAF-style **AI levels 0–20**: every movement opportunity rolls
1–20; the animatronic acts when `AI >= roll`. Levels rise at 2, 3 and 4 AM on
nights 2+.

| Animatronic | Role | Threat | Counter | Tells |
|---|---|---|---|---|
| **Mirehop** (green rabbit) | guitarist | LEFT door | hall light + LEFT door | guitar string twangs at the left door; cameras glitch when he moves |
| **Noxbriar** (black bear) | backup vocals | RIGHT door | hall light + RIGHT door | almost invisible in dark rooms on camera — only her eyes glow; soft humming at the right window |
| **Rustgrin** (grey bear) | lead singer | RIGHT door, late nights | watch him on camera (he only moves unseen); shut RIGHT door when he is in the E. Hall Corner — he is never visible by the hall light | mic feedback squeal when he moves; at power-out he plays his song at the left doorway |
| **Cat** (maroon cat) | dancer | sprints down a hall | check Kitty's Cabaret often (she advances while unwatched); when she leaves, shut the door she runs at | curtain stages 0–3, collar-bell jingle from the hall she takes; a shut door makes her bang (power drain grows each time) |
| **Purple Rat** | maracas | ceiling VENTS (left/right) | listen for maracas in the ducts, watch CAM 9/10, close that VENT COVER while he is at the vent | maraca rattle from the duct side, louder as he nears; twitchy — he can reverse direction |
| **Top-Hat Rat** | ringmaster | anywhere | keep his **SHOW TAPE** running: on CAM 8 press *PLAY SHOW* to rewind it | calliope music on CAM 8 slows and detunes as the tape runs low; under 30 % he rallies Purple Rat and Cat (+3 AI); at 0 % he leaves the stage, tapping his cane, and doors cannot stop him — rewind the tape above 60 % before he reaches the office |

**Power:** 100 % at 12 AM. Usage bars (1–6): base + each closed door + each
lit hall light + monitor up + each closed vent cover. When power hits 0 every
door opens, lights die, and Rustgrin performs at the left doorway; survive
until 6 AM or be caught.

**Nights** (AI at 12 AM): see `tools/sim` for balance.

| Night | Mirehop | Noxbriar | Rustgrin | Cat | Purple Rat | Top-Hat Rat | New |
|---|---|---|---|---|---|---|---|
| 1 | 3 | 2 | 0 | 0 | 0 | 0 | doors, lights, cams, power |
| 2 | 5 | 4 | 0 | 2 | 0 | 0 | Kitty's Cabaret |
| 3 | 7 | 6 | 1 | 5 | 4 | 0 | vents, Purple Rat |
| 4 | 9 | 9 | 3 | 7 | 7 | 5 | the show tape |
| 5 | 12 | 12 | 6 | 10 | 10 | 9 | everyone |
| 6 | 16 | 15 | 10 | 14 | 14 | 13 | hallucinations |
| 7 | custom | custom | custom | custom | custom | custom | Custom Night (0–20 sliders, presets) |

Stars on the time clock: night 5, night 6, Custom Night "20/20/20/20/20/20".

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

Rooms: Show Stage + Dining Area (north/center), Backstage (NW), Midway (W,
Top-Hat Rat + Purple Rat), Kitty's Cabaret (W, curtained), Supply Closet (SW),
West Hall + W. Hall Corner, Office (south center), East Hall + E. Hall Corner,
Kitchen (NE), Restrooms (E), Arcade / Prize Corner (E), Staff Room (time clock
lobby), entrance foyer, crawl ducts West/East (y 5–6) ending in two ceiling
vents in the office.

Cameras: 1A Show Stage · 1B Dining Area · 1C Kitty's Cabaret · 2A West Hall ·
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

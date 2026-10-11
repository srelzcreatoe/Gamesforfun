# 08 · Installation and player guide

## Install

1. Use **Minecraft Bedrock 1.26.50 or newer** (Windows, console or mobile; designed for single player).
2. Open `dist/Fredbear_Six_Nights_Below.mcaddon` (double-click, or *Open with → Minecraft*). Minecraft imports both packs.
   Alternatively import `dist/FredbearBP.mcpack` and `dist/FredbearRP.mcpack` separately. `dist/SHA256SUMS.txt` lists checksums.
3. **Create → New World**:
   * *Game*: Default game mode **Adventure** is fine (the map sets Adventure itself); Difficulty **Peaceful** recommended.
   * *Advanced*: World type **Flat**. **Activate Cheats: on**. Leave experiments off.
   * *Behavior Packs*: activate **FREDBEAR: Six Nights Below (Behavior)**. Accept the prompt to add its resource pack.
4. Create the world. Before you build, set **Settings → Video → Render Distance to at least 11 chunks** so remote
   camera feeds can show distant rooms (docs/02 "Rendering reach").
5. In the world, type **`/fb:setup`** and wait. The action bar shows *Building … %*. Keep the world open until the title
   **FREDBEAR — SIX NIGHTS BELOW** appears and you are standing at the time clock. If a *Build report* appears, read it and
   run `/fb:debug selftest` (docs/09).

The build is resumable: if you leave, run `/fb:setup` again.

### Updating from an earlier version

1. Import the new `.mcaddon` (version **1.3.0**).
2. In the world's settings, open **Behavior Packs** and make sure **FREDBEAR: Six Nights Below (Behavior)** shows
   version 1.3.0; if the old one is still listed, deactivate it and activate the new one (its resource pack follows).
   Check **Resource Packs** too: only the 1.3.0 resource pack should be active.
3. Enter the world. Version 1.3.0 adds cameras, the supply duct, the vent and shaft seals, the lore rooms and the night 8-9
   buttons, so the action bar asks you to rebuild: run **`/fb:setup`** and wait for the title. Unlocked nights, secrets,
   endings and settings are kept: if you already beat night 7, night 8 is open (Morgrave if your last ending was *seal*,
   Valek if it was *burn*).

## The time clock (lobby)

The employee entrance terminal has: **TRAINING SHIFT**, **NIGHT 1-9** (lamps show unlocked nights; night 7 unlocks after
night 6, night 8 after night 7, night 9 after night 8), **CONTINUE** (highest unlocked night), **FREE ROAM** (explore
safely, find secrets; the animatronics turn their heads to follow you when you walk past), **SETTINGS** (captions, hints,
night music, holiday decorations, the on-screen camera map, deterministic seed, developer overlay), **ARCHIVE & CREDITS** (secrets found,
endings, challenges, credits) and **ERASE PROGRESS**.

Also in the time-clock room:

* **CHALLENGES** (the gold console with four lamps, unlocked by finishing night 6): No Doors, Fredbear Only, Double
  Power Drain, Broken Cameras. Each lamp lights once that challenge is beaten. Challenges never change your campaign
  progress. Every challenge has been balanced so a careful player can win it.
* **NEWSPAPER BOARD**: press its button to read the clippings. A new one appears for every night you finish.
* **TAPE DECK 1987** (in the office, on the back wall): once you have survived night 5, it plays the 1987 security tapes
  on the monitor - the night the last guard vanished. Only outside a shift; sneak to stop.
* Lore to find in Free Roam: the sealed 1983 **birthday room** in the old diner (CAM 20; the candles relight every night),
  the **wall of names** in Fredbear's chamber (after night 6 there is a new one) and the 1987 **crew graffiti** in the west
  maintenance tunnel.
* **Decorations**: in late October the pizzeria gets pumpkins, jack-o'-lanterns and cobwebs; in December and early
  January, Christmas trees, presents and string lights. They follow your device's date and can be switched off in Settings.

Choosing a night starts its **introduction** at 11:55 PM with a short **camera tour** of the stage, the halls and (from
night 4) the sealed diner, so you see where everyone starts (sneak to skip). Then walk to the **Security Office** and
press **START SHIFT** on the back wall. **Green sparkles** show the way: they follow a real walkable route (doors, corridors, stairs) and the action bar shows how
many blocks are left. Some nights offer an optional pre-shift task (shown on screen) that grants +5 % power or an
extra strobe charge. After 180 seconds the shift starts anyway and you are moved to the office. The first time you start
night 4, a short **1983 flashback** plays before the shift (sneak to skip).

## The office

```
                 north wall: camera MAP (21 buttons, one per camera; press to view that feed)
   LEFT WINDOW ┐ ┌───────────────────────────────────────────────┐ ┌ RIGHT WINDOW
   LEFT DOOR ──┤ │ DOOR  LIGHT  MONITOR  HATCH  STROBE  BREAKER  PHONE  LIGHT  DOOR │ ├── RIGHT DOOR
               │ │ (L)   (L)                                                (R)  (R)  │ │
               │ │                       HATCH in the floor                            │ │
               │ │ SEAL VENT / SEAL SHAFT (left of the console)                        │ │
               │ │ RESERVE lever          TAPE DECK 1987        START / RESUME          │ │
               └─┴───────────────────────────── back wall ──────────────────────────────┴─┘
```

| Control | What it does | Power |
|---|---|---|
| **DOOR** (red) | closes/opens that door (a slam when it closes, a metal door sound when it opens); a closed door stops Bonnie, Chica and Freddy at that side | 0.18 %/s each |
| **LIGHT** (white) | lights the corner outside that door for 5 s; look through the window | 0.12 %/s each |
| **MONITOR** (dark) | raises the camera monitor (your view moves to the selected camera) | 0.06 %/s |
| **HATCH** (gold, nights 4+) | seals the floor hatch Fredbear can climb through | 0.14 %/s |
| **STROBE** (orange, nights 4+) | emergency strobe: repels Fredbear **only when the barrier he is at is closed**. Charges: 4 on night 4, 5 on night 5, 6 on nights 6, 7 and 9 | 2 % per shot |
| **SEAL VENT** (white) | drops a shutter into the supply duct for 20 s (Bonnie's vent; Morgrave's duct); 15 s to recharge | 3 % per use |
| **SEAL SHAFT** (gold, when the hatch is installed) | the same for the crawlspace below the office hatch (Fredbear's and Morgrave's way up) | 3 % per use |
| **RESET BREAKER** | restores the hall lights after Chica trips the breaker (2 s) | 1 % |
| **PHONE** | replays tonight's phone call | — |
| **RESERVE** lever (nights 3+) | at 0 % power you have 5 s to pull it for one +8 % top-up | — |
| **START / RESUME** | starts the shift; resumes after a maintenance task | — |
| **TAPE DECK 1987** | plays the 1987 security tapes (outside a shift, after night 5) | — |

The panel above the console shows **power** (10 lamps), the **hour** (lamps from 12 AM to 5 AM) and **warning
indicators** for each door, light, hatch and the breaker (green / yellow / grey show the device state; red means a fault or a
barrier being forced).
The action bar shows time, power %, usage bars and captions.

### Cameras

* Raise the monitor with the console button, the **Camera Tablet** (hotbar slot 1) or a camera **map button**.
* Switch: scroll the hotbar / press RB-LB / tap another hotbar slot, or press a map button, or use the Camera Tablet menu.
* Lower: **sneak** (Shift / right-stick / sneak button), the MONITOR button again, or the tablet menu.
* The monitor makes its own sounds: a click going up and down, and a low CCTV hum while you watch.
* **Camera map**: while you watch the cameras, a map of the building sits in the bottom-right corner of the screen, like
  FNAF 1: every camera is a numbered box, the one you are on blinks green, and YOU marks the office. The basement cameras
  are on the left. Switch it off in Settings if it is in the way.
* CAM 10 (kitchen) is **audio only**: you hear Chica's clatter through it. CAM 16, 19, 20 and 21 (the sealed diner, Fredbear's
  chamber, the party room and the diner kitchen) have no signal before night 4.
* CAM 17 looks at the subfloor under the office hatch (whoever climbs up passes it) and CAM 18 into the supply duct (Bonnie
  and Morgrave crawl through it to the left door).
* **They stare back**: whoever you watch on a feed for a couple of seconds slowly turns to look straight into the lens.
* From night 2, very rarely, a **black Fredbear silhouette** stands on the show stage. Don't stare at it: watching it for
  3 seconds costs 1 % power and it vanishes.
* Purple, scan-lined figures labelled **ECHO** are false images (night 5+). Static means Fredbear is disrupting the feeds.
* Feeds are lit for you: night vision while the monitor is up, a clear camera fog instead of the night fog, and soft hidden
  lights where each camera looks. The two door-corner cameras are the exception: those corners stay dark, which is why the hall
  lights matter (and Valek is only ever two eyes in the dark).

### Items (locked to your hotbar)

| Slot | Item | Use |
|---|---|---|
| 1 | Camera Tablet | raise the monitor / camera menu while viewing |
| 2 | Office Remote | menu with every office control (accessible alternative to the console) |
| 3 | Shift Guide | a topic menu that explains every mechanic: power, doors, lights, cameras, hatch, strobe, breaker, reserve, phone, panel lamps, maintenance and tasks, each animatronic (Morgrave and Valek too), Fredbear's powers, vent seals, sound cues, the nine nights, challenges, lobby and settings. Its first button is the **Music: ON / OFF** switch |

On touch screens these items show an on-screen interact button (Cameras / Office / Guide).

## How to survive

* **Power** lasts the night only if you use doors and lights when needed. At 0 % everything shuts off.
* **Bonnie** (left side; from night 2 he can also flank to the right door and crawl through a vent - CAM 18 shows him in the
  duct, SEAL VENT keeps him out): footsteps and a groan; light the corner, close the door while he stands there, open it when
  he leaves. On hard nights he may **bang on the left door** to keep your eyes there while Chica sneaks to the right one.
* **Chica** (right side, through the kitchen): kitchen clatter means she is in the kitchen; breathing at the right door means
  she is there. She may trip the hall-light breaker: press RESET BREAKER. Doors always work. On hard nights she flanks to the
  left door, and two animatronics can wait at the right door together - **two at one door take twice as long to give up**.
* **Freddy** (right side): moves only when the camera you are watching does not show him; laughs when he advances.
  Glowing eyes in the right corner: **close the right door**. Never stare at cameras with the right door open while he is
  there. At 0 % power he plays a music box at the left door…
* **Fredbear** (night 4+): **his laugh** means he has started a hunt. The **office lamps flicker** when he is close, faster
  when he is climbing or walking in. Then a **music box and golden glow** at an entry (hatch first, all three on nights 5-7).
  **Close that door or hatch, then fire the STROBE** while he is there. A strobe with the barrier open only stuns him.
  If you keep the barrier closed without strobing he pounds on it: **the first time each night, each door and the hatch
  hold** and he gives up (he bows and leaves). The second time at the same door or hatch he forces it open — you can still
  strobe him in that moment. Nothing holds him in the Golden Hour (night 6, 5 AM).
  Night 5+: warned teleports (chime + shimmer + static), false camera echoes, short blackouts (doors still work).
  From night 4, when the power runs out it is **Fredbear** who comes to the left door with his music box.
* **Maintenance** (nights 3 and 5): the clock stops and every animatronic shuts down; follow the green sparkles to the named room
  (both are in the basement: out the right door, through the employee entrance to the east service corridor, down the Staff
  Stairwell), pull the lever,
  come back and press START/RESUME.
* **6 AM** wins — even if an animatronic was about to attack. Night 6 ends with the finale and the ending.
* **Night 7 — Fredbear's Revenge**: only Fredbear, at full strength, from the start, and he is **everywhere**: between
  attempts he blinks from room to room all over the pizzeria, even onto the main stage. Freddy, Bonnie and Chica sit switched
  off in Parts & Service. 6 strobe charges and the reserve lever. At 6 AM you choose: **seal** him in the chamber, or
  **burn** the pizzeria. Each choice has its own ending, and it decides night 8.
* **Night 8 after the seal — Morgrave**, the rabbit in the walls: scraping inside the walls when he comes out (the caption
  names the route), vent clanks, never footsteps. He crawls through the supply duct (CAM 18) to the left door, or through the
  crawlspace (CAM 17) up under the hatch. **Seal** the duct or the shaft in front of him and he gives up; or close the left
  door / the hatch when he gets there. You will not always hear him arrive.
* **Night 8 after the burn — Valek**, the gray bear: only his two small eyes, stepping from dark spot to dark spot down the
  West or East Hall, and only while you are not watching his spot. He **lies**: half his steps sound like someone else on the
  other side of the building. At the door corner: **light him and he vanishes - but comes back angrier and closer; hold the
  door shut and he backs off**; leave the corner dark and open and he attacks.
* **Night 9 — Three Below**: whatever you chose, Fredbear, Morgrave and Valek come for you together. No music, the trio switched
  off in Parts & Service. Very hard on purpose.

## Music

From 12 AM to 6 AM the night music loops (*PIZZA DINNER*). It replaces Minecraft's own music while it plays; every other
sound plays normally. It stops for jumpscares, the power-out music box and 6 AM. Night 9 has no music at all. Switch it off with the first button
of the Shift Guide or in Settings at the time clock.

## After a night

Win: the next night unlocks and is saved. Loss: **Retry** (straight back into the office) or return to the lobby.
Progress (unlocked nights, secrets, settings) is saved in the world. If you leave mid-night, the night is abandoned and you
return to the time clock next time; your progress is kept.

## Accessibility

Captions for every sound cue (on by default), hint text, controller and touch support through the items, and no
flashing other than the strobe effect (the player triggers it). Settings are at the time clock.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Unknown command: fb:setup` | the behavior pack is not active, or cheats are off |
| *Run /fb:setup to build the map* keeps showing | the map has not been built in this world yet |
| Build report lists missing structures or command blocks | `/fb:debug selftest`; see docs/07 "manual fallback" |
| Buttons do nothing / doors never move | command blocks disabled: `/gamerule commandblocksenabled true`; then `/fb:debug selftest` (actuator round trip) |
| Animatronic missing or doubled | `/fb:debug puppets` respawns them (the integrity check also fixes this within 2 s) |
| Camera feeds show void or no animatronics | raise the render distance (≥ 11 chunks) |
| Stuck in a camera view after an error | `/fb:lobby` (full reset, restores your camera and controls) |
| Want to start over | ERASE PROGRESS at the time clock, or `/fb:setup true` to rebuild the map |

## Remove

Deactivate the behavior pack in the world settings. The built map stays in that world as ordinary blocks.

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

## The time clock (lobby)

The employee entrance terminal has: **TRAINING SHIFT**, **NIGHT 1-6** (lamps show unlocked nights), **CONTINUE**
(highest unlocked night), **FREE ROAM** (explore safely, find secrets), **SETTINGS** (captions, hints, deterministic seed,
developer overlay), **ARCHIVE & CREDITS** (secrets found) and **ERASE PROGRESS**.

Choosing a night starts its **introduction** at 11:55 PM: walk to the **Security Office** (follow the green sparkles) and press
**START SHIFT** on the back wall. Some nights offer an optional pre-shift task (shown on screen) that grants +5 % power or an
extra strobe charge. After 180 seconds the shift starts anyway and you are moved to the office.

## The office

```
                 north wall: camera MAP (16 buttons, one per camera; press to view that feed)
   LEFT WINDOW ┐ ┌───────────────────────────────────────────────┐ ┌ RIGHT WINDOW
   LEFT DOOR ──┤ │ DOOR  LIGHT  MONITOR  HATCH  STROBE  BREAKER  PHONE  LIGHT  DOOR │ ├── RIGHT DOOR
               │ │ (L)   (L)                                                (R)  (R)  │ │
               │ │                       HATCH in the floor                            │ │
               │ │ RESERVE lever                               START / RESUME          │ │
               └─┴───────────────────────────── back wall ──────────────────────────────┴─┘
```

| Control | What it does | Power |
|---|---|---|
| **DOOR** (red) | closes/opens that door; a closed door stops Bonnie, Chica and Freddy at that side | 0.18 %/s each |
| **LIGHT** (white) | lights the corner outside that door for 5 s; look through the window | 0.12 %/s each |
| **MONITOR** (dark) | raises the camera monitor (your view moves to the selected camera) | 0.06 %/s |
| **HATCH** (gold, nights 4+) | seals the floor hatch Fredbear can climb through | 0.14 %/s |
| **STROBE** (orange, nights 4+) | emergency strobe: repels Fredbear **only when the barrier he is at is closed** | 2 % per shot |
| **RESET BREAKER** | restores the hall lights after Chica trips the breaker (2 s) | 1 % |
| **PHONE** | replays tonight's phone call | — |
| **RESERVE** lever (nights 3+) | at 0 % power you have 5 s to pull it for one +8 % top-up | — |
| **START / RESUME** | starts the shift; resumes after a maintenance task | — |

The panel above the console shows **power** (10 lamps), the **hour** (lamps from 12 AM to 5 AM) and **warning
indicators** for each door, light, hatch and the breaker (green / yellow / grey show the device state; red means a fault or a
barrier being forced).
The action bar shows time, power %, usage bars and captions.

### Cameras

* Raise the monitor with the console button, the **Camera Tablet** (hotbar slot 1) or a camera **map button**.
* Switch: scroll the hotbar / press RB-LB / tap another hotbar slot, or press a map button, or use the Camera Tablet menu.
* Lower: **sneak** (Shift / right-stick / sneak button), the MONITOR button again, or the tablet menu.
* CAM 10 (kitchen) is **audio only**: you hear Chica's clatter through it. CAM 16 (sealed diner) has no signal before night 4.
* Purple, scan-lined figures labelled **ECHO** are false images (night 5+). Static means Fredbear is disrupting the feeds.

### Items (locked to your hotbar)

| Slot | Item | Use |
|---|---|---|
| 1 | Camera Tablet | raise the monitor / camera menu while viewing |
| 2 | Office Remote | menu with every office control (accessible alternative to the console) |
| 3 | Shift Guide | the rules below |

On touch screens these items show an on-screen interact button (Cameras / Office / Guide).

## How to survive

* **Power** lasts the night only if you use doors and lights when needed. At 0 % everything shuts off.
* **Bonnie** (left side; from night 2 he can also flank to the right door and crawl through a vent): footsteps and a groan; light the
  corner, close the door while he stands there, open it when he leaves.
* **Chica** (right side, through the kitchen): kitchen clatter means she is in the kitchen; breathing at the right door means
  she is there. She may trip the hall-light breaker: press RESET BREAKER. Doors always work.
* **Freddy** (right side): moves only when the camera you are watching does not show him; laughs when he advances.
  Glowing eyes in the right corner: **close the right door**. Never stare at cameras with the right door open while he is
  there. At 0 % power he plays a music box at the left door…
* **Fredbear** (night 4+): a **music box and golden glow** at an entry (hatch first, all three on nights 5-6).
  **Close that door or hatch, then fire the STROBE** while he is there. A strobe with the barrier open only stuns him.
  If you keep the barrier closed without strobing he forces it open — you can still strobe him in that moment.
  Night 5+: warned teleports (chime + shimmer + static), false camera echoes, short blackouts (doors still work).
* **Maintenance** (nights 3 and 5): the clock stops and every animatronic shuts down; go to the named room, pull the lever,
  come back and press START/RESUME.
* **6 AM** wins — even if an animatronic was about to attack. Night 6 ends with the finale and the ending.

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

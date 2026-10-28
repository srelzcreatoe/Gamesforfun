# Five Nights at Rustgrin's

An original FNAF-style night-guard horror add-on for **Minecraft Bedrock
1.26.50+**. Survive six nights (plus a Custom Night) as the last night guard of
*Rustgrin's Pizza Revue*, a dying 80s pizzeria with two show stages, a
curtained cabaret and a crawl-duct system above the ceilings. Built with
vanilla-style blocks and ready for **Vibrant Visuals**.

Not affiliated with Scott Cawthon or Mojang. The animatronic models and
animations were supplied by the map owner; everything else (map, scripts,
block art, sounds, music, story) is original to this project.

![Preview renders](previews/contact_sheet.jpg)

More in [`previews/`](previews/): renders of the map the add-on builds, made
offline with the project's own renderer (see *Building from source*).

## Install

1. Open `dist/FiveNightsAtRustgrins.mcaddon` (double-click on Windows / open
   with Minecraft on mobile and console-capable platforms). It imports a
   behavior pack and a resource pack.
2. Create a world: **Flat** world type recommended, cheats **on**, and
   activate both packs.
3. Join the world. A prompt asks to build the pizzeria where you stand — or
   run `/fnar:setup` later. Keep the world open until it reports *The
   pizzeria is built* (about a minute).

## Playing

You start in the **Staff Room** at the time clock. Press a button on the wall:
`NEW GAME`, `CONTINUE`, `NIGHT 6` (after night 5), `CUSTOM NIGHT` (after night
6), `FREE ROAM` (daytime, the band performs), `GALLERY`, `CLIPPINGS`,
`SETTINGS`, `ERASE PROGRESS`.

**In the office** (you face the desk):

| Control | How |
|---|---|
| Left / right steel door | red wall button by each door |
| Left / right hall light | white wall button below it |
| Ceiling vents | the two white buttons above the desk (labelled) |
| Cameras | the **Camera Tablet** (slot 1) or click the CRT monitor on the desk - during a shift only |
| Switch camera | click a camera on the map, or scroll the hotbar |
| Lower the monitor | sneak, or LOWER on the map |
| Rewind the show tape | PLAY SHOW while on CAM 8 |
| Everything in one menu | the **Office Remote** (slot 2) |
| Rules and tips | the **Shift Guide** |

Power drains all night; doors, lights, vents and the monitor drain it faster.
At 0 % everything opens… and someone comes to sing for you.

## The cast

| | Watch for | Do |
|---|---|---|
| **Mirehop** (green rabbit) | West hall, a guitar twang at the left door | left light, shut the left door |
| **Noxbriar** (black bear) | East hall, humming at the right window; only her eyes show on dark cameras | right light, shut the right door |
| **Rustgrin** (grey bear) | moves only unwatched; mic feedback outside the right door = he is in the corner nook (only CAM 4B sees it) | keep the right door shut while on the cameras |
| **The Cat** | Kitty's Cabaret curtain (CAM 1C) | check the cameras often; shut the door she sprints at |
| **Purple Rat** | maracas in the ceiling ducts (CAM 9 / 10) | close that vent when he is above you |
| **The Ringmaster** | the show tape on CAM 8 slows down | rewind it; if it stops, no door will save you |

Stars: beat night 5, night 6, and the Custom Night at 20/20/20/20/20/20.

## Commands (cheats on)

`/fnar:setup [rebuild]`, `/fnar:lobby`, `/fnar:debug help`.

## Building from source

`python3 tools/build_addon.py` regenerates the generated assets, runs every
check (Mojang JSON schemas, block states against the 1.26.50 block data,
camera sight lines and routes on the built map, a typecheck against the
`@minecraft/server` 2.10 typings, a night-balance simulation, and a scripted
play session against a strict API mock) and writes `dist/*.mcaddon`.
See `docs/` for the design, block, sound and renderer specs.

`node tools/previews/make_previews.mjs` re-renders `previews/` from the build
plan (headless Chromium + three.js; camera shots get the in-game camera HUD
composited on top).

# The Observer — Player Guide

> It follows you wherever you go. You rarely see it. You notice that something is wrong.

## Requirements
* Minecraft **Bedrock Edition 1.26.50 or newer** (Windows, Android, iOS, consoles via import tools, Bedrock Dedicated Server).
* No experimental toggles are needed.

## Installing

**Windows / Android / iOS:** open `TheObserver.mcaddon` (double-click on Windows; "Open with Minecraft" on mobile).
Minecraft imports both packs. Then:

1. Create or edit a world → **Behavior Packs** → activate **The Observer (Behaviour)**. The resource pack is added
   automatically (it is a dependency); if not, also activate **The Observer (Resources)** under *Resource Packs*.
2. Play. Nothing happens during the grace period (12 minutes of play on the Standard preset).

**Existing worlds:** back the world up first, then add the packs as above. The add-on only changes blocks in small,
recorded, reversible ways (see "Your builds are safe" below).

**Dedicated server:** copy `TheObserver_BP` into `behavior_packs/` and `TheObserver_RP` into `resource_packs/`, add both
UUIDs to the world's `world_behavior_packs.json` / `world_resource_packs.json` (UUIDs are in each `manifest.json`), and
set `texturepack-required=true` so clients download the resources.

## What to expect
The Observer does not attack on sight and it rarely shows itself. Early on you will notice small things: a sound that
should not be there, a door you closed standing open, a pumpkin facing you. Later, footsteps that match yours. Later
still, it will come closer. How you respond matters — most encounters end peacefully if you notice and answer them.

Some useful habits (no spoilers beyond what the game tells you early):
* If something changed, **put it back** — or look closely at it.
* If you hear something you did, from somewhere you are not, **go and look**.
* If steps behind you stop when you stop, **turn around**.
* It does not like being looked at. **Keep your eyes on it** when it matters.
* **Light** helps. So does a friend watching your back.

## Your tools
| Item | How to get it | What it does |
|---|---|---|
| **Field Notes** | given after your first discovery, or craft *book + charcoal* | Use it to read your pages (what you noticed, and the rules you have learned), toggle sound captions, keep the vigil, open settings (operators) |
| **Tally Chalk** | craft *calcite + bone meal* (×8) or *diorite + bone meal* (×4) | Use while looking at a block to mark it (up to 8 marks; sneak-use on a mark to remove it). If it changes anything within 4 blocks of a mark, the mark smudges and you are told |
| **Vestige** | each discovery; breaking an Effigy | Crafting material |
| **Witness Lens** | craft *spyglass + 2 Vestiges + amethyst shard* | Use while looking at it: it recoils and withdraws. With nothing to hold, the lens shows where it has walked and where its effigies are. 20 s cooldown |
| **Ward Lantern** | craft *lantern + 2 Vestiges* | Place it: within 12 blocks it will not stand or change any block (and puts back anything it already changed there) |

## Discoveries and the long-term goal
Every time you notice or answer something, a page is written in your Field Notes and you receive a Vestige. With
**12 pages** and a **Witness Lens**, at night near the place you return to most, the Field Notes let you **keep the
vigil**. Succeed and you are *Witnessed*: you receive The Observer's Eye and choose how it remains — watching gently,
hunting at full intensity, or letting you be.

## Settings (operators)
Open with *Field Notes → Settings* or `/observer:settings`. Presets:

| Preset | Feel |
|---|---|
| **Atmosphere** | rare, never attacks, subtle changes only, no sudden scares, fades only |
| **Standard** | the intended experience |
| **Relentless** | frequent, aggressive, more invasive changes |

Individual controls: encounter frequency, aggression (never attacks / low / standard / high), environmental
manipulation (off / subtle / standard / unsettling), sudden scares (off / rare / standard), camera effects
(none / fades only / full), default captions, grace period, world-wide weather during the vigil, developer tracing.
On **Peaceful** difficulty it never attacks.

## Accessibility
* **Sound captions:** Field Notes → *Sound captions* (per player) shows important sounds as on-screen text
  (footsteps behind you, a door moving, a hum rising, a chime and where it comes from).
* **Camera effects** can be reduced to fades only or turned off entirely; **sudden scares** can be turned off.
* Chalk-mark warnings are always shown as text.

## Multiplayer
There is one Observer. It focuses on one player at a time and takes turns fairly. Everyone can see it and its changes;
its quiet cues (footsteps, breath, chimes) are heard only by the person it is following. Watch each other's backs.

## Your builds are safe
* It only ever touches doors/trapdoors/gates, torches/lanterns/candles/campfires, a few decorative objects
  (pumpkins, stonecutters, anvils), air (temporary Veil, natural-looking blocks, effigies), and — only on the
  *Unsettling* setting — natural stone/dirt walls.
* It never touches chests or any container, beds, signs, redstone, portals or anything else.
* Every change is recorded and reverted later. If you change the block yourself, your change wins.
* Blocks it places drop nothing when broken.

## Removing the add-on
1. As an operator, run `/observer:restore` (or set *Environmental manipulation* to *Off*) to revert every recorded change.
2. Wait a minute in the areas you have visited so unloaded areas can be restored too, then remove the packs.
If the packs are removed first, any Veil or Effigy blocks still standing become unknown blocks.

## Commands
| Command | Who | What |
|---|---|---|
| `/observer:journal` | anyone | open your Field Notes |
| `/observer:settings` | operators | settings |
| `/observer:status [player]` | operators | what it currently knows about a player |
| `/observer:restore` | operators | revert all recorded changes now |
| `/observer:preset <atmosphere\|standard\|relentless>` | operators | apply a preset |
| `/observer:trigger <encounter> [player]` etc. | operators, cheats on | developer/testing commands (see DEVELOPER_GUIDE.md) |

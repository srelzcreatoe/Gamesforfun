# Tailwail — Player Guide

The same text is in the in-game **Tailwail Field Guide** (given once to every player,
craftable from *book + bone*, or `/tailwail:guide`).

## What it is

A towering, patient predator that lives in dark caves. It hunts by sight: it cannot see
through stone and it cannot learn what it did not see. It is never random — every
encounter follows the same rules, and every rule has a sign you can learn.

## Its signs

| Phase | What you notice | What it means |
|---|---|---|
| Watching | distant breathing, a tail dragging over stone, nails on rock, a hand or head at the edge of a pillar, a hunched shape beyond your torchlight | It is near and observing. While you look straight at it, it does not walk; when you look away it repositions. |
| Stand-off, calm | it stands in view 8–12 blocks away; **tail dragging**, slow breathing; it copies your crouch, head tilt or sudden stop a moment late | Calm. You can back away. |
| Stand-off, agitated | **tail twitching**, throat clicks, imitation that goes wrong (too deep, held too long, shoulders hiked) | It is getting agitated. Stop staring, stop closing in, don't sprint near it. |
| Commitment | imitation stops, **tail rigid**, silence, it **rises as tall as the cave allows**, then a long coiled wind-up and **the wail** | It has committed. This sign is never a bluff. Run *now*. |
| Pursuit | heavy hands pounding stone, huffing | Looking at it no longer stops it. |

Some encounters end without a chase: it may just watch, peek and vanish, or withdraw on
its own — you may never be sure it has really gone.

## Surviving it

* **Stand-off:** a brief glance is safe. Long stares, getting close, sprinting nearby and
  hitting it raise its agitation. Backing away calmly (not sprinting) can end the encounter.
* **After the wail:** it is faster than you in the open. Break line of sight, turn corners,
  put walls between you. Its pursuit is finite; out of sight for about 8 seconds with real
  distance and it gives up. It may search where it last saw you.
* It follows you into 2-high tunnels on all fours. **It cannot fit through a 1-block-high gap.**
* It can open **wooden** doors (hosts can disable this). It cannot open iron doors or break blocks.
* Every strike is wound up first and **never lands through a wall**.
* Fighting it is possible but costly; it does not drop special loot.

## It remembers

Tailwail keeps a small memory of what it has *seen* you do — crouching, looking up or down,
stopping dead. One day it may do your gesture first. Memory is per player, small, fades
over time, and never makes it hit harder or warn you less. You can erase your own record
in Settings.

## Settings you control

`/tailwail:settings` or *Field Guide → Settings*: Tailwail volume, optional effects (Off /
Subtle / Full — "Full" adds a short camera shake on the wail and on hits; "Off" also
tones down the wail's head-shake animation for you), captions for important sounds, and
erasing your memory record. Operators also see world settings
([CONFIGURATION.md](CONFIGURATION.md)).

## Troubleshooting

* **No encounters?** New players get a grace period (10 min default); you must be
  underground in the dark, in Survival or Adventure, not on Peaceful; there is a cooldown
  after each encounter (6–10 min default) and after you die (5 min). Operators:
  `/tailwail:debug status` shows the reason.
* **Something stuck?** Operators: `/tailwail:debug end` removes every Tailwail cleanly.
* **No sound?** Check Tailwail volume in Settings, then the game's *Hostile Creatures* volume.
* **Wrong look / missing model?** Make sure both packs are active and the resource pack
  was not removed from the world.

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
2. Join the world. A chat message confirms the add-on is running, and the first player (or any operator) receives the
   **Observer Config Wheel**.
3. Play. Nothing happens during the grace period (12 minutes of play on the Standard preset; half a minute in the
   Weeping Mire, its home). To see the creature
   straight away, use the Config Wheel → **See it now**, or **Start it for me now** to skip the wait.

**Updating from an earlier version:** import the new `.mcaddon` (version 1.1.0). If a world still uses the old copy, open the world's
settings → *Behavior Packs* and *Resource Packs*, deactivate The Observer, then activate the 1.1.0 packs again. Your
progress is kept; the new options below start switched on.

**The Weeping Mire is part of The Observer now (1.0.7).** If a world also has the stand-alone *Weeping Mire* packs
active, deactivate them there (both behaviour and resource pack): The Observer brings the same biome, blocks and pages
with the same names, and two copies would clash. Blocks you already placed from the Mire stay as they are. In an
existing world the Mire only appears in land you have not explored yet (Minecraft never regenerates terrain), so the
Mire near spawn (1.0.8) is for new worlds.

**Existing worlds:** back the world up first, then add the packs as above. The add-on only changes blocks in small,
recorded, reversible ways (see "Your builds are safe" below).

**Dedicated server:** copy `TheObserver_BP` into `behavior_packs/` and `TheObserver_RP` into `resource_packs/`, add both
UUIDs to the world's `world_behavior_packs.json` / `world_resource_packs.json` (UUIDs are in each `manifest.json`), and
set `texturepack-required=true` so clients download the resources.

## What to expect
The Observer does not attack on sight and it rarely shows itself. Early on you will notice small things: a sound that
should not be there, a door you closed standing open, a pumpkin facing you. Later, footsteps that match yours. Later
still, it will come closer. How you respond matters — most encounters end peacefully if you notice and answer them.

When you do see it: a four-block figure wrapped in drifting, faintly glowing wisps, its two white eyes burning in the
dark. It groans to itself when it is near. When it knows you have seen it there is a rattle of clicks and a crack —
and from the second stage on it may shriek and come straight at you. When it leaves, it tears apart into crimson shreds.

**When it is near.** Your music stops while it is around, and comes back, fading in, once it has gone. And you will
hear your own heart: slow when it is barely there, racing when it is on you — even when you cannot see it. When it is
close and means you harm, your view trembles with each beat (gently; "Camera effects" set to reduced halves it and
"none" turns it off; the heartbeat itself can be switched off in the settings).

**It hides behind trees.** Look along a line of trees and you may find it behind a trunk, only its head and a hand on
the bark showing, its face turned to follow you. Look straight at it and it ducks back out of sight; it waits while
you stare at the tree, and looks round again when you look away — from the other side, if it keeps getting caught on
one.

**Do not run at it.** If you sprint straight at it while it is watching, it decides before you get there. In the
dark, when you are hurt, when you are alone, when it is already angry — and the more often you have tried this — it
comes for you. Otherwise it is gone before you arrive, and it waits for its moment: the next time things favour it (at
night, in a cave, when you are badly hurt) it comes back at once, with something worse.

**It gets to know you.** Everything you do that it can see, it remembers, and each time it learns a little more:
stare it down and it snaps sooner; look away and it comes further each time; shoot it and it keeps its distance behind
cover; outrun it and the chase starts closer; never notice it and it comes closer and lets you hear it arrive. It
learns where you spend your time and when, how much light you put down, and which of its tricks work on you. Field
Notes → *Lessons* tells you what it knows about you. (Switch "It learns how you escape" off and it learns nothing.)

**When you spot it.** It arrives without a sound and stands perfectly still — out in the open, on a ledge high above
you, or, in caves, hanging upside down from the ceiling. It will not come for you while it is only watching. But once
you have seen it, or walk toward it, it is a **standoff**:
* It watches you. Now and then it tests you: its neck cracks, its head tilts, it takes one slow step toward you
  while you look.
* **Every time you look away, it is a little closer** when you look back. (It never comes right up to you this way;
  walk right up to it and it is gone before you reach it, or it strikes.)
* **Look at it, but do not stare.** The longer and the closer you hold its gaze, the angrier it gets — a few
  seconds up close, a dozen far off. You will hear it: its neck cracking, a rattle of clicks. **Shooting it or
  hitting it** sets it off at once.
* It ends one of two ways. Usually it is **simply gone** — when you have looked away for a while, or it has watched
  long enough. Or it **snaps**: from the second stage it comes for you in a rage, faster than you can sprint,
  screeching as it comes (before that, or on "Never attacks", it rushes you and is gone).

When it is done it does not walk away. It is just gone, torn apart where it stood.

**Nothing keeps it out.** When it is coming for you and cannot get any closer, it finds a way: it opens doors,
breaks glass and leaves out of its way, and gets down flat and crawls through gaps only a block high. (Broken blocks
come back afterwards and drop nothing; a Ward Lantern still protects everything within 12 blocks.)

**It never runs.** Whenever it comes for you — the chase, a lunge when you spot it, the attack once it reaches you,
the strike when you walk up to it — it floats a block off the ground, with no footsteps, only a rush of air, and
strikes from the air with its legs hanging limp. **When it hunts you** (the chase, from the fourth stage) it surges
at you when you look away and drifts, limp, while you watch it. **Climbing
will not save you:** get up on a pillar, a ledge, a roof or a ladder and it climbs the wall after you and strikes
from there. **Water still does:** it will not cross it; it floats to the water's edge and hovers there, watching.

**It is dangerous.** On Standard and High aggression, once it reaches you it keeps attacking until you are dead or
you drive it off with the Witness Lens or a blow. Every strike is wound up for about half a second first: step back
and it misses. It is faster than you can sprint and it climbs, so do not try to outrun or out-climb it — light, water, the lens, a
flare, a held gaze before it reaches you, or a friend watching it are your outs. (Holding its gaze is a defence once
it is already coming for you — in the chase or the sealed tunnel; while it is only watching, a long stare is what
sets it off.) Walk right up to it and it usually tears apart before
you can touch it — but now and then it strikes first. On Low aggression it strikes once (never more than 70 % of
your health while you are above half); on "Never attacks" and on Peaceful it never hurts you.

**The Mire's wood** (logs, wood and planks) burns in a furnace like any other, its logs smelt into charcoal, and
**Bone Root** crafts into three bone meal.

**Its home is the Weeping Mire**, a swamp of black-barked weeping trees, bone roots and silt ponds under a black fog,
where the wind gusts and leaves fall. It is never far from where a new world starts — often right beside it — but you
never start inside it: if the world's spawn falls in the Mire, you arrive just outside its edge, looking into it (and
the world spawn moves there too). Out there it stands among the trees and watches you; look at it, or come within
nine blocks, and it is gone in black mist. Torn pages lie on the ground — eight in all. Reading one sometimes brings it
up behind you, and the last of the eight always does. In the Mire it does not wait for you to settle in: the grace
period ends after half a minute there, it comes sooner and more often, and it behaves as if you were one stage further
along. To find the Mire with cheats on: `/locate biome wmire:weeping_mire`.

**In taiga forests** you may see it far off between the trunks, staring. Look straight at it and it is gone —
and somewhere, the cave answers. Those shadows are harmless (they can be switched off in the settings).

**It learns.** Each time you get away from it, it remembers how: running for the light, jumping into water, staring
it down, the Witness Lens, hitting it, outrunning it, breaking through its Veil, or a flare. Use the same way three
times and it adapts to that one (it puts your lights out first, waits at the shore, comes from behind, shrugs off
the first lens or flare, seals the way twice, follows further). It only ever adapts to one way at a time, so the
others still work, and it forgets if you change your habits. Your Field Notes say what it has learned.

**When the music stops** (from the fourth stage), something may be coming: the game's music goes quiet for you alone
and a faint ringing rises for 20–30 seconds. Usually it comes. Sometimes nothing does.

**Other things you may find:** pages in your Field Notes that you did not write, quoting what you actually did (how
many blocks you mined, the time you went to sleep, how often you looked behind you); a sign by your bed or door with
your name on it; something you threw away waiting on your doorstep; an animal or villager that stops and turns its
head to follow you; and, late at night, the figure already standing in a dark corner of your home.

Some useful habits (no spoilers beyond what the game tells you early):
* If something changed, **put it back** — or look closely at it.
* If you hear something you did, from somewhere you are not, **go and look**.
* If steps behind you stop when you stop, **turn around**.
* It does not like being looked at. **Keep your eyes on it** when it matters — some nights it only moves while
  nobody is watching it.
* **Light** helps. So does a friend watching your back.

## The Config Wheel
The **Observer Config Wheel** (an iron gear with an eye) opens every setting and test tool. You get one the first time
you join a world as its only player or as an operator; anyone can craft one from *iron ingot + redstone + stick*.
Players who are not operators only see the status and their own caption setting.

| Button | What it does |
|---|---|
| status (top) | on/off and preset, your stage or how long until it begins, whether something may happen soon, how many changed blocks are waiting to be put back; warns you if your game mode keeps it away |
| **See it now** | a harmless preview: it appears a few blocks in front of you and shows each animation (watching, staring, head tilt, stalking walk, drifting, floating at you, strike wind-up in mid-air with its shriek, recoil in mid-air), named on screen, then floats at you and tears apart. Glowing wisps surround it; at night its eyes glow. Works in Creative, never hurts, changes nothing and does not count toward the story |
| **Start it for me now** / **Make something happen soon** | skips the grace period (or the current wait) for you; the first encounter follows within about a minute (Survival or Adventure only) |
| **Switch The Observer on/off** | master switch; switching off puts back everything it changed |
| **Presets** | Atmosphere, Standard, Relentless |
| **All settings** | frequency, aggression, environmental manipulation, sudden scares, camera effects, captions, grace period, world weather, developer tracing, taiga shadows, escape learning, the silence before attacks, pages you didn't write, returned items |
| **Encounter toggles** | one switch per encounter type (with the stage it unlocks at); switched-off types are never chosen |
| **Test an encounter** | starts something on you right now. First the single behaviours (red): **The Vigil (practice)** (three rounds, no reward, nothing recorded), **The Strike** (it floats at you and keeps attacking from the air until you die or drive it off — Low aggression: one strike), **The Lunge** (look at it and it comes at you), **Peeking from cover** (behind a tree within 20 blocks, or beside a wall corner ahead; with neither it says so), **Taiga shadow** (the illusion, here anywhere), **Getting too close** (walk up to it), **The Flare** (it stares; throw a flare near it — you get one if you have none), **The world goes quiet** (20 s of silence, then nothing), **A page you didn't write** (one appears in your Field Notes now), **It returns what you threw away** (needs a home it knows: drop something and walk 10 blocks away), **The floating chase** (it floats at you and tears apart 3 blocks short), **Climbing after you** (stand on something 3+ blocks high: it climbs up to you, then lets go). Then every encounter. If the place is unsuitable it tells you what that one needs (for example, *The Closed Path* needs a tunnel at least 3 blocks high). Tests never count toward your story |
| **Undo its changes** | puts back every block it changed and ends whatever it is doing |
| **Sound captions** | your own caption setting |

Encounters only come for players in **Survival or Adventure**; in Creative it leaves you alone (the preview still works).

## Your tools
| Item | How to get it | What it does |
|---|---|---|
| **Observer Config Wheel** | first join (only player / operators), or craft *iron ingot + redstone + stick* | settings and test tools (above) |
| **Field Notes** | given after your first discovery, or craft *book + charcoal* | Use it to read your pages (what you noticed, and the rules you have learned), toggle sound captions, keep the vigil, open settings (operators) |
| **Tally Chalk** | craft *calcite + bone meal* (×8) or *diorite + bone meal* (×4) | Use while looking at a block to mark it (up to 8 marks; sneak-use on a mark to remove it). If it changes anything within 4 blocks of a mark, the mark smudges and you are told |
| **Vestige** | each discovery; breaking an Effigy | Crafting material |
| **Witness Lens** | craft *spyglass + 2 Vestiges + amethyst shard* | Use while looking at it: it recoils and withdraws. With nothing to hold, the lens shows where it has walked and where its effigies are. 20 s cooldown |
| **Ward Lantern** | craft *lantern + 2 Vestiges* | Place it: within 12 blocks it will not stand or change any block (and puts back anything it already changed there) |
| **Flare** | craft *glowstone dust + gunpowder + paper* (×8) | Use to throw it. Where it lands it burns for 8 seconds with real, bright light and a hissing glare. While it burns, the Observer within 16 blocks of it recoils and tears apart — even in the middle of an attack (a strike already winding up does no damage). Each flare is used up; once it has learned flares, the first one in an encounter only makes it flinch |

## Discoveries and the long-term goal
Every time you notice or answer something, a page is written in your Field Notes and you receive a Vestige. With
**12 pages** and a **Witness Lens**, at night near the place you return to most, the Field Notes let you **keep the
vigil**. Succeed and you are *Witnessed*: you receive The Observer's Eye and choose how it remains — watching gently,
hunting at full intensity, or letting you be.

## Settings (operators)
Open with the **Config Wheel**, *Field Notes → Settings*, or `/observer:settings`. Presets:

| Preset | Feel |
|---|---|
| **Atmosphere** | rare, never attacks, subtle changes only, no sudden scares, fades only |
| **Standard** | the intended experience |
| **Relentless** | frequent, aggressive, more invasive changes |

Individual controls: encounter frequency, aggression (never attacks / low / standard / high), environmental
manipulation (off / subtle / standard / unsettling), sudden scares (off / rare / standard), camera effects
(none / fades only / full), default captions, grace period, world-wide weather during the vigil, developer tracing,
and on/off switches for the taiga shadows, escape learning, the silence before attacks, pages you didn't write, and
returned items. The encounter toggles switch off *It's Inside*, *Signs* and *Borrowed Eyes* like any other encounter.
On **Peaceful** difficulty it never attacks.

## Accessibility
* **Sound captions:** Config Wheel or Field Notes → *Sound captions* (per player) shows important sounds as on-screen text
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
* Now and then it leaves a sign by your bed or door — only in an empty spot, never replacing anything.
* It never touches chests or any container, beds, your own signs, redstone, portals or anything else. It may move an
  item you threw away (the same item, never a copy).
* Every change is recorded and reverted later (its signs after 20 minutes). If you change the block yourself, your
  change wins.
* Blocks it places drop nothing when broken.

## Removing the add-on
1. As an operator, use Config Wheel → *Undo its changes* (or run `/observer:restore`) to revert every recorded change.
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

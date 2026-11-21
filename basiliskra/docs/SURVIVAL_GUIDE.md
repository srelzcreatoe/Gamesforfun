# Basiliskra: survival setup guide

**For:** Minecraft Bedrock **1.26.60** (retail). **Script module:** stable `@minecraft/server` **2.11.0**.
No experiments, no Beta APIs, no cheats, no commands. It can be added to a survival world you already play.

## Install

1. Open `Basiliskra-1.0.0.mcaddon` on the device (double-click on Windows, "Open in Minecraft" on phone or tablet). Both packs import.
2. Edit your world → **Behavior Packs** → activate **Basiliskra**. The resource pack is pulled in with it. Leave every toggle under **Experiments** off.
3. Play. Nothing happens straight away, and nothing is announced in chat. The story is found by playing.

Realms and multiplayer: apply both packs to the world; players download the resource pack on joining. Consoles can use the add-on only through a Realm or a world transferred from another device.

Vibrant Visuals: supported. Every texture ships a PBR texture set; the lit parts of his hide are emissive there. With Vibrant Visuals off he looks the same, minus that.

## What calls him

He is called once per world, by harm done to one stretch of country:

* **Passive animals killed by players**, repeatedly, in the same area (about 64 blocks across).
* **Habitat removed there**: trees, reeds, shoreline plants.

Both are needed, and both have to be repeated. One meal weighs almost nothing, one tree weighs almost nothing, animals that die without a player weigh nothing. Country that is left alone recovers (half the score every two days). Blame is kept per player: a friend who joins later inherits none.

When a region crosses the line, the nearest deep, open water is chosen (roughly six blocks deep with a clear lane about forty-five long). If there is none in reach, the call waits, gives way to a later call from somewhere else, and lapses after about ten minutes of searching with a player nearby. Harm far inland calls nobody until it is also done near real water.

Then, at dusk, with someone near that coast: fish bunch, an empty boat knocks three times against a pier if there is one, a red seam opens in the water, and he comes through. You can move the whole time.

## The three stages (one animal)

| Stage | Where | What moves him on |
|---|---|---|
| **Basiliskra I** | deep water | Time (two days), repeated surfacings near players, and at least three of his spasms, then a gravel or sand shelf to beach on with a player near |
| **Basiliskra II** | the shore, villages | Time (two days) and about 220 blocks dragged overland; it happens at night or in rain with a player near |
| **Basiliskra III** | anywhere he can walk | The last crossing (below) |

There is never more than one. He keeps his health across stages and across saving and loading. He cannot be killed: worn down to his last breath he is taken by a seam and comes back through the first one a day later, whole, in the stage he had. `/kill` does the same.

Things worth knowing, without spoiling how you find them:

* **Three knocks, 0.9 seconds apart**, mean something every time you hear them. In the water they are a warning to get behind a solid block.
* He has one voice. You first hear it through the water, the night he arrives; younger and higher on the shore; whole when he stands up as Basiliskra III. He roars when he knows you, when a lightning rod robs him of his charge, and once more as he goes home.
* He hears splashes. Two close together bring him; he learns, and the trick has a cooldown.
* A narrow gap in the water stops him: head through, shoulders not.
* Form II's drag has a rest in it. That rest is your gap.
* Form III's beam is aimed for most of the charge and then locked: when the eye stops following, step sideways. Solid cover works. After he fires there is a long recovery.
* **A lightning rod (any weathering, waxed or not) within 10 blocks of his planted tail club** takes the charge instead. The rod needs half a minute before it can do it again.

## The ending

It needs Form III, a **shed fin**, **note blocks**, and a **lightning rod**.

1. When he first leaves the water he sheds a strip of fin on the beach. If you lose it, another lies at that beach for whoever comes without one. Held in the hand it pulses, faster as you near the place the seam opened.
2. At that place the seam itself teaches the rhythm, with three faint pulses over and over (only once he is Form III).
3. Play **his three knocks on note blocks within 24 blocks of the seam**: three notes, 0.55 to 1.3 seconds apart (0.9 is his), and keep the pattern going. By hand is fine. Solo, a repeater clock on a note block does it for you (one note every 18 ticks).
4. He comes to the bank nearest the seam and charges with his tail towards it. **Ground that charge with a lightning rod that stands within 48 blocks of the seam.** That opens it.
5. He tests it with the notched tip of his tail, turns, and goes through headfirst. **Keep the rhythm going until his tail is through.** If it stops for more than three seconds he backs out, the seam closes, and you can try again after half a minute.

Only when he is wholly across is the story over for that world. After that nothing calls another one, and a summoned one is removed.

## Settings

Open `scripts/main.js` in the behaviour pack, find `BASILISKRA CONFIG` near the top, edit, reload the world.

| Setting | Default | Meaning |
|---|---|---|
| `pacing` | `1.0` | Story speed. `2` halves every wait and threshold. |
| `terrain` | `"scorch"` | `"none"`: particles and sound only. `"scorch"`: the beam chars the world's own ground where it lands (stone to smooth basalt, grass and dirt to coarse dirt). `"break"`: also breaks the one natural block it hits. |
| `marks` | `true` | Furrows (II) and footprints (III) on open, unbuilt ground. |
| `damage` | `1.0` | Multiplier on everything he does to players. |
| `harmlessOnPeaceful` | `true` | On Peaceful he appears and behaves but hurts nobody. |
| `debug` | `false` | Operator hooks through `/scriptevent` (needs cheats). |

What is never changed in any mode: anything with an inventory, beds, portals, redstone, glass, planks, bricks or any other built block; a raised wall or pillar even of raw stone; ground a building stands against; and ground only silk touch can move (podzol, mycelium, moss, mud, clay, snow). If the beam lands on a building, nothing around it is touched either. He uses no real lightning.

## Good to know

* His body is covered by invisible hit volumes from nose to tail, so a hit anywhere counts and you are pushed out of him rather than through him.
* He walks round buildings and cliff faces and shoulders through trees. He does not enter water over his depth by choice; if he ends up in it he swims.
* If the coast he is at unloads (you go to the Nether), he is still there when you return. An empty area is never treated as "he is gone".
* Removing the packs leaves at most one inert entity that removes itself; the world is otherwise untouched.

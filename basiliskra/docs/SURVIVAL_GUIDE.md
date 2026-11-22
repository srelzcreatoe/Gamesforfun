# Basiliskra: survival setup guide

**For:** Minecraft Bedrock **1.26.60** (retail). **Script module:** stable `@minecraft/server` **2.11.0**.
No experiments, no Beta APIs, no cheats, no commands. It can be added to a survival world you already play.

## Install

1. Open `Basiliskra-1.3.1.mcaddon` on the device (double-click on Windows, "Open in Minecraft" on phone or tablet). Both packs import.
2. Edit your world → **Behavior Packs** → activate **Basiliskra**. The resource pack is pulled in with it. Leave every toggle under **Experiments** off.
3. Play. Nothing happens straight away. The story is found by playing; the journal tells you how close it is.

**Updating from an earlier version**: open the world's settings, remove Basiliskra from Behavior Packs and Resource Packs, save, and leave the world. In Settings → Storage, delete the old Basiliskra packs. Then import 1.3.1 and add it to the world again. Nothing in the world is lost: the story is kept in the world itself. Settings you chose are kept; a world that never chose how destructive he is gets the new default (he destroys like the Wither).

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

He grows: Basiliskra II stands a quarter bigger than Basiliskra I would, and Basiliskra III is drawn 1.7 times his model, close to seventy blocks from nose to club, his back as high as a tall tree. His body can be hit anywhere on it, his legs and feet included: the hit volumes on his legs move with them as he walks.

There is never more than one. He keeps his health across stages and across saving and loading. He cannot be killed: worn down to his last breath he is taken by a seam and comes back through the first one a day later, whole, in the stage he had. `/kill` does the same.

Things worth knowing, without spoiling how you find them:

* **Three knocks, 0.9 seconds apart**, mean something every time you hear them. In the water they are a warning to get behind a solid block.
* He has one voice. You first hear it through the water, the night he arrives; younger and higher on the shore; whole when he stands up as Basiliskra III. Between times he grunts, huffs and growls. He **roars**:
  * after every atomic breath;
  * when he picks something new to go after;
  * now and then for no reason anyone can see (a minute to three apart, never on a beat);
  * when he knows you, when a lightning rod robs him of his charge, when he is driven off, when he changes, and once more as he goes home.

  Every roar shakes the screen (hard near him, less further off) and throws a **shockwave** out along the ground from his feet: it knocks players and animals away from him and hurts them, flattens plants, blows snow and wild leaves off and, while he is destroying like the Wither, shatters glass, lanterns and torches.
* He hears splashes. Two close together bring him; he learns, and the trick has a cooldown.
* A narrow gap in the water stops him: head through, shoulders not.
* Form II's drag has a rest in it. That rest is your gap.
* **The atomic breath** (Form III) is timed to its sound. The club plants and the charging begins; for about seven seconds the plates light from tail to head and his eye follows you. Then the eye stops following: **that is the moment to step sideways.** The shot itself lasts about seven and a half seconds. It drifts slowly after its target (never as fast as you can walk sideways), throws smoke and embers along its whole length, and blasts, burns and craters whatever it lands on. While he is destroying like the Wither it blows cover away too, so do not count on a wall; in the gentler settings solid cover still works. After it he vents with three knocks, roars, and rests a while.
* **A lightning rod (any weathering, waxed or not) within 10 blocks of his planted tail club** takes the charge instead. The rod needs half a minute before it can do it again.

## Out of control

Basiliskra III does not care what is around him.

* He goes after **players and animals alike** (any creature: cows, villagers, wolves), and turns his breath on them as readily as on you.
* Whatever is under a foot when it comes down is trodden: it hurts, and throws you. Being caught under him as he walks hurts too.
* **He smashes straight through buildings in his way** (in the default destruction setting). Only the world's own rock and cliffs still turn him.
* The wither-like destruction never touches bedrock, portals or command blocks, and by default spares **chests, barrels, shulker boxes, beds, furnaces, hoppers and anything else that holds things**, and the obsidian a portal stands in. You may find a chest standing alone in the rubble.
* The config wheel's Settings can make him gentler: destruction can be reduced to scorching or nothing, the storage protection turned off, and his hunting of animals turned off.

## The ending

It needs Form III, a **shed fin**, **note blocks**, and a **lightning rod**.

1. When he first leaves the water he sheds a strip of fin on the beach. If you lose it, another lies at that beach for whoever comes without one. Held in the hand it pulses, faster as you near the place the seam opened.
2. At that place the seam itself teaches the rhythm, with three faint pulses over and over (only once he is Form III).
3. Play **his three knocks on note blocks within 24 blocks of the seam**: three notes, 0.55 to 1.3 seconds apart (0.9 is his), and keep the pattern going. By hand is fine. Solo, a repeater clock on a note block does it for you (one note every 18 ticks).
4. He comes to the bank nearest the seam and charges with his tail towards it. **Ground that charge with a lightning rod that stands within 48 blocks of the seam.** That opens it.
5. He tests it with the notched tip of his tail, turns, and goes through headfirst. **Keep the rhythm going until his tail is through.** If it stops for more than three seconds he backs out, the seam closes, and you can try again after half a minute.

Only when he is wholly across is the story over for that world. After that nothing in the world calls another one. (A spawn egg or the spawn command still brings him back, if you choose to.)

## Fallout

His light poisons what it touches. Where his beam lands, where the ridge scatter strikes, where a lightning rod takes his charge, where he changes from one stage to the next, and where the seam opens, he leaves **fallout**. It fades by half every three in-game days.

* **In the air:** crimson motes rise and shimmer over it, and you hear **Geiger clicks**, faster the closer you are to its heart. Radiation drifts off his plates all the time, thickly while he charges and fires.
* **On the land** (natural ground only, never anything built or farmed):
  * grass and dirt turn to **Irradiated Soil**, ashen and specked with crimson that glows faintly;
  * plants wither, wild leaves fall (leaves you placed stay), and snow melts;
  * sand his beam touches fuses into **Scarlet Trinitite**, a glassy crimson block that glows. Trinitite stays; the soil heals back to dirt as the fallout fades.
* **On you:** strong fallout makes you hungry, then weak and queasy, then sick. These are ordinary effects, so **milk clears them**. Creative players and (by default) Peaceful worlds are spared. Creatures in it slow down.
* **Geiger Counter:** craft one from scarlet trinitite, a copper ingot and redstone. Held, it shows the radiation where you stand and the way to the nearest fallout.

The journal has a Fallout section too. In the config wheel's Settings, fallout can be turned down to motes and clicks only, or off, and the sickness can be turned off.

## The journal

Every player gets a **Basiliskra Journal** the first time they join with the pack on (craft another from a book and kelp). Use it (right-click, or press and hold) or type `/basiliskra:journal`. It shows:

* **His anger** near you: how close the area you are in is to calling him, as a percentage that only rises with harm; **how many animals have been killed there by players, and how many logs, reeds and shore plants cut**, as plain counts, with what they count for against what it takes (both are needed: animals *and* habitat); your own share; roughly how many more it would take. Anger is kept per 64-block area; the journal shows the angriest area around you, so stepping over an edge does not make it vanish. It also shows the angriest place in the world and which way it is, and your own totals everywhere.
* The first kills of a spree and the first logs of a tree count for less, which is why three kills count as about 1.6 of the 8 needed.
* **When he comes**: not yet; called and looking for deep water (and where); coming at the next dusk (and how many minutes that is, and which water); here now (and how far away); driven off (and when he returns); or gone home.
* **Him**, once he is here: how close he is to changing, and what it takes.

Reading it never changes anything.

## The config wheel

Operators (and the player of a single-player world) also get a **Basiliskra Config Wheel** (craft one from a copper ingot, redstone and kelp). Use it, or type `/basiliskra:config`:

| Button | What it does |
|---|---|
| Settings | Everything in the table below. Saved with the world, so it survives reloads and pack updates. |
| Bring him here | The one Basiliskra comes to you, as he is in the story or as I, II or III. |
| Call him | Opens the rift for him at the nearest deep, open water, at the next dusk. |
| Skip to dusk | Sets the time to dusk. |
| Send him back through the seam | He leaves and comes back a day later, as when he is worn down. |
| Journal | Opens the journal. |
| Reset the story | Forgets him, his form, what he learned and all the anger on record, as if the pack had just been added. Asks first. |

## Spawning him yourself

There is still only ever one Basiliskra. Calling him on purpose brings **that one** to you: if he is about he is moved to you, and if he is not, the new body becomes him and the old one is removed when its chunk next loads.

* **Spawn egg**: "Spawn Basiliskra", in the Creative inventory with the other spawn eggs (or `/give @s basiliskra:basiliskra_spawn_egg`, which needs cheats). In a world he has never come to, the egg makes Basiliskra I on deep water and Basiliskra III on land. After that it brings him as he is in the story, unless the Settings say otherwise.
* **`/basiliskra:spawn [story|i|ii|iii]`**: operators, **no cheats needed**. He appears a short way in front of you, facing you. Basiliskra I goes to the nearest deep water instead.
* `/summon basiliskra:basiliskra` (needs cheats) works like the egg.

Wherever you bring him becomes his home: with nobody about he wanders round it, and if he is sent back or worn down he comes back there a day later (on land, for Basiliskra II and III). While anyone is near, Creative players included, he keeps round them; only players in Survival or Adventure are hunted.

Turn "Spawn eggs and /summon bring him to you" off in the Settings to have them removed instead.

## Settings

In game: the config wheel's **Settings**. The defaults below are in `scripts/main.js` (search for `BASILISKRA CONFIG`); what you choose in game is saved with the world over them.

| Setting | Default | Meaning |
|---|---|---|
| Story speed (`pacing`) | `1.0` | `2` halves every wait and threshold. Pick one from the list, or type any number from 0.25 to 4 in the box under it. |
| What his beam, roar and weight do (`terrain`) | destroy, like the Wither | **Destroy**: the beam blasts craters out of anything it meets and sets fires, the roar shatters glass, and he smashes through buildings. **Scorch and break** / **scorch**: only natural ground at the beam's impact is scorched (stone to smooth basalt, grass and dirt to coarse dirt) and, with break, the one natural block hit is broken; he walks round buildings. **Nothing**: light and sound only. |
| Spare chests, beds, furnaces and portals (`spareStorage`) | on | In destroy mode: anything that holds things, beds, and portal obsidian are left standing. |
| Footprints and furrows (`marks`) | on | Furrows (II) and footprints (III) on open, unbuilt ground. |
| Damage to players (`damage`) | `1.0` | Multiplier on everything he does to players. Pick one, or type any number from 0 to 4. |
| Harmless on Peaceful | on | On Peaceful he appears and behaves but hurts nobody. |
| He hunts animals and other creatures (`huntMobs`) | on | Off: he only goes after players (creatures in the way of his beam or his feet still suffer). |
| Spawn eggs and /summon bring him (`allowSummon`) | on | Off: they are removed instead. |
| A spawn egg makes (`spawnForm`) | his stage in the story | Or always I, II or III. |
| Give new players the journal | on | |
| Give operators the config wheel | on | |
| Debug messages | off | Fault messages in the content log, and operator hooks through `/scriptevent basiliskra:debug` (needs cheats). |
| His fallout (`fallout`) | changes the land | Off; or glowing motes and Geiger clicks only; or also changes the land (natural ground only). |
| Radiation sickness (`sickness`) | on | Players in strong fallout get hungry, weak and sick. |

There are no sliders (they could not be dragged on some phones): every number is a list to pick from, with a box to type your own.

Never changed, in any mode: bedrock, portals, end portal frames, barriers, command and structure blocks. With storage spared (the default): anything with an inventory, beds, signs, and obsidian.

In the scorch and break modes nothing built is ever touched: not redstone, glass, planks, bricks or any other built block; not a raised wall or pillar even of raw stone; not ground a building stands against; not ground only silk touch can move (podzol, mycelium, moss, mud, clay, snow). If the beam lands on a building, nothing around it is touched either.

His destruction drops nothing: what his breath or his weight breaks is gone. He uses no real lightning and no real explosions (the blasts are his own, so nothing he does is stopped by blast resistance, and nothing is set off).

## Good to know

* His body is covered by invisible hit volumes from nose to tail, legs and feet included, so a hit anywhere counts and you are pushed out of him rather than through him.
* In destroy mode he smashes through buildings; otherwise he walks round them. He always walks round cliff faces and shoulders through trees. He does not enter water over his depth by choice; if he ends up in it he swims.
* If the coast he is at unloads (you go to the Nether), he is still there when you return. An empty area is never treated as "he is gone".
* Removing the packs leaves at most one inert entity that removes itself; the world is otherwise untouched.

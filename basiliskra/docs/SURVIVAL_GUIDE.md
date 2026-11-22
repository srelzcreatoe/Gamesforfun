# Basiliskra: survival setup guide

**For:** Minecraft Bedrock **1.26.60** (retail). **Script module:** stable `@minecraft/server` **2.11.0**.
No experiments, no Beta APIs, no cheats, no commands. It can be added to a survival world you already play.

## Install

1. Open `Basiliskra-1.4.0.mcaddon` on the device (double-click on Windows, "Open in Minecraft" on phone or tablet). Both packs import.
2. Edit your world → **Behavior Packs** → activate **Basiliskra**. The resource pack is pulled in with it. Leave every toggle under **Experiments** off.
3. Play. Nothing happens straight away. The story is found by playing; the journal tells you how close it is.

**Updating from an earlier version**: open the world's settings, remove Basiliskra from Behavior Packs and Resource Packs, save, and leave the world. In Settings → Storage, delete the old Basiliskra packs. Then import 1.4.0 and add it to the world again. Nothing in the world is lost: the story is kept in the world itself. Settings you chose are kept; a world that never chose how destructive he is gets the new default (he destroys like the Wither).

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

He changes twice. Each change waits on a short list of things, and **the journal shows that list as a checklist** (done / not done, and how much is left), so you never have to guess.

**Basiliskra I → II** (in deep water). All three, then the last step:

1. two in-game days in the water;
2. seen at the surface six times (he comes up under boats and near swimmers);
3. three spasms (they take him near piers, and in open water at dusk);
4. then he **beaches on a sand or gravel shore with a player near**, and changes there.

**Basiliskra II → III** (on the shore). Both, then the last step:

1. two in-game days on the shore;
2. 220 blocks dragged overland (he wanders while anyone is near);
3. then he changes **at night or in rain, with a player near**.

**Basiliskra III** stays until the last crossing (below). A fourth form is built and comes in the next version.

An operator can skip the waiting: the config wheel's **Make him change now**. Story speed (Settings) shortens every wait.

**Every change is a scene.** Light is drawn into him for seven seconds while the ground shakes, the screen flashes, and he stands up as what he is next and roars. Everyone within 120 blocks is shown it from a camera that circles him (switch "Cutscenes" off in the Settings to keep your own view).

**His arrival is a scene too.** A rift tears open: a tall crimson tear with a white core, lightning crawling off it, rings of light running out along the ground. In deep water he rises out of it; on land (when he is called back as II or III) he walks out of it, appearing piece by piece as he crosses. The sky flashes red for everyone near.

He grows: Basiliskra II stands a quarter bigger than Basiliskra I would, and Basiliskra III is drawn 1.7 times his model, close to seventy blocks from nose to club, his back as high as a tall tree. His body can be hit anywhere on it, his legs and feet included: the hit volumes on his legs move with them as he walks.

There is never more than one. He keeps his health across stages and across saving and loading. He cannot be killed: worn down to his last breath he is taken by a seam and comes back through the first one a day later, whole, in the stage he had. `/kill` does the same.

Things worth knowing, without spoiling how you find them:

* **Three knocks, 0.9 seconds apart**, mean something every time you hear them. In the water they are a warning to get behind a solid block.
* **You hear him from 200 blocks**: the roar, the breath, the grunts, his footfalls. Far off it is quieter and comes from his direction.
* **His mouth moves with his voice.** The jaw opens with every grunt and growl, and during a roar it follows the loudness of the roar itself, as does the shaking of your screen.
* He has one voice. You first hear it through the water, the night he arrives; younger and higher on the shore; whole when he stands up as Basiliskra III. Between times he grunts, huffs and growls. He **roars**:
  * after every atomic breath;
  * when he picks something new to go after;
  * now and then for no reason anyone can see (a minute to three apart, never on a beat);
  * when he knows you, when a lightning rod robs him of his charge, when he is driven off, when he changes, and once more as he goes home.

  Every roar shakes the screen (hard near him, less further off) and throws a **shockwave** out along the ground from his feet: it knocks players and animals away from him and hurts them, flattens plants, blows snow and wild leaves off and, while he is destroying like the Wither, shatters glass, lanterns and torches.
* He hears splashes. Two close together bring him; he learns, and the trick has a cooldown.
* A narrow gap in the water stops him: head through, shoulders not.
* Form II's drag has a rest in it. That rest is your gap.
* **The atomic breath** (Form III) is timed to its sound. The club plants and the charging begins; for about seven seconds the plates light from tail to head, sparks are drawn out of the air into his mouth, and his eye follows you. Then the eye stops following and **a thin red line shows exactly where the beam will go: that is the moment to step sideways.** It lights with a flare and a shock ring at his mouth (screens near him white out for an instant). The shot lasts about seven and a half seconds: rings race down it, lightning crawls along it, it throws smoke and embers the whole way, and where it lands there is a glare, a ring of fire across the ground and a fountain of sparks. It drifts slowly after its target (never as fast as you can walk sideways), and blasts, burns and craters whatever it lands on. While he is destroying like the Wither it blows cover away too, so do not count on a wall; in the gentler settings solid cover still works. After it he vents with three knocks, roars, and rests a while.
* **A lightning rod (any weathering, waxed or not) within 10 blocks of his planted tail club** takes the charge instead. The rod needs half a minute before it can do it again.

## Out of control

Basiliskra III does not care what is around him.

* He goes after **players and animals alike** (any creature: cows, villagers, wolves), and turns his breath on them as readily as on you.
* Whatever is under a foot when it comes down is trodden: it hurts, and throws you. Being caught under him as he walks hurts too.
* **He walks through whatever is in his way** (in the default destruction setting): houses, walls, woods. They are broken ahead of him as he comes, from the ground up, and a cliff in his road is cut down to a step he can take. He walks *through*, not down: the ground he walks on stays, and a gentle rise is simply climbed.
* **He finds his way.** Walled in on three sides, or behind a long wall, every form now works out the way round (Basiliskra I round a harbour mole, II and III round walls when they are not destroying).
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

His light poisons what it touches. Where his beam lands, where the ridge scatter strikes, where a lightning rod takes his charge, where he changes, and where a rift opens, he leaves **fallout**.

**It spreads, and then it goes.** A patch of fallout grows for about a minute, to more than twice the size it was left with (a ring of sparks marks its edge while it grows). It stands at full strength for a while, then fades, and the land heals. A trace is gone in two and a half minutes, the heart of a full beam in five and a half.

* **In the air:** crimson motes rise thickly all over it, you hear **Geiger clicks** (faster the closer you are to its heart), and in strong fallout **the air itself turns red**.
* **On the land** (natural ground only, never anything built or farmed), the ground **glows**:
  * soil, sand and gravel turn to **Irradiated Soil**; bare rock turns to **Irradiated Rock**, split by glowing veins;
  * **Crimson Crystals** grow out of the poisoned ground: clusters of red spikes that light the area. Break them for **Crimson Shards** (they crumble when the fallout fades, so take them while you can);
  * plants wither, wild leaves fall (leaves you placed stay), and snow melts;
  * where the beam itself blows a crater, the rock under it runs to **Glowing Slag** (it burns to stand on) and sand fuses into **Scarlet Trinitite**.
* **When it fades** every irradiated block goes back to *exactly* what it was (grass to grass, deepslate to deepslate), the crystals crumble, and the slag cools to dark **Cooled Slag**. Trinitite and cooled slag stay, as the scar. A glowing block that was somehow missed puts itself right a few minutes later.
* **On you, it is strong:** hunger at once, then weakness and nausea, then poison; stand in the heart of a fresh zone for more than a few seconds and it **burns**. Creatures caught in it wither.
  * **Iodine Tablets** (2 dried kelp + sugar, makes 2): swallow them and the fallout cannot sicken you for four minutes. They do not stop glowing slag burning your feet.
  * **Milk** clears what it has already done.
  * Creative players and (by default) Peaceful worlds are spared.
* **Geiger Counter:** scarlet trinitite *or* a crimson shard, plus a copper ingot and redstone. Held, it shows the radiation where you stand, how long your iodine has left, and how far and which way the fallout is.
* **Shard Lamp:** four crimson shards round a block of glass. A full-brightness crimson lamp that never goes out.

The journal has a Fallout section too. In the config wheel's Settings, fallout can be turned down to motes and clicks only, or off, and the sickness can be turned off.

## His themes

Three pieces of music are his, and they play as ordinary game music (the **Music** slider sets how loud; "His music" in the Settings switches them off):

* **"He is near"** while he is within about 80 blocks and awake;
* **"He is fighting"** when he charges his breath, chases, throws lightning, rams a boat or is hurt, and for a little while after;
* **"The last form"** during each change and the last crossing.

They fade in, loop, and fade out a few seconds after he is gone.

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
| Call him now (the rift opens) | At once, not at dusk. If he has never come, the rift opens in the nearest deep water and Basiliskra I rises from it. If he was here before as II or III and is away, the rift opens on the ground in front of you and he walks out as he was. |
| Bring him here (no rift, pick a form) | The one Basiliskra is put a short way in front of you, on the ground, as he is in the story or as I, II or III. Basiliskra I needs deep water within 96 blocks and goes there. |
| Make him change now (next form) | Plays the change, with its scene, without waiting for the list in the journal. |
| Send him away (until he is called) | He leaves through a rift and **stays gone**. The story goes back to its beginning: the next time he is called he comes as Basiliskra I. The anger on record and his fallout stay. Asks first. |
| Skip to dusk | Sets the time to dusk. |
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
| Radiation sickness (`sickness`) | on | Players in fallout get hungry, weak and sick, and burn in the heart of it. |
| Cutscenes (`cutscenes`) | on | The camera shows everyone near the rift opening and each change. Off: you keep your own view. |
| His music (`music`) | on | His three themes. |

There are no sliders (they could not be dragged on some phones): every number is a list to pick from, with a box to type your own.

Never changed, in any mode: bedrock, portals, end portal frames, barriers, command and structure blocks. With storage spared (the default): anything with an inventory, beds, signs, and obsidian.

In the scorch and break modes nothing built is ever touched: not redstone, glass, planks, bricks or any other built block; not a raised wall or pillar even of raw stone; not ground a building stands against; not ground only silk touch can move (podzol, mycelium, moss, mud, clay, snow). If the beam lands on a building, nothing around it is touched either.

His destruction drops nothing: what his breath or his weight breaks is gone. He uses no real lightning and no real explosions (the blasts are his own, so nothing he does is stopped by blast resistance, and nothing is set off).

## Good to know

* **Hit him anywhere.** Every form is covered by invisible hit volumes from the tip of the snout to the tip of the tail, generated from the model itself: head, jaw, neck, body, every leg, every segment of tail. Hits on his head count from outside it. If the game ever fails to register a swing that plainly lands, the pack counts it anyway.
* In destroy mode Basiliskra III walks through buildings, woods and cliffs; otherwise (and for I and II) he works out a way round them. He does not enter water over his depth by choice; if he ends up in it he swims.
* If the coast he is at unloads (you go to the Nether), he is still there when you return. An empty area is never treated as "he is gone".
* Removing the packs leaves at most one inert entity that removes itself; the world is otherwise untouched.

# Basiliskra: survival setup guide

**For:** Minecraft Bedrock **1.26.60** (retail). **Script module:** stable `@minecraft/server` **2.11.0**.
No experiments, no Beta APIs, no cheats, no commands. It can be added to a survival world you already play.

## Install

1. Open `Basiliskra-1.7.2.mcaddon` on the device (double-click on Windows, "Open in Minecraft" on phone or tablet). Both packs import.
2. Edit your world → **Behavior Packs** → activate **Basiliskra**. The resource pack is pulled in with it. Leave every toggle under **Experiments** off.
3. Play. Nothing happens straight away. The story is found by playing; the journal tells you how close it is.

**Updating from an earlier version**: open the world's settings, remove Basiliskra from Behavior Packs and Resource Packs, save, and leave the world. In Settings → Storage, delete the old Basiliskra packs. Then import 1.7.2 and add it to the world again. Nothing in the world is lost: the story is kept in the world itself. Settings you chose are kept; a world that never chose how destructive he is gets the new default (he destroys like the Wither).

Realms and multiplayer: apply both packs to the world; players download the resource pack on joining. Consoles can use the add-on only through a Realm or a world transferred from another device.

Vibrant Visuals: supported. Every texture ships a PBR texture set; the lit parts of his hide are emissive there. With Vibrant Visuals off he looks the same, minus that.

## What calls him

He is called once per world, by harm done to one stretch of country:

* **Passive animals killed by players**, repeatedly, in the same area (about 64 blocks across).
* **Habitat removed there**: trees, reeds, shoreline plants.

Both are needed, and both have to be repeated. One meal weighs almost nothing, one tree weighs almost nothing, animals that die without a player weigh nothing. Country that is left alone recovers (half the score every two days). Blame is kept per player: a friend who joins later inherits none.

When a region crosses the line, the nearest deep, open water is chosen (roughly six blocks deep with a clear lane about forty-five long). If there is none in reach, the call waits, gives way to a later call from somewhere else, and lapses after about ten minutes of searching with a player nearby. Harm far inland calls nobody until it is also done near real water.

Then, at dusk, with someone near that coast: fish bunch, an empty boat knocks three times against a pier if there is one, a red seam opens in the water, and he comes through. You can move the whole time.

## The four stages (one animal)

He changes up to three times, and **time is the only thing a change waits on**: how long he has been what he is.

| Change | By the story's own clock | At story speed 1 that is |
|---|---|---|
| Basiliskra I → II | two in-game days | 40 minutes |
| Basiliskra II → III | two in-game days | 40 minutes |
| Basiliskra III → IV | three in-game days | 60 minutes |

Nothing else is asked for any more: no surfacings to be seen, no blocks dragged, no beams counted, no night, no rain, nobody watching. When his time is up he stops whatever he is idly doing (a breath or a roar is let finish first) and changes where he is. Basiliskra I makes for a beach first if one is in reach, and changes in the water if none is.

**Set the minutes yourself.** Settings → **Minutes in each form before he changes**: 1, 2, 5, 10, 20, 30 or 60 minutes for every change, or "the story's own timing" (the table above, which Story speed shortens). **The journal shows the minutes left.**

The last crossing (below) sends him home as III *or* as IV. Sending him home before he becomes IV is the safer story.

An operator can skip the waiting altogether: the config wheel's **Make him change now**.

**Every change is a scene of its own.** The three are different in what he does, what it does to the place, how long it takes and how it is filmed. Everyone within 140 blocks is shown it in close shots that cut from one to the next and keep him filling the picture; the HUD is hidden for the length of it and his name comes up. Nothing in any of them hurts anyone. (Switch "Cutscenes" off in the Settings to keep your own view: the scene still happens.)

* **I → II: the water boils** (about 16 seconds, then his roar). His gills knock three times, as on the night he came, and this time they do not open again. A spasm runs down him and the sea round him seethes, wider and harder. He rears out of the water, his fin tears away in a column of steam and thrown water, and what hauls itself up has horns, with lightning between them for the first time: three arcs, on the beat of the three knocks. Shots: his gills from beside his head; straight down on the boiling sea; low over the water as he rears; what is left when the steam goes; his horns; his face for the roar (the short one, younger).
* **II → III: the sky comes down** (about 18 seconds, then his roar). Arcs crawl between his horns and three bolts come down onto them out of the sky, each sooner than the last; he flinches at each, each lights more of him, and the ground they pass through into turns to glass. A fourth, the biggest, and he is standing on four legs with the charge running to ground through his club. Then his plates light one by one from the tail to the head, and he shakes the fire out of them. Shots: from beside his shoulder and below, up past his horns at the sky; straight down on him; his face; all of him, low; the new animal; along his back from the tail as the plates light; his face for the whole roar.
* **III → IV: he burns through** (about 22 seconds, no roar). It begins as a charge like any other, aimed at nothing, and it will not leave him. He vents, three knocks, and nothing goes out; the ground under him starts to glow, further out all the time; his whole hide flickers. Then the screen goes white. When it clears there is a dark shape in smoke with the fire shut inside it and one flank glowing; then the wings slam open and throw back whatever stands near (it does no harm); and he stands there lit from club to head. His name is kept until then. He does not roar: his first roar is still the one that comes after his first beam. Shots: along his back as the plates light; his face as he fails to fire; at his feet as the ground begins to glow; all of him, drawing back; from the ground up at the dark shape; from behind as the wings open; round to the front of him.

The bolts are drawn, not real lightning, and the glass in the ground appears only where the Settings let his fallout change the land.

**His arrival is a scene too.** A rift tears open: a tall crimson tear with a white core, lightning crawling off it, rings of light running out along the ground. The sky flashes red for everyone near.

* **Called with the wheel's Call him now, it opens out at sea**: in deep, open water off a beach (within 160 blocks), facing the shore, with water all round it and no block anywhere in its height, so it never stands inside a cliff, a pier or a house. Near a city it opens over the city's own deep. Basiliskra I rises out of it; II, III and IV wade out of it and up the beach. The message says how far out: *"The rift is opening in the sea 66 blocks from you."*
* Only with no such water in reach does it open on land, and then only where the whole tear stands in open air (none of it in a hill or a building). If there is neither, nothing opens and you are told so.
* **The arrival is filmed close, each shot placed from the size of the form that comes through.** Basiliskra I: the seam from the shore, low; close on the tear as it widens; the water above him as he comes up; his head breaking the surface. II, III and IV: the tear from the beach, low and wide; close in as it splits; the first of him through it, from low beside it; all of him coming on, from in front; his face as his name comes up.

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
* **The atomic breath** (Form III) is timed to its sound. The club plants and the charging begins; for about seven seconds the plates light from tail to head, sparks are drawn out of the air into his mouth, his jaw drops further and further, and his eye follows you. Then the eye stops following and **a thin red line shows exactly where the beam will go: that is the moment to step sideways.** It lights with a flare and a shock ring at his mouth (screens near him white out for an instant). **The breath comes out of his open mouth**, from the middle of the gap between his jaws, and is as wide as he is big: about two and a half blocks across for a young Basiliskra III, three when he has fired a few times, four for Basiliskra IV. The shot lasts about seven and a half seconds: a white-hot core in a sheath of plasma and fire, light racing down it, rings, a spiral, lightning crawling along it, smoke and embers the whole way, a burst of fire at his lips, and where it lands a glare, a ring of fire across the ground and a fountain of sparks. It drifts slowly after its target (never as fast as you can walk sideways), and blasts, burns and craters whatever it lands on. While he is destroying like the Wither it blows cover away too, so do not count on a wall; in the gentler settings solid cover still works. After it he vents with three knocks, roars, and rests a while.
* **He aims at what flies.** Against the Wither, the Ender Dragon, a ghast, phantoms, a player gliding: he tilts his head back as far as it goes (up to eighty degrees), aims where it is going rather than where it is, and keeps the beam on it as it moves. The Ender Dragon is a big target and is hit anywhere on its body.
* **A lightning rod (any weathering, waxed or not) within 10 blocks of his planted tail club** takes the charge instead. The rod needs half a minute before it can do it again.

## Basiliskra IV

The last form: upright on two legs, winged, about **fifty-five blocks tall and ninety long**, with the same face, the same crests, the same club. He is drawn at twice his model.

* **He walks across the world, not round a place**, and what is in his way is gone: the slab ahead of him, his own width and as high as he stands, is emptied as he comes (in the default destruction setting). He walks through, not down: the ground under his middle stays.
* **Every footfall blows a crater**, like the Wither, and hurts and throws whatever is within eight blocks of it. And every footfall sends **a shock rolling on ahead of him**, twenty blocks and more in front of his feet and as high as he stands, that breaks what is there before he reaches it.
* **His hands hang palms in**, toward his body, the way a big animal's do.
* **His breath reaches 150 blocks** and is thicker and hotter. He turns it on any player or creature he can see, from as far off as he can see it.
* **The stare.** Every minute or so he stops and looks at one player. While he can see you, you can barely walk (Slowness III). It lasts about eight seconds and wears off three seconds after he looks away, or at once if you get something solid between you and his eye.

**The six things he does** (each has a tell, and a place to be):

1. **His first roar comes after his first beam.** Whenever he arrives or becomes IV he is silent at first. A thin red beam cuts a line across the ground toward whoever is watching; three seconds of quiet; then the line pops into glass, one block at a time, back toward him; and when the last block turns, he roars. Called back near the sea, he comes out of the water to do it, and the line is cut across the beach.
2. **He turns on his buried club mid-breath.** About a second and a half into a shot the breath shoves him backward on his heels. He drives the club into the ground and **one foot comes off the ground: that is the side he will swing to**, and you have more than a second to read it. Then his whole body swings round the buried club (sixty to eighty degrees) and the beam with it. **Run toward the buried tail**: inside the arc is safe. Be gone before the swing ends: he rips the club free, and that hurts anyone within nine blocks of it.
3. **The shot that dies in his mouth.** Sometimes (never twice running) the charge fails: the sound cuts out, a little light leaks between his teeth, both wings slam open and every wing vein throws a thin beam into the ground behind him, fanned out. **Stand directly in front of his face**: nothing falls there.
4. **He hauls the seabed ashore.** Standing in the shallows with someone on the beach, he reaches down for two and a half seconds, digs in, and hauls. A front of black water thirty-five blocks wide races up the shore: it hurts and sweeps you inland, shoves boats up the beach, and leaves a boat and a couple of cod flapping where it stops. **Get out of its lane, sideways.** No water is moved: nothing floods.
5. **His broken plate keeps charging.** The third time he draws breath, a plate cracks off his back and stands in the ground beside him, taller than you. It lights when he charges. If you hide from his mouth (under a roof, behind a hill) but the plate can see you, **he fires into the plate and it throws the beam at you.** Where it leaves the plate is fixed when he fires: move. After three such shots it is burnt out and stays, blackened, as a landmark.
6. **The beam he swallows.** If you reach cover while he is still charging, he shuts his mouth on it. One side of his ribs glows; he walks round with his mouth dark and **fires the instant he sees you**. A red pulse climbs his neck every five seconds: **on the third he must let it go wherever he is facing.** Lead him to face the open sea and the shot goes over the horizon.

A lightning rod by his planted club still takes an ordinary charge, as it did for Basiliskra III.

## Out of control

Basiliskra III does not care what is around him.

* He goes after **players and animals alike** (any creature: cows, villagers, wolves), and turns his breath on them as readily as on you.
* Whatever is under a foot when it comes down is trodden: it hurts, and throws you. Being caught under him as he walks hurts too.
* **He walks through whatever is in his way** (in the default destruction setting): houses, walls, woods. They are broken ahead of him as he comes, from the ground up, a wider and deeper strip than before, and a cliff in his road is cut down to a step he can take. While he destroys like the Wither, each footfall also sends a shock rolling on ahead of him (fourteen blocks) that knocks down what stands there before he arrives. He walks *through*, not down: the ground he walks on stays, and a gentle rise is simply climbed.
* **He finds his way.** Walled in on three sides, or behind a long wall, every form now works out the way round (Basiliskra I round a harbour mole, II and III round walls when they are not destroying).
* The wither-like destruction never touches bedrock, portals or command blocks, and by default spares **chests, barrels, shulker boxes, beds, furnaces, hoppers and anything else that holds things**, and the obsidian a portal stands in. You may find a chest standing alone in the rubble.
* The config wheel's Settings can make him gentler: destruction can be reduced to scorching or nothing, the storage protection turned off, and his hunting of animals turned off.

## Where people live

With nothing alive in reach, Basiliskra II, III and IV do not wander: **they go to the nearest place people live, and through it.**

* **Villages**: he senses villagers (and townspeople) from about 180 blocks (in the country that is loaded round him), walks to them, and then back and forth through the place until something alive takes his attention.
* **Cities**: he knows of a city from 500 blocks.

**Cities.** The pack raises its own: streets on a grid, towers of concrete and glass lit from inside (the tallest by the water), houses, parks, a stadium, a big wheel, street lamps, and **people** in the streets (townspeople of its own: see below). In front of every city is a **promenade and a wide beach** that shelves gently into the water, so that he can walk up out of the sea, and beyond the beach **the sea is cut a hundred blocks deep**: straight down, wall to wall, to a floor of abyssal basalt.

* **They rise by themselves on real coasts** as you explore: where there is land behind and open sea ahead, never where anything built already stands, and never within 900 blocks of another city. You are told when one starts ("A city is rising..."). A full city takes about two minutes (a small one about twenty seconds), and you are told as each quarter is done; it is built a little at a time (never more than 6,000 blocks, nor more than 4 milliseconds of the game's time, in any tick), so the game does not stall while it rises, as 1.6's did. While it is built the pack asks the game to keep its ground loaded (up to six ticking areas, given back when it is finished); if the world has few to spare it uses what it gets and takes a little longer. Settings → **Cities rise on coasts** switches this off.
* **Or put one where you stand**: the config wheel's **Raise a city here**, or `/basiliskra:city` (operators, no cheats). The sea goes the way you are looking, the streets behind you, and you are stood on the promenade. A full city is 259 by 175 blocks of streets with sixty townspeople; a small one 91 by 63, with eight. One is built at a time. **This one is built whatever is there**, so choose the place.
* **The deep.** On the floor of the cut: seam vents that glow, drowned spires hung with lanterns, the ribs of something far larger than he is, a pit deeper still with a broken ring of crying obsidian at the bottom of it, and a ruin at the foot of the drop with a chest. Four new blocks are down there (abyssal basalt, seam vent, drowned lantern, old bone); all can be mined and placed.

**The townspeople.** Cities are lived in by people of their own (twelve looks: office workers in shirts and suits, a builder in hi-vis, a doctor in a white coat, a police officer, people in T-shirts, hoodies and a sundress). They walk the streets, stop, look about, and go through doors. **When a giant comes into sight they throw their arms up and run**, away from it, faster than they walk, and keep running for about fifteen seconds after they last saw it; within thirty-odd blocks of him they feel the ground shake and run whether they can see him or not. Further off (up to about 110 blocks) they must actually see him: a wall or a hill between keeps them calm. They do not fight and take no part in the story: killing them calls nobody. There is a spawn egg (**Spawn Civilian**) to put them anywhere, and `/summon basiliskra:civilian`.

Why not a biome: a real custom biome needs the game's **Custom Biomes experiment** switched on, and this pack runs with every experiment off. So the city is built by the script, on the game's own coasts, and from the wheel.

## The Seam Lance

The one weapon made for him: a blocky gun of gunmetal and old bone with a crimson crystal held between two prongs. From 1.7 it is half as big again and **held in the hand like a gun**: in first person it sits low on the right pointing at the crosshair; to everyone else it is held by its grip at your side, pointing where you look.

* **Craft it** from 2 crimson shards, 1 scarlet trinitite, 3 iron ingots and 1 block of redstone (shards and trinitite are what his breath leaves behind), **or find one** in the chest in the ruin at the bottom of a city's deep.
* **Use it** (right-click, or press and hold): **a thick red laser**, straight along your line of sight, **140 blocks**, that stands in the air for a moment with a white core, a glow, rings and sparks along it and a burst where it hits. You see it leave your own gun; others see it leave the gun in your hand. One shot every 0.6 seconds; the cooldown shows on the hotbar. It needs no ammunition.
* It strikes the first part of him it meets: **34** to the body, **51** to the head, **24** to the tail. Solid blocks stop it. Anything else alive in the line takes 9.
* It does not kill Basiliskra himself (nothing does: he is driven off). It does kill a Titan.

## The Titan (for battles)

A **separate creature** that wears Basiliskra IV's body, made for fights in Creative. It is not the one Basiliskra and has no part in his story: no rift, no changes, no leaving, and making or losing one changes nothing about him.

* **Make one**: the **Spawn Basiliskra Titan** egg (Creative inventory), `/basiliskra:titan` (operators, no cheats), `/summon basiliskra:titan`, or the config wheel's **Put a Titan here**. It stands a short way in front of you. **Up to three at once**: Alpha, Beta and Gamma. `/basiliskra:titan clear` or the wheel's **Remove the Titans** takes them all away.
* **As strong as the strongest Godzilla add-ons** (from 1.7.2, matched to Hakaishin Godzilla): **100,000 health** (his: 600), and **any blow of its does 100,000** to a player or a creature, so whatever it touches with its breath, its jaws, its tail or its feet dies at once, armour or not. Its breath reaches 220 blocks (his: 150) and it walks a third faster.
* **You can tell it from him**: its seams never go dark. It smoulders red all the time.
* **It fights with its body as well as its breath**: a **lunge** (it rears back, then throws its jaws and its right hand forward), its **tail** (it winds away and lashes round to the side its head turns to), a **charge** with its whole weight from a distance, and it **circles** between blows. A heavy blow staggers whoever it lands on and throws them back.
* **What it fights**: another Titan, or Basiliskra himself, before anything else; then any creature, and players in Survival or Adventure. **Players in Creative are left alone**, so you can stand and watch. Left alone it prowls round the place it was put down.
* **Titan against Titan**: put two down a hundred blocks apart. They roar at each other, breathe, close, and fight until one goes down: about four to five minutes (their blows on each other are scaled up with their health: 375 a breath hit, 2,125 a lunge, 3,250 a tail, 2,750 a charge). A beam stops on a giant's body. Everyone within 150 blocks sees each Titan's health above the hotbar.
* **Titan against Basiliskra**: he answers it (as III or IV, with his breath), and he loses: he is driven off through a seam as he always is, never killed. (Its blows on him are kept at their old weight, so there is still a fight: at full weight its first blow would drive him off before he could answer.)
* **It can be killed**: by another Titan, or by you, though at 100,000 health that is a long job (the Seam Lance does 34 a shot: about 2,900 shots). `/basiliskra:titan clear` or the wheel's Remove the Titans takes them away at once. It goes down onto its knees, the fire in it fails, and it is gone, leaving 24 crimson shards, a fin, and poisoned ground.
* Its beams, its feet and its fallout follow the same Settings as his (destruction, damage, Peaceful, fallout).

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
* **Him**, once he is here: how many minutes are left before he changes (time is all it takes).

Reading it never changes anything.

## The config wheel

Operators (and the player of a single-player world) also get a **Basiliskra Config Wheel** (craft one from a copper ingot, redstone and kelp). Use it, or type `/basiliskra:config`:

| Button | What it does |
|---|---|
| Settings | Everything in the table below. Saved with the world, so it survives reloads and pack updates. |
| Call him now (the rift opens) | At once, not at dusk. If he has never come, the rift opens in the nearest deep water and Basiliskra I rises from it. If he was here before as II, III or IV and is away, the rift opens on the ground in front of you and he walks out as he was (Basiliskra IV comes out of the sea instead, if there is water within 96 blocks). |
| Bring him here (no rift, pick a form) | The one Basiliskra is put a short way in front of you, on the ground, as he is in the story or as I, II, III or IV. Basiliskra I needs deep water within 96 blocks and goes there. |
| Make him change now (next form) | Plays the change, with its scene, without waiting for his time to be up. |
| Send him away (until he is called) | He leaves through a rift and **stays gone**. The story goes back to its beginning: the next time he is called he comes as Basiliskra I. The anger on record and his fallout stay. Asks first. |
| Skip to dusk | Sets the time to dusk. |
| Journal | Opens the journal. |
| Reset the story | Forgets him, his form, what he learned and all the anger on record, as if the pack had just been added. Asks first. |
| Raise a city here | A full city or a small one where you stand: the sea the way you are looking, the streets behind you. See "Where people live". |
| Put a Titan here | A Titan a short way in front of you, facing you (up to three). See "The Titan". |
| Remove the Titans | Takes every Titan out of the world. |

## Spawning him yourself

There is still only ever one Basiliskra. Calling him on purpose brings **that one** to you: if he is about he is moved to you, and if he is not, the new body becomes him and the old one is removed when its chunk next loads.

* **Spawn egg**: "Spawn Basiliskra", in the Creative inventory with the other spawn eggs (or `/give @s basiliskra:basiliskra_spawn_egg`, which needs cheats). In a world he has never come to, the egg makes Basiliskra I on deep water and Basiliskra III on land. After that it brings him as he is in the story, unless the Settings say otherwise.
* **`/basiliskra:spawn [story|i|ii|iii|iv]`**: operators, **no cheats needed**. He appears a short way in front of you, facing you. Basiliskra I goes to the nearest deep water instead.
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
| A spawn egg makes (`spawnForm`) | his stage in the story | Or always I, II, III or IV. |
| Give new players the journal | on | |
| Give operators the config wheel | on | |
| Debug messages | off | Fault messages in the content log, and operator hooks through `/scriptevent basiliskra:debug` (needs cheats). |
| His fallout (`fallout`) | changes the land | Off; or glowing motes and Geiger clicks only; or also changes the land (natural ground only). |
| Radiation sickness (`sickness`) | on | Players in fallout get hungry, weak and sick, and burn in the heart of it. |
| Cutscenes (`cutscenes`) | on | The camera shows everyone near the rift opening and each change. Off: you keep your own view. |
| His music (`music`) | on | His three themes. |
| Minutes in each form before he changes (`changeMinutes`) | the story's own timing | Or 1, 2, 5, 10, 20, 30 or 60 minutes for every change. |
| Cities rise on coasts (`cities`) | on | Off: a city is only raised where an operator asks for one. |

There are no sliders (they could not be dragged on some phones): every number is a list to pick from, with a box to type your own.

Never changed, in any mode: bedrock, portals, end portal frames, barriers, command and structure blocks. With storage spared (the default): anything with an inventory, beds, signs, and obsidian.

In the scorch and break modes nothing built is ever touched: not redstone, glass, planks, bricks or any other built block; not a raised wall or pillar even of raw stone; not ground a building stands against; not ground only silk touch can move (podzol, mycelium, moss, mud, clay, snow). If the beam lands on a building, nothing around it is touched either.

His destruction drops nothing: what his breath or his weight breaks is gone. He uses no real lightning and no real explosions (the blasts are his own, so nothing he does is stopped by blast resistance, and nothing is set off).

## Good to know

* **Not yet seen in the game by its author.** Everything in 1.6 (the close cutscenes, the Seam Lance in the hand, the cities and the deep, the Titan) passes the pack's own simulated-world tests and the game's file checks, but none of it has been run in Minecraft itself. See `docs/TEST_REPORT.md` for the list of what to look at first.
* Two Titans fighting ask about three times as much of the game as Basiliskra IV does alone. If a world struggles, fight two, not three.

* Basiliskra IV's wings are struck at the arm; the long finger bones and the membrane between them are not hit volumes.
* **Hit him anywhere.** Every form is covered by invisible hit volumes from the tip of the snout to the tip of the tail, generated from the model itself: head, jaw, neck, body, every leg, every segment of tail. Hits on his head count from outside it. If the game ever fails to register a swing that plainly lands, the pack counts it anyway.
* In destroy mode Basiliskra III walks through buildings, woods and cliffs; otherwise (and for I and II) he works out a way round them. He does not enter water over his depth by choice; if he ends up in it he swims.
* If the coast he is at unloads (you go to the Nether), he is still there when you return. An empty area is never treated as "he is gone".
* Removing the packs leaves at most one inert entity that removes itself; the world is otherwise untouched.

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

**Updating from an earlier version:** import the new `.mcaddon` (version 1.5.1). If a world still uses the old copy, open the world's
settings → *Behavior Packs* and *Resource Packs*, deactivate The Observer, then activate the 1.5.0 packs again. Your
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

**When it is near.** Your music stops while it is around and its own theme plays instead (in the Weeping Mire, a
low, lurking one); the game's music comes back, fading in, once it has gone. (Both follow your music volume.) When
you spot it you will know it — a sting just for you — and when it is close and you have not seen it, now and then, it
whispers. And you will
hear your own heart: slow when it is barely there, racing when it is on you — even when you cannot see it. When it is
close and means you harm, your view trembles with each beat (gently; "Camera effects" set to reduced halves it and
"none" turns it off; the heartbeat itself can be switched off in the settings).

**The other creatures answer to it.** Every hostile creature — Minecraft's own or any other add-on's — knows what
it is. When it comes, the creatures near it stop, the nearest first, turn to it and go quite still; then they back
away from it (and from you — never toward you, and never able to hurt you while they do), and once nobody is looking
they are gone: it sends them away. If you notice the zombies and spiders around you falling silent and turning all one
way, look where they look. From the third stage it does not share: a creature that hurts you may suddenly find it
standing right behind it — the creature turns round to it and is torn apart, and it looks at you a moment longer, and
is gone. You are its, not theirs. On the Config Wheel → **Other creatures**, look at any creature and mark its kind
"Answers to it", "Its rival" (it tears those apart whenever it comes) or "Leave it alone". Tamed and name-tagged
creatures, bosses and anything with 300 or more health are always left alone, and it all switches off in the settings.

**They are its.** From the third stage it keeps a few of them: three (four at the fifth stage) walk out to stand
around you, spread out about ten blocks away, and stare at you, quite still, with small cold eyes that are its eyes.
They cannot hurt you while they are its. When it goes, they stay a moment — and once you are not looking, they are
gone too. From the fourth stage they come closer only while you are not looking at them, the way it does; look at one
and it stops dead. They never come nearer than four blocks. Sometimes a single creature ahead of you stops and just
stares: that is **its eyes**. Look straight back at it and it comes apart — and it is standing there. And if you
make it snap (from the fourth stage, on Standard or High aggression), the creatures it is holding near you are let go
with its eyes still in them, and come for you with it.

**Its puppets.** It takes creatures for its own — and you can tell which. A creature that is its has *its* eyes
(two small cold white glints instead of its own), its pale wisps drift off it and crimson shreds fall from it when it
moves, it moves in twitches — and, lurking, only while you are not looking at it. Now and then its voice comes out of
it: a groan, the crack of a neck, a whisper meant for you. Near one, your heart starts and its music plays; the animals
turn to it and back away, the other creatures step aside. Hold the **Witness Lens** on one and it flares, its eyes
blazing. When it lets one go, the eyes go out in a puff of shreds. Your Field Notes (*Pages I didn't write*) keep count,
in its hand.
* **Its puppets of your choosing.** Config Wheel → *Other creatures*: look at a creature and mark its kind **Its
  puppet**. From the third stage it takes one wherever it is — another add-on's creature of the caves, say: if you are
  up on the surface it is brought up after you, lurks at the edge of your sight, and from the fourth stage (Standard or
  High aggression) is turned loose on you, stronger and faster than it is and unable to turn back. Afterwards it is put
  back where it was taken, as it was. (It changes nothing of the other add-on — only where its creature stands, which way
  it faces, how fast it moves and the effects on it — and gives back any creature it still held if the game stopped.)
* **Knocking.** At night, at home: three knocks at your door, and again. If you open it, one of its creatures is
  standing there, looking at you — and comes apart. Leave it shut, and when the knocking stops there is nothing outside.
* **Bait.** At night someone cries out from the dark — a villager, hurt, somewhere it should not be. Go to it and, as you
  come close, it turns to look at you with its eyes, and it is standing right behind it. The villager is back home
  afterwards, unharmed.
* **One of them.** Among a few creatures together, one is it: come close to that one, or look straight at it, and it
  comes apart — and it is standing there.
* **What was left.** It hunts the kinds you mark as its rival, out of sight: far off you hear a crack and a scream; go
  and look, and there are its footprints, and crimson shreds.
* **Its herald.** Before one of its heavier encounters, one of its creatures may walk out to stand about sixteen
  blocks away and stare at you. Something is coming.
* **The one cow.** At home, one of your animals may be its: it always faces you, and follows you at a distance. Hit it,
  and the possession tears out of it — it is only a cow again, unharmed.
* **Its guards.** In the Weeping Mire its creatures stand among the trees, facing you, keeping you out of its home.
* **What it sees, it knows.** When one of its creatures sees you, its next encounter comes sooner.
* **Tribute.** Something you threw away may turn up where one of the creatures it sent away was last standing.
* **The night they turn.** Once, at the very end, at midnight: everything around your home stops, and turns to face
  it, and stands there, still, until dawn.

**Its hold (1.4.0).** Nothing takes one of its puppets from it — not even the add-on the creature comes from.
* While it has a creature, the creature's own legs do nothing: it moves it itself. Whatever that creature is scripted
  to do, it cannot walk it off or turn it away.
* Teleported away by anything else — to you, far off, into the Nether — it is pulled straight back to where it stood,
  with a crack of the neck and its shreds left where it went. A creature that keeps fighting it is held tighter.
* **Held means harmless.** While it only holds a creature (standing, lurking, following, leading, copying you), nothing
  that creature does can hurt you: its blows, its arrows, harm its own add-on deals in its name, harm from nowhere right
  beside it. Only a puppet it has turned loose on you can hurt you.
* Nothing but you can harm one of its puppets: not fire, not other creatures, not the add-on it came from. Nothing can
  make one invisible.
* If the add-on it came from deletes it or kills it, it brings it back: the same kind, where it was, its eyes already in
  it (even `/kill` will not keep one away). Killed by **you**, it stays dead — and leaves a **cold eye**. To end them
  all at once, switch off *It takes creatures for its own* in the settings: every creature it holds is let go. On
  Peaceful nothing is brought back (the game itself takes hostile creatures away there).
* It learns each kind. Your Field Notes (*Pages I didn't write*) say what it knows of them: which fight its hold, which
  are taken back from it (it brings them back), which it keeps below ground (a kind taken from it on the surface again
  and again is only used while you are underground too), and which tried to hurt you while it held them.

**The chase (1.4.0).** A puppet turned loose on you comes about as fast as you can sprint (a little faster on High
aggression), quicker as it goes. Where the way is open it comes straight at you; where it is not, it finds its own way —
round walls, up steps, down drops, through wooden doors it opens (they close again later) and up walls of up to five
blocks, which it climbs as it does. Stuck for a moment, it twitches forward through the gap. In the last few blocks it
lunges. Sprinting alone will not lose it; breaking its line of sight and getting somewhere it cannot reach can.
* **Its pack.** When it snaps into its rage, the creatures it holds near you do not just come: they hunt you as one.
  The nearest comes straight at you, the next goes where you are running to, and the rest wait in the doorways and gaps
  ahead of you. Watch the way ahead, not only what is behind.
* **The Mirror.** A creature out ahead of you moves like your reflection: step sideways and it steps the same way, walk
  toward it and it walks toward you, stop and it stops, jump and it jumps; turn to it and it turns to you. Walk all the
  way up to it and it lets go.
* **The Guide.** A creature looks straight at you, and walks off. When you fall behind it stops and looks back, and
  waits. Follow it and it leads you somewhere out of the way — to something of yours you threw away, to one of its pages
  (written in your Field Notes as you get there), or to it. Don't follow, and in a while it gives up.
* **The Procession** (from the fourth stage). One night the villagers of a village near you walk out of their houses and
  stand in a line at its edge, facing the Weeping Mire, quite still. By dawn they are back where they were.
* **Mine first.** Another creature — any creature, from any add-on — is about to reach you, and it stops dead. It turns
  its head and looks at you with small cold eyes, and walks off into the dark. It is not protecting you. It does not
  share you.

**It is overwhelming now (1.5.0).** On Standard it begins after four minutes, not twelve; it moves through its stages
far faster; it comes back sooner and more often, with shorter quiet spells between. *Nightmare* (Config Wheel →
Presets) is above Relentless: almost no rest at all. *Atmosphere* is still there for a gentler game.
* **It talks to you.** In your chat (its name never quite the same twice), in a whisper across the bottom of your
  screen, and later in great broken letters across your view. What it says is about you: your name, where your home is,
  how many times you have died, how long since you slept, what you are holding, where you are standing right now. Its
  words break up as it speaks — scrambled letters, stutters — more the further it has come. It answers what you do: you
  get away from it, you look at it through the lens, you kill one of its own, you die, you lie down to sleep, you walk
  into its home, you reach a new stage.
* **It asks you things.** From the third stage, now and then, when you are somewhere quiet and unhurt, a question
  appears on your screen and waits: *Do you know what I am? Are you alone? Can I come in?* What you choose changes what
  it does — it shows itself, it gets angry and comes sooner, it knocks, it is inside, or it gives you a quiet night. Lie
  to it (say you are alone with someone beside you) and it knows. Close the question without answering and it takes
  that as an answer too. (It cannot read what you type — it talks, and you answer by choosing.)
* **Fourth-wall scares** (a setting of their own): a line that looks like the game's own — *The Observer joined the
  game* — a chat line in your own name that you never typed, the screen cutting to black static and an error.
* **It is never whole.** Torn, flickering fragments hang about it, red and cyan and white, like a broken screen.
* **What it holds glitches.** Its puppets and servants flicker with the same fragments, and every few seconds something
  goes wrong with them: a jolt sideways and back, a freeze in mid-step, the head snapped round backwards, the name over
  them turned to scrambled letters, a burst of static. Its hold underneath never slips.
* **The takeover.** From the fourth stage, at night, now and then — and in its rage at the fifth stage — every creature
  around you is its, all at once: animals, monsters, other add-ons' creatures. They stop, they flicker, they turn and
  look at you. One of them walks up and stands beside you with *your name* over its head. Then the hostile ones come for
  you as its pack.
* **The corruption.** The ground around you breaks up into black, blood red and crying obsidian for a few seconds, with
  a hiss of static — and then it is exactly as it was. (Only bare natural ground — never your builds, never ground
  anything stands on; never under a Ward Lantern.)
* **It is ahead of you.** Run from it and start to get away, and it is suddenly in front of you on your path. It
  remembers where you got away to before: run that way again, and it is already waiting there. Stuck a long way round
  (a maze, a cliff), it glitches along its own route to you.
* **It takes more of them.** A kind you mark "Its puppet" is taken from up to 96 blocks away, and far more often.
* **Its broken music.** Until the fourth stage its themes are your recordings. From the fourth stage its music is its
  own: a slowed, detuned, wobbling tune with a music box and a drone; in the Mire, low voices and wrong bells; and at the
  fifth stage a cheerful little tune that falls apart a little more every time it comes round. Whenever it — or its pack
  — is coming for you, a driving chase theme, at any stage.
* **The Mire's ruins.** Out in the Weeping Mire: a drowned chapel with a black altar, a watcher's spire with a seat at
  the top window, a ring of bone pillars round an altar, a library buried up to its roof, and the surveyors' last camp.
  Their chests hold decent loot — diamonds, emeralds, enchanted books and gear, golden apples, ender pearls, its own
  items (Vestiges, Flares, Cold Eyes, now and then a Witness Lens) — and their lecterns hold the journals of the people
  who were there before you.

**1.5.1.**
* **It only peeks from behind something real.** When it looks round at you, all of it is hidden behind something solid
  at least as tall as it is — a tree trunk, the wall or corner of a house, a pillar, a rock — and only its head comes
  round the edge. Never from beside a bush, never from nothing; with nothing like that nearby, it simply stands and
  watches. Move round so the cover no longer hides it, and it stops hiding.
* **It moves as you move.** Floating at you, its speed follows yours: stand still and it creeps; walk and it drifts at a
  walk; sprint and it comes fast — always a little faster than you. Within a few blocks of you, it lunges. (In its rage it is always faster than a sprint.)
* **The Weeping Mire is much bigger**: long unbroken stretches several hundred blocks across instead of scattered
  patches, still close to where a world starts. (Only new parts of a world change: land already generated stays as it is.)
* **The Mire Eyebloom.** Three blocks tall, a black stalk with drooping red-veined leaves, and for a flower a single eye
  in a halo of dark petals. The eye is never still — it looks about, blinks, its pupil widens — and it weeps red drops
  and drifting spores. They turn to look at you, but only while you are not looking at them: look back, and they are
  all already facing you. Stare at one from close by and it shuts its eye. Break any part and the whole plant falls
  (the eye sometimes leaves a spider eye).
* **Sound Test** (Config Wheel, for everyone): hear every piece of its music — its two themes, and its own stalking,
  Mire, chase and end themes — and every sound it makes, whenever you like.

**The animals know.** When it comes — whether you have seen it or not — the animals near it stop what they are
doing and turn to face it, quite still: the nearest first, the rest a moment later. After a while cows, sheep, pigs,
horses and chickens edge a few blocks away from it, unhurried, and stop and look back at it. Dogs stand their ground and
growl at it, low; cats hiss and back off; one of a herd may call out. A tamed dog whines once when it has gone. Watch
the animals and they will show you where it is. (A pet told to sit stays sitting; nothing is led off a ledge or into
water; the settings can switch this off.)

**At the foot of the bed.** Now and then (from the third stage, and never two nights close together), you lie down
to sleep and do not sleep through. The dark comes down, and you wake in the night unable to move — not your arms, not
your head — with your heart loud in your ears, and it is standing at the foot of your bed, bent under the ceiling,
looking at you. You try to turn away; you cannot. It tilts its head. It leans a little closer. Then you blink, and it is
gone, and you can move again, standing beside your bed and looking at where it stood. It does nothing else, and it
never hurts you. You woke, so the night is not over: you can lie down again. (It needs camera effects on — reduced or
full; with "Camera effects: none" it never happens — and *At the Foot of the Bed* can be switched off like any
encounter.)

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

## Its dwellers (1.6.0)
Three creatures of your own are part of this pack now, each still itself — its own encounters, its own biome or
haunts, its own music, its own settings:

* **The Goatwalker** — its servant of the woods, at home in the **Stellar Taiga**. Its fourth-wall scares (lines in
  the chat, a player "joining the game") are kept.
* **The Shaftbreaker** — its servant of the caves, from **the Hollows**.
* **The Brinesleeper** — its servant of the water, from **the Stillwater Caves**.

**Config Wheel → Its dwellers** (operators) lists them. For each: switch it **on or off** (off, it sees nobody,
whatever it was doing ends, its music stops and its creatures are gone, and stay gone, until you switch it back on);
choose **how often** and **how dangerous** from its own fixed steps (nothing can be set out of range, and no number can
be typed wrong); open **its own full settings**; take **its own wheel** if you want to keep one; or **send it after
you** now, to see it. None of them hands you its own wheel unasked any more. Their music shares one channel, so one
never cuts another off, and the Observer's silence and themes come first.

**When the Observer is near one of them, it answers to it**: within 48 blocks of the Observer a dweller is stronger,
faster and harder to hurt (it glitches and its eyes glow), and every 75 seconds it is sent after the one the Observer
has come for. None of them is ever seen in the Rift — that is the Observer's alone.

Every biome of the four still generates. The Stellar Taiga, the Hollows and the Weeping Mire never overlap or merge:
each takes its ground from different vanilla biomes (the Stillwater Caves lie underground). To find them with cheats
on: `/locate biome wmire:weeping_mire`, `/locate biome goatwalker:stellar_taiga`, `/locate biome shaftbreaker:the_hollows`,
`/locate biome brine:stillwater_caves`.

## The Rift (1.6.0)
Now and then **a tear opens in the world** near someone, in any dimension: a tall oval of violet void, five blocks wide
and seven high, swirling and full of stars, glowing and throwing sparks, a crimson eye opening in it now and then. It
grows out of a crack in the air, turns to face whoever is nearest, stands open for **two and a half minutes**, and
shuts. You will hear it: a crack, then a low hum.

**Walk into it** and you are in **the Rift** — a world of its own (a dimension; no experiments needed). It is the
Goatwalker's Stellar Taiga and the Weeping Mire torn into one: dead pines in mist and rain that never stops,
lightning, puddles, boulders, the Goatwalker's void trees and the Mire's weeping trees among them, ferns and bone
grass and eyeblooms — and the dead: bodies, blood, skeletons, and bodies hanged from the branches. Somewhere in the
woods stand a **ruined church** (pews, an altar with a body on it, a bell tower with a crimson lamp on its spire, a
crypt under the nave, a graveyard, a mausoleum) and a **castle** (curtain walls and corner towers, a gatehouse, a
gallows in the courtyard, a keep with a throne room, a treasury, an armoury, a library and a lord's chamber, a tower
with a crimson lamp, and a dungeon). Their chests hold **the best loot in the game**: netherite gear enchanted as far
as it goes, elytra, maces, tridents, crossbows, totems, enchanted golden apples, nether stars, beacons, diamond and
netherite blocks, and books of Mending, Sharpness V, Protection IV and more — and flares and Witness Lenses, which you
will need. The crimson lamps on the spire and the tower can be seen through the mist. The woods end at a crumbling
edge over the void; fall off and the Rift puts you back where you came in.

**Nothing lives there but it.** Anything you bring in alive is gone; what you drop, throw or shoot stays. And in
there it does not wait for anything: it is glimpsed between the trees, it laughs somewhere off in the rain, its steps
go round you, the trees bleed, it is standing right behind you when the lightning flashes — and then it comes through
the air at you and strikes, and strikes again. Its blow still has a wind-up you can step out of, and the Witness Lens,
a flare or a good blow still drive it off for a while. On aggression *never* it never hurts you: it throws you back to
the stones instead.

**The way back is the ring of stones where you land**: the same tear, standing in the middle of them. Walk into it
and you are back where you went in. It stays open as long as anyone is in the Rift, whatever happened to the rift you
came through. Each time a rift opens and nobody is inside, the realm on the other side is laid out again — the church
and the castle somewhere else, the woods turned another way, every chest full again, and anything built or left there
gone.

**How often a rift opens is up to you** (Config Wheel → **The Rift**, operators): never, rarely (about every 90
minutes), sometimes (45 minutes, the default), often (25), very often (12) or constantly (5). **The more often rifts
open, the deadlier it is in there**:

| Setting | In the Rift it is… |
|---|---|
| Rarely | slow and forgiving: about 4.6 blocks a second (you can outrun it), a blow of 2 hearts, long rests between its charges |
| Sometimes | about as fast as you, a blow of 3 hearts |
| Often | faster than you (6.4+ blocks a second), a blow of 4 hearts; it cuts you off and waits at the chests |
| Very often | much faster, enraged, a blow of 5 hearts; it guards the way out and you can no longer outrun it |
| Constantly | relentless: 8+ blocks a second, a blow of 6½ hearts, a few seconds between charges; it never loses you |

The same page can **open one near you now** (it needs open ground: somewhere three blocks wide and seven high) or
close the open one.

## The Config Wheel
The **Observer Config Wheel** (an iron gear with an eye) opens every setting and test tool. You get one the first time
you join a world as its only player or as an operator; anyone can craft one from *iron ingot + redstone + stick*.
Players who are not operators only see the status, the Sound Test and their own caption setting.

| Button | What it does |
|---|---|
| status (top) | on/off and preset, your stage or how long until it begins, whether something may happen soon, how many changed blocks are waiting to be put back; warns you if your game mode keeps it away |
| **See it now** | a harmless preview: it appears a few blocks in front of you and shows each animation (watching, staring, head tilt, stalking walk, drifting, floating at you, strike wind-up in mid-air with its shriek, recoil in mid-air), named on screen, then floats at you and tears apart. Glowing wisps surround it; at night its eyes glow. Works in Creative, never hurts, changes nothing and does not count toward the story |
| **Start it for me now** / **Make something happen soon** | skips the grace period (or the current wait) for you; the first encounter follows within about a minute (Survival or Adventure only) |
| **Switch The Observer on/off** | master switch; switching off puts back everything it changed |
| **Presets** | Atmosphere, Standard, Relentless |
| **All settings** | frequency, aggression, environmental manipulation, sudden scares, camera effects, captions, grace period, world weather, developer tracing, taiga shadows, escape learning, the silence before attacks, pages you didn't write, returned items, the heartbeat, the animals, other creatures, its puppets |
| **Encounter toggles** | one switch per encounter type (with the stage it unlocks at); switched-off types are never chosen |
| **Test an encounter** | starts something on you right now. First the single behaviours (red): **The Vigil (practice)** (three rounds, no reward, nothing recorded), **The Strike** (it floats at you and keeps attacking from the air until you die or drive it off — Low aggression: one strike), **The Lunge** (look at it and it comes at you), **Peeking from cover** (behind a tree, a wall or the corner of a house within 20 blocks — all of it hidden, only its head looking round; with nothing like that in reach it says so), **Taiga shadow** (the illusion, here anywhere), **Getting too close** (walk up to it), **The Flare** (it stares; throw a flare near it — you get one if you have none), **The world goes quiet** (20 s of silence, then nothing), **A page you didn't write** (one appears in your Field Notes now), **It returns what you threw away** (needs a home it knows: drop something and walk 10 blocks away), **The floating chase** (it floats at you and tears apart 3 blocks short), **Climbing after you** (stand on something 3+ blocks high: it climbs up to you, then lets go). Then every encounter. If the place is unsuitable it tells you what that one needs (for example, *The Closed Path* needs a tunnel at least 3 blocks high). Tests never count toward your story |
| **Other creatures** | look at a creature first: mark its kind *Answers to it*, *Its rival*, *Its puppet* or *Leave it alone* (or back to the default), or forget every mark; it also says whether it has that one right now |
| **Its dwellers** (1.6.0) | the Goatwalker, the Shaftbreaker and the Brinesleeper: each on or off, how often, how dangerous, its own settings, its own wheel, sent after you now (above) |
| **The Rift** (1.6.0) | how often a rift opens (and so how deadly it is in there), when the next one comes, open one near you now, close the open one (above) |
| **Undo its changes** | puts back every block it changed and ends whatever it is doing |
| **Sound Test** (everyone) | its music — *It is around*, *Lurking* (your recordings), *Stalking*, *Its home*, *The chase*, *The end* — looping on your music channel until you stop it (turn your Music volume up), and every sound it makes; only you hear them, and nothing changes |
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
| **Cold Eye** | left by one of its puppets when **you** kill it | Crafting material |
| **Charm of Cold Eyes** | craft *4 Cold Eyes + string* | Carry it anywhere (or in your off hand): it hums when one of its puppets is within 32 blocks — even one hiding among its kind — louder and higher the nearer it is, and louder when you face it. Turn about with it to find the one that is its |
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
and on/off switches for the taiga shadows, escape learning, the silence before attacks, pages you didn't write,
returned items, the heartbeat, the animals sensing it, other creatures answering to it, and its puppets. The encounter toggles switch off *It's Inside*, *Signs*,
*Borrowed Eyes* and *At the Foot of the Bed* (sleep paralysis) like any other encounter.
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
* **The Rift is not your world**: it is laid out again every time a rift opens with nobody inside, so anything built or
  left in there is gone then. A rift standing in your world places nothing but a little invisible light round itself,
  taken away when it shuts.

## Removing the add-on
1. As an operator, use Config Wheel → *Undo its changes* (or run `/observer:restore`) to revert every recorded change.
2. Wait a minute in the areas you have visited so unloaded areas can be restored too, then remove the packs.
If the packs are removed first, any Veil or Effigy blocks still standing become unknown blocks. Leave the Rift before
removing the add-on: without it, the Rift is gone.

## Commands
| Command | Who | What |
|---|---|---|
| `/observer:journal` | anyone | open your Field Notes |
| `/observer:settings` | operators | settings |
| `/observer:status [player]` | operators | what it currently knows about a player |
| `/observer:restore` | operators | revert all recorded changes now |
| `/observer:preset <atmosphere\|standard\|relentless>` | operators | apply a preset |
| `/observer:trigger <encounter> [player]` etc. | operators, cheats on | developer/testing commands (see DEVELOPER_GUIDE.md) |
| `/observer:brine_wheel`, `/observer:brine_settings`, `/observer:brine_status` … | operators | the Brinesleeper's own commands (1.6.0: moved under `observer:`) |
| `/observer:sb <action>` | operators | the Shaftbreaker's own command (1.6.0: was `/shaftbreaker:sb`) |

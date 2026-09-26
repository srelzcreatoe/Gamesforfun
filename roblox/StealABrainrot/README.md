# Steal a Brainrot

A playable Roblox game: buy brainrots and lucky blocks from the conveyor, watch them walk home (other players can buy them off you on the way), collect the Cash they earn from the pads in your base (even while you're offline), steal other players' brainrots (your base sounds the alarm), lock your base with a laser door, troll thieves with freeze rays, spike traps, land mines and Boogie Bombs, trade and fuse brainrots, fill the Index, spin the wheel, do daily quests and survive ADMIN ABUSE.

![All 34 brainrot models](BrainrotModels/Import/preview.png)

## Open it in Studio

Double-click `StealABrainrot-TestPlace.rbxlx`, or open Roblox Studio and use File → Open from File. The map is visible straight away: a studded red-carpet conveyor between two tunnels, 8 well-spaced 4-storey bases (neon trim, real see-through glass windows on every floor, a flag on the roof, stairs up to every floor and green collect pads), long carpets from the conveyor to each base, the Robux Shop (run by a rat in a suit with a galaxy slap glove) and Gear Shop stalls, the glowing Fuse Machine, the global leaderboards, trees, bushes, rocks and street lamps, and a dirt-and-grass border.

Press **Play** (or **Test → Start** with 2 players to try stealing).

## Import the brainrot models (once, about a minute)

The real 3D models (made with Higgsfield and Customuse) are in one file, `BrainrotModels/Import/BrainrotModels.glb`. Roblox only shows real meshes after they're uploaded to your account, and Studio does that for you when you import:

1. In Studio: **File → Import 3D** (or the Avatar tab → Import 3D) and pick `BrainrotModels.glb`.
2. Press **Import**. A model with all 34 brainrots appears in the Workspace (you can move it into ReplicatedStorage, but you don't have to).
3. **File → Save** so the place keeps it.

That's it: the game finds the models by their part names (`TimCheese_Body`, `TimCheese_Leg1`, ...), stands each one up facing the right way, and uses them for every brainrot, with its own animation: legs that walk, flying, driving, spinning and hopping, bobbing when idle and wriggling when carried. They load like any Roblox mesh. Tip: right-click the imported model → **Save to File** to keep a `.rbxm` you can drop into any newer version of the place instead of importing again.

Until you import them, each player's game builds blocky versions of the models itself (slower, and it needs Game Settings → Security → **Allow Mesh / Image APIs** once published). The Output says which one the game is using.

## How to play

| Action | How |
|---|---|
| Buy a brainrot | Walk up to one on the conveyor and press **E**. It walks to your base, and until it's through your door **anyone can buy it off you** for the same price (you get your Cash back) |
| Buy someone else's | Catch a brainrot walking to another base and press **E** to buy it; it turns around and walks to yours |
| Earn Cash | Each brainrot fills the green pad in front of it with Cash every second. **Step on the pad to collect it** |
| Offline cash | Brainrots keep earning while you're away (up to 8 hours). When you come back it's waiting on your pads, marked "OFFLINE CASH" |
| Steal | Hold **E** on someone else's brainrot, then run it back into your base. If you die, take too long, or the owner catches you, it goes back. The owner's screen flashes red with a siren and a line pointing at you, and their base lights flash red |
| Sell | Press **F** on your own brainrot for half its price |
| Upgrade a pedestal | Press **R** on your own brainrot: each level (up to 5) adds +25% to whatever stands on that pedestal, and the pedestal gets a glowing ring |
| Lucky blocks | They turn up on the conveyor now and then (or come from the Robux Shop, the wheel, quests and gifts). Take it home and hold **E** on it: it shakes, a roulette spins and it pops into a random brainrot |
| Lock your base | Step on the red pad inside your base. Lasers zap intruders for 60 seconds (2 minutes with the Long Lock pass) |
| Floors | Each base has 4 floors of 8 pedestals. Floor 1 is open from the start; each rebirth opens the next floor (floor 4 at Rebirth 3). New brainrots walk up the stairs to their pedestal |
| Shop | **Shop** button or the Robux Shop stall: Cash bundles, EMP Laser Overrider (walk through lasers for 30s), Server Rarity Boost (x2 rare spawns for 15 min) and the troll items (below) |
| Rebirth | **Rebirth** button: resets Cash (and the pads) for +50% income per rebirth and opens the next floor of your base. Each rebirth also needs certain brainrots in your base (rebirth 1: Tung Tung Tung Sahur and Trippi Troppi, then rarer ones); you keep them and all your other brainrots |
| Index | **Index** button: every brainrot with a spinning 3D preview; ones you've never had are black silhouettes named "???". Pages for Gold, Diamond and Rainbow ones too. Finishing a page pays out once and adds income forever (see below) |
| Spin | **Spin** button: one free spin of the prize wheel a day (+1 with Premium, +1 with VIP), more from spin packs, quests, gifts and codes |
| Quests | **Quests** button: three daily quests (buy 5 brainrots, steal 2, open a lucky block, slap 5 players, ...) and a Mythic Lucky Block for finishing all three |
| Gifts | **Gifts** button: the 7-day login streak (a better reward each day, up to a Brainrot God Lucky Block), playtime gifts that unlock after 3 to 60 minutes played today, codes, and the Group Chest |
| Trade | **Trade** button: pick a player; each of you puts up to 4 brainrots on the table, both press Ready and it swaps after a 5 second countdown (any change un-readies both) |
| Fuse | Walk up to the Fuse Machine: put in 3 brainrots of one rarity and get a random one of the next rarity (it keeps the mutation if all 3 share it) |
| Upgrade | **Upgrade** button: walk speed levels (+2 speed each, 10 levels) and base skins |
| Settings | **Settings** button: music and sound volume, low graphics (no weather or sparkles), skip the tutorial |
| Gear Shop | The Gear Shop stall: gear bought with Cash and kept forever (see below) |
| Leaderboards | Top Cash, Top Steals and Top Rebirths across all servers on the boards between the bases; Cash, Steals and Rebirths in the player list |

The HUD buttons are chunky and bright like the original's (a glossy colour block with a thick black outline, a 3D shadow and the icon popping out of the top); they bounce when you hover them, squish when you click, and their icons wiggle. A red **!** shows when something's waiting (a free spin, a daily reward, a finished quest). The Shop button has a pulsing NEW! badge. On small screens (phones) the buttons shrink to fit.

New players get a free Noobini Pizzanini so income starts right away, and a short tutorial with an arrow: buy a brainrot, collect its Cash, lock your base ($1K when you're done).

Your income multiplier shows next to your income; tap it for the list of boosts: rebirths, the 2x Cash pass, a Cash Boost, **+10% for each friend in the server** (up to +50%), **Premium** (+10%), **VIP** (+15%), your **group** (+10%) and the **Index** (up to +100%).

### Gear

| Gear | Price | What it does |
|---|---|---|
| Slap | Free | A giant purple slap glove worn on your hand. Knocks players back; a slapped thief drops the brainrot they're carrying |
| Speed Coil | $7.5K | Run much faster while holding it |
| Gravity Coil | $20K | Jump three times higher while holding it |
| Invisibility Cloak | $100K | Click to turn invisible for 8 seconds (30 s recharge). Grabbing a brainrot reveals you |

Coils don't work while you carry a stolen brainrot, so thieves stay catchable.

### Troll items (Robux Shop)

Bought with Robux like the original game's trolling gear. Each purchase gives a few charges, which are saved; the item shows up in your backpack as a tool (for example "Freeze Ray x3") until they're used up. Every one of them makes a thief drop the brainrot they're carrying.

| Item | Charges | What it does |
|---|---|---|
| Freeze Ray | 3 | Freezes the player you're facing (up to 45 studs) in a block of ice for 4 seconds. Missing costs no charge |
| Spike Trap | 3 | Put down in front of you. Whoever steps on it is stuck for 3 seconds ("OUCH!") |
| Land Mine | 3 | Hidden mine with a blinking light. Whoever steps on it is launched sky high with an explosion (no damage) |
| Boogie Bomb | 2 | A disco ball drops and everyone within 22 studs dances for 4 seconds and can't move |

Up to 3 traps and mines each stay out for 2 minutes; your own never go off on you. A banner shows the victim what happened ("FROZEN SOLID!", "YOU CAN'T STOP DANCING!", ...).

### Events

Every 5 to 8 minutes an event runs for 3 minutes, with its own sky colour, things falling from the sky and a timer at the top of the screen:

| Event | What happens |
|---|---|
| Gold Rush / Diamond Storm / Rainbow Party | Gold x5, Diamond x6 or Rainbow x10 as common; gold sparkles, diamonds or confetti fall |
| Blood Moon | It turns to midnight under a red sky with rising embers; brainrots can spawn **Bloodrot** (x3) |
| Galaxy Night | Midnight under a purple sky full of stars; brainrots can spawn **Galaxy** (x4) |
| Lava Rain | Meteors fly across an orange sky; brainrots can spawn **Lava** (x3.5) |
| Frost Storm | Snow under an icy sky; brainrots can spawn **Frozen** (x2.5) |
| Taco Tuesday | Tacos rain down and Taco brainrots are 8x more common |
| Lucky Hour | Clovers fall and every rarity above Common is 3x more likely |
| Cash Rain | Coins drop all over the map; grab one for 20 seconds of your income (at least $150) |
| **ADMIN ABUSE** | Now and then (1 in 10 events) instead of a normal event: a shaking rainbow banner, every conveyor brainrot gets a mutation, prices are halved, 10x luck, traits 5x likelier and Cash rains. You can also start it by typing **/abuse** in the chat (in Studio, as the game's owner, or if your user ID is in `FeatureConfig.AdminUserIds`) |

### Day, night and weather

A full day passes every 10 minutes (the night is shorter), and the street lamps come on at night. Inside the bases the lights are always on: three ceiling panels over the pedestals on every floor and glowing strips in the base's colour along the walls. Every 3 to 5 minutes the weather changes between clear skies, **rain**, **snow**, **fog** and **thunderstorms** with lightning bolts and thunder. Rain and snow stay out of the bases.

### Rarities, mutations and spawn timers

- **34 brainrots** in 7 rarities: Common, Rare, Epic, Legendary, Mythic, **Brainrot God** (rainbow name and glow) and **Secret** (black name with a white outline, dark smoke and white sparks) — from Noobini Pizzanini up to Tralalero Tralala, Ratto Schiaffone, Gatto Pizzanave, Tacorita Bicicleta and the Secret **67**. Rarer brainrots glow in their rarity colour, sparkle and have a rising aura; Mythic and up pulse.
- **Mutations**, rolled when a brainrot spawns: **Gold** (6%, x1.5 income and price), **Diamond** (2.5%, x2) and **Rainbow** (0.6%, x5), plus the event-only **Bloodrot** (x3), **Galaxy** (x4), **Lava** (x3.5, on fire) and **Frozen** (x2.5). Mutated brainrots are recoloured, shine and sparkle in their colour; Rainbow cycles through every colour. Mutations are saved with the brainrot.
- **Traits**, rolled like mutations and stacking with them: **Fire** (3%, x2, burns), **Tiny** (3%, x1.5, small), **Giant** (2%, x3, big), **Glitched** (0.6%, x6, flickers and jumps about) and **Nyan** (0.3%, x8, a rainbow trail). A Fire Gold Tim Cheese earns 1.5 x 2 = 3x.
- **Guaranteed spawns**: the sign over the spawn tunnel counts down to a guaranteed Legendary (every 4 minutes), Mythic (10 minutes), Brainrot God (20 minutes) and Secret (45 minutes).
- **Lucky blocks** (5% of conveyor spawns): Lucky Block ($25K: Rare to Mythic), Mythic Lucky Block ($400K: Legendary to Secret) and Brainrot God Lucky Block ($5M: Mythic to Secret, 5% Secret); the Secret Lucky Block (30% Secret) is Robux only. Lucky blocks hop home, float on their pedestal and can be stolen.

### Index rewards

Finishing a page of the Index pays out once and adds income forever: Common +5% and $5K, Rare +5% and $25K, Epic +10% and $150K, Legendary +10% and $1M, Mythic +15% and $5M, Brainrot God +20% and $25M, Secret +25% and $100M; every Gold brainrot +10% and $2M, every Diamond +15% and $10M, every Rainbow +30% and $50M.

### Codes

`BRAINROT` (Cash), `LUCKY` (a Lucky Block), `SPIN` (2 spins), `TUNGTUNG` (a Tung Tung Tung Sahur) and `RELEASE` (15 minutes of 2x Cash). Each works once per player; add your own in `FeatureConfig.Codes`.

Walking brainrots know the height of every point on their way (the ground, each flight of stairs, each floor and the pedestal), so even a laggy moment can't knock one off the stairs or send it the wrong way.

Brainrots really move: each model is split into a body and its legs, and anything with two legs walks, swinging its legs in turn with a small bob and lean, at a pace that matches how fast it moves, on the conveyor, on the way home and up the stairs. Brainrots without legs waddle, rocking from side to side with each step. Planes and flying brainrots (Bombardiro Crocodilo, Gatto Pizzanave, Tacoplano Bombardino) hover and bank and vehicles (Piccione Macchina, Tacorita Bicicleta) roll along with little bumps. When idle they bob and sway (the Ballerina twirls, Toro Palloncino and Spaghetti Tualetti bounce a little), and they wriggle while being carried. A sparkle burst plays when a brainrot pops into a base (a gift, a trade, a fuse or an opened lucky block).

The two shopkeepers are animated: the Robux rat winds up and slaps with its galaxy glove, the Gear Shop noob waves, both look around and talk in speech bubbles.

## Music and sound effects

The game plays a looping playlist of licensed production music (APM) and sound effects for buying, collecting, selling, stealing (an alarm when someone grabs yours), getting a brainrot back, being bought out, the laser zap, locking, rebirthing, slapping, the cloak, events and every button. All of them are audio from Roblox's Creator Store that any experience may use; most of the effects are Roblox's own. The IDs are in `ReplicatedStorage/Shared/AudioConfig.luau`: to use your own music or sounds, upload them in the Creator Dashboard and put their IDs there. If a sound can't load on a player's device, a built-in Roblox sound plays instead; a music track that can't load is skipped.

(Higgsfield's tools could not be used for audio here: its only general audio tool makes speech, and its music and sound-effect models are reserved for its game-generation pipeline.)

## 3D models and icons

The imported models are the originals, simplified to fit a Roblox MeshPart (9,000 triangles and a 1024×1024 texture each) and cut at the hip so the legs can swing (`tools/build_import.py` builds the file). The blocky fallback models were made from them too: all 34 brainrots were made from blocky concept art (GPT Image 2.5 on Higgsfield, using the Roblox-style reference line-up) turned into 3D, then into blocky models like the original game: each model is cut into blocks 40 tall, every block takes the colour most of the model's texture under it has (so eyes, ties and glasses stay crisp), stray speckles are cleaned up, and same-coloured faces are merged.

- **Customuse** (CR1 3D + Meshy texture from the same concept art) made the models whose details got lost the first time: Ratto Schiaffone (with his purple galaxy slap glove), Tung Tung Tung Sahur (with his bat), Tim Cheese, Lirili Larila, Bombardiro Crocodilo, Trippi Troppi, Tralalero Tralala and Brr Brr Patapim. The workflow is at https://customuse.com/workflow/02c37c8d-d0cb-430c-a948-816aad2d7f7c.
- **Higgsfield** (SAM 3 3D) made the other 26.

The side buttons (Index, Rebirth, Shop, Spin, Quests, Gifts, Trade, Upgrade, Settings), the shop cards (including the four troll items) and the boost timers use icons made with Higgsfield too (`UIIcons/`, `ProductIcons/`).

Nothing has to be uploaded to Roblox first: the models and icons are stored as compressed data in `ReplicatedStorage.Assets`, and each player's game rebuilds them with Roblox's EditableMesh and EditableImage. Every model is built **once**, in the background a few milliseconds per frame (so the game never stutters), starting with the brainrots already in the world; every brainrot after that is an instant copy. A model someone is waiting to see jumps the queue. If a model can't be built (for example, the device is out of memory), that brainrot shows a simple block figure and the game tries again a few seconds later; the Output window shows an `[AssetLoader]` warning with the reason. **When you publish**, turn on Game Settings → Security → **Allow Mesh / Image APIs** so players' games are allowed to build the models.

To use normal uploaded meshes instead, import the models from `BrainrotModels/Blocky/` (blocky, vertex colours) or `BrainrotModels/` (smooth, textured) with File → Import 3D, and put each Model in a `ReplicatedStorage.BrainrotModels` folder named after its Id (for example `TralaleroTralala`). The game scales it to the right size.

## Saving and purchases

An unpublished place can't use DataStores or sell products, so in Studio you get fresh data every time and the shop's buy buttons show an error. To test saving and real purchases:

1. Publish the place (File → Publish to Roblox).
2. Turn on Game Settings → Security → **Enable Studio Access to API Services**.
3. Create the fourteen developer products in the Creator Dashboard (Cash bundles, EMP Laser Overrider, Server Rarity Boost, Freeze Ray, Spike Trap, Land Mine, Boogie Bomb, Brainrot God Lucky Block, Secret Lucky Block, 3 Wheel Spins, 2x Cash (30 min), Galaxy and Rainbow base skins), upload the icons from `ProductIcons/`, and put the real IDs in `ReplicatedStorage/Shared/MonetizationConfig.luau`. Do the same for the game passes (VIP, DoubleCash, LongLock). See **Prices** below.
4. Optional: create badges (Welcome, First Steal, First Rebirth, Rebirth 5, Lucky Opener, First Fuse, First Trade, Secret Owner, Millionaire, Index Master, Week Streak) and put their IDs in `FeatureConfig.Badges`, and put your group's ID in `FeatureConfig.GroupId` for the group boost and Group Chest.

## Prices

Recommended Robux prices (what similar games charge; change them in the Creator Dashboard, the shop reads them from there):

| Developer product | What you get | Robux |
|---|---|---|
| Small Cash Bundle | +$5K Cash | 25 |
| Medium Cash Bundle | +$25K Cash | 79 |
| EMP Laser Overrider | Walk through every laser door for 30 s | 49 |
| Server Rarity Boost | x2 rare spawns for the whole server, 15 min | 99 |
| Freeze Ray x3 | 3 freezes | 49 |
| Spike Trap x3 | 3 traps | 35 |
| Land Mine x3 | 3 mines | 35 |
| Boogie Bomb x2 | 2 dance bombs | 49 |
| 3 Wheel Spins | 3 spins of the prize wheel | 49 |
| 2x Cash (30 min) | Double income for 30 min (stacks) | 79 |
| Brainrot God Lucky Block | Mythic, Brainrot God or Secret (5%) | 199 |
| Secret Lucky Block | Brainrot God or Secret (30%) | 499 |
| Galaxy Base Skin | Purple space base, forever | 149 |
| Rainbow Base Skin | Colour-cycling base, forever | 199 |

| Game pass | What you get | Robux |
|---|---|---|
| VIP | +15% income and an extra free spin every day | 199 |
| 2x Cash | Double income forever | 399 |
| Long Lock | Your base lock lasts 2 minutes instead of 1 | 149 |

In-game Cash prices (all in `FeatureConfig`, `GearConfig`, `BrainrotConfig` and `GameConfig`):

| Thing | Cash |
|---|---|
| Speed levels 1-10 | $5K, $20K, $80K, $300K, $1M, $3.5M, $12M, $40M, $130M, $400M |
| Pedestal Lv 2 / 3 / 4 / 5 | $5K / $60K / $750K / $9M |
| Base skins | Candy $250K, Jungle $1M, Ice $2.5M, Lava $10M, Gold $50M (Classic free) |
| Lucky blocks on the conveyor | Lucky Block $25K, Mythic $400K, Brainrot God $5M |
| Gear | Slap free, Speed Coil $7.5K, Gravity Coil $20K, Invisibility Cloak $100K |
| Rebirth | $100K, then x2.5 each time ($250K, $625K, $1.56M, ...) plus the brainrots it needs |

Global leaderboards also need a published place with API access; until then the boards rank the players in the current server.

## Files

| Path | What it is |
|---|---|
| `ServerScriptService/DataAndMonetizationManager.server.luau` | Player data (Cash, Steals, Rebirths, game passes, brainrots, gear, troll item charges, pad Cash, offline time, and the saved Progress table for everything else), leaderstats and all Robux purchases |
| `ServerScriptService/GameplayManager.server.luau` | Bases and their floors, conveyor, walking home (up the stairs) and buying brainrots off other players, collect pads and offline cash, mutations, traits, lucky blocks and events (including Cash Rain and Admin Abuse), spawn timers, stealing and the alarm, lasers and Long Lock, rebirths and their requirements, the Index, pedestal upgrades, base skins, income boosts, and the API for gifts, trading and fusing |
| `ServerScriptService/RewardsManager.server.luau` | Spin wheel, daily streak, playtime gifts, codes, quests, badges, tutorial, speed and skin shop, Group Chest, settings |
| `ServerScriptService/TradeManager.server.luau` | Trading between players |
| `ServerScriptService/FuseManager.server.luau` | The Fuse Machine |
| `ServerScriptService/GearManager.server.luau` | Gear Shop, the slap glove, coils and cloak, speed levels, and the troll items (Freeze Ray, Spike Trap, Land Mine, Boogie Bomb) |
| `ServerScriptService/WorldManager.server.luau` | Day and night, street lamps and the weather |
| `ServerScriptService/LeaderboardManager.server.luau` | Global leaderboards and the logo board |
| `StarterPlayerScripts/GameClient.client.luau` | HUD, Robux Shop, Gear Shop, rebirth screen, Index, pop-up messages, boost timers, clouds |
| `StarterPlayerScripts/FeaturesClient.client.luau` | Spin wheel, gifts, quests, upgrades, settings, trading, Fuse Machine, lucky block roulette, base alarm, tutorial, Admin Abuse banner |
| `StarterPlayerScripts/BrainrotVisuals.client.luau` | Blocky 3D models, rarity, mutation and trait effects, walking, waddling, flying, driving, lucky blocks |
| `StarterPlayerScripts/WorldEffects.client.luau` | Weather, event skies and falling particles, lightning, animated shopkeepers, Cash Rain coins, the troll item banner, animated base skins and alarm lights |
| `ReplicatedStorage/Shared/UIKit.luau` | The shared look of every menu: buttons, side buttons, windows, tabs, brainrot cards, confetti |
| `ReplicatedStorage/Shared/FeatureConfig.luau` | Index rewards, rebirth requirements, upgrade and skin prices, boosts, spin prizes, daily and playtime rewards, codes, quests, badges, trading, fusing, Admin Abuse |
| `ReplicatedStorage/Shared/AssetLoader.luau` | Rebuilds the blocky models (body and legs) and icons from `ReplicatedStorage/Assets` |
| `ReplicatedStorage/Shared/Sounds.luau` | Plays the music and sound effects on each player's game |
| `ReplicatedStorage/Shared/AudioConfig.luau` | Music playlist and sound effect IDs |
| `ReplicatedStorage/Shared/GearConfig.luau` | Gear prices, descriptions and tuning, and the troll items |
| `ReplicatedStorage/Assets/` | Packed models and icons, generated by `tools/build_assets.py` |
| `BrainrotModels/` | Smooth models (`.glb`), blocky models (`Blocky/*.glb`) and `preview.png` |
| `ReplicatedStorage/Shared/BrainrotConfig.luau` | Every brainrot, rarity and mutation: prices, income, colours, spawn chances |
| `ReplicatedStorage/Shared/GameConfig.luau` | Gameplay tuning: conveyor and walking speed, spawn timers, floors, lock time, offline cash, events, day length, weather, rebirth cost, ... |
| `ReplicatedStorage/Shared/MonetizationConfig.luau` | Product and game pass IDs and shop text |
| `ReplicatedStorage/Shared/NumberFormat.luau` | `$1.2K`-style number formatting |
| `Workspace/Map.model.json` | The map, generated by `tools/generate_map.py` |
| `ProductIcons/` | 1024×1024 icons for the eight developer products (made with Higgsfield) |
| `UIIcons/` | Side button icons (made with Higgsfield) |
| `StealABrainrot-TestPlace.rbxlx` | The built place |
| `default.project.json` | [Rojo](https://rojo.space) project that builds the place |

## Rebuilding

After editing scripts or the map generator, rebuild the place with Rojo 7:

```sh
python3 tools/generate_map.py
rojo build default.project.json -o StealABrainrot-TestPlace.rbxlx
```

After changing a model or icon, repack the assets first (needs `pip install numpy scipy pillow trimesh pymeshlab zstandard`). To swap in a new model, put the raw `.glb` in `BrainrotModels/source/<Id>.glb`; the script simplifies it, turns it to face Roblox's front, overwrites `BrainrotModels/<Id>.glb` and builds the blocky version:

```sh
python3 tools/build_assets.py              # every model and icon
python3 tools/build_assets.py TimCheese    # just these models
```

Then rebuild the file to import (after changing any model):

```sh
python3 tools/build_import.py
```

The script also finds each model's legs (the separate block groups that stand on the ground, up to where they join the body) so the game can swing them.

Or run `rojo serve` and connect the Rojo Studio plugin to sync changes live.

# Steal a Brainrot

A playable Roblox game: buy brainrots from the conveyor, watch them walk home (other players can buy them off you on the way), collect the Cash they earn from the pads in your base (even while you're offline), steal other players' brainrots, and lock your base with a laser door.

![The 14 blocky brainrot models](BrainrotModels/preview.png)

## Open it in Studio

Double-click `StealABrainrot-TestPlace.rbxlx`, or open Roblox Studio and use File → Open from File. The map is visible straight away: a studded red-carpet conveyor between two tunnels, 8 well-spaced grey bases with wooden signs and green collect pads, long carpets from the conveyor to each base, the Robux Shop and Gear Shop stalls, the global leaderboards and a dirt-and-grass border.

Press **Play** (or **Test → Start** with 2 players to try stealing).

## How to play

| Action | How |
|---|---|
| Buy a brainrot | Walk up to one on the conveyor and press **E**. It walks to your base, and until it's through your door **anyone can buy it off you** for the same price (you get your Cash back) |
| Buy someone else's | Catch a brainrot walking to another base and press **E** to buy it; it turns around and walks to yours |
| Earn Cash | Each brainrot fills the green pad in front of it with Cash every second. **Step on the pad to collect it** |
| Offline cash | Brainrots keep earning while you're away (up to 8 hours). When you come back it's waiting on your pads, marked "OFFLINE CASH" |
| Steal | Hold **E** on someone else's brainrot, then run it back into your base. If you die, take too long, or the owner catches you, it goes back |
| Sell | Press **F** on your own brainrot for half its price |
| Lock your base | Step on the red pad inside your base. Lasers zap intruders for 60 seconds |
| Shop | **Shop** button or the Robux Shop stall: Cash bundles, EMP Laser Overrider (walk through lasers for 30s), Server Rarity Boost (x2 rare spawns for 15 min) |
| Rebirth | **Rebirth** button: resets Cash (and the pads) for +50% income per rebirth; you keep your brainrots |
| Index | **Index** button: every brainrot with a spinning 3D preview, its stats, and how many you own |
| Gear Shop | The Gear Shop stall: gear bought with Cash and kept forever (see below) |
| Leaderboards | Top Cash, Top Steals and Top Rebirths across all servers on the boards between the bases; Cash, Steals and Rebirths in the player list |
| Music | The **MUSIC** button (bottom right) turns the music on and off |

New players get a free Noobini Pizzanini so income starts right away.

### Gear

| Gear | Price | What it does |
|---|---|---|
| Slap | Free | Knocks players back. A slapped thief drops the brainrot they're carrying |
| Speed Coil | $7.5K | Run much faster while holding it |
| Gravity Coil | $20K | Jump three times higher while holding it |
| Invisibility Cloak | $100K | Click to turn invisible for 8 seconds (30 s recharge). Grabbing a brainrot reveals you |

Coils don't work while you carry a stolen brainrot, so thieves stay catchable.

### Events

Every 7 to 11 minutes a mutation event runs for 3 minutes: **Gold Rush** (Gold x5 as common), **Diamond Storm** (Diamond x6) or **Rainbow Party** (Rainbow x10). The sky takes on the event's colour, sparkles fall, and a timer shows at the top of the screen.

### Rarities, mutations and spawn timers

- **Rarities** Common, Rare, Epic, Legendary and Mythic. Rarer brainrots glow in their rarity colour, sparkle, and (Legendary and Mythic) have a rising aura; Mythic glow pulses.
- **Mutations**, rolled when a brainrot spawns: **Gold** (6%, x1.5 income and price), **Diamond** (2.5%, x2) and **Rainbow** (0.6%, x5). Mutated brainrots are recoloured, shine and sparkle in their colour; Rainbow cycles through every colour. Mutations are saved with the brainrot.
- **Guaranteed spawns**: the sign over the spawn tunnel counts down to a guaranteed Legendary (every 4 minutes) and Mythic (every 15 minutes).

Brainrots really walk: each blocky model is split into a body and its legs, and the legs swing in turn (with the body bobbing and leaning) at a pace that matches how fast the brainrot moves, on the conveyor and on the way home. The Ballerina, who stands on one leg, pirouettes instead. They bob and sway while idle and wriggle while being carried.

## Music and sound effects

The game plays a looping playlist of licensed production music (APM) and sound effects for buying, collecting, selling, stealing (an alarm when someone grabs yours), getting a brainrot back, being bought out, the laser zap, locking, rebirthing, slapping, the cloak, events and every button. All of them are audio from Roblox's Creator Store that any experience may use; most of the effects are Roblox's own. The IDs are in `ReplicatedStorage/Shared/AudioConfig.luau`: to use your own music or sounds, upload them in the Creator Dashboard and put their IDs there. If a sound can't load on a player's device, a built-in Roblox sound plays instead; a music track that can't load is skipped.

(Higgsfield's tools could not be used for audio here: its only general audio tool makes speech, and its music and sound-effect models are reserved for its game-generation pipeline.)

## 3D models and icons

All 14 brainrots were made with Higgsfield (concept art with GPT Image 2.5, then SAM 3 3D) and turned into blocky models like the original game: each model is cut into blocks 48 tall, every block takes the colour of the model under it, and same-coloured faces are merged. The Index, Rebirth and Shop buttons, the shop cards and the boost timers use icons made with Higgsfield too.

Nothing has to be uploaded to Roblox first: the models and icons are stored as compressed data in `ReplicatedStorage.Assets`, and each player's game rebuilds them with Roblox's EditableMesh and EditableImage. Mesh parts are made a few at a time and retried if Roblox refuses one (for example when a player joins a busy server), and a brainrot that streams out and back in gets its model rebuilt, so conveyor brainrots don't end up as plain block figures. If a player's game still can't build a model (for example, the device is out of memory), that player sees the simple block figure instead, and everything else works the same. The Output window then shows an `[AssetLoader]` warning with the reason.

To use normal uploaded meshes instead, import the models from `BrainrotModels/Blocky/` (blocky, vertex colours) or `BrainrotModels/` (smooth, textured) with File → Import 3D, and put each Model in a `ReplicatedStorage.BrainrotModels` folder named after its Id (for example `TralaleroTralala`). The game scales it to the right size.

## Saving and purchases

An unpublished place can't use DataStores or sell products, so in Studio you get fresh data every time and the shop's buy buttons show an error. To test saving and real purchases:

1. Publish the place (File → Publish to Roblox).
2. Turn on Game Settings → Security → **Enable Studio Access to API Services**.
3. Create the four developer products in the Creator Dashboard, upload the icons from `ProductIcons/`, and put the real IDs in `ReplicatedStorage/Shared/MonetizationConfig.luau`. Do the same for the game passes (VIP, DoubleCash).

Global leaderboards also need a published place with API access; until then the boards rank the players in the current server.

## Files

| Path | What it is |
|---|---|
| `ServerScriptService/DataAndMonetizationManager.server.luau` | Player data (Cash, Steals, Rebirths, game passes, brainrots, gear, pad Cash, offline time), leaderstats and all Robux purchases |
| `ServerScriptService/GameplayManager.server.luau` | Bases, conveyor, walking home and buying brainrots off other players, collect pads and offline cash, mutations and events, spawn timers, stealing, lasers, rebirths |
| `ServerScriptService/GearManager.server.luau` | Gear Shop and the Slap, coils and cloak |
| `ServerScriptService/LeaderboardManager.server.luau` | Global leaderboards and the logo board |
| `StarterPlayerScripts/GameClient.client.luau` | HUD, Robux Shop, Gear Shop, rebirth screen, Index, pop-up messages, music button, event effects, clouds |
| `StarterPlayerScripts/BrainrotVisuals.client.luau` | Blocky 3D models, rarity and mutation effects, walk cycle and other animations |
| `ReplicatedStorage/Shared/AssetLoader.luau` | Rebuilds the blocky models (body and legs) and icons from `ReplicatedStorage/Assets` |
| `ReplicatedStorage/Shared/Sounds.luau` | Plays the music and sound effects on each player's game |
| `ReplicatedStorage/Shared/AudioConfig.luau` | Music playlist and sound effect IDs |
| `ReplicatedStorage/Shared/GearConfig.luau` | Gear prices, descriptions and tuning |
| `ReplicatedStorage/Assets/` | Packed models and icons, generated by `tools/build_assets.py` |
| `BrainrotModels/` | Smooth models (`.glb`), blocky models (`Blocky/*.glb`) and `preview.png` |
| `ReplicatedStorage/Shared/BrainrotConfig.luau` | Every brainrot, rarity and mutation: prices, income, colours, spawn chances |
| `ReplicatedStorage/Shared/GameConfig.luau` | Gameplay tuning: conveyor and walking speed, spawn timers, lock time, offline cash, events, rebirth cost, ... |
| `ReplicatedStorage/Shared/MonetizationConfig.luau` | Product and game pass IDs and shop text |
| `ReplicatedStorage/Shared/NumberFormat.luau` | `$1.2K`-style number formatting |
| `Workspace/Map.model.json` | The map, generated by `tools/generate_map.py` |
| `ProductIcons/` | 1024×1024 icons for the four developer products (made with Higgsfield) |
| `UIIcons/` | Index, Rebirth and Shop button icons (made with Higgsfield) |
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

The script also finds each model's legs (the separate block groups that stand on the ground, up to where they join the body) so the game can swing them.

Or run `rojo serve` and connect the Rojo Studio plugin to sync changes live.

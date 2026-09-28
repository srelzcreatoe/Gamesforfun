# Escape Glitchy (Roblox starter kit)

A chapter-style escape horror game for Roblox, in the same genre as Piggy,
Guesty and Bakon, with its own original monster: **Glitchy**, a corrupted
old-school avatar with glowing red eyes.

The kit includes:

- Rounds that go intermission → chapter → head start → hunt → results
- An AI monster that wanders, **sees** you (line of sight), **hears** you
  through walls when you're close, chases you with pathfinding and searches
  where it last saw you
- **Player mode**, where a random player becomes Glitchy
- Items that spawn in a **random spot every round**. You hold one at a time,
  and they swap or drop like in Piggy
- Locked doors, plus an exit gate with several locks that all have to be opened
- A jumpscare when you're caught, and a red glow at the screen edges when
  Glitchy is close
- A **skin shop**: spend coins on survivor skins, and on monster skins you wear
  when you're the monster. Any skin can also be sold for Robux with a Game Pass.
- Coins, escapes and skins saved between visits
- A built-in lobby and test chapter ("The House") so you can press Play right away
- Works on PC, phone and console (Drop button on screen, G on keyboard, Y on gamepad)

## Quick start (easiest)

1. Install [Roblox Studio](https://create.roblox.com/) and log in.
2. Download **`EscapeGlitchy.rbxl`** from this folder and double-click it (or
   use **File → Open from File** in Studio).
3. Press **Play** (F5).

The lobby and the test house are built by the scripts when the game starts,
so Workspace looks empty until you press Play. That's normal.

## Put the scripts in your own place instead

Create these in the Explorer, with **exactly** these names, and paste in the
code from the matching file:

| Create this | Named | Inside | Code from |
|---|---|---|---|
| ModuleScript | `Config` | ReplicatedStorage | `src/ReplicatedStorage/Config.luau` |
| Script | `GameServer` | ServerScriptService | `src/ServerScriptService/GameServer/init.server.luau` |
| ModuleScript | `MapBuilder` | the `GameServer` script | `src/ServerScriptService/GameServer/MapBuilder.luau` |
| ModuleScript | `Items` | the `GameServer` script | `src/ServerScriptService/GameServer/Items.luau` |
| ModuleScript | `Monster` | the `GameServer` script | `src/ServerScriptService/GameServer/Monster.luau` |
| ModuleScript | `Skins` | the `GameServer` script | `src/ServerScriptService/GameServer/Skins.luau` |
| ModuleScript | `Data` | the `GameServer` script | `src/ServerScriptService/GameServer/Data.luau` |
| LocalScript | `GameClient` | StarterPlayer → StarterPlayerScripts | `src/StarterPlayer/StarterPlayerScripts/GameClient.client.luau` |

If your place has a SpawnLocation, as the Baseplate template does, the script
turns it off so everyone starts in the lobby.

**Rojo users:** `rojo serve` (or `rojo build -o EscapeGlitchy.rbxl`) works
with the included `default.project.json`.

## How to play

- Walk up to an item and press **E** (or tap the prompt) to pick it up.
- Walk up to a lock while holding the right item and hold **E** to use it.
- Press **G** or tap **Drop** to drop what you're holding.
- Tap **SHOP** on the left of the screen to buy and equip skins.
- The test house: the **Red Key** opens the storage room, where the
  **Wrench** is. The exit gate in the garage needs the **Blue Key** *and*
  the **Wrench**. Once both locks are open, run through the gate!

## Change the game

Almost everything is in **`Config`**: the game and monster names, round
times, monster speed and senses, coins, colors, the jumpscare sound, and the
item list. To test Player mode with friends, set `Config.MonsterMode = "Player"`.
In Studio you can simulate several players with **Test → Clients and Servers**.

## The skin shop

You earn coins for playing (5), escaping (50) and, as the monster, for each
catch (20). Spend them in the shop:

| Survivor skins | Price | | Monster skins | Price |
|---|---|---|---|---|
| Your Avatar | free | | Glitchy | free |
| Classic Noob | 50 | | Toxic | 200 |
| Midnight (glowing outline) | 150 | | Frostbite | 350 |
| Ghost (see-through) | 300 | | Inferno | 600 |
| Golden (metal) | 750 | | | |
| Galaxy (neon, Robux-ready) | 2000 | | | |

- **Survivor skins** show right away in the lobby, and on your next spawn if
  you're in a round.
- **Monster skins** are what you look like when you're picked as the monster
  in Player mode. `Config.BotSkin` sets the AI monster's skin.
- **Add your own skins** by adding an entry to `Config.Skins`, with colors, a
  material, see-through amount or glowing outline. New skins show up in the
  shop automatically.
- **Sell a skin for Robux:** publish the game, create a Game Pass (Creator
  Dashboard → your game → Monetization → Passes), and put its id in that
  skin's `GamePassId`. A **Buy with Robux** button appears on the card. Buying
  the pass unlocks the skin, and players who already own it get it
  automatically when they join. `Galaxy` is set up as an example. It keeps its
  coin price too, so it can be bought either way.

## Make your own chapter

Put your map in **ServerStorage → Maps** as a **Model**. When at least one map
is there, the test house is no longer used, and each round picks one of your
maps at random. Your map needs these things inside it:

| Name | What it is |
|---|---|
| `PlayerSpawns` | Folder of parts where survivors start |
| `MonsterSpawn` | A part where the monster starts |
| `ItemSpawns` | Folder of parts. Give each an attribute `Item` (string) set to an item id from `Config.Items`, for example `RedKey`. Put several spawns with the same item id and one of them is picked at random each round. |
| `Locks` | Folder of parts or models. Give each one an attribute `RequiredItem` (string), for example `RedKey`. It disappears when unlocked, so a lock can be a whole door. Also add the attribute `ExitLock` (boolean, ticked) to the ones that must be opened to escape. |
| `ExitGate` | Optional. Any part named this is removed when every exit lock is open. |
| `Exit` | A part players touch to escape. Make it non-collidable and put it behind the gate. |
| `Waypoints` | Optional folder of parts the bot walks between when it isn't chasing anyone |

Items can be picked up from about 7 studs away, even through a thin wall. So
put item spawns inside locked rooms at least 8 studs from walls that border
other rooms, or players can grab them without unlocking the door. Make
doorways at least 8 studs wide so the bot can pathfind through them.

Give the map Model a `DisplayName` attribute (e.g. "Chapter 2: The School")
to show a nice name. Don't put SpawnLocations inside maps. The lobby has
the only one.

**Tip:** to start from the test house, press Play, switch to the **Server**
view, copy **ServerStorage → Maps → TestHouse**, stop the game and paste it
into ServerStorage → Maps. Now you can edit it like any other model.

You can also swap in your own models:

- **Monster:** put a Model named `MonsterModel` in ServerStorage. It needs a
  `Humanoid` and a `HumanoidRootPart`.
- **Items:** put a Model or Part named after the item id (for example
  `RedKey`) in a Folder called `ItemModels` in ServerStorage.
- **New items:** add a line to `Config.Items`, then use its id in your map's
  `ItemSpawns` and `Locks`.

## Saving progress

Saving uses DataStores. It works automatically in a published game. To test it
in Studio, open **Game Settings → Security** and turn on **Enable Studio Access
to API Services**. Without that, everything still works, but coins and skins reset every time.

## Publishing, and making Robux

1. **File → Publish to Roblox**, then open the game's settings on the
   Creator Dashboard to make it public.
2. Fill in the **Maturity & Compliance questionnaire**. Jumpscares and horror
   can affect your game's content label.
3. The skin shop is already set up to sell skins for Robux (see
   **The skin shop** above). Other things games like this sell: **game
   passes** (for example a bigger coin bonus) and **developer products**
   (for example a revive). Use `MarketplaceService` for these.
4. Turning Robux into real money goes through Roblox's **DevEx** program,
   which has an age requirement and a minimum amount. Check Roblox's DevEx
   page for the current rules.

Keep it original. Don't use the names, characters, art or sounds from Piggy,
Guesty or Bakon. Make your own monster and story instead. (Glitchy is a
starting point, so rename and restyle it in `Config`.)

## Ideas for what to add next

- More chapters, each with its own map and story
- Traps the monster can place (in Player mode)
- Spectating after you're caught
- Chase music and footstep sounds
- Different difficulties (monster speed and senses are already in `Config`)

## How this was checked

The scripts were type-checked with [luau-lsp](https://github.com/JohnnyMorganz/luau-lsp)
against the full Roblox API and linted with [selene](https://github.com/Kampfkarren/selene),
and the place file was built with [Rojo](https://rojo.space/). They haven't
been play-tested in Roblox Studio yet. If something doesn't work, check the
**Output** window: every message from this game starts with `[Escape Glitchy]`.

# Steal a Brainrot: data and monetization

| Path | What it is |
|---|---|
| `ServerScriptService/DataAndMonetizationManager.server.luau` | Server Script for player data, leaderstats and Robux purchases |
| `ProductIcons/` | 1024×1024 icons for the four developer products |
| `StealABrainrot-TestPlace.rbxlx` | Test place: baseplate, spawn and the script in ServerScriptService |
| `default.project.json` | [Rojo](https://rojo.space) project used to build the test place |

## Trying the test place

1. Double-click `StealABrainrot-TestPlace.rbxlx`, or open it from Roblox Studio with File → Open from File.
2. Press **Play**. The player list shows **Cash** and **Rebirths**.

An unpublished place can't use DataStores, so the script gives you default data that is never saved and prints a warning in Output. To test saving and purchases:

1. Publish the place (File → Publish to Roblox).
2. Turn on Game Settings → Security → **Enable Studio Access to API Services**.
3. Replace the placeholder IDs in `PRODUCT_IDS` and `GAME_PASSES` at the top of the script with your real ones.

## Rebuilding the test place

After editing the script, rebuild the place with Rojo 7:

```sh
rojo build default.project.json -o StealABrainrot-TestPlace.rbxlx
```

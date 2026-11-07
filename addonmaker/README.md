# Mobsmith: Bedrock add-on studio for Android

Mobsmith is an Android app for building **custom entities (mobs) for Minecraft: Bedrock Edition** on your phone. It exports a standard `.mcaddon` (behavior pack plus resource pack) that the game imports.

Install: `Mobsmith.apk` in the repository root (Android 7.0+).

## What it does

- **Every entity component the game knows.** The component catalog is generated from the official Bedrock 1.26.60 metadata: 406 components and AI goals plus 107 filter tests. Each one gets a form editor built from its real field names, types and defaults. Anything else can be edited as raw JSON.
- **Dweller settings** (the Dweller tab):
  - Village role: inhabitant, defender, village pet or raider. A one-tap "recommended setup" adds the companion goals, door navigation and families for that role.
  - All `minecraft:dweller` options.
  - A **daily schedule builder** with a visual timeline and activities (wander, gather, sleep, work, patrol…). On export it becomes a `minecraft:scheduler` plus one component group and event per activity, the same pattern vanilla villagers use.
  - Toggles for every village AI goal: staying in the village, doors and paths, social, trading, defense and raids.
  - Trading.
- **Horror dwellers** (Dweller tab → 👁 Horror dweller): a stalker AI that Mobsmith compiles into standard Bedrock data on export. It uses an enum property for its state, mutually exclusive state groups, an entity sensor, `minecraft:looked_at` and filtered events, the same pattern vanilla's creaking uses.
  - **States**: dormant → stalking (follows you while keeping its distance) → hunting (chases and attacks), plus fleeing, frozen and gone. A live diagram shows the current setup.
  - **When you look at it**: flee, freeze (moves only while unwatched), vanish, teleport away, charge, or stare back. You can set gaze cone, range and stare time, and a carved pumpkin can protect you.
  - **Hunt triggers**: getting too close, a stalking timer, or hitting it. You set the chase speed, damage and give-up time, and what it does afterwards (stalk again, lose interest, or vanish).
  - **Scares**: a darkness pulse, heartbeat, scream, camera shake, a custom **dread fog** (a generated fog file pushed onto nearby players), particles and on-screen messages.
  - **Traits**: smashes torches and lanterns, breaks doors, climbs walls; weak to sunlight or fire.
  - **Habitat and rarity**: these generate spawn rules (deep caves, surface at night, dark forests).
  - **Archetypes and presets**: Cave Stalker, The Still One, Ceiling Crawler, Hollow Shade, Mimic and Screamer.
  - **Horror bodies**: Gaunt, Crawler and Shade, with glowing or hollow eyes, grins, cracks and grime.
  - **Horror animations**: twitch, hunch, reach-while-hunting and float.
- **Custom sounds**: import `.ogg`/`.wav` files (stored in IndexedDB), use them as `<namespace>.<name>` in any sound picker, scare or `/playsound`. They're exported to `sounds/` and `sound_definitions.json`, and project backups include them.
- **Logic editors**:
  - Component groups.
  - Events with add/remove, set_property, trigger, queue_command, randomize and sequence, nested as deep as you need.
  - Entity properties (bool, int, float, enum).
  - A visual **filter builder** with every filter test.
- **Model editor**: 6 body templates (humanoid, golem, four-legged, flyer, swimmer, blob), bones, cubes, pivots, rotations, automatic UV packing, and import/export of `.geo.json`.
- **Texture painter**: pencil, eraser, fill, colour picker and shading brush, with UV guides, undo, skin variants (random skin on spawn in one tap) and PNG import/export. If you don't paint, an auto-paint texture is generated from the bone colours.
- **Animations**: procedural walk, look-at, idle, attack, wing-flap and swim motions driven by bone roles, plus custom keyframe animations with "plays when" conditions. The live 3D preview evaluates the same data that is exported as Molang.
- **World tabs**:
  - Vanilla sound events.
  - Natural spawn rules: placement, light, difficulty, herds, biome filters and more.
  - Loot tables and equipment.
  - Economy trades with levels.
- **Validator** that flags broken group/event/property references, goals missing their requirements (movement, attack, shooter…), spawn-rule mistakes, UV overflow and more, each with a "Fix" link.
- **Files tab** that shows every generated file, syntax-highlighted.
- **18 presets**: blank, farm animal, tameable pet, melee monster, ranged shooter, rideable mount, flying critter, water creature, village dweller, village guard, boss (with an enrage phase driven by a property), projectile, and 6 horror dwellers.
- **Export**: open directly in Minecraft, save `.mcaddon` / `.mcpack` through the system file picker, share, or save a project backup (`.json`).

## Layout

```
addonmaker/
  build.gradle.kts           Android app module (no AndroidX; WebView shell)
  mobsmith-shared.keystore   shared NON-SECRET signing key so builds install over each other
  src/main/java/...          MainActivity (WebView + JS bridge), ExportProvider (content:// for exports)
  src/main/assets/www/       prebuilt editor (generated by web/build.mjs, committed)
  tools/gen_icon.py          launcher icon generator
  web/
    src/core/                pure JS: data model, presets, model/UV/auto-paint, animations,
                             pack generator, validator, zip + png writers (also run in Node tests)
    src/ui/                  Preact + three.js editor
    data/catalog.json        component/filter structure (generated)
    data/vanilla.json        vanilla item/block/entity/sound ids (generated)
    tools/gen-catalog.mjs    regenerates data/ from Mojang/bedrock-samples metadata
    test/                    unit + schema tests, UI smoke test
```

## Build

```bash
cd addonmaker/web
npm install
npm run build
```

```bash
cd ../..
./gradlew :addonmaker:assembleRelease
```

The second command writes `addonmaker/build/outputs/apk/release/addonmaker-release.apk`. It needs the Android SDK (platform 34) via `ANDROID_HOME` or `local.properties`. If Maven Central rate-limits the first download, add `--max-workers=1`.

To refresh the component catalog for a newer game version, sparse-clone `Mojang/bedrock-samples` (the `metadata` folder plus `behavior_pack/entities`) and run:

```bash
node tools/gen-catalog.mjs /path/to/bedrock-samples/metadata
```

## Tests

```bash
npm test
```

`npm test` also compiles every horror archetype × seen-reaction × stalking combination (84 state machines). It checks that every transition targets a real group, event and state, that no component is in both base and a state group, and that every sound, particle and light block exists in vanilla.

Like the other presets, `npm test` builds every preset into packs and checks that:

- the validator reports no errors or warnings;
- every JSON/PNG/ZIP file is well formed;
- the dweller schedule and trade wiring is correct;
- entity and spawn-rule files validate against Mojang's official JSON schemas (with a negative control showing the check catches bad values). This step runs when the bedrock-samples metadata is available locally.

```bash
npm run test:ui
```

`npm run test:ui` needs Playwright. It drives the built app in headless Chromium at phone size: it creates all 18 presets, opens all 14 tabs of each (and both dweller modes), exports, and checks the downloaded add-on.

## Data and licensing notes

`data/catalog.json` and `data/vanilla.json` hold only structural facts (identifiers, field names, value types, defaults, enum options). They are extracted from the metadata Mojang publishes for add-on creators. No documentation text is copied: component help links to the public Microsoft Learn reference. Mobsmith is not affiliated with Mojang or Microsoft.

## Known limitations

- Tested in desktop Chromium and with Node. **Not yet run on a physical Android device or emulator.** "Open in Minecraft" hands the file to the game with an `ACTION_VIEW` content URI; if a device's Minecraft doesn't accept it, use **Save .mcaddon** and open the file from a file manager.
- Horror scares run through `queue_command` in entity events (`playsound`, `camerashake`, `effect`, `title`, `fog`, `particle`). Commands run by add-ons generally don't need cheats, but this hasn't been confirmed on a device. If a scare doesn't fire, the AI itself (states, gaze reactions, hunting) still works, because it doesn't depend on commands.
- Custom items and blocks, and the Script API, aren't included yet.
- Village AI such as sleeping in beds and working at job sites is engine logic tuned for villagers. Custom dwellers use the same components, but some behaviours may differ from vanilla villagers.
- The committed signing key is a convenience key for sideloading, not for store publishing.

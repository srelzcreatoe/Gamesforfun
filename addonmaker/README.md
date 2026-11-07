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
- **Horror dwellers**: horror mobs that stalk, watch and hunt players, and that **show up on their own**.
  - **22 ready-made dwellers** on the home screen's Dwellers tab. Two signature ones are built from reference drawings: the *Night Grinner* (black, long arms, glowing rectangular eyes, bleeding grin) and the *Hollow Grinner* (olive, ribbed, sunken eyes, claws, hunched). The other 20 use 8 different bodies: grinner, lurker, brute, long-neck, doll, wraith, hound and spider.
  - **Dweller creator**: a 5-step wizard.
    1. Look: a preset or a blank body.
    2. Where it lives: underground, surface, or both; night only or day and night.
    3. Stalking style: 10 styles (stalker, peeker, watcher, statue, ambusher, shade, blinker, mimic, screamer, relentless).
    4. When it shows up: first appearance, how often, chance, distance, leave time, natural spawning.
    5. Name, health, damage and speed.
  - **Appearance timer**: this is the fix for "dwellers never spawn". Exported functions (`functions/<ns>/dwellers/*`, run from `tick.json`) keep a per-player timer. They roll the chance and summon the dweller behind the player, hidden. It checks the spot is right for its type (underground/surface, night/day), then appears, or quietly retries later. Natural spawning is still there, with fixed weights and cave-sized hitboxes.
  - **Node board**: drag-and-drop blocks for stats (Health, Damage, Speed, Senses), spawning (Lives, Appearance timer, Natural spawning), traits, triggers ("Notices you", "You look at it", "You get close", "You hit it"…), actions (Stalk, Hunt, Hide, Freeze, Vanish, Blink away…) and scares. Drag a block's ● port onto another block, or tap ● and then the target, to connect them. The board and the simple settings edit the same data, and the round-trip is tested for all 22 dwellers.
  - **State machine** compiled to standard Bedrock data, like vanilla's creaking: an enum property, exclusive state groups, an entity sensor, `minecraft:looked_at`, and filtered events. States: dormant, stalking, hunting, fleeing, frozen, gone and arriving.
  - **Scares**: darkness pulse, heartbeat, scream, camera shake, dread fog, particles, and on-screen messages at the "notices you", "seen" and "hunt" moments.
- **How many can exist at once** (Spawning tab for any mob; Dweller tab and creator for dwellers): No limit, Only 1, 2, 3 or 5. Dwellers and the Boss preset default to **only one**. A tick function gives the copies already in the world numbered slot tags. Any extra copy (natural spawn, spawn egg or `/summon`) gets no slot and is removed at once with an instant-despawn event, so it drops no loot and makes no death sound. The appearance timer counts copies first and only summons while there's room. It counts mobs in loaded areas, which covers dwellers since they despawn far from players.
- **Your own animations for every action**: each mob has slots for idle, walk, run and attack; dwellers also get hunting, stalking, fleeing and frozen. Each slot plays the built-in motion, nothing, an imported Bedrock `.animation.json` (for example from Blockbench), or a keyframe animation made in the app. The 3D preview plays them, including Molang expressions.
- **Your own models**: import a `.geo.json` and its `.png` in one step, then set bone roles so the built-in motions work.
- **Simple / Advanced mode**: Simple shows the essentials. Advanced adds every component, groups, events, properties and the generated files.
- **Background music**: 5 original tracks (2:24 to 3:28), with a player in Settings and a ♪ button in the top bar.
- **Custom sounds**: upload `.ogg`/`.wav` files (stored in IndexedDB) and use them as `<namespace>.<name>` in any sound picker, scare or `/playsound`. Every sound picker has ▶/⏸ preview, upload and ✎ edit. The editor trims, changes volume, fades in and out, shifts pitch, reverses and normalizes, then saves a WAV kept under 6 MB. Built-in game sounds can't be previewed, because they belong to the game and aren't bundled. They're exported to `sounds/` and `sound_definitions.json`, and project backups include them.
- **Logic editors**:
  - Component groups.
  - Events with add/remove, set_property, trigger, queue_command, randomize and sequence, nested as deep as you need.
  - Entity properties (bool, int, float, enum).
  - A visual **filter builder** with every filter test.
- **Detailed models and textures**:
  - **Bodies**: dweller bodies are built like anatomy.
    - Shoulders, chest, waist and hips.
    - Two-part arms and legs with elbows and knees (child bones with a slight bend, so the built-in animations still move whole limbs).
    - Hands with three fingers and a thumb, and claws on the fingertips.
    - Feet with toes, a brow ridge and spine knobs.
    - Ragged robe hems for wraiths, and snouts and two-part tails for four-legged bodies.
  - **Auto-paint at up to 4 pixels per model pixel** (PNG up to 512 px; the game scales HD textures like HD resource packs):
    - face lighting, soft edge shading and skin variation;
    - shaded ribs and spine, cracks and veins;
    - detailed faces: socket shadows, glowing eyes that light the skin, blood drips, lips, and jagged teeth that meet in the middle.
  - **Glowing eyes in the dark**: glowing eye styles use the `entity_emissive_alpha` material with low-alpha eye pixels, the same encoding vanilla uses for enderman eyes. The 3D preview shows the glow, and the texture painter has a glow brush.
  - **Compression**: textures and add-on files are compressed (fflate), so high-detail textures stay small (about 60 KB each).
- **Model editor**: 6 general body templates (humanoid, golem, four-legged, flyer, swimmer, blob) and 11 horror bodies, bones, cubes, pivots, rotations, automatic UV packing, and import/export of `.geo.json`.
- **Texture painter**: pencil, eraser, fill, colour picker and shading brush, with UV guides, undo, skin variants (random skin on spawn in one tap) and PNG import/export. If you don't paint, an auto-paint texture is generated from the bone colours.
- **Animations**: procedural walk, run, look-at, idle, attack, wing-flap and swim motions, plus dweller stalk, flee and frozen poses, all driven by bone roles, plus custom keyframe animations with "plays when" conditions. The live 3D preview evaluates the same data that is exported as Molang.
- **World tabs**:
  - Vanilla sound events.
  - Natural spawn rules: placement, light, difficulty, herds, biome filters and more.
  - Loot tables and equipment.
  - Economy trades with levels.
- **Validator** that flags broken group/event/property references, goals missing their requirements (movement, attack, shooter…), spawn-rule mistakes, UV overflow and more, each with a "Fix" link.
- **Files tab** that shows every generated file, syntax-highlighted.
- **34 presets**: blank, farm animal, tameable pet, melee monster, ranged shooter, rideable mount, flying critter, water creature, village dweller, village guard, boss (with an enrage phase driven by a property), projectile, and the 22 dwellers.
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

`npm test` also covers the 1.2 additions:

- the node board ↔ settings round-trip;
- that rewiring the board changes the exported behaviour;
- appearance-director functions (command names checked against the official command list);
- animation-slot export;
- the sound editor's audio processing and WAV encoding;
- high-detail textures (including a PNG decode round-trip);
- glow pixels appearing only on faces, plus the emissive material in exports;
- jointed bodies that still stand on the ground.

```bash
npm run test:ui
```

`npm run test:ui` needs Playwright. It drives the built app in headless Chromium at phone size. It runs the dweller creator wizard and edits the node board (both drag and tap-to-connect), checking the settings change. Then it creates all 34 presets, opens every tab of each, exports, and checks the downloaded add-on.

## Data and licensing notes

`data/catalog.json` and `data/vanilla.json` hold only structural facts (identifiers, field names, value types, defaults, enum options). They are extracted from the metadata Mojang publishes for add-on creators. No documentation text is copied: component help links to the public Microsoft Learn reference. Mobsmith is not affiliated with Mojang or Microsoft.

## Credits

- Pixel font: [Silkscreen](https://fonts.google.com/specimen/Silkscreen) by Jason Kottke, SIL Open Font License 1.1 (bundled from `@fontsource/silkscreen`).
- Music: 5 original tracks synthesized by `tools/gen_music.py` (numpy synth, encoded to OGG Vorbis with ffmpeg). Run `python3 tools/gen_music.py` to regenerate them.
- 3D preview: three.js (MIT). UI: Preact (MIT). Compression: fflate (MIT).

## Known limitations

- Tested in desktop Chromium and with Node. **Not yet run on a physical Android device or emulator.** "Open in Minecraft" hands the file to the game with an `ACTION_VIEW` content URI; if a device's Minecraft doesn't accept it, use **Save .mcaddon** and open the file from a file manager.
- The appearance timer uses behavior-pack functions from `tick.json`. These run without cheats in normal worlds, but this hasn't been confirmed on a device yet. If a dweller never turns up, it still spawns naturally (if that's on), and the "Test it in game" commands on the Dweller tab summon it directly.
- Horror scares run through `queue_command` in entity events (`playsound`, `camerashake`, `effect`, `title`, `fog`, `particle`). Commands run by add-ons generally don't need cheats, but this hasn't been confirmed on a device. If a scare doesn't fire, the AI itself (states, gaze reactions, hunting) still works, because it doesn't depend on commands.
- Custom items and blocks, and the Script API, aren't included yet.
- Village AI such as sleeping in beds and working at job sites is engine logic tuned for villagers. Custom dwellers use the same components, but some behaviours may differ from vanilla villagers.
- The committed signing key is a convenience key for sideloading, not for store publishing.

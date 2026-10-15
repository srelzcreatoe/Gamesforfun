# FNAF Animatronics add-on

`FNAF_Animatronics.mcaddon` holds all 12 characters in one Minecraft Bedrock add-on:

Bonnie, Freddy, Withered Freddy, Party Cat, Rat, Monkey, Bat, Crocodile, Fox, Bunny, Goat and Bear.

It contains two packs:

- **FNAF Animatronics Resources** (resource pack): the models, animations, textures with glowing eyes, spawn eggs and names
- **FNAF Animatronics Behaviors** (behavior pack): one entity per character

No experimental toggles are needed.

## Install

1. Open `FNAF_Animatronics.mcaddon` with Minecraft (double-click it, or share it to Minecraft on phone or console). Both packs are imported.
2. In your world's settings, turn on **FNAF Animatronics Behaviors** under *Behavior Packs*. Its resource pack is added with it.

## Spawn

- Spawn eggs (*Spawn Freddy*, *Spawn Fox* and so on) are in the creative inventory.
- You can also use a command, for example: `/summon fnaf:fox`

Each animatronic's id is `fnaf:<name>`:

| Character | id |
| --- | --- |
| Bonnie | `fnaf:bonnie` |
| Freddy | `fnaf:freddy` |
| Withered Freddy | `fnaf:withered_freddy` |
| Party Cat | `fnaf:party_cat` |
| Rat | `fnaf:rat` |
| Monkey | `fnaf:monkey` |
| Bat | `fnaf:bat` |
| Crocodile | `fnaf:crocodile` |
| Fox | `fnaf:fox` |
| Bunny | `fnaf:bunny` |
| Goat | `fnaf:goat` |
| Bear | `fnaf:bear` |

## What they do

- **Movement:** they wander around, look at nearby players, and play idle, walk or run on their own depending on how fast they move.
- **Persistence:** they don't despawn, can be name-tagged and have 60 health.
- **Hostility:** they are **not hostile**. Your behavior pack can add attacking (see below).

### Poses, performances and jumpscares

Fire an event on a character to make it perform. While it performs it stands still.

```
/event entity @e[type=fnaf:freddy,c=1] fnaf:performance1
/event entity @e[type=fnaf:freddy,c=1] fnaf:idle
```

| Event | Animation |
| --- | --- |
| `fnaf:pose1` | Pose 1 (each character's pose from its picture) |
| `fnaf:pose2` | Pose 2 |
| `fnaf:performance1` | Performance 1 |
| `fnaf:performance2` | Performance 2 |
| `fnaf:jumpscare1` | Jumpscare 1. Plays once, then goes back to idle by itself. |
| `fnaf:jumpscare2` | Jumpscare 2. Plays once, then goes back to idle by itself. |
| `fnaf:idle` | Stop performing and walk around again |

- **Bonnie** has no jumpscares, only poses and performances.
- **How it works:** each event sets the entity's `minecraft:mark_variant` (1–6, or 0 for idle), and the resource pack's animation controller reads that value. A command block or your own scripts can drive it the same way.

## Making it your own

The `FNAF_Animatronics_RP` and `FNAF_Animatronics_BP` folders are the unzipped packs. Edit them, then zip both folders together and rename the zip to `.mcaddon`.

- **Make them hostile:** add `minecraft:behavior.nearest_attackable_target` (targeting `player`), `minecraft:behavior.melee_attack` and `minecraft:attack` to the components in `FNAF_Animatronics_BP/entities/<name>.json`. When they chase you they move faster, which plays the run animation.
- **Change a model:** open its `.bbmodel` in Blockbench, edit it, and use *File → Export → Export Bedrock Geometry* and *Animation → Export Animations*. Put the exported files over the ones in `FNAF_Animatronics_RP/models/entity/` and `FNAF_Animatronics_RP/animations/`.
- **Namespace:** to use another namespace, replace `fnaf:` in every file of both packs.
- **Rebuild from the repo:** `python3 tools/pack.py` rebuilds the `.mcaddon` from the character folders. The pack UUIDs are fixed, so the new build updates the same packs in Minecraft instead of adding a second copy.

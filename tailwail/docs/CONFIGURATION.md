# Configuration

Settings open from the **Torn Journal** (use it) or `/tailwail:settings`. World behaviour is
**operator-only**; presentation preferences belong to each player. Everything is stored in
dynamic properties, validated and clamped on load:
- `tailwail:settings3` on the world;
- `tailwail:prefs2`, `tailwail:mem` and `tailwail:sched2` on each player.

v3 starts from fresh world settings: v2's slower tuning (pursuit budget, slower chase) does
not carry over. Player preferences, memory and escalation stage do. In 3.1, worlds saved by
3.0 on a named preset move to the new chase speed once; Custom keeps its slider.

## Difficulty presets

Picking a preset applies all of its values. **Custom** keeps whatever the sliders say.

| | Calm | **Standard** | Nightmare |
|---|---|---|---|
| First encounter (eligible minutes) | 5–8 | **3–5.5** | 1.7–3.3 |
| Cooldown between encounters (min) | 7–12 | **4.5–7.5** | 2.7–5 |
| Protection after dying (min) | 6 | **4** | 3 |
| Haunting pace | ×0.7 | **×1.0** | ×1.4 |
| Hunting speed (blocks/s; a sprinting player does 5.6) | 7.8 | **7.8** | 7.8 |
| Out of sight this long before it loses you (s) | 6 | **8** | 11 |
| Stand-off agitation gain | ×0.8 | **×1.0** | ×1.3 |
| Rake / slam / pounce damage (HP) | 4 / 6 / 5 | **6 / 9 / 7** | 8 / 12 / 9 |
| Toughness (160 HP; damage taken ÷) | ×0.8 | **×1.0** | ×1.6 |
| Flees when its health drops below | 45 % | **35 %** | 25 % |

The hunting speed is the Cave Dweller's chase on every preset: movement speed 0.5 × chase
speed modifier 0.85 (Gargin's mod, as found in a public port of its code), which is ~7.8
blocks/s in both editions (a mob moves ~43 × value² blocks/s). It attacks once a second in
reach, like the Cave Dweller. Custom can still change the speed (5.6–10.8 blocks/s).

The grab and its mash-to-escape struggle are **parked**: the code is kept (and unit-tested)
for reuse, but no preset or setting turns it on in game. The presets still carry its
values (struggle presses, inescapable chance, throw / bite / smash damage), unused.

## World behaviour (operators)

| Setting | Default | Notes |
|---|---|---|
| Tailwail enabled | on | off ends every encounter immediately |
| Difficulty | Standard | see above |
| Encounter frequency | 100 % | multiplies the per-check start chance (25–200 %) |
| Haunting between encounters | Normal | Off / Rare (×1.8 spacing) / Normal / Constant (×0.55 spacing) |
| Jumpscares | on | "behind you", bed visits, the face at the window |
| It puts out torches | on | snuffed torches can always be relit; breaking one returns the torch |
| It leaves signs | on | claw marks in caves, tally marks by your bed, your things moved while you are away, its nest (and what it carries there when it kills you). Off: none of these are made; ones already made stay |
| Cave encounters | on | underground (sky light ≤ 3) |
| Night encounters outside | on | outside after dusk, in the dark |
| Can open wooden doors | on | |
| Breaks through | Doors and glass | Nothing / Doors, trapdoors and gates / Doors and glass. Only blocks between it and the player it is hunting; never iron doors |
| Climbs walls to reach you | on | pillaring up stops being safe |
| Ceiling and corner ambushes | on | cave openings where it waits on the ceiling or balled up in a corner |
| Rake damage | 6 HP | |
| Seconds out of sight before it loses you | 8 | it also has to be 18+ blocks away |
| Debug logging | off | content log lines prefixed `[Tailwail]` |

## Presentation (each player)

| Setting | Default | |
|---|---|---|
| Tailwail volume | 100 % | every creature and haunting sound |
| Camera effects | Full | Off / Reduced (gentle shake only: no FOV changes, fades or rotational shake) / Full |
| Music during encounters | on | stand-off drone, chase score |
| Dread fog during encounters | on | |
| Captions | off | action-bar captions for important sounds |
| Forget me | — | erases its memory of you, your escalation stage, your journal and its tally of your escapes |

## Commands

| Command | Who | |
|---|---|---|
| `/tailwail:journal` | anyone | opens the Torn Journal |
| `/tailwail:settings` | anyone | settings (world section for operators) |
| `/tailwail:debug signs <what>` | operators | 3.2 signs on demand: `claws` (marks beside you), `nest` (build one near you now; needs a dark, roomy cave floor 16-40 blocks away, out of sight), `tally` (a stroke on a wall by your bed, out of sight), `move` / `move_torch` / `move_barrel` / `move_chest` / `move_bed` (at your bed, out of sight) |
| `/tailwail:debug status` | operators | active encounters (state, grabs, hits, posture), your stage, waits, last outcome, why nothing started; also prints the resource-pack check line |
| `/tailwail:debug anim [clip]` | operators | **animation showcase**: a passive Tailwail appears in front of you and plays every body state and every one-shot (or just the one you name), captioned. If it stands still, the resource pack is not the 3.x one |
| `/tailwail:debug spawn [setup]` | operators | start an encounter for you now (needs a dark spot nearby). Caves: `stalker`, `corner_peek`, `tunnel_crawler`, `ceiling`, `huddle`. Anywhere: `the_rehearsal`, `behind_you`, `the_hunter`. Surface: `treeline`, `runner` |
| `/tailwail:debug presence [event]` | operators | trigger a haunting event: `footsteps`, `mimic`, `knock`, `scrape`, `glimpse`, `breath`, `snuff`, `peek`, `door`, `run_steps`, `distant_scream`, `runner`, `door_bang`, `whisper`, `lights_out`, `behind`, `window` |
| `/tailwail:debug stage <0-3>` | operators | set your escalation stage |
| `/tailwail:debug cooldown` | operators | clear your waits |
| `/tailwail:debug journal` | operators | unlock every journal page |
| `/tailwail:debug end` | operators | end every encounter and remove every Tailwail cleanly |
| `/tailwail:debug restore` | operators | restore your camera, FOV, fog, music and controls |
| `/tailwail:debug memory` / `resetmemory` | operators | show / reset your record |
| `/tailwail:debug log [on/off]` | operators | debug logging |
| `/tailwail:debug setups` | operators | list setups and haunting events |

The spawn egg and `/summon tailwail:tall_wail` create a **showcase** encounter for the
nearest player: a short opening that gets to the hunt quickly. It works in Creative too.
**Only one Tailwail exists at a time**: a new one from an egg, `/summon`, `debug spawn` or
`debug anim` replaces the one that is out (it is removed cleanly).

# Configuration

Settings open from the **Torn Journal** (use it) or `/tailwail:settings`. World behaviour is
**operator-only**; presentation preferences belong to each player. Everything is stored in
dynamic properties, validated and clamped on load:
- `tailwail:settings3` on the world;
- `tailwail:prefs2`, `tailwail:mem` and `tailwail:sched2` on each player.

v3 starts from fresh world settings: v2's slower tuning (pursuit budget, slower chase) does
not carry over. Player preferences, memory and escalation stage do.

## Difficulty presets

Picking a preset applies all of its values. **Custom** keeps whatever the sliders say.

| | Calm | **Standard** | Nightmare |
|---|---|---|---|
| First encounter (eligible minutes) | 5–8 | **3–5.5** | 1.7–3.3 |
| Cooldown between encounters (min) | 7–12 | **4.5–7.5** | 2.7–5 |
| Protection after dying (min) | 6 | **4** | 3 |
| Haunting pace | ×0.7 | **×1.0** | ×1.4 |
| Hunting speed (blocks/s; a sprinting player does 5.6) | 6.9 | **8.4** | 10 |
| Out of sight this long before it loses you (s) | 6 | **8** | 11 |
| Stand-off agitation gain | ×0.8 | **×1.0** | ×1.3 |
| Rake / slam / pounce damage (HP) | 4 / 6 / 5 | **6 / 9 / 7** | 8 / 12 / 9 |
| Throw / bite / smash damage (HP) | 4 / 7 / 6 | **6 / 11 / 9** | 8 / 15 / 12 |
| Struggle presses (random in range) | 4–7 | **6–11** | 9–15 |
| Chance a grab cannot be broken (never the first) | 0 % | **12 %** | 25 % |
| Toughness (160 HP; damage taken ÷) | ×0.8 | **×1.0** | ×1.6 |
| Flees when its health drops below | 45 % | **35 %** | 25 % |

## World behaviour (operators)

| Setting | Default | Notes |
|---|---|---|
| Tailwail enabled | on | off ends every encounter immediately |
| Difficulty | Standard | see above |
| Encounter frequency | 100 % | multiplies the per-check start chance (25–200 %) |
| Haunting between encounters | Normal | Off / Rare (×1.8 spacing) / Normal / Constant (×0.55 spacing) |
| Grab and struggle | on | off: rakes, slams and pounces only |
| Jumpscares | on | "behind you", bed visits, the face at the window |
| Fake chat | on | the fake "joined the game" line; only the haunted player sees it |
| It puts out torches | on | snuffed torches can always be relit; breaking one returns the torch |
| Cave encounters | on | underground (sky light ≤ 3) |
| Night encounters outside | on | outside after dusk, in the dark |
| Can open wooden doors | on | |
| Breaks through | Doors and glass | Nothing / Doors, trapdoors and gates / Doors and glass. Only blocks between it and the player it is hunting; never iron doors |
| Climbs walls to reach you | on | pillaring up stops being safe |
| Ceiling and corner ambushes | on | cave openings where it waits on the ceiling or balled up in a corner |
| Rake / bite damage | 6 / 11 HP | |
| Struggle: fewest / most presses | 6 / 11 | each grab picks a number in this range |
| Seconds out of sight before it loses you | 8 | it also has to be 18+ blocks away |
| Max Tailwails in the world | 2 | 1–3; nearby players share one encounter |
| Debug logging | off | content log lines prefixed `[Tailwail]` |

## Presentation (each player)

| Setting | Default | |
|---|---|---|
| Tailwail volume | 100 % | every creature and haunting sound |
| Camera effects | Full | Off / Reduced (gentle shake only: no FOV changes, fades or rotational shake) / Full |
| Music during encounters | on | stand-off drone, chase score |
| Dread fog during encounters | on | |
| Captions | off | action-bar captions for important sounds |
| Forget me | — | erases its memory of you, your escalation stage and your journal |

## Commands

| Command | Who | |
|---|---|---|
| `/tailwail:journal` | anyone | opens the Torn Journal |
| `/tailwail:settings` | anyone | settings (world section for operators) |
| `/tailwail:debug status` | operators | active encounters (state, grabs, hits, posture), your stage, waits, last outcome, why nothing started; also prints the resource-pack check line |
| `/tailwail:debug anim [clip]` | operators | **animation showcase**: a passive Tailwail appears in front of you and plays every body state and every one-shot (or just the one you name), captioned. If it stands still, the resource pack is not the 3.x one |
| `/tailwail:debug spawn [setup]` | operators | start an encounter for you now (needs a dark spot nearby). Caves: `stalker`, `corner_peek`, `tunnel_crawler`, `ceiling`, `huddle`. Anywhere: `the_rehearsal`, `behind_you`, `the_hunter`. Surface: `treeline`, `runner` |
| `/tailwail:debug presence [event]` | operators | trigger a haunting event: `footsteps`, `mimic`, `knock`, `scrape`, `glimpse`, `breath`, `snuff`, `peek`, `door`, `run_steps`, `distant_scream`, `runner`, `door_bang`, `whisper`, `lights_out`, `behind`, `window`, `fake_chat` |
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

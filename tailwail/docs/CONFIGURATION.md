# Configuration

Settings open from the **Torn Journal** (use it) or `/tailwail:settings`. World behaviour is
**operator-only**; presentation preferences belong to each player. Everything is stored in
dynamic properties (`tailwail:settings2` on the world, `tailwail:prefs2` / `tailwail:mem` /
`tailwail:sched2` on each player), validated and clamped on load.

## Difficulty presets

Picking a preset applies all of its values. **Custom** keeps whatever the sliders say.

| | Calm | **Standard** | Nightmare |
|---|---|---|---|
| First encounter (eligible minutes) | 6–9 | **4–7** | 2.5–4.5 |
| Cooldown between encounters (min) | 8–13 | **5–8** | 3–5.5 |
| Protection after dying (min) | 6 | **4** | 3 |
| Haunting pace multiplier | 0.7 | **1.0** | 1.4 |
| Chase speed (blocks/s) | 6.2 | **6.9** | 7.6 |
| Pursuit budget per commitment (s) | 20 | **26** | 34 |
| Agitation gain | ×0.8 | **×1.0** | ×1.3 |
| Throw / bite / strike damage (HP) | 4 / 8 / 5 | **6 / 12 / 7** | 8 / 16 / 9 |
| Jump presses to break free | 5 | **7** | 10 |
| Health (×160) | ×0.8 | **×1.0** | ×1.6 |

## World behaviour (operators)

| Setting | Default | Notes |
|---|---|---|
| Tailwail enabled | on | off ends every encounter immediately |
| Difficulty | Standard | see above |
| Encounter frequency | 100 % | multiplies the per-check start chance (25–200 %) |
| Haunting between encounters | Normal | Off / Rare (×1.8 spacing) / Normal / Constant (×0.55 spacing) |
| Grab and struggle | on | off: plain strikes only |
| Jumpscares | on | "behind you" and bed visits |
| Fake chat | on | the fake "joined the game" line; only the haunted player sees it |
| It puts out torches | on | snuffed torches can always be relit; breaking them returns the torch |
| Cave encounters | on | underground (sky light ≤ 3) |
| Night encounters outside | on | outside after dusk |
| Can open wooden doors | on | it never breaks blocks |
| Throw / bite damage | 6 / 12 HP | |
| Jump presses to break free | 7 | |
| Pursuit duration | 26 s | |
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
| `/tailwail:debug status` | operators | active encounters (state, agitation, posture), your stage, waits, last outcome, why nothing started |
| `/tailwail:debug spawn [setup]` | operators | start an encounter for you now (needs a dark spot nearby). Setups: `statue_hunt`, `corner_peek`, `tunnel_crawler`, `distant_watcher`, `the_rehearsal`, `cavern_reveal`, `behind_you`, `the_hunter` |
| `/tailwail:debug presence [event]` | operators | trigger a haunting event: `footsteps`, `mimic`, `knock`, `glimpse`, `breath`, `snuff`, `peek`, `door`, `whisper`, `lights_out`, `behind`, `fake_chat` |
| `/tailwail:debug stage <0-3>` | operators | set your escalation stage |
| `/tailwail:debug cooldown` | operators | clear your waits |
| `/tailwail:debug journal` | operators | unlock every journal page |
| `/tailwail:debug end` | operators | end every encounter and remove every Tailwail cleanly |
| `/tailwail:debug restore` | operators | restore your camera, FOV, fog, music and controls |
| `/tailwail:debug memory` / `resetmemory` | operators | show / reset your record |
| `/tailwail:debug log [on/off]` | operators | debug logging |
| `/scriptevent tailwail:debug <op> [arg]` | console / command blocks | same operations |

The spawn egg and `/summon tailwail:tall_wail` create a **showcase** encounter for the
nearest player. It is shorter and works in Creative too, so you can see everything quickly.

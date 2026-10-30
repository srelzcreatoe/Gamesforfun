# Configuration reference

Settings are stored as versioned JSON in dynamic properties (world: `tailwail:settings`;
player: `tailwail:prefs`). They survive reloads and can be reset by removing the add-on's
data with `/tailwail:debug` tools or by re-creating the world. All tuning constants that are
not exposed live in `packs/TailwailBP/scripts/config.js`.

## World behaviour (operators only)

Open with `/tailwail:settings` → *World behaviour (operator)*. "Operator" = player
permission level Operator, or command permission Game Directors and above. New values
apply to the next encounter.

| Setting | Balanced (default) | Intense | Range |
|---|---|---|---|
| Encounters enabled | on | on | on/off |
| Encounter frequency | 100 % | 100 % | 25–200 % (scales the per-10 s eligibility roll, base 22 %) |
| Cooldown after an encounter | 6–10 min (randomised) | 4–7 min | 2–30 / 3–40 min; ×1.2 after pursuits, ×0.85 after sightings, occasional ×1.6 quiet stretch |
| New-player grace period | 10 min | 5 min | 0–30 min |
| Post-death protection | 5 min | 4 min | config only |
| Strike damage | 3.5 hearts | 5 hearts | 1–10 hearts |
| Pursuit duration | 25 s | 32 s | 15–45 s |
| Chase speed | 0.40 (≈ 6.9 blocks/s) | 0.42 (≈ 7.6 blocks/s) | config only; player sprint ≈ 5.6 blocks/s |
| Agitation scale | 1.0 | 1.3 | config only (increases only; calming is never slowed) |
| Toughness (damage taken ÷) | 1.0 (160 HP) | 1.5 (≈ 240 HP effective) | config only |
| Imitation frequency | 70 % | 85 % | 0–100 % |
| Cave encounters | on | on | on/off |
| Night woodland encounters | off | off | on/off (secondary; less tested) |
| Can open wooden doors | on | on | on/off |
| Max simultaneous Tailwails | 2 | 2 | 1–3 (also one per player group within 24 blocks) |
| Debug logging | off | off | on/off (content log) |

Choosing **Balanced** or **Intense** in the preset dropdown applies that preset's values;
**Custom** keeps the slider values. Both presets use identical rules: the same warnings,
the same 3.2 s wind-up, the same escape conditions. Intense only changes magnitudes.

## Presentation (every player, for themselves)

| Setting | Default | Notes |
|---|---|---|
| Tailwail volume | 100 % | multiplies every Tailwail sound for this player only |
| Optional effects | Full | Off / Subtle (no camera shake) / Full (short camera shake on the wail and on hits). "Off" also dampens the wail head-shake animation for this viewer. |
| Captions | off | action-bar captions for important sounds (breath, scrapes, clicks, inhale, wail, snarl, retreat) |
| Erase my memory | — | clears what Tailwail remembers about you |

No setting adds permanent screen overlays, fog, music, input locks or camera control.

## Commands

| Command | Permission | Purpose |
|---|---|---|
| `/tailwail:guide` | anyone | open the field guide |
| `/tailwail:settings` | anyone (world section: operators) | settings |
| `/tailwail:debug status` | Game Directors+ | active encounters, your cooldown, last rejection reason, outcome counts |
| `/tailwail:debug spawn [setup]` | Game Directors+ | start a spawn search near you now (setups: `distant_silhouette`, `corner_peek`, `delayed_imitation`, `low_tunnel_observation`, `full_height_reveal`, `voluntary_withdrawal`); it still needs a dark, hidden, reachable site |
| `/tailwail:debug end` | Game Directors+ | end and remove every encounter cleanly |
| `/tailwail:debug memory` / `resetmemory` | Game Directors+ | show / clear your memory record |
| `/tailwail:debug cooldown` | Game Directors+ | clear your cooldown |
| `/tailwail:debug log [on/off]` | Game Directors+ | toggle content-log diagnostics |
| `/scriptevent tailwail:debug <op>` | console / command blocks | same ops without a player context |

None of these require cheats; normal survival play never needs any of them.
The spawn egg and `/summon tailwail:tall_wail` create a Tailwail that targets the nearest
non-spectator player (including Creative, for showcases; damage does not apply in Creative).

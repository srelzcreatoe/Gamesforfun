# Animation usage report — Grinshackle v2.0.0

All 21 supplied clips are referenced by exact identifier (`animation.grinshackle_chainreaver.<suffix>`), reachable through a real gameplay
trigger, and selectable in preview mode (`/scriptevent gs:control preview <suffix>`, or `preview loop` to cycle all 21).

## Controller layout (resource pack)

Four animation controllers run in this order in the client entity's `scripts.animate` list; because every supplied clip has
`override_previous_animation: true`, a one-shot action fully replaces the locomotion pose for the bones it keys, and the small procedural
overlays (which do not override) add on top.

| Controller | Driven by | States |
|---|---|---|
| `controller.animation.gs.pose` | entity property `gs:pose` (enum) | `hidden, emerge, idle, stalk, walk, run, crouch, crawl, stare, battle_idle, vanish, collapse`; `stalk`/`walk` play `idle` and `run` plays `battle_idle` and `crawl` plays `crouch` while `query.modified_move_speed <= 0.02` |
| `controller.animation.gs.action` | property `gs:action` (int 0–10) | `none, alert, twitch, lunge, chain_whip, roar, hurt, chain_snap, attack, slam, attack_crawl`; exit only when the property changes (script resets it at clip end; one-shots hold their last frame so latency never shows the bind pose) |
| `controller.animation.gs.overlay` | property `gs:overlay` (int 0–2) | `none, gather_chains, tighten` (procedural additions, see below) |
| `controller.animation.gs.track` | property `gs:track` (bool) | head/neck tracking of the current target (procedural) |

Blend transitions: pose 0.15 s, actions 0.08 s (attacks, hurt) / 0.12 s (others), overlays 0.35–0.6 s.

## The 21 clips

| Clip | Length | Loop | Controller / state | Gameplay trigger (director) | Priority / exit | Test case |
|---|---:|---|---|---|---|---|
| `idle` | 5.10 s | loop | pose: `idle`; also plays inside `stalk` and `walk` when stationary | OBSERVE without line of sight; stalk/walk states while not moving (rare resting/listening) | base layer; exits on pose change | preview `idle`; stand still while it stalks |
| `battle_idle` | 2.91 s | loop | pose: `battle_idle`; inside `run` when stationary | HUNT/hesitation between attacks (creature stopped, circling) | base; pose change | preview; block its path during a hunt |
| `stalk` | 1.91 s | loop | pose: `stalk` (moving) | STALK approach, INVESTIGATE within 10 blocks | base; `anim_time_update` follows ground speed | preview; natural stalk |
| `walk` | 1.09 s | loop | pose: `walk` (moving) | INVESTIGATE, SEARCH, corner relocation, FLANK route, retreat-pause walk to cover | base | preview; throw a Rattle Lure while it observes |
| `run` | 0.60 s | loop | pose: `run` (moving) | HUNT pursuit, RETREAT | base | preview; hunt |
| `alert` | 1.73 s | once (hold) | action 1 | WARNING for the Last Link variant (after the chain click), retreat-pause re-emergence | 35 ticks then property reset | preview; provoke during the silent stalk |
| `stare` | 4.19 s | loop | pose: `stare` | OBSERVE with line of sight, corner watch, light-threshold hesitation, search-point pause | base | preview; look at it from a corridor |
| `twitch` | 1.32 s | once (hold) | action 2 | infrequent while observed/unwatched in OBSERVE (≈25 % per 2 s), first tightening, occasional while stalked at < 12 blocks | 26 ticks | preview; stare at it for 6 s |
| `lunge` | 1.41 s | once (hold) | action 3 | feint variant: telegraphed harmless lunge at 2.5–6 blocks at the end of the stalk (no damage) | 28 ticks | preview; feint variant |
| `chain_whip` | 1.68 s | once (hold) | action 4 | WARNING (default warning before a hunt) | 34 ticks | preview; let tension reach 100 |
| `roar` | 2.37 s | once (hold) | action 5 | WARNING, rare (25 %, first hunt of the encounter only) | 47 ticks | preview; repeated encounters |
| `emerge` | 2.64 s | once (hold) | pose: `emerge` | EMERGE at a validated spawn point (ink sound + puff), also after a reload | 53 ticks then OBSERVE/STALK | preview start; test spawn |
| `vanish` | 1.91 s | hold | pose: `vanish` | end of RETREAT, sighting-only encounters, target loss, master-independent cleanup path | 38 ticks then removal | preview; `end` is immediate, retreat shows it |
| `hurt` | 0.66 s | once (hold) | action 6 | any damage while not attacking, rate-limited to one per 1.5 s; brief flinch, no stun-lock | 13 ticks | hit it twice quickly |
| `collapse` | 2.28 s | hold | pose: `collapse` | virtual health reaches 0 (genuine defeat): loot + experience after the clip | 46 ticks then removal | defeat it |
| `crouch` | 3.46 s | loop | pose: `crouch`; inside `crawl` when stationary | FLANK wait at a passage, retreat-pause listening, stationary crawl | base | preview; ambusher variant |
| `chain_snap` | 2.18 s | once (hold) | action 7 | player walks/sprints over a chain fragment during HUNT (motion stops for the clip; enrage starts after it) | 44 ticks | step on a fragment |
| `attack` | 1.35 s | once (hold) | action 8 | HUNT within 1.7 blocks (70 % / 40 % vs rushers); impact tick 12 | 27 ticks, then 15-tick gap | hunt |
| `slam` | 1.75 s | once (hold) | action 9 | HUNT within 1.6 blocks (30 % / 60 % vs rushers); impact tick 17 | 35 ticks | hunt after rushing it |
| `crawl` | 1.10 s | loop | pose: `crawl` (moving) | HUNT through two-block passages (collision box 1.95) | base | dig a 2-high tunnel |
| `attack_crawl` | 1.15 s | once (hold) | action 10 | HUNT while crawling within 1.8 blocks; impact tick 10 | 23 ticks | attack in a tunnel |

## Procedural additions (not part of the supplied 21; documented, small, additive)

* `overlay_head_track` — neck 35/45 % and head 45 % of `query.target_x_rotation` / `query.target_y_rotation`. Used in observation states so the
  face stays on the player while the body turns at ≤ 60°/s from the script.
* `overlay_gather_chains` — forearms folded to the chest, fingers curled, hanging/hip/shoulder chains scaled down (chains held still) for THE LAST LINK.
* `overlay_tighten` — hunched chest, raised shoulders, curled claws, bent knees: the visible tightening after ≈6 s of being watched.

## Corrections applied to the supplied clips (minimal edits, verified numerically with the FK toolkit)

See `fixlog.json` in `assets/` for the machine-readable list. Summary:

* Every one-shot clip now uses `loop: "hold_on_last_frame"` (a finished one-shot no longer snaps to the bind pose before the controller blends out).
* `run`: hand_r static rotation re-expressed as a blend-safe small-angle triple (the wrapped 232°/206° triple spun the hand during blends); length
  0.582 → 0.6 with a wrap key (seam 4.4° → 0°); right leg resampled from the left with an exact half-cycle shift (landing pop 24.7° → 18°);
  `anim_time_update` follows ground speed.
* `walk`: left leg resampled with the exact half-cycle shift (pop 16.7° → 11°); `anim_time_update`.
* `stalk`, `crawl`: `anim_time_update` so planted feet stop skating at engine speeds.
* `crawl` / `attack_crawl`: root lowered 0.5 u and arms pitched 4.5° so hands and feet reach the floor; chain loop seam cross-faded (4.2° → 0°);
  neck raised 2.5 u so the jaw no longer sits inside the chest (31 % → 0 %); both clips keep an identical rest pose (0.0 u difference).
* `attack` / `slam`: first and last 0.35–0.45 s eased onto the battle_idle stance (blend pop 9.0 u → 1.8 u); neck lift + jaw cap during the lean
  (jaw-in-chest 25 % → 0 %); root z lunge removed (no planted-foot skate); `slam` arms spread ±16° while raised (hands through horns 70 % → 3 %).
* `alert`: head roll ×0.6 during the stare hold (jaw out of the collar). `twitch`: spike ×0.7 (jaw out of the collar, jerk still visible).
* Strike direction verified: at impact the striking hand is at its most-forward point toward -Z (attack: hand −0.98 blocks, claws −1.33 blocks;
  slam: −0.94 / −1.22; crawl strike claws ≈ −1.5). Coded reach was reduced to match (see README combat table).

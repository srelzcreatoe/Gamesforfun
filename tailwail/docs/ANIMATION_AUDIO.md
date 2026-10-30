# Animation and audio map

The server never plays animations directly. It sets **client-synced entity properties**;
six animation controllers on the client turn them into clips. Because properties are part
of the entity's synced state, a client that walks into range mid-encounter immediately
gets the correct state. Generators: `tools/build_assets.py` (clips) and
`tools/gen_controllers.py` (controllers).

## Properties (server → client)

| Property | Values | Driven by |
|---|---|---|
| `tailwail:state` | inactive, stalk, standoff, unfold, windup, chase, search, retreat, death | brain state |
| `tailwail:posture` | tall, hunch, crawl | posture controller (also switches the collision group) |
| `tailwail:headroom` | 0–8 | measured clear blocks above it (chooses the unfold variant) |
| `tailwail:agit` | 1 calm, 2 agitated, 3 committed | agitation cue level |
| `tailwail:tail` | drag, twitch, rigid, free | brain (rigid only during a real commitment) |
| `tailwail:voice` | silent, breath, click, inhale, wail, snarl | set together with the matching sound |
| `tailwail:mimic`, `mimic_amt`, `mimic_pitch` | none/crouch/tilt/step/shrug, 0–2, −60..60 | imitation replay |
| `tailwail:action` | none, strike, peek_l, peek_r, listen, ambush, stuck | one-shot actions (strike is cleared between strikes, so it always restarts) |
| `tailwail:look_yaw`, `look_pitch` | −90..90, −60..60 (3° steps) | head tracking toward the locked target, relative to the body |
| `tailwail:fx` | 0–2 | **per viewer** via `setPropertyOverrideForEntity` (that player's effects preference) |

## Controllers and bone ownership

| Controller | Owns | States → clips |
|---|---|---|
| body | root, hips, spine, legs, arms, fingers (base pose and locomotion) | `upright`: idle_nt + walk_nt/pace_nt by speed + watch_nt (stalk/stand-off, still) + menace_nt (agitated) + withdraw (retreat) · `drop`/`rise` (0.5 s transitions) · `low`: planted ↔ crawl gallop by speed · `tunnel`: planted/crawl + tw_tunnel_still/move · `unfold`: reveal + tw_unfold_full (headroom ≥ 7) or tw_unfold_mid · `unfold_low`: planted + tw_unfold_low · `windup` / `windup_c` · `strike`: tw_strike · `ambush` · `stuck` · `peek_l`/`peek_r` · `death` / `death_low` — every keyframed supplied clip plays with its `gfix_*` grounding overlay |
| tail | tail0–tail4 (expression) | `drag`: tw_tail_drag (upright) / tw_tail_drag_low (hunched) · `twitch`: tw_tail_twitch · `rigid`: tw_tail_rigid · `free`: none (body clips' own tail motion, e.g. gallop sway). Body clips that had procedural tail sway use tail-free copies (`*_nt`); keyframed body clips only contribute a static droop |
| face | head/neck tracking + jaw | `look` + `jaw` always · `click`: + echo · `wail`: + scream_nt (dampened for viewers with effects off) · `inhale`: + tw_inhale · `listen`: + listen |
| mimic | additive imitation overlays | tw_mimic_crouch / tw_mimic_step (upright only, weighted by 1 − movement), tw_mimic_shrug, tw_mimic_tilt — active in stalk and stand-off; variables ease out before the state switches off |
| agitation | additive twitch | `twitch` (supplied, 4.4 s) while agitation level 2 |
| hurt | additive flinch | `hurt` while `q.hurt_time > 0`, exits only after it finished and the hurt timer is 0 (no replay loop) |

Held clips (`hold_on_last_frame`) can never strand the body: every body state that holds
exits on a property change, and the one looping-by-design clip that should be bounded
(`scream`) only plays while `voice == wail` (≈ 1.8 s per commitment).

## Molang variables (all initialised in `initialize`, updated every frame in `pre_animation`)

| Variable | Units / range | Derived from the supplied math | Update |
|---|---|---|---|
| `v.walk` | gait phase, **degrees**, wrapped 0–360 | `math.sin(v.walk)`, `+180` for the opposite leg, `v.walk*2` for the bob → one stride = 360° | += distance moved × 360 / stride; stride 2.17 blocks (pace) … 2.89 (walk), measured from foot contact in the clips |
| `v.move` | 0–1 | scales the root bob (`-0.9*v.move`) → a normalised intensity, also used as the gait blend weight | eased toward ground speed / 1.6 b/s |
| `v.crawl` | 0–1 (anim time of the 1.0 s gallop) | `anim_time_update` | += distance / 1.62 blocks per cycle (hand stance travel measured) → limited sliding |
| `v.climb_t` | 0 | `anim_time_update` of `climb` | held at 0: climbing is not used (no stable collision-aware support) |
| `v.look_x`, `v.look_y` | degrees, pitch ±45, yaw ±80 | clip clamps `look_x*0.6` to ±14 and saturates `abs(look_y)/80` | eased toward the server's look properties |
| `v.jaw` | degrees added to the 12° rest, −2..40 | `rotation x = v.jaw`, drop `0.1*max(v.jaw,0)` | from voice: breath 0–4, click 3, inhale 12, snarl 18, wind-up ≥ 16, wail 31–37, death 22 |
| `v.mimic_*` | crouch 0–1.6, step 0–0.5, shrug 0–1.5, roll/pitch degrees | new | eased (≈ 0.45 s) toward the replay targets |

## New and derived clips (`tall_wail.rehearsal.animation.json`)

| Clip | Purpose | How it was made |
|---|---|---|
| `idle_nt`, `walk_nt`, `pace_nt`, `watch_nt`, `menace_nt`, `scream_nt` | supplied procedural clips minus tail bones | copied, tail channels removed (tail controller owns tail expression) |
| `gfix_*` (14 clips) | keep feet/hands on the floor | root offset solved per sample from the supplied clip (max 0.6–1.9 px) |
| `tw_strike` | readable melee | supplied `strike` re-timed: impact moved 0.35 → 0.55 s, length 0.95 s |
| `tw_mimic_crouch` | delayed / exaggerated crouch | knee/thigh angles solved so feet stay planted (residual < 0.02 px) at depths 3, 6.5, 11 px |
| `tw_mimic_step`, `tw_mimic_shrug`, `tw_mimic_tilt` | stop-start freeze mid-step, hiked shoulders, head pitch + quizzical roll | new keyframes / Molang |
| `tw_tail_drag`, `tw_tail_drag_low`, `tw_tail_twitch`, `tw_tail_rigid` | the three tail readings | drag angles solved per posture (hunched tip rests 0.6 px above the floor); sway reuses the supplied idle tail expressions |
| `tw_inhale` | agitated inhale | new |
| `tw_unfold_full`, `tw_unfold_mid`, `tw_unfold_low` | the unfolding, as tall as the space allows | layered on the supplied `reveal` (2.0 s) / `planted`; grounding solved; peak 5.0 / 4.8 / 3.3 blocks |
| `tw_tunnel_still`, `tw_tunnel_move` | 2-block passages | constrained pose search over the gallop cycle: max 1.81 blocks high |

Supplied clips not used in gameplay: `climb` (no physical wall climbing), `pounce` and
`lunge` (no physics-backed leap; kept for future work), `vanish_pose` (identical to
`planted`). `idle`, `walk`, `pace`, `watch`, `menace`, `scream` are used through their
tail-free copies; all others are used directly.

## Sound palette

All sounds are original, synthesised by `tools/gen_audio.py` (fixed seeds), Ogg Vorbis
mono 44.1 kHz, 36 files / 577 KB. Played per player at the creature's head position with
that player's volume; distance attenuation from `sound_definitions.json`.

| Cue | Sound id (variants) | When | Min gap | Range |
|---|---|---|---|---|
| distant breath | `tailwail.breath` (3) | stalking, every 14–26 s within 26 blocks | 10 s | 30 |
| tail scrape | `tailwail.tail_scrape` (3) | stalking movement; peek withdrawal | 9 s | 26 |
| nail scrape | `tailwail.nail_scrape` (2) | corner-peek / low-tunnel setups, unobserved, every 30–55 s | 25 s | 28 |
| throat click | `tailwail.click` (3) | agitation level 2 bursts; search listening | 2.5 s | 32 |
| agitated inhale | `tailwail.inhale` (2) | agitation > 75 (once), reveal setup, start of wind-up | 6 s | 40 |
| **full wail** | `tailwail.wail` (2) | end of the wind-up — once per real commitment | one-shot | 72 |
| exertion | `tailwail.exertion` (3) | during pursuit | 2 s | 40 |
| heavy hands | `tailwail.step_heavy` (4) | every half gallop cycle travelled in pursuit/search | 0.22 s | 40 |
| soft steps | `tailwail.step_soft` (3) | every 2.2 blocks while stalking/retreating | 0.6 s | 20 |
| swipe / impact | `tailwail.swipe` / `tailwail.impact` (2+2) | strike start / strike landed | 0.8 s | 24 |
| snarl | `tailwail.snarl` (2) | frustrated search end, reacquire, hit while retreating | 4 s | 40 |
| retreat | `tailwail.retreat` (2) | start of every withdrawal | 20 s | 40 |
| hurt / death | `tailwail.hurt` (2) / `tailwail.death` (1) | damage taken / scripted death | 0.4 / 10 s | 32 / 64 |

Per player at most 3 Tailwail sounds per second across all encounters. Levels: the wail
peaks at −0.7 dBFS; breath, scrapes and clicks sit around −27 to −33 dBFS RMS so silence
and quiet cues dominate. Silence is a state: unfold is silent by design, and stalking
cues are spaced so mining can continue between them.

**Status:** functional and original, but not release-polished — see
[LIMITATIONS.md](LIMITATIONS.md). They were checked by level/clipping measurement and
spectrograms only; no human listening test has been done yet.

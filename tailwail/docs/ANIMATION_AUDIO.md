# Animation and audio

## How the client is wired (v3)

Everything the creature does on screen comes from **one generated file**,
`packs/TailwailRP/animations/tall_wail.v3.animation.json` (ids `animation.tall_wail.v3.*`),
baked by `tools/anim_v3.py`. The resource pack no longer ships the supplied, rehearsal or v2
animation files; the supplied clips are read from the untouched archive and re-baked where
they are reused (walk, crawl, the "planted" crouch).

Three layers:

1. **Body**: one controller (`controller.animation.tall_wail.v3_body`) keyed on a single
   int property, `tailwail:act`. Each state plays one looping clip. The server alone decides
   durations: a state exits on nothing but `act != N`, so it cannot get stuck.
2. **One-shots**: attacks, the scream, the drop from the ceiling and so on are played by the
   behavior pack with `Entity.playAnimation` on a controller of their own
   (`tailwail_shot`; flinches on `tailwail_partial`). While a full-body one-shot plays, the
   body sits in the neutral `shot` state.
3. **Overlays**, always on, as weighted `animate` entries: breathing, tremor, head look (an
   inverted version on the ceiling), jaw, tail (free / lash / curl / rigid / floor-solved
   tunnel), mimicry (crouch, tilt, shrug) and the hurt flinch.

### Why it cannot freeze

- The default body state, `loco`, needs **no entity property**: it blends idle / walk /
  gallop by `q.ground_speed`.
- Every variable is read with a `??` fallback, and nothing is set in `initialize`. If the
  pre-animation script failed outright, every weight would fall back to a value computed
  from queries, instead of zero.
- `tools/client_sim.py` runs the controllers frame by frame with pre-animation **disabled**:
  the creature still idles, walks, gallops, breathes and moves its tail.
- Nothing holds a frozen frame (only death holds its last frame). Every pose clip loops with
  breathing, twitches and restless fingers baked in, at amplitudes that read at 20+ blocks.
- One-shots need no client logic at all.
- Version check: the join message is a translation key that only this resource pack
  defines, so a stale or missing resource pack shows itself in chat.

### Gaits (distance-driven)

`anim_time_update: math.mod(q.modified_distance_moved, S) / S`, with the stride S measured
from the foot travel of the baked clip, so feet do not skate.

| Gait | Used | Stride (blocks) |
|---|---|---|
| `gallop` | any loco state above ~4 m/s: the charge on knuckles and feet (transverse gallop, spine flexing, jaw flapping) | 3.0 |
| `walk` | `loco` 1–4 m/s: long hunched steps, rolling shoulders, head locked forward (supplied walk + new upper body) | 2.9 |
| `creep` | `loco_low` 1–4 m/s: low knuckle crawl, head fixed on you (supplied crawl) | 1.9 |
| `tunnel_move` | `loco_tunnel`: belly crawl that fits a 2-high tunnel (< 2 blocks with every overlay) | 1.0 |

The body bob of the gallop was solved numerically (limb base angles chosen so the
lowest support point varies by ~0.2 blocks).

### Body states (`tailwail:act`)

| Act | What you see |
|---|---|
| `loco` / `loco_low` / `loco_tunnel` | idle (heavy breathing, scanning head with bird-like snaps, a full-body shudder) / folded idle (fingers drumming the rock) / tunnel idle; plus the gaits above |
| `watch` | weight forward, head jutting at you, slowly tilting past natural, then snapping back |
| `watch_low` | crouched like a cat before the pounce: rump swaying, head dead still |
| `tall` | unfolded to full height (~4.8 blocks), looming, head tipped down at you, rocking |
| `peek_l`, `peek_r` | leaning out from cover, fingers tapping the edge, head cocked the wrong way |
| `cling` | upside down on the ceiling like a spider, face rolled the right way up, re-gripping |
| `climb` | hauling itself up a wall hand over hand |
| `hold` | holding you at its face, shaking you, head tilting to inspect, jaw working |
| `sniff`, `listen` | searching: face to the ground with hard sniffs / frozen, three sharp head turns |
| `stunned` | reeling after you tear free, a hand clawing at its own face |
| `savor` | standing over you, sniffing, a shudder, then craning up to shriek |
| `huddle` | balled up in a corner like a heap of rock and hair, back heaving |
| `bash` | hammering a door with both fists in turn |
| `reach_in` | pressed flat to a hole, one long arm groping inside |
| `behind`, `neck`, `reach` | hallucination poses (also used by the echo entity) |
| `death` | collapses forward, limbs twitching |
| `shot` | neutral: a one-shot clip is playing |

### One-shots (`Entity.playAnimation`)

| Clip | Length | Synced frames (scripts use these) |
|---|---|---|
| `scream` | 1.9 s | unfolds, arches, lunges its face forward, whole body shaking, drops to all fours; effects at 0.62 |
| `roar` | 1.1 s | from the gallop stance (low ceilings, mid-hunt, after an ambush) |
| `rise` | 1.1 s | from the crouch to full height: the last warning |
| `swipe_r`, `swipe_l` | 0.62 s | hit at 0.28 |
| `combo` | 1.0 s | hits at 0.28 and 0.62 |
| `slam` | 1.05 s | rears up with both fists overhead; hit at 0.52 |
| `pounce` | 1.0 s | launch at 0.22 (the script applies the impulse), landing hit at 0.6 |
| `lunge_grab` | 0.5 s | hands close at 0.4; ends in the hold pose |
| `throw`, `smash`, `bite` | 0.75 / 1.0 / 0.95 s | release at 0.3 / 0.5, bite at 0.38 |
| `drop` | 0.8 s | lets go of the ceiling, flips upright, lands in a crouch |
| `turn` | 0.55 s | whips round from the huddle |
| `howl` | 1.8 s | gives up: rears, beats the ground, howls |
| `knock` | 1.2 s | three knocks |
| `flinch` | 0.4 s | partial, additive: recoils from every hit |

Lengths and frames are generated into `core/ids.js` (`SHOT`), so script timing can never
drift from the clips; `tools/validate.py` checks them again.

## Audio

All sounds are original, synthesized by `tools/gen_audio_v2.py` (numpy): formant-filtered
glottal voices with roughness and period doubling, a second detuned throat for screams,
granular grit, bone cracks, thumps, cave reverb, and soft-clip compression.

v3 changes:
- **Louder**: every cue is normalised to a loudness target (RMS of its loudest 400 ms):
  −5/−6 dBFS for screams, roars and slams; −8 for attacks and footsteps; −9 to −13 for
  stalking cues. A soft limiter keeps every peak under −0.3 dBFS.
- **Heard from farther away**: `min_distance` (full volume radius) went up across the board,
  e.g. the scream 8 → 28 blocks, the roar 20, heavy steps 4 → 12, screeches 6 → 16.
- **11 new events**: `roar`, `growl`, `grunt`, `slam`, `pounce`, `shriek` (the scream right
  on top of you), `scream_pain` (wounded, fleeing), `climb`, `scrape`, `thud` (landing),
  `door_bang`.

43 events (95 files) + 2 streamed music loops, ~3 MB of Ogg Vorbis. Subtitles for every
event are in the resource pack's lang file.

| Event | Played when |
|---|---|
| `click`, `skitter`, `creak`, `growl`, `breath*` | stalking and the stand-off |
| `inhale`, `scream`, `scream_far`, `roar`, `shriek` | the commitment, regained sight, ambushes |
| `step_heavy` | every gallop stride (it shakes the ground) |
| `swipe`, `impact`, `grunt`, `slam`, `pounce`, `thud` | attacks |
| `grab`, `hold`, `bite`, `throw`, `pain` | the grab |
| `climb`, `scrape`, `door_bang` | climbing, reaching into holes, smashing doors |
| `sniff`, `frustrated` (howl), `retreat`, `scream_pain`, `hurt`, `death` | searching, leaving, fleeing, fighting |
| `knock`, `whisper`, `stinger`, `heartbeat` | the haunting and the player's heartbeat |
| `music.standoff`, `music.chase` | per-player music (category music, streamed) |

Nobody has listened to these on real speakers yet; they were checked numerically
(spectrograms, envelopes, peak and loudness).

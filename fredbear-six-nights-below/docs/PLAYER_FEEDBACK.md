# Owner's to-do list

Requests from the map owner after their in-game playthrough (campaign completed through night 6). Work only starts when
the owner says go.

Status: **done (untested)** = in WIP commit `cb939b3`, not yet validated, packaged or tried in-game. **planned** = agreed,
not started. **idea** = suggested, not chosen yet.

## The list

Numbers stay fixed from now on: new items are added at the end.

### Sounds and music (details in sections A and E)

| # | Item | Status |
|---|---|---|
| 1 | Freddy, Bonnie and Chica jumpscares use `Jumpscare_animatronics`; Fredbear's uses `fredbearboi` | done (untested) |
| 2 | Doors and hatch: storm-door slam when closing, metal door when opening | done (untested) |
| 3 | Camera open / close sounds use the owner's clips | done (untested) |
| 4 | CCTV hum loops while the camera monitor is up | done (untested) |
| 5 | Freddy's laugh replaced by the owner's laughs (4 variants) | done (untested) |
| 6 | Fredbear's laughs are imported (4 variants) but don't play anywhere yet. Plan: he laughs each time he starts coming for you, as a warning | planned |
| 7 | Background music: "PIZZA DINNER" (FNAF 1 Remake OST) loops from 12 AM to 6 AM; Minecraft's own music is silenced while it plays (other sounds are not); a Music ON/OFF option in the Shift Guide | planned |

### Gameplay fixes (details in sections B and C)

| # | Item | Status |
|---|---|---|
| 8 | More strobe charges: night 4: 3 → 4, night 5: 3 → 5, night 6: 4 → 6 (plus 2 at 5 AM), always 2 spare | planned |
| 9 | Fredbear door fix: each door and the hatch holds him off once per night (he pounds, gives up, goes back); the second time at the same entry he breaks it unless strobed; at 5 AM on night 6 nothing holds him; the strobe still always works | planned |

### Creepy ideas (details in section D)

| # | Item | Status |
|---|---|---|
| 10 | The building changes between nights (posters, missing props, a Fredbear head on the desk) | idea |
| 11 | They stare back: watched too long on camera, they turn their head to the lens | idea |
| 12 | Close-ups: rarely, a face fills the whole camera feed for a moment | idea |
| 13 | Hallucinations on nights 5-6: flash of Fredbear's face, red office, whispers | idea |
| 14 | Phone calls fall apart on nights 5-6 (static, last call cut off by the music box) | idea |
| 15 | More sounds that build through the night (kids laughing, footsteps upstairs, crawling in vents, faint music box) | idea |
| 16 | Something follows you during maintenance (Fredbear's echo in the basement) | idea |
| 17 | Memory scenes after each night: a walkable 1983 diner with story lines | idea |
| 18 | Two endings: survive = bad ending, all secrets = true ending in Fredbear's chamber | idea |
| 19 | Custom Night (night 7): set each animatronic 0-20 | idea |
| 20 | Hard mode after beating night 6, with a star on the time clock | idea |

### Models (details in section F)

| # | Item | Status |
|---|---|---|
| 21 | Replace Fredbear's model with the owner's "Fredbear V6 (no eye dots)" model and use all 12 of its animations; keep the old model's files outside the game; same size as now (owner's choice) | planned |

### More ideas (round 2, not chosen yet)

| # | Item | Status |
|---|---|---|
| 22 | Game-over hints: the death screen says who got you and one tip to stop them | idea |
| 23 | Night report: power left, closest call, strobes used; a star for a clean night | idea |
| 24 | Audio lure (FNAF 3 style): play a sound on a camera to pull an animatronic away from your door; costs power and can fail | idea |
| 25 | Rare easter egg: Fredbear's empty suit slumped in your office (1 in 500 nights); stare too long and the night "crashes" back to the lobby | idea |
| 26 | Thunderstorm on nights 5-6: lightning flashes through the windows show shapes in the halls; thunder covers footsteps | idea |
| 27 | Cassette tapes hidden in Free Roam that tell the story (the owner could supply voice recordings) | idea |
| 28 | Freddy's nose on the office poster honks when you press it (classic FNAF 1 easter egg) | idea |
| 29 | Camera night-vision switch: clearer feed but more power drain, and Fredbear notices you more | idea |
| 30 | Props that move: knocked-over chairs, dropped party hats and drag marks on camera show where they have been | idea |
| 31 | Two-player co-op: one player on the cameras, one on the doors (big job) | idea |

### More ideas (round 3, not chosen yet)

| # | Item | Status |
|---|---|---|
| 32 | Night 7 "Fredbear's Revenge": a bonus story night after the true ending, just you and Fredbear with every power | idea |
| 33 | Phantoms (FNAF 3 style): burnt-looking animatronics flash in the office window on nights 5-6; keep looking and they knock out your cameras or power for a moment | idea |
| 34 | Freddy mask (FNAF 2 style): put it on when Bonnie or Chica reach the office to fool them; Fredbear is never fooled | idea |
| 35 | A music box to wind through a camera (FNAF 2 style); let it run down and Fredbear wakes early and angrier | idea |
| 36 | Generator heat gauge: it heats up through the night; vent it from the office (costs power) or it shuts down at a bad moment | idea |
| 37 | Hiding spots (lockers, under desks) in the basement to hide from whatever follows you during maintenance (goes with 16) | idea |
| 38 | Night length setting: short 5-minute, normal 8-minute or long 12-minute nights | idea |
| 39 | Camera snapshots: photograph strange things on camera (echoes, the empty suit) to fill a photo album at the time clock | idea |
| 40 | A cupcake that moves between cameras on its own (like Chica's Carl), as a small extra threat or easter egg | idea |
| 41 | Record wall in the lobby: best power left and cleanest run for each night | idea |

### Every update finishes with

* credits (README, docs, in-game), Shift Guide text, the night 4 phone call ("three charges") when item 8 is built;
* all checks, a new `.mcaddon` (next version 1.2.0), push and send.

## A. Sounds

The original files are saved untouched in `art/sounds_incoming/`. `tools/gen_sounds.py` converts them
(`RECORDINGS`, `RECORDED_IDS`).

| Clip | Length | Used for | Sound id |
|---|---|---|---|
| `Jumpscare_animatronics.mp3` | 2.8 s | Freddy, Bonnie and Chica jumpscares | `fb.js.freddy`, `fb.js.bonnie`, `fb.js.chica` |
| `fredbearboi.mp3` | 3.3 s | Fredbear's jumpscare | `fb.js.fredbear` |
| `161190__volivieri__storm-door-slam-01.wav` | 4.9 s, cut to 2.4 s | closing the doors and the hatch | `fb.door.close` |
| `75826__analog-bleep-ten__metal-door.wav` | 1.25 s | opening the doors and the hatch | `fb.door.open` |
| `740223__fossarts__cctv-camera-system-in-op-2.wav` | 10.5 s loop cut from 19.3 s | hum while the monitor is up (restarted every 10 s, stopped when it is lowered) | `fb.cam.hum` (new) |
| `camera_open.mp3` | 1.75 s | raising the camera monitor | `fb.cam.up` |
| `camera_close.mp3` | 1.75 s | lowering the camera monitor (the same recording as `camera_open.mp3`) | `fb.cam.down` |
| `Fnaf_Freddy_Laugh.mp3` | 21 s, split into 4 laughs | Freddy's laugh (random variant) | `fb.freddy.laugh` |
| `Fredbear_laugh_Fnaf_4.mp3` | 19.7 s, split into 4 laughs | Fredbear's laugh (not hooked up yet, item 6) | `fb.fredbear.laugh` (new) |

Still to check in-game: that the hum is audible on every camera, and the loudness of each clip.

Licences and credits (checked on freesound.org 2026-10-09):
* 740223 by FOSSarts: CC0 (no credit required).
* 161190 by volivieri: CC BY 4.0 (credit required).
* 75826 by Analog Bleep Ten: Sampling+ 1.0 (credit required; non-commercial sharing only).
* The jumpscare, camera and laugh `.mp3` files came from the owner with no source given. If they come from the FNAF games,
  they belong to Scott Cawthon.
* The in-game credits (`scripts/mc/ui.js`) are updated. The README and docs/07 still say every sound is synthesised.

## B. Too few strobe charges

* Current (`scripts/core/config.js`, `nights.*.strobeCharges`): night 4: 3, night 5: 3, night 6: 4, plus 2 at 5 AM
  (`finale.extraCharges`). A completed pre-shift task gives +1.
* Fredbear's attempts per night (`maxAttempts`): night 4: 2, night 5: 3, night 6: 4, plus 2 in the finale. On nights 5 and 6
  there is no spare charge, so a single stun or misfire means one attempt cannot be repelled.
* The back-wall charge lamps only show 0-4 (`pwr.charges_4` = "4+"); the action bar shows the exact count.

## C. Fredbear always breaks down the doors and hatch

* Current behaviour (`scripts/core/ai/fredbear.js`): a closed door or hatch on its own never stops him. At the end of the
  music-box telegraph a closed barrier is forced (W2), then jammed open (W3). The only way to send him away is the strobe while
  the barrier is closed or jammed. With no charges left, every attempt ends with the barrier broken.
* Planned rule (item 9):
  * when the forcing window ends and that door or hatch has not held yet tonight, it holds;
  * he gives up, which counts as one of his attempts;
  * the indicator is reset by re-closing that barrier, and the Shift Guide explains the rule.

## D. Creepy ideas

Suggested by Claude, not chosen yet. The suggested first picks were 16, 11 and 12, 10, and 19 (easy).

## E. Background music

* Source: `art/sounds_incoming/PIZZA_DINNER_-_FNAF_1_REMAKE_OST.mp3`, 3:00, 320 kbit/s stereo. It is from a fan game's
  soundtrack (FNAF 1 Remake), so its composer owns it; credit it in-game. Fine for the owner's own map; ask before sharing it
  publicly.
* Plan:
  * add it as a `music`-category sound (`fb.night.bgm`, stereo OGG) and start it at 12 AM with
    `Player.playMusic(id, { loop: true, fade })` (stable `@minecraft/server` 2.10.0);
  * playing a track this way replaces Minecraft's own music while it runs, and leaves all other sounds alone;
  * stop it with `stopMusic()` at 6 AM, on a jumpscare / game over, at power out, and when leaving the night.
* Option: a "Music: ON / OFF" button in the Shift Guide menu, saved with the other settings (default ON).
* It plays at the player's in-game Music volume slider.
* Still to check in-game: the loop seam (the track is 3:00), and that vanilla music does not come back while it is playing.

## F. Fredbear V6 model (item 21)

Source: `art/models_incoming/Fredbear_V6_NoEyeDots_Complete.zip` (saved untouched, SHA-256 679d74e5...). Its README says it
was never tried in Blockbench or Minecraft.

What is in it:
* `geometry.fredbear`: 43 bones and 730 cubes (the current Fredbear has about 40), with fingers, a jaw, ears, a hat, a bow
  tie and a microphone in the right hand.
* Its own 256×256 texture: Fredbear will look like this texture, not like the `1.png` skin.
* 12 animations (baked keyframes, 6 MB of JSON):
  * loops: idle, walk, run, perform_sing, perform_greet, perform_mic_sway, perform_crowd_point;
  * poses: pose_showman (holds), pose_bow;
  * jumpscares: jumpscare_snap_bite, jumpscare_dual_lunge, jumpscare_left_grab.

Plan:
* The game's animation states map to the new clips:

  | Game state | New clip |
  |---|---|
  | idle, pause, look | idle |
  | walk, stalk (slowed) | walk |
  | retreat | run |
  | lobby / free-roam stage show (`perform`, `music`) | the four performances in rotation |
  | music box at a door or the hatch (`threat`) | perform_crowd_point (pointing at you) |
  | night 6 Golden Hour rise | pose_showman |
  | giving up at a held door or hatch (item 9) | pose_bow |
  | every jumpscare | one of the three, picked at random |
  | dormant | the bow pose frozen |
* Missing pieces to make for the new rig: a crawl / climb pose (he crawls through the basement crawlspace and up the hatch),
  and the glowing-eyes layer (a new eye mask for the dark eye lenses on the 256×256 texture).
* The purple ECHO (false Fredbear on cameras) uses the new model too, with its texture made from the new one.
* Size: **same size as now** (owner's choice). The new model is 50 units (3.1 blocks) tall at scale 1, and the current
  Fredbear is 37.5 units × 1.45 = 54.4 units (3.4 blocks) with the hat. That means scale 1.09 for Fredbear and the ECHO
  (`minecraft:scale`, `SCALE` in game.js, collision box). His hat may clip through the 3-block doorways, as it can today.
* Keep the old model: move the current `fb_fredbear.geo.json` and its textures to `art/models_archive/fredbear_v1/`, outside
  the packs, so they are not in the game.
* Shrink the animation JSON (round values, drop repeated keys) so the pack stays small, and check it still matches the
  original.
* The animations have never been tested in Minecraft, by the author or here. The preview video in the zip is an offline
  render.

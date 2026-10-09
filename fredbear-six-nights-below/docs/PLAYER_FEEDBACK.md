# Owner's to-do list

Requests from the map owner after their in-game playthrough (campaign completed through night 6). Work only starts when
the owner says go.

Status: **done (untested)** = in WIP commit `cb939b3`, not yet validated, packaged or tried in-game. **planned** = agreed,
not started. **idea** = suggested, not chosen yet.

## The list

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

### Finishing an update

| # | Item | Status |
|---|---|---|
| 21 | Credits (README, docs), Shift Guide text, night 4 phone call ("three charges") | planned |
| 22 | All checks, new `.mcaddon` (version 1.2.0), push and send | planned |

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

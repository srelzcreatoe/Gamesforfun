# Player feedback (open)

Notes from the map owner's in-game playthrough (campaign completed through night 6). Saved for later; nothing has been
changed for these yet.

## 1. Too few strobe charges

The strobe felt risky because there are too few charges.

* Current (`scripts/core/config.js`, `nights.*.strobeCharges`): night 4: 3, night 5: 3, night 6: 4, plus 2 at 5 AM
  (`finale.extraCharges`). A completed pre-shift task gives +1.
* Fredbear's attempts per night (`maxAttempts`): night 4: 2, night 5: 3, night 6: 4, plus 2 in the finale. On nights 5 and 6
  there is no spare charge, so a single stun or misfire means one attempt cannot be repelled.
* Idea when this is picked up: +1 to +2 charges on nights 4-6. The back-wall charge lamps only show 0-4 (`pwr.charges_4` =
  "4+"), so the lamps may need more steps if charges go above 4.

## 2. Fredbear always breaks down the doors and hatch

* Current behaviour (`scripts/core/ai/fredbear.js`): a closed door or hatch on its own never stops him. At the end of the
  music-box telegraph a closed barrier is forced (W2), then jammed open (W3). The only way to send him away is the strobe while
  the barrier is closed or jammed. With no charges left, every attempt ends with the barrier broken.
* This is how it was designed, but in play it reads as "he always breaks through". Options to weigh later: let a closed
  barrier sometimes hold him off, give longer forcing windows, make the "use the STROBE" moment clearer, or rely on fix 1
  (more charges) alone.

## 3. Replace sounds with the owner's clips (requested, not started)

The original files are saved untouched in `art/sounds_incoming/`.

| Clip | Length | Use it for | Replaces |
|---|---|---|---|
| `Jumpscare_animatronics.mp3` | 2.8 s | Freddy, Bonnie and Chica jumpscares | `fb.js.freddy`, `fb.js.bonnie`, `fb.js.chica` |
| `fredbearboi.mp3` | 3.3 s | Fredbear's jumpscare | `fb.js.fredbear` |
| `161190__volivieri__storm-door-slam-01.wav` | 4.9 s (slam, long tail) | doors and hatch (open / close) | `fb.door.close` / `fb.door.open` (doors and hatch both use these) |
| `75826__analog-bleep-ten__metal-door.wav` | 1.25 s | doors and hatch (open / close) | as above |
| `740223__fossarts__cctv-camera-system-in-op-2.wav` | 19.3 s steady hum | the "lil noise" while you are on the cameras: loop while the monitor is up, stop when it is lowered | new sound |
| `camera_open.mp3` | 1.75 s | raising the camera monitor | `fb.cam.up` |
| `camera_close.mp3` | 1.75 s | lowering the camera monitor | `fb.cam.down` |

To confirm with the owner before building:
* Which door clip goes where. Suggested: storm-door slam for closing, metal door for opening (same for the hatch).

Implementation notes:
* Bedrock reads `.ogg` (and `.wav`), not `.mp3`: convert everything to mono OGG Vorbis and trim the door slam's tail.
* The CCTV hum is quiet (about −38 dBFS RMS) and 96 kHz float stereo (14.8 MB). It needs gain, downsampling and a
  seamless crossfaded loop (about 8-10 s).
* Check in-game where a sound is heard while the camera view is active (player position vs. camera position), so the hum
  is audible on every camera.
* `tools/gen_sounds.py` synthesises every sound today. It needs a step that converts these clips for the ids above instead.
* Licences and credits (checked on freesound.org 2026-10-09):
  * 740223 by FOSSarts: CC0 (no credit required).
  * 161190 by volivieri: CC BY 4.0 (credit required).
  * 75826 by Analog Bleep Ten: Sampling+ 1.0 (credit required; non-commercial sharing only).
  * The two `.mp3` jumpscares and the two camera `.mp3` clips came from the owner with no source given. If they come from
    the FNAF games, they belong to Scott Cawthon.
  * The README's "all sounds were synthesised" credit must be updated.

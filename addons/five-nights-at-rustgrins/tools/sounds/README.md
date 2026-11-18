# Sounds: how they are made

Every sound in `packs/RP/sounds/fnar/` is synthesised from scratch by the
scripts in this folder, except three recordings supplied by the map owner in
`assets/audio/` (the background music and the two jumpscare screams), which are
copied into the pack as they are. No other samples or borrowed music are used.
All synthesised melodies are original and written out as note lists in
`recipes_music.py`.
The spec is `docs/SOUNDS.md`.

```
python3 tools/sounds/gen_sounds.py              # rebuild everything (~1 min, deterministic)
python3 tools/sounds/gen_sounds.py 'js.*' amb.fan   # rebuild some events only
python3 tools/sounds/gen_sounds.py --list       # event table
python3 tools/sounds/check_sounds.py            # measurements + rule checks (exit 1 on errors)
python3 tools/sounds/check_sounds.py --spectro  # + spectrogram PNGs in tools/sounds/_check/
node tools/validate_json.mjs packs/RP/sounds    # schema check of sound_definitions.json
```

You need python3, numpy, scipy and ffmpeg built with libvorbis. `soundfile` (exact
Vorbis decoding) and Pillow (spectrograms) are optional extras for the checker.

| file | role |
|---|---|
| `gen_sounds.py` | event registry (one row per event: duration, variants, mono/stereo, loop, category, distances, level), mastering, encoding, `sound_definitions.json`, `sound_manifest.json` |
| `fnar_dsp.py` | DSP toolkit: filters (Butterworth, RBJ biquads, a click-free time-varying biquad), oscillators (polyBLEP, oversampled), noise, modal resonators, Karplus–Strong, formant voice, servo whine, synthetic room IRs + convolution, saturation, wow/flutter, limiter |
| `recipes_common.py` | shared "materials": room impulse responses and mode sets (steel door, shutter slats, vent hatch, duct, tile, plastic, animatronic frame), bells, creaks, drips, phone-line filter |
| `recipes_office.py` | ambience, doors/lights/buttons/vents, cameras, power, clock, phone, hallucinations, UI |
| `recipes_anim.py` | footsteps, servos, Mirehop / Noxbriar / Rustgrin / Cat / Purple Rat / Ringmaster sounds |
| `recipes_final.py` | the Final Act: PA chime, applause, spotlight |
| `recipes_night.py` | the night shift: the drone and heartbeat beds, breathing, children's voices, the far music box, building noises, knocks, the radio, stingers, the midnight cue |
| `recipes_day.py` | the pizzeria by day: the guests' murmur, their clapping and cheering, the bell over the front doors |
| `recipes_music.py` | instruments and the compositions (music box, calliope, 80s band) |
| `check_sounds.py` | self-check: duration, channels, peak, RMS, DC, edges, loop seams, size, spectrograms |
| `sound_manifest.json` | generated: exact durations, channels, loop flags, max distance, peaks, pre-fade seam metrics |

## Pipeline (every file)

1. A recipe `fn(variant, rng, n)` renders float64 audio. Seeds come from
   `crc32(event key, variant)`, so a re-run is bit-identical, including the
   `.ogg` files: ffmpeg runs with `-fflags +bitexact`.
2. A DC block (18 Hz high-pass) runs, then the level is set by peak, RMS, or an
   approximate K-weighted loudness ("LUFS").
3. A look-ahead brick-wall limiter with a -1.5 dBFS ceiling runs, then the edge
   fades: 5 ms in and 20 ms out by default (longer for ringing tails). Loops get
   5 ms fades at both ends.
4. The audio is written as a 32-bit float WAV and encoded with
   `ffmpeg -c:a libvorbis -q:a 4` at 44.1 kHz. The Ogg is then **decoded and
   measured**. If lossy ringing pushes it over -1 dBFS, the gain is trimmed and it
   is re-encoded.

Positional events (those with `min_distance`/`max_distance`) are rendered mono,
and the pipeline refuses stereo for them.

### Loops

Loops are built **circularly**, which amounts to crossfading the tail into the head:

* Noise beds are FFT-shaped noise of exactly the loop length, so they are periodic.
* LFOs, hums and drones use frequencies with an integer number of cycles per loop.
* Events (creaks, drips, notes, drum hits) are placed with wrap-around, so a tail
  that runs past the end continues at the start.
* Filters, reverbs and tape wow run over two periods and the second one is kept.

`gen_sounds.py` measures each loop's continuity across the wrap point *before*
the edge fades. It records the step relative to the median sample-to-sample
change and the HF energy around the seam, and stores both in the manifest.
`check_sounds.py` fails a loop whose seam is a click or a level jump. Script
restarts are tick-quantised, so the 5 ms edge fades make the restart click-free
whether the next copy starts slightly late or slightly early.

## Families

**Ambience.**
* `amb.office`: magnetic-ballast buzz. It is a 120 Hz harmonic stack with a
  tiny periodic wobble, plus asymmetric clipping for the "zzz" and noise rasp
  bursts locked to the mains peaks. A distant HVAC (blower tone, rumble, duct air)
  sits underneath.
* `amb.fan`: air noise modulated at the blade-pass rate (3 blades × an integer
  number of revolutions per loop), blade tones, motor hum and a grille rattle that
  comes and goes.
* `amb.duct`: noise through duct standing-wave resonances, with gusts and a whistle.
* `amb.light_buzz`: hard-clipped 60/120 Hz with sizzle and two flicker stutters.
* `amb.building`: a stereo bed. Beating low sines and rumble form the drone, with
  stick-slip creaks (wood and duct mode sets), a far-off water drop (rising chirp)
  and cooling-metal ticks, all through a 2.3 s synthetic hall.

**Metal impacts: doors, vents, bangs, steps.** These use modal synthesis: a
half-sine contact pulse excites a resonator bank (one 2-pole resonator per mode).
* The steel shutter has 72 plate-like inharmonic modes plus four low body
  modes, and longer decay for the low modes. A shorter contact time gives a
  brighter hit.
* `door.close` adds an accelerating slat rattle and rail scrape during the drop,
  a bright crash, a falling-pitch body thud, bounces and settling rattle, then the
  office room IR.
* `door.open` adds a motor (low saw), a gear whine (FM) and a chain rattle that
  follows a speed curve, ending in a clank.
* The vent hatch uses a thinner, brighter mode set, plus a hatch-in-frame buzz
  and a duct IR.
* The Cat's `cat.bang` excites the same door modes with softer fist contacts.
  Because mode sets are seeded by name, every sound of one object shares its
  modes.

**Switches, buttons, phone handset.** Very short contact pulses through plastic
and small-metal mode sets, plus a low "thock". `light.on` adds the ballast thunk
and a decaying 120 Hz onset.

**Cameras.**
* Whooshes are band-passed noise with a swept centre.
* The CRT power-on is a low thump, a 60 Hz degauss buzz, hiss and the
  15.734 kHz line whine. Power-off is a falling "zip".
* Static is shaped noise plus vertical-sync buzz, crackle and hum.
* `cam.glitch` is a random sequence of 8–60 ms fragments: bit-crushed static,
  square tones, buzz, sweeps and stutter repeats over a torn-signal bed.

**Power out.** A relay clunk, then a 120 Hz harmonic stack, fan and motor
rumble whose frequencies spin down exponentially, a last cooling tick, then
silence.

**Bells (clock, UI, 6 AM).** Additive bells whose partials are split
pairs, so they beat like real bells. There are two families:
* a soft minor-third "church" profile for the hourly chime;
* a bright bar profile (1 : 2.76 : 5.4 …) with an FM shimmer on the attack for
  the 6 AM chimes, the star arpeggio and the music-box sparkle.

The 6 AM sound is five rising chimes, then a C-major chord from a detuned-saw
pad and drawbar organ, with an opening filter and bells on top.

**Phone.**
* `phone.ring`: a clapper striking two steel gongs alternately at 40 Hz (each gong
  20 Hz), shaped as two 0.8 s bursts.
* `phone.voice`: *babble*. Random syllables are planned with consonant/vowel
  targets. A saw glottal source with a declining, stressed pitch contour goes
  through moving formant filters, plus fricative and plosive noise bursts, then a
  300–3400 Hz carbon-mic line filter. It is speech-like but has no words.
* `phone.hangup` ends with a 350 + 440 Hz dial-tone tail.

**Footsteps and servos.**
* Heavy steps: a falling-pitch thud, a tile click, a metal-foot ring, then a
  late servo clink with a short whine, in the corridor IR, which has flutter echo.
* Light steps (the Cat) use heel/toe taps. Scurry is 8–14 tiny claw taps.
* Servos are FM whines (carrier tracks a speed profile, plus a gear-tooth noise
  train), stick-slip joint groans and stop clunks.

**Mirehop.** Each strum is six Karplus–Strong strings with a fractional-delay
loop, pick-position comb and per-string detune of up to ±28 cents, strummed
16 ms apart. The chain is oversampled overdrive, a 4.8 kHz cabinet low-pass and
spring-like room. The three variants are E minor, E with a flat fifth, and a
sour F minor.

**Noxbriar.** The hum is a formant voice:
* an oversampled saw source, tilted soft, through moving formants;
* mostly "m", opening to "u"/"o" on long notes;
* two original melody lines with portamento and delayed vibrato;
* a second voice 7 cents sharp and 23 ms late;
* tape wow/flutter and a worn-speaker band-pass.

**Rustgrin.**
* `rustgrin.feedback` is a tone that grows exponentially, hops to a second room
  mode and gains harmonics as it saturates. Mains hum runs underneath, and it
  ends in a hard cut with a speaker pop.
* `rustgrin.laugh` is a huge-tract "uh" formant voice with subharmonics (growl)
  and a falling pitch. Breathy "h" onsets give "huh-huh-huh". A 31 Hz ring
  modulation and bit-crush make it mechanical, followed by distortion and a box
  speaker.

**Music box: Rustgrin's Theme.** Each comb tine is the clamped-bar mode series
1 : 6.27 : 17.55 plus a weak 2nd harmonic, a glockenspiel-like FM shimmer on the
attack and a pin click. Every tine has a fixed detune.
* `rustgrin.song` is the original 16-bar A-minor waltz with oom-pah-pah
  accompaniment. The governor fan whirs and ticks, the tempo wobbles like a
  spring and slows to a stop at the end, and lever clicks mark the start and stop.
* The title theme plays it at 72 bpm on a heavily detuned box with a ghost canon
  an octave down, reversed tines swelling into bars 1 and 9, a dark saw pad
  following the chords, and an A drone, all in a 3.2 s stereo hall.
* The ending replays the opening, then turns to A major (D – E – A) with a warm
  pad and bells.

**Ringmaster.**
* The calliope pipe is a bright harmonic stack. It has an onset pitch scoop,
  steam-pressure wobble, breath noise locked to the tone, a chiff and a fixed
  per-pipe detune.
* `tophat.show` is the original 16-bar C-major circus waltz. It has a melody,
  thirds in the second half, oom-pah-pah pipes, a bass drum and glockenspiel
  doubling, plus light tape wow.
* `tophat.show_slow` replays that tape at 70 % speed with deep wow, saturation and
  dull highs. `tophat.rewind` reads the same tape backwards at 2→15× under a
  rising motor whine. `tophat.tape_out` slows it to a stop, then slaps the loose
  tape end at a decaying reel rate.
* The cane is three ferrule clicks with wood resonance in the corridor IR. The
  laugh is a small-tract "ha-ha" through a tinny horn speaker.

**The Cat and Purple Rat.**
* The collar bell is three small bells with inharmonic modes, each shake a
  burst of ball micro-hits. `cat.run` is accelerating light steps that get louder
  and brighter and less reverberant, with jingles.
* `cat.growl` is a 24 Hz purr-modulated subharmonic voice with a servo.
* Maracas are dense bead micro-impulses, band-passed to 3–11 kHz and getting
  denser toward the "chk", in 16th-note patterns with jitter, in the duct IR.
* `rat.squeak` is a stick-slip pulse wave. `rat.crawl` is oil-can thumps
  (gliding pitch), plus scrapes through the duct mode set.

**Jumpscares and the background music** are the map owner's own recordings
in `assets/audio/` (`Rec(...)` rows in `gen_sounds.py`): they are copied into the
pack as they are, or only trimmed in gain and re-encoded at a higher quality when
they peak above -1 dBFS. `js/animatronic.ogg` serves all six regular animatronics,
`js/rusted.ogg` the Rusted one, and `music/bgm.ogg` loops during shifts.

**The Final Act** (`recipes_final.py`).
* `final.chime` is a three-note glockenspiel chime (C6, A5, E6) through a band-limited,
  slightly overdriven ceiling speaker with a faint mains buzz and hiss.
* `final.applause` is a few hundred short band-passed noise claps, panned across the
  stereo field under a swelling and dying envelope, in a room IR.
* `final.spot` is a relay clunk, an arc of bright noise flickering at 33 Hz and a
  hot 100/200 Hz hum.

**The night shift** (`recipes_night.py`). Three new rooms: `night_far` (3.6 s,
dark, late reflections: the empty halls), `night_cellar` (a small hard wet room)
and `night_backroom`. Two new materials: `beam_modes` (two long I-beams, free-free
bending modes 1 : 2.76 : 5.40 : 8.93 …, slightly apart so they beat, plus the deck
plate) and `pipe_modes` (a loose steel pipe).
* `night.drone` (12 s loop, 240 ticks) is three beating pairs of sines a tritone
  apart (~36.7 / 51.9 / 73.4 Hz, given as cycles per loop, so each is exactly
  periodic). The beat rates differ left and right (2–3 beats per loop), so the
  throb wanders across the stereo field. Gentle tanh adds intermodulation. On top:
  a low-passed saw on the bottom tone (harmonics that small speakers can play),
  sub rumble, and air through a slowly sweeping band-pass. The shimmer is eight
  inharmonic partials between 1.9 and 6.4 kHz, each a beating pair with a slow phase
  wander, swelling in and out once or twice per loop and panning, in the far hall.
  It is set by RMS (-31 dBFS). Its A-weighted level is about 7 dB under `amb.building`,
  and the shimmer sits about 12 dB under the drone.
* `night.heartbeat` (2 s loop, 40 ticks) is two lub-dubs placed with wrap-around.
  Each is a soft-edged thump whose pitch falls (lub 64→34 Hz, dub 88→46 Hz,
  0.29 s apart), with a knock an octave up, low noise and a blood rush, then
  saturation, a 380 Hz low-pass and a 90 Hz body resonance ("inside the head").
  The beats sit at 0.28 s and 1.285 s, so the wrap point falls in the quiet.
* `night.breath`: noise through a moving formant track (an open "a/ae" for the
  inhale, which has catches and ragged amplitude; "o/u" for the exhale). The rattle
  is irregular glottal-fry pulses through the same mouth plus a buzzing grille.
  Between the breaths a valve ticks and a small servo hisses. All of it goes
  through a peaky, slightly crushed speaker and the corridor IR.
* `night.musicbox_far` plays two phrases of Rustgrin's Theme (bars 1–4, bars 13–15)
  on the same comb tines, ±34 cents out of tune. The tempo slows (128→58 bpm),
  one or two notes barely sound, and the pitch sags as the spring runs down. It is
  high-passed, darkened and played almost entirely from the far hall, with a late
  echo off the far wall.
* `night.kids` are child voices: the phone babble with a child's pitch (275–335 Hz),
  formants scaled ×1.4–1.5 and big intonation swings, plus laughs. A laugh is
  "ha"/"hee" syllables at about 5 per second, with aspirated onsets, a pitch hop
  on each syllable, a falling line, and sometimes a squeaky in-breath. They are
  "remembered": played back at 66–86 % speed, warbling, read by three detuned heads
  and put in the dining-hall IR. The reverb is kept low enough that the "ha-ha"
  rhythm survives (about 2/3 of its modulation). One laugh plays backwards (v1),
  all of it backwards (v2), or a reverse reverb makes a group laugh's echo arrive
  first (v3).
* `night.giggle` is one "hee-hee" laugh with a nasal in-breath and lip click, close
  and dry. v1 wobbles like chewed tape; v2 slows down into a deep chuckle.
* `night.scrape` is stick-slip chatter whose rate follows the drag speed (pulls
  with jerks), through the object (pipe or frame modes) and the tile, with a
  speed-following grit band and a thin squeal at the fastest moments, deep in
  the corridor.
* `night.knock`: three 5–6 ms fist contacts into the office door's modes,
  low-passed, with deep body thuds, steel-finger ticks and slat rattle; the third
  knock comes late.
* `night.door_rattle`: rattle bursts through the slat and door modes, the panel
  flexing, a rail scrape as the slats lift, and a clunk as they drop.
* `night.radio` models a tuning dial: two stations (the Midway waltz from the
  calliope tape, slowed and wobbling, and a talk station of babble). Static
  ducks as a station comes in, and heterodyne whistles slide down to zero beat.
  It goes through a small 4th-order band-passed, saturated speaker, then the
  back-room IR and a 2.3 kHz wall.
* `night.drip` is the bubble chirp, impact tick and splash in the cellar IR.
* `night.groan`: slow stick-slip pulses (13→52→13 Hz; v2 rising to 66 Hz and
  letting go with a bang) through broad body resonances, so the slip rate is the
  groan's pitch. The beams' damped modes add the metal ring, and the far IR follows.
* `night.twitch`: a servo whip (full speed almost at once, braking into a hard
  stop), the drive chattering on and off before it catches, a skipping-buffer
  stutter (v1), a control-board buzz, and the neck snap with an overshoot bounce.
* `night.stinger`: the hit's own bells and noise, reverberated and reversed, swell
  into a 92→27 Hz sub hit. On top are a seven-note cluster of long bells (minor
  seconds and tritones), a saw stab whose filter snaps shut, and the door's clang.
  It ends with the bells ringing and a thin beating tone (ears ringing), in the
  big hall. Peak -3 dBFS, RMS about -21 dBFS: well under the jumpscares.
* `night.midnight`: a tick-tock wall clock (two small-metal mode sets plus the
  wooden case) that slows a hair and stops; one D3 toll of the soft bell, far off
  in the far hall; five lub-dubs getting faster and louder; and a breath of static
  shaped by a mouth (noise through "uh→o→u" formants) with mains hum.

**The pizzeria by day** (`recipes_day.py`). The guests of Free Roam. The voices are
the same formant babble as the phone (speech-like, no words) and the child voices
of the night shift, here played straight and bright instead of slowed and far away.
* `day.crowd` (14 s loop, 280 ticks) is a room full of people: thirteen grown-ups,
  each talking in short turns about half the time (three near and clear, the rest
  duller and quieter, the way voices are across a room), five children chattering,
  four laughs and a "yay", forks and plates and glasses (small-metal mode hits), a
  chair pushed back, and a little room tone. Everything is placed with wrap-around
  and the dining-hall reverb runs circularly, so it loops without a seam. The
  script plays it from the middle of the room and sets the level by head count.
* `day.cheer`: every clapper has their own pace (3.4-4.6 claps a second), brightness
  and loudness; a clap is a short band of noise with a hollow thump under it. On top
  a "woo!" (one breath, the pitch sweeping up and tailing off) and a child's "yay!"
  (i -> e -> a), then the room.
* `day.door_chime`: two glockenspiel bars, E5 then C5, each with the tick of its
  little hammer, and the thud of the door closer.

**Hallucinations, UI, showtime.**
* `hall.whisper` is unvoiced formant noise with sibilants, convolved with a
  hall and reversed, so it swells in and sweeps right to left.
* `hall.sting` is an eight-note cluster of detuned saws: tremolo speeds up, the
  filter opens and the pitch creeps up into a hit (sub drop, door clang, crash).
* `ui.click` is a tiny tick.
* `music.showtime` ("Pizza Party Tonight", G major, 120 bpm, 24 bars) uses:
  * an 80s drum machine with gated-reverb snare, claps in the chorus and fills;
  * a Karplus–Strong octave bass;
  * a drawbar organ through a Leslie;
  * Mirehop's chord chops;
  * Noxbriar's "ooh" backing voices;
  * a pulse/saw lead with glide, slap-back and delayed vibrato.

  The mix gets bus compression and a worn-tape master: wow and flutter,
  saturation, an 11.5 kHz low-pass, head bump, hiss and two short dropouts.

## Events

Durations are exact; loops can be restarted every `duration` seconds (the
manifest gives them to 0.1 ms). Variant files are numbered `name1.ogg …
nameN.ogg`, and the definition lists them all, so Minecraft picks one at random.

| event | files | duration | channels | loop | category | max dist |
|---|---|---|---|---|---|---|
| `fnar.amb.office` | 1 | 10 s | mono | loop | ambient | 12 |
| `fnar.amb.fan` | 1 | 4 s | mono | loop | ambient | 8 |
| `fnar.amb.building` | 1 | 24 s | stereo | loop | ambient | - |
| `fnar.amb.duct` | 1 | 6 s | mono | loop | ambient | 12 |
| `fnar.amb.light_buzz` | 1 | 2 s | mono | loop | ambient | 12 |
| `fnar.door.close` | 1 | 1.2 s | mono |  | block | 16 |
| `fnar.door.open` | 1 | 1.4 s | mono |  | block | 16 |
| `fnar.door.error` | 1 | 0.5 s | mono |  | block | 12 |
| `fnar.light.on` | 1 | 0.3 s | mono |  | block | 10 |
| `fnar.light.off` | 1 | 0.2 s | mono |  | block | 10 |
| `fnar.button.press` | 2 | 0.15 s | mono |  | block | 8 |
| `fnar.vent.close` | 1 | 0.9 s | mono |  | block | 16 |
| `fnar.vent.open` | 1 | 0.7 s | mono |  | block | 16 |
| `fnar.cam.up` | 1 | 0.5 s | stereo |  | ui | - |
| `fnar.cam.down` | 1 | 0.4 s | stereo |  | ui | - |
| `fnar.cam.switch` | 3 | 0.3 s | stereo |  | ui | - |
| `fnar.cam.static` | 1 | 1.5 s | stereo |  | ui | - |
| `fnar.cam.hum` | 1 | 10 s | stereo | loop | ui | - |
| `fnar.cam.glitch` | 1 | 0.6 s | stereo |  | ui | - |
| `fnar.power.out` | 1 | 3 s | stereo |  | block | - |
| `fnar.clock.chime` | 1 | 1.5 s | stereo |  | ui | - |
| `fnar.clock.6am` | 1 | 6 s | stereo |  | ui | - |
| `fnar.phone.ring` | 1 | 4 s | mono |  | block | 16 |
| `fnar.phone.pickup` | 1 | 0.4 s | mono |  | block | 12 |
| `fnar.phone.voice` | 4 | 2 s | mono |  | block | 16 |
| `fnar.phone.hangup` | 1 | 0.5 s | mono |  | block | 12 |
| `fnar.step.heavy` | 4 | 0.35 s | mono |  | hostile | 24 |
| `fnar.step.light` | 4 | 0.25 s | mono |  | hostile | 24 |
| `fnar.step.scurry` | 3 | 0.6 s | mono |  | hostile | 20 |
| `fnar.servo.move` | 3 | 0.8 s | mono |  | hostile | 16 |
| `fnar.servo.head` | 2 | 0.4 s | mono |  | hostile | 12 |
| `fnar.mirehop.strum` | 3 | 2 s | mono |  | hostile | 24 |
| `fnar.noxbriar.hum` | 2 | 5 s | mono |  | hostile | 16 |
| `fnar.rustgrin.feedback` | 2 | 1.5 s | mono |  | hostile | 32 |
| `fnar.rustgrin.laugh` | 2 | 1.6 s | mono |  | hostile | 20 |
| `fnar.rustgrin.song` | 1 | 20 s | mono |  | hostile | 24 |
| `fnar.cat.bell` | 2 | 1 s | mono |  | hostile | 24 |
| `fnar.cat.run` | 1 | 2 s | mono |  | hostile | 32 |
| `fnar.cat.bang` | 3 | 1.5 s | mono |  | hostile | 24 |
| `fnar.cat.growl` | 1 | 1.2 s | mono |  | hostile | 12 |
| `fnar.rat.maracas` | 3 | 1.5 s | mono |  | hostile | 24 |
| `fnar.rat.squeak` | 2 | 0.4 s | mono |  | hostile | 12 |
| `fnar.rat.crawl` | 3 | 1 s | mono |  | hostile | 16 |
| `fnar.rat.bang` | 1 | 0.8 s | mono |  | hostile | 16 |
| `fnar.tophat.cane` | 1 | 1.2 s | mono |  | hostile | 24 |
| `fnar.tophat.fanfare` | 1 | 3 s | mono |  | hostile | 32 |
| `fnar.tophat.show` | 1 | 16 s | mono | loop | hostile | 24 |
| `fnar.tophat.show_slow` | 1 | 22.8571 s | mono | loop | hostile | 24 |
| `fnar.tophat.rewind` | 1 | 1 s | mono |  | hostile | 16 |
| `fnar.tophat.tape_out` | 1 | 2.5 s | mono |  | hostile | 16 |
| `fnar.tophat.laugh` | 1 | 2 s | mono |  | hostile | 24 |
| `fnar.js.rustgrin` `.mirehop` `.noxbriar` `.purple_rat` `.cat` `.top_hat_rat` | 1 (shared `js/animatronic`) | 2.785 s | stereo | recorded | hostile | - |
| `fnar.js.rusted` | 1 (`js/rusted`) | 3.2793 s | stereo | recorded | hostile | - |
| `fnar.final.chime` | 1 | 1.9 s | stereo |  | hostile | - |
| `fnar.final.applause` | 1 | 4.5 s | stereo |  | hostile | - |
| `fnar.final.spot` | 1 | 0.9 s | stereo |  | hostile | - |
| `fnar.night.drone` | 1 | 12 s | stereo | loop | ambient | - |
| `fnar.night.heartbeat` | 1 | 2 s | mono | loop | player | 12 |
| `fnar.night.breath` | 3 | 3 s | mono |  | hostile | 10 |
| `fnar.night.musicbox_far` | 2 | 8 s | mono |  | hostile | 48 |
| `fnar.night.kids` | 3 | 5 s | mono |  | hostile | 40 |
| `fnar.night.giggle` | 2 | 1.5 s | mono |  | hostile | 12 |
| `fnar.night.scrape` | 2 | 3 s | mono |  | hostile | 32 |
| `fnar.night.knock` | 2 | 2.5 s | mono |  | hostile | 16 |
| `fnar.night.door_rattle` | 2 | 2 s | mono |  | hostile | 16 |
| `fnar.night.radio` | 2 | 5 s | mono |  | block | 24 |
| `fnar.night.drip` | 3 | 1 s | mono |  | ambient | 12 |
| `fnar.night.groan` | 2 | 4 s | mono |  | ambient | 64 |
| `fnar.night.twitch` | 3 | 0.4 s | mono |  | hostile | 16 |
| `fnar.night.stinger` | 2 | 3 s | stereo |  | hostile | - |
| `fnar.night.midnight` | 1 | 6 s | stereo |  | ui | - |
| `fnar.day.crowd` | 1 | 14 s | mono | loop | neutral | 44 |
| `fnar.day.cheer` | 3 | 3.2 s | mono |  | neutral | 44 |
| `fnar.day.door_chime` | 1 | 1.8 s | mono |  | block | 30 |
| `fnar.hall.whisper` | 1 | 2 s | stereo |  | hostile | - |
| `fnar.hall.sting` | 1 | 1.5 s | stereo |  | hostile | - |
| `fnar.ui.click` | 1 | 0.1 s | stereo |  | ui | - |
| `fnar.ui.star` | 1 | 2 s | stereo |  | ui | - |
| `fnar.music.title` | 1 | 40 s | stereo | loop | music | - |
| `fnar.music.showtime` | 1 | 48 s | stereo | loop | music | - |
| `fnar.music.ending` | 1 | 12 s | stereo |  | music | - |
| `fnar.music.bgm` | 1 | 179.9975 s | stereo | recorded | music | - |

### Differences from docs/SOUNDS.md

* `fnar.tophat.show_slow` is **22.857 s** (16 s / 0.7), not 16 s. That is the
  whole Midway tune at 70 % speed, which keeps it a seamless loop of the same
  tape. Restart it every 22.857 s.
* Variant files are named `<name>1 … <name>N` (for example `step/heavy3.ogg`).
* Extra definition fields: `stream: true` on the music and the 20 s power-out
  song, and `load_on_low_memory: true` on the jumpscares. Non-positional events
  (stereo) have no `min_distance`/`max_distance`.
* Gameplay cues that happen to be music (`rustgrin.song`, `tophat.show*`,
  `tophat.fanfare`) use category `hostile`, not `music`, so a player who mutes
  music still hears them. Only the title, showtime and ending themes are `music`.

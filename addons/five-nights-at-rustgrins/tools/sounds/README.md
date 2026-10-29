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

**Jumpscares (stereo, about -9 to -11 dBFS RMS).** Each one stacks the same layers:
* an impact (clang, broadband crash, falling sub thud) landing 8 ms in;
* screaming formant voices with pitch chaos (random wander plus uneven fast
  vibrato), subharmonics and a downward pitch sweep;
* a resonant "metal screech" (narrow noise bands sliding down);
* a servo grind.

Everything then goes through 4× oversampled tanh and hard clipping with a
presence boost, followed by the limiter. The colours:

| event | colour |
|---|---|
| `js.rustgrin` | huge low roar, an overtone scream and a sub layer |
| `js.mirehop` | a guitar pinch-squeal, a pick scrape and a distorted tritone chord crash |
| `js.noxbriar` | a five-voice dissonant cluster through a comb filter and hall ("hollow choir") |
| `js.purple_rat` | a high squeal and a frantic 18 Hz maraca rattle |
| `js.cat` | a hiss bursting into a rising-falling yowl |
| `js.top_hat_rat` | a dissonant calliope blast whose speed and pitch collapse into the scream |

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

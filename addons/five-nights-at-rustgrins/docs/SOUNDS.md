# Sounds — specification

All audio is **original and synthesised** for this project (numpy/scipy-style
DSP in Python → WAV → Ogg Vorbis with ffmpeg `-c:a libvorbis -q:a 4`, 44.1 kHz).
No samples from FNAF or anywhere else.

* Files: `packs/RP/sounds/fnar/<group>/<name>.ogg`.
* Definitions: `packs/RP/sounds/sound_definitions.json`
  (`"format_version": "1.20.20"`, `"sound_definitions": { "fnar.<group>.<name>": {...} }`).
  Every event lists its file(s) as `"sounds/fnar/<group>/<name>"` (no
  extension); several variants per event where noted (Minecraft picks one at
  random). Set `"category"` (`ambient`, `block`, `hostile`, `ui`, `music`) and,
  for positional sounds, `"min_distance"`/`"max_distance"`.
* **Positional sounds must be mono** (stereo is not spatialised). Music and UI
  stingers may be stereo.
* Peak ≤ −1 dBFS, no clicks at start/end (5–20 ms fades), loops must loop
  seamlessly (crossfade the tail into the head). Keep the whole sound folder
  under ~8 MB.
* Write a short `tools/sounds/README.md` (how each family is made) and keep the
  generator (`tools/sounds/gen_sounds.py`) deterministic (fixed seeds) so it
  can be re-run.

## Event list

Durations are guides. "loop" = seamless loop; the script restarts it.

**Ambience / office**
| event | mono | dur | description |
|---|---|---|---|
| `fnar.amb.office` | yes | 10 s loop | fluorescent buzz (120 Hz + harmonics, slight wobble) + distant HVAC rumble |
| `fnar.amb.fan` | yes | 4 s loop | desk fan whir with a faint rattle |
| `fnar.amb.building` | no (stereo bed, non-positional) | 24 s loop | empty building at night: low drone, faint creaks, a far-off drip, metallic ticks |
| `fnar.amb.duct` | yes | 6 s loop | air moving in a sheet-metal duct |
| `fnar.amb.light_buzz` | yes | 2 s loop | hall light buzz (harsh 60/120 Hz) |

**Office devices**
| event | mono | dur | description |
|---|---|---|---|
| `fnar.door.close` | yes | 1.2 s | heavy steel shutter slamming down (fast roll + big metallic impact) |
| `fnar.door.open` | yes | 1.4 s | shutter rolling up (motor whine + rattle) ending in a clank |
| `fnar.door.error` | yes | 0.5 s | dead-button buzz (door won't move: power out) |
| `fnar.light.on` | yes | 0.3 s | heavy switch click + ballast thunk |
| `fnar.light.off` | yes | 0.2 s | switch click |
| `fnar.button.press` | yes | 0.15 s | plastic button click (2 variants) |
| `fnar.vent.close` | yes | 0.9 s | steel vent hatch slamming shut (lighter, tinnier than the door) |
| `fnar.vent.open` | yes | 0.7 s | hatch sliding open |
| `fnar.cam.up` | no | 0.5 s | monitor flip-up: plastic whoosh + CRT power-on "thunk-hiss" |
| `fnar.cam.down` | no | 0.4 s | monitor down |
| `fnar.cam.switch` | no | 0.3 s | camera blip: short beep + static burst (3 variants) |
| `fnar.cam.static` | no | 1.5 s | heavy TV static with a low hum |
| `fnar.cam.hum` | no | 10 s loop | CRT 15.7 kHz whine (quiet) + electrical hum |
| `fnar.cam.glitch` | no | 0.6 s | digital glitch / signal tear |
| `fnar.power.out` | no | 3 s | everything powers down: relay clunk, hum winding down, silence |
| `fnar.clock.chime` | no | 1.5 s | soft bell chime for the hour |
| `fnar.clock.6am` | no | 6 s | 6 AM: five bright bell chimes then a warm major chord (victory) |
| `fnar.phone.ring` | yes | 4 s | old phone ring (two 0.8 s bursts of a 20 Hz-modulated bell) |
| `fnar.phone.pickup` | yes | 0.4 s | receiver click + line hiss |
| `fnar.phone.voice` | yes | 2 s ×4 variants | unintelligible "voice through a phone line": band-passed babble-like formant noise (no real speech) — plays under the phone text |
| `fnar.phone.hangup` | yes | 0.5 s | hang-up click + dial tone tail |

**Animatronics** (all mono, positional)
| event | dur | description |
|---|---|---|
| `fnar.step.heavy` | 0.35 s ×4 | heavy metal footstep: thud + servo clink |
| `fnar.step.light` | 0.25 s ×4 | lighter quick step (Cat) |
| `fnar.step.scurry` | 0.6 s ×3 | rapid little scurry taps (Purple Rat) |
| `fnar.servo.move` | 0.8 s ×3 | servo whirr / joint groan |
| `fnar.servo.head` | 0.4 s ×2 | short servo whine (a head turning to the camera) |
| `fnar.mirehop.strum` | 2 s ×3 | detuned, slightly distorted electric guitar chord (Karplus–Strong), different chord per variant |
| `fnar.noxbriar.hum` | 5 s ×2 | eerie low female-ish humming, wordless (formant synthesis), slightly warbly like a worn tape |
| `fnar.rustgrin.feedback` | 1.5 s ×2 | microphone feedback squeal rising, then cut |
| `fnar.rustgrin.laugh` | 1.6 s ×2 | deep, slowed, distorted mechanical chuckle ("huh-huh-huh") — vocoder-ish |
| `fnar.rustgrin.song` | 20 s | music box (glockenspiel-like FM bells + mechanism clicks) playing "Rustgrin's Theme" — an original, slightly melancholy waltz melody in a minor key; this is the power-out song |
| `fnar.cat.bell` | 1 s ×2 | collar bell jingle (small metallic bells) |
| `fnar.cat.run` | 2 s | fast running footsteps getting closer |
| `fnar.cat.bang` | 1.5 s ×3 | banging on a steel door: 3–4 hard metallic hits |
| `fnar.cat.growl` | 1.2 s | mechanical purr-growl (low rumble + servo) |
| `fnar.rat.maracas` | 1.5 s ×3 | maraca shakes (rhythmic filtered noise bursts), slightly frantic |
| `fnar.rat.squeak` | 0.4 s ×2 | squeaky servo / rubber squeak |
| `fnar.rat.crawl` | 1 s ×3 | crawling in a sheet-metal duct: dull metallic thumps and scrapes |
| `fnar.rat.bang` | 0.8 s | hitting a closed vent hatch from inside |
| `fnar.tophat.cane` | 1.2 s | three cane taps on a tile floor (sharp wooden/metal tip clicks with room reverb) |
| `fnar.tophat.fanfare` | 3 s | short circus fanfare on a calliope/steam-organ timbre ("Step right up!") |
| `fnar.tophat.show` | 16 s loop | the Midway show music: calliope circus waltz, original melody, mono so it can play from the stage |
| `fnar.tophat.show_slow` | 16 s loop | the same tune at ~70 % speed, detuned and warbling (tape running out) |
| `fnar.tophat.rewind` | 1 s | tape rewind whirr (rising pitch) |
| `fnar.tophat.tape_out` | 2.5 s | tape runs out: music dies, then the reel's loose end flapping |
| `fnar.tophat.laugh` | 2 s | thin, showman-like mechanical laugh (pitched up, tinny) |

**Jumpscares** (stereo is fine — played at the player, non-positional) — each
≈1.6 s, loud, harsh: distorted scream/screech built from noise + resonant
formants + a downward pitch sweep + servo grind. Each has its own colour:
| event | flavour |
|---|---|
| `fnar.js.rustgrin` | deep roar, sub-heavy |
| `fnar.js.mirehop` | screech with a guitar-string squeal through it |
| `fnar.js.noxbriar` | choir-like scream, hollow |
| `fnar.js.purple_rat` | high squeal, frantic rattle |
| `fnar.js.cat` | hiss into scream |
| `fnar.js.top_hat_rat` | calliope blast collapsing into a scream |

**Hallucinations / UI / music**
| event | stereo | dur | description |
|---|---|---|---|
| `fnar.hall.whisper` | yes | 2 s | reversed whisper-like breath noise |
| `fnar.hall.sting` | yes | 1.5 s | horror sting: dissonant swell + hit |
| `fnar.ui.click` | yes | 0.1 s | menu click |
| `fnar.ui.star` | yes | 2 s | a star is earned (bright chime arpeggio) |
| `fnar.music.title` | yes | 40 s loop | lobby theme: slow, eerie — detuned music box over a dark pad, original |
| `fnar.music.showtime` | yes | 48 s loop | the Rusty Revue's daytime song: cheesy 80s pizzeria band — organ, bass, simple drums, a lead melody (original), slightly warped like an old tape |
| `fnar.music.ending` | yes | 12 s | ending theme: the music-box melody resolving to major |

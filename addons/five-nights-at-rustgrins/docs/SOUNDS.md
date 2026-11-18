# Sounds — specification

All audio is **original and synthesised** for this project (numpy/scipy-style
DSP in Python → WAV → Ogg Vorbis with ffmpeg `-c:a libvorbis -q:a 4`, 44.1 kHz).
No samples from FNAF or anywhere else.

* Files: `packs/RP/sounds/fnar/<group>/<name>.ogg`.
* Definitions: `packs/RP/sounds/sound_definitions.json`
  (`"format_version": "1.20.20"`, `"sound_definitions": { "fnar.<group>.<name>": {...} }`).
  Every event lists its file(s) as `"sounds/fnar/<group>/<name>"` (no
  extension); several variants per event where noted (Minecraft picks one at
  random). Set `"category"` (`ambient`, `block`, `hostile`, `ui`, `music`; also
  `weather` for the storms, `player` for the guard's own heartbeat and `neutral`
  for the daytime guests) and,
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

**Jumpscares** (stereo, played at the player, non-positional) are the map
owner's own recordings (`assets/audio/`), copied as they are (or only trimmed in
gain if they peak above -1 dBFS):
| event | file |
|---|---|
| `fnar.js.rustgrin`, `fnar.js.mirehop`, `fnar.js.noxbriar`, `fnar.js.purple_rat`, `fnar.js.cat`, `fnar.js.top_hat_rat` | `js/animatronic.ogg` (2.8 s) |
| `fnar.js.rusted` | `js/rusted.ogg` (3.3 s, the "fredbear" scream) - only the Rusted one uses it |

**The Final Act**
| event | stereo | dur | description |
|---|---|---|---|
| `fnar.final.chime` | yes | 1.9 s | the Ringmaster's PA: three-note carnival chime through an old ceiling speaker |
| `fnar.final.applause` | yes | 4.5 s | a small unseen audience clapping (a game done right) |
| `fnar.final.spot` | yes | 0.9 s | a theatre spotlight striking: relay clunk, arc, hot hum |

**The night shift** (the layer of dread under every shift; `recipes_night.py`)

Two beds play under everything, low enough not to mask the gameplay tells
(footsteps, hums, twangs, servo whirr). The rest are one-shots the night
script scatters around the building. Positional ones are mono, with the
distances given. The stereo ones play at the player.
| event | channels | dur | dist (min/max) | description |
|---|---|---|---|---|
| `fnar.night.drone` | stereo, `ambient` | 12 s loop (240 ticks) | - | deep sub drone: close low tones a tritone apart (D1/Ab1/D2) beating slowly, differently left and right; a low growl, sub rumble, slowly moving air; a faint high metallic shimmer drifting in and out |
| `fnar.night.heartbeat` | mono, `player`, at the player | 2 s loop (40 ticks) | 4/12 | heavy heartbeat, two lub-dubs per loop (60 bpm), close and muffled, as if heard from inside the head. Played with pitch up to 1.3; at pitch p it lasts 2/p s, so restart it every 40/p ticks |
| `fnar.night.breath` | mono, `hostile` | 3 s ×3 | 1/10 | slow mechanical breathing through a speaker grille just outside the door: a ragged inhale, a valve tick and servo hiss, a rattling exhale |
| `fnar.night.musicbox_far` | mono, `hostile` | 8 s ×2 | 8/48 | Rustgrin's Theme on the music box, very far away down empty halls: badly detuned, the spring running down, a note or two dying out, a big dark reverb |
| `fnar.night.kids` | mono, `hostile` | 5 s ×3 | 6/40 | distant children's party chatter and laughter, as if remembered: slowed, warbling, smeared, reverberant; one laugh backwards (v1), all of it backwards (v2), one slurred group laugh whose echo arrives first (v3). Formant voices, no words |
| `fnar.night.giggle` | mono, `hostile` | 1.5 s ×2 | 1/12 | a single small, warped childlike giggle, much too close (v2 slurs down into a deep chuckle) |
| `fnar.night.scrape` | mono, `hostile` | 3 s ×2 | 4/32 | metal dragged slowly over tile somewhere down a hall: a pipe in two pulls (v1), a heavy strut that is set down at the end (v2) |
| `fnar.night.knock` | mono, `hostile` | 2.5 s ×2 | 2/16 | three slow, heavy knocks on the office's steel door, the third a little late (v2: then the fingertips drag down the door) |
| `fnar.night.door_rattle` | mono, `hostile` | 2 s ×2 | 2/16 | someone slowly testing the steel shutter: the slats rattle in their rails, scrape up a finger's width and drop back |
| `fnar.night.radio` | mono, `block` | 5 s ×2 | 2/24 | an old radio left on in a back room: static and whistles as the dial drifts, a muffled, warped snatch of the Midway waltz (the Ringmaster's calliope tune), static again (v2 drifts on to a talk station) |
| `fnar.night.drip` | mono, `ambient` | 1 s ×3 | 1/12 | a water drip in a small dark room: into a puddle, onto a wet floor, two drops |
| `fnar.night.groan` | mono, `ambient` | 4 s ×2 | 8/64 | the building's steel frame groaning, deep and long, far away (v2 rises and lets go with a bang) |
| `fnar.night.twitch` | mono, `hostile` | 0.4 s ×3 | 1/16 | a sudden glitchy servo jerk, an animatronic head snapping round toward you |
| `fnar.night.stinger` | stereo, `hostile` | 3 s ×2 | - | big scare sting: a reversed swell into a sub-bass hit with a dissonant metal cluster and a brass-like stab on top, ending in a ringing tail (and a ringing in the ears). Quieter than the jumpscares |
| `fnar.night.midnight` | stereo, `ui` | 6 s | - | the start of the night shift: a wall clock ticking, one low distant bell toll, a heartbeat swelling under it, a breath of static at the end |

**The pizzeria by day** (the guests in Free Roam; `recipes_day.py`). All mono and
positional, category `neutral` (people) or `block` (the door bell).
| event | channels | dur | dist (min/max) | description |
|---|---|---|---|---|
| `fnar.day.crowd` | mono, `neutral` | 14 s loop (280 ticks) | 10/44 | a family restaurant on a busy afternoon, heard from inside the room: two dozen people talking over each other, children chattering and laughing, cutlery on plates, a chair pushed back. Formant voices, no words. Played from the middle of the Dining Hall and of the Game Room at a level set by how many guests are there; stops when closing time starts |
| `fnar.day.cheer` | mono, `neutral` | 3.2 s ×3 | 8/44 | the audience at a show for a few seconds: a dozen people clapping, each at their own pace, a "woo!", children's "yay!" (v2: the children louder; v3: a short polite round). During the show now and then, and at the bow on top of `fnar.final.applause` |
| `fnar.day.door_chime` | mono, `block` | 1.8 s | 4/30 | the bell over the front doors as a group comes in: two warm notes, ding... dong, and the door settling |

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
| `fnar.music.bgm` | yes | 180 s, looped by the game | the map owner's background track, played during shifts with `Player.playMusic` (music volume slider; on/off in the Shift Guide) |

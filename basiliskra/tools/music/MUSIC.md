# His themes

Three original pieces, written for this pack and rendered entirely by `tools/music/compose.py`. There are no samples, no
soundfonts and no borrowed audio: every instrument is a model played from a written score (bowed-string sections
through modal body filters, brass and winds whose brightness follows how loudly they are played, a formant choir,
modal drums and inharmonic metal, organ pipe ranks), seated on a virtual stage and sent through a synthetic concert
hall. Nothing in them quotes or imitates an existing theme; the one recurring idea is his own three knocks.

| File | Title | Plays when | Key, tempo | Length |
|---|---|---|---|---|
| `theme_dread.ogg` | "He is near" | he is near and awake | D minor (octatonic colouring over a D pedal), 66.7 BPM | 2:44 |
| `theme_wrath.ogg` | "He is fighting" | he is fighting | C minor, 70.0 BPM | 2:43 |
| `theme_last.ogg` | "The last form" | a change, the last crossing (and Basiliskra IV) | F minor, 64.0 BPM | 2:44 |

## How each one goes

**"He is near"** (44 bars)

* 0:00  A  Depth: bass pedal, first knocks, first distant brass swell
* 0:28  B  The knock motif D-F-C# in celli/contrabassoon, sequenced by minor thirds; brass answers
* 1:04  C  Cold high violin line (the motif in half notes) over tremolo violas
* 1:48  D  Surge: the motif tutti, ff, four rising statements
* 2:16  E  Coda: pedal, last contrabassoon statement, three far knocks

**"He is fighting"** (46 bars)

* 0:00  Intro  Taiko / gran cassa ostinato alone, timpani knocks, strings enter
* 0:13  A   March theme: trombones and tuba in octaves over the string gallop
* 0:41  A'  Theme again with horns an octave above, violin counter-line, trumpets join
* 1:08  B   Development: knock motif passed between horns and trombones, Abm - Bm - Dm - G
* 1:36  C   Climax: theme in four octaves of brass, choir "ah", full percussion
* 2:03  C2  Hammer chords Cm - Ebm - Bm, Neapolitan D-flat, arrival on bare C
* 2:10  Coda  Ostinato dies away to the three knocks over a low C

**"The last form"** (42 bars)

* 0:00  Intro  Organ pedal F, tolling bell, men humming a bare fifth
* 0:15  A   Chorale, choir alone over the organ pedal (pp to mp)
* 0:45  B   Horns: the knock motif inverted (C-A-Db), harmonised Fm - A - Db; chorale phrase with strings; second horn call
* 1:15  C   Chorale in full brass, choir, organ, bell every bar, timpani knocks
* 1:45  C2  The wall: F minor then G-flat over an F pedal, hammered inverted motif
* 1:52  D   Collapse: bell, distant horns, choir cadence pp
* 2:15  Coda  A single low F; three last knocks

## In the game

`src/music.ts` picks a theme once a second from what he is doing and plays it to each player in range with
`Player.playMusic` (looped, faded in); a few seconds after its reason is gone it is faded out with `music stop`. The
sound events are `basiliskra.music.dread`, `.wrath` and `.last` (`tools/music/music_definitions.json`, merged into
`sound_definitions.json` by `tools/sound/synth.py`). They are ordinary game music: the Music slider sets their level, and
"His music" in the config wheel's Settings switches them off. Each piece ends on a tail of a few seconds of quiet
before it loops.

## Rendering

    python3 tools/music/compose.py            # all three (needs numpy and ffmpeg with libvorbis; a few minutes)
    python3 tools/music/compose.py --only wrath
    python3 tools/music/analyze.py            # measure the renders, write spectrograms to tools/music/out/

Deterministic: fixed seeds only, so the same script gives the same files.

## What was checked, and what was not

**Nobody has listened to these.** They were written and rendered in an environment with no audio output, and checked
by measurement only:

| | "He is near" | "He is fighting" | "The last form" |
|---|---|---|---|
| Length (s) | 164.9 | 163.8 | 164.5 |
| Peak (dBFS) | -4.24 | -1.75 | -2.76 |
| Level, whole piece (dBFS RMS) | -25.0 | -20.2 | -23.1 |
| Loudest ten seconds (dBFS RMS) | -18.6 | -16.6 | -17.1 |
| Quietest ten seconds (dBFS RMS) | -34.2 | -30.1 | -40.8 |
| Clipped samples | 0 | 0 | 0 |
| Energy below 250 Hz | 35% (60 to 250 Hz) | 34% (60 to 250 Hz) | 24% (60 to 250 Hz) |
| Energy above 2 kHz | 6% | 6% | 5% |

What the numbers can and cannot say: the pieces are the right length, they do not clip, they have a wide dynamic range
(quiet openings, a loud climax two thirds of the way through, a fading coda), and their spectra are full from the bass
to about 8 kHz, dark on top, as written. They cannot say whether the modelled orchestra *sounds* like one, whether the
balance between sections is right, or whether the writing is as frightening as it is meant to be. If something sounds
wrong, say what and where (minute and second): every note is in `compose.py` and can be changed.

The composing run was cut short by a usage limit just after its last full render, so this note was written afterwards
from the score's own metadata (`out/render_info.json`) and a fresh run of `analyze.py`.

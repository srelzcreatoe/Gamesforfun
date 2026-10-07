# Release Readiness and Known Limitations

## Verdict

**Functionally complete and runtime-verified on the server side; not yet verified in a game client.**

Everything that runs on the server — the director, all 18 encounters, the restoration ledger, persistence across a
restart, multiplayer targeting, dimension travel, items, wards, settings — was exercised on a real Bedrock Dedicated
Server 1.26.52.3 with GameTest simulated players (see [TEST_REPORT.md](TEST_REPORT.md)). What a dedicated server cannot
show — how the model, animations, particles, fog, sounds and forms *look and sound* on a client — has been checked
statically (official schemas, cross-references, offline forward-kinematics renders of every animation) but **has not
been seen in a running client**. One in-game pass with the procedure in TEST_REPORT.md §6 is required before
distributing it.

Recommended release path: **community release (e.g. MCPEDL/CurseForge) after the client pass**. Marketplace submission
is a separate project (see §3). Nothing has been published, submitted, or approved.

## 1. Known limitations

### Platform constraints (Bedrock cannot do these; the design works around them)
| Limitation | Consequence / workaround |
|---|---|
| Entities cannot be hidden from individual players | The body is visible to everyone present; personal cues (steps, breath, chimes, fog, captions) are used for one-player moments |
| Mob collision boxes cannot change height per pose for pathfinding | Collision is 0.8 × 2.9: it walks through 3-high spaces (stooping automatically) but not 2-high doorways or tunnels. Encounters in 2-high spaces use unseen arrival instead of walking; *The Closed Path* defers there. It opens doors to look in rather than entering |
| No emissive eye material is used (the supplied texture's eyes are plain pixels) | In darkness, unlit "eye glint" particles mark its eyes for players in front of it |
| Footprints are particles, not decals | They last 40 s and are re-shown whenever a player returns within 25 minutes |
| Script dynamic-property saves cannot be forced at disconnect | State saves every 5 s and on shutdown; at most the last few seconds of memory updates can be lost |

### Design boundaries
* Stalking is logical: no body exists between encounters (performance and subtlety). Placement is recomputed from the
  player's position each time, so travel speed does not matter.
* Gliding players are excluded from most encounters (nothing can keep pace); encounters resume after landing.
* In the End it needs solid ground (islands); over the void it defers. In the Nether it never stands on lava.
* Weather during the vigil is world-wide (announced in chat, can be disabled in settings).
* English text only (`en_US.lang`).
* Requires Bedrock 1.26.50+ (`@minecraft/server` 2.10.0).

### Unverified in a client (implemented and statically validated)
* Model rendering with the supplied texture; animation playback and blending per state; stoop overlay; head tracking
  (`query.target_x/y_rotation`); peek lean direction (`observer:side` sign); `hidden` part visibility.
* Particle appearance (footprint orientation via `variable.yaw`, glints, motes, chalk marks); fog look; block models
  (effigy, ward lantern) and their rotations; item icons.
* Audio: all 21 sound events resolve to files (validated) but mix levels, attenuation and the feel of each sound have
  not been auditioned in game. Vanilla sound IDs used for borrowed sounds were taken from a published Bedrock sound
  list and are not verifiable on a server.
* Forms (Field Notes, settings), action-bar captions, title cards, camera fades and shakes (the fade API and the
  `camerashake` command were accepted by the server).

### Verified only partially
* Disconnect/rejoin: state saving is exercised by every test (player dynamic properties), but a real player leaving and
  rejoining was not simulated (simulated players cannot reconnect with the same identity).
* Pacing rules (quiet periods, recovery, global gap, anti-repetition) run in every test and the natural-director test
  started encounters on its own, but each timing rule was not asserted individually.
* *Breathing Room* is verified via the water escape. The other two escape paths — outrunning it by sprinting (48+ blocks
  and out of sight) and outlasting its 35-second limit — are implemented but not driven by the suite (the arena is too
  small for a 48-block lead).

## 2. Risk register
| Risk | Likelihood | Mitigation in build |
|---|---|---|
| A sound feels too loud/quiet | medium | all levels in `sound_definitions.json`; regenerate with `tools/synth_sounds.py` |
| Peek leans into cover instead of out | low–medium | single sign in `make_supplemental_anims.py` |
| Observer clips into foliage on hills | low | spot search rejects leaves as ground, needs ≥ 3 blocks headroom |
| Players dislike base intrusion | — | Ward Lantern, manipulation levels, `/observer:restore`, Atmosphere preset |
| Pack removed without restoring | low | documented; Veil/Effigy would remain as unknown blocks |

## 3. Marketplace readiness (evidence-based, not a certification)
| Area | Status | Evidence / gap |
|---|---|---|
| Original content | ✅ for everything generated here; ⚠ the creature model and animations are the *supplied* assets — rights and attribution must be confirmed by the supplier | [ASSET_RECORDS.md](ASSET_RECORDS.md) |
| Stable APIs, no experiments | ✅ | manifests; BDS load with zero content-log errors |
| Namespacing / no vanilla overrides | ✅ | all identifiers `observer:`; no vanilla files replaced |
| Performance | ✅ server: 20.00 TPS with and without the add-on (see TEST_REPORT §4); ❔ client frame time on low-end devices untested |
| World safety / uninstall | ✅ ledger + restore command; documented removal steps |
| Accessibility options | ✅ captions, camera-effect and sudden-scare controls, Peaceful respected |
| Localization | ⚠ English only |
| Store assets | ❌ no key art, screenshots, panorama or trailer (must be captured in a client) |
| Device QA | ❌ no testing on phones/consoles |
| Content guidelines review | ❔ horror theme with mild, telegraphed violence and optional jump scares; needs Microsoft partner review |
| Name | ⚠ "The Observer" may be confused with the vanilla *Observer* block; consider a subtitle for store listing |
| Partner status | ❌ Marketplace publishing requires an approved Marketplace partner; nothing was submitted |

## 4. Marketing copy (accurate to what is implemented)

**The Observer** — *It follows you wherever you go. You rarely see it. You notice that something is wrong.*

A tall, silent figure studies one player at a time. It walks in step with you and takes one step too many. It borrows
the sounds of your own work and plays them from where you are not. It gets home before you do and arranges things for
you to find. It closes the tunnel behind you. It can be understood — and if you pay attention long enough, you can
finally meet its gaze.

* 18 encounter types, three signature encounters, five escalating stages
* Real, reversible world changes — your builds are protected and your own changes always win
* 22 discoveries, a Witness Lens, Tally Chalk, Ward Lanterns, and an ending you can reach
* Works across the Overworld, caves, water, the Nether and the End; multiplayer-aware
* Atmosphere, Standard and Relentless presets; captions and full control over scares and camera effects

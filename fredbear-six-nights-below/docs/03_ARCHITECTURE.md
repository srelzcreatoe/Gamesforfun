# 03 · Architecture, ownership and reliability

## One owner per system

| System | Authoritative owner | Others may only… |
|---|---|---|
| Night clock (9,600 ticks) | `NightSession.tick()` (`scripts/core/session.js`) | read it (HUD, hour lamps through actuators) |
| Power (fixed-point) | `NightSession.tickPower()` / `spend()` | display it (meter modules `pwr.meter_*`) |
| Doors, lights, hatch, cameras, strobe, breaker, reserve (logical state) | `NightSession.handleInput()` | mirror it physically (command-block modules) |
| AI decisions, routes, attack arbitration | `NightSession` + `Director` + `scripts/core/ai/*` | — |
| Physical world changes (iron doors, light blocks, trapdoors, lamps, sounds placed in the world, camera shake) | command-block **modules** in the control room | be *triggered* by the script through the actuator bus |
| Player inputs | console buttons/levers → input command blocks → `/scriptevent fb:input` | — (the script accepts an event only from the registered block position) |
| Visible animatronics | `Puppets` (`scripts/mc/puppets.js`) mirroring `session.anim[*].pose()` | — |
| Player view (free camera, input permissions, night vision) | `CameraView` | `restorePlayerView()` on every exit path |
| Campaign progress | `persistence.js` (`fb:save` dynamic property) | — |
| Map construction | `Builder` (`scripts/mc/builder.js`) executing `generatePlan()` | — |

Command blocks never advance a timer, never charge power and never decide an attack. The script never places
door or light blocks itself during a night; it only sets a module's redstone pad. So no system has two writers.

```
 player presses a console button
        │  (redstone)
        ▼
 input command block ── /scriptevent fb:input door_l ──►  Game.onScriptEvent (position check)
                                                               │
                                                               ▼
                                              NightSession.input('door_l')  (queued, debounced)
                                                               │  next tick
                                                               ▼
                                     session.tick(): inputs → clock → power → director → devices → AI
                                                               │ emits effects (fx)
                     ┌─────────────────────────────┬──────────┴───────────┬───────────────────┐
                     ▼                             ▼                      ▼                   ▼
          ActuatorBus.trigger('door_l_close')   Puppets.sync()      Audio / HUD      CameraView / forms
                     │ places redstone_block on the module pad
                     ▼
     control-room module: impulse block clears its pad, chain runs
     `fill … iron_block`, `playsound fb.door.close …`, indicator lamp
```

## Global state machine

| Brief state | Implementation (`Game.state`) | Entered by | Leaves to |
|---|---|---|---|
| SETUP | `BOOT` → `UNBUILT` → `BUILDING` | world load; `/fb:setup` | `LOBBY` when the build completes |
| LOBBY | `LOBBY` (also `FREE_ROAM`) | full reset | `INTRO` (night button), `NIGHT` (training), `FREE_ROAM` |
| INTRO | `INTRO` | night chosen at the time clock | `NIGHT` (START SHIFT in the office, or after 180 s) |
| NIGHT_RUNNING | `NIGHT` (session phases `RUNNING`, `MAINT`, `POWER_OUT`, `JUMPSCARE`) | `beginNight()` | `RESULT` |
| WIN / LOSE | `RESULT` (`won` true/false); night 6 win → `ENDING` | session `win` / `lose` effects | `RESET` → `LOBBY`, next `INTRO`, or `NIGHT` (retry) |
| RESET | `RESET` (office) or the reset inside `fullReset()` | result screen, `/fb:lobby`, errors | `LOBBY` / `NIGHT` |

**Simultaneous events** are resolved by the fixed per-tick order in `NightSession.tick()`:

1. `WON`/`LOST`: inert. `JUMPSCARE`: count down to `LOST`; the clock is frozen.
2. Queued player inputs (debounced per device).
3. Clock +1. **Reaching 6 AM commits WON immediately, before power and AI**: an attack that has not already
   started cannot beat 6 AM. An attack that started earlier froze the clock, so 6 AM can never overturn it.
4. Power drain (may enter `POWER_OUT`).
5. Director memory and scheduled events (may enter `MAINT`).
6. Device timers, then AI in fixed order: Fredbear, Freddy, Bonnie, Chica. Only one attack token exists.

Tests: `core.test.mjs` "6 AM boundary", "simultaneous threats".

## What runs every tick and what runs on events

| Every tick (script, `system.runInterval(…, 1)`) | Every N ticks | Only on events |
|---|---|---|
| `NightSession.tick()` during `NIGHT` | puppet integrity (40), rest-pose sync in the lobby (20), HUD action bar (5 at night / 40 in the lobby), intro guide particles (10) | every command-block module (triggered by the bus) |
| puppet pose sync during `NIGHT` (4 teleports + changed properties only) | camera pan (110) and cover fades | input command blocks (button presses) |
| actuator bus drain (only when its queue is non-empty) | **heartbeat**: the only repeating command block, every 100 ticks | forms, item use, sneak, hotbar change |

The whole map is never "run". AI is an abstract simulation on a route graph, independent of chunk loading.
The four puppets are the only per-tick world writes (teleport + property sync), plus at most one Fredbear echo.

## Reset (`Game.fullReset`)

Restores, in this order, every item the brief lists:

| Item | How |
|---|---|
| Animatronic positions and states | session discarded; puppets synced to home nodes with rest poses; echo removed |
| Timers, temporary scores, pending events, cooldowns | `session`, `intro`, `maint`, `tutorial`, `result`, `ending`, `timers`, `camBurst`, task bonuses cleared; the bus is fenced (below) |
| Doors and lighting | modules `reset.world` → `night.end` (doorways opened, light blocks removed, office lamps restored, indicators reset), `sig.stage_lights_on` |
| Power | a new session always starts at 100 % (105 % with the task bonus); meter module `pwr.meter_full`, `pwr.charges_0` |
| Player position and inventory | teleport to the lobby anchor (or office for a retry); kit re-issued (locked slots 0-2) |
| Camera and input state | `CameraView.close()` and `restorePlayerView()` for every player: `camera.clear()`, input permissions restored, night vision removed |
| Temporary effects and sounds | all effects removed then saturation re-applied; music-box loops stopped (`SoundInstance.stop`); `stopsound @a` in `night.end`; fog stack popped; HUD reset |
| Game state | `LOBBY`, `FREE_ROAM` or `RESET`; `fb:session` marker cleared |

**Ordering fence.** Command-block chains run after the tick that triggers them; `reset.world` re-triggers
`night.end` one hop later. A night started in the same tick as a reset (training shift, `/fb:debug night`,
scenarios) would otherwise have its `night.begin` undone by `night.end`. `fullReset()` therefore calls
`bus.fence(settleTicks('reset.world') + 4)`: every later trigger waits until the reset chains have finished, in order.
This bug was found by the integration tests (docs/10) and fixed.

Integration test "ten randomized play / reset cycles leave no residue" checks all of the above after each cycle.

## Persistence, quitting and reloading

| Key (world dynamic property) | Contents | Lifetime |
|---|---|---|
| `fb:save` | unlocked night, completed nights, tutorial/campaign flags, secrets, settings, stats | permanent until *Erase progress* |
| `fb:build` | builder phase/op (resumable construction) and version | permanent |
| `fb:session` | `{active, night, seed}` while a night runs | cleared on win, loss and every reset |

Temporary night state (clock, power, AI) is **never** persisted. If the world closes mid-night, the next load
runs `boot()`: it sees `fb:session.active`, performs a full reset to the lobby and tells the player the shift was
interrupted. Progress is unchanged; the night must be replayed. If the world closes mid-build, the builder
resumes from the stored phase/op on the next `/fb:setup`.

## Chunks, simulation distance and distant threats

* Four ticking areas (8 × 8 chunks each, docs/02) keep the property, basement and control room loaded, so command
  blocks, pads and puppets exist regardless of where the player stands.
* AI never depends on loaded chunks: positions are logical (route graph). Puppets mirror them; if a puppet's chunk
  is not loaded the sync skips it and respawns/recovers it later. Integration test "unloaded chunks…" proves the
  clock keeps running, actuations are deferred and then applied, and exactly one puppet per character remains.
* Actuator pads in unloaded chunks are retried every tick (counted as `deferred`).
* Rendering of distant camera feeds depends on the client's render distance around the **player**, not on ticking
  areas; see docs/02 "Rendering reach" (recommend ≥ 11 chunks). Not verified in-game.

## Entities, tags, sounds and particles

* Exactly one entity per animatronic, tagged `fb_puppet` and `fb_<who>`; at most one `fb:fredbear_echo`. All have the
  family `fb_animatronic`. The integrity pass (every 40 ticks) removes duplicates and untagged strays, respawns missing
  puppets and snaps any puppet more than 3 blocks from its logical pose.
* Puppets have no gravity or collision, take no damage, are persistent and cannot be pushed.
* At most 6 script sounds per tick (`Audio`), guide particles 3 per 10 ticks, one shimmer per relocation.
* Selectors in command blocks are limited to `@a`, `@s` and `@e[type=item]` (item cleanup in the reset).

## Inputs and accessibility

* Every console control is debounced in the session (doors 8 ticks, lights 6, cameras 6, switching 4, hatch 10,
  strobe cooldown 200) and answers with feedback: accepted, unavailable (with reason) or cooling down.
* Keyboard/mouse: use the buttons; Shift lowers the monitor; mouse wheel / number keys switch cameras.
* Controller: use button on consoles; RB/LB switch cameras; sneak lowers the monitor.
* Touch: tap consoles; the Camera Tablet, Office Remote and Shift Guide show an on-screen interact button
  (`minecraft:interact_button`), giving menu access to every office control.
* Captions for every audio cue (default on), optional hints, optional developer overlay.

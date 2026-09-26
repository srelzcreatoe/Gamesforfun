# Cubic World (the previous game) — UI/UX & gameplay spec to re-create

Source: `legacy/cubicworld/core/src/main/kotlin/com/cubicworld/**` (Kotlin + libGDX). The user
refers to this HUD/inventory/camera design as the one to bring over ("Cubical Adventures").
Numbers below are the real constants from that code base. In Godot, `s = Game.ui_scale()`.

## 0. Global scaling model
* `s = clamp(screenHeight / 480, 0.8, 3.0) * settings.ui_scale`. Every size below is `N*s` px.
* Fonts: body font scale `max(s*1.05, 1.0)`, title font scale `max(s*2.1, 1.6)` (with Monocraft use 8px multiples: body 8*round(s*1.05), title 16*round(s)).
* Palette (procedural): panel fill `#171C29` @0.92 border `#4D6185`; panel-light fill (0.16,0.20,0.28 @0.95) border (0.38,0.48,0.64); button up (0.20,0.30,0.44 @0.95)/border (0.45,0.62,0.85); button down (0.32,0.48,0.66)/border (0.60,0.80,1.0); danger (0.45,0.16,0.14 @0.95)/border (0.85,0.40,0.36); label white, `title` (0.85,0.95,1.0), `dim` (0.7,0.75,0.82). Rounded nine-patches (24px tile, radius 12; buttons 20px/radius 9). Slider track (0.25,0.28,0.36) 8×8, knob (0.55,0.72,0.95) 18×26. Checkbox 24×24: off (0.2,0.24,0.32), on (0.45,0.75,0.5).
  → In Dragon Block Sagas replace the procedural panels with the Minecraft-style `inventory.png`/`widgets.png` nine-slices, keep the same layout metrics.

## 1. Touch HUD
Draw order: look region (full-screen, behind everything) → joystick → action buttons → top bar → hotbar/bag/status → labels → dialogs. Rebuild on resize; keep open dialogs.

**Look region.** Invisible full-screen control. A touch is rejected if it is on the joystick side — right-handed: `x < 0.35*width`; left-handed: `x > 0.65*width` — or if another pointer already owns look. Single pointer.
* Drag accumulates `lookDeltaX/Y` in px; "moved" once a drag exceeds `|dx|+|dy| > 6*s`.
* Release: not moved and held `< 260 ms` → world tap (place/use/attack/talk).
* Hold: `held >= 280 ms` and not moved → `breakHeld = true` (mine; or eat if selected item is food and hunger < 20). Releasing or moving cancels.
* `cancelTouches()` whenever input focus leaves the HUD (bag, pause, death).

**Joystick.** Deadzone 6 px, size `150*s`. Bottom-left at `(30*s, 26*s)`; left-handed → bottom-right. Background: circle fill white @0.14, 2px border white @0.35. Knob: circle fill white @0.50, border white @0.70 (radius 26px source). Output `knobPercentX/Y` → `move`.

**Action buttons** (circle glyphs, fill `#1A1F2E` @0.85, glyph (0.75,0.85,1.0), alpha = `settings.button_opacity` default 0.65 range 0.2–1.0). Column x: `bx = width - 64*s - 24*s` (right-handed) or `24*s`.
* Jump: `64*s` at `(bx, 34*s)`. Press/release → `jump`.
* Sneak: `54.4*s` at `(bx + 4.8*s, 108*s)`. Toggle; alpha 1.0 when on.
* Sprint: `54.4*s` at `(bx + 4.8*s, 168.8*s)`. Toggle.
* Top-right bar (never mirrors): pause `52*s` at `(width - 66*s, height - 66*s)`; camera (eye glyph) `52*s` at `(width - 130*s, height - 66*s)`.
* Bag: `52*s` right of the hotbar at `(bar.x + bar.width + 10*s, 8*s)`.
* Dragon Block additions (same style, same column, stacked left of the jump column): Attack `64*s`, Ki Blast `56*s`, Charge `56*s`, Fly `48*s`, Dash `48*s`; left-top column: Transform, Technique, Lock-on (`48*s`).

**Gestures.**
* Double-push sprint: joystick `knobY` crossing `< 0.45` → `> 0.85` twice within 350 ms → `gestureSprint = true`; cleared when `knobY < 0.2`.
* Double-tap jump → toggle fly (when the fly skill is known; creative always).
* Look: `yaw -= lookDeltaX * 0.22 * sens`, `pitch += lookDeltaY * 0.22 * sens`, pitch clamped ±89°.

**Hotbar.** 9 slots, cell `52*s` with `2*s` pad each side inside a panel padded `4*s` → bar `512*s × 64*s`, centred horizontally, `y = 8*s`. Cell: bg black @0.35, selection highlight, icon fit, count label 0.8 bottom-right when `count > 1`. Tapping selects + `click` @0.5.

**Health / food / oxygen** (20 half-units each).
* Hearts: 10 icons `17*s`, pitch `18*s`, from `bar.x + 4*s`, `y = 77*s`. Full if `health - 2i >= 2`, half if `== 1`.
* Food: same row filled right-to-left from `bar.x + bar.width - 4*s`.
* Oxygen bar `150*s × 6*s` (0.3,0.65,0.95 @0.95) centred at `y = 97*s`, hidden when `air >= 10`.
* Dragon Block: ki bar and stamina bar (xenoversehud.png style) above the hearts; level/TP label; form name.

**Reticle & mining feedback.**
* Crosshair: circle radius `3*s` white @0.55, only when not mining and no modal.
* Mining ring: while `breakProgress > 0`: black @0.35 disc radius `26*s` + filled arc radius `24*s` colour (0.95,0.90,0.50 @0.9) clockwise from 12 o'clock.
* Crack overlay on the targeted block: `crack_0..3`, stage `int(progress*4)`.
* Target outline: wireframe box inflated by 0.004, near-black @0.85 (accessibility: yellow).
* Underwater tint (0.1,0.3,0.6 @0.35) when the eye is in liquid.

**Text overlays.** `Saving...` at `(14*s, height - 30*s)`; FPS at `(14*s, height - 54*s)` when enabled; hint banner centred at `y = 0.68*height` for 5 s. Tutorial hints every 9 s: joystick/look → hold to mine → tap to place → tap bag → charge ki / fly.

**Feedback.** Haptics: 12 ms on place/use, 40 ms on hit, 50 ms on fall damage. Audio: `click` 0.7 UI, 0.5 hotbar, 0.4 inventory slot, `craft` 0.9, `pop` 0.8 pickup, footsteps 0.35.

## 2. Camera
FOV `settings.fov` (default 75, 60–100), near 0.08, far `render_distance*16 + 32`. No positional smoothing lag (snap), but Dragon Block uses a 0.08 s exponential smoothing on distance only.
* FIRST: eye `(x, y + 1.62 / 1.35 crouching, z)`; view bobbing `bobY = sin(walkCycle*6)*0.045`, `bobX = cos(walkCycle*3)*0.025`, `walkCycle += dt*speed*1.6`.
* THIRD_BACK (→ SHOULDER in Dragon Block): `pos = eye - look*dist + right*0.55 + up*0.15`, distance 3.4 (was 4.2 centred).
* THIRD_FRONT: `pos = eye + look*dist`, direction `-look`.
* Collision pull-in: march from 0.4 in 0.25 steps along the camera ray; on the first solid cell use `max(d - 0.3, 0.4)`.
* Sensitivity: first 1.0 (0.3–2.0), third 0.9.

## 3. Bag / crafting / container UI
Full-screen modal; world simulation frozen. Root: centred ScrollPane capped at 0.96 × height, one panel padded `10*s`.
Title: `Pack` / station name / `Storage Crate`.
* Left column, cell `46*s` + `2*s` pad (4-layer stack: bg black @0.35, selection (0.6,0.9,1.0 @0.35), icon, count 0.75):
  optional container grid (5 columns), `Backpack` slots 9–35 (9×3), `Hotbar` 0–8 (9×1), `Discard` (danger) bottom-left.
  Dragon Block: add 4 armor slots + character preview on the left like Minecraft's inventory.png layout, and a 2×2 hand-crafting grid / 3×3 at a crafting table.
* Right column: `Hand crafting`/`Recipes` header, scroll list `300*s` wide max `340*s` high; row = panel-light, 30*s output icon, `"<Name> x<count>"`, dim ingredient line `"<Item> have/need"`, `Craft` button (alpha 0.4 when unaffordable). Empty: “Nothing discovered yet…”. Keep this recipe list (it is touch friendly) *in addition to* the grid.
* Item move semantics: tap source → tap destination. Second tap on the same slot: split half. Empty destination → move; same id → merge to stack size; else swap. `Discard` asks “Discard this stack forever?”.
* `Close` button + Android BACK closes.

## 4. Player physics (reference constants)
AABB 0.6 × 1.8 (1.5 crouching). dt clamp 0.05. Speeds: fly 11 (Dragon Block 12), sprint 5.6, crouch 1.6, walk 4.2; ×0.55 in liquid. Accel: fly 30, ground 42, liquid 16, air 10. Gravity 23, terminal −50, jump 7.4. Liquid: gravity 6, swim-up to 3.4 while jump held, vertical clamp [−3.4, 4]. Ladder ±2.6. Fly vertical ±9 approach 40. Collision per-axis sweeps (Y, X, Z); slabs 0.5; step-up 0.51 only on ground/liquid. Crouch edge guard. Fall damage: `fall > 3.4` → `int((fall - 3.4) * 0.9)` scaled by difficulty (easy ×0.6, hard ×1.4); i-frames 0.6 s. Oxygen 10 s, refill 3/s, drown 2 dmg / 1.5 s. Hunger exhaustion 0.045/s sprinting, 0.012 moving, 0.003 idle; 4.0 → −1 hunger; regen when hunger ≥ 16: +1 HP / 3.5 s; starvation −1 HP / 4 s (min 4). Footstep interval `clamp(2.2/speed, 0.25, 0.6)`.

## 5. Interaction
Reach 4.6. DDA raycast from the eye, skipping air and liquids. Break time `max(hardness / speed, 0.05)`; tool speed by tier (wood 2, stone 4, iron 6, diamond 8, kikono 9, gete 12). Changing target resets progress. Drops need `min_tier` satisfied. Tap order: melee attack entity → talk NPC → open station/container → till → place block. Place rules: target cell replaceable (air/liquid/plant), crops need farmland, plants need soil below, ladder needs a wall, never intersect an entity AABB; consumes 1 item (not in creative). Eating: hold with food selected and hunger < 20, 1.2 s.

## 6. Settings
Audio: Music 0.7, Sounds 1.0, Ambience 0.8. Camera: 1st sens 1.0, 3rd sens 0.9, FOV 75, view bobbing on, vibration on, left-handed off. Display: preset Low/Balanced/High/Custom → render/sim distance 3/2, 5/3, 7/4 (Dragon Block mobile default 5/3, desktop 8/4); UI scale 0.7–1.5; button opacity 0.65; high-contrast outline; show FPS. Autosave 2 min (also on pause / background).

## 7. Menu flow
Boot → Loading (registries → textures → audio → ready) → Main Menu (title, tagline, Play / Settings / How to Play / Credits / Quit, version). World list: cards `name`, `Mode · seed N · last-played · vX`, Play / Rename / Copy / Delete; Create World: name (≤28), seed (numeric or hash), mode, difficulty (Easy / Normal / Hard), keep inventory toggle → Character creation (race, gender, class, colors, hair) → Play. In-world loading bar `progress = 1 - pending/(2R+1)^2` with rotating tips. Pause: Resume / Settings / Save & Quit. Death: “You were defeated…” → Respawn at spawn (Dragon Block: at the last visited master / Kame House), inventory kept unless hard mode.

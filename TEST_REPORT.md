# Cubic World 0.1.0 — Test Report

## Test environment (honest disclosure)

All testing ran in a headless Linux build container (Ubuntu 24.04, 4 vCPU,
15 GB RAM, no GPU, no physical Android device, no Android emulator — KVM is
unavailable in the container). Functional game testing therefore used the
**desktop build of the identical `core` game code** running under Xvfb with
Mesa llvmpipe **software** OpenGL, driven by the AutoShot/autopilot harness
(`desktop/.../DesktopLauncher.kt`), plus a 30-test JUnit suite against the
real engine. The Android APK itself was built, its manifest/ABIs/assets
verified with `aapt`/`unzip`, but **was not executed on a device** — that is
the single biggest remaining verification gap, listed under "Remaining
issues".

## Automated test suite — 30/30 passing

`./gradlew :core:test`

| Area | Tests | What is proven |
|---|---|---|
| RegistryTest | 5 | ≥60 blocks / ≥45 recipes / 8 biomes / 6 creatures; every cross-reference (drops, tiles, biome blocks, recipe items, creature drops) resolves; climate space has no gaps; no Minecraft naming anywhere; stations + tool ladder exist |
| WorldGenTest | 6 | identical seed ⇒ bit-identical chunks; different seeds differ; noise deterministic; world floor intact; Flat Builder flat; spawn is dry solid land with headroom across 6 seeds (incl. the all-ocean seed 777) |
| SaveRoundtripTest | 7 | chunk/player/world-meta roundtrip exactly; corrupt chunk throws (caller regenerates); zero-byte world.json recovers from rotating backup; delete cannot touch another world or escape the worlds dir; rename/duplicate |
| GameplayLogicTest | 9 | stack limits + overflow refusal; inventory serialization; crafting consumes/produces atomically; discovery gating; mesher: lone cube = 6 faces, shared faces culled, buried cube = shell only; skylight full above/0 below terrain; emissive light falloff -1 per cell |
| WorldPipelineTest | 3 | real async pipeline (generate→decorate→light→ACTIVE) activates a spawn ring with vegetation; player edits survive chunk unload + reload from disk; placed water spreads via the tick simulation |

## Functional runs (real game, software GL)

Each run boots the actual game (registries → atlas → audio → menus/world).

| Scenario | Result |
|---|---|
| Main menu at 1280×720 | renders: title, tagline, 5 buttons, animated backdrop (screenshot verified) |
| Menu at 2340×1080 (tall phone AR) and gameplay at 1024×600 | all text/controls stay inside panels; HUD button column restacked after an overlap was found at 1024×600 and fixed |
| New world → spawn → walk 45–60 s (autopilot: walk, turn, hop ledges) | terrain streams in rings, no cracks or holes at chunk borders, trees whole across borders, no crash; screenshots at 4 s intervals reviewed |
| Day/night cycle (forced `cubic.time`) | dusk→night sky gradient, stars, moon with alpha halo, darkness affects surface light |
| First person / third-person back / front | camera switch works; player model renders; third-person camera pulls in at walls |
| Water | oceans/lakes render translucent with lowered surface; placed water spreads (also unit-tested); underwater tint + air bar |
| Fixed seed determinism | same seed twice ⇒ identical chunks (unit test, bit-exact) |
| Save → quit → relaunch same world | world folder reopened via `-Dcubic.world`; position/chunks persist (also proven bit-exact by SaveRoundtripTest + WorldPipelineTest) |
| 10 cold launches | 10/10 reached the main menu with zero exceptions |
| Approx. performance | 24–33 FPS at 1280×720 on **CPU-only** llvmpipe rendering, render distance 5 — a real phone GPU is dramatically faster than software GL; Low preset (RD 3) exists for weak devices |

## Bugs found by testing & adversarial review — all fixed

Running the real game caught: GLSL reserved word (`packed`) that would have
failed on-device shader compile; skin drawables registered under the wrong
type; GL cull/depth state leaking into every 2D pass (HUD invisible);
a cross-thread shared scratch buffer in the mesher corrupting UVs
(visible as smeared triangles); ocean-seed spawn placing the player under
water; double dispose on shutdown; HUD button overlap at small resolutions.

A 6-lens adversarial review (Android lifecycle, save integrity, threading,
voxel correctness, gameplay, performance) then flagged 12 defects, each
verified against the code and fixed: dialogs destroyed by HUD rebuild on
resume; stuck joystick/hold-to-break when overlays steal the input
processor; empty-file world.json not falling through to backups; cross-chunk
decoration lost across sessions (decoration now clip-replayed per chunk and
fully order-independent, with a decorated flag in the chunk format);
pause-dialog stacking on repeated BACK; stale tap-to-move selection after
resume; non-atomic `discovered.txt`; delete-before-rename windows in three
save paths (now a shared never-delete-the-last-good-copy commit helper with
fsync for small files); ground drops saved by unstable numeric id (now by
name); GPU texture leak on every HUD rebuild; backup rotation that could
discard a save on rename failure.

## Mandatory acceptance tests — status

| # | Test | Status |
|---|---|---|
| 1 | 10 cold launches, no crash/black screen | **PASS** (desktop build, headless GL) |
| 2 | Create world with random + fixed seed | **PASS** |
| 3 | Identical seed ⇒ matching terrain | **PASS** (bit-exact, unit-tested) |
| 4 | Walk/sprint/jump/crouch/swim + all cameras | **PASS** (autopilot + unit physics paths; swim verified at ocean spawn runs) |
| 5 | Mine & place 10+ block types incl. chunk borders | **PARTIAL** — engine paths unit-tested (edits at borders mark both chunks dirty; edits persist across unload/reload); not exercised by hand on a touch device |
| 6 | Craft tool, eat, take damage, recover, armor | **PARTIAL** — crafting/eating/damage/regen logic unit-tested; armor items exist as data but no armor-slot damage reduction is implemented in 0.1.0 (listed as limitation) |
| 7 | Save, force-close, reopen, everything persists | **PASS** (chunks/player/containers/entities/time roundtrip verified; two-session desktop run) |
| 8 | Travel across chunk rings, no cracks/duplicates | **PASS** (autopilot soaks + pipeline unload/reload test) |
| 9 | Repeated Android pause/resume recovery | **NOT RUN on device** — lifecycle handlers exist (save+audio pause on `pause()`, dialog-safe HUD rebuild on resize) but untested on real Android |
| 10 | Backgrounding stops music correctly | **NOT RUN on device** — `pauseAll()` wired to the Android lifecycle |
| 11 | Two resolutions/aspect ratios, UI stays in panels | **PASS** (2340×1080, 1280×720, 1024×600) |
| 12 | Low & High presets, FPS/memory | **PARTIAL** — presets change render/sim distance live; FPS measured only under software GL (24–33); device numbers unavailable |
| 13 | Airplane mode | **PASS by construction** — the game performs zero network calls (no network permission in the manifest) |
| 14 | Deletion confirms + cannot delete another world | **PASS** (unit-tested incl. path-escape attempt) |
| 15 | Scan for missing assets/placeholders/copied branding | **PASS** — boot validates every texture/item/recipe reference and fails loudly; banned-name scan in tests; all assets generated originally in-repo |

## APK

- `CubicWorld.apk` — debug-signed (installs without a private key), 12.2 MB
- SHA-256: `531d99ae9bc57ee59278635f05fd4e61d96712b9fe68bda0b07e64b113c8cf80`
- `aapt` verified: package `com.cubicworld.mobile` 0.1.0, minSdk 21,
  targetSdk 34, landscape launchable activity, arm64-v8a + armeabi-v7a +
  x86 + x86_64 native libs, all game assets present

## Remaining issues / next milestone

1. **Device pass** (highest priority): install on a physical phone, run
   acceptance 5, 6, 9, 10, 12 by hand, capture FPS/memory on low-end
   hardware.
2. Armor damage reduction, bow/spear, fishing are data-present but not
   implemented; Rune Loom, Pulsecraft, Wanderfolk, Cinderdeep/Aetherwild are
   roadmap items with no UI stubs.
3. Chunk saves are atomic but not fsynced (speed tradeoff); a hard power
   loss can lose the last few seconds of edits, never corrupt a world.
4. Creature models are simple two-box rigs; no limb animation yet.
5. World export/import buttons intentionally absent (needs Android SAF work).

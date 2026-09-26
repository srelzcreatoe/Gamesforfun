# Dragon Block Sagas

*A Dragon Block C / DragonMineZ inspired voxel action-RPG for Android, built with Godot 4.*

Explore a blocky Earth, Namek, the Otherworld and the DMZ Plus planets (Vegeta, Yardrat, Vampa,
Cereal, Hell, Heaven, deep space), train under the masters, play through the ported DragonMineZ
sagas (Saiyan → Frieza → Androids/Cell → Future → Buu → Movies), collect the dragon balls,
transform, fly and fire ki attacks — from an over-the-shoulder third-person camera with
Minecraft-style touch controls, HUD and inventory.

| Folder | What |
|---|---|
| `game/` | The Godot 4.4 project (GDScript, GL Compatibility renderer, Android export preset) |
| `game/docs/` | Architecture contract, data schema, UI spec, engineer briefs |
| `tools/` | Asset pipeline (`build_assets.py`), sound synthesizer, data converters, build/test wrappers |
| `legacy/cubicworld/` | The previous Kotlin/LibGDX voxel game kept for reference (not built) |

## Build

Requirements: Godot 4.4.1, export templates 4.4.1, Android SDK (build-tools 34, platform-tools),
JDK 17+ (only for `apksigner`), Python 3 + Pillow + NumPy (only to regenerate assets/data).

```bash
tools/build_assets.py           # regenerate game/assets from the source packs (optional)
tools/gen_sounds.py             # regenerate synthesized sounds (optional)
tools/run_tests.sh              # headless unit tests
tools/screenshot.sh out.png --args "--autoplay=1"   # render a frame under Xvfb
tools/export_android.sh         # -> game/build/DragonBlockSagas.apk (debug-signed)
```

### Getting the APK without building

`.github/workflows/android.yml` exports the debug APK on GitHub Actions. It runs on a manual
dispatch, on a `preview-*`/`v*` tag, or on any push whose commit message contains `[apk]`.
Open the run in the **Actions** tab and download the `DragonBlockSagas-<commit>` artifact (a zip
containing the `.apk`); on the phone, allow "install unknown apps" for your browser and open it.

The rest of this file is completed together with the first release (see CHANGELOG.md).

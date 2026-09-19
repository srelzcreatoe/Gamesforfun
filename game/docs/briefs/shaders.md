# Brief: SHADERS & ATMOSPHERE engineer

Read COMMON.md first. Your contract: ARCHITECTURE.md §5; also §4 (chunk vertex layout/uniforms), §13 licensing; DATA_SCHEMA.md planets.json `sky`.
Reference material (READ-ONLY: study the look and maths, then write ORIGINAL shaders — its license forbids reusing code/textures): Complementary
Reimagined r5.9.2 at /tmp/claude-0/-home-user-Gamesforfun/a637a6ef-7708-59b3-aeb2-5b4698448421/scratchpad/ex/shaders/shaders/ — lib/atmospherics/sky.glsl,
stars.glsl, auroraBorealis.glsl, nightNebula.glsl, clouds/*, fog/*, volumetricLight/*, lib/colors/skyColors.glsl, lightAndAmbientColors.glsl,
cloudColors.glsl, lib/materials/specificMaterials/translucents/water.glsl, lib/misc/lensFlare.glsl, program/composite*.fsh, lib/lighting/mainLighting.glsl.
The user wants "realistic skies and water" in that style: soft gradient skies with a bright horizon band, warm saturated sunsets, deep blue nights with
dense stars and a milky way, volumetric-looking clouds, bloom, waving water reflecting the sky colour, refraction, foam edges, caustic sparkle.
Planet sky data: game/data/planets.json (written concurrently; schema `sky` {day, horizon, night, sunset, fog, stars, star_brightness, milky_way,
clouds, aurora, sun_scale, moon, bodies [{texture, scale, kind}]}) and textures in game/assets/textures/environment/ (milky_way.png (CC BY 4.0 ESO),
galaxy.png, sun_surface.png, earth.png, namek.png, vegeta.png, yardrat.png, vampa.png, cereal.png, hell_planet.png, heaven.png, sacred_kai_planet.png,
super_dball_*.png, beacon.png, backlight.png, planet_fireball.png, weather.png (Fused rain/snow strips)).

You own: game/shaders/sky.gdshader, clouds.gdshader, water.gdshader (the voxel engineer writes a first version with vertex layout POSITION/NORMAL/
UV/UV2=(layer,packed_light)/COLOR=(tint,ao) and uniforms `sampler2DArray tiles, float daylight, vec3 sun_color, vec3 fog_color, float fog_start,
float fog_end, float time, vec3 ambient_color` — keep those names and their layer/animation convention (read their header); you may add uniforms),
game/shaders/post_process.gdshader + game/scenes/fx/PostProcess.tscn, game/shaders/lib/*.gdshaderinc (sky_common.gdshaderinc with the shared
`sky_color(dir, sun_dir, ...)` function), game/shaders/weather.gdshader, a polish pass on chunk_opaque/chunk_cutout AFTER the voxel engineer's versions
exist (preserve uniforms/behaviour), game/scripts/world/SkyController.gd, Weather.gd, Clouds.gd, game/scenes/world/SkyPreview.tscn, game/tests/test_sky.gd.

Deliverables:
1. `sky.gdshader` (shader_type sky, gl_compatibility-safe): Rayleigh-like blue zenith to a warm-white horizon band, sun disc (`sun_scale`) with corona
   and large glow turning orange/red near the horizon (`sun_dir`), night deep blue-black with procedural hash stars (density/brightness/twinkle) +
   milky way band from milky_way.png (rotation uniforms, `milky_way` strength), moon with phases, optional aurora curtains (`aurora` planets),
   `bodies` as textured billboards (≤ 6: `body_tex_i`, `body_dir_i`, `body_scale_i`, `body_kind_i` — Vegeta shows a huge red planet, deep space every
   planet), Namek 3 suns (`suns`), per-planet colour overrides, `weather_darkness`. `sky_common.gdshaderinc` exposes the same horizon colour for fog.
2. `clouds.gdshader` + `Clouds.gd`: large cloud plane(s) at y≈140 following the camera in XZ, fbm clouds (≤ 4 octaves) with soft edges, sun-lit tops/
   darker bottoms, sunset tint, coverage from weather (0.3 → 0.9), wind scroll, alpha blend; two-layer parallax trick.
3. `water.gdshader` final: vertex waves (2-3 sines, amplitude ≤ 0.06), animated normals (water frames + ripple noise), Fresnel between refracted scene
   (`hint_screen_texture` with distortion; `fancy_water` uniform to disable on low-end) and reflected sky colour from `sky_color()` + Blinn-Phong sun
   glint, depth-based colour and shore foam via `hint_depth_texture` (if unavailable in compat at runtime fall back to vertex-encoded shore proximity
   and say so), caustic sparkle, underwater look from below, flow scroll from UV2 if encoded, `is_lava` variant. `depth_draw_always`, `cull_disabled`.
4. `post_process.gdshader` + `PostProcess.tscn`: full-screen canvas pass (ACES-like tonemap with exposure by daylight, saturation/vibrance, vignette,
   optional chromatic aberration, underwater wobble, cheap radial god rays from `sun_screen_pos` ≤ 12 samples); bloom via `Environment.glow` (compat
   supports it — verify on llvmpipe screenshots); toggles from `Game.settings` (bloom, fancy_water, clouds, quality_preset).
5. `SkyController.gd` (Node used by the World): `apply(planet_def, time_ticks, weather, delta)` sets sky uniforms (sun from time: 0 sunrise east, 6000
   noon, 12000 sunset west; moon opposite; Namek barely-night), DirectionalLight3D energy/colour/rotation, ambient (sky-based), compat depth fog
   (`fog_light_color` = horizon, density per planet/weather), glow, tonemap, exposure; exposes `daylight()`, `sun_color()`, `fog_color()`,
   `ambient_color()` (the World pushes them into chunk/water materials); `Weather.gd` state machine clear → overcast → rain/snow (by biome temperature)
   → thunder (Events.screen_flash + thunder + sky brightening), cloud coverage + `weather_darkness`, rain/snow sheets around the camera with
   `weather.gdshader` (environment/weather.png strips), Events.weather_changed.
6. `SkyPreview.tscn`: WorldEnvironment with your sky, clouds, a big water plane (water.gdshader) over a checker quad + cubes, DirectionalLight3D; args
   `--planet=earth --time=6000 --weather=rain --bench`. Screenshots and LOOK: noon, sunset (t=11500), night (t=18000: stars, milky way, moon glint),
   rain, Namek (green tint, 3 suns), Vegeta (red planet), deep space, heaven (pastel, aurora), hell (red haze). Iterate until convincing.
7. Performance: `--bench` prints average frame ms over 3 s; sky ≤ 2 ms equivalent; `quality` uniform tiers 0/1/2 from `Game.settings.quality_preset`.
8. Tests: SkyController sun direction/daylight at key times, fog colour changes with weather, planet overrides applied.

Compile check must include the screenshot tool (real GL context) and its stderr for "SHADER ERROR". Report which ideas came from the reference and how
yours differs (must be original), timings, uniform names the World must set.

// sky_common.gdshaderinc - shared atmosphere maths for sky.gdshader, water.gdshader and clouds.gdshader.
//
// Original work for Dragon Block Sagas. The *look* (bright horizon band, warm saturated dusk, deep blue
// night, big soft sun glow) is inspired by Complementary Reimagined; none of its code is reused.
// All colours are LINEAR (SkyController converts the planets.json sRGB hex values before uploading).
//
// Public functions:
//   vec3  sky_color(dir, sun_dir, day, horizon, night, sunset, weather)  atmosphere colour for a direction
//   vec3  sky_color_min(..., weather, min_day)   same with a daylight floor (Namek/heaven "barely night")
//   vec3  sky_sun_glow(dir, sun_dir, sunset, weather, min_day)  cheap glow for extra suns (Namek)
//   vec3  sky_horizon_color(sun_dir, day, horizon, night, sunset, weather) average horizon = fog colour
//   float sky_daylight(sun_y)     0 (deep night) .. 1 (day), same curve as SkyController.daylight()
//   float sky_dusk(sun_y)         0 .. 1, peaks while the sun sits on the horizon
//   float sc_hash12 / sc_noise / sc_fbm  cheap value noise helpers (2-D)
//   vec3  sc_apply_fog(col, fog_col, dist, start, end)   distance fog identical to the chunk shaders
//   float sc_depth_distance(raw_depth, near, far)        reverse-Z depth buffer -> metres (compat)
//   float sc_noise_d(p, out grad)  value noise + analytic gradient (cheap bump mapping)
//   vec2  sc_noise_grad / float sc_luma / vec3 sc_sun_tint

#ifndef SKY_COMMON_INC
#define SKY_COMMON_INC

const float SC_PI = 3.14159265359;
const float SC_TAU = 6.28318530718;

float sc_hash12(vec2 p) {
	vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
	q += dot(q, q.yzx + 33.33);
	return fract((q.x + q.y) * q.z);
}

float sc_hash13(vec3 p) {
	p = fract(p * vec3(0.1031, 0.1030, 0.0973));
	p += dot(p, p.yxz + 33.33);
	return fract((p.x + p.y) * p.z);
}

vec3 sc_hash33(vec3 p) {
	p = fract(p * vec3(0.1031, 0.1030, 0.0973));
	p += dot(p, p.yxz + 33.33);
	return fract((p.xxy + p.yxx) * p.zyx);
}

// Smooth value noise, 0..1.
float sc_noise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	vec2 u = f * f * (3.0 - 2.0 * f);
	float a = sc_hash12(i);
	float b = sc_hash12(i + vec2(1.0, 0.0));
	float c = sc_hash12(i + vec2(0.0, 1.0));
	float d = sc_hash12(i + vec2(1.0, 1.0));
	return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Fractional brownian motion, `octaves` in 1..4 (clamped), result roughly 0..1.
float sc_fbm(vec2 p, int octaves) {
	float v = 0.0;
	float amp = 0.5;
	float total = 0.0;
	mat2 rot = mat2(vec2(0.8, 0.6), vec2(-0.6, 0.8)) * 2.03;
	for (int i = 0; i < 4; i++) {
		if (i >= octaves) {
			break;
		}
		v += sc_noise(p) * amp;
		total += amp;
		p = rot * p + vec2(17.3, 9.1);
		amp *= 0.5;
	}
	return v / max(total, 0.0001);
}

float sky_daylight(float sun_y) {
	return smoothstep(-0.10, 0.20, sun_y);
}

// 1.0 while the sun hugs the horizon, 0 well above (0.42) or well below (-0.22) it.
float sky_dusk(float sun_y) {
	return (1.0 - smoothstep(0.06, 0.42, sun_y)) * smoothstep(-0.22, -0.03, sun_y);
}

// Henyey-Greenstein style forward-scatter lobe (standard phase function, normalised to 1 at mu = 1).
float sky_phase(float mu, float g) {
	float g2 = g * g;
	float d = 1.0 + g2 - 2.0 * g * mu;
	return ((1.0 - g2) / pow(max(d, 0.0001), 1.5)) * ((1.0 - g) * (1.0 - g) / (1.0 + g2 - 2.0 * g));
}

// Colour of the atmosphere in direction `dir` (no sun disc, no stars; those are sky.gdshader only).
// weather: 0 clear .. 1 thunderstorm (grey, dark).
vec3 sky_color_min(vec3 dir, vec3 sun_dir, vec3 day_col, vec3 horizon_col, vec3 night_col, vec3 sunset_col, float weather, float min_day) {
	float up = dir.y;
	float upc = clamp(up, 0.0, 1.0);
	float sun_y = sun_dir.y;
	// min_day keeps "barely night" planets (Namek, heaven, otherworld) lit after sundown
	float day = max(sky_daylight(sun_y), min_day);
	float dusk = sky_dusk(sun_y);
	float mu = dot(dir, sun_dir);
	float mu_pos = max(mu, 0.0);
	float toward_sun = mu * 0.5 + 0.5;

	// --- day gradient: deep zenith -> luminous horizon band ---
	float mid_w = pow(1.0 - upc, 1.7);          // broad falloff toward the horizon
	float band_w = pow(1.0 - upc, 6.0);         // narrow bright band right at the horizon
	vec3 sky = mix(day_col, horizon_col, clamp(mid_w * 0.55 + band_w * 0.5, 0.0, 1.0));
	// Rayleigh-ish: the horizon band is brighter and warmer on the sun's side, cooler opposite it.
	sky *= 1.0 + 0.18 * mid_w * (toward_sun * toward_sun * 2.0 - 0.5);
	// The zenith deepens at dusk before night takes over.
	sky *= mix(vec3(1.0), vec3(0.62, 0.52, 0.72), dusk * (1.0 - mid_w) * 0.8);

	// --- sunset: warm saturated band, strongest toward the sun and right on the horizon ---
	float sunset_w = dusk * pow(1.0 - abs(up), 2.2) * (0.25 + 0.75 * toward_sun * toward_sun);
	vec3 sunset_glow = sunset_col * (1.0 + 0.6 * pow(mu_pos, 4.0));
	sky = mix(sky, sunset_glow, clamp(sunset_w, 0.0, 1.0));

	// --- night ---
	vec3 night = night_col * (1.0 + 1.4 * mid_w + 0.6 * band_w);

	vec3 col = mix(night, sky, day);

	// --- sun glow: wide Mie lobe + tighter halo, warmer and larger when the sun is low ---
	float lobe = sky_phase(mu, 0.72) * 0.032 + pow(mu_pos, 48.0) * 0.22;
	vec3 glow_col = mix(vec3(1.0, 0.92, 0.78), sunset_col * 1.35, dusk);
	col += glow_col * lobe * (0.55 + 0.95 * dusk) * day * smoothstep(-0.55, -0.15, up);

	// --- below the horizon: the "ground" of the sky dome fades to a muted horizon ---
	float ground = smoothstep(0.02, -0.25, up);
	col = mix(col, col * vec3(0.55, 0.58, 0.64), ground);

	// --- weather: desaturate and darken, keep a faint cool cast ---
	float lum = dot(col, vec3(0.30, 0.59, 0.11));
	col = mix(col, vec3(lum) * vec3(0.90, 0.95, 1.05), weather * 0.75);
	col *= 1.0 - 0.6 * weather;
	return col;
}

// Just the scattering glow around a light source: what a *secondary* sun adds to the sky.
// Much cheaper than a whole sky_color() evaluation, which is what Namek's three suns would cost.
vec3 sky_sun_glow(vec3 dir, vec3 sun_dir, vec3 sunset_col, float weather, float min_day) {
	float day = max(sky_daylight(sun_dir.y), min_day);
	float dusk = sky_dusk(sun_dir.y);
	float mu = dot(dir, sun_dir);
	float lobe = sky_phase(mu, 0.70) * 0.030 + pow(max(mu, 0.0), 40.0) * 0.20;
	vec3 glow_col = mix(vec3(1.0, 0.93, 0.80), sunset_col * 1.35, dusk);
	return glow_col * lobe * (0.55 + 0.9 * dusk) * day * (1.0 - 0.7 * weather)
			* smoothstep(-0.5, -0.1, dir.y);
}

// Same, with no daylight floor (the common case).
vec3 sky_color(vec3 dir, vec3 sun_dir, vec3 day_col, vec3 horizon_col, vec3 night_col, vec3 sunset_col, float weather) {
	return sky_color_min(dir, sun_dir, day_col, horizon_col, night_col, sunset_col, weather, 0.0);
}

// Fog colour: horizon colour averaged over the compass so the fog does not flip when you turn.
vec3 sky_horizon_color(vec3 sun_dir, vec3 day_col, vec3 horizon_col, vec3 night_col, vec3 sunset_col, float weather) {
	vec3 flat_sun = normalize(vec3(sun_dir.x, 0.0, sun_dir.z) + vec3(0.001, 0.0, 0.0));
	vec3 side = vec3(-flat_sun.z, 0.0, flat_sun.x);
	vec3 h = vec3(0.0, 0.03, 0.0);
	vec3 a = sky_color(normalize(flat_sun + h), sun_dir, day_col, horizon_col, night_col, sunset_col, weather);
	vec3 b = sky_color(normalize(-flat_sun + h), sun_dir, day_col, horizon_col, night_col, sunset_col, weather);
	vec3 c = sky_color(normalize(side + h), sun_dir, day_col, horizon_col, night_col, sunset_col, weather);
	return a * 0.35 + b * 0.25 + c * 0.4;
}

// --- helpers shared with water/clouds/weather/post ---------------------------------------------

float sc_luma(vec3 c) {
	return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

// Value noise plus its analytic gradient in one go: four hashes instead of the twelve that
// central differences would need. Used for the water ripple normals.
float sc_noise_d(vec2 p, out vec2 grad) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	vec2 u = f * f * (3.0 - 2.0 * f);
	vec2 du = 6.0 * f * (1.0 - f);
	float a = sc_hash12(i);
	float b = sc_hash12(i + vec2(1.0, 0.0));
	float c = sc_hash12(i + vec2(0.0, 1.0));
	float d = sc_hash12(i + vec2(1.0, 1.0));
	float k1 = b - a;
	float k2 = c - a;
	float k3 = a - b - c + d;
	grad = du * vec2(k1 + k3 * u.y, k2 + k3 * u.x);
	return a + k1 * u.x + k2 * u.y + k3 * u.x * u.y;
}

// Gradient of sc_noise by central differences (kept for callers that want a specific epsilon).
vec2 sc_noise_grad(vec2 p, float eps) {
	float nx = sc_noise(p + vec2(eps, 0.0)) - sc_noise(p - vec2(eps, 0.0));
	float ny = sc_noise(p + vec2(0.0, eps)) - sc_noise(p - vec2(0.0, eps));
	return vec2(nx, ny) / (2.0 * eps);
}

// Cheap linear distance fog toward `fog_col` between `start` and `end` (matches the chunk shaders).
vec3 sc_apply_fog(vec3 col, vec3 fog_col, float dist, float start, float end) {
	float f = clamp((dist - start) / max(end - start, 0.001), 0.0, 1.0);
	return mix(col, fog_col, f * f * (3.0 - 2.0 * f));
}

// Sun/moon tint of direct light for a sun height (mirrors SkyController._update_colors()).
vec3 sc_sun_tint(vec3 base, float sun_y) {
	float low = smoothstep(0.35, -0.05, sun_y);
	return mix(base, vec3(1.0, 0.5, 0.2), low * 0.85);
}

// Reverse-Z depth buffer (Godot 4.4 gl_compatibility) -> distance along the view ray, in metres.
// `near` is the camera near plane; a depth of 0 (nothing drawn / sky) returns `far_fallback`.
float sc_depth_distance(float raw_depth, float near, float far_fallback) {
	if (raw_depth <= 0.000001) {
		return far_fallback;
	}
	return min(near / raw_depth, far_fallback);
}

#endif // SKY_COMMON_INC

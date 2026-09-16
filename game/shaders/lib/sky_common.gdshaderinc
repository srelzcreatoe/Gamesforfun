// sky_common.gdshaderinc - shared atmosphere maths for sky.gdshader, water.gdshader and clouds.gdshader.
//
// Original work for Dragon Block Sagas. The *look* (bright horizon band, warm saturated dusk, deep blue
// night, big soft sun glow) is inspired by Complementary Reimagined; none of its code is reused.
// All colours are LINEAR (SkyController converts the planets.json sRGB hex values before uploading).
//
// Public functions:
//   vec3  sky_color(dir, sun_dir, day, horizon, night, sunset, weather)  atmosphere colour for a direction
//   vec3  sky_horizon_color(sun_dir, day, horizon, night, sunset, weather) average horizon = fog colour
//   float sky_daylight(sun_y)     0 (deep night) .. 1 (day), same curve as SkyController.daylight()
//   float sky_dusk(sun_y)         0 .. 1, peaks while the sun sits on the horizon
//   float sc_hash12 / sc_noise / sc_fbm  cheap value noise helpers (2-D)

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
vec3 sky_color(vec3 dir, vec3 sun_dir, vec3 day_col, vec3 horizon_col, vec3 night_col, vec3 sunset_col, float weather) {
	float up = dir.y;
	float upc = clamp(up, 0.0, 1.0);
	float sun_y = sun_dir.y;
	float day = sky_daylight(sun_y);
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
	float lobe = sky_phase(mu, 0.72) * 0.045 + pow(mu_pos, 48.0) * 0.30;
	vec3 glow_col = mix(vec3(1.0, 0.92, 0.78), sunset_col * 1.6, dusk);
	col += glow_col * lobe * (0.6 + 1.6 * dusk) * day * smoothstep(-0.55, -0.15, up);

	// --- below the horizon: the "ground" of the sky dome fades to a muted horizon ---
	float ground = smoothstep(0.02, -0.25, up);
	col = mix(col, col * vec3(0.55, 0.58, 0.64), ground);

	// --- weather: desaturate and darken, keep a faint cool cast ---
	float lum = dot(col, vec3(0.30, 0.59, 0.11));
	col = mix(col, vec3(lum) * vec3(0.90, 0.95, 1.05), weather * 0.75);
	col *= 1.0 - 0.6 * weather;
	return col;
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

#endif // SKY_COMMON_INC

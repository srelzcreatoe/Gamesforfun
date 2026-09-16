// sky.gdshader - procedural planet sky for Dragon Block Sagas (shader_type sky, gl_compatibility safe).
//
// Original work; the look follows the "soft gradient + bright horizon band + big warm sun glow" style of
// Complementary Reimagined but every formula here is ours. Driven by scripts/world/SkyController.gd.
//
// Uniforms the controller sets every frame: sun_dir, sun_color, moon_dir, moon_phase, weather_darkness, time,
// sun_dir_b / sun_dir_c (Namek), milky_way_basis. Per-planet constants: colours, stars, aurora, bodies, suns.
// quality: 0 = phones/low (no aurora, no milky way, plain stars), 1 = balanced, 2 = high.

shader_type sky;
render_mode use_debanding;

#include "res://shaders/lib/sky_common.gdshaderinc"

// ---- atmosphere (linear colours) ----
uniform vec3 day_color : source_color = vec3(0.21, 0.42, 1.0);
uniform vec3 horizon_color : source_color = vec3(0.62, 0.78, 1.0);
uniform vec3 night_color : source_color = vec3(0.0015, 0.0025, 0.012);
uniform vec3 sunset_color : source_color = vec3(1.0, 0.26, 0.04);
uniform float atmosphere = 1.0;          // 0 = airless (deep space)
uniform float weather_darkness = 0.0;    // 0 clear .. 1 thunderstorm
uniform int quality = 2;
uniform float time = 0.0;

// ---- sun(s) ----
uniform vec3 sun_dir = vec3(0.0, 0.7, 0.7);
uniform vec3 sun_color : source_color = vec3(1.0, 0.93, 0.82);
uniform float sun_scale = 1.0;           // 0 hides the disc (time chamber)
uniform float sun_glow = 1.0;
uniform int suns = 1;                    // Namek = 3
uniform vec3 sun_dir_b = vec3(0.6, 0.5, 0.6);
uniform vec3 sun_dir_c = vec3(-0.6, 0.3, 0.7);

// ---- moon ----
uniform float moon_enabled = 1.0;
uniform vec3 moon_dir = vec3(0.0, -0.7, -0.7);
uniform float moon_phase = 0.0;          // 0 = full, 0.5 = new, 1 = full
uniform float moon_scale = 1.0;
uniform vec3 moon_color : source_color = vec3(0.86, 0.9, 1.0);

// ---- stars / milky way ----
uniform float star_density = 0.05;       // probability a sky cell holds a star (SkyController maps `stars` count)
uniform float star_brightness = 0.6;
uniform float milky_way_strength = 0.3;
uniform sampler2D milky_way_tex : source_color, filter_linear_mipmap, repeat_enable;
uniform mat3 milky_way_basis = mat3(1.0);

// ---- aurora ----
uniform float aurora_strength = 0.0;
uniform vec3 aurora_color_a : source_color = vec3(0.05, 1.0, 0.35);
uniform vec3 aurora_color_b : source_color = vec3(0.55, 0.12, 1.0);

// ---- bodies (planets / stars / galaxies drawn as textured billboards) ----
// kind: 0 planet (square tile masked to a shaded sphere), 1 star (emissive + corona), 2 galaxy/sprite (additive rgba),
//       3 moon-like (shaded sphere, grey), 4 flat sprite (alpha blended, no shading)
uniform int body_count = 0;
uniform sampler2D body_tex_0 : source_color, filter_nearest;
uniform sampler2D body_tex_1 : source_color, filter_nearest;
uniform sampler2D body_tex_2 : source_color, filter_nearest;
uniform sampler2D body_tex_3 : source_color, filter_nearest;
uniform sampler2D body_tex_4 : source_color, filter_nearest;
uniform sampler2D body_tex_5 : source_color, filter_nearest;
uniform vec3 body_dir_0 = vec3(0.0, 1.0, 0.0);
uniform vec3 body_dir_1 = vec3(0.0, 1.0, 0.0);
uniform vec3 body_dir_2 = vec3(0.0, 1.0, 0.0);
uniform vec3 body_dir_3 = vec3(0.0, 1.0, 0.0);
uniform vec3 body_dir_4 = vec3(0.0, 1.0, 0.0);
uniform vec3 body_dir_5 = vec3(0.0, 1.0, 0.0);
uniform float body_scale_0 = 0.1;
uniform float body_scale_1 = 0.1;
uniform float body_scale_2 = 0.1;
uniform float body_scale_3 = 0.1;
uniform float body_scale_4 = 0.1;
uniform float body_scale_5 = 0.1;
uniform int body_kind_0 = 0;
uniform int body_kind_1 = 0;
uniform int body_kind_2 = 0;
uniform int body_kind_3 = 0;
uniform int body_kind_4 = 0;
uniform int body_kind_5 = 0;

// Tangent frame around a sky direction so a billboard can be sampled with 2-D coordinates.
void sky_frame(vec3 d, out vec3 right, out vec3 upv) {
	vec3 ref = abs(d.y) > 0.98 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
	right = normalize(cross(ref, d));
	upv = cross(d, right);
}

// --- sun disc + corona + wide glow; reddens and dims near the horizon ---
vec3 sun_disc(vec3 dir, vec3 sdir, float scale, vec3 scol, float weather) {
	float cosang = dot(dir, sdir);
	if (cosang < 0.6 || scale <= 0.0) {
		return vec3(0.0);
	}
	float ang = acos(clamp(cosang, -1.0, 1.0));
	float r = 0.032 * scale;
	float disc = 1.0 - smoothstep(r * 0.88, r * 1.04, ang);
	float corona = exp(-max(ang - r * 0.9, 0.0) / (r * 0.9));
	float halo = exp(-ang / (r * 7.0));
	// atmospheric extinction: orange/red and weaker when the sun sits low
	float ext = smoothstep(0.30, -0.06, sdir.y);
	vec3 tint = mix(vec3(1.0), vec3(1.0, 0.42, 0.12), ext);
	float energy = mix(1.0, 0.45, ext) * (1.0 - 0.9 * weather);
	vec3 c = scol * tint * (disc * 6.0 + corona * 1.8 + halo * 0.6);
	// hidden once it dips below the dome's ground
	c *= smoothstep(-0.06, 0.0, dir.y + 0.02);
	return c * energy;
}

// --- moon with phases: a shaded sphere lit from a direction that rotates with the phase ---
vec3 moon_disc(vec3 dir, vec3 mdir, float phase, float scale, vec3 mcol, float night, out float cover) {
	cover = 0.0;
	float cosang = dot(dir, mdir);
	if (cosang < 0.9 || scale <= 0.0) {
		return vec3(0.0);
	}
	vec3 right;
	vec3 upv;
	sky_frame(mdir, right, upv);
	float r = 0.04 * scale;
	vec2 uv = vec2(dot(dir, right), dot(dir, upv)) / r;
	float rr = dot(uv, uv);
	vec3 col = vec3(0.0);
	float a = phase * SC_TAU;
	vec3 light = vec3(sin(a), 0.15, cos(a));
	float lit_amount = cos(a) * 0.5 + 0.5;
	if (rr < 1.0) {
		vec3 n = vec3(uv, sqrt(1.0 - rr));
		float lambert = smoothstep(-0.12, 0.30, dot(n, normalize(light)));
		float maria = 0.72 + 0.28 * sc_noise(uv * 3.5 + 11.0) * sc_noise(uv * 7.0 - 3.0);
		float edge = 1.0 - smoothstep(0.88, 1.0, rr);
		col = mcol * maria * (lambert * 1.6 + 0.03) * edge;
		cover = edge;
	}
	float ang = acos(clamp(cosang, -1.0, 1.0));
	col += mcol * exp(-ang / (r * 5.0)) * 0.12 * lit_amount * night;
	return col * smoothstep(-0.04, 0.02, dir.y);
}

// --- procedural stars on a 3-D lattice (no pole distortion) ---
vec3 star_field(vec3 dir, float density, float brightness, float t) {
	float cells = 52.0;
	vec3 p = dir * cells;
	vec3 cell = floor(p);
	float h = sc_hash13(cell);
	if (h > density) {
		return vec3(0.0);
	}
	vec3 rnd = sc_hash33(cell + 7.7);
	vec3 sp = cell + 0.18 + 0.64 * rnd;
	float d = length(p - sp);
	float mag = rnd.x * rnd.x;                          // a few bright stars, many faint
	float radius = 0.055 + 0.09 * mag;
	float s = smoothstep(radius, 0.0, d);
	s *= s;
	float twinkle = 0.75 + 0.25 * sin(t * (2.0 + 4.0 * rnd.y) + rnd.z * 40.0);
	vec3 tint = mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.9, 0.75), rnd.y);
	return tint * s * (0.25 + 1.6 * mag) * brightness * twinkle * 2.2;
}

// --- milky way from an equirectangular panorama (ESO, CC BY 4.0) ---
vec3 milky_way(vec3 dir, float strength) {
	vec3 d = normalize(milky_way_basis * dir);
	vec2 uv = vec2(atan(d.z, d.x) / SC_TAU + 0.5, acos(clamp(d.y, -1.0, 1.0)) / SC_PI);
	float lod = quality >= 2 ? 0.0 : 1.0;   // fixed lod: no seam at the atan discontinuity
	vec3 mw = textureLod(milky_way_tex, uv, lod).rgb;
	return mw * strength * 1.6;
}

// --- aurora: stacked translucent curtains projected onto planes at growing "altitudes" ---
vec3 aurora(vec3 dir, float t, float strength) {
	if (dir.y < 0.06 || strength <= 0.0) {
		return vec3(0.0);
	}
	vec3 acc = vec3(0.0);
	int layers = quality >= 2 ? 6 : 4;
	for (int i = 0; i < 6; i++) {
		if (i >= layers) {
			break;
		}
		float fi = float(i);
		float alt = 1.0 + fi * 0.28;
		vec2 p = dir.xz / (dir.y + 0.18) * alt;
		// long ribbons along x, thin along z
		float ribbon = sc_noise(vec2(p.x * 0.55 + t * 0.015 + fi * 3.1, p.y * 1.9 + fi * 7.3 - t * 0.01));
		ribbon = pow(smoothstep(0.38, 0.72, ribbon), 1.6);
		// vertical rays: fine noise along the ribbon
		float rays = 0.55 + 0.45 * sc_noise(vec2(p.x * 6.0 + t * 0.12, fi * 2.0 + p.y * 0.4));
		float fade = 1.0 - fi / float(layers);
		vec3 c = mix(aurora_color_a, aurora_color_b, fi / float(layers - 1));
		acc += c * ribbon * rays * fade;
	}
	acc /= float(layers) * 0.55;
	float visible = smoothstep(0.06, 0.28, dir.y) * (1.0 - 0.35 * dir.y);
	return acc * strength * visible;
}

// --- a textured celestial body ---
vec3 body(vec3 dir, sampler2D tex, vec3 bdir, float scale, int kind, vec3 light_dir, out float cover) {
	cover = 0.0;
	float cosang = dot(dir, bdir);
	if (cosang < 0.3 || scale <= 0.0) {
		return vec3(0.0);
	}
	vec3 right;
	vec3 upv;
	sky_frame(bdir, right, upv);
	// gnomonic projection keeps big bodies round instead of stretched
	vec3 q = dir / max(cosang, 0.001);
	vec2 uv = vec2(dot(q, right), dot(q, upv)) / scale;
	float rr = dot(uv, uv);
	float ang = acos(clamp(cosang, -1.0, 1.0));
	vec3 col = vec3(0.0);
	if (kind == 2 || kind == 4) {
		if (abs(uv.x) < 1.0 && abs(uv.y) < 1.0) {
			vec4 s = texture(tex, uv * 0.5 + 0.5);
			if (kind == 2) {
				col = s.rgb * s.a * vec3(0.9, 0.92, 1.1) * 1.4;
				cover = s.a * 0.6;
			} else {
				col = s.rgb * s.a;
				cover = s.a;
			}
		}
		return col;
	}
	if (kind == 1) {
		float disc = 1.0 - smoothstep(0.85, 1.0, rr);
		vec3 s = texture(tex, uv * 0.5 + 0.5).rgb;
		col = s * disc * 5.0 + s * exp(-ang / (scale * 2.5)) * 1.2;
		cover = disc;
		return col;
	}
	// kind 0 / 3: shaded sphere
	if (rr < 1.0) {
		vec3 n = vec3(uv, sqrt(1.0 - rr));
		vec3 l = vec3(dot(light_dir, right), dot(light_dir, upv), dot(light_dir, -bdir));
		float ndl = dot(n, normalize(l + vec3(0.0, 0.0, 0.25)));
		float lambert = smoothstep(-0.18, 0.35, ndl);
		vec3 s = texture(tex, uv * 0.5 + 0.5).rgb;
		if (kind == 3) {
			s = vec3(dot(s, vec3(0.33)));
		}
		float rim = pow(rr, 5.0);
		float edge = 1.0 - smoothstep(0.94, 1.0, rr);
		vec3 atmo = kind == 0 ? mix(s, vec3(1.0), 0.6) : s;
		col = (s * (lambert * 1.15 + 0.04) + atmo * rim * lambert * 0.7) * edge;
		cover = edge;
	}
	return col;
}

void sky() {
	vec3 dir = normalize(EYEDIR);
	float night = 1.0 - sky_daylight(sun_dir.y);
	float has_air = step(0.5, atmosphere);
	vec3 col;
	if (has_air > 0.5) {
		col = sky_color(dir, sun_dir, day_color, horizon_color, night_color, sunset_color, weather_darkness);
		if (suns >= 2) {
			col += sky_color(dir, sun_dir_b, day_color, horizon_color, night_color, sunset_color, weather_darkness) * 0.35;
		}
		if (suns >= 3) {
			col += sky_color(dir, sun_dir_c, day_color, horizon_color, night_color, sunset_color, weather_darkness) * 0.25;
		}
	} else {
		col = night_color * 0.6;
		night = 1.0;
	}

	// The radiance cubemap only needs the broad colours (ambient light); skip the detail there.
	if (!AT_CUBEMAP_PASS) {
		float star_vis = mix(1.0, night * night * (1.0 - weather_darkness), has_air);
		float cover = 0.0;
		vec3 detail = vec3(0.0);

		// bodies first so they can occlude stars
		float c = 0.0;
		if (body_count > 0) { detail += body(dir, body_tex_0, body_dir_0, body_scale_0, body_kind_0, sun_dir, c); cover = max(cover, c); }
		if (body_count > 1) { detail += body(dir, body_tex_1, body_dir_1, body_scale_1, body_kind_1, sun_dir, c); cover = max(cover, c); }
		if (body_count > 2) { detail += body(dir, body_tex_2, body_dir_2, body_scale_2, body_kind_2, sun_dir, c); cover = max(cover, c); }
		if (body_count > 3) { detail += body(dir, body_tex_3, body_dir_3, body_scale_3, body_kind_3, sun_dir, c); cover = max(cover, c); }
		if (body_count > 4) { detail += body(dir, body_tex_4, body_dir_4, body_scale_4, body_kind_4, sun_dir, c); cover = max(cover, c); }
		if (body_count > 5) { detail += body(dir, body_tex_5, body_dir_5, body_scale_5, body_kind_5, sun_dir, c); cover = max(cover, c); }

		if (moon_enabled > 0.5) {
			float mc = 0.0;
			detail += moon_disc(dir, moon_dir, moon_phase, moon_scale, moon_color, night, mc) * (1.0 - 0.75 * weather_darkness);
			cover = max(cover, mc);
		}

		if (star_vis > 0.002 && (dir.y > -0.03 || has_air < 0.5)) {
			vec3 stars = star_field(dir, star_density, star_brightness, time);
			if (quality >= 1 && milky_way_strength > 0.0) {
				stars += milky_way(dir, milky_way_strength);
			}
			// twilight fade near the horizon band
			float horizon_fade = mix(1.0, smoothstep(-0.03, 0.25, dir.y), has_air);
			detail += stars * star_vis * horizon_fade * (1.0 - cover);
		}

		if (quality >= 1 && aurora_strength > 0.0 && has_air > 0.5) {
			detail += aurora(dir, time, aurora_strength) * night * (1.0 - weather_darkness);
		}

		// suns on top
		if (has_air > 0.5 || sun_scale > 0.0) {
			detail += sun_disc(dir, sun_dir, sun_scale, sun_color, weather_darkness) * sun_glow;
			if (suns >= 2) {
				detail += sun_disc(dir, sun_dir_b, sun_scale * 0.8, sun_color, weather_darkness) * sun_glow;
			}
			if (suns >= 3) {
				detail += sun_disc(dir, sun_dir_c, sun_scale * 0.65, sun_color, weather_darkness) * sun_glow;
			}
		}
		col += detail;
	} else {
		// keep some sun energy in the ambient cubemap
		col += sun_color * pow(max(dot(dir, sun_dir), 0.0), 16.0) * 0.4 * (1.0 - night) * has_air;
	}

	COLOR = max(col, vec3(0.0));
}

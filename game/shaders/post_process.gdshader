// post_process.gdshader - full screen finishing pass (scenes/fx/PostProcess.tscn).
//
// Runs as a canvas_item shader on a full-rect ColorRect above the 3D viewport, so it works on the
// gl_compatibility renderer where there is no post-process stack. Bloom itself is NOT done here:
// Environment.glow does it (compat supports glow) - this pass does tonemapping, grade, vignette,
// chromatic aberration, the underwater look, the screen flash and cheap radial god rays.
//
// Uniforms SkyController pushes every frame: exposure, sun_screen_pos, sun_visible, sun_color,
// god_rays, underwater, underwater_tint, time, flash, quality.
//
// Original work; the god-ray idea (march toward the sun in screen space, keep the bright parts) and
// the "grade after tonemap" ordering are the classic ones also used by Complementary Reimagined's
// composite passes, but this is a from-scratch 12-tap implementation.

shader_type canvas_item;
render_mode unshaded;

uniform sampler2D screen_tex : hint_screen_texture, repeat_disable, filter_linear;

uniform float exposure : hint_range(0.2, 3.0) = 1.0;
uniform float saturation : hint_range(0.0, 2.0) = 1.08;
uniform float vibrance : hint_range(0.0, 1.0) = 0.18;
uniform float vignette : hint_range(0.0, 1.0) = 0.32;
uniform float aberration : hint_range(0.0, 4.0) = 0.6;
uniform float contrast : hint_range(0.5, 1.5) = 1.02;

uniform float underwater = 0.0;
uniform vec3 underwater_tint : source_color = vec3(0.06, 0.22, 0.55);
uniform float time = 0.0;
uniform float flash = 0.0;
uniform int quality : hint_range(0, 2) = 2;
uniform int gamma_correct : hint_range(0, 1) = 1;

uniform vec2 sun_screen_pos = vec2(0.5, 0.5);
uniform float sun_visible = 0.0;
uniform vec3 sun_color : source_color = vec3(1.0, 0.93, 0.82);
uniform float god_rays : hint_range(0.0, 1.5) = 0.45;

// Filmic curve in the ACES spirit (Narkowicz-style rational fit, tuned a little brighter in the
// mid-tones so voxel colours stay readable on a phone in daylight).
vec3 tonemap(vec3 x) {
	x *= 0.85;
	vec3 a = x * (2.35 * x + 0.06);
	vec3 b = x * (2.30 * x + 0.62) + 0.14;
	return clamp(a / b, vec3(0.0), vec3(1.0));
}

float luma(vec3 c) {
	return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

void fragment() {
	vec2 uv = SCREEN_UV;
	vec2 centred = uv - vec2(0.5);

	// --- underwater wobble -----------------------------------------------------------------
	if (underwater > 0.5) {
		uv += vec2(
			sin(uv.y * 34.0 + time * 1.9) * 0.0035,
			cos(uv.x * 28.0 - time * 1.5) * 0.0030);
		uv = clamp(uv, vec2(0.0005), vec2(0.9995));
	}

	// --- chromatic aberration (radial, red/blue split) --------------------------------------
	vec3 col;
	float ab = aberration * (quality >= 1 ? 1.0 : 0.0) * (1.0 + 2.0 * underwater);
	if (ab > 0.001) {
		float amount = ab * 0.0016 * dot(centred, centred) * 4.0;
		col.r = texture(screen_tex, clamp(uv + centred * amount, vec2(0.0), vec2(1.0))).r;
		col.g = texture(screen_tex, uv).g;
		col.b = texture(screen_tex, clamp(uv - centred * amount, vec2(0.0), vec2(1.0))).b;
	} else {
		col = texture(screen_tex, uv).rgb;
	}
	if (gamma_correct == 1) {
		col = pow(max(col, vec3(0.0)), vec3(2.2));       // framebuffer -> linear
	}

	// --- god rays: march toward the sun and collect the bright pixels ------------------------
	if (god_rays > 0.001 && sun_visible > 0.001 && quality >= 1) {
		int steps = quality >= 2 ? 12 : 7;
		vec2 delta = (sun_screen_pos - uv) / float(steps);
		vec2 sp = uv;
		float weight = 1.0;
		vec3 acc = vec3(0.0);
		float total = 0.0;
		for (int i = 0; i < 12; i++) {
			if (i >= steps) {
				break;
			}
			sp += delta;
			vec3 s = texture(screen_tex, clamp(sp, vec2(0.0), vec2(1.0))).rgb;
			if (gamma_correct == 1) {
				s = pow(max(s, vec3(0.0)), vec3(2.2));
			}
			float bright = max(luma(s) - 0.55, 0.0);
			acc += s * bright * weight;
			total += weight;
			weight *= 0.86;
		}
		acc /= max(total, 0.001);
		float radial = 1.0 - clamp(length(uv - sun_screen_pos) * 1.15, 0.0, 1.0);
		col += acc * sun_color * god_rays * sun_visible * radial * radial * 2.4;
	}

	// --- underwater tint ---------------------------------------------------------------------
	if (underwater > 0.5) {
		float l = luma(col);
		col = mix(col, underwater_tint * (0.35 + 1.5 * l), 0.45);
	}

	// --- tonemap + grade ---------------------------------------------------------------------
	col = tonemap(col * exposure);
	col = (col - 0.5) * contrast + 0.5;
	float l2 = luma(col);
	col = mix(vec3(l2), col, saturation);
	// vibrance: push only the dull colours, keep skin/aura colours from clipping
	float sat_now = max(max(col.r, col.g), col.b) - min(min(col.r, col.g), col.b);
	col = mix(vec3(l2), col, 1.0 + vibrance * (1.0 - sat_now));

	// --- vignette + flash --------------------------------------------------------------------
	float vig = 1.0 - vignette * smoothstep(0.25, 0.95, length(centred) * 1.42);
	col *= vig;
	col += vec3(flash) * 0.8;

	col = clamp(col, vec3(0.0), vec3(1.0));
	if (gamma_correct == 1) {
		col = pow(col, vec3(1.0 / 2.2));                 // back to the framebuffer encoding
	}
	COLOR = vec4(col, 1.0);
}

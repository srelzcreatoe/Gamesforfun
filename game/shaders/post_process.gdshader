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

// --- fx pulses, pushed by scripts/fx/ScreenFx.gd -------------------------------------------
// All default to 0 and every block below is skipped at 0, so the sky controller's frame is
// bit-identical unless an effect is actually running. Doing it here instead of in a second
// full-screen ColorRect keeps the phone at ONE post pass during a transformation climax.
uniform float fx_blur : hint_range(0.0, 0.25) = 0.0;         // radial / zoom blur
uniform float fx_aberration : hint_range(0.0, 0.05) = 0.0;   // extra r/b split
uniform float fx_darken : hint_range(0.0, 1.0) = 0.0;        // scene + sky dim
// must match `darken_color` in shaders/fx_screen.gdshader: the two dim passes are one effect
uniform vec4 fx_darken_color : source_color = vec4(0.03, 0.04, 0.09, 1.0);
uniform float fx_glow : hint_range(0.0, 2.0) = 0.0;          // emissive bloom boost
uniform vec2 fx_focus = vec2(0.5, 0.5);

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

	// --- fx pulses (transformation climax, impacts) ------------------------------------------
	if (fx_blur > 0.0005 || fx_aberration > 0.0001) {
		vec2 fdir = uv - fx_focus;
		float fw = clamp(length(fdir) * 1.6, 0.0, 1.0);
		fw *= fw;                                         // keep the middle readable
		if (fx_blur > 0.0005) {
			float sl = fx_blur * fw / 6.0;
			vec3 acc = vec3(0.0);
			float tot = 0.0;
			for (int i = 0; i < 6; i++) {
				float k = float(i);
				vec3 s = texture(screen_tex, clamp(uv - fdir * (sl * k), vec2(0.0), vec2(1.0))).rgb;
				if (gamma_correct == 1) {
					s = pow(max(s, vec3(0.0)), vec3(2.2));
				}
				float w = 1.0 - k / 6.0 * 0.55;
				acc += s * w;
				tot += w;
			}
			col = acc / max(tot, 0.0001);
		}
		if (fx_aberration > 0.0001) {
			float am = fx_aberration * fw;
			vec3 sr = texture(screen_tex, clamp(uv + fdir * am, vec2(0.0), vec2(1.0))).rgb;
			vec3 sb = texture(screen_tex, clamp(uv - fdir * am, vec2(0.0), vec2(1.0))).rgb;
			if (gamma_correct == 1) {
				sr = pow(max(sr, vec3(0.0)), vec3(2.2));
				sb = pow(max(sb, vec3(0.0)), vec3(2.2));
			}
			col = vec3(sr.r, col.g, sb.b);
		}
	}
	if (fx_glow > 0.0001) {
		// 4 diagonal taps of the bright parts: a halo around auras, ki spheres and beams
		vec2 go = vec2(0.0035) * (1.0 + fx_glow);
		vec3 gacc = texture(screen_tex, clamp(uv + vec2(go.x, go.y), vec2(0.0), vec2(1.0))).rgb;
		gacc += texture(screen_tex, clamp(uv + vec2(-go.x, go.y), vec2(0.0), vec2(1.0))).rgb;
		gacc += texture(screen_tex, clamp(uv + vec2(go.x, -go.y), vec2(0.0), vec2(1.0))).rgb;
		gacc += texture(screen_tex, clamp(uv + vec2(-go.x, -go.y), vec2(0.0), vec2(1.0))).rgb;
		gacc *= 0.25;
		if (gamma_correct == 1) {
			gacc = pow(max(gacc, vec3(0.0)), vec3(2.2));
		}
		float gbright = max(luma(gacc) - 0.5, 0.0) * 2.0;
		col += gacc * gbright * fx_glow;
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

	// --- fx screen dim (scripts/fx/ScreenFx.gd) ----------------------------------------------
	// LAST, after tonemap/grade/gamma, because shaders/fx_screen.gdshader - the same effect for
	// scenes with no post pass of their own - reads an already-graded framebuffer. Applying it
	// before `tonemap()` (where it used to sit) let the filmic curve's mid-tone lift undo part
	// of the multiply, which is why the in-world dim was weaker than the preview's.
	// FXDIM-BEGIN  (kept byte-identical in shaders/post_process.gdshader; the test
	// tests/test_fx.gd normalises the uniform prefix and compares the two blocks)
	if (fx_darken > 0.0001) {
		float dl = luma(col);
		// Vignette weighted and PROPORTIONAL. Mixing the frame toward an absolute
		// near-black (what this used to do) reads as almost nothing in noon daylight and
		// crushes already-dark pixels, so the frame is SCALED down instead: hard at the
		// edges, gently in the middle where the character is, with a cool tint added back
		// so nothing clips to zero. That is also where the strain "vignette" comes from
		// now; an additive overlay cannot darken anything.
		float edge = 0.40 + 0.95 * smoothstep(0.05, 0.95, length(uv - vec2(0.5)) * 1.30);
		float amt = clamp(fx_darken * edge, 0.0, 1.0);
		vec3 dimmed = col * mix(1.0, 0.10, amt) + fx_darken_color.rgb * amt * (0.22 + 0.45 * dl) * 1.6;
		// Only genuinely blown-out fx pixels (aura core, flash, beam) burn through the
		// dim, and only partly. The gate has to sit above daylight terrain luma - at 0.7
		// it opened for sky, sand and most grass, so the dim read at night and did
		// nothing at noon. Both passes run this on the FRAMEBUFFER-ENCODED colour, as the
		// last thing before output, so `dl` means the same number in both.
		col = clamp(mix(dimmed, col, clamp((dl - 0.88) * 6.0, 0.0, 1.0) * 0.85), vec3(0.0), vec3(1.0));
	}
	// FXDIM-END
	COLOR = vec4(col, 1.0);
}

shader_type canvas_item;
render_mode blend_mix, unshaded;
// fx_screen.gdshader - the "impact" full-screen pass owned by scripts/fx/ScreenFx.gd.
//
// Radial (zoom) blur, radial chromatic aberration, a global darken/desaturate for the
// strain phase of a transformation and a cheap bright-pass glow for emissive fx. It is
// a blend_mix pass that re-draws the frame, so the ColorRect is only made visible while
// one of the amounts is non-zero: idle cost is exactly zero (hidden CanvasItem).
//
// gl_compatibility safe: one screen texture, no derivatives, fixed loop bounds.

uniform sampler2D screen_tex : hint_screen_texture, repeat_disable, filter_linear;

uniform float blur_amount : hint_range(0.0, 0.25) = 0.0;   // zoom blur strength
uniform float aberration : hint_range(0.0, 0.05) = 0.0;    // r/b split at the edges
uniform float darken : hint_range(0.0, 1.0) = 0.0;         // sky/scene dim
uniform vec4 darken_color : source_color = vec4(0.03, 0.04, 0.09, 1.0);
uniform float glow_amount : hint_range(0.0, 2.0) = 0.0;    // bright-pass bloom
uniform vec4 glow_tint : source_color = vec4(1.0, 1.0, 1.0, 1.0);
uniform float glow_threshold : hint_range(0.0, 1.0) = 0.62;
uniform vec2 focus = vec2(0.5, 0.5);                       // blur / aberration centre
uniform float edge_only : hint_range(0.0, 1.0) = 1.0;      // keep the centre sharp

const int TAPS = 6;

float luma(vec3 c) {
	return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

void fragment() {
	vec2 uv = SCREEN_UV;
	vec2 dir = uv - focus;
	float dist = clamp(length(dir) * 1.6, 0.0, 1.0);
	// the middle of the frame stays readable; the blur ramps up towards the edges
	float weight = mix(1.0, dist * dist, edge_only);

	vec3 col;
	if (blur_amount > 0.0005) {
		float step_len = blur_amount * weight / float(TAPS);
		vec3 acc = vec3(0.0);
		float total = 0.0;
		for (int i = 0; i < TAPS; i++) {
			float k = float(i);
			vec2 sp = uv - dir * (step_len * k);
			float w = 1.0 - k / float(TAPS) * 0.55;
			acc += texture(screen_tex, clamp(sp, vec2(0.0), vec2(1.0))).rgb * w;
			total += w;
		}
		col = acc / max(total, 0.0001);
	} else {
		col = texture(screen_tex, uv).rgb;
	}

	if (aberration > 0.0001) {
		float amt = aberration * weight;
		float r = texture(screen_tex, clamp(uv + dir * amt, vec2(0.0), vec2(1.0))).r;
		float b = texture(screen_tex, clamp(uv - dir * amt, vec2(0.0), vec2(1.0))).b;
		col = vec3(r, col.g, b);
	}

	if (glow_amount > 0.0001) {
		// 4 diagonal taps of the bright parts: enough of a halo around auras and
		// energy spheres to read as bloom without a second framebuffer
		vec2 o = vec2(0.0035, 0.0035) * (1.0 + glow_amount);
		vec3 acc = vec3(0.0);
		acc += texture(screen_tex, clamp(uv + vec2(o.x, o.y), vec2(0.0), vec2(1.0))).rgb;
		acc += texture(screen_tex, clamp(uv + vec2(-o.x, o.y), vec2(0.0), vec2(1.0))).rgb;
		acc += texture(screen_tex, clamp(uv + vec2(o.x, -o.y), vec2(0.0), vec2(1.0))).rgb;
		acc += texture(screen_tex, clamp(uv + vec2(-o.x, -o.y), vec2(0.0), vec2(1.0))).rgb;
		acc *= 0.25;
		float bright = max(luma(acc) - glow_threshold, 0.0) / max(1.0 - glow_threshold, 0.001);
		col += acc * glow_tint.rgb * bright * glow_amount;
	}

	if (darken > 0.0001) {
		float l = luma(col);
		vec3 dimmed = mix(col, darken_color.rgb * (0.35 + 1.2 * l), darken);
		// Only genuinely blown-out fx pixels burn through the dim, and only partly: the
		// gate has to sit above daylight terrain luma or the dim does nothing at noon.
		// Kept identical to shaders/post_process.gdshader, which runs the same pass in world.
		col = mix(dimmed, col, clamp((l - 0.88) * 6.0, 0.0, 1.0) * 0.85);
	}

	COLOR = vec4(clamp(col, vec3(0.0), vec3(1.0)), 1.0);
}

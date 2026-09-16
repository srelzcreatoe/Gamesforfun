shader_type canvas_item;
render_mode blend_add, unshaded;
// Full-screen additive flash + vignette + cheap chromatic aberration used by ScreenFx.
// One ColorRect covers the viewport; every effect is driven by uniforms so the whole
// post stack costs a single fullscreen pass on the phone.

uniform vec4 flash_color : source_color = vec4(1.0, 1.0, 1.0, 1.0);
uniform float flash : hint_range(0.0, 1.0) = 0.0;
uniform vec4 vignette_color : source_color = vec4(0.5, 0.0, 0.0, 1.0);
uniform float vignette : hint_range(0.0, 1.0) = 0.0;
uniform float vignette_softness : hint_range(0.01, 1.5) = 0.75;
uniform float aberration : hint_range(0.0, 0.02) = 0.0;
uniform sampler2D screen_tex : hint_screen_texture, repeat_disable, filter_linear;
uniform float use_screen = 0.0;

void fragment() {
	vec2 uv = SCREEN_UV;
	vec3 col = vec3(0.0);
	float a = 0.0;

	if (use_screen > 0.5 && aberration > 0.0) {
		// chromatic aberration: sample R/B with a radial offset, additive over the frame
		vec2 dir = uv - vec2(0.5);
		float r = texture(screen_tex, uv + dir * aberration).r;
		float g = texture(screen_tex, uv).g;
		float b = texture(screen_tex, uv - dir * aberration).b;
		vec3 base = texture(screen_tex, uv).rgb;
		vec3 shifted = vec3(r, g, b);
		col += max(shifted - base, vec3(0.0));
		a = max(a, length(shifted - base) * 2.0);
	}

	if (flash > 0.0) {
		col += flash_color.rgb * flash;
		a = max(a, flash);
	}

	if (vignette > 0.0) {
		float d = length((uv - vec2(0.5)) * vec2(1.25, 1.0)) * 1.42;
		float v = smoothstep(1.0 - vignette_softness, 1.0, d) * vignette;
		col += vignette_color.rgb * v;
		a = max(a, v);
	}

	COLOR = vec4(col, clamp(a, 0.0, 1.0));
}

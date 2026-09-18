shader_type canvas_item;
render_mode blend_add, unshaded;
// Full-screen additive flash + vignette used by ScreenFx.
// One ColorRect covers the viewport; every effect is driven by uniforms so the whole
// post stack costs a single fullscreen pass on the phone.

uniform vec4 flash_color : source_color = vec4(1.0, 1.0, 1.0, 1.0);
uniform float flash : hint_range(0.0, 1.0) = 0.0;
uniform vec4 vignette_color : source_color = vec4(0.5, 0.0, 0.0, 1.0);
uniform float vignette : hint_range(0.0, 1.0) = 0.0;
uniform float vignette_softness : hint_range(0.01, 1.5) = 0.75;
// No screen texture here on purpose: `hint_screen_texture` costs a back-buffer copy every time
// this overlay draws, and the chromatic-aberration branch it fed was dead code (nothing ever set
// `use_screen`). ScreenFx's aberration is done by the post pass / fx_screen.gdshader instead.

void fragment() {
	vec2 uv = SCREEN_UV;
	vec3 col = vec3(0.0);
	float a = 0.0;

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

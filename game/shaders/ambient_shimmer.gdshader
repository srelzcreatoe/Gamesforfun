// ambient_shimmer.gdshader - heat haze over Vampa / Hell (scripts/ambient/AmbientShimmer.gd).
//
// A canvas_item pass on a full-rect ColorRect in a CanvasLayer under the HUD, so it works on the
// gl_compatibility renderer where there is no post-process stack. It only bends the lower part of
// the screen (heat rises off the ground, not out of the sky) and adds a faint warm tint there.
// `strength` is 0 on every other planet, and the ColorRect is hidden outright, so this costs
// nothing when nothing is shimmering.
//
// Original work for Dragon Block Sagas.

shader_type canvas_item;
render_mode unshaded;

uniform sampler2D screen_tex : hint_screen_texture, repeat_disable, filter_linear;
uniform float strength : hint_range(0.0, 1.0) = 0.0;
uniform float speed : hint_range(0.0, 4.0) = 1.3;
uniform float ground : hint_range(0.0, 1.0) = 0.42;
uniform vec3 haze : source_color = vec3(1.0, 0.52, 0.22);
uniform float haze_amount : hint_range(0.0, 0.4) = 0.07;
uniform float amplitude : hint_range(0.0, 0.02) = 0.004;

void fragment() {
	vec2 uv = SCREEN_UV;
	// Heat rises off the ground: nothing above the horizon, strongest in the lower third.
	float band = smoothstep(0.0, 0.3, uv.y - ground) * (1.0 - smoothstep(0.93, 1.0, uv.y));
	// `strength` is 0 on every planet that does not shimmer, and the CanvasLayer is hidden as
	// well, so this pass is never even rendered there. (No early `return`: a shader's fragment
	// processor may not return.)
	band *= strength;
	float t = TIME * speed;
	float w = sin(uv.y * 78.0 + t * 3.1) * 0.6 + sin(uv.y * 41.0 + uv.x * 13.0 - t * 2.3) * 0.4;
	float h = sin(uv.x * 57.0 + t * 2.6) * 0.5 + sin(uv.y * 23.0 - t * 1.7) * 0.5;
	vec2 off = vec2(w * amplitude * band, h * amplitude * 0.45 * band);
	vec4 c = texture(screen_tex, clamp(uv + off, vec2(0.002), vec2(0.998)));
	c.rgb = mix(c.rgb, mix(c.rgb, haze, haze_amount), band);
	COLOR = vec4(c.rgb, 1.0);
}

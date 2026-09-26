shader_type spatial;
render_mode blend_mix, unshaded, cull_disabled, depth_draw_never, shadows_disabled, skip_vertex_transform;
// DragonMineZ's own ki aura, ported 1:1 from the mod's core shader
// (assets/dragonminez/shaders/core/aura.{json,vsh,fsh} + AuraRenderer.executeAuraShaderDraw).
//
// The mod does NOT build a flame mesh: it draws ONE camera facing quad with a greyscale
// flame strip (textures/entity/races/aura/<type>_aura.png, 4096x1024 = 4 frames of
// 1024), plus a flat quad on the ground with the matching `<type>_cross.png` strip. The
// strip's red channel is an intensity mask that the shader posterises into FOUR bands of
// the SAME form colour, so the aura always reads as that colour:
//
//   mask >= 0.97 -> color * 1.60, alpha 1.00      (the white hot spikes)
//   mask >= 0.70 -> color * 1.30, alpha 1.00
//   mask >  0.50 -> color * 1.00, alpha 0.85
//   mask >  0.00 -> color * 0.75, alpha 0.65      (the translucent body of the flame)
//   alpha is then multiplied by the mask itself and by `alp1` (our `fade`)
//
// and it ALPHA blends (srcalpha / oneminussrcalpha), it does not add: that is why DMZ's
// aura keeps its hue over a bright sky while an additive shell washes out to white.
// Frames advance at 0.5 per tick = 10 fps and cross fade into the next one.
//
// gl_compatibility safe: one texture, no screen/depth read, no derivatives. Two quads
// per aura, so a phone pays two draw calls and ~zero vertex work.

uniform sampler2D aura_tex : hint_default_white, filter_linear_mipmap, repeat_disable;
uniform vec4 aura_color : source_color = vec4(1.0, 0.843, 0.0, 1.0);
// 0..1.6: the aura's current strength (charging / power release / form).
uniform float intensity : hint_range(0.0, 2.0) = 1.0;
// Extra fade, e.g. the billboard <-> ground cross crossfade.
uniform float fade : hint_range(0.0, 1.0) = 1.0;
uniform float frames = 4.0;
// DMZ: speed = (tick + partialTick) * 0.5 -> 10 frames/s at 20 tps.
uniform float anim_rate = 10.0;
uniform float phase = 0.0;
// true: camera facing, y locked upright (the flame). false: the mesh's own transform
// (the ground cross quad).
uniform bool billboard = true;

void vertex() {
	if (billboard) {
		// y locked billboard, keeping the node's world scale: the flame always faces
		// the camera and never tips over, which is what DMZ's pose stack ends up doing
		// for anything but a steep camera pitch (and that case fades to the ground quad).
		vec3 c = (VIEW_MATRIX * MODEL_MATRIX * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
		vec3 up = normalize((VIEW_MATRIX * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
		vec3 to_cam = normalize(-c);
		vec3 right = cross(up, to_cam);
		float rl = length(right);
		right = rl > 0.0001 ? right / rl : vec3(1.0, 0.0, 0.0);
		float sx = length(MODEL_MATRIX[0].xyz);
		float sy = length(MODEL_MATRIX[1].xyz);
		VERTEX = c + right * (VERTEX.x * sx) + up * (VERTEX.y * sy);
		NORMAL = to_cam;
	} else {
		VERTEX = (MODELVIEW_MATRIX * vec4(VERTEX, 1.0)).xyz;
		NORMAL = normalize((MODELVIEW_MATRIX * vec4(NORMAL, 0.0)).xyz);
	}
}

// DMZ adjustColor(): the four colour bands. `a` already carries the band's own alpha.
vec4 aura_band(float m) {
	if (m >= 0.97) {
		return vec4(aura_color.rgb * 1.6, 1.0);
	}
	if (m >= 0.7) {
		return vec4(aura_color.rgb * 1.3, 1.0);
	}
	if (m > 0.5) {
		return vec4(aura_color.rgb, 0.85);
	}
	if (m > 0.0) {
		return vec4(aura_color.rgb * 0.75, 0.65);
	}
	return vec4(0.0);
}

void fragment() {
	float sp = TIME * anim_rate + phase;
	float fw = 1.0 / frames;
	float i0 = floor(mod(sp, frames));
	float i1 = floor(mod(sp + 1.0, frames));
	float m0 = texture(aura_tex, vec2(UV.x * fw + i0 * fw, UV.y)).r;
	float m1 = texture(aura_tex, vec2(UV.x * fw + i1 * fw, UV.y)).r;
	vec4 c0 = aura_band(m0);
	vec4 c1 = aura_band(m1);
	c0.a *= m0;
	c1.a *= m1;
	vec4 c = mix(c0, c1, fract(sp));
	float a = c.a * clamp(intensity, 0.0, 2.0) * fade * aura_color.a;
	if (a < 0.004) {
		discard;
	}
	ALBEDO = clamp(c.rgb, vec3(0.0), vec3(1.0));
	ALPHA = clamp(a, 0.0, 1.0);
}

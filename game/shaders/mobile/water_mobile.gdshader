// mobile/water_mobile.gdshader - the phone variant of shaders/water.gdshader.
//
// SIX uniforms, no screen texture, no depth texture: on a phone the desktop water shader is the
// single worst offender (36 uniforms, a screen copy AND a depth copy per frame), and a fragment
// program that fails to link leaves Godot drawing with an unbound shader - the native crash this
// whole pass exists to stop. Every name here is a subset of the desktop names with the same
// payload (see shaders/water.gdshader), so ChunkManager / SkyController push the same values to
// either shader and the writes for the slots this file does not declare are simply ignored.
//
// Kept: the vertex stream, the UV2 layer/frame packing, the gerstner-ish wave displacement and
// wave normal, the Minecraft face/light model, the biome tint from COLOR and the distance fog -
// so water sits at the same height, animates at the same speed and takes the same colour as on
// desktop. Replaced: refraction, depth-based thickness, caustics, shore foam and the full sky
// reflection are one flat water colour plus a Fresnel-weighted fog/sky tint. Lava keeps its
// emissive look without the fbm crust.

shader_type spatial;
render_mode blend_mix, cull_disabled, depth_draw_always, unshaded, shadows_disabled, fog_disabled;

//   sun_params      xyz sun colour      w daylight
//   fog_params      xyz fog colour      w fog_start
//   ambient_params  xyz ambient colour  w fog_end
//   sun_dir_params  xyz direction TO the sun    w time (seconds)
//   water_params    xyz shallow water tint      w mode = is_lava + 2 * debug_view
uniform sampler2DArray tiles : source_color, filter_nearest, repeat_disable;
uniform vec4 sun_params = vec4(1.0, 0.96, 0.9, 1.0);
uniform vec4 fog_params = vec4(0.75, 0.84, 0.96, 48.0);
uniform vec4 ambient_params = vec4(0.45, 0.52, 0.66, 96.0);
uniform vec4 sun_dir_params = vec4(0.0, 0.8, 0.6, 0.0);
uniform vec4 water_params = vec4(0.09, 0.28, 0.62, 0.0);

const float ANIM_FPS = 10.0;
const float WAVE_HEIGHT = 0.055;
const float WAVE_SPEED = 1.5;
const float WATER_ALPHA = 0.78;
const float FRESNEL_STRENGTH = 0.35;
const vec3 BLOCK_LIGHT_COLOR = vec3(1.0, 0.82, 0.58);
const vec3 DEEP_COLOR = vec3(0.012, 0.075, 0.22);

varying vec3 v_uv_layer;
varying vec3 v_normal;
varying vec3 v_world;
varying float v_light;
varying float v_top;

float face_factor(vec3 n) {
	if (n.y > 0.5) {
		return 1.0;
	}
	if (n.y < -0.5) {
		return 0.5;
	}
	if (abs(n.z) > 0.5) {
		return 0.8;
	}
	return 0.6;
}

// The same three crossing waves as the desktop shader: the surface has to sit at the same height.
float water_waves(vec2 p, float t, out vec2 slope) {
	vec2 d1 = vec2(0.86, 0.51);
	vec2 d2 = vec2(-0.42, 0.91);
	vec2 d3 = vec2(0.71, -0.70);
	float k1 = 0.55;
	float k2 = 1.13;
	float k3 = 2.21;
	float a1 = 0.55;
	float a2 = 0.30;
	float a3 = 0.15;
	float p1 = dot(p, d1) * k1 + t * 1.10;
	float p2 = dot(p, d2) * k2 - t * 1.43;
	float p3 = dot(p, d3) * k3 + t * 2.10;
	slope = a1 * k1 * cos(p1) * d1 + a2 * k2 * cos(p2) * d2 + a3 * k3 * cos(p3) * d3;
	return a1 * sin(p1) + a2 * sin(p2) + a3 * sin(p3);
}

void vertex() {
	float time = sun_dir_params.w;
	int is_lava = int(mod(water_params.w, 2.0));
	float layer = floor(UV2.x);
	float enc = floor(fract(UV2.x) * 256.0 + 0.5);
	float sway_mode = floor(enc / 64.0);
	float frames = enc - sway_mode * 64.0;
	if (frames > 1.5) {
		layer += floor(mod(time * ANIM_FPS, frames));
	}
	v_uv_layer = vec3(UV, layer);
	v_normal = NORMAL;
	v_light = UV2.y;
	v_top = step(0.5, NORMAL.y);
	vec3 world = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	if (v_top > 0.5 && is_lava == 0) {
		vec2 slope;
		float h = water_waves(world.xz, time * WAVE_SPEED, slope);
		VERTEX.y += h * WAVE_HEIGHT;
		world.y += h * WAVE_HEIGHT;
		v_normal = normalize(vec3(-slope.x * WAVE_HEIGHT * 6.0, 1.0, -slope.y * WAVE_HEIGHT * 6.0));
	}
	v_world = world;
}

void fragment() {
	float daylight = sun_params.w;
	vec3 sun_color = sun_params.rgb;
	vec3 fog_color = fog_params.rgb;
	float fog_start = fog_params.w;
	vec3 ambient_color = ambient_params.rgb;
	float fog_end = ambient_params.w;
	vec3 sun_dir = sun_dir_params.xyz;
	vec3 water_color = water_params.rgb;
	int is_lava = int(mod(water_params.w, 2.0));

	vec3 cam = INV_VIEW_MATRIX[3].xyz;
	vec3 view_dir = normalize(v_world - cam);
	float view_dist = length(v_world - cam);

	vec4 tex = texture(tiles, v_uv_layer);
	vec3 tint = COLOR.rgb;

	// voxel light, same model as the chunk shaders
	float packed = floor(v_light * 255.0 + 0.5);
	float sky_raw = floor(packed * 0.0625);
	float sky_l = sky_raw / 15.0;
	float blk = (packed - sky_raw * 16.0) / 15.0;
	vec3 light = max(sky_l * daylight * mix(ambient_color, sun_color, clamp(daylight, 0.0, 1.0)),
			blk * BLOCK_LIGHT_COLOR) + ambient_color * 0.15;
	vec3 n = normalize(v_normal);
	float face = face_factor(n);

	vec3 col;
	float alpha;
	if (is_lava == 1) {
		vec3 lava = vec3(1.0, 0.42, 0.06) * (tex.rgb * 1.5 + vec3(0.4));
		col = lava * face;
		alpha = 1.0;
	} else {
		// flat water body colour + a simple Fresnel toward the sky/fog colour
		vec3 shallow = water_color * tint * (tex.rgb * 0.5 + 0.6);
		vec3 body = mix(shallow, DEEP_COLOR * mix(vec3(1.0), tint, 0.5), 0.45) * light * COLOR.a;
		float facing = max(dot(n, -view_dir), 0.0);
		float fresnel = 0.02 + 0.98 * pow(1.0 - facing, 5.0);
		fresnel = clamp(fresnel * (1.0 + FRESNEL_STRENGTH), 0.0, 1.0);
		vec3 sky = fog_color * (0.35 + 0.85 * clamp(daylight, 0.0, 1.0));
		col = mix(body, sky, fresnel);
		// one cheap specular lobe so the sun still glints off the surface
		float spec = pow(max(dot(n, normalize(sun_dir - view_dir)), 0.0), 220.0);
		col += sun_color * spec * daylight * 1.6;
		alpha = clamp(WATER_ALPHA + fresnel * 0.3, 0.0, 1.0);
	}

	float fog = clamp((view_dist - fog_start) / max(fog_end - fog_start, 0.001), 0.0, 1.0);
	fog = fog * fog * (3.0 - 2.0 * fog);
	ALBEDO = max(mix(col, fog_color, fog), vec3(0.0));
	ALPHA = alpha;
}

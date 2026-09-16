// chunk_opaque.gdshader - opaque voxel terrain (gl_compatibility safe).
//
// Written by the voxel agent, polished later by the shaders agent: KEEP THE UNIFORM NAMES.
//
// Vertex stream produced by ChunkMesher:
//   UV      0..1 tile uv
//   UV2.x   texture array layer + frames/64.0   (the fractional part is the animation frame
//           count of the tile: 1/64 = static, 32/64 = a 32 frame strip. The frames are
//           consecutive layers in Textures.block_array, so layer = base + frame.)
//   UV2.y   packed light / 255, packed = sky * 16 + block
//   COLOR   rgb = biome tint, a = ambient occlusion (0.55 / 0.7 / 0.85 / 1.0)
//
// Lighting is unshaded/Minecraft style: face factor (top 1.0, north/south 0.8, east/west 0.6,
// bottom 0.5) * max(sky * daylight, warm block light) * ao, then distance fog.
// The biome tint is masked by the tile alpha (grass_side is opaque where the grass overlay is).

shader_type spatial;
render_mode unshaded, cull_back, depth_draw_opaque;

uniform sampler2DArray tiles : source_color, filter_nearest_mipmap, repeat_disable;
uniform float daylight = 1.0;
uniform vec3 sun_color : source_color = vec3(1.0, 0.96, 0.9);
uniform vec3 fog_color : source_color = vec3(0.75, 0.84, 0.96);
uniform vec3 ambient_color : source_color = vec3(0.45, 0.52, 0.66);
uniform float fog_start = 48.0;
uniform float fog_end = 96.0;
uniform float time = 0.0;
uniform float anim_fps = 8.0;
uniform float block_light_warmth = 1.0;

varying vec3 v_uv_layer;
varying vec3 v_normal;
varying float v_light;
varying float v_fog;

// Warm colour of torch/lava light.
const vec3 BLOCK_LIGHT_COLOR = vec3(1.0, 0.82, 0.58);

float face_factor(vec3 n) {
	if (n.y > 0.5) return 1.0;
	if (n.y < -0.5) return 0.5;
	if (abs(n.z) > 0.5) return 0.8;
	return 0.6;
}

void vertex() {
	float layer = floor(UV2.x);
	float frames = floor(fract(UV2.x) * 64.0 + 0.5);
	if (frames > 1.5) {
		layer += floor(mod(time * anim_fps, frames));
	}
	v_uv_layer = vec3(UV, layer);
	v_normal = NORMAL;
	v_light = UV2.y;
	vec3 view = (MODELVIEW_MATRIX * vec4(VERTEX, 1.0)).xyz;
	v_fog = clamp((length(view) - fog_start) / max(fog_end - fog_start, 0.001), 0.0, 1.0);
}

void fragment() {
	vec4 tex = texture(tiles, v_uv_layer);
	// Biome tint, masked by the tile alpha (COLOR.rgb is white for untinted blocks).
	vec3 tint = mix(vec3(1.0), COLOR.rgb, tex.a);
	float packed = floor(v_light * 255.0 + 0.5);
	float sky_raw = floor(packed * 0.0625);
	float sky = sky_raw / 15.0;
	float blk = (packed - sky_raw * 16.0) / 15.0;
	float ao = COLOR.a;
	float face = face_factor(normalize(v_normal));
	vec3 sky_part = sky * daylight * mix(ambient_color, sun_color, clamp(daylight, 0.0, 1.0));
	vec3 blk_part = blk * BLOCK_LIGHT_COLOR * block_light_warmth;
	vec3 light = max(sky_part, blk_part) + ambient_color * 0.12;
	vec3 albedo = tex.rgb * tint * light * face * ao;
	ALBEDO = mix(albedo, fog_color, v_fog);
}

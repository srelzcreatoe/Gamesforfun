// chunk_opaque.gdshader - opaque voxel terrain (gl_compatibility safe).
//
// Written by the voxel agent, polished later by the shaders agent: KEEP THE UNIFORM NAMES.
//
// Vertex stream produced by ChunkMesher:
//   UV      0..1 tile uv
//   UV2.x   texture array layer + (frames + 64 * sway_mode) / 256. The fractional part holds
//           the tile's animation length (1 = static, 32 = a 32 frame strip; the frames are
//           consecutive layers in Textures.block_array, so layer = base + frame) and the wind
//           mode (0 = static, 1 = plant, 2 = leaves) used by chunk_cutout.gdshader.
//   UV2.y   packed light / 255, packed = sky * 16 + block
//   COLOR   rgb = biome tint, a = ambient occlusion (0.55 / 0.7 / 0.85 / 1.0)
//
// Lighting is unshaded/Minecraft style: face factor (top 1.0, north/south 0.8, east/west 0.6,
// bottom 0.5) * max(sky * daylight, warm block light) * ao, then distance fog.
// The biome tint is masked by the tile alpha (grass_side is opaque where the grass overlay is).

//
// POLISH PASS (shaders agent): the uniform names, the vertex stream and the Minecraft-style
// face/light model are untouched. What changed: the distance fog uses a smoothstep curve with a
// dither instead of a hard linear ramp (no banding in gradients), sky light picks up a small
// directional term from `sun_dir` so slopes facing the sun read slightly warmer, and block light
// flickers very slightly (`light_flicker`, set it to 0 to switch that off).

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
uniform vec3 sun_dir = vec3(0.0, 1.0, 0.0);      // direction TO the sun/moon (SkyController)
uniform float sun_wrap : hint_range(0.0, 0.5) = 0.13;   // strength of the soft directional term
uniform float light_flicker : hint_range(0.0, 1.0) = 0.25;

varying vec3 v_uv_layer;
varying vec3 v_normal;
varying float v_light;
varying float v_fog;
varying float v_world_phase;

// Warm colour of torch/lava light.
const vec3 BLOCK_LIGHT_COLOR = vec3(1.0, 0.82, 0.58);

// Interleaved gradient noise: one dither value per pixel, breaks up fog/gradient banding.
float chunk_dither(vec2 frag) {
	return fract(52.9829189 * fract(0.06711056 * frag.x + 0.00583715 * frag.y));
}

// Soft "wrap" lambert: a gentle extra tilt toward the sun on top of the flat face factor.
float chunk_sun_wrap(vec3 n, vec3 l) {
	return (dot(n, l) * 0.5 + 0.5) * 0.7 + 0.3;
}

float face_factor(vec3 n) {
	if (n.y > 0.5) return 1.0;
	if (n.y < -0.5) return 0.5;
	if (abs(n.z) > 0.5) return 0.8;
	return 0.6;
}

void vertex() {
	float layer = floor(UV2.x);
	float enc = floor(fract(UV2.x) * 256.0 + 0.5);
	float sway_mode = floor(enc / 64.0);        // 0 static, 1 plant, 2 leaves
	float frames = enc - sway_mode * 64.0;
	if (frames > 1.5) {
		layer += floor(mod(time * anim_fps, frames));
	}
	v_uv_layer = vec3(UV, layer);
	v_normal = NORMAL;
	v_light = UV2.y;
	vec3 world = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	v_world_phase = world.x * 1.7 + world.y * 0.9 + world.z * 2.3;
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
	vec3 nn = normalize(v_normal);
	float face = face_factor(nn);
	vec3 sky_part = sky * daylight * mix(ambient_color, sun_color, clamp(daylight, 0.0, 1.0));
	// soft directional term: slopes that face the sun read a little warmer than the flat face factor
	sky_part *= mix(1.0, chunk_sun_wrap(nn, normalize(sun_dir)), sun_wrap * clamp(daylight, 0.0, 1.0));
	float flicker = 1.0 - light_flicker * 0.12 * (0.5 + 0.5 * sin(time * 7.3 + v_world_phase));
	vec3 blk_part = blk * BLOCK_LIGHT_COLOR * block_light_warmth * flicker;
	vec3 light = max(sky_part, blk_part) + ambient_color * 0.12;
	vec3 albedo = tex.rgb * tint * light * face * ao;
	float fog = v_fog * v_fog * (3.0 - 2.0 * v_fog);
	fog = clamp(fog + (chunk_dither(FRAGCOORD.xy) - 0.5) * 0.02, 0.0, 1.0);
	ALBEDO = mix(albedo, fog_color, fog);
}

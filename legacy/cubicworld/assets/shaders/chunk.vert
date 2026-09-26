attribute vec3 a_position;
attribute vec2 a_uv;
attribute vec4 a_color;    // rgb = biome tint, a = ambient occlusion
attribute float a_light;   // (sky*16 + block) / 255

uniform mat4 u_projView;
uniform mat4 u_model;
uniform vec3 u_cameraPos;

varying vec2 v_uv;
varying vec3 v_tint;
varying float v_ao;
varying float v_sky;
varying float v_block;
varying float v_dist;

void main() {
    v_uv = a_uv;
    v_tint = a_color.rgb;
    v_ao = a_color.a;
    float lightBits = a_light * 255.0;
    v_sky = floor(lightBits / 16.0) / 15.0;
    v_block = mod(lightBits, 16.0) / 15.0;
    vec4 worldPos = u_model * vec4(a_position, 1.0);
    v_dist = distance(worldPos.xyz, u_cameraPos);
    gl_Position = u_projView * worldPos;
}

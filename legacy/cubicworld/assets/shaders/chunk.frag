#ifdef GL_ES
precision mediump float;
#endif

uniform sampler2D u_texture;
uniform float u_sunLevel;    // 0..1 day/night brightness
uniform vec3 u_fogColor;
uniform float u_fogStart;
uniform float u_fogEnd;
uniform float u_alphaTest;   // 0 = off, else discard threshold
uniform float u_globalAlpha; // < 1 for the translucent pass
uniform float u_lightOverride; // >= 0: use this light level (entities); -1: use attributes
uniform float u_hurtFlash;   // 0..1 red flash for damaged creatures

varying vec2 v_uv;
varying vec3 v_tint;
varying float v_ao;
varying float v_sky;
varying float v_block;
varying float v_dist;

void main() {
    vec4 tex = texture2D(u_texture, v_uv);
    if (u_alphaTest > 0.0 && tex.a < u_alphaTest) discard;

    float light = max(v_sky * u_sunLevel, v_block);
    if (u_lightOverride >= 0.0) light = u_lightOverride;
    float brightness = 0.22 + 0.78 * light;
    brightness *= (0.55 + 0.45 * v_ao);

    vec3 color = tex.rgb * v_tint * brightness;
    color = mix(color, vec3(1.0, 0.2, 0.2), u_hurtFlash);
    float fog = clamp((v_dist - u_fogStart) / (u_fogEnd - u_fogStart), 0.0, 1.0);
    color = mix(color, u_fogColor, fog);
    gl_FragColor = vec4(color, tex.a * u_globalAlpha);
}

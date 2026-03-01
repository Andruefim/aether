/**
 * 3D Simplex noise (Stefan Gustavson implementation).
 * Injected before both vertex and fragment shaders.
 */
export const SNOISE_3D_GLSL = /* glsl */ `
vec4 _permute(vec4 x){ return mod(((x*34.0)+1.0)*x, 289.0); }
vec4 _taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v){
  const vec2  C = vec2(1.0/6.0, 1.0/3.0);
  const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);

  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);

  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);

  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;

  i = mod(i, 289.0);
  vec4 p = _permute(_permute(_permute(
    i.z + vec4(0.0, i1.z, i2.z, 1.0))
    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
    + i.x + vec4(0.0, i1.x, i2.x, 1.0));

  float n_ = 1.0/7.0;
  vec3  ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);

  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);

  vec4 norm = _taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;

  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
`;

/**
 * Vertex shader — displaces sphere surface with layered noise.
 * Stronger displacement when thinking or responding to audio.
 */
export const ORB_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uThinkingIntensity;  // 0..1 — model is generating
uniform float uAudioAmplitude;     // 0..1 — microphone input
uniform float uSpeakingProgress;   // 0..1 — TTS is playing

varying vec3 vNormal;
varying vec3 vPosition;
varying float vNoise;

void main() {
  vNormal = normalize(normalMatrix * normal);

  // Low-freq: overall shape breathing (very subtle)
  float n1 = snoise(position * 0.8 + uTime * 0.14);

  // Mid-freq: surface skin — always visible, defines the "plasma texture"
  float n2 = snoise(position * 2.6 + uTime * 0.28);

  // High-freq: micro ripples for surface detail
  float n3 = snoise(position * 5.8 + uTime * 0.52);

  // State-dependent layers
  float n4 = snoise(position * 3.2 + uTime * 1.10) * uThinkingIntensity;
  float n5 = snoise(position * 4.0 + uTime * 1.80) * uAudioAmplitude;
  float n6 = snoise(position * 1.2 - uTime * 0.70) * uSpeakingProgress;

  float disp = n1 * 0.028   // low-freq breathing
             + n2 * 0.016   // mid surface detail
             + n3 * 0.006   // micro texture
             + n4 * 0.055   // thinking burst
             + n5 * 0.035   // audio ripple
             + n6 * 0.028;  // speaking pulse

  vNoise = (n1 * 0.5 + 0.5) * 0.6 + (n2 * 0.5 + 0.5) * 0.4
         + uThinkingIntensity * (n4 * 0.5 + 0.5) * 0.35;

  vec3 displaced = position + normal * disp;
  vPosition = (modelMatrix * vec4(displaced, 1.0)).xyz;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
}
`;

/**
 * Fragment shader — plasma coloring with state-driven hue shifts.
 *
 * Idle:       deep indigo / violet plasma
 * Thinking:   brighter cyan / electric blue, faster churn
 * Listening:  green energy ripples
 * Speaking:   warm amber / gold emission
 */
export const ORB_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uThinkingIntensity;
uniform float uAudioAmplitude;
uniform float uSpeakingProgress;
uniform vec3  uCameraPosition;

varying vec3 vNormal;
varying vec3 vPosition;
varying float vNoise;

void main() {
  // ── Ridge FBM — creates sharp bright filaments on dark background ──────────
  // Ridge formula: 1 - |noise| → zero-crossings become bright peaks (narrow lines).
  // Domain warping: each octave's position is offset by the previous result
  // so streams curve and twist organically instead of being straight.

  vec3 p = vPosition;

  // Warp domain slightly so streams curve
  float warp1 = snoise(p * 1.8 + uTime * 0.12);
  float warp2 = snoise(p * 1.8 - uTime * 0.10 + vec3(5.2, 1.3, 2.8));
  vec3 warped = p + vec3(warp1, warp2, warp1 * 0.7) * 0.18;

  // Ridge octaves — each halves amplitude, doubles frequency
  float ridge = 0.0;
  float w = 0.58; float f = 2.8;
  float r;
  r = 1.0 - abs(snoise(warped * f + uTime * 0.20)); r *= r; ridge += r * w; w *= 0.48; f *= 2.05;
  r = 1.0 - abs(snoise(warped * f - uTime * 0.16)); r *= r; ridge += r * w; w *= 0.48; f *= 2.05;
  r = 1.0 - abs(snoise(warped * f + uTime * 0.28)); r *= r; ridge += r * w; w *= 0.48; f *= 2.05;
  r = 1.0 - abs(snoise(warped * f - uTime * 0.22)); r *= r; ridge += r * w; w *= 0.48; f *= 2.05;
  r = 1.0 - abs(snoise(warped * f + uTime * 0.35)); r *= r; ridge += r * w;

  // Normalize roughly to [0..1]
  ridge = clamp(ridge * 0.95, 0.0, 1.0);

  // Power curve: pull down dim areas, keep only bright ridges visible
  // Higher power = thinner/sharper streams
  float streams = pow(ridge, 2.8);

  // Extra fine detail layer — very thin secondary filaments
  float fine = 1.0 - abs(snoise(warped * 18.0 + uTime * 0.40));
  fine = pow(clamp(fine, 0.0, 1.0), 4.5) * 0.18;
  streams = clamp(streams + fine, 0.0, 1.0);

  // State modulation — thinking adds electric turbulence
  float turbulence = 1.0 - abs(snoise(warped * 8.0 + uTime * 1.5));
  turbulence = pow(clamp(turbulence, 0.0, 1.0), 3.0);
  streams = mix(streams, clamp(streams + turbulence * 0.4, 0.0, 1.0), uThinkingIntensity);

  // ── Palette: very dark base, narrow bright streams ─────────────────────────
  vec3 colVoid   = vec3(0.02, 0.00, 0.08);   // near-black void
  vec3 colStream = vec3(0.45, 0.15, 0.90);   // deep violet stream
  vec3 colBright = vec3(0.72, 0.50, 1.00);   // bright filament peak

  // Map: void → stream → bright, only on ridge peaks
  vec3 baseColor = mix(colVoid, colStream, smoothstep(0.0, 0.45, streams));
  baseColor      = mix(baseColor, colBright, smoothstep(0.50, 1.0, streams));

  // Thinking: electric blue-white on stream peaks
  vec3 thinkPeak = vec3(0.40, 0.85, 1.00);
  baseColor = mix(baseColor, thinkPeak, uThinkingIntensity * smoothstep(0.5, 1.0, streams) * 0.7);

  // Speaking: amber-gold on streams
  vec3 speakPeak = vec3(1.00, 0.72, 0.20);
  baseColor = mix(baseColor, speakPeak, uSpeakingProgress * smoothstep(0.45, 1.0, streams) * 0.65);

  // Listening: green ripple filaments
  float audioRidge = 1.0 - abs(snoise(warped * 6.0 + uTime * 2.2));
  audioRidge = pow(clamp(audioRidge, 0.0, 1.0), 3.5);
  vec3 listenColor = vec3(0.10, 1.00, 0.55);
  baseColor = mix(baseColor, listenColor, uAudioAmplitude * audioRidge * 0.55);

  // ── Fresnel rim glow ──────────────────────────────────────────────────────
  vec3 viewDir = normalize(uCameraPosition - vPosition);
  float NdotV   = max(dot(normalize(vNormal), viewDir), 0.0);
  // exp=4.5 → very tight rim, no wide pink bleed
  float fresnel = pow(1.0 - NdotV, 4.5);

  vec3 rimIdle  = vec3(0.75, 0.50, 1.00);
  vec3 rimThink = vec3(0.20, 0.80, 1.00);
  vec3 rimSpeak = vec3(1.00, 0.75, 0.20);
  vec3 rimColor = mix(rimIdle, rimThink, uThinkingIntensity);
  rimColor      = mix(rimColor, rimSpeak, uSpeakingProgress);
  baseColor += fresnel * rimColor * 0.65;

  // ── Core brightness — only on stream peaks, not everywhere ──────────────
  float coreMask = pow(NdotV, 2.5);
  baseColor += coreMask * 0.05 * streams;

  // ── NO Reinhard — keep darks dark, only gamma correct ─────────────────────
  baseColor = pow(max(baseColor, vec3(0.0)), vec3(0.88));  // mild gamma lift
  baseColor = clamp(baseColor, 0.0, 1.0);

  // Alpha: mostly opaque on stream ridges, semi-transparent in void areas
  float alpha = mix(0.65, 0.97, smoothstep(0.0, 0.4, streams) + fresnel * 0.4);

  gl_FragColor = vec4(baseColor, alpha);
}
`;

/**
 * Simple halo / bloom plane behind the orb.
 * A full-screen quad with radial gradient.
 */
export const HALO_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 1.0);
}
`;

export const HALO_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uThinkingIntensity;
uniform float uAudioAmplitude;
uniform float uSpeakingProgress;
varying vec2 vUv;

void main() {
  vec2 center = vec2(0.5, 0.5);
  float d = length(vUv - center);

  // Glow radius expands when thinking
  float glowRadius = 0.22 + uThinkingIntensity * 0.08 + uAudioAmplitude * 0.05;
  float glow = exp(-d * d / (glowRadius * glowRadius)) * 0.35;

  // Color matches orb state
  vec3 baseGlow = mix(vec3(0.25, 0.10, 0.60), vec3(0.10, 0.40, 0.90), uThinkingIntensity);
  baseGlow = mix(baseGlow, vec3(0.80, 0.55, 0.10), uSpeakingProgress * 0.5);
  baseGlow = mix(baseGlow, vec3(0.05, 0.70, 0.35), uAudioAmplitude * 0.4);

  // Subtle time shimmer
  float shimmer = 0.85 + 0.15 * sin(uTime * 0.6);

  gl_FragColor = vec4(baseGlow * shimmer, glow);
}
`;
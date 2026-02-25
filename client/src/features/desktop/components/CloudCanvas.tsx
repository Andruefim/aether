import { useEffect, useRef } from 'react';

interface CloudCanvasProps {
  width: number;
  height: number;
  className?: string;
}

const VERT = `
attribute vec2 a_pos;
varying   vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

// Clean white glass — subtle surface ripple, soft specular, no color tint
const FRAG = `
precision highp float;
varying vec2  v_uv;
uniform float u_time;
uniform vec2  u_res;

vec2 hash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453);
}

float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*(3.0-2.0*f);
  float a = dot(hash2(i),            f);
  float b = dot(hash2(i+vec2(1,0)),  f-vec2(1,0));
  float c = dot(hash2(i+vec2(0,1)),  f-vec2(0,1));
  float d = dot(hash2(i+vec2(1,1)),  f-vec2(1,1));
  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y) * 0.5 + 0.5;
}

float fbm(vec2 p) {
  float v=0.0, a=0.5;
  mat2  m = mat2(1.6, 1.2, -1.2, 1.6);
  for(int i=0;i<3;i++){ v+=a*vnoise(p); p=m*p; a*=0.5; }
  return v;
}

void main() {
  vec2 uv = v_uv;
  vec2 ctr = uv - 0.5;
  float t  = u_time;

  // Very slow, very subtle surface warp
  vec2  q    = uv * 2.5 + vec2(t*0.04, t*0.025);
  float warp = fbm(q) * 0.5 + fbm(q * 1.8 + 4.3) * 0.5;

  // Base: pure near-white, almost no hue
  // Tiny cool shift at edges, warm at center — like backlit frosted glass
  float warmth = 1.0 - smoothstep(0.0, 0.55, length(ctr));
  vec3 base = mix(
    vec3(0.90, 0.92, 0.95),  // cool edge (very faint blue)
    vec3(0.98, 0.98, 0.97),  // warm centre (almost pure white)
    warmth
  );

  // Subtle brightness ripple from warp field — monochrome only
  float ripple = (warp - 0.5) * 0.06;
  base += ripple;

  // Single soft specular highlight — top-left, stationary-ish
  vec2  lightDir = normalize(vec2(0.4, 0.7));
  float spec = pow(max(0.0, 1.0 - length(uv - vec2(0.28, 0.72))), 6.0);
  // Animate gently
  spec *= 0.7 + 0.3*sin(t*0.3);
  base += spec * 0.08;

  // Moving micro-specular (caustic trace) — very subtle
  float caustic = pow(max(0.0, sin(warp * 14.0 - t*0.35)), 10.0);
  base += caustic * 0.06;

  // Vignette: slightly darker corners
  float vig = 1.0 - 0.18 * dot(ctr*2.0, ctr*2.0);
  base *= clamp(vig, 0.0, 1.0);

  base = clamp(base, 0.0, 1.0);
  gl_FragColor = vec4(base, 1.0);
}
`;

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  return s;
}

export function CloudCanvas({ width, height, className }: CloudCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl', { alpha: false, antialias: false });
    if (!gl) return;

    const vert = compile(gl, gl.VERTEX_SHADER,   VERT);
    const frag = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vert);
    gl.attachShader(prog, frag);
    gl.linkProgram(prog);
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    const pos = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);

    const uTime = gl.getUniformLocation(prog, 'u_time');
    const uRes  = gl.getUniformLocation(prog, 'u_res');
    gl.uniform2f(uRes, width, height);

    let raf: number;
    const start = performance.now();
    const render = () => {
      gl.uniform1f(uTime, (performance.now() - start) / 1000);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      raf = requestAnimationFrame(render);
    };
    render();

    return () => { cancelAnimationFrame(raf); gl.deleteProgram(prog); gl.deleteBuffer(buf); };
  }, [width, height]);

  return <canvas ref={canvasRef} width={width} height={height} className={className} />;
}
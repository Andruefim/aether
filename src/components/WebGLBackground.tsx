import React, { useRef, useMemo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useAetherStore } from '../store';

const snoise = `
// Simplex 2D noise
vec3 permute(vec3 x) { return mod(((x*34.0)+1.0)*x, 289.0); }
float snoise(vec2 v){
  const vec4 C = vec4(0.211324865405187, 0.366025403784439,
           -0.577350269189626, 0.024390243902439);
  vec2 i  = floor(v + dot(v, C.yy) );
  vec2 x0 = v -   i + dot(i, C.xx);
  vec2 i1;
  i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 ))
  + i.x + vec3(0.0, i1.x, 1.0 ));
  vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy),
    dot(x12.zw,x12.zw)), 0.0);
  m = m*m ;
  m = m*m ;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h );
  vec3 g;
  g.x  = a0.x  * x0.x  + h.x  * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}
`;

const BackgroundPlane = () => {
  const materialRef = useRef<THREE.ShaderMaterial>(null);

  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uBeige: { value: new THREE.Vector3(0.93, 0.88, 0.80) },
  }), []);

  useFrame((state) => {
    if (materialRef.current) {
      materialRef.current.uniforms.uTime.value = state.clock.elapsedTime;
    }
  });

  return (
    <mesh>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial
        ref={materialRef}
        uniforms={uniforms}
        vertexShader={`
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = vec4(position, 1.0);
          }
        `}
        fragmentShader={`
          uniform float uTime;
          uniform vec3 uBeige;
          varying vec2 vUv;
          void main() {
            float band = 0.024 + 0.004 * sin(uTime * 0.7);
            float left = smoothstep(0.0, band, vUv.x);
            float right = smoothstep(1.0, 1.0 - band, vUv.x);
            float bottom = smoothstep(0.0, band, vUv.y);
            float top = smoothstep(1.0, 1.0 - band, vUv.y);
            float inRect = left * right * bottom * top;
            vec3 centerColor = uBeige * 0.8;
            vec3 edgeColor = uBeige * 0.88;
            vec3 color = mix(edgeColor, centerColor, inRect);
            gl_FragColor = vec4(color, 1.0);
          }
        `}
        depthWrite={false}
      />
    </mesh>
  );
};

const CrystallizationEffect = ({ widget }: { widget: any }) => {
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const { size, viewport } = useThree();

  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uProgress: { value: widget.progress || 0 },
    uResolution: { value: new THREE.Vector2(size.width, size.height) },
    uPosition: { value: new THREE.Vector2(widget.position_x, widget.position_y) },
    uSize: { value: new THREE.Vector2(widget.width, widget.height) },
  }), [size, widget.position_x, widget.position_y, widget.width, widget.height]);

  useFrame((state) => {
    if (materialRef.current) {
      materialRef.current.uniforms.uTime.value = state.clock.elapsedTime;
      materialRef.current.uniforms.uProgress.value = widget.progress || 0;
    }
  });

  return (
    <mesh>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial
        ref={materialRef}
        uniforms={uniforms}
        transparent={true}
        blending={THREE.AdditiveBlending}
        vertexShader={`
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = vec4(position, 1.0);
          }
        `}
        fragmentShader={`
          uniform float uTime;
          uniform float uProgress;
          uniform vec2 uResolution;
          uniform vec2 uPosition;
          uniform vec2 uSize;
          varying vec2 vUv;
          ${snoise}
          
          void main() {
            // Convert pixel coordinates to UV space (0 to 1)
            vec2 pixelCoord = vUv * uResolution;
            
            // Widget bounds
            vec2 widgetCenter = uPosition + uSize * 0.5;
            vec2 dist = abs(pixelCoord - widgetCenter) - uSize * 0.5;
            float d = length(max(dist, 0.0)) + min(max(dist.x, dist.y), 0.0);
            
            // Phase 1: Emergence (0-0.3)
            // Phase 2: Crystallization (0.3-0.8)
            // Phase 3: Materialization (0.8-1.0)
            
            float noise = snoise(vUv * 10.0 + uTime * 0.5);
            
            // Glow intensity based on distance to widget center
            float glowRadius = mix(400.0, 50.0, smoothstep(0.0, 0.8, uProgress));
            float glow = exp(-max(d, 0.0) / glowRadius);
            
            // Add noise to glow
            glow *= smoothstep(0.3, 0.7, noise * 0.5 + 0.5);
            
            // Fade out at the end
            float alpha = glow * (1.0 - smoothstep(0.8, 1.0, uProgress));
            
            gl_FragColor = vec4(0.31, 0.56, 0.97, alpha * 0.8);
          }
        `}
      />
    </mesh>
  );
};

export const WebGLBackground: React.FC = () => {
  const widgets = useAetherStore(state => state.widgets);
  const generatingWidgets = widgets.filter(w => w.isGenerating);

  return (
    <div className="absolute inset-0 pointer-events-none z-0">
      <Canvas orthographic camera={{ position: [0, 0, 1], zoom: 1 }}>
        <BackgroundPlane />
        {generatingWidgets.map(w => (
          <CrystallizationEffect key={w.id} widget={w} />
        ))}
      </Canvas>
    </div>
  );
};

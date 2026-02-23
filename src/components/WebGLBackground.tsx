import React, { useRef, useMemo, useState, useEffect } from 'react';
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

const BG_COLOR = new THREE.Color('#ede6da');

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

const FADE_OUT_DURATION_MS = 700;
// Very short fade-in so effect is visible immediately but not a hard pop
const FADE_IN_DURATION_S = 0.5;

const CrystallizationEffect = ({
  widget,
  fadeOutEndTime,
}: {
  widget: any;
  fadeOutEndTime?: number;
}) => {
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const displayProgressRef = useRef(0);
  // Track when this effect was first rendered so we can fade in immediately
  const mountTimeRef = useRef<number | null>(null);
  const { size } = useThree();

  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uProgress: { value: 0 },
    uEffectAlpha: { value: 0 },
    uResolution: { value: new THREE.Vector2(size.width, size.height) },
    uPosition: { value: new THREE.Vector2(widget.position_x, widget.position_y) },
    uSize: { value: new THREE.Vector2(widget.width, widget.height) },
  }), [size.width, size.height, widget.position_x, widget.position_y, widget.width, widget.height]);

  useFrame((state) => {
    if (!materialRef.current) return;

    // Record mount time on first frame
    if (mountTimeRef.current === null) {
      mountTimeRef.current = state.clock.elapsedTime;
    }
    const sinceMount = state.clock.elapsedTime - mountTimeRef.current;

    materialRef.current.uniforms.uTime.value = state.clock.elapsedTime;

    const targetProgress = widget.progress ?? 0;
    displayProgressRef.current += (targetProgress - displayProgressRef.current) * 0.028;
    materialRef.current.uniforms.uProgress.value = displayProgressRef.current;

    if (fadeOutEndTime != null) {
      // Fade out: driven by elapsed time vs fadeOutEndTime
      const elapsedMs = state.clock.elapsedTime * 1000;
      const t = (elapsedMs - (fadeOutEndTime - FADE_OUT_DURATION_MS)) / FADE_OUT_DURATION_MS;
      materialRef.current.uniforms.uEffectAlpha.value = Math.max(0, 1 - t);
    } else {
      // Fade in from mount — starts immediately, reaches 1 after FADE_IN_DURATION_S seconds
      // This is completely independent of generation progress so the effect appears right away
      const t = Math.min(1, sinceMount / FADE_IN_DURATION_S);
      const fadeIn = 1 - (1 - t) * (1 - t); // ease-out quad
      materialRef.current.uniforms.uEffectAlpha.value = fadeIn;
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
          uniform float uEffectAlpha;
          uniform vec2 uResolution;
          uniform vec2 uPosition;
          uniform vec2 uSize;
          varying vec2 vUv;
          ${snoise}
          
          void main() {
            vec2 pixelCoord = vUv * uResolution;
            vec2 widgetCenter = uPosition + uSize * 0.5;
            vec2 dist = abs(pixelCoord - widgetCenter) - uSize * 0.5;
            float d = length(max(dist, 0.0)) + min(max(dist.x, dist.y), 0.0);
            
            float p = uProgress;

            // phase0: soft ambient glow visible immediately at p=0,
            // low intensity so it doesn't overpower — fades out as real phases take over
            float phase0 = (1.0 - smoothstep(0.0, 0.35, p)) * 0.25;
            float phase1 = smoothstep(0.0, 0.33, p) * (1.0 - smoothstep(0.33, 0.4, p));
            float phase2 = smoothstep(0.28, 0.4, p) * (1.0 - smoothstep(0.66, 0.75, p));
            float phase3 = smoothstep(0.6, 0.75, p);
            
            float noise = snoise(vUv * 10.0 + uTime * 0.5);
            float noiseFine = snoise(vUv * 25.0 + uTime * 1.2);
            
            float glowRadius = 450.0 * (1.0 - p * 0.85) + 80.0;
            float glow = exp(-max(d, 0.0) / glowRadius);
            
            float pattern = 0.6 + 0.4 * smoothstep(0.2, 0.8, noise * 0.5 + 0.5);
            pattern *= phase0 + phase1 + phase2 * (0.7 + 0.3 * noiseFine) + phase3 * (0.5 + 0.5 * smoothstep(0.0, 0.3, 1.0 - p));
            
            float alpha = glow * pattern * (1.0 - smoothstep(0.85, 1.0, p)) * uEffectAlpha;
            
            gl_FragColor = vec4(0.28, 0.52, 0.95, alpha * 0.85);
          }
        `}
      />
    </mesh>
  );
};

// One entry per widget id. We never unmount+remount — we only update fadeOutEndTime.
// Two separate lists with different keys (w.id vs fade-${w.id}) caused a one-frame
// gap on transition: old component unmounted, new one not yet painted → WebGL
// cleared to white → visible flash.
type EffectEntry = { widget: any; fadeOutEndTime?: number };

export const WebGLBackground: React.FC = () => {
  const widgets = useAetherStore(state => state.widgets);

  const [effects, setEffects] = useState<Map<string, EffectEntry>>(new Map());
  const prevGeneratingIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    // Derive inside the effect — if computed outside, .filter() returns a new
    // array reference every render, which would make [widgets, generatingWidgets]
    // always "changed" → setEffects → re-render → infinite loop.
    const generatingWidgets = widgets.filter(w => w.isGenerating);
    const now = Date.now();
    const generatingIds = new Set(generatingWidgets.map(w => w.id));
    const prev = prevGeneratingIdsRef.current;
    const finishedIds = Array.from(prev).filter(id => !generatingIds.has(id));
    prevGeneratingIdsRef.current = generatingIds;

    setEffects(prevMap => {
      const next = new Map(prevMap);

      for (const w of generatingWidgets) {
        next.set(w.id, { widget: w });
      }

      for (const id of finishedIds) {
        const w = widgets.find(w => w.id === id);
        if (w) next.set(id, { widget: w, fadeOutEndTime: now + FADE_OUT_DURATION_MS });
      }

      // Prune fully faded entries
      for (const [id, entry] of next) {
        if (entry.fadeOutEndTime && entry.fadeOutEndTime <= now) next.delete(id);
      }

      return next;
    });
  }, [widgets]); // widgets ref is stable when store content unchanged

  // Prune expired fade-out entries — runs once on mount, functional updater
  // means it never needs to read `effects` from closure → no dep-loop
  useEffect(() => {
    const t = setInterval(() => {
      const now = Date.now();
      setEffects(prev => {
        let changed = false;
        const next = new Map(prev);
        for (const [id, entry] of next) {
          if (entry.fadeOutEndTime && entry.fadeOutEndTime <= now) {
            next.delete(id);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 100);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="absolute inset-0 pointer-events-none z-0">
      <Canvas
        orthographic
        camera={{ position: [0, 0, 1], zoom: 1 }}
        onCreated={({ gl, scene }) => {
          // Set on both gl and scene so it survives re-renders:
          // setClearColor alone can be overridden by R3F internals,
          // scene.background is respected every frame by Three.js renderer.
          gl.setClearColor(BG_COLOR, 1);
          scene.background = BG_COLOR;
        }}
      >
        <BackgroundPlane />
        {Array.from(effects.entries()).map(([id, { widget, fadeOutEndTime }]) => (
          <CrystallizationEffect
            key={id}
            widget={widget}
            fadeOutEndTime={fadeOutEndTime}
          />
        ))}
      </Canvas>
    </div>
  );
};
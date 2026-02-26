import React, { useRef, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import {
  FADE_OUT_DURATION_MS,
  FADE_IN_DURATION_S,
  SNOISE_GLSL,
  CRYSTAL_FRAGMENT,
  CRYSTAL_VERTEX,
} from '../constants';
import type { WidgetEffectData } from '../types';

type Props = {
  widget: WidgetEffectData;
  fadeOutEndTime?: number;
};

export function CrystallizationEffect({ widget, fadeOutEndTime }: Props) {
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const displayProgressRef = useRef(0);
  const mountTimeRef = useRef<number | null>(null);
  const { size } = useThree();

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uProgress: { value: 0 },
      uEffectAlpha: { value: 0 },
      uResolution: { value: new THREE.Vector2(size.width, size.height) },
      uPosition: { value: new THREE.Vector2(widget.position_x, widget.position_y) },
      uSize: { value: new THREE.Vector2(widget.width, widget.height) },
    }),
    [size.width, size.height, widget.position_x, widget.position_y, widget.width, widget.height],
  );

  useFrame((state) => {
    if (!materialRef.current) return;
    if (mountTimeRef.current === null) mountTimeRef.current = state.clock.elapsedTime;
    const sinceMount = state.clock.elapsedTime - mountTimeRef.current;

    materialRef.current.uniforms.uTime.value = state.clock.elapsedTime;
    const targetProgress = widget.progress ?? 0;
    displayProgressRef.current += (targetProgress - displayProgressRef.current) * 0.028;
    materialRef.current.uniforms.uProgress.value = displayProgressRef.current;

    if (fadeOutEndTime != null) {
      const elapsedMs = state.clock.elapsedTime * 1000;
      const t =
        (elapsedMs - (fadeOutEndTime - FADE_OUT_DURATION_MS)) / FADE_OUT_DURATION_MS;
      materialRef.current.uniforms.uEffectAlpha.value = Math.max(0, 1 - t);
    } else {
      const t = Math.min(1, sinceMount / FADE_IN_DURATION_S);
      const fadeIn = 1 - (1 - t) * (1 - t);
      materialRef.current.uniforms.uEffectAlpha.value = fadeIn;
    }
  });

  return (
    <mesh>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial
        ref={materialRef}
        uniforms={uniforms}
        transparent
        blending={THREE.AdditiveBlending}
        vertexShader={CRYSTAL_VERTEX}
        fragmentShader={`${SNOISE_GLSL}\n${CRYSTAL_FRAGMENT}`}
      />
    </mesh>
  );
}

import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useAetherStore } from '../../../../core';
import { BACKGROUND_VERTEX, BACKGROUND_FRAGMENT } from '../constants';

export function BackgroundPlane() {
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const anyDesktopGenerating = useAetherStore(
    (s) => s.widgets.some((w) => w.isGenerating),
  );
  const aetherIsGenerating = useAetherStore((s) => s.aetherIsGenerating);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uBeige: { value: new THREE.Vector3(0.93, 0.88, 0.8) },
      uHighlight: { value: 0 },
    }),
    [],
  );

  useFrame((state) => {
    if (materialRef.current) {
      materialRef.current.uniforms.uTime.value = state.clock.elapsedTime;
      const target = anyDesktopGenerating || aetherIsGenerating ? 1 : 0;
      const current = materialRef.current.uniforms.uHighlight.value as number;
      materialRef.current.uniforms.uHighlight.value = THREE.MathUtils.lerp(
        current,
        target,
        0.08,
      );
    }
  });

  return (
    <mesh>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial
        ref={materialRef}
        uniforms={uniforms}
        vertexShader={BACKGROUND_VERTEX}
        fragmentShader={BACKGROUND_FRAGMENT}
        depthWrite={false}
      />
    </mesh>
  );
}

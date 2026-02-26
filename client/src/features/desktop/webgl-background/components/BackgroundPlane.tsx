import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { BACKGROUND_VERTEX, BACKGROUND_FRAGMENT } from '../constants';

export function BackgroundPlane() {
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uBeige: { value: new THREE.Vector3(0.93, 0.88, 0.8) },
    }),
    [],
  );

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
        vertexShader={BACKGROUND_VERTEX}
        fragmentShader={BACKGROUND_FRAGMENT}
        depthWrite={false}
      />
    </mesh>
  );
}

import React, { useRef, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useAetherStore } from '../../../core';
import {
  SNOISE_3D_GLSL,
  ORB_VERTEX,
  ORB_FRAGMENT,
  HALO_VERTEX,
  HALO_FRAGMENT,
} from '../shaders/orbShaders';

/**
 * NovaOrb — the central reactive orb.
 *
 * Uniform mapping:
 *   uThinkingIntensity  → aetherIsGenerating
 *   uAudioAmplitude     → aetherIsListening (simulated pulse)
 *   uSpeakingProgress   → aetherIsSpeaking
 */
export function NovaOrb() {
  const orbRef = useRef<THREE.Mesh>(null);
  const orbMatRef = useRef<THREE.ShaderMaterial>(null);
  const haloMatRef = useRef<THREE.ShaderMaterial>(null);

  const isGenerating = useAetherStore((s) => s.aetherIsGenerating);
  const isListening  = useAetherStore((s) => s.aetherIsListening);
  const isSpeaking   = useAetherStore((s) => s.aetherIsSpeaking);

  const { camera } = useThree();

  const orbUniforms = useMemo(
    () => ({
      uTime:              { value: 0 },
      uThinkingIntensity: { value: 0 },
      uAudioAmplitude:    { value: 0 },
      uSpeakingProgress:  { value: 0 },
      uCameraPosition:    { value: new THREE.Vector3() },
    }),
    [],
  );

  const haloUniforms = useMemo(
    () => ({
      uTime:              { value: 0 },
      uThinkingIntensity: { value: 0 },
      uAudioAmplitude:    { value: 0 },
      uSpeakingProgress:  { value: 0 },
    }),
    [],
  );

  useFrame((state) => {
    const t = state.clock.elapsedTime;

    // ── lerp targets ──────────────────────────────────────────────────────
    const targetThinking = isGenerating ? 1 : 0;
    const targetSpeaking = isSpeaking   ? 1 : 0;

    // Simulate audio amplitude: sine pulse while listening, fade out otherwise
    const targetAudio = isListening
      ? 0.4 + 0.35 * Math.abs(Math.sin(t * 3.5))
      : 0;

    const LERP_SLOW = 0.035;
    const LERP_FAST = 0.08;

    if (orbMatRef.current) {
      const u = orbMatRef.current.uniforms;
      u.uTime.value              = t;
      u.uThinkingIntensity.value = THREE.MathUtils.lerp(u.uThinkingIntensity.value, targetThinking, LERP_SLOW);
      u.uAudioAmplitude.value    = THREE.MathUtils.lerp(u.uAudioAmplitude.value,    targetAudio,    LERP_FAST);
      u.uSpeakingProgress.value  = THREE.MathUtils.lerp(u.uSpeakingProgress.value,  targetSpeaking, LERP_SLOW);
      u.uCameraPosition.value.copy(camera.position);
    }

    if (haloMatRef.current) {
      const u = haloMatRef.current.uniforms;
      u.uTime.value              = t;
      u.uThinkingIntensity.value = THREE.MathUtils.lerp(u.uThinkingIntensity.value, targetThinking, LERP_SLOW);
      u.uAudioAmplitude.value    = THREE.MathUtils.lerp(u.uAudioAmplitude.value,    targetAudio,    LERP_FAST);
      u.uSpeakingProgress.value  = THREE.MathUtils.lerp(u.uSpeakingProgress.value,  targetSpeaking, LERP_SLOW);
    }

    // Slow idle rotation + breathing scale
    if (orbRef.current) {
      orbRef.current.rotation.y = t * 0.07;
      orbRef.current.rotation.x = Math.sin(t * 0.11) * 0.06;
      const breathe = 1 + Math.sin(t * 0.75) * 0.022;
      const thinkScale = 1 + (orbMatRef.current?.uniforms.uThinkingIntensity.value ?? 0) * 0.06;
      orbRef.current.scale.setScalar(breathe * thinkScale);
    }
  });

  return (
    <group>
      {/* Halo bloom behind the orb */}
      <mesh renderOrder={0}>
        <planeGeometry args={[2, 2]} />
        <shaderMaterial
          ref={haloMatRef}
          uniforms={haloUniforms}
          vertexShader={HALO_VERTEX}
          fragmentShader={HALO_FRAGMENT}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      {/* Core orb sphere */}
      <mesh ref={orbRef} renderOrder={1}>
        {/* detail=7 → ~163k triangles — prevents faceting from vertex displacement */}
        <icosahedronGeometry args={[1.0, 300]} />
        <shaderMaterial
          ref={orbMatRef}
          uniforms={orbUniforms}
          vertexShader={`${SNOISE_3D_GLSL}\n${ORB_VERTEX}`}
          fragmentShader={`${SNOISE_3D_GLSL}\n${ORB_FRAGMENT}`}
          transparent
          side={THREE.FrontSide}
        />
      </mesh>
    </group>
  );
}
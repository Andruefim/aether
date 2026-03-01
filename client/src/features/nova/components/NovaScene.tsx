import React from 'react';
import { NovaOrb } from './NovaOrb';

/**
 * NovaScene — sets up the Three.js scene content.
 * Rendered inside an R3F <Canvas>.
 */
export function NovaScene() {
  return (
    <>
      {/* Ambient fill */}
      <ambientLight intensity={0.15} />

      {/* Key light from upper-left — gives slight depth */}
      <pointLight position={[-3, 3, 4]} intensity={1.2} color="#a070ff" />

      {/* Fill light from right — warm undertone */}
      <pointLight position={[3, -1, 3]} intensity={0.6} color="#ff9040" />

      {/* Rim from behind */}
      <pointLight position={[0, 0, -5]} intensity={0.4} color="#4080ff" />

      {/* The star of the show */}
      <NovaOrb />
    </>
  );
}
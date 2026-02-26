import React from 'react';
import { Canvas } from '@react-three/fiber';
import { useCrystallizationEffects } from './hooks';
import { BackgroundPlane, CrystallizationEffect } from './components';
import { BG_COLOR } from './constants';

export const WebGLBackground: React.FC = () => {
  const effects = useCrystallizationEffects();

  return (
    <div className="absolute inset-0 pointer-events-none z-0">
      <Canvas
        orthographic
        camera={{ position: [0, 0, 1], zoom: 1 }}
        onCreated={({ gl, scene }) => {
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

import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useAetherStore } from './core';
import { DesktopPage } from './features/desktop';
import { AetherPage } from './features/aether';
import { NovaPage } from './features/nova';
import { NovaSpacePage } from './features/nova-space';
import { ModeSwitch } from './shared/ModeSwitch';
import { WebGLBackground } from './shared/features/webgl-background';

export default function App() {
  const appMode = useAetherStore((s) => s.appMode);
  const isDark = appMode === 'nova' || appMode === 'space';

  const isNovaFamily = appMode === 'nova' || appMode === 'space';

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#ede6da]">
      {!isDark && <WebGLBackground />}

      <ModeSwitch />

      {/* Desktop / Aether — animated in/out normally */}
      <AnimatePresence mode="sync">
        {appMode === 'desktop' && (
          <motion.div key="desktop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }} className="absolute inset-0 z-10">
            <DesktopPage />
          </motion.div>
        )}
        {appMode === 'aether' && (
          <motion.div key="aether" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }} className="absolute inset-0 z-10">
            <AetherPage />
          </motion.div>
        )}
      </AnimatePresence>

      {/*
        Nova + Nova Space are always mounted once the user enters the Nova family.
        Switching between them uses CSS visibility so all React state (SSE connections,
        Zustand selectors, Three.js canvases) is preserved across tab changes.
      */}
      {isNovaFamily && (
        <>
          <div
            className="absolute inset-0 z-10"
            style={{
              visibility: appMode === 'nova' ? 'visible' : 'hidden',
              pointerEvents: appMode === 'nova' ? 'auto' : 'none',
              opacity: appMode === 'nova' ? 1 : 0,
              transition: 'opacity 0.3s ease',
            }}
          >
            <NovaPage />
          </div>
          <div
            className="absolute inset-0 z-10"
            style={{
              visibility: appMode === 'space' ? 'visible' : 'hidden',
              pointerEvents: appMode === 'space' ? 'auto' : 'none',
              opacity: appMode === 'space' ? 1 : 0,
              transition: 'opacity 0.3s ease',
            }}
          >
            <NovaSpacePage />
          </div>
        </>
      )}
    </div>
  );
}
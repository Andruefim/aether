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

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#ede6da]">
      {!isDark && <WebGLBackground />}

      <ModeSwitch />

      <AnimatePresence mode="sync">
        {appMode === 'desktop' ? (
          <motion.div key="desktop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }} className="absolute inset-0 z-10">
            <DesktopPage />
          </motion.div>
        ) : appMode === 'aether' ? (
          <motion.div key="aether" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }} className="absolute inset-0 z-10">
            <AetherPage />
          </motion.div>
        ) : appMode === 'space' ? (
          <motion.div key="space" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.4 }} className="absolute inset-0 z-10">
            <NovaSpacePage />
          </motion.div>
        ) : (
          <motion.div key="nova" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.4 }} className="absolute inset-0 z-10">
            <NovaPage />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
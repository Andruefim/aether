import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useAetherStore } from './core';
import { DesktopPage } from './features/desktop';
import { AetherPage } from './features/aether';
import { ModeSwitch } from './shared/ModeSwitch';

export default function App() {
  const appMode = useAetherStore((s) => s.appMode);

  return (
    <div className="relative w-screen h-screen overflow-hidden">
      {/* Global mode switcher — always visible */}
      <ModeSwitch />

      {/* Page transitions */}
      <AnimatePresence mode="sync">
        {appMode === 'desktop' ? (
          <motion.div
            key="desktop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="absolute inset-0"
          >
            <DesktopPage />
          </motion.div>
        ) : (
          <motion.div
            key="aether"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="absolute inset-0"
          >
            <AetherPage />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

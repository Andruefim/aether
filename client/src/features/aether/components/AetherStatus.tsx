import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { RotateCcw, X } from 'lucide-react';
import { useAetherStore } from '../../../core';

interface AetherStatusProps {
  dialogueText: string | null;
  onDismissDialogue: () => void;
}

export function AetherStatus({ dialogueText, onDismissDialogue }: AetherStatusProps) {
  const status = useAetherStore((s) => s.aetherStatus);
  const isGenerating = useAetherStore((s) => s.aetherIsGenerating);
  const lastAction = useAetherStore((s) => s.aetherLastAction);
  const previousHtml = useAetherStore((s) => s.aetherPreviousHtml);
  const revertAetherHtml = useAetherStore((s) => s.revertAetherHtml);
  const setAetherHtml = useAetherStore((s) => s.setAetherHtml);

  const showUndo = !isGenerating && previousHtml && lastAction === 'generate_ui';

  return (
    <>
      {/* Status indicator — top center */}
      <AnimatePresence>
        {status && (
          <motion.div
            key="status"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            className="fixed top-20 left-1/2 -translate-x-1/2 z-40 pointer-events-none"
          >
            <div className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-black/25 backdrop-blur-xl border border-white/10 text-white/60 text-xs font-medium">
              {isGenerating && (
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
              )}
              {status}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Undo button — appears after a UI generation */}
      <AnimatePresence>
        {showUndo && (
          <motion.button
            key="undo"
            type="button"
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.85 }}
            transition={{ duration: 0.2 }}
            onClick={() => {
              revertAetherHtml();
              setAetherHtml(previousHtml);
            }}
            className="fixed top-14 right-6 z-40 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/20 backdrop-blur-xl border border-white/10 text-white/40 hover:text-white/70 hover:border-white/20 transition-colors text-xs"
          >
            <RotateCcw size={11} />
            Undo
          </motion.button>
        )}
      </AnimatePresence>

      {/* Dialogue response overlay — bottom left */}
      <AnimatePresence>
        {dialogueText && (
          <motion.div
            key="dialogue"
            initial={{ opacity: 0, y: 12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 320, damping: 30 }}
            className="fixed bottom-28 left-6 z-40 max-w-sm"
          >
            <div className="relative p-4 rounded-2xl bg-black/30 backdrop-blur-xl border border-white/10 shadow-2xl">
              <button
                type="button"
                onClick={onDismissDialogue}
                className="absolute top-2.5 right-2.5 p-1 rounded-lg text-white/30 hover:text-white/60 hover:bg-white/10 transition-colors"
              >
                <X size={12} />
              </button>
              <p className="text-white/80 text-sm leading-relaxed pr-5">{dialogueText}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

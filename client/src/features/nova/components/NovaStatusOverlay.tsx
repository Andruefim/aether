import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X } from 'lucide-react';
import { useAetherStore } from '../../../core';

interface NovaStatusOverlayProps {
  dialogueText: string | null;
  onDismiss: () => void;
}

/**
 * Minimal status overlay for Nova mode:
 * - Top-center: generation status pill
 * - Bottom-left: dialogue response bubble
 */
export function NovaStatusOverlay({ dialogueText, onDismiss }: NovaStatusOverlayProps) {
  const status      = useAetherStore((s) => s.aetherStatus);
  const isGenerating = useAetherStore((s) => s.aetherIsGenerating);
  const isListening  = useAetherStore((s) => s.aetherIsListening);
  const isSpeaking   = useAetherStore((s) => s.aetherIsSpeaking);

  const statusText =
    status ??
    (isListening ? 'Listening…' : isSpeaking ? 'Speaking…' : null);

  return (
    <>
      {/* Status pill — top center */}
      <AnimatePresence>
        {statusText && (
          <motion.div
            key="nova-status"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="fixed top-20 left-1/2 -translate-x-1/2 z-40 pointer-events-none"
          >
            <div className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/5 backdrop-blur-xl border border-white/10 text-white/50 text-xs font-medium">
              {isGenerating && (
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
              )}
              {isListening && (
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              )}
              {isSpeaking && (
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              )}
              {statusText}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Dialogue bubble — bottom left */}
      <AnimatePresence>
        {dialogueText && (
          <motion.div
            key="nova-dialogue"
            initial={{ opacity: 0, y: 12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 320, damping: 30 }}
            className="fixed bottom-28 left-6 z-40 max-w-sm"
          >
            <div className="relative p-4 rounded-2xl bg-black/40 backdrop-blur-xl border border-white/10 shadow-2xl">
              <button
                type="button"
                onClick={onDismiss}
                className="absolute top-2.5 right-2.5 p-1 rounded-lg text-white/30 hover:text-white/60 hover:bg-white/10 transition-colors"
              >
                <X size={12} />
              </button>
              <p className="text-white/80 text-sm leading-relaxed pr-5">
                {dialogueText}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
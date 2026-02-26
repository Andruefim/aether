import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Mic, MicOff, Loader2 } from 'lucide-react';
import type { VoiceState } from '../hooks';

interface VoiceButtonProps {
  state: VoiceState;
  onStart: () => void;
  onStop: () => void;
}

export function VoiceButton({ state, onStart, onStop }: VoiceButtonProps) {
  const isListening = state === 'listening';
  const isProcessing = state === 'processing';
  const isError = state === 'error';
  const isActive = isListening || isProcessing;

  const handleClick = () => {
    if (isListening) onStop();
    else if (state === 'idle' || isError) onStart();
  };

  return (
    <div className="relative flex items-center justify-center">
      {/* Listening pulse rings */}
      <AnimatePresence>
        {isListening && (
          <>
            <motion.div
              key="ring1"
              className="absolute rounded-full border border-red-400/40"
              initial={{ width: 36, height: 36, opacity: 0.7 }}
              animate={{ width: 60, height: 60, opacity: 0 }}
              transition={{ duration: 1.2, repeat: Infinity, ease: 'easeOut' }}
            />
            <motion.div
              key="ring2"
              className="absolute rounded-full border border-red-400/25"
              initial={{ width: 36, height: 36, opacity: 0.5 }}
              animate={{ width: 80, height: 80, opacity: 0 }}
              transition={{ duration: 1.2, repeat: Infinity, ease: 'easeOut', delay: 0.3 }}
            />
          </>
        )}
      </AnimatePresence>

      {/* Main button */}
      <motion.button
        type="button"
        onClick={handleClick}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        animate={{
          backgroundColor: isListening
            ? 'rgba(239, 68, 68, 0.25)'
            : isProcessing
              ? 'rgba(99, 102, 241, 0.25)'
              : isError
                ? 'rgba(245, 158, 11, 0.15)'
                : 'rgba(255,255,255,0.08)',
          borderColor: isListening
            ? 'rgba(239, 68, 68, 0.5)'
            : isProcessing
              ? 'rgba(99, 102, 241, 0.5)'
              : 'rgba(255,255,255,0.15)',
        }}
        transition={{ duration: 0.2 }}
        className="relative z-10 w-10 h-10 rounded-xl border flex items-center justify-center"
        aria-label={isListening ? 'Stop recording' : 'Start voice input'}
        title={isListening ? 'Stop recording' : 'Voice input (Russian / English)'}
        disabled={isProcessing}
      >
        <AnimatePresence mode="wait">
          {isProcessing ? (
            <motion.div
              key="loader"
              initial={{ opacity: 0, rotate: -90 }}
              animate={{ opacity: 1, rotate: 0 }}
              exit={{ opacity: 0 }}
            >
              <Loader2 size={18} className="text-indigo-400 animate-spin" />
            </motion.div>
          ) : isListening ? (
            <motion.div
              key="mic-on"
              initial={{ opacity: 0, scale: 0.7 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.7 }}
            >
              <MicOff size={18} className="text-red-400" />
            </motion.div>
          ) : (
            <motion.div
              key="mic-off"
              initial={{ opacity: 0, scale: 0.7 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.7 }}
            >
              <Mic size={18} className={isError ? 'text-amber-400' : 'text-white/60'} />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.button>
    </div>
  );
}

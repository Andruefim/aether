import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Phone, PhoneOff, Mic, Loader2, Volume2 } from 'lucide-react';
import type { AgentPhase } from '../hooks/useVoiceAgent';

interface VoiceAgentButtonProps {
  isActive: boolean;
  phase: AgentPhase;
  onStart: () => void;
  onStop: () => void;
}

const PHASE_COLORS = {
  idle:       'rgba(255,255,255,0.08)',
  listening:  'rgba(34, 197, 94, 0.25)',   // green
  processing: 'rgba(99, 102, 241, 0.25)',  // indigo
  speaking:   'rgba(251, 191, 36, 0.25)',  // amber
  generating: 'rgba(168, 85, 247, 0.25)',  // purple
};

const PHASE_BORDER = {
  idle:       'rgba(255,255,255,0.15)',
  listening:  'rgba(34, 197, 94, 0.6)',
  processing: 'rgba(99, 102, 241, 0.6)',
  speaking:   'rgba(251, 191, 36, 0.6)',
  generating: 'rgba(168, 85, 247, 0.6)',
};

export function VoiceAgentButton({ isActive, phase, onStart, onStop }: VoiceAgentButtonProps) {
  const handleClick = () => {
    if (isActive) onStop();
    else onStart();
  };

  return (
    <div className="relative flex items-center justify-center">
      {/* Outer pulse rings when listening */}
      <AnimatePresence>
        {phase === 'listening' && (
          <>
            <motion.div
              key="ring1"
              className="absolute rounded-full border border-green-400/30"
              initial={{ width: 40, height: 40, opacity: 0.8 }}
              animate={{ width: 70, height: 70, opacity: 0 }}
              transition={{ duration: 1.5, repeat: Infinity, ease: 'easeOut' }}
            />
            <motion.div
              key="ring2"
              className="absolute rounded-full border border-green-400/20"
              initial={{ width: 40, height: 40, opacity: 0.6 }}
              animate={{ width: 90, height: 90, opacity: 0 }}
              transition={{ duration: 1.5, repeat: Infinity, ease: 'easeOut', delay: 0.4 }}
            />
          </>
        )}
        {phase === 'speaking' && (
          <motion.div
            key="speak-ring"
            className="absolute rounded-full border border-amber-400/30"
            initial={{ width: 40, height: 40, opacity: 0.8 }}
            animate={{ width: 65, height: 65, opacity: 0 }}
            transition={{ duration: 1, repeat: Infinity, ease: 'easeOut' }}
          />
        )}
      </AnimatePresence>

      <motion.button
        type="button"
        onClick={handleClick}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.92 }}
        animate={{
          backgroundColor: PHASE_COLORS[phase] ?? PHASE_COLORS.idle,
          borderColor: PHASE_BORDER[phase] ?? PHASE_BORDER.idle,
        }}
        transition={{ duration: 0.2 }}
        className="relative z-10 w-10 h-10 rounded-xl border flex items-center justify-center"
        title={isActive ? 'Stop voice agent' : 'Start voice agent (live conversation)'}
        aria-label={isActive ? 'Stop voice agent' : 'Start voice agent'}
      >
        <AnimatePresence mode="wait">
          {!isActive ? (
            <motion.div
              key="phone"
              initial={{ opacity: 0, scale: 0.7 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.7 }}
            >
              <Phone size={16} className="text-white/60" />
            </motion.div>
          ) : phase === 'listening' ? (
            <motion.div
              key="mic"
              initial={{ opacity: 0, scale: 0.7 }}
              animate={{ opacity: 1, scale: [1, 1.15, 1] }}
              exit={{ opacity: 0 }}
              transition={{ scale: { duration: 0.8, repeat: Infinity } }}
            >
              <Mic size={16} className="text-green-400" />
            </motion.div>
          ) : phase === 'speaking' ? (
            <motion.div
              key="speaking"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <Volume2 size={16} className="text-amber-400" />
            </motion.div>
          ) : phase === 'generating' ? (
            <motion.div
              key="generating"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <Loader2 size={16} className="text-purple-400 animate-spin" />
            </motion.div>
          ) : (
            <motion.div
              key="processing"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <Loader2 size={16} className="text-indigo-400 animate-spin" />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.button>

      {/* Active indicator dot */}
      <AnimatePresence>
        {isActive && (
          <motion.div
            key="dot"
            className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-green-400 border border-black/20"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0 }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
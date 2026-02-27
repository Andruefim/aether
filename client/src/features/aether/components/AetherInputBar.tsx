import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Sparkles, Search } from 'lucide-react';
import { VoiceButton } from './VoiceButton';
import { useVoiceInput, type VoiceState } from '../hooks';

interface AetherInputBarProps {
  onSubmit: (text: string) => void;
  disabled?: boolean;
}

export function AetherInputBar({ onSubmit, disabled }: AetherInputBarProps) {
  const [input, setInput] = useState('');

  const handleTranscript = (text: string) => {
    setInput(text);
    // Auto-submit voice input after short delay so user can see the text
    setTimeout(() => {
      if (text.trim()) {
        onSubmit(text.trim());
        setInput('');
      }
    }, 400);
  };

  const { voiceState, startListening, stopListening } = useVoiceInput(handleTranscript);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && !disabled) {
      onSubmit(input.trim());
      setInput('');
    }
  };

  const placeholder =
    voiceState === 'listening'
      ? 'Listening...'
      : voiceState === 'processing'
        ? 'Transcribing...'
        : 'Ask anything...';

  return (
    <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 w-full max-w-2xl px-4">
      <motion.form
        initial={{ y: 50, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        onSubmit={handleSubmit}
        className="relative flex items-center w-full bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl overflow-hidden"
      >
        <div className="pl-4 pr-2 text-white/50 shrink-0">
          {input ? <Sparkles size={20} className="text-indigo-400" /> : <Search size={20} />}
        </div>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={placeholder}
          disabled={disabled || voiceState === 'processing'}
          className="w-full py-4 px-2 bg-transparent text-white placeholder-white/30 outline-none font-sans text-lg min-w-0"
          autoFocus
        />
        <div className="shrink-0 mx-2 flex items-center">
          <VoiceButton
            state={voiceState}
            onStart={startListening}
            onStop={stopListening}
          />
        </div>
        <button
          type="submit"
          disabled={!input.trim() || !!disabled}
          className="px-6 py-2 mr-2 bg-white/10 hover:bg-white/20 disabled:opacity-50 disabled:hover:bg-white/10 text-white rounded-xl transition-colors font-medium text-sm shrink-0"
        >
          {disabled ? 'Working...' : 'Send'}
        </button>
      </motion.form>
    </div>
  );
}

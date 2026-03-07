import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Sparkles, Search } from 'lucide-react';
import { VoiceButton } from './VoiceButton';
import { VoiceAgentButton } from './VoiceAgentButton';
import { useVoiceInput, type VoiceState } from '../hooks';
import type { AgentPhase } from '../hooks/useVoiceAgent';

interface AetherInputBarProps {
  onSubmit: (text: string) => void;
  disabled?: boolean;
  // Voice agent props
  agentActive: boolean;
  agentPhase: AgentPhase;
  onAgentStart: () => void;
  onAgentStop: () => void;
}

export function AetherInputBar({
  onSubmit,
  disabled,
  agentActive,
  agentPhase,
  onAgentStart,
  onAgentStop,
}: AetherInputBarProps) {
  const [input, setInput] = useState('');

  const handleTranscript = (text: string) => {
    setInput(text);
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

  const isDisabled = disabled || agentActive;

  const placeholder =
    agentActive
      ? agentPhase === 'listening'
        ? 'Listening...'
        : agentPhase === 'speaking'
          ? 'Speaking...'
          : agentPhase === 'generating'
            ? 'Building...'
            : 'Processing...'
      : voiceState === 'listening'
        ? 'Listening...'
        : voiceState === 'processing'
          ? 'Transcribing...'
          : 'Ask anything...';

  return (
    <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 w-full max-w-2xl px-4">
      <motion.form
        initial={{ y: 0, opacity: 0 }}
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
          disabled={isDisabled || voiceState === 'processing'}
          className="w-full py-4 px-2 bg-transparent text-white placeholder-white/30 outline-none font-sans text-lg min-w-0"
          autoFocus
        />

        <div className="shrink-0 mx-1 flex items-center gap-1">
          {/* Single-shot voice input (existing) */}
          {!agentActive && (
            <VoiceButton
              state={voiceState}
              onStart={startListening}
              onStop={stopListening}
            />
          )}

          {/* Voice agent toggle */}
          <VoiceAgentButton
            isActive={agentActive}
            phase={agentPhase}
            onStart={onAgentStart}
            onStop={onAgentStop}
          />
        </div>

        <button
          type="submit"
          disabled={!input.trim() || !!isDisabled}
          className="px-6 py-2 mr-2 bg-white/10 hover:bg-white/20 disabled:opacity-50 disabled:hover:bg-white/10 text-white rounded-xl transition-colors font-medium text-sm shrink-0"
        >
          {disabled ? 'Working...' : agentActive ? 'Agent' : 'Send'}
        </button>
      </motion.form>
    </div>
  );
}
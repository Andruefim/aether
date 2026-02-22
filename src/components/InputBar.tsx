import React, { useState } from 'react';
import { useAetherStore } from '../store';
import { Search, Sparkles } from 'lucide-react';
import { motion } from 'motion/react';

export const InputBar: React.FC<{ onSubmit: (prompt: string) => void }> = ({ onSubmit }) => {
  const [input, setInput] = useState('');
  const activePrompt = useAetherStore(state => state.activePrompt);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) {
      onSubmit(input.trim());
      setInput('');
    }
  };

  return (
    <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 w-full max-w-2xl px-4">
      <motion.form 
        initial={{ y: 50, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        onSubmit={handleSubmit}
        className="relative flex items-center w-full bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl overflow-hidden"
      >
        <div className="pl-4 pr-2 text-white/50">
          {input ? <Sparkles size={20} className="text-indigo-400" /> : <Search size={20} />}
        </div>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="What do you want to create or recall?"
          className="w-full py-4 px-2 bg-transparent text-white placeholder-white/30 outline-none font-sans text-lg"
          autoFocus
        />
        <button 
          type="submit"
          disabled={!input.trim()}
          className="px-6 py-2 mr-2 bg-white/10 hover:bg-white/20 disabled:opacity-50 disabled:hover:bg-white/10 text-white rounded-xl transition-colors font-medium text-sm"
        >
          Generate
        </button>
      </motion.form>
    </div>
  );
};

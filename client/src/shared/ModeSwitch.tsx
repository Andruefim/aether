import React from 'react';
import { useAetherStore, type AppMode } from '../core';

const MODES: { id: AppMode; label: string }[] = [
  { id: 'desktop', label: 'Desktop' },
  { id: 'aether', label: 'Aether' },
];

export function ModeSwitch() {
  const appMode = useAetherStore((s) => s.appMode);
  const setAppMode = useAetherStore((s) => s.setAppMode);

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] flex gap-1 p-2 rounded-2xl bg-white/5 backdrop-blur-xl border border-white/10 shadow-2xl">
      {MODES.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          onClick={() => setAppMode(id)}
          className={`px-5 py-2.5 rounded-xl text-sm font-medium transition-colors ${
            appMode === id
              ? 'bg-white/20 text-white'
              : 'text-white/70 hover:text-white hover:bg-white/10'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

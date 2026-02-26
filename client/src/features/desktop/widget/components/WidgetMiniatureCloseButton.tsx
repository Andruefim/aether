import React from 'react';
import { X } from 'lucide-react';

type Props = {
  onClose: (e: React.MouseEvent) => void;
};

export function WidgetMiniatureCloseButton({ onClose }: Props) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClose(e);
      }}
      className="absolute top-1 right-1 z-20 p-1 rounded-md bg-black/20 text-white/70 hover:text-red-400 hover:bg-black/40 transition-colors"
      aria-label="Close widget"
    >
      <X size={12} />
    </button>
  );
}

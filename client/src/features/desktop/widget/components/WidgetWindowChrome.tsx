import React from 'react';
import { X } from 'lucide-react';

type Props = {
  title: string;
  onMinimize: (e: React.MouseEvent) => void;
  dragControls: { start: (e: React.PointerEvent) => void };
};

export function WidgetWindowChrome({ title, onMinimize, dragControls }: Props) {
  return (
    <div className="absolute inset-0 pointer-events-none z-10 rounded-2xl">
      <div
        className="absolute top-0 left-0 right-0 h-[10px] cursor-grab active:cursor-grabbing rounded-t-2xl pointer-events-auto"
        onPointerDown={(e) => dragControls.start(e)}
      />
      <div
        className="absolute top-[10px] right-0 w-[10px] bottom-[10px] cursor-grab active:cursor-grabbing pointer-events-auto"
        onPointerDown={(e) => dragControls.start(e)}
      />
      <div
        className="absolute bottom-0 left-0 right-0 h-[10px] cursor-grab active:cursor-grabbing rounded-b-2xl pointer-events-auto"
        onPointerDown={(e) => dragControls.start(e)}
      />
      <div
        className="absolute top-[10px] left-0 w-[10px] bottom-[10px] cursor-grab active:cursor-grabbing rounded-l-2xl pointer-events-auto"
        onPointerDown={(e) => dragControls.start(e)}
      />
      <div className="absolute -top-10 left-0 right-0 h-10 flex items-center justify-between px-4 text-white/50 text-xs font-mono truncate max-w-[200px] pointer-events-none">
        <span className="truncate">{title}</span>
        <button
          type="button"
          onClick={onMinimize}
          className="shrink-0 p-1 rounded-md bg-black/20 text-white/70 hover:text-white hover:bg-black/40 pointer-events-auto transition-colors"
          aria-label="Minimize to grid"
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );
}

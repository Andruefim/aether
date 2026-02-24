import React, { useEffect, useRef, useState } from 'react';
import { WidgetData, useAetherStore } from '../store';
import { motion, useDragControls } from 'motion/react';
import { X } from 'lucide-react';
import { stripMarkdownCodeFence } from '../utils/widgetHtml';

export type WidgetMode = 'focused' | 'miniature';

export type WidgetProps = {
  data: WidgetData;
  mode: WidgetMode;
  mainWidth?: number;
  mainHeight?: number;
  miniatureSlot?: number;
  miniatureWidth?: number;
  miniatureHeight?: number;
};

export const Widget: React.FC<WidgetProps> = ({
  data,
  mode,
  mainWidth = 560,
  mainHeight = 420,
  miniatureWidth = 160,
  miniatureHeight = 120,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const updateWidget = useAetherStore((state) => state.updateWidget);
  const removeWidget = useAetherStore((state) => state.removeWidget);
  const setFocusedWidget = useAetherStore((state) => state.setFocusedWidget);
  const dragControls = useDragControls();
  const [isDragging, setIsDragging] = useState(false);
  const isFocused = mode === 'focused';
  const isMiniaure = mode === 'miniature';

  useEffect(() => {
    if (data.isGenerating || !data.html || !containerRef.current) return;
    const el = containerRef.current;
    el.innerHTML = '';
    el.innerHTML = stripMarkdownCodeFence(data.html);
    fetch(`/api/widgets/${data.id}/data`)
      .then((res) => res.json())
      .then((initialData) => {
        el.setAttribute('data-widget-init', JSON.stringify(initialData));
        const bootstrap = document.createElement('script');
        bootstrap.textContent = `var c = document.currentScript.closest('[data-widget-id]'); if(c){ window.__CURRENT_WIDGET_ID__ = c.getAttribute('data-widget-id'); try { window.__WIDGET_INIT__ = JSON.parse(c.getAttribute('data-widget-init') || '{}'); } catch(e) { window.__WIDGET_INIT__ = {}; } }`;
        el.appendChild(bootstrap);
        el.querySelectorAll('script').forEach((oldScript) => {
          if (oldScript.src || oldScript === bootstrap) return;
          const newScript = document.createElement('script');
          newScript.textContent = (oldScript.textContent ?? '')
            .replace(/\bconst\s+/g, 'var ')
            .replace(/\blet\s+/g, 'var ');
          el.appendChild(newScript);
        });
      });
  }, [data.html, data.isGenerating, data.id]);

  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (e.data?.widgetId !== data.id) return;

      if (e.data?.type === 'save') {
        fetch(`/api/widgets/${data.id}/data`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(e.data.data ?? e.data),
        });
      } else if (e.data?.type === 'close') {
        const { widgets } = useAetherStore.getState();
        const other = widgets.find((w) => w.id !== data.id);
        useAetherStore.getState().setFocusedWidget(other?.id ?? null);
        fetch(`/api/widgets/${data.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ minimized: true }),
        });
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [data.id]);

  const handleDragEnd = (_event: unknown, info: { offset: { x: number; y: number } }) => {
    setIsDragging(false);
    const newX = data.position_x + info.offset.x;
    const newY = data.position_y + info.offset.y;
    updateWidget(data.id, { position_x: newX, position_y: newY });
    fetch(`/api/widgets/${data.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ position_x: newX, position_y: newY }),
    });
  };

  const closeWidget = (e: React.MouseEvent) => {
    e.stopPropagation();
    removeWidget(data.id);
    fetch(`/api/widgets/${data.id}`, { method: 'DELETE' });
  };

  const focusThisWidget = () => {
    if (isMiniaure) setFocusedWidget(data.id);
  };

  const blurAmount = data.isGenerating ? Math.max(0, 16 - (data.progress || 0) * 16) : 0;
  const opacity = data.isGenerating ? (data.progress || 0) : 1;

  const width = isFocused ? '100%' : miniatureWidth;
  const height = isFocused ? '100%' : miniatureHeight;

  return (
    <motion.div
      drag={isFocused && !data.isGenerating}
      dragControls={dragControls}
      dragListener={false}
      onDragStart={() => isFocused && setIsDragging(true)}
      onDragEnd={handleDragEnd}
      initial={isMiniaure ? false : { scale: 0.9, opacity: 0 }}
      animate={{
        scale: 1,
        opacity,
        filter: `blur(${blurAmount}px)`,
      }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      className={`relative rounded-2xl overflow-hidden shrink-0 ${isMiniaure ? 'cursor-pointer' : ''}`}
      style={{
        width,
        height,
        transformOrigin: 'center center',
      }}
      onClick={isMiniaure ? focusThisWidget : undefined}
    >
      {isMiniaure && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            closeWidget(e);
          }}
          className="absolute top-1 right-1 z-20 p-1 rounded-md bg-black/50 text-white/70 hover:text-red-400 hover:bg-black/70 transition-colors"
          aria-label="Close widget"
        >
          <X size={12} />
        </button>
      )}
      {isFocused && !data.isGenerating && (
        <div
          className="absolute -top-10 left-0 right-0 h-10 flex items-center justify-between px-4 bg-white/5 backdrop-blur-md border border-white/10 rounded-t-xl opacity-0 hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing z-10"
          onPointerDown={(e) => dragControls.start(e)}
        >
          <div className="text-white/50 text-xs font-mono truncate max-w-[200px]">
            {data.user_prompt}
          </div>
        </div>
      )}
      <div
        className={`w-full h-full min-w-[200x] min-h-[100px] align-middle rounded-2xl overflow-hidden relative ${data.isGenerating ? 'bg-white/5 border border-white/10 backdrop-blur-xl' : 'bg-white/15 backdrop-blur-xl border border-white/10'}`}
      >
        {data.isGenerating ? (
          <div className="w-full h-full flex flex-col items-center justify-center text-white/50 font-mono text-sm">
            <div className="mb-4">Crystallizing...</div>
            <div className="w-32 h-1 bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-500 transition-all duration-200"
                style={{ width: `${(data.progress || 0) * 100}%` }}
              />
            </div>
          </div>
        ) : (
          <div
            ref={containerRef}
            data-widget-id={data.id}
            className={`w-full h-full border-none bg-transparent overflow-auto widget-content ${isMiniaure ? 'pointer-events-none' : 'pointer-events-auto'}`}
            aria-label={data.user_prompt}
          />
        )}
      </div>
    </motion.div>
  );
};

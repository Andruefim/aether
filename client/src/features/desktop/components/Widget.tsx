import React, { useEffect, useRef, useState } from 'react';
import { type WidgetData, useAetherStore } from '../../../core';
import { stripMarkdownCodeFence } from '../../../shared';
import { WidgetPreview } from '../../preview';
import { motion, useDragControls } from 'motion/react';
import { X } from 'lucide-react';

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

/**
 * Ask the server to generate + persist a preview, then update local store.
 * Single request — the server saves to DB internally.
 */
async function requestPreview(widgetId: string, widgetUserPrompt: string): Promise<void> {
  try {
    const res = await fetch('/api/generate/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ widgetId, userPrompt: widgetUserPrompt }),
    });
    if (!res.ok) return;
    const { html } = (await res.json()) as { html: string };
    if (!html) return;
    // Update local store so miniature re-renders immediately without page reload
    useAetherStore.getState().updateWidget(widgetId, { preview_html: html });
  } catch {
    // Preview is non-critical — silently ignore failures
  }
}

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
  const generativePreviewEnabled = useAetherStore((state) => state.generativePreviewEnabled);
  const setGenerativePreviewEnabled = useAetherStore((state) => state.setGenerativePreviewEnabled);
  const dragControls = useDragControls();
  const [isDragging, setIsDragging] = useState(false);
  const isFocused = mode === 'focused';
  const isMiniature = mode === 'miniature';

  const cleanHtml = data.html ? stripMarkdownCodeFence(data.html) : '';

  // Inject + execute widget scripts only when focused
  useEffect(() => {
    if (!isFocused) return;
    if (data.isGenerating || !data.html || !containerRef.current) return;
    const el = containerRef.current;
    el.innerHTML = '';
    el.innerHTML = cleanHtml;
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
  }, [isFocused, data.html, data.isGenerating, data.id]);

  // Trigger preview generation once the widget finishes generating and has no preview yet
  useEffect(() => {
    if (data.isGenerating) return;
    if (!cleanHtml) return;
    if (data.preview_html) return;
    requestPreview(data.id, data.user_prompt);
  }, [data.isGenerating, data.id, data.preview_html, cleanHtml]);

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

  const blurAmount = data.isGenerating ? Math.max(0, 16 - (data.progress || 0) * 16) : 0;
  const opacity = data.isGenerating ? (data.progress || 0) : 1;

  return (
    <motion.div
      drag={isFocused && !data.isGenerating}
      dragControls={dragControls}
      dragListener={false}
      onDragStart={() => isFocused && setIsDragging(true)}
      onDragEnd={handleDragEnd}
      initial={isMiniature ? false : { scale: 0.9, opacity: 0 }}
      animate={{ scale: 1, opacity, filter: `blur(${blurAmount}px)` }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      className={`relative rounded-2xl overflow-hidden shrink-0 ${isMiniature ? 'cursor-pointer' : ''}`}
      style={{
        width: isFocused ? '100%' : miniatureWidth,
        height: isFocused ? '100%' : miniatureHeight,
        transformOrigin: 'center center',
      }}
      onClick={isMiniature ? () => setFocusedWidget(data.id) : undefined}
    >
      {isMiniature && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); closeWidget(e); }}
          className="absolute top-1 right-1 z-20 p-1 rounded-md bg-black/50 text-white/70 hover:text-red-400 hover:bg-black/70 transition-colors"
          aria-label="Close widget"
        >
          <X size={12} />
        </button>
      )}
      {isFocused && !data.isGenerating && (
        <div className="absolute inset-0 pointer-events-none z-10 rounded-2xl">
          <div className="absolute top-0 left-0 right-0 h-[10px] cursor-grab active:cursor-grabbing rounded-t-2xl pointer-events-auto" onPointerDown={(e) => dragControls.start(e)} />
          <div className="absolute top-[10px] right-0 w-[10px] bottom-[10px] cursor-grab active:cursor-grabbing pointer-events-auto" onPointerDown={(e) => dragControls.start(e)} />
          <div className="absolute bottom-0 left-0 right-0 h-[10px] cursor-grab active:cursor-grabbing rounded-b-2xl pointer-events-auto" onPointerDown={(e) => dragControls.start(e)} />
          <div className="absolute top-[10px] left-0 w-[10px] bottom-[10px] cursor-grab active:cursor-grabbing rounded-l-2xl pointer-events-auto" onPointerDown={(e) => dragControls.start(e)} />
          <div className="absolute -top-10 left-0 right-0 h-10 flex items-center px-4 text-white/50 text-xs font-mono truncate max-w-[200px] pointer-events-none">
            {data.user_prompt}
          </div>
        </div>
      )}
      <div className={`w-full h-full min-w-[200px] min-h-[100px] rounded-2xl overflow-hidden relative ${data.isGenerating ? 'bg-white/5 border border-white/10 backdrop-blur-xl' : 'bg-white/15 backdrop-blur-xl border border-white/10'}`}>
        {data.isGenerating ? (
          <div className="w-full h-full flex flex-col min-h-0">
            {generativePreviewEnabled && data.html ? (
              <WidgetPreview html={stripMarkdownCodeFence(data.html)} className="flex-1 min-h-0 w-full" />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center text-white/50 font-mono text-sm">
                <div className="mb-4">Crystallizing...</div>
                <div className="w-32 h-1 bg-white/10 rounded-full overflow-hidden">
                  <div className="h-full bg-indigo-500 transition-all duration-200" style={{ width: `${(data.progress || 0) * 100}%` }} />
                </div>
              </div>
            )}
            <label className="flex items-center gap-2 px-3 py-2 text-white/50 text-xs border-t border-white/10 shrink-0">
              <input type="checkbox" checked={generativePreviewEnabled} onChange={(e) => setGenerativePreviewEnabled(e.target.checked)} className="rounded border-white/30 bg-white/10" />
              <span>Live HTML preview</span>
            </label>
          </div>
        ) : isMiniature ? (
          <div className="w-full h-full overflow-hidden pointer-events-none" aria-hidden>
            {data.preview_html ? (
              <iframe scrolling="no"
                srcDoc={data.preview_html}
                sandbox="allow-same-origin"
                title={data.user_prompt}
                style={{ width: miniatureWidth, height: miniatureHeight, border: 'none', overflow: 'hidden', display: 'block' }}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-white/40 text-xs px-3 text-center select-none animate-pulse">
                {data.user_prompt}
              </div>
            )}
          </div>
        ) : (
          <div
            ref={containerRef}
            data-widget-id={data.id}
            className="w-full h-full border-none bg-transparent overflow-auto widget-content pointer-events-auto"
            aria-label={data.user_prompt}
          />
        )}
      </div>
    </motion.div>
  );
};
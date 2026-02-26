import React from 'react';
import { useAetherStore } from '../../core';
import { useWidgetsLoad, useGenerate } from './hooks';
import { WebGLBackground } from './components';
import { Widget } from './components';
import { InputBar } from './components/InputBar';
import { motion, AnimatePresence } from 'motion/react';

const MINIATURE_WIDTH = 160;
const MINIATURE_HEIGHT = 120;
const WINDOWS_LAYER_Z = 20;

export function DesktopPage() {
  useWidgetsLoad();
  const handleGenerate = useGenerate();

  const widgets = useAetherStore((state) => state.widgets);
  const openWidgetIds = useAetherStore((state) => state.openWidgetIds);
  const openWidget = useAetherStore((state) => state.openWidget);
  const closeAllToMiniatures = useAetherStore((state) => state.closeAllToMiniatures);

  const miniatures = widgets
    .filter((w) => !openWidgetIds.includes(w.id))
    .sort((a, b) => a.created_at - b.created_at);

  const hasOpenWindows = openWidgetIds.length > 0;

  const handleBackgroundClick = () => {
    const ids = [...openWidgetIds];
    closeAllToMiniatures();
    ids.forEach((id) => {
      useAetherStore.getState().updateWidget(id, { minimized: true });
      fetch(`/api/widgets/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ minimized: true }),
      });
    });
  };

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#ede6da] text-white font-sans selection:bg-indigo-500/30">
      <WebGLBackground />

      {/* Miniature grid — z-10; always clickable so miniatures can be opened when windows are open */}
      <div className="absolute inset-0 z-10" style={{ pointerEvents: 'auto' }}>
        <div
          className="w-full h-full"
          style={{
            padding: '48px 48px 140px',
            display: 'grid',
            gridTemplateColumns: `repeat(auto-fill, ${MINIATURE_WIDTH}px)`,
            gridTemplateRows: `repeat(auto-fill, ${MINIATURE_HEIGHT}px)`,
            gap: '24px',
            alignContent: 'start',
            justifyContent: 'center',
          }}
          onClick={(e) => {
            if (hasOpenWindows && e.target === e.currentTarget) handleBackgroundClick();
          }}
          role="presentation"
        >
          <AnimatePresence>
            {miniatures.map((widget, i) => (
              <motion.div
                key={widget.id}
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.75 }}
                transition={{ type: 'spring', stiffness: 320, damping: 28, delay: i * 0.03 }}
                style={{ width: MINIATURE_WIDTH, height: MINIATURE_HEIGHT }}
              >
                <Widget
                  data={widget}
                  mode="miniature"
                  miniatureSlot={i}
                  miniatureWidth={MINIATURE_WIDTH}
                  miniatureHeight={MINIATURE_HEIGHT}
                  onOpen={() => openWidget(widget.id)}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>

      {/* Windows layer — no full-screen overlay; pointer-events:none so clicks pass to grid; each window captures its own */}
      <AnimatePresence>
        {hasOpenWindows && (
          <motion.div
            key="windows-layer"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 pointer-events-none"
            style={{ zIndex: WINDOWS_LAYER_Z }}
          >
            {openWidgetIds.map((id, index) => {
              const widget = widgets.find((w) => w.id === id);
              if (!widget) return null;
              return (
                <div
                  key={widget.id}
                  className="absolute pointer-events-auto"
                  style={{
                    left: widget.position_x,
                    top: widget.position_y,
                    width: 'fit-content',
                    height: 'fit-content',
                    zIndex: index,
                  }}
                >
                  <Widget
                    data={widget}
                    mode="focused"
                    mainWidth="fit-content"
                    mainHeight="fit-content"
                  />
                </div>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>

      <InputBar onSubmit={handleGenerate} />
    </div>
  );
}
import React from 'react';
import { useAetherStore } from '../../core';
import { useWidgetsLoad, useGenerate } from './hooks';
import { WebGLBackground } from './components/WebGLBackground';
import { Widget } from './components/Widget';
import { InputBar } from './components/InputBar';
import { motion, AnimatePresence } from 'motion/react';

const MINIATURE_WIDTH = 160;
const MINIATURE_HEIGHT = 120;
const FOCUSED_WIDTH = 'fit-content';
const FOCUSED_HEIGHT = 'fit-content';

export function DesktopPage() {
  useWidgetsLoad();
  const handleGenerate = useGenerate();

  const widgets = useAetherStore((state) => state.widgets);
  const focusedWidgetId = useAetherStore((state) => state.focusedWidgetId);
  const setFocusedWidget = useAetherStore((state) => state.setFocusedWidget);

  const miniatures = widgets
    .filter((w) => w.id !== focusedWidgetId)
    .sort((a, b) => a.created_at - b.created_at);

  const focusedWidget = focusedWidgetId
    ? widgets.find((w) => w.id === focusedWidgetId)
    : null;

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#ede6da] text-white font-sans selection:bg-indigo-500/30">
      <WebGLBackground />

      {/* Miniature grid — z-10, disabled when something is focused */}
      <div
        className="absolute inset-0 z-10"
        style={{ pointerEvents: focusedWidget ? 'none' : 'auto' }}
      >
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
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>

      {/* Focused widget overlay — z-20, above grid */}
      <AnimatePresence>
        {focusedWidget && (
          <motion.div
            key="focused-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 z-20"
            style={{ pointerEvents: 'auto' }}
            onClick={() => setFocusedWidget(null)}
            role="presentation"
          >
            {/* Centered widget — explicit size so 100%/100% works inside Widget */}
            <div
              className="absolute"
              style={{
                left: '50%',
                top: '50%',
                transform: 'translate(-50%, -50%)',
                width: FOCUSED_WIDTH,
                height: FOCUSED_HEIGHT,
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <Widget
                key={focusedWidget.id}
                data={focusedWidget}
                mode="focused"
                mainWidth={FOCUSED_WIDTH}
                mainHeight={FOCUSED_HEIGHT}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <InputBar onSubmit={handleGenerate} />
    </div>
  );
}
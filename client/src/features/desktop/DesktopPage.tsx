import React from 'react';
import { useAetherStore } from '../../core';
import { useWidgetsLoad, useGenerate } from './hooks';
import { WebGLBackground } from './components/WebGLBackground';
import { Widget } from './components/Widget';
import { InputBar } from './components/InputBar';

const MINIATURE_WIDTH = 160;
const MINIATURE_HEIGHT = 120;

export function DesktopPage() {
  useWidgetsLoad();
  const handleGenerate = useGenerate();

  const widgets = useAetherStore((state) => state.widgets);
  const focusedWidgetId = useAetherStore((state) => state.focusedWidgetId);
  const setFocusedWidget = useAetherStore((state) => state.setFocusedWidget);

  const miniatures = widgets
    .filter((w) => w.id !== focusedWidgetId)
    .sort((a, b) => a.created_at - b.created_at);
  const focusedWidget = focusedWidgetId ? widgets.find((w) => w.id === focusedWidgetId) : null;

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#ede6da] text-white font-sans selection:bg-indigo-500/30">
      <WebGLBackground />
      <div className="absolute inset-0 pointer-events-none z-30">
        <div className="absolute bottom-0 left-0 right-0 h-[140px] flex items-end justify-start gap-3 pl-6 pb-6 pointer-events-auto">
          {miniatures.map((widget, i) => (
            <Widget
              key={widget.id}
              data={widget}
              mode="miniature"
              miniatureSlot={i}
              miniatureWidth={MINIATURE_WIDTH}
              miniatureHeight={MINIATURE_HEIGHT}
            />
          ))}
        </div>
      </div>
      {focusedWidget && (
        <div
          className="absolute inset-0 z-20 flex items-center justify-center p-4"
          style={{ overflowY: 'auto' }}
          onClick={() => setFocusedWidget(null)}
          role="presentation"
        >
          <div
            className="pointer-events-auto min-w-0 min-h-0 my-10"
            onClick={(e) => e.stopPropagation()}
          >
            <Widget key={focusedWidget.id} data={focusedWidget} mode="focused" />
          </div>
        </div>
      )}
      <InputBar onSubmit={handleGenerate} />
    </div>
  );
}

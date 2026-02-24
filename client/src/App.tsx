import React, { useEffect, useCallback } from 'react';
import { WebGLBackground } from './components/WebGLBackground';
import { InputBar } from './components/InputBar';
import { Widget } from './components/Widget';
import { useAetherStore, type WidgetData } from './store';
import { v4 as uuidv4 } from 'uuid';
import { stripMarkdownCodeFence } from './utils/widgetHtml';

const MINIATURE_WIDTH = 160;
const MINIATURE_HEIGHT = 120;

export default function App() {
  const widgets = useAetherStore((state) => state.widgets);
  const focusedWidgetId = useAetherStore((state) => state.focusedWidgetId);
  const setWidgets = useAetherStore((state) => state.setWidgets);
  const addWidget = useAetherStore((state) => state.addWidget);
  const updateWidget = useAetherStore((state) => state.updateWidget);

  useEffect(() => {
    fetch('/api/widgets')
      .then((res) => res.json())
      .then((data: WidgetData[]) => {
        const current = useAetherStore.getState().widgets;
        const generating = current.filter((w) => w.isGenerating);
        const serverIds = new Set(data.map((w) => w.id));
        const merged = data.map((w) => {
          const cur = generating.find((g) => g.id === w.id);
          return cur ?? w;
        });
        const generatingOnly = generating.filter((g) => !serverIds.has(g.id));
        setWidgets([...merged, ...generatingOnly]);
      });
  }, [setWidgets]);

  const handleGenerate = useCallback(
    async (prompt: string) => {
      const id = uuidv4();
      const newWidget = {
        id,
        user_prompt: prompt,
        html: '',
        position_x: window.innerWidth / 2 - 200,
        position_y: window.innerHeight / 2 - 150,
        width: 400,
        height: 300,
        created_at: Date.now(),
        last_accessed: Date.now(),
        opacity_decay: 1.0,
        minimized: false,
        isGenerating: true,
        progress: 0.0,
      };

      addWidget(newWidget);

      try {
        await fetch('/api/widgets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newWidget),
        });

        const response = await fetch(`/api/generate?prompt=${encodeURIComponent(prompt)}`);
        if (!response.body) throw new Error('No response body');

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let html = '';
        let buffer = '';
        let finished = false;

        const processPayload = (raw: string) => {
          const data = raw.trim();
          if (data === '[DONE]') {
            finished = true;
            const cleanHtml = stripMarkdownCodeFence(html);
            updateWidget(id, { html: cleanHtml, isGenerating: false, progress: 1.0 });
            fetch(`/api/widgets/${id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ html: cleanHtml }),
            });
            return;
          }
          try {
            const parsed = JSON.parse(data);
            if (parsed.text) {
              html += parsed.text;
              const progress = Math.min(0.95, html.length / 2000);
              updateWidget(id, { html, progress });
            }
          } catch {
            // skip non-JSON lines
          }
        };

        const processSegment = (segment: string) => {
          const lines = segment.split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              processPayload(line.slice(6));
              break;
            }
          }
        };

        while (!finished) {
          const { done, value } = await reader.read();

          if (done) {
            if (buffer.trim()) {
              const segments = buffer.split(/\n\n+/);
              for (const seg of segments) {
                processSegment(seg);
                if (finished) break;
              }
            }
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const segments = buffer.split(/\n\n+/);
          buffer = segments.pop() || '';

          for (const seg of segments) {
            processSegment(seg);
            if (finished) break;
          }
        }

        // Fallback: if stream ended without [DONE], still finalize widget
        if (!finished && html) {
          const cleanHtml = stripMarkdownCodeFence(html);
          updateWidget(id, { html: cleanHtml, isGenerating: false, progress: 1.0 });
          await fetch(`/api/widgets/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ html: cleanHtml }),
          });
        }
      } catch (error) {
        console.error('Generation failed:', error);
        updateWidget(id, {
          isGenerating: false,
          html: '<div class="text-red-500 p-4">Generation failed</div>',
        });
      }
    },
    [addWidget, updateWidget],
  );

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
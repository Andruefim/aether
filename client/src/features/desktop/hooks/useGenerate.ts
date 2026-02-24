import { useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useAetherStore, type WidgetData } from '../../../core';
import { stripMarkdownCodeFence } from '../../../shared';

export function useGenerate() {
  const addWidget = useAetherStore((s) => s.addWidget);
  const updateWidget = useAetherStore((s) => s.updateWidget);

  return useCallback(
    async (prompt: string) => {
      const id = uuidv4();
      const newWidget: WidgetData = {
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
}

import { useCallback, useRef } from 'react';
import { useAetherStore, type AetherMessage } from '../../../core';
import { stripMarkdownCodeFence } from '../../../shared';
import { INITIAL_AETHER_HTML } from '../constants';

interface UseAetherInputOptions {
  onUiReady?: (html: string) => void;   // called when morphdom should apply new HTML
  onDialogue?: (text: string) => void;  // called on dialogue response
}

/**
 * Core hook that drives the Aether mode interaction loop.
 *
 * Flow:
 *   user text/voice
 *     → capture screenshot (optional)
 *     → POST /api/aether/input  (SSE)
 *     → { type:'route' }        → update status
 *     → { type:'token' }        → accumulate buffer
 *     → { type:'dialogue' }     → show overlay
 *     → { type:'done' }         → apply morphdom + trigger pulse
 */
export function useAetherInput({ onUiReady, onDialogue }: UseAetherInputOptions) {
  const bufferRef = useRef('');
  const abortRef = useRef<AbortController | null>(null);

  const aetherHtml = useAetherStore((s) => s.aetherHtml);
  const aetherHistory = useAetherStore((s) => s.aetherHistory);
  const setAetherHtml = useAetherStore((s) => s.setAetherHtml);
  const setAetherPreviousHtml = useAetherStore((s) => s.setAetherPreviousHtml);
  const setAetherIsGenerating = useAetherStore((s) => s.setAetherIsGenerating);
  const setAetherStatus = useAetherStore((s) => s.setAetherStatus);
  const setAetherLastAction = useAetherStore((s) => s.setAetherLastAction);
  const triggerAetherPulse = useAetherStore((s) => s.triggerAetherPulse);
  const pushAetherMessage = useAetherStore((s) => s.pushAetherMessage);

  const sendInput = useCallback(
    async (text: string, screenshot?: string | null) => {
      // Cancel any in-flight request
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      bufferRef.current = '';
      setAetherIsGenerating(true);
      setAetherStatus('Thinking...');

      // Snapshot current HTML as fallback
      const currentHtml = useAetherStore.getState().aetherHtml || INITIAL_AETHER_HTML;
      setAetherPreviousHtml(currentHtml);

      // Add user message to history
      const userMsg: AetherMessage = { role: 'user', content: text, timestamp: Date.now() };
      pushAetherMessage(userMsg);

      try {
        const res = await fetch('/api/aether/input', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            text,
            screenshot: screenshot ?? undefined,
            currentHtml,
            history: useAetherStore.getState().aetherHistory.slice(-10),
          }),
        });

        if (!res.ok || !res.body) throw new Error(`Request failed: ${res.statusText}`);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let sseBuffer = '';
        let isDone = false;

        while (!isDone) {
          const { done, value } = await reader.read();
          if (done) break;

          sseBuffer += decoder.decode(value, { stream: true });
          const segments = sseBuffer.split(/\n\n+/);
          sseBuffer = segments.pop() ?? '';

          for (const segment of segments) {
            const line = segment.split('\n').find((l) => l.startsWith('data: '));
            if (!line) continue;
            const raw = line.slice(6).trim();
            if (!raw) continue;

            try {
              const event = JSON.parse(raw) as {
                type: string;
                action?: string;
                instruction?: string;
                text?: string;
                message?: string;
              };

              switch (event.type) {
                case 'route':
                  setAetherLastAction(event.action as 'generate_ui' | 'dialogue' | 'tool');
                  setAetherStatus(
                    event.action === 'generate_ui'
                      ? 'Building interface...'
                      : event.action === 'tool'
                        ? 'Searching...'
                        : 'Thinking...',
                  );
                  break;

                case 'token':
                  if (event.text) {
                    bufferRef.current += event.text;
                    // Live preview: update store with streaming HTML
                    setAetherHtml(bufferRef.current);
                  }
                  break;

                case 'dialogue':
                  if (event.text) {
                    onDialogue?.(event.text);
                    pushAetherMessage({
                      role: 'assistant',
                      content: event.text,
                      timestamp: Date.now(),
                    });
                  }
                  break;

                case 'done': {
                  isDone = true;
                  const finalHtml = stripMarkdownCodeFence(bufferRef.current);
                  if (finalHtml) {
                    setAetherHtml(finalHtml);
                    onUiReady?.(finalHtml);
                    triggerAetherPulse();
                    pushAetherMessage({
                      role: 'assistant',
                      content: '[UI updated]',
                      timestamp: Date.now(),
                    });
                  }
                  setAetherStatus(null);
                  setAetherIsGenerating(false);
                  break;
                }

                case 'error':
                  throw new Error(event.message ?? 'Unknown error');

                default:
                  break;
              }
            } catch (parseErr) {
              // skip malformed event
            }
          }
        }
      } catch (err) {
        if ((err as { name?: string }).name === 'AbortError') return;
        console.error('[AetherInput] Error:', err);
        setAetherStatus('Something went wrong');
        setTimeout(() => setAetherStatus(null), 3000);
      } finally {
        setAetherIsGenerating(false);
      }
    },
    [
      setAetherHtml,
      setAetherPreviousHtml,
      setAetherIsGenerating,
      setAetherStatus,
      setAetherLastAction,
      triggerAetherPulse,
      pushAetherMessage,
      onUiReady,
      onDialogue,
    ],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setAetherIsGenerating(false);
    setAetherStatus(null);
  }, [setAetherIsGenerating, setAetherStatus]);

  return { sendInput, cancel };
}

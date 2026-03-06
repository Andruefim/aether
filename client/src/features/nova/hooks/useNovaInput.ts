import { useCallback, useRef } from 'react';
import { useAetherStore, type AetherMessage } from '../../../core';
import type { IncomingToken, StreamType } from '../components/TokenGlyphSystem';

interface ToneData {
  emotion: string;
  energy: number;
  color: string;
}

interface UseNovaInputOptions {
  /** Called when tone analysis arrives (drives orb colour shift) */
  onTone?: (tone: ToneData) => void;
  /** Called when main response text accumulates (for dialogue overlay) */
  onDialogue?: (text: string) => void;
  /** Ref to append new tokens into — TokenGlyphSystem reads this each frame */
  tokenBucketRef: React.MutableRefObject<IncomingToken[]>;
}

/**
 * useNovaInput
 *
 * Drives the Nova mode SSE pipeline:
 *  POST /api/nova/input
 *    → { type:'tone',  emotion, energy, color }
 *    → { type:'token', stream:'main'|'association', text, color }
 *    → { type:'done' }
 *
 * Tokens are pushed into `tokenBucketRef` so TokenGlyphSystem can
 * consume them each animation frame without React re-renders.
 */
export function useNovaInput({ onTone, onDialogue, tokenBucketRef }: UseNovaInputOptions) {
  const abortRef       = useRef<AbortController | null>(null);
  const mainBufferRef  = useRef('');

  const setAetherIsGenerating = useAetherStore((s) => s.setAetherIsGenerating);
  const setAetherStatus       = useAetherStore((s) => s.setAetherStatus);
  const pushAetherMessage     = useAetherStore((s) => s.pushAetherMessage);
  const aetherHistory         = useAetherStore((s) => s.aetherHistory);

  const sendInput = useCallback(
    async (text: string, screenshot?: string | null) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      mainBufferRef.current = '';
      setAetherIsGenerating(true);
      setAetherStatus('Thinking…');

      pushAetherMessage({ role: 'user', content: text, timestamp: Date.now() });

      try {
        // #region agent log
        fetch('http://127.0.0.1:7461/ingest/64501a78-c888-413b-b13b-8cfa3e20bfa3', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Debug-Session-Id': '5c9948',
          },
          body: JSON.stringify({
            sessionId: '5c9948',
            runId: 'nova-input-426',
            hypothesisId: 'H2-client-before-fetch',
            location: 'client/src/features/nova/hooks/useNovaInput.ts:54',
            message: 'Calling /api/nova/input',
            data: {
              url: '/api/nova/input',
            },
            timestamp: Date.now(),
          }),
        }).catch(() => {});
        // #endregion
        const res = await fetch('/api/nova/input', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            text,
            screenshot: screenshot ?? undefined,
            history: aetherHistory.slice(-8),
          }),
        });

        // #region agent log
        fetch('http://127.0.0.1:7461/ingest/64501a78-c888-413b-b13b-8cfa3e20bfa3', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Debug-Session-Id': '5c9948',
          },
          body: JSON.stringify({
            sessionId: '5c9948',
            runId: 'nova-input-426',
            hypothesisId: 'H3-client-after-fetch',
            location: 'client/src/features/nova/hooks/useNovaInput.ts:65',
            message: 'Received response from /api/nova/input',
            data: {
              status: res.status,
              ok: res.ok,
            },
            timestamp: Date.now(),
          }),
        }).catch(() => {});
        // #endregion

        if (!res.ok || !res.body) throw new Error(`Request failed: ${res.statusText}`);

        const reader  = res.body.getReader();
        const decoder = new TextDecoder();
        let sseBuffer = '';
        let isDone    = false;

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
                stream?: StreamType;
                text?: string;
                color?: string;
                emotion?: string;
                energy?: number;
                message?: string;
              };

              switch (event.type) {
                case 'tone':
                  setAetherStatus(null);
                  if (event.emotion) {
                    onTone?.({
                      emotion: event.emotion,
                      energy:  event.energy ?? 0.5,
                      color:   event.color  ?? '#a855f7',
                    });
                  }
                  break;

                case 'token':
                  if (event.text && event.stream && event.color) {
                    // Push into bucket — consumed by TokenGlyphSystem each frame
                    tokenBucketRef.current.push({
                      text:   event.text,
                      stream: event.stream,
                      color:  event.color,
                    });
                    // Accumulate main stream for dialogue overlay
                    if (event.stream === 'main') {
                      mainBufferRef.current += event.text;
                    }
                  }
                  break;

                case 'done':
                  isDone = true;
                  if (mainBufferRef.current.trim()) {
                    const fullText = mainBufferRef.current.trim();
                    onDialogue?.(fullText);
                    pushAetherMessage({
                      role: 'assistant',
                      content: fullText,
                      timestamp: Date.now(),
                    });
                  }
                  break;

                case 'error':
                  throw new Error(event.message ?? 'Nova error');
              }
            } catch {
              // skip malformed event
            }
          }
        }
      } catch (err) {
        if ((err as { name?: string }).name === 'AbortError') return;
        console.error('[useNovaInput]', err);
        setAetherStatus('Something went wrong');
        setTimeout(() => setAetherStatus(null), 3000);
      } finally {
        setAetherIsGenerating(false);
      }
    },
    [
      aetherHistory,
      onTone,
      onDialogue,
      tokenBucketRef,
      setAetherIsGenerating,
      setAetherStatus,
      pushAetherMessage,
    ],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setAetherIsGenerating(false);
    setAetherStatus(null);
  }, [setAetherIsGenerating, setAetherStatus]);

  return { sendInput, cancel };
}
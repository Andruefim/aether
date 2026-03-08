import React, { useCallback, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { AetherInputBar } from '../aether/components';
import { NovaScene, NovaStatusOverlay } from './components';
import { ConstellationTooltip, type TooltipState } from './components/ConstellationField';
import { ThoughtStreamWidget } from './components/ThoughtStreamWidget';
import { GoalsWidget } from './components/GoalsWidget';
import { ResearchSummaryWidget } from './components/ResearchSummaryWidget';
import { useNovaInput, useNovaVoiceAgent } from './hooks';
import { useAetherStore } from '../../core';
import type { IncomingToken, StreamType } from './components/TokenGlyphSystem';

/**
 * Drips a full string into the glyph bucket word-by-word with stagger.
 * Used for voice responses (full text arrives at once, not streamed).
 */
function staggerWords(
  text: string,
  bucket: React.MutableRefObject<IncomingToken[]>,
  stream: StreamType,
  color: string,
  intervalMs = 65,
): () => void {
  const words = text.trim().split(/\s+/).filter((w) => w.length >= 2);
  let i = 0;
  const id = setInterval(() => {
    if (i >= words.length) { clearInterval(id); return; }
    bucket.current.push({ text: words[i] + ' ', stream, color });
    i++;
  }, intervalMs);
  return () => clearInterval(id);
}

async function fetchHighlightIds(query: string): Promise<Set<string>> {
  try {
    const res = await fetch(`/api/nova/memory/search?q=${encodeURIComponent(query)}&k=12`);
    if (!res.ok) return new Set();
    const pts = (await res.json()) as { id: string }[];
    return new Set(pts.map((p) => p.id));
  } catch {
    return new Set();
  }
}

export function NovaPage() {
  const aetherIsGenerating = useAetherStore((s) => s.aetherIsGenerating);

  // Shared mutable bucket — TokenGlyphSystem reads .current every RAF
  const tokenBucketRef  = useRef<IncomingToken[]>([]);
  const staggerCancel   = useRef<(() => void) | null>(null);

  const [tooltip, setTooltip] = useState<TooltipState>({ text: '', x: 0, y: 0, visible: false });
  // Bumped every time Nova wakes from sleep — triggers summary refresh
  const [wakeSignal, setWakeSignal] = useState(0);

  // When set to a non-empty string, triggers the "settle" animation in TokenGlyphSystem
  const settleSignalRef = useRef<string>('');

  // IDs of memory points to highlight (nearest neighbors of current query)
  const highlightIdsRef = useRef<Set<string>>(new Set());

  const pushGlyphs = useCallback((text: string) => {
    staggerCancel.current?.();
    staggerCancel.current = staggerWords(text, tokenBucketRef, 'voice', '#c084fc', 65);
    // After words are dripped in, let them orbit for a moment then settle
    setTimeout(() => { settleSignalRef.current = text; }, 2000);
  }, []);

  // Text input → /api/nova/input  (3 parallel streams: main + association + tone)
  const { sendInput } = useNovaInput({
    onTone: (tone) => { console.log('[Nova] tone:', tone); },
    onDialogue: (text) => {
      // Trigger settle animation once the full response is received
      settleSignalRef.current = text;
    },
    tokenBucketRef,
  });

  // Voice agent → /api/nova/input  (no Aether HTML generation)
  const { isActive: agentActive, phase: agentPhase, startAgent, stopAgent } =
    useNovaVoiceAgent({
      onSpeak: pushGlyphs,
      onToken: (payload) => {
        // Streamed tokens from Nova (used for associations while speaking)
        tokenBucketRef.current.push(payload);
      },
    });

  const handleSubmit = useCallback(async (text: string) => {
    staggerCancel.current?.();
    settleSignalRef.current = '';
    // Highlight nearest memories for this query (fire-and-forget)
    fetchHighlightIds(text).then((ids) => { highlightIdsRef.current = ids; }).catch(() => {});
    await sendInput(text, null);
  }, [sendInput]);

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#05040f]">
      <Canvas
        camera={{ position: [0, 0, 4.8], fov: 55 }}
        gl={{ antialias: true, alpha: false }}
        onCreated={({ gl }) => { gl.setClearColor('#05040f', 1); }}
        style={{ position: 'absolute', inset: 0 }}
      >
        <NovaScene tokenBucketRef={tokenBucketRef} settleSignalRef={settleSignalRef} highlightIdsRef={highlightIdsRef} onTooltip={setTooltip} />
      </Canvas>

      <NovaStatusOverlay dialogueText={null} onDismiss={() => {}} />
      <ConstellationTooltip state={tooltip} />

      {/* Left: research goals */}
      <GoalsWidget />

      {/* Right centre: thought stream */}
      <ThoughtStreamWidget
        onAnswer={(ans) => {
          fetch('/api/nova/answer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ answer: ans }),
          }).catch(() => {});
        }}
        onWake={() => setWakeSignal((n) => n + 1)}
      />

      {/* Right: research summary */}
      <ResearchSummaryWidget wakeSignal={wakeSignal} />

      <AetherInputBar
        onSubmit={handleSubmit}
        disabled={aetherIsGenerating && !agentActive}
        agentActive={agentActive}
        agentPhase={agentPhase}
        onAgentStart={startAgent}
        onAgentStop={stopAgent}
      />
    </div>
  );
}
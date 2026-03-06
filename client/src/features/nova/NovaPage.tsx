import React, { useCallback, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { AetherInputBar } from '../aether/components';
import { NovaScene, NovaStatusOverlay } from './components';
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

export function NovaPage() {
  const aetherIsGenerating = useAetherStore((s) => s.aetherIsGenerating);

  // Shared mutable bucket — TokenGlyphSystem reads .current every RAF
  const tokenBucketRef  = useRef<IncomingToken[]>([]);
  const staggerCancel   = useRef<(() => void) | null>(null);

  const pushGlyphs = useCallback((text: string) => {
    staggerCancel.current?.();
    staggerCancel.current = staggerWords(text, tokenBucketRef, 'voice', '#c084fc', 65);
  }, []);

  // Text input → /api/nova/input  (3 parallel streams: main + association + tone)
  const { sendInput } = useNovaInput({
    onTone: (tone) => { console.log('[Nova] tone:', tone); },
    onDialogue: () => { /* main stream already arrives as glyphs */ },
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
        <NovaScene tokenBucketRef={tokenBucketRef} />
      </Canvas>

      <NovaStatusOverlay dialogueText={null} onDismiss={() => {}} />

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
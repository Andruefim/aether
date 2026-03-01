import React, { useCallback, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { useVoiceAgent } from '../aether/hooks';
import { AetherInputBar } from '../aether/components';
import { NovaScene, NovaStatusOverlay } from './components';
import { useNovaInput } from './hooks';
import { useAetherStore } from '../../core';
import type { IncomingToken, StreamType } from './components/TokenGlyphSystem';

/**
 * Drips a full string into the glyph bucket word-by-word with a delay.
 * Used for voice responses (we get the full text at once, not streamed).
 * Returns a cancel fn.
 */
function staggerWords(
  text: string,
  bucket: React.MutableRefObject<IncomingToken[]>,
  stream: StreamType,
  color: string,
  intervalMs = 60,
): () => void {
  const words = text.trim().split(/\s+/).filter(Boolean);
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

  // Shared mutable bucket — TokenGlyphSystem reads .current every animation frame
  const tokenBucketRef = useRef<IncomingToken[]>([]);
  const staggerCancelRef = useRef<(() => void) | null>(null);

  // Text input → /api/nova/input (3 parallel streams)
  const { sendInput } = useNovaInput({
    onTone: (tone) => {
      console.log('[Nova] tone:', tone); // Phase 3: → orb uniform
    },
    onDialogue: () => {
      // Main response already arrives as glyphs via tokenBucketRef — no overlay needed
    },
    tokenBucketRef,
  });

  // Voice agent — add onSpeak to intercept AI text before TTS
  const { isActive: agentActive, phase: agentPhase, startAgent, stopAgent } = useVoiceAgent({
    captureScreenshot: async () => null,
    onUiReady: () => {},
    onSpeak: (text: string) => {
      // Cancel any previous stagger, start new one
      staggerCancelRef.current?.();
      staggerCancelRef.current = staggerWords(text, tokenBucketRef, 'voice', '#c084fc', 60);
    },
  });

  const handleSubmit = useCallback(
    async (text: string) => {
      staggerCancelRef.current?.();
      await sendInput(text, null);
    },
    [sendInput],
  );

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#05040f]">
      {/* Three.js canvas — full screen */}
      <Canvas
        camera={{ position: [0, 0, 4.8], fov: 55 }}
        gl={{ antialias: true, alpha: false }}
        onCreated={({ gl }) => { gl.setClearColor('#05040f', 1); }}
        style={{ position: 'absolute', inset: 0 }}
      >
        <NovaScene tokenBucketRef={tokenBucketRef} />
      </Canvas>

      {/* Status pill only (no dialogue bubble) */}
      <NovaStatusOverlay
        dialogueText={null}
        onDismiss={() => {}}
      />

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
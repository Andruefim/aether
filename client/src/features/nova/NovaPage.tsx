import React, { useState, useCallback } from 'react';
import { Canvas } from '@react-three/fiber';
import { useAetherInput, useVoiceAgent, type AgentPhase } from '../aether/hooks';
import { AetherInputBar } from '../aether/components';
import { NovaScene, NovaStatusOverlay } from './components';
import { useAetherStore } from '../../core';

/**
 * NovaPage — Aether Nova mode.
 *
 * Renders a full-screen Three.js scene with the reactive plasma orb.
 * Reuses the existing Aether hooks and API endpoints so the orb state
 * (isGenerating / isListening / isSpeaking) drives all shader uniforms.
 *
 * Phase 1 scope: orb + dialogue overlay. HTML generation results are
 * acknowledged with a dialogue response instead of displaying an iframe.
 */
export function NovaPage() {
  const [dialogueText, setDialogueText] = useState<string | null>(null);

  const aetherIsGenerating = useAetherStore((s) => s.aetherIsGenerating);

  const handleDialogue = useCallback((text: string) => {
    setDialogueText(text);
  }, []);

  // Text input flow — no iframe, so onUiReady is a no-op
  const { sendInput } = useAetherInput({
    onUiReady: () => {
      // Nova Phase 1: HTML generation silently completes — we just show the spoken confirmation
    },
    onDialogue: handleDialogue,
  });

  // Voice agent flow
  const { isActive: agentActive, phase: agentPhase, startAgent, stopAgent } = useVoiceAgent({
    captureScreenshot: async () => null,
    onUiReady: () => {},
  });

  const handleSubmit = useCallback(
    async (text: string) => {
      setDialogueText(null);
      await sendInput(text, null);
    },
    [sendInput],
  );

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#05040f]">
      {/* ── Three.js scene ─────────────────────────────────────────────── */}
      <Canvas
        camera={{ position: [0, 0, 3.2], fov: 50 }}
        gl={{ antialias: true, alpha: false }}
        onCreated={({ gl, scene }) => {
          gl.setClearColor('#05040f', 1);
        }}
        style={{ position: 'absolute', inset: 0 }}
      >
        <NovaScene />
      </Canvas>

      {/* ── UI overlays ────────────────────────────────────────────────── */}
      <NovaStatusOverlay
        dialogueText={dialogueText}
        onDismiss={() => setDialogueText(null)}
      />

      {/* Reuse AetherInputBar — same component, different page context */}
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
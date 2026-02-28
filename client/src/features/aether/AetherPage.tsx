import React, { useRef, useState, useCallback, useEffect } from 'react';
import { useAetherStore } from '../../core';
import { INITIAL_AETHER_HTML } from './constants';
import {
  AetherCanvas,
  AetherStatus,
  AetherInputBar,
  type AetherCanvasHandle,
} from './components';
import { useAetherInput, useVoiceAgent } from './hooks';

export function AetherPage() {
  const canvasRef = useRef<AetherCanvasHandle>(null);
  const [dialogueText, setDialogueText] = useState<string | null>(null);

  const setAetherHtml = useAetherStore((s) => s.setAetherHtml);
  const aetherIsGenerating = useAetherStore((s) => s.aetherIsGenerating);

  useEffect(() => {
    if (!useAetherStore.getState().aetherHtml) {
      setAetherHtml(INITIAL_AETHER_HTML);
    }
  }, [setAetherHtml]);

  const handleUiReady = useCallback((html: string) => {
    canvasRef.current?.applyHtml(html);
  }, []);

  const handleDialogue = useCallback((text: string) => {
    setDialogueText(text);
  }, []);

  // Text input flow (existing)
  const { sendInput } = useAetherInput({
    onUiReady: handleUiReady,
    onDialogue: handleDialogue,
  });

  // Voice agent flow (new)
  const { isActive: agentActive, phase: agentPhase, startAgent, stopAgent } = useVoiceAgent({
    captureScreenshot: () => canvasRef.current?.captureScreenshot() ?? Promise.resolve(null),
    onUiReady: handleUiReady,
  });

  const handleSubmit = useCallback(
    async (text: string) => {
      setDialogueText(null);
      const screenshot = await canvasRef.current?.captureScreenshot() ?? null;
      await sendInput(text, screenshot);
    },
    [sendInput],
  );

  return (
    <div className="relative w-screen h-screen overflow-hidden">

      <AetherCanvas ref={canvasRef} />

      <AetherStatus
        dialogueText={dialogueText}
        onDismissDialogue={() => setDialogueText(null)}
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
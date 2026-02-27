import React, { useRef, useState, useCallback, useEffect } from 'react';
import { useAetherStore } from '../../core';
import { INITIAL_AETHER_HTML } from './constants';
import {
  AetherCanvas,
  AetherStatus,
  AetherInputBar,
  type AetherCanvasHandle,
} from './components';
import { useAetherInput } from './hooks';

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

  const { sendInput } = useAetherInput({
    onUiReady: handleUiReady,
    onDialogue: handleDialogue,
  });

  const handleSubmit = useCallback(
    async (text: string) => {
      setDialogueText(null);
      // Screenshot comes from iframe content via handle
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
        disabled={aetherIsGenerating}
      />
    </div>
  );
}
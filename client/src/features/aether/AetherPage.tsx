import React, { useRef, useState, useCallback, useEffect } from 'react';
import { useAetherStore } from '../../core';
import { INITIAL_AETHER_HTML } from './constants';
import {
  AetherCanvas,
  AetherStatus,
  AetherInputBar,
  type AetherCanvasHandle,
} from './components';
import { useAetherInput, useScreenshot } from './hooks';

export function AetherPage() {
  const canvasRef = useRef<AetherCanvasHandle>(null);
  const [dialogueText, setDialogueText] = useState<string | null>(null);

  const setAetherHtml = useAetherStore((s) => s.setAetherHtml);
  const aetherIsGenerating = useAetherStore((s) => s.aetherIsGenerating);
  const aetherPulseAt = useAetherStore((s) => s.aetherPulseAt);

  const { captureElement } = useScreenshot();

  // Initialize store with default HTML on first mount
  useEffect(() => {
    const currentHtml = useAetherStore.getState().aetherHtml;
    if (!currentHtml) {
      setAetherHtml(INITIAL_AETHER_HTML);
    }
  }, [setAetherHtml]);

  // When morphdom should apply the final HTML
  const handleUiReady = useCallback((html: string) => {
    canvasRef.current?.applyHtml(html);
  }, []);

  const handleDialogue = useCallback((text: string) => {
    setDialogueText(text);
  }, []);

  const { sendInput } = useAetherInput({
    canvasRef: { current: canvasRef.current?.getElement() ?? null } as React.RefObject<HTMLElement>,
    onUiReady: handleUiReady,
    onDialogue: handleDialogue,
  });

  const handleSubmit = useCallback(
    async (text: string) => {
      setDialogueText(null);
      const screenshot = await captureElement(canvasRef.current?.getElement() ?? null);
      await sendInput(text, screenshot);
    },
    [captureElement, sendInput],
  );

  return (
    <div className="relative w-screen h-screen overflow-hidden">
      {/* Live interface canvas — z-10 */}
      <AetherCanvas ref={canvasRef} />

      {/* Status indicators, undo button, dialogue overlay */}
      <AetherStatus
        dialogueText={dialogueText}
        onDismissDialogue={() => setDialogueText(null)}
      />

      {/* Input bar with voice button — z-50 */}
      <AetherInputBar
        onSubmit={handleSubmit}
        disabled={aetherIsGenerating}
      />
    </div>
  );
}

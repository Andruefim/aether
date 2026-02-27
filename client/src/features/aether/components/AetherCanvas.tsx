import React, { useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { useAetherStore } from '../../../core';
import { stripMarkdownCodeFence } from '../../../shared';
import { INITIAL_AETHER_HTML } from '../constants';

export interface AetherCanvasHandle {
  applyHtml: (html: string) => void;
  getElement: () => HTMLIFrameElement | null;
  /** Capture the iframe content as base64 jpeg for vision (MiniCPM screenshot). */
  captureScreenshot: () => Promise<string | null>;
}

/**
 * Full-screen iframe that renders the live Aether interface.
 *
 * iframe gives us:
 * - Full CSS isolation — generated `* { margin:0 }` never leaks to parent page
 * - Scripts run natively — document.getElementById works without any patches
 * - Screenshot support — html2canvas can target iframe.contentDocument.body
 */
export const AetherCanvas = forwardRef<AetherCanvasHandle>((_, ref) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const lastAppliedRef = useRef<string>('');
  const aetherHtml = useAetherStore((s) => s.aetherHtml);
  const aetherIsGenerating = useAetherStore((s) => s.aetherIsGenerating);

  function injectHtml(html: string) {
    if (!html) return;
    if (lastAppliedRef.current === html) return;
    lastAppliedRef.current = html;

    const iframe = iframeRef.current;
    if (!iframe) return;
    const doc = iframe.contentDocument;
    if (!doc) return;

    doc.open();
    doc.write(html);
    doc.close();
  }

  async function captureScreenshot(): Promise<string | null> {
    const iframe = iframeRef.current;
    if (!iframe) return null;
    const body = iframe.contentDocument?.body;
    if (!body) return null;
    try {
      const { default: html2canvas } = await import('html2canvas');
      const canvas = await html2canvas(body, {
        scale: 0.5,
        useCORS: true,
        logging: false,
        backgroundColor: null,
        // Tell html2canvas to use the iframe's window
        windowWidth: iframe.contentWindow?.innerWidth ?? 1280,
        windowHeight: iframe.contentWindow?.innerHeight ?? 800,
      });
      const dataUrl = canvas.toDataURL('image/jpeg', 0.65);
      return dataUrl.split(',')[1] ?? null;
    } catch {
      return null;
    }
  }

  useImperativeHandle(ref, () => ({
    applyHtml: (html: string) => injectHtml(html),
    getElement: () => iframeRef.current,
    captureScreenshot,
  }));

  useEffect(() => {
    if (!aetherIsGenerating && aetherHtml) {
      injectHtml(stripMarkdownCodeFence(aetherHtml));
    }
  }, [aetherIsGenerating, aetherHtml]);

  useEffect(() => {
    const t = setTimeout(() => {
      const initial = useAetherStore.getState().aetherHtml || INITIAL_AETHER_HTML;
      injectHtml(initial);
    }, 50);
    return () => clearTimeout(t);
  }, []);

  return (
    <iframe
      ref={iframeRef}
      className="absolute inset-0 z-10 w-full h-full border-none"
      sandbox="allow-scripts allow-same-origin allow-forms allow-modals"
      title="Aether Interface"
      style={{ background: 'transparent' }}
    />
  );
});

AetherCanvas.displayName = 'AetherCanvas';
import React, { useEffect, useRef, forwardRef, useImperativeHandle, useCallback } from 'react';
import { useAetherStore } from '../../../core';
import { stripMarkdownCodeFence } from '../../../shared';
import { INITIAL_AETHER_HTML } from '../constants';

export interface AetherCanvasHandle {
  applyHtml: (html: string) => void;
  getElement: () => HTMLIFrameElement | null;
  captureScreenshot: () => Promise<string | null>;
}

/**
 * Full-screen iframe that renders the live Aether interface.
 *
 * Updates in real-time during SSE streaming via throttle (300ms).
 * Immediately flushes on generation complete.
 */
export const AetherCanvas = forwardRef<AetherCanvasHandle>((_, ref) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const lastAppliedRef = useRef<string>('');
  const throttleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingHtmlRef = useRef<string>('');

  const aetherHtml = useAetherStore((s) => s.aetherHtml);
  const aetherIsGenerating = useAetherStore((s) => s.aetherIsGenerating);

  const injectHtml = useCallback((html: string) => {
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
  }, []);

  // Throttled inject — batches rapid token updates, one write per 300ms
  const injectThrottled = useCallback((html: string) => {
    pendingHtmlRef.current = html;
    if (throttleTimerRef.current) return;
    throttleTimerRef.current = setTimeout(() => {
      throttleTimerRef.current = null;
      injectHtml(pendingHtmlRef.current);
    }, 300);
  }, [injectHtml]);

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

  // Real-time: throttled during streaming, immediate flush on done
  useEffect(() => {
    if (!aetherHtml) return;
    const html = stripMarkdownCodeFence(aetherHtml);

    if (aetherIsGenerating) {
      injectThrottled(html);
    } else {
      // Generation complete — cancel pending throttle, apply immediately
      if (throttleTimerRef.current) {
        clearTimeout(throttleTimerRef.current);
        throttleTimerRef.current = null;
      }
      injectHtml(html);
    }
  }, [aetherHtml, aetherIsGenerating, injectHtml, injectThrottled]);

  // Initialize on mount
  useEffect(() => {
    const t = setTimeout(() => {
      const initial = useAetherStore.getState().aetherHtml || INITIAL_AETHER_HTML;
      injectHtml(initial);
    }, 50);
    return () => {
      clearTimeout(t);
      if (throttleTimerRef.current) clearTimeout(throttleTimerRef.current);
    };
  }, [injectHtml]);

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
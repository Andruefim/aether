import React, { useEffect, useRef, forwardRef, useImperativeHandle, useCallback } from 'react';
import { useAetherStore } from '../../../core';
import { stripMarkdownCodeFence, stripToHtmlDocumentStart } from '../../../shared';
import { INITIAL_AETHER_HTML } from '../constants';

export interface AetherCanvasHandle {
  applyHtml: (html: string) => void;
  getElement: () => HTMLIFrameElement | null;
  captureScreenshot: () => Promise<string | null>;
}

/**
 * Full-screen iframe that renders the live Aether interface.
 *
 * Streaming strategy: incremental doc.write()
 * - On first token: doc.open() + doc.write(fullHtml)
 * - On each subsequent token: doc.write(newSuffixOnly) — O(1) diff via string length
 * - On generation complete: doc.close() — browser finalizes DOM and runs scripts
 *
 * This mirrors how browsers natively stream HTML from the network,
 * so existing DOM nodes are preserved and only new content is appended.
 */
export const AetherCanvas = forwardRef<AetherCanvasHandle>((_, ref) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const isDocOpenRef = useRef(false);
  const lastWrittenLengthRef = useRef(0);
  const lastFullHtmlRef = useRef('');

  const aetherHtml = useAetherStore((s) => s.aetherHtml);
  const aetherIsGenerating = useAetherStore((s) => s.aetherIsGenerating);

  const closeDoc = useCallback(() => {
    const doc = iframeRef.current?.contentDocument;
    if (doc && isDocOpenRef.current) {
      doc.close();
    }
    isDocOpenRef.current = false;
    lastWrittenLengthRef.current = 0;
  }, []);

  /**
   * Inject a complete HTML string — used for initial load and manual applyHtml calls.
   * Always does a full doc.open/write/close cycle.
   */
  const injectFull = useCallback((html: string) => {
    if (!html) return;
    const clean = stripToHtmlDocumentStart(stripMarkdownCodeFence(html));
    if (!clean) return;
    if (lastFullHtmlRef.current === clean) return;
    lastFullHtmlRef.current = clean;

    const iframe = iframeRef.current;
    if (!iframe) return;
    const doc = iframe.contentDocument;
    if (!doc) return;

    // Close any open streaming session first
    if (isDocOpenRef.current) {
      doc.close();
      isDocOpenRef.current = false;
    }

    doc.open();
    doc.write(clean);
    doc.close();
    lastWrittenLengthRef.current = 0;
  }, []);

  /**
   * Incremental streaming write.
   * isFinal=true closes the document so scripts execute.
   * When new html is a full document (starts with <!DOCTYPE) and differs from what we wrote, do full replace.
   */
  const injectIncremental = useCallback((html: string, isFinal: boolean) => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const doc = iframe.contentDocument;
    if (!doc) return;

    const isNewDocument =
      html.trimStart().toLowerCase().startsWith('<!doctype') ||
      html.trimStart().toLowerCase().startsWith('<html');
    const previousMatch =
      lastFullHtmlRef.current &&
      html.length >= lastWrittenLengthRef.current &&
      html.slice(0, lastWrittenLengthRef.current) === lastFullHtmlRef.current;

    if (!isDocOpenRef.current || (isNewDocument && !previousMatch)) {
      // New document or first chunk — full replace
      if (isDocOpenRef.current) {
        doc.close();
        isDocOpenRef.current = false;
      }
      doc.open();
      doc.write(html);
      lastWrittenLengthRef.current = html.length;
      lastFullHtmlRef.current = html;
      isDocOpenRef.current = true;
    } else {
      // Same document continuing — append only the new suffix
      const delta = html.slice(lastWrittenLengthRef.current);
      if (delta) {
        doc.write(delta);
        lastWrittenLengthRef.current = html.length;
        lastFullHtmlRef.current = html;
      }
    }

    if (isFinal) {
      doc.close();
      isDocOpenRef.current = false;
      lastWrittenLengthRef.current = 0;
    }
  }, []);

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
    applyHtml: (html: string) => injectFull(html),
    getElement: () => iframeRef.current,
    captureScreenshot,
  }));

  // Streaming updates — every token triggers this (strip preamble so doc.write never gets plain text)
  useEffect(() => {
    if (!aetherHtml) return;
    const html = stripToHtmlDocumentStart(stripMarkdownCodeFence(aetherHtml));
    if (!html) return;
    injectIncremental(html, !aetherIsGenerating);
  }, [aetherHtml, aetherIsGenerating, injectIncremental]);

  // Initialize on mount with default or stored HTML
  useEffect(() => {
    const t = setTimeout(() => {
      const initial = useAetherStore.getState().aetherHtml || INITIAL_AETHER_HTML;
      injectFull(initial);
    }, 50);
    return () => {
      clearTimeout(t);
      closeDoc();
    };
  }, [injectFull, closeDoc]);

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
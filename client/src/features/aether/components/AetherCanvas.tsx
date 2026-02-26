import React, { useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { useAetherStore } from '../../../core';
import { stripMarkdownCodeFence } from '../../../shared';
import { INITIAL_AETHER_HTML } from '../constants';

export interface AetherCanvasHandle {
  applyHtml: (html: string) => void;
  getElement: () => HTMLDivElement | null;
}

/**
 * Full-screen container that renders the live Aether interface inside a Shadow DOM.
 * Shadow DOM fully isolates injected CSS from the parent page —
 * global resets like `* { margin: 0 }` inside generated HTML won't affect
 * ModeSwitch, InputBar, or any other parent components.
 */
export const AetherCanvas = forwardRef<AetherCanvasHandle>((_, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const shadowRef = useRef<ShadowRoot | null>(null);
  const lastAppliedRef = useRef<string>('');
  const aetherHtml = useAetherStore((s) => s.aetherHtml);
  const aetherIsGenerating = useAetherStore((s) => s.aetherIsGenerating);

  // Attach Shadow DOM once on mount
  useEffect(() => {
    const el = containerRef.current;
    if (!el || shadowRef.current) return;
    shadowRef.current = el.attachShadow({ mode: 'open' });
    const initial = useAetherStore.getState().aetherHtml || INITIAL_AETHER_HTML;
    injectHtml(initial);
  }, []);

  function injectHtml(html: string) {
    if (!html) return;
    if (lastAppliedRef.current === html) return;
    lastAppliedRef.current = html;

    const shadow = shadowRef.current;
    if (!shadow) return;

    // Parse the full HTML document
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // Build shadow content: all <style> tags + body innerHTML
    const styles = Array.from(doc.querySelectorAll('style'))
      .map((s) => s.outerHTML)
      .join('\n');
    const bodyContent = doc.body.innerHTML;

    shadow.innerHTML = styles + bodyContent;

    // Re-execute scripts (innerHTML doesn't run them)
    reRunScripts(shadow);
  }

  // Apply final HTML when generation completes
  useEffect(() => {
    if (!aetherIsGenerating && aetherHtml) {
      injectHtml(stripMarkdownCodeFence(aetherHtml));
    }
  }, [aetherIsGenerating, aetherHtml]);

  useImperativeHandle(ref, () => ({
    applyHtml: (html: string) => injectHtml(html),
    getElement: () => containerRef.current,
  }));

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 z-10"
      style={{ width: '100vw', height: '100vh', overflow: 'hidden', pointerEvents: 'auto' }}
    />
  );
});

AetherCanvas.displayName = 'AetherCanvas';

function reRunScripts(root: ShadowRoot) {
  root.querySelectorAll('script').forEach((oldScript) => {
    if (oldScript.src) return;
    const newScript = document.createElement('script');
    newScript.textContent = (oldScript.textContent ?? '')
      .replace(/\bconst\s+/g, 'var ')
      .replace(/\blet\s+/g, 'var ');
    oldScript.replaceWith(newScript);
  });
}
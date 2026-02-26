import React, { useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { useAetherStore } from '../../../core';
import { stripMarkdownCodeFence } from '../../../shared';
import { INITIAL_AETHER_HTML } from '../constants';

export interface AetherCanvasHandle {
  applyHtml: (html: string) => void;
  getElement: () => HTMLDivElement | null;
}

/**
 * Full-screen container that renders the live Aether interface.
 *
 * Uses morphdom for DOM diffing when available.
 * Falls back to safe innerHTML injection.
 * Scripts are re-executed on each full replacement.
 */
export const AetherCanvas = forwardRef<AetherCanvasHandle>((_, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const lastAppliedRef = useRef<string>('');
  const aetherHtml = useAetherStore((s) => s.aetherHtml);
  const aetherIsGenerating = useAetherStore((s) => s.aetherIsGenerating);

  // Expose imperative handle for parent
  useImperativeHandle(ref, () => ({
    applyHtml: (html: string) => injectHtml(html),
    getElement: () => containerRef.current,
  }));

  function injectHtml(html: string) {
    const el = containerRef.current;
    if (!el || !html) return;
    if (lastAppliedRef.current === html) return;
    lastAppliedRef.current = html;

    // Try morphdom first for minimal DOM updates
    applyWithMorphdomOrInnerHtml(el, html);
  }

  // When generation is complete (not generating), apply the final HTML via morphdom
  useEffect(() => {
    if (!aetherIsGenerating && aetherHtml) {
      injectHtml(stripMarkdownCodeFence(aetherHtml));
    }
  }, [aetherIsGenerating, aetherHtml]);

  // Initialize with default HTML on first mount
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const initial = useAetherStore.getState().aetherHtml || INITIAL_AETHER_HTML;
    injectHtml(initial);
  }, []);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 z-10"
      style={{ width: '100vw', height: '100vh', overflow: 'hidden', pointerEvents: 'auto' }}
    />
  );
});

AetherCanvas.displayName = 'AetherCanvas';

// ── Helpers ────────────────────────────────────────────────────────────────

async function applyWithMorphdomOrInnerHtml(container: HTMLDivElement, html: string) {
  try {
    const { default: morphdom } = await import('morphdom');

    // Wrap in a div for morphdom comparison
    const wrapper = document.createElement('div');
    wrapper.innerHTML = html;

    morphdom(container, wrapper, {
      childrenOnly: true,
      onBeforeElUpdated(fromEl, toEl) {
        // Don't update identical nodes
        if (fromEl.isEqualNode(toEl)) return false;
        // Preserve focused inputs
        if (
          (fromEl.tagName === 'INPUT' || fromEl.tagName === 'TEXTAREA' || fromEl.tagName === 'SELECT') &&
          document.activeElement === fromEl
        ) {
          return false;
        }
        return true;
      },
    });

    // Re-run scripts that morphdom skipped
    reRunScripts(container);
  } catch {
    // morphdom not available — safe HTML injection
    injectSafe(container, html);
  }
}

function injectSafe(container: HTMLDivElement, html: string) {
  container.innerHTML = '';
  container.innerHTML = html;
  reRunScripts(container);
}

function reRunScripts(container: HTMLElement) {
  // Re-execute scripts because innerHTML doesn't run them
  container.querySelectorAll('script').forEach((oldScript) => {
    if (oldScript.src) return; // external scripts: skip (already loaded)
    const newScript = document.createElement('script');
    newScript.textContent = (oldScript.textContent ?? '')
      .replace(/\bconst\s+/g, 'var ')
      .replace(/\blet\s+/g, 'var ');
    // Replace in-place so it runs
    oldScript.replaceWith(newScript);
  });
}

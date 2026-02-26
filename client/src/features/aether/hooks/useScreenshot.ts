import { useCallback } from 'react';

/**
 * Returns a function that captures the given element as a base64 JPEG string.
 * Requires html2canvas: `npm install html2canvas`.
 * Falls back gracefully if html2canvas is unavailable.
 */
export function useScreenshot() {
  const captureElement = useCallback(async (el: HTMLElement | null): Promise<string | null> => {
    if (!el) return null;
    try {
      // Dynamic import so the app doesn't crash if html2canvas is missing
      const { default: html2canvas } = await import('html2canvas');
      const canvas = await html2canvas(el, {
        scale: 0.5,
        useCORS: true,
        logging: false,
        backgroundColor: null,
      });
      // Return base64 without the data: prefix (Ollama expects raw base64)
      const dataUrl = canvas.toDataURL('image/jpeg', 0.65);
      return dataUrl.split(',')[1] ?? null;
    } catch {
      // html2canvas not installed or canvas capture failed — proceed without screenshot
      return null;
    }
  }, []);

  return { captureElement };
}

import { useAetherStore } from '../../../core';

export async function requestWidgetPreview(
  widgetId: string,
  userPrompt: string,
): Promise<void> {
  try {
    const res = await fetch('/api/generate/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ widgetId, userPrompt }),
    });
    if (!res.ok) return;
    const { html } = (await res.json()) as { html: string };
    if (!html) return;
    useAetherStore.getState().updateWidget(widgetId, { preview_html: html });
  } catch {
    // non-critical
  }
}

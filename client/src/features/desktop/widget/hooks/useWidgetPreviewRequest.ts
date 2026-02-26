import { useEffect } from 'react';
import { requestWidgetPreview } from '../api';

export function useWidgetPreviewRequest(
  widgetId: string,
  userPrompt: string,
  cleanHtml: string,
  isGenerating: boolean,
  hasPreviewHtml: boolean,
): void {
  useEffect(() => {
    if (isGenerating || !cleanHtml || hasPreviewHtml) return;
    requestWidgetPreview(widgetId, userPrompt);
  }, [isGenerating, widgetId, hasPreviewHtml, cleanHtml, userPrompt]);
}

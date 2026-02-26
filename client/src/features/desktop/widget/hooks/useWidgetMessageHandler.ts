import { useEffect } from 'react';
import { useAetherStore } from '../../../../core';

export function useWidgetMessageHandler(widgetId: string): void {
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (e.data?.widgetId !== widgetId) return;
      if (e.data?.type === 'save') {
        fetch(`/api/widgets/${widgetId}/data`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(e.data.data ?? e.data),
        });
      } else if (e.data?.type === 'close') {
        useAetherStore.getState().closeWindowToMiniature(widgetId);
        fetch(`/api/widgets/${widgetId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ minimized: true }),
        });
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [widgetId]);
}

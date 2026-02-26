import { useCallback } from 'react';
import { useAetherStore } from '../../../../core';
import type { WidgetData } from '../../../../core';

export function useWidgetActions(data: WidgetData, onOpen?: () => void) {
  const removeWidget = useAetherStore((s) => s.removeWidget);
  const updateWidget = useAetherStore((s) => s.updateWidget);
  const openWidget = useAetherStore((s) => s.openWidget);
  const closeWindowToMiniature = useAetherStore((s) => s.closeWindowToMiniature);

  const closeWidget = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      removeWidget(data.id);
      fetch(`/api/widgets/${data.id}`, { method: 'DELETE' });
    },
    [data.id, removeWidget],
  );

  const minimizeWindow = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      closeWindowToMiniature(data.id);
      updateWidget(data.id, { minimized: true });
      fetch(`/api/widgets/${data.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ minimized: true }),
      });
    },
    [data.id, closeWindowToMiniature, updateWidget],
  );

  const handleMiniatureClick = useCallback(() => {
    if (onOpen) onOpen();
    else openWidget(data.id);
  }, [data.id, onOpen, openWidget]);

  return { closeWidget, minimizeWindow, handleMiniatureClick };
}

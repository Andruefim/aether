import { useEffect } from 'react';
import { useAetherStore, type WidgetData } from '../../../core';

export function useWidgetsLoad() {
  const setWidgets = useAetherStore((s) => s.setWidgets);

  useEffect(() => {
    fetch('/api/widgets')
      .then((res) => res.json())
      .then((data: WidgetData[]) => {
        const current = useAetherStore.getState().widgets;
        const generating = current.filter((w) => w.isGenerating);
        const serverIds = new Set(data.map((w) => w.id));
        const merged = data.map((w) => {
          const cur = generating.find((g) => g.id === w.id);
          return cur ?? w;
        });
        const generatingOnly = generating.filter((g) => !serverIds.has(g.id));
        setWidgets([...merged, ...generatingOnly]);
      });
  }, [setWidgets]);
}

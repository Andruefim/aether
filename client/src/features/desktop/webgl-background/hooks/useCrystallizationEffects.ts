import { useEffect, useRef, useState } from 'react';
import { useAetherStore } from '../../../../core';
import { FADE_OUT_DURATION_MS } from '../constants';
import type { EffectEntry, WidgetEffectData } from '../types';

function toEffectData(w: {
  id: string;
  position_x: number;
  position_y: number;
  width: number;
  height: number;
  progress?: number;
}): WidgetEffectData {
  return {
    position_x: w.position_x,
    position_y: w.position_y,
    width: w.width,
    height: w.height,
    progress: w.progress,
  };
}

export function useCrystallizationEffects(): Map<string, EffectEntry> {
  const widgets = useAetherStore((state) => state.widgets);
  const [effects, setEffects] = useState<Map<string, EffectEntry>>(new Map());
  const prevGeneratingIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const generatingWidgets = widgets.filter((w) => w.isGenerating);
    const now = Date.now();
    const generatingIds = new Set(generatingWidgets.map((w) => w.id));
    const prev = prevGeneratingIdsRef.current;
    const finishedIds = Array.from(prev).filter((id) => !generatingIds.has(id));
    prevGeneratingIdsRef.current = generatingIds;

    setEffects((prevMap) => {
      const next = new Map(prevMap);
      for (const w of generatingWidgets) next.set(w.id, { widget: toEffectData(w) });
      for (const id of finishedIds) {
        const w = widgets.find((x) => x.id === id);
        if (w)
          next.set(id, {
            widget: toEffectData(w),
            fadeOutEndTime: now + FADE_OUT_DURATION_MS,
          });
      }
      for (const [id, entry] of next) {
        if (entry.fadeOutEndTime != null && entry.fadeOutEndTime <= now)
          next.delete(id);
      }
      return next;
    });
  }, [widgets]);

  useEffect(() => {
    const t = setInterval(() => {
      const now = Date.now();
      setEffects((prev) => {
        let changed = false;
        const next = new Map(prev);
        for (const [id, entry] of next) {
          if (entry.fadeOutEndTime != null && entry.fadeOutEndTime <= now) {
            next.delete(id);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 100);
    return () => clearInterval(t);
  }, []);

  return effects;
}

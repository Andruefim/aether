import { useState } from 'react';
import { useDragControls, useMotionValue } from 'motion/react';
import { useAetherStore } from '../../../../core';
import type { WidgetData } from '../../../../core';

export function useWidgetDrag(data: WidgetData) {
  const updateWidget = useAetherStore((s) => s.updateWidget);
  const dragControls = useDragControls();
  const dragX = useMotionValue(0);
  const dragY = useMotionValue(0);
  const [isDragging, setIsDragging] = useState(false);

  return {
    dragControls,
    dragX,
    dragY,
    isDragging,
    setIsDragging,
    handleDragEnd: (_event: unknown, info: { offset: { x: number; y: number } }) => {
      setIsDragging(false);
      const newX = data.position_x + info.offset.x;
      const newY = data.position_y + info.offset.y;
      updateWidget(data.id, { position_x: newX, position_y: newY });
      fetch(`/api/widgets/${data.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ position_x: newX, position_y: newY }),
      });
      dragX.set(0);
      dragY.set(0);
    },
  };
}

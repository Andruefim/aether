import React from 'react';

type Props = {
  widgetId: string;
  userPrompt: string;
  containerRef: React.RefObject<HTMLDivElement | null>;
};

export function WidgetFocusedContent({
  widgetId,
  userPrompt,
  containerRef,
}: Props) {
  return (
    <div
      ref={containerRef}
      data-widget-id={widgetId}
      className="w-full h-full border-none bg-transparent overflow-auto widget-content pointer-events-auto"
      aria-label={userPrompt}
    />
  );
}

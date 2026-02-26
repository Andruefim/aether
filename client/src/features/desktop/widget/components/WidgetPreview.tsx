import React from 'react';
import { stripScriptsAndStyles } from '../../../../shared';

export type WidgetPreviewProps = {
  /** Raw HTML from the stream (will be sanitized: no script/style). */
  html: string;
  className?: string;
};

/**
 * Renders HTML without executing scripts or applying style tags.
 * Safe to use for live preview during widget generation.
 */
export const WidgetPreview: React.FC<WidgetPreviewProps> = ({ html, className = '' }) => {
  const sanitized = stripScriptsAndStyles(html);
  if (!sanitized) {
    return (
      <div className={`flex items-center justify-center text-white/40 font-mono text-sm ${className}`}>
        Waiting for content...
      </div>
    );
  }
  return (
    <div
      className={`widget-content overflow-auto border-none bg-transparent ${className}`}
      dangerouslySetInnerHTML={{ __html: sanitized }}
      aria-label="Live preview"
    />
  );
};

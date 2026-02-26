import React from 'react';
import { WidgetPreview } from '../../../preview';
import { stripMarkdownCodeFence } from '../../../../shared';

type Props = {
  html: string;
  progress: number;
  livePreviewEnabled: boolean;
  onLivePreviewChange: (enabled: boolean) => void;
};

export function WidgetGeneratingContent({
  html,
  progress,
  livePreviewEnabled,
  onLivePreviewChange,
}: Props) {
  return (
    <div className="w-full h-full flex flex-col min-h-0">
      {livePreviewEnabled && html ? (
        <WidgetPreview
          html={stripMarkdownCodeFence(html)}
          className="flex-1 min-h-0 w-full"
        />
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center text-white/50 font-mono text-sm">
          <div className="mb-4">Crystallizing...</div>
          <div className="w-32 h-1 bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-indigo-500 transition-all duration-200"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
        </div>
      )}
      <label className="flex items-center gap-2 px-3 py-2 text-white/50 text-xs border-t border-white/10 shrink-0">
        <input
          type="checkbox"
          checked={livePreviewEnabled}
          onChange={(e) => onLivePreviewChange(e.target.checked)}
          className="rounded border-white/30 bg-white/10"
        />
        <span>Live HTML preview</span>
      </label>
    </div>
  );
}

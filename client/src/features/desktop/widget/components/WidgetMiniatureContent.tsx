import React from 'react';

type Props = {
  previewHtml: string | null;
  userPrompt: string;
  width: number;
  height: number;
};

export function WidgetMiniatureContent({
  previewHtml,
  userPrompt,
  width,
  height,
}: Props) {
  return (
    <div className="w-full h-full pointer-events-none">
      {previewHtml ? (
        <iframe
          srcDoc={previewHtml}
          sandbox="allow-scripts allow-same-origin"
          scrolling="no"
          title={userPrompt}
          marginWidth={0}
          marginHeight={0}
          style={{
            width,
            height,
            border: 'none',
            overflow: 'hidden',
            display: 'block',
            background: 'transparent',
          }}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center px-4">
          <span className="text-white/40 text-[11px] font-light tracking-wide text-center leading-snug select-none">
            {userPrompt}
          </span>
        </div>
      )}
    </div>
  );
}

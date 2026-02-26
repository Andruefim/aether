import React, { useRef } from 'react';
import { motion } from 'motion/react';
import { useAetherStore } from '../../../core';
import { stripMarkdownCodeFence } from '../../../shared';
import {
  useWidgetContentInject,
  useWidgetPreviewRequest,
  useWidgetMessageHandler,
  useWidgetDrag,
  useWidgetActions,
} from './hooks';
import {
  WidgetMiniatureCloseButton,
  WidgetWindowChrome,
  WidgetGeneratingContent,
  WidgetMiniatureContent,
  WidgetFocusedContent,
} from './components';
import type { WidgetProps } from './types';

export function Widget({
  data,
  mode,
  mainWidth = 560,
  mainHeight = 420,
  miniatureWidth = 160,
  miniatureHeight = 120,
  onOpen,
}: WidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isFocused = mode === 'focused';
  const isMiniature = mode === 'miniature';

  const generativePreviewEnabled = useAetherStore((s) => s.generativePreviewEnabled);
  const setGenerativePreviewEnabled = useAetherStore((s) => s.setGenerativePreviewEnabled);

  const cleanHtml = data.html ? stripMarkdownCodeFence(data.html) : '';

  useWidgetContentInject(
    data.id,
    cleanHtml,
    isFocused,
    !!data.isGenerating,
    containerRef,
  );
  useWidgetPreviewRequest(
    data.id,
    data.user_prompt,
    cleanHtml,
    !!data.isGenerating,
    !!data.preview_html,
  );
  useWidgetMessageHandler(data.id);

  const {
    dragControls,
    dragX,
    dragY,
    setIsDragging,
    handleDragEnd,
  } = useWidgetDrag(data);

  const { closeWidget, minimizeWindow, handleMiniatureClick } = useWidgetActions(
    data,
    onOpen,
  );

  const blurAmount = data.isGenerating
    ? Math.max(0, 16 - (data.progress || 0) * 16)
    : 0;
  const opacity = data.isGenerating ? (data.progress || 0) : 1;

  const contentBoxClassName = data.isGenerating
    ? 'rounded-2xl bg-white/5 border border-white/10 backdrop-blur-xl'
    : isMiniature
      ? 'rounded-2xl bg-white/10 backdrop-blur-2xl border border-white/25 shadow-[inset_0_1px_1px_rgba(255,255,255,0.4),0_2px_12px_rgba(0,0,0,0.08)]'
      : 'rounded-2xl bg-white/15 backdrop-blur-xl border border-white/10';

  return (
    <motion.div
      key={data.id}
      drag={isFocused && !data.isGenerating}
      dragControls={dragControls}
      dragListener={false}
      dragMomentum={false}
      style={{
        x: isFocused ? dragX : undefined,
        y: isFocused ? dragY : undefined,
        width: isFocused ? '100%' : miniatureWidth,
        height: isFocused ? '100%' : miniatureHeight,
        transformOrigin: 'center center',
      }}
      onDragStart={() => isFocused && setIsDragging(true)}
      onDragEnd={handleDragEnd}
      initial={isMiniature ? false : { scale: 0.9, opacity: 0 }}
      animate={{ scale: 1, opacity, filter: `blur(${blurAmount}px)` }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      className={`relative rounded-2xl overflow-hidden shrink-0 ${isMiniature ? 'cursor-pointer' : ''}`}
      onClick={isMiniature ? handleMiniatureClick : undefined}
    >
      {isFocused && !data.isGenerating && (
        <WidgetWindowChrome
          title={data.user_prompt}
          dragControls={dragControls}
        />
      )}
      <div
        className={`w-full h-full min-w-[160px] min-h-[120px] overflow-hidden relative ${contentBoxClassName} ${isFocused && !data.isGenerating ? 'pt-3' : ''}`}
      >
        {!data.isGenerating && (
          <div className="absolute top-[1px] left-[10px] flex items-center gap-[6px] z-20">
            <button
              type="button"
              onClick={closeWidget}
              className="h-[10px] w-[10px] rounded-full border border-white/40 shadow-sm hover:brightness-110 transition bg-[#ff5f57]/70"
              aria-label="Close widget"
              style={{ cursor: 'pointer', zIndex: 1000 }}
              title="Close widget"
            />

            {!isMiniature && (
              <button
                type="button"
                onClick={minimizeWindow}
                className="h-[10px] w-[10px] rounded-full border border-white/40 shadow-sm hover:brightness-110 transition bg-[#f5c04a]/70"
                aria-label="Minimize widget"
                style={{ cursor: 'pointer', zIndex: 1000 }}
                title="Minimize widget"
              />
            )}
          </div>
        )}
        {data.isGenerating ? (
          <WidgetGeneratingContent
            html={data.html}
            progress={data.progress ?? 0}
            livePreviewEnabled={generativePreviewEnabled}
            onLivePreviewChange={setGenerativePreviewEnabled}
          />
        ) : isMiniature ? (
          <WidgetMiniatureContent
            previewHtml={data.preview_html}
            userPrompt={data.user_prompt}
            width={miniatureWidth}
            height={miniatureHeight}
          />
        ) : (
          <WidgetFocusedContent
            widgetId={data.id}
            userPrompt={data.user_prompt}
            containerRef={containerRef}
          />
        )}
      </div>
    </motion.div>
  );
}

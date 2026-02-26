/** Minimal widget data needed for the crystallization effect (position, size, progress). */
export interface WidgetEffectData {
  position_x: number;
  position_y: number;
  width: number;
  height: number;
  progress?: number;
}

export interface EffectEntry {
  widget: WidgetEffectData;
  fadeOutEndTime?: number;
}

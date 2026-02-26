import type { WidgetData } from '../../../core';

export type WidgetMode = 'focused' | 'miniature';

export type WidgetProps = {
  data: WidgetData;
  mode: WidgetMode;
  mainWidth?: number | string;
  mainHeight?: number | string;
  miniatureSlot?: number;
  miniatureWidth?: number;
  miniatureHeight?: number;
  /** When provided, miniature click calls this instead of opening internally (used when multiple windows allowed). */
  onOpen?: () => void;
};

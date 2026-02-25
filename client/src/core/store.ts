import { create } from 'zustand';

export interface WidgetData {
  id: string;
  user_prompt: string;
  html: string;
  position_x: number;
  position_y: number;
  width: number;
  height: number;
  created_at: number;
  last_accessed: number;
  opacity_decay: number;
  minimized: boolean;
  isGenerating?: boolean;
  progress?: number;
  preview_html: string | null;
}

interface AetherStore {
  widgets: WidgetData[];
  /** IDs of widgets shown as windows (order = z-order, last = on top). */
  openWidgetIds: string[];
  setWidgets: (widgets: WidgetData[]) => void;
  openWidget: (id: string) => void;
  closeAllToMiniatures: () => void;
  closeWindowToMiniature: (id: string) => void;
  addWidget: (widget: WidgetData) => void;
  updateWidget: (id: string, updates: Partial<WidgetData>) => void;
  removeWidget: (id: string) => void;
  activePrompt: string;
  setActivePrompt: (prompt: string) => void;
  /** When true, show live HTML preview (no scripts) during generation; when false, show "Crystallizing..." progress. */
  generativePreviewEnabled: boolean;
  setGenerativePreviewEnabled: (value: boolean) => void;
}

export const useAetherStore = create<AetherStore>((set) => ({
  widgets: [],
  openWidgetIds: [],
  setWidgets: (widgets) => set({
    widgets,
    openWidgetIds: widgets.filter((w) => !w.minimized).map((w) => w.id),
  }),
  openWidget: (id) => set((state) => {
    if (state.openWidgetIds.includes(id)) return state;
    return { openWidgetIds: [...state.openWidgetIds, id] };
  }),
  closeAllToMiniatures: () => set({ openWidgetIds: [] }),
  closeWindowToMiniature: (id) => set((state) => ({
    openWidgetIds: state.openWidgetIds.filter((x) => x !== id),
  })),
  addWidget: (widget) => set((state) => ({
    widgets: [...state.widgets, widget],
    openWidgetIds: [...state.openWidgetIds, widget.id],
  })),
  updateWidget: (id, updates) => set((state) => ({
    widgets: state.widgets.map((w) => (w.id === id ? { ...w, ...updates } : w)),
  })),
  removeWidget: (id) => set((state) => ({
    widgets: state.widgets.filter((w) => w.id !== id),
    openWidgetIds: state.openWidgetIds.filter((x) => x !== id),
  })),
  activePrompt: '',
  setActivePrompt: (prompt) => set({ activePrompt: prompt }),
  generativePreviewEnabled: true,
  setGenerativePreviewEnabled: (value) => set({ generativePreviewEnabled: value }),
}));

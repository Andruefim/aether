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
  progress?: number; // 0.0 to 1.0
}

interface AetherStore {
  widgets: WidgetData[];
  focusedWidgetId: string | null;
  setWidgets: (widgets: WidgetData[]) => void;
  setFocusedWidget: (id: string | null) => void;
  addWidget: (widget: WidgetData) => void;
  updateWidget: (id: string, updates: Partial<WidgetData>) => void;
  removeWidget: (id: string) => void;
  activePrompt: string;
  setActivePrompt: (prompt: string) => void;
}

export const useAetherStore = create<AetherStore>((set) => ({
  widgets: [],
  focusedWidgetId: null,
  setWidgets: (widgets) => set((state) => ({
    widgets,
    focusedWidgetId: state.focusedWidgetId ?? widgets[0]?.id ?? null,
  })),
  setFocusedWidget: (id) => set({ focusedWidgetId: id }),
  addWidget: (widget) => set((state) => ({
    widgets: [...state.widgets, widget],
    focusedWidgetId: widget.id,
  })),
  updateWidget: (id, updates) => set((state) => ({
    widgets: state.widgets.map(w => w.id === id ? { ...w, ...updates } : w)
  })),
  removeWidget: (id) => set((state) => {
    const next = state.widgets.filter(w => w.id !== id);
    const nextFocused = state.focusedWidgetId === id
      ? (next[0]?.id ?? null)
      : state.focusedWidgetId;
    return { widgets: next, focusedWidgetId: nextFocused };
  }),
  activePrompt: '',
  setActivePrompt: (prompt) => set({ activePrompt: prompt }),
}));

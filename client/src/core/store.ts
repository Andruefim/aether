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

export interface AetherMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export type AppMode = 'desktop' | 'aether' | 'nova';

interface AetherStore {
  // ── App mode ──────────────────────────────────────────────────────────────
  appMode: AppMode;
  setAppMode: (mode: AppMode) => void;

  // ── Desktop ───────────────────────────────────────────────────────────────
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
  generativePreviewEnabled: boolean;
  setGenerativePreviewEnabled: (value: boolean) => void;

  // ── Aether / Nova ─────────────────────────────────────────────────────────
  /** Current live HTML displayed in AetherCanvas */
  aetherHtml: string;
  /** Previous stable HTML — fallback if generation breaks */
  aetherPreviousHtml: string;
  /** Conversation history sent to orchestrator */
  aetherHistory: AetherMessage[];
  /** Generation in progress */
  aetherIsGenerating: boolean;
  /** Microphone is actively recording */
  aetherIsListening: boolean;
  /** XTTS is speaking */
  aetherIsSpeaking: boolean;
  /** Status text shown in AetherStatus bar */
  aetherStatus: string | null;
  /** Timestamp for WebGL pulse trigger */
  aetherPulseAt: number | null;
  /** Last route decision from orchestrator */
  aetherLastAction: 'generate_ui' | 'dialogue' | 'tool' | null;

  setAetherHtml: (html: string) => void;
  setAetherPreviousHtml: (html: string) => void;
  pushAetherMessage: (msg: AetherMessage) => void;
  setAetherIsGenerating: (v: boolean) => void;
  setAetherIsListening: (v: boolean) => void;
  setAetherIsSpeaking: (v: boolean) => void;
  setAetherStatus: (status: string | null) => void;
  triggerAetherPulse: () => void;
  setAetherLastAction: (action: 'generate_ui' | 'dialogue' | 'tool' | null) => void;
  revertAetherHtml: () => void;
}

export const useAetherStore = create<AetherStore>((set) => ({
  // ── App mode ──────────────────────────────────────────────────────────────
  appMode: 'desktop',
  setAppMode: (mode) => set({ appMode: mode }),

  // ── Desktop ───────────────────────────────────────────────────────────────
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

  // ── Aether / Nova ─────────────────────────────────────────────────────────
  aetherHtml: '',
  aetherPreviousHtml: '',
  aetherHistory: [],
  aetherIsGenerating: false,
  aetherIsListening: false,
  aetherIsSpeaking: false,
  aetherStatus: null,
  aetherPulseAt: null,
  aetherLastAction: null,

  setAetherHtml: (html) => set({ aetherHtml: html }),
  setAetherPreviousHtml: (html) => set({ aetherPreviousHtml: html }),
  pushAetherMessage: (msg) => set((state) => ({
    aetherHistory: [...state.aetherHistory.slice(-19), msg],
  })),
  setAetherIsGenerating: (v) => set({ aetherIsGenerating: v }),
  setAetherIsListening: (v) => set({ aetherIsListening: v }),
  setAetherIsSpeaking: (v) => set({ aetherIsSpeaking: v }),
  setAetherStatus: (status) => set({ aetherStatus: status }),
  triggerAetherPulse: () => set({ aetherPulseAt: Date.now() }),
  setAetherLastAction: (action) => set({ aetherLastAction: action }),
  revertAetherHtml: () => set((state) => ({
    aetherHtml: state.aetherPreviousHtml,
    aetherStatus: null,
  })),
}));
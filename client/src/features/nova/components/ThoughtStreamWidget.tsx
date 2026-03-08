import { useEffect, useRef, useState, useCallback } from 'react';

export type ThoughtPhase = 'observe' | 'orient' | 'plan' | 'act' | 'store' | 'sleep' | 'wake' | 'question' | 'error';

export interface ThoughtEvent {
  phase: ThoughtPhase;
  text: string;
  tool?: string;
  data?: Record<string, unknown>;
  ts: number;
}

const MAX_EVENTS = 60;

const PHASE_ICON: Record<ThoughtPhase, string> = {
  observe:  '👁',
  orient:   '🧭',
  plan:     '🌿',
  act:      '⚡',
  store:    '💾',
  sleep:    '🌙',
  wake:     '☀️',
  question: '❓',
  error:    '⚠️',
};

const PHASE_COLOR: Record<ThoughtPhase, string> = {
  observe:  '#60a5fa',
  orient:   '#a78bfa',
  plan:     '#34d399',
  act:      '#fbbf24',
  store:    '#c084fc',
  sleep:    '#818cf8',
  wake:     '#fde68a',
  question: '#f472b6',
  error:    '#f87171',
};

function formatTool(event: ThoughtEvent): string {
  if (!event.tool) return '';
  if (event.tool === 'web_search') {
    const q = (event.data as { query?: string } | undefined)?.query ?? '';
    return q ? ` 🔍 "${q}"` : ' 🔍';
  }
  return ` [${event.tool}]`;
}

interface Props {
  /** Called when user answers Nova's question */
  onAnswer: (answer: string) => void;
}

export function ThoughtStreamWidget({ onAnswer }: Props) {
  const [events, setEvents]       = useState<ThoughtEvent[]>([]);
  const [sleeping, setSleeping]   = useState(false);
  const [question, setQuestion]   = useState<string | null>(null);
  const [answer, setAnswer]       = useState('');
  const [collapsed, setCollapsed] = useState(false);
  const [connected, setConnected] = useState(false);
  const bottomRef   = useRef<HTMLDivElement>(null);
  const esRef       = useRef<EventSource | null>(null);

  const push = useCallback((ev: ThoughtEvent) => {
    setEvents((prev) => {
      const next = [...prev, ev];
      return next.length > MAX_EVENTS ? next.slice(next.length - MAX_EVENTS) : next;
    });
    if (ev.phase === 'sleep') setSleeping(true);
    if (ev.phase === 'wake')  setSleeping(false);
    if (ev.phase === 'question') setQuestion(ev.text);
  }, []);

  useEffect(() => {
    const connect = () => {
      const es = new EventSource('/api/nova/thoughts');
      esRef.current = es;

      es.onopen = () => setConnected(true);

      es.onmessage = (e) => {
        try {
          const ev = JSON.parse(e.data as string) as ThoughtEvent;
          push(ev);
        } catch { /* ignore malformed */ }
      };

      es.onerror = () => {
        setConnected(false);
        es.close();
        // Reconnect after 5s
        setTimeout(connect, 5_000);
      };
    };

    connect();
    return () => { esRef.current?.close(); };
  }, [push]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (!collapsed) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events, collapsed]);

  const submitAnswer = () => {
    if (!answer.trim()) return;
    onAnswer(answer.trim());
    setAnswer('');
    setQuestion(null);
  };

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 80,
        right: 20,
        width: collapsed ? 44 : 320,
        maxHeight: collapsed ? 44 : 380,
        background: 'rgba(8,5,20,0.82)',
        border: '1px solid rgba(139,92,246,0.35)',
        borderRadius: 14,
        backdropFilter: 'blur(14px)',
        boxShadow: '0 8px 32px rgba(139,92,246,0.18)',
        zIndex: 500,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        transition: 'width 0.25s ease, max-height 0.25s ease',
        fontFamily: '"Inter", "Segoe UI", sans-serif',
      }}
    >
      {/* Header */}
      <div
        onClick={() => setCollapsed((c) => !c)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          cursor: 'pointer',
          userSelect: 'none',
          borderBottom: collapsed ? 'none' : '1px solid rgba(139,92,246,0.2)',
          flexShrink: 0,
        }}
      >
        {/* Status dot */}
        <span
          style={{
            width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
            background: sleeping ? '#818cf8' : connected ? '#34d399' : '#6b7280',
            boxShadow: sleeping
              ? '0 0 8px #818cf8'
              : connected ? '0 0 8px #34d399' : 'none',
            animation: sleeping ? 'pulse 2s ease-in-out infinite' : 'none',
          }}
        />
        {!collapsed && (
          <>
            <span style={{ color: '#c4b5fd', fontSize: 12, fontWeight: 600, flex: 1 }}>
              {sleeping ? 'Nova · sleeping' : 'Nova · thinking'}
            </span>
            <span style={{ color: '#6b7280', fontSize: 10 }}>
              {collapsed ? '▲' : '▼'}
            </span>
          </>
        )}
      </div>

      {!collapsed && (
        <>
          {/* Events list */}
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '6px 10px',
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            }}
          >
            {events.length === 0 && (
              <span style={{ color: '#4b5563', fontSize: 11, textAlign: 'center', marginTop: 12 }}>
                Waiting for Nova...
              </span>
            )}
            {events.map((ev, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  gap: 6,
                  alignItems: 'flex-start',
                  opacity: i < events.length - 10 ? 0.45 : 1,
                  transition: 'opacity 0.4s',
                }}
              >
                <span style={{ fontSize: 11, flexShrink: 0, lineHeight: '18px' }}>
                  {PHASE_ICON[ev.phase]}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    lineHeight: '18px',
                    color: PHASE_COLOR[ev.phase],
                    wordBreak: 'break-word',
                  }}
                >
                  {ev.text}{formatTool(ev)}
                </span>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {/* Question from Nova */}
          {question && (
            <div
              style={{
                borderTop: '1px solid rgba(244,114,182,0.3)',
                padding: '8px 10px',
                flexShrink: 0,
              }}
            >
              <div style={{ color: '#f9a8d4', fontSize: 11, marginBottom: 6, lineHeight: 1.4 }}>
                Nova: {question}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && submitAnswer()}
                  placeholder="Your answer..."
                  style={{
                    flex: 1,
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(244,114,182,0.35)',
                    borderRadius: 6,
                    padding: '4px 8px',
                    color: '#f3f4f6',
                    fontSize: 11,
                    outline: 'none',
                  }}
                />
                <button
                  onClick={submitAnswer}
                  style={{
                    background: 'rgba(244,114,182,0.2)',
                    border: '1px solid rgba(244,114,182,0.4)',
                    borderRadius: 6,
                    padding: '4px 10px',
                    color: '#f9a8d4',
                    fontSize: 11,
                    cursor: 'pointer',
                  }}
                >
                  ↵
                </button>
              </div>
            </div>
          )}
        </>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.35; }
        }
      `}</style>
    </div>
  );
}

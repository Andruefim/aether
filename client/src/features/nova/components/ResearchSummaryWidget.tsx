import { useState, useEffect, useCallback } from 'react';

interface ResearchSummary {
  title: string;
  bullets: string[];
  insight: string;
  generatedAt: number;
  memoryCount: number;
}

interface Props {
  /** Subscribe to this to auto-refresh on wake events */
  wakeSignal: number;
}

export function ResearchSummaryWidget({ wakeSignal }: Props) {
  const [summary, setSummary]     = useState<ResearchSummary | null>(null);
  const [loading, setLoading]     = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [error, setError]         = useState(false);

  const load = useCallback(async (forceRefresh = false) => {
    setLoading(true);
    setError(false);
    try {
      const url = forceRefresh ? '/api/nova/summary?refresh=1' : '/api/nova/summary';
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json() as ResearchSummary;
      // Only set if there's real content
      if (data.bullets?.length > 0 || data.insight) {
        setSummary(data);
      }
    } catch {
      setError(true);
    }
    setLoading(false);
  }, []);

  // Initial load
  useEffect(() => { load(); }, [load]);

  // Refresh when Nova wakes from sleep
  useEffect(() => {
    if (wakeSignal > 0) load(true);
  }, [wakeSignal, load]);

  const age = summary
    ? Math.floor((Date.now() - summary.generatedAt) / 60_000)
    : 0;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: collapsed ? 80 : 80,
        right: collapsed ? 20 : 350, // sits left of ThoughtStreamWidget
        width: collapsed ? 44 : 310,
        maxHeight: collapsed ? 44 : 380,
        background: 'rgba(8,5,20,0.82)',
        border: '1px solid rgba(251,191,36,0.28)',
        borderRadius: 14,
        backdropFilter: 'blur(14px)',
        boxShadow: '0 8px 32px rgba(251,191,36,0.10)',
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
          borderBottom: collapsed ? 'none' : '1px solid rgba(251,191,36,0.15)',
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 14 }}>🔬</span>
        {!collapsed && (
          <>
            <span style={{ color: '#fde68a', fontSize: 12, fontWeight: 600, flex: 1 }}>
              Research Progress
            </span>
            {!loading && (
              <button
                onClick={(e) => { e.stopPropagation(); load(true); }}
                title="Refresh summary"
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#6b7280',
                  fontSize: 13,
                  padding: '0 2px',
                  lineHeight: 1,
                }}
              >
                ↺
              </button>
            )}
          </>
        )}
      </div>

      {!collapsed && (
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '8px 12px',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          {loading && (
            <span style={{ color: '#6b7280', fontSize: 11, textAlign: 'center', marginTop: 16 }}>
              Generating summary...
            </span>
          )}

          {!loading && error && (
            <span style={{ color: '#f87171', fontSize: 11, textAlign: 'center', marginTop: 16 }}>
              Failed to load summary
            </span>
          )}

          {!loading && !error && !summary && (
            <span style={{ color: '#4b5563', fontSize: 11, textAlign: 'center', marginTop: 16 }}>
              No research data yet. Nova is gathering knowledge...
            </span>
          )}

          {!loading && summary && (
            <>
              {/* Title */}
              <div style={{ color: '#fde68a', fontSize: 12, fontWeight: 600, lineHeight: 1.4 }}>
                {summary.title}
              </div>

              {/* Bullets */}
              <ul style={{ margin: 0, padding: '0 0 0 14px', display: 'flex', flexDirection: 'column', gap: 5 }}>
                {summary.bullets.map((b, i) => (
                  <li key={i} style={{ color: '#e5e7eb', fontSize: 11, lineHeight: 1.5 }}>
                    {b}
                  </li>
                ))}
              </ul>

              {/* Key insight */}
              {summary.insight && (
                <div
                  style={{
                    padding: '7px 9px',
                    background: 'rgba(251,191,36,0.08)',
                    border: '1px solid rgba(251,191,36,0.2)',
                    borderRadius: 7,
                    color: '#fcd34d',
                    fontSize: 11,
                    lineHeight: 1.5,
                    fontStyle: 'italic',
                  }}
                >
                  💡 {summary.insight}
                </div>
              )}

              {/* Footer */}
              <div style={{ color: '#4b5563', fontSize: 10, display: 'flex', justifyContent: 'space-between' }}>
                <span>{summary.memoryCount} memories</span>
                <span>{age === 0 ? 'just now' : `${age}m ago`}</span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

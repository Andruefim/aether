import { useState, useEffect, useCallback, useRef } from 'react';

interface GoalSummary {
  goalId: string;
  goalText: string;
  title: string;
  bullets: string[];
  insight: string;
  progress: number;
  memoryCount: number;
  avgSurprise: number;
  generatedAt: number;
}

interface Props {
  wakeSignal: number;
}

function ProgressBar({ value, color = '#a78bfa' }: { value: number; color?: string }) {
  return (
    <div
      style={{
        height: 4,
        borderRadius: 2,
        background: 'rgba(255,255,255,0.08)',
        overflow: 'hidden',
        flexShrink: 0,
      }}
    >
      <div
        style={{
          width: `${Math.min(100, Math.max(0, value))}%`,
          height: '100%',
          background: color,
          borderRadius: 2,
          transition: 'width 0.6s ease',
        }}
      />
    </div>
  );
}

export function ResearchSummaryWidget({ wakeSignal }: Props) {
  const [summaries, setSummaries]   = useState<GoalSummary[]>([]);
  const [activeTab, setActiveTab]   = useState<string | null>(null);
  const [loading, setLoading]       = useState(false);
  const [collapsed, setCollapsed]   = useState(false);
  const [error, setError]           = useState(false);
  const loadingRef = useRef(false);

  const load = useCallback(async (forceRefresh = false) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setError(false);

    try {
      const url = `/api/nova/summary/goals${forceRefresh ? '?refresh=1' : ''}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json() as GoalSummary[];
      if (Array.isArray(data) && data.length > 0) {
        setSummaries(data);
        setActiveTab((prev) => {
          if (prev && data.some((s) => s.goalId === prev)) return prev;
          return data[0].goalId;
        });
      }
    } catch {
      setError(true);
    }

    setLoading(false);
    loadingRef.current = false;
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (wakeSignal > 0) load(true);
  }, [wakeSignal, load]);

  const current = summaries.find((s) => s.goalId === activeTab) ?? null;
  const age     = current ? Math.floor((Date.now() - current.generatedAt) / 60_000) : 0;

  const progressColor = (p: number) =>
    p < 30 ? '#60a5fa' : p < 70 ? '#a78bfa' : '#34d399';

  return (
    <div
      style={{
        position:     'fixed',
        bottom:       collapsed ? 80 : 80,
        right:        collapsed ? 20 : 350,
        width:        collapsed ? 44 : 340,
        maxHeight:    collapsed ? 44 : 440,
        background:   'rgba(8,5,20,0.84)',
        border:       '1px solid rgba(251,191,36,0.28)',
        borderRadius: 14,
        backdropFilter: 'blur(14px)',
        boxShadow:    '0 8px 32px rgba(251,191,36,0.10)',
        zIndex:       500,
        display:      'flex',
        flexDirection:'column',
        overflow:     'hidden',
        transition:   'width 0.25s ease, max-height 0.25s ease',
        fontFamily:   '"Inter", "Segoe UI", sans-serif',
      }}
    >
      {/* ── Header ── */}
      <div
        onClick={() => setCollapsed((c) => !c)}
        style={{
          display:    'flex',
          alignItems: 'center',
          gap:        8,
          padding:    '8px 12px',
          cursor:     'pointer',
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
                  border:     'none',
                  cursor:     'pointer',
                  color:      '#6b7280',
                  fontSize:   13,
                  padding:    '0 2px',
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
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>

          {/* ── Goal tabs ── */}
          {summaries.length > 1 && (
            <div
              style={{
                display:    'flex',
                overflowX:  'auto',
                borderBottom: '1px solid rgba(255,255,255,0.06)',
                flexShrink: 0,
                scrollbarWidth: 'none',
              }}
            >
              {summaries.map((s) => (
                <button
                  key={s.goalId}
                  onClick={() => setActiveTab(s.goalId)}
                  title={s.goalText}
                  style={{
                    flexShrink:   0,
                    padding:      '5px 10px',
                    fontSize:     10,
                    fontWeight:   activeTab === s.goalId ? 700 : 400,
                    color:        activeTab === s.goalId ? '#fde68a' : '#6b7280',
                    background:   activeTab === s.goalId ? 'rgba(251,191,36,0.10)' : 'none',
                    border:       'none',
                    borderBottom: activeTab === s.goalId ? '2px solid #fde68a' : '2px solid transparent',
                    cursor:       'pointer',
                    whiteSpace:   'nowrap',
                    maxWidth:     100,
                    overflow:     'hidden',
                    textOverflow: 'ellipsis',
                    transition:   'color 0.15s, background 0.15s',
                  }}
                >
                  {s.goalText.slice(0, 18)}{s.goalText.length > 18 ? '…' : ''}
                </button>
              ))}
            </div>
          )}

          {/* ── Content ── */}
          <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>

            {loading && (
              <span style={{ color: '#6b7280', fontSize: 11, textAlign: 'center', marginTop: 16 }}>
                Generating summaries...
              </span>
            )}

            {!loading && error && (
              <span style={{ color: '#f87171', fontSize: 11, textAlign: 'center', marginTop: 16 }}>
                Failed to load summaries
              </span>
            )}

            {!loading && !error && summaries.length === 0 && (
              <span style={{ color: '#4b5563', fontSize: 11, textAlign: 'center', marginTop: 16 }}>
                No active goals. Add goals in the Goals widget.
              </span>
            )}

            {!loading && current && (
              <>
                {/* Title + progress */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ color: '#fde68a', fontSize: 12, fontWeight: 600, lineHeight: 1.4 }}>
                    {current.title}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ flex: 1 }}>
                      <ProgressBar value={current.progress} color={progressColor(current.progress)} />
                    </div>
                    <span style={{ color: progressColor(current.progress), fontSize: 10, fontWeight: 700, minWidth: 28 }}>
                      {current.progress}%
                    </span>
                  </div>
                </div>

                {/* Bullets */}
                {current.bullets.length > 0 && (
                  <ul style={{ margin: 0, padding: '0 0 0 14px', display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {current.bullets.map((b, i) => (
                      <li key={i} style={{ color: '#e5e7eb', fontSize: 11, lineHeight: 1.5 }}>
                        {b}
                      </li>
                    ))}
                  </ul>
                )}

                {/* Key insight */}
                {current.insight && (
                  <div
                    style={{
                      padding:    '7px 9px',
                      background: 'rgba(251,191,36,0.08)',
                      border:     '1px solid rgba(251,191,36,0.2)',
                      borderRadius: 7,
                      color:      '#fcd34d',
                      fontSize:   11,
                      lineHeight: 1.5,
                      fontStyle:  'italic',
                    }}
                  >
                    💡 {current.insight}
                  </div>
                )}

                {/* Stats row */}
                <div style={{ color: '#4b5563', fontSize: 10, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span>{current.memoryCount} memories</span>
                  <span title="Average novelty of recalled facts">novelty {(current.avgSurprise * 100).toFixed(0)}%</span>
                  <span>{age === 0 ? 'just now' : `${age}m ago`}</span>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

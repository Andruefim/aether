import { useState, useEffect, useRef, useCallback } from 'react';

interface NovaGoal {
  id: string;
  text: string;
  priority: number;
  active: boolean;
  createdAt: string;
}

interface GoalSummary {
  goalId: string;
  progress: number;
  memoryCount: number;
}

async function api<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(path, opts);
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json() as Promise<T>;
}

function MiniProgressBar({ value, active }: { value: number; active: boolean }) {
  const color = active
    ? value < 30 ? '#60a5fa' : value < 70 ? '#a78bfa' : '#34d399'
    : '#374151';
  return (
    <div style={{ height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.07)', overflow: 'hidden', marginTop: 3 }}>
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

export function GoalsWidget() {
  const [goals, setGoals]           = useState<NovaGoal[]>([]);
  const [progresses, setProgresses] = useState<Map<string, GoalSummary>>(new Map());
  const [collapsed, setCollapsed]   = useState(false);
  const [inputText, setInputText]   = useState('');
  const [loading, setLoading]       = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<NovaGoal[]>('/api/nova/goals');
      setGoals(data);
    } catch { /* server not ready */ }
  }, []);

  const loadProgresses = useCallback(async () => {
    try {
      const data = await api<GoalSummary[]>('/api/nova/summary/goals');
      const map = new Map<string, GoalSummary>();
      for (const s of data) map.set(s.goalId, s);
      setProgresses(map);
    } catch { /* noop — summary may not be ready */ }
  }, []);

  useEffect(() => {
    load();
    loadProgresses();
    // Refresh progresses periodically
    const interval = setInterval(loadProgresses, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [load, loadProgresses]);

  const add = async () => {
    const text = inputText.trim();
    if (!text || loading) return;
    setLoading(true);
    try {
      await api('/api/nova/goals', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ text }),
      });
      setInputText('');
      await load();
    } catch { /* noop */ }
    setLoading(false);
  };

  const remove = async (id: string) => {
    try {
      await api(`/api/nova/goals/${id}`, { method: 'DELETE' });
      setGoals((g) => g.filter((x) => x.id !== id));
      setProgresses((m) => { const n = new Map(m); n.delete(id); return n; });
    } catch { /* noop */ }
  };

  const toggle = async (goal: NovaGoal) => {
    try {
      const updated = await api<NovaGoal>(`/api/nova/goals/${goal.id}/toggle`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ active: !goal.active }),
      });
      setGoals((gs) => gs.map((g) => g.id === goal.id ? updated : g));
    } catch { /* noop */ }
  };

  const activeCount = goals.filter((g) => g.active).length;

  return (
    <div
      style={{
        position:      'fixed',
        bottom:        collapsed ? 80 : 80,
        left:          20,
        width:         collapsed ? 44 : 300,
        maxHeight:     collapsed ? 44 : 400,
        background:    'rgba(8,5,20,0.82)',
        border:        '1px solid rgba(52,211,153,0.3)',
        borderRadius:  14,
        backdropFilter:'blur(14px)',
        boxShadow:     '0 8px 32px rgba(52,211,153,0.12)',
        zIndex:        500,
        display:       'flex',
        flexDirection: 'column',
        overflow:      'hidden',
        transition:    'width 0.25s ease, max-height 0.25s ease',
        fontFamily:    '"Inter", "Segoe UI", sans-serif',
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
          borderBottom: collapsed ? 'none' : '1px solid rgba(52,211,153,0.15)',
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 14 }}>🎯</span>
        {!collapsed && (
          <>
            <span style={{ color: '#6ee7b7', fontSize: 12, fontWeight: 600, flex: 1 }}>
              Nova Goals
            </span>
            <span style={{ color: '#6b7280', fontSize: 10 }}>
              {activeCount}/{goals.length} active
            </span>
          </>
        )}
      </div>

      {!collapsed && (
        <>
          {/* ── Goal list ── */}
          <div
            style={{
              flex:          1,
              overflowY:     'auto',
              padding:       '6px 10px',
              display:       'flex',
              flexDirection: 'column',
              gap:           6,
            }}
          >
            {goals.length === 0 && (
              <span style={{ color: '#4b5563', fontSize: 11, textAlign: 'center', marginTop: 10 }}>
                No goals yet. Add one below.
              </span>
            )}
            {goals.map((goal) => {
              const summary = progresses.get(goal.id);
              const progress = summary?.progress ?? 0;
              const memCount = summary?.memoryCount ?? 0;

              return (
                <div
                  key={goal.id}
                  style={{
                    display:       'flex',
                    flexDirection: 'column',
                    gap:           4,
                    padding:       '6px 8px',
                    borderRadius:  8,
                    background:    goal.active ? 'rgba(52,211,153,0.07)' : 'rgba(255,255,255,0.03)',
                    border:        `1px solid ${goal.active ? 'rgba(52,211,153,0.2)' : 'rgba(255,255,255,0.06)'}`,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                    {/* Toggle active */}
                    <button
                      onClick={() => toggle(goal)}
                      title={goal.active ? 'Pause goal' : 'Activate goal'}
                      style={{
                        background: 'none',
                        border:     'none',
                        cursor:     'pointer',
                        fontSize:   12,
                        padding:    0,
                        lineHeight: 1,
                        flexShrink: 0,
                        opacity:    goal.active ? 1 : 0.4,
                        marginTop:  2,
                        color:      '#34d399',
                      }}
                    >
                      {goal.active ? '●' : '○'}
                    </button>
                    <span
                      style={{
                        flex:      1,
                        fontSize:  11,
                        lineHeight:1.5,
                        color:     goal.active ? '#d1fae5' : '#6b7280',
                        wordBreak: 'break-word',
                      }}
                    >
                      {goal.text}
                    </span>
                    {/* Delete */}
                    <button
                      onClick={() => remove(goal.id)}
                      title="Remove goal"
                      style={{
                        background: 'none',
                        border:     'none',
                        cursor:     'pointer',
                        color:      '#6b7280',
                        fontSize:   13,
                        padding:    0,
                        lineHeight: 1,
                        flexShrink: 0,
                        marginTop:  1,
                        transition: 'color 0.15s',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = '#f87171')}
                      onMouseLeave={(e) => (e.currentTarget.style.color = '#6b7280')}
                    >
                      ×
                    </button>
                  </div>

                  {/* Progress bar + stats */}
                  <div>
                    <MiniProgressBar value={progress} active={goal.active} />
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3 }}>
                      <span style={{ color: '#4b5563', fontSize: 9 }}>
                        {memCount > 0 ? `${memCount} memories` : 'no data yet'}
                      </span>
                      {progress > 0 && (
                        <span style={{ color: '#6b7280', fontSize: 9, fontWeight: 600 }}>
                          {progress}%
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* ── Add new goal ── */}
          <div
            style={{
              borderTop: '1px solid rgba(52,211,153,0.15)',
              padding:   '8px 10px',
              display:   'flex',
              gap:       6,
              flexShrink:0,
            }}
          >
            <input
              ref={inputRef}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && add()}
              placeholder="Add research goal..."
              style={{
                flex:       1,
                background: 'rgba(255,255,255,0.05)',
                border:     '1px solid rgba(52,211,153,0.25)',
                borderRadius: 6,
                padding:    '4px 8px',
                color:      '#f3f4f6',
                fontSize:   11,
                outline:    'none',
              }}
            />
            <button
              onClick={add}
              disabled={loading || !inputText.trim()}
              style={{
                background:  loading ? 'rgba(52,211,153,0.1)' : 'rgba(52,211,153,0.18)',
                border:      '1px solid rgba(52,211,153,0.35)',
                borderRadius:6,
                padding:     '4px 10px',
                color:       '#6ee7b7',
                fontSize:    12,
                cursor:      loading ? 'default' : 'pointer',
                flexShrink:  0,
              }}
            >
              {loading ? '…' : '+'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

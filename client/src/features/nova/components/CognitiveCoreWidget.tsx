import { useState, useEffect, useCallback, useRef } from 'react';

// ── Types (mirrors server cognitive-core.types.ts) ────────────────────────────

interface CurrentTheory {
  claim: string;
  confidence: number;
  supportingEvidence: string[];
  contradictions: string[];
  nextExperiment: string;
  age: number;
  formedAt: number;
}

interface CognitiveDirective {
  attentionFocus: string;
  suggestedAction?: string;
  urgencyBoost: number;
}

interface NarrativeEntry {
  tick: number;
  action: string;
  query?: string;
  outcome: string;
  memoriesStored: number;
  avgScore: number;
  curiosityDelta: number;
  ts: number;
}

interface CognitiveState {
  theory: CurrentTheory | null;
  directive: CognitiveDirective | null;
  narrativeLog: NarrativeEntry[];
  lastMetaReflectionAt: number;
  metaReflectionCount: number;
  metaInsights: string[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color =
    pct < 35 ? '#f87171'
    : pct < 60 ? '#fbbf24'
    : '#34d399';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, height: 3, background: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden' }}>
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            background: color,
            borderRadius: 2,
            transition: 'width 0.8s ease',
            boxShadow: `0 0 6px ${color}88`,
          }}
        />
      </div>
      <span style={{ fontSize: 10, color, fontWeight: 700, minWidth: 28, textAlign: 'right' }}>{pct}%</span>
    </div>
  );
}

function ActionIcon({ action }: { action: string }) {
  const icons: Record<string, string> = {
    web_search: '🔍',
    reflect: '🪞',
    hypothesize: '💡',
    conduct_experiment: '🧪',
    sleep: '🌙',
    rest: '💤',
    ask_user: '❓',
    propose_goal: '🎯',
  };
  return <span>{icons[action] ?? '·'}</span>;
}

function MiniLog({ entries }: { entries: NarrativeEntry[] }) {
  return (
    <div
      style={{
        maxHeight: 120,
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
        scrollbarWidth: 'none',
      }}
    >
      {[...entries].reverse().slice(0, 12).map((e, i) => {
        const quality = e.avgScore >= 7 ? '#34d399' : e.avgScore >= 4 ? '#a78bfa' : '#6b7280';
        return (
          <div
            key={i}
            style={{
              display: 'flex',
              gap: 5,
              alignItems: 'flex-start',
              opacity: i > 6 ? 0.4 + (6 - i) * 0.06 : 1,
            }}
          >
            <span style={{ fontSize: 10, flexShrink: 0, lineHeight: '16px' }}>
              <ActionIcon action={e.action} />
            </span>
            <span style={{ flex: 1, fontSize: 9, color: '#6b7280', lineHeight: '16px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {e.query ? `"${e.query.slice(0, 28)}"` : e.action}
            </span>
            <span style={{ fontSize: 9, color: quality, flexShrink: 0, lineHeight: '16px' }}>
              {e.memoriesStored > 0 ? `+${e.memoriesStored}` : e.avgScore.toFixed(1)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

const POLL_INTERVAL_MS = 8_000;

// ── Main widget ───────────────────────────────────────────────────────────────

export function CognitiveCoreWidget() {
  const [state, setState]           = useState<CognitiveState | null>(null);
  const [collapsed, setCollapsed]   = useState(false);
  const [tab, setTab]               = useState<'theory' | 'log' | 'insights'>('theory');
  const [reflecting, setReflecting] = useState(false);
  const [flashDirective, setFlashDirective] = useState(false);
  const prevDirectiveRef = useRef<string>('');
  const timerRef         = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/nova/cognitive');
      if (!res.ok) return;
      const data = await res.json() as CognitiveState;
      setState(data);
      // Flash if directive changed
      const newFocus = data.directive?.attentionFocus ?? '';
      if (newFocus && newFocus !== prevDirectiveRef.current) {
        prevDirectiveRef.current = newFocus;
        setFlashDirective(true);
        setTimeout(() => setFlashDirective(false), 1200);
      }
    } catch { /* server not ready */ }
  }, []);

  useEffect(() => {
    void load();
    timerRef.current = setInterval(load, POLL_INTERVAL_MS);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [load]);

  const triggerReflect = async () => {
    if (reflecting) return;
    setReflecting(true);
    try {
      await fetch('/api/nova/cognitive/reflect', { method: 'POST' });
      // Poll more aggressively for a few seconds after triggering
      setTimeout(load, 3_000);
      setTimeout(load, 6_000);
    } catch { /* noop */ } finally {
      setTimeout(() => setReflecting(false), 8_000);
    }
  };

  const theory   = state?.theory ?? null;
  const directive = state?.directive ?? null;
  const insights = state?.metaInsights ?? [];
  const log      = state?.narrativeLog ?? [];
  const lastMeta = state?.lastMetaReflectionAt ?? 0;
  const metaCount = state?.metaReflectionCount ?? 0;

  const minAgo = lastMeta ? Math.floor((Date.now() - lastMeta) / 60_000) : null;

  return (
    <div
      style={{
        position:       'fixed',
        top:            80,
        left:           20,
        width:          collapsed ? 44 : 310,
        maxHeight:      collapsed ? 44 : 520,
        background:     'rgba(5,4,20,0.88)',
        border:         `1px solid ${flashDirective ? 'rgba(251,191,36,0.6)' : 'rgba(99,102,241,0.35)'}`,
        borderRadius:   14,
        backdropFilter: 'blur(16px)',
        boxShadow:      flashDirective
          ? '0 0 24px rgba(251,191,36,0.25), 0 8px 32px rgba(99,102,241,0.18)'
          : '0 8px 32px rgba(99,102,241,0.18)',
        zIndex:         500,
        display:        'flex',
        flexDirection:  'column',
        overflow:       'hidden',
        transition:     'width 0.25s ease, max-height 0.25s ease, border-color 0.4s ease, box-shadow 0.4s ease',
        fontFamily:     '"JetBrains Mono", "Fira Code", "Consolas", monospace',
      }}
    >
      {/* ── Header ── */}
      <div
        onClick={() => setCollapsed((c) => !c)}
        style={{
          display:      'flex',
          alignItems:   'center',
          gap:           8,
          padding:      '8px 12px',
          cursor:       'pointer',
          userSelect:   'none',
          borderBottom: collapsed ? 'none' : '1px solid rgba(99,102,241,0.18)',
          flexShrink:   0,
        }}
      >
        {/* Animated core indicator */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <div
            style={{
              width: 10, height: 10, borderRadius: '50%',
              background: reflecting ? '#fbbf24' : theory ? '#6366f1' : '#374151',
              boxShadow: reflecting ? '0 0 10px #fbbf24' : theory ? '0 0 8px #6366f1' : 'none',
              animation: reflecting ? 'cogPulse 0.8s ease-in-out infinite' : 'none',
            }}
          />
          <style>{`
            @keyframes cogPulse {
              0%,100% { transform: scale(1); opacity: 1; }
              50% { transform: scale(1.4); opacity: 0.6; }
            }
            @keyframes cogFlash {
              0% { opacity: 1; } 50% { opacity: 0.3; } 100% { opacity: 1; }
            }
          `}</style>
        </div>

        {!collapsed && (
          <>
            <span style={{ color: '#818cf8', fontSize: 11, fontWeight: 700, flex: 1, letterSpacing: '0.06em' }}>
              COGNITIVE CORE
            </span>
            {metaCount > 0 && (
              <span style={{ color: '#4b5563', fontSize: 9 }}>
                {metaCount} reflections
              </span>
            )}
            <span style={{ color: '#4b5563', fontSize: 10 }}>{collapsed ? '▼' : '▲'}</span>
          </>
        )}
      </div>

      {!collapsed && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>

          {/* ── Directive banner ── */}
          {directive && (
            <div
              style={{
                padding:    '7px 12px',
                background: flashDirective
                  ? 'rgba(251,191,36,0.12)'
                  : 'rgba(99,102,241,0.08)',
                borderBottom: '1px solid rgba(99,102,241,0.15)',
                transition: 'background 0.4s ease',
                flexShrink: 0,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                <span style={{ fontSize: 9, color: flashDirective ? '#fbbf24' : '#6366f1', fontWeight: 700, letterSpacing: '0.08em' }}>
                  ⚡ DIRECTIVE
                </span>
                {directive.suggestedAction && (
                  <span
                    style={{
                      fontSize: 9,
                      color: '#4b5563',
                      background: 'rgba(255,255,255,0.05)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: 4,
                      padding: '0 5px',
                    }}
                  >
                    {directive.suggestedAction}
                  </span>
                )}
              </div>
              <p style={{ fontSize: 10, color: '#c7d2fe', lineHeight: 1.5, margin: 0 }}>
                {directive.attentionFocus}
              </p>
            </div>
          )}

          {/* ── Tab bar ── */}
          <div
            style={{
              display:      'flex',
              borderBottom: '1px solid rgba(99,102,241,0.15)',
              flexShrink:   0,
            }}
          >
            {(['theory', 'log', 'insights'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{
                  flex:         1,
                  padding:      '5px 0',
                  fontSize:     10,
                  fontWeight:   tab === t ? 700 : 400,
                  color:        tab === t ? '#818cf8' : '#4b5563',
                  background:   tab === t ? 'rgba(99,102,241,0.10)' : 'none',
                  border:       'none',
                  borderBottom: tab === t ? '2px solid #6366f1' : '2px solid transparent',
                  cursor:       'pointer',
                  letterSpacing:'0.05em',
                  transition:   'color 0.15s, background 0.15s',
                  fontFamily:   'inherit',
                }}
              >
                {t === 'theory' ? 'THEORY' : t === 'log' ? 'LOG' : 'INSIGHTS'}
              </button>
            ))}
          </div>

          {/* ── Tab content ── */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px', scrollbarWidth: 'none' }}>

            {/* THEORY tab */}
            {tab === 'theory' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {!theory ? (
                  <span style={{ color: '#4b5563', fontSize: 11, textAlign: 'center', marginTop: 12 }}>
                    No theory formed yet.
                  </span>
                ) : (
                  <>
                    {/* Claim */}
                    <div
                      style={{
                        padding:    '8px 10px',
                        background: 'rgba(99,102,241,0.08)',
                        border:     '1px solid rgba(99,102,241,0.2)',
                        borderRadius: 8,
                      }}
                    >
                      <div style={{ fontSize: 9, color: '#6366f1', fontWeight: 700, marginBottom: 5, letterSpacing: '0.07em' }}>
                        CLAIM  ·  age {theory.age} ticks
                      </div>
                      <p style={{ fontSize: 11, color: '#e0e7ff', lineHeight: 1.55, margin: 0 }}>
                        {theory.claim}
                      </p>
                    </div>

                    {/* Confidence */}
                    <div>
                      <div style={{ fontSize: 9, color: '#4b5563', marginBottom: 4, letterSpacing: '0.06em' }}>CONFIDENCE</div>
                      <ConfidenceBar value={theory.confidence} />
                    </div>

                    {/* Evidence */}
                    {theory.supportingEvidence.length > 0 && (
                      <div>
                        <div style={{ fontSize: 9, color: '#34d399', marginBottom: 5, letterSpacing: '0.06em' }}>
                          ✓ SUPPORTING ({theory.supportingEvidence.length})
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {theory.supportingEvidence.map((e, i) => (
                            <div
                              key={i}
                              style={{
                                fontSize:   10,
                                color:      '#a7f3d0',
                                lineHeight: 1.4,
                                paddingLeft: 10,
                                borderLeft: '2px solid rgba(52,211,153,0.35)',
                              }}
                            >
                              {e}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Contradictions */}
                    {theory.contradictions.length > 0 && (
                      <div>
                        <div style={{ fontSize: 9, color: '#f87171', marginBottom: 5, letterSpacing: '0.06em' }}>
                          ✗ CONTRADICTIONS ({theory.contradictions.length})
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {theory.contradictions.map((c, i) => (
                            <div
                              key={i}
                              style={{
                                fontSize:   10,
                                color:      '#fca5a5',
                                lineHeight: 1.4,
                                paddingLeft: 10,
                                borderLeft: '2px solid rgba(248,113,113,0.35)',
                              }}
                            >
                              {c}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Next experiment */}
                    {theory.nextExperiment && (
                      <div
                        style={{
                          padding:    '6px 9px',
                          background: 'rgba(251,191,36,0.07)',
                          border:     '1px solid rgba(251,191,36,0.18)',
                          borderRadius: 7,
                        }}
                      >
                        <div style={{ fontSize: 9, color: '#fbbf24', marginBottom: 3, letterSpacing: '0.06em' }}>
                          🧪 NEXT EXPERIMENT
                        </div>
                        <p style={{ fontSize: 10, color: '#fde68a', lineHeight: 1.5, margin: 0 }}>
                          {theory.nextExperiment}
                        </p>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* LOG tab */}
            {tab === 'log' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {log.length === 0 ? (
                  <span style={{ color: '#4b5563', fontSize: 11, textAlign: 'center', marginTop: 12 }}>
                    No ticks logged yet.
                  </span>
                ) : (
                  <MiniLog entries={log} />
                )}
              </div>
            )}

            {/* INSIGHTS tab */}
            {tab === 'insights' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {insights.length === 0 ? (
                  <span style={{ color: '#4b5563', fontSize: 11, textAlign: 'center', marginTop: 12 }}>
                    No meta-insights yet.
                  </span>
                ) : (
                  insights.map((ins, i) => (
                    <div
                      key={i}
                      style={{
                        padding:    '7px 9px',
                        background: i === 0
                          ? 'rgba(99,102,241,0.10)'
                          : 'rgba(255,255,255,0.03)',
                        border:     `1px solid ${i === 0 ? 'rgba(99,102,241,0.25)' : 'rgba(255,255,255,0.06)'}`,
                        borderRadius: 8,
                        opacity:    1 - i * 0.12,
                      }}
                    >
                      <div style={{ fontSize: 9, color: '#6366f1', marginBottom: 3, letterSpacing: '0.05em' }}>
                        #{metaCount - i} {i === 0 ? '← latest' : ''}
                      </div>
                      <p style={{ fontSize: 10, color: '#c7d2fe', lineHeight: 1.5, margin: 0, fontStyle: 'italic' }}>
                        {ins}
                      </p>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          {/* ── Footer ── */}
          <div
            style={{
              borderTop:  '1px solid rgba(99,102,241,0.15)',
              padding:    '7px 12px',
              display:    'flex',
              alignItems: 'center',
              gap:         8,
              flexShrink: 0,
            }}
          >
            <span style={{ fontSize: 9, color: '#4b5563', flex: 1 }}>
              {minAgo !== null
                ? minAgo === 0 ? 'reflected just now' : `reflected ${minAgo}m ago`
                : 'no reflections yet'}
            </span>
            <button
              onClick={triggerReflect}
              disabled={reflecting}
              title="Trigger a manual meta-reflection cycle"
              style={{
                background:   reflecting
                  ? 'rgba(251,191,36,0.10)'
                  : 'rgba(99,102,241,0.15)',
                border:       `1px solid ${reflecting ? 'rgba(251,191,36,0.35)' : 'rgba(99,102,241,0.3)'}`,
                borderRadius: 7,
                padding:      '4px 10px',
                color:        reflecting ? '#fbbf24' : '#818cf8',
                fontSize:     10,
                cursor:       reflecting ? 'default' : 'pointer',
                fontFamily:   'inherit',
                letterSpacing: '0.04em',
                transition:   'all 0.2s ease',
              }}
            >
              {reflecting ? '◌ reflecting…' : '↺ reflect'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
import { useState, useEffect, useRef, useCallback } from 'react';
import { Canvas } from '@react-three/fiber';
import { LabScene } from './LabScene';
import { ExperimentLog } from './ExperimentLog';
import { ExperimentEvent, ExperimentResult } from './types';

// ─── Inline ThoughtStream (panel version — no fixed positioning) ──────────────

type ThoughtPhase = 'observe' | 'orient' | 'plan' | 'act' | 'store' | 'sleep' | 'wake' | 'question' | 'error';
interface ThoughtEvent { phase: ThoughtPhase; text: string; tool?: string; data?: Record<string, unknown>; ts: number; }

const THOUGHT_ICON: Record<string, string> = {
  observe: '👁', orient: '🧭', plan: '🧠', act: '⚡',
  store: '💾', sleep: '💤', wake: '🌅', question: '❓', error: '✗',
};
const THOUGHT_COLOR: Record<string, string> = {
  observe: '#60a5fa', orient: '#a78bfa', plan: '#c084fc', act: '#34d399',
  store: '#fbbf24', sleep: '#6b7280', wake: '#86efac', question: '#f59e0b', error: '#f87171',
};

function ThoughtStreamPanel({ onWake }: { onWake?: () => void }) {
  const [evts, setEvts] = useState<ThoughtEvent[]>([]);
  const [question, setQ] = useState<string | null>(null);
  const [answer, setA]  = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const push = useCallback((e: ThoughtEvent) => {
    setEvts((prev) => [...prev.slice(-199), e]);
    if (e.phase === 'wake') onWake?.();
    if (e.phase === 'question' && typeof e.text === 'string' && !e.data?.['type']) setQ(e.text);
  }, [onWake]);

  useEffect(() => {
    const es = new EventSource('/api/nova/thoughts');
    es.onmessage = (e) => {
      try { push(JSON.parse(e.data as string) as ThoughtEvent); } catch { /**/ }
    };
    return () => es.close();
  }, [push]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [evts.length]);

  const submitAnswer = useCallback(() => {
    if (!answer.trim()) return;
    fetch('/api/nova/answer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answer }) }).catch(() => {});
    setQ(null); setA('');
  }, [answer]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid rgba(167,139,250,0.2)', flexShrink: 0 }}>
        <span style={{ color: '#c084fc', fontSize: 12, fontWeight: 700, letterSpacing: '0.05em' }}>NOVA THINKING</span>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}>
        {evts.map((e, i) => (
          <div key={i} style={{ display: 'flex', gap: 7, padding: '3px 14px', alignItems: 'flex-start' }}>
            <span style={{ fontSize: 11, flexShrink: 0, marginTop: 1 }}>{THOUGHT_ICON[e.phase] ?? '·'}</span>
            <span style={{ fontSize: 10, color: THOUGHT_COLOR[e.phase] ?? '#9ca3af', lineHeight: 1.5 }}>
              {e.text}
              {e.tool && <span style={{ color: '#4b5563', marginLeft: 5 }}>[{e.tool}]</span>}
            </span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      {question && (
        <div style={{ borderTop: '1px solid rgba(167,139,250,0.2)', padding: '8px 10px', flexShrink: 0 }}>
          <div style={{ fontSize: 10, color: '#f59e0b', marginBottom: 5 }}>❓ {question}</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              value={answer}
              onChange={(e) => setA(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submitAnswer()}
              placeholder="Your answer…"
              style={{ flex: 1, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(167,139,250,0.25)', borderRadius: 6, padding: '4px 8px', color: '#f3f4f6', fontSize: 11, outline: 'none' }}
            />
            <button onClick={submitAnswer} style={{ background: 'rgba(167,139,250,0.2)', border: '1px solid rgba(167,139,250,0.35)', borderRadius: 6, padding: '4px 10px', color: '#c084fc', fontSize: 11, cursor: 'pointer' }}>
              Send
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

const MAX_EVENTS = 120;

export function NovaSpacePage() {
  const [events, setEvents]     = useState<ExperimentEvent[]>([]);
  const [results, setResults]   = useState<ExperimentResult[]>([]);
  const [selected, setSelected] = useState<ExperimentResult | null>(null);
  const [running, setRunning]   = useState(false);
  const [wakeSignal, setWakeSignal] = useState(0);

  // Subscribe to experiment SSE
  useEffect(() => {
    const es = new EventSource('/api/experiment/events');

    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data as string) as ExperimentEvent;
        setEvents((prev) => [...prev.slice(-(MAX_EVENTS - 1)), event]);
        if (event.phase === 'done' && event.result) {
          setResults((prev) => [...prev.slice(-49), event.result!]);
          setSelected(event.result!);
          setRunning(false);
        }
        if (event.phase === 'error') setRunning(false);
      } catch { /* skip */ }
    };

    // Load past results
    fetch('/api/experiment/results?limit=20')
      .then((r) => r.json())
      .then((data: unknown) => {
        if (Array.isArray(data) && data.length > 0) {
          setResults(data as ExperimentResult[]);
          setSelected((data as ExperimentResult[]).at(-1) ?? null);
        }
      })
      .catch(() => {});

    return () => es.close();
  }, []);

  const runExperiment = useCallback(async (hypothesis: string) => {
    if (running) return;
    setRunning(true);
    setSelected(null);
    try {
      await fetch('/api/experiment/run', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ hypothesis }),
      });
    } catch {
      setRunning(false);
    }
  }, [running]);

  void wakeSignal; // consumed by ThoughtStreamPanel via onWake

  return (
    <div
      style={{
        display:             'grid',
        gridTemplateColumns: '1fr 300px 300px',
        height:              '100vh',
        width:               '100vw',
        background:          '#05040f',
        color:               '#e5e7eb',
        overflow:            'hidden',
        fontFamily:          '"Inter", "Segoe UI", sans-serif',
      }}
    >
      {/* ── Col 1: 3D Lab View ── */}
      <div style={{ position: 'relative', borderRight: '1px solid rgba(167,139,250,0.12)' }}>
        <Canvas
          camera={{ position: [0, 0, 7], fov: 50 }}
          gl={{ antialias: true, alpha: false }}
          onCreated={({ gl }) => gl.setClearColor('#05040f', 1)}
          style={{ width: '100%', height: '100%' }}
        >
          <LabScene result={selected} />
        </Canvas>

        {/* Header label */}
        <div style={{ position: 'absolute', top: 14, left: 14, pointerEvents: 'none' }}>
          <div style={{ fontSize: 11, color: '#6b7280', letterSpacing: '0.1em' }}>NOVA SPACE · LAB</div>
          {selected && (
            <div style={{ marginTop: 4, fontSize: 10, color: '#4b5563', maxWidth: 300, lineHeight: 1.5 }}>
              {selected.hypothesis.slice(0, 80)}{selected.hypothesis.length > 80 ? '…' : ''}
            </div>
          )}
        </div>

        {/* Vis type badge */}
        {selected?.visualization && selected.visualization !== 'none' && (
          <div style={{
            position: 'absolute', top: 14, right: 14,
            fontSize: 9, color: '#7c3aed',
            background: 'rgba(124,58,237,0.12)',
            border: '1px solid rgba(124,58,237,0.25)',
            borderRadius: 6, padding: '3px 8px',
            pointerEvents: 'none', letterSpacing: '0.06em',
          }}>
            {selected.visualization.toUpperCase()}
          </div>
        )}

        {/* Interpretation overlay */}
        {selected?.interpretation && (
          <div style={{
            position: 'absolute', bottom: 14, left: 14, right: 14,
            background: 'rgba(5,4,15,0.88)',
            border: '1px solid rgba(167,139,250,0.15)',
            borderRadius: 10, padding: '10px 14px',
            backdropFilter: 'blur(12px)',
            pointerEvents: 'none',
          }}>
            <div style={{ fontSize: 9, color: '#7c3aed', fontWeight: 700, marginBottom: 4, letterSpacing: '0.08em' }}>
              FINDING
            </div>
            <div style={{ fontSize: 11, color: '#d1d5db', lineHeight: 1.6 }}>
              {selected.interpretation.slice(0, 300)}{selected.interpretation.length > 300 ? '…' : ''}
            </div>
            <div style={{ fontSize: 9, color: '#4b5563', marginTop: 5 }}>
              {(selected.durationMs / 1000).toFixed(1)}s · {selected.visualization} · {selected.success ? '✓ success' : '✗ failed'}
            </div>
          </div>
        )}

        {/* Running spinner */}
        {running && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            background: 'rgba(5,4,15,0.5)', pointerEvents: 'none',
          }}>
            <div style={{ fontSize: 12, color: '#a78bfa', letterSpacing: '0.15em' }}>
              ◌ RUNNING EXPERIMENT…
            </div>
          </div>
        )}
      </div>

      {/* ── Col 2: Nova Thinking ── */}
      <div style={{ borderRight: '1px solid rgba(167,139,250,0.12)', overflow: 'hidden' }}>
        <ThoughtStreamPanel onWake={() => setWakeSignal((n) => n + 1)} />
      </div>

      {/* ── Col 3: Experiment Log ── */}
      <div style={{ overflow: 'hidden' }}>
        <ExperimentLog
          events={events}
          results={results}
          onSelectResult={setSelected}
          selectedId={selected?.id ?? null}
          onRunExperiment={runExperiment}
          running={running}
        />
      </div>
    </div>
  );
}

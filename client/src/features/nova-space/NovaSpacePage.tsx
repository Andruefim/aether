import { useState, useEffect, useCallback } from 'react';
import { Canvas } from '@react-three/fiber';
import { LabScene } from './LabScene';
import { ExperimentLog } from './ExperimentLog';
import { ExperimentEvent, ExperimentResult } from './types';
import { ThoughtStreamWidget } from '../nova/components/ThoughtStreamWidget';
import { useAetherStore } from '../../core';

// ─── Main page ────────────────────────────────────────────────────────────────

const MAX_EVENTS = 120;

export function NovaSpacePage() {
  const triggerWake = useAetherStore((s) => s.triggerWake);

  const [events,   setEvents]   = useState<ExperimentEvent[]>([]);
  const [results,  setResults]  = useState<ExperimentResult[]>([]);
  const [selected, setSelected] = useState<ExperimentResult | null>(null);
  const [running,  setRunning]  = useState(false);

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
        <ThoughtStreamWidget
          embedded
          onAnswer={(ans) => {
            fetch('/api/nova/answer', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ answer: ans }),
            }).catch(() => {});
          }}
          onWake={triggerWake}
        />
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

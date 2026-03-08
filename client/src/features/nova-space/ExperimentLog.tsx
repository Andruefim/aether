import { useRef, useEffect } from 'react';
import { ExperimentEvent, ExperimentResult } from './types';

const PHASE_ICON: Record<string, string> = {
  plan:      '🗺',
  execute:   '⚙',
  interpret: '🔬',
  store:     '💾',
  error:     '✗',
  done:      '✓',
};

const PHASE_COLOR: Record<string, string> = {
  plan:      '#60a5fa',
  execute:   '#a78bfa',
  interpret: '#34d399',
  store:     '#fbbf24',
  error:     '#f87171',
  done:      '#34d399',
};

interface ExperimentLogProps {
  events:  ExperimentEvent[];
  results: ExperimentResult[];
  onSelectResult: (r: ExperimentResult) => void;
  selectedId: string | null;
  onRunExperiment: (hypothesis: string) => void;
  running: boolean;
}

export function ExperimentLog({
  events,
  results,
  onSelectResult,
  selectedId,
  onRunExperiment,
  running,
}: ExperimentLogProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events.length]);

  return (
    <div
      style={{
        display:       'flex',
        flexDirection: 'column',
        height:        '100%',
        fontFamily:    '"Inter", "Segoe UI", sans-serif',
        color:         '#e5e7eb',
        gap:           0,
      }}
    >
      {/* ── Header ── */}
      <div style={{ padding: '10px 14px', borderBottom: '1px solid rgba(167,139,250,0.2)', flexShrink: 0 }}>
        <span style={{ color: '#c084fc', fontSize: 12, fontWeight: 700, letterSpacing: '0.05em' }}>
          NOVA LAB
        </span>
        <span style={{ color: '#6b7280', fontSize: 10, marginLeft: 8 }}>
          {results.length} experiments
        </span>
      </div>

      {/* ── Past results ── */}
      <div style={{ flex: '0 0 auto', maxHeight: '35%', overflowY: 'auto', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        {results.length === 0 && (
          <div style={{ padding: '12px 14px', color: '#4b5563', fontSize: 11 }}>
            No experiments yet. Nova will conduct them autonomously, or you can trigger one below.
          </div>
        )}
        {[...results].reverse().map((r) => (
          <div
            key={r.id}
            onClick={() => onSelectResult(r)}
            style={{
              padding:      '8px 14px',
              cursor:       'pointer',
              borderBottom: '1px solid rgba(255,255,255,0.04)',
              background:   selectedId === r.id ? 'rgba(167,139,250,0.1)' : 'transparent',
              transition:   'background 0.15s',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 11 }}>{r.success ? '✓' : '✗'}</span>
              <span style={{ fontSize: 10, color: r.success ? '#34d399' : '#f87171', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {r.hypothesis.slice(0, 55)}{r.hypothesis.length > 55 ? '…' : ''}
              </span>
              <span style={{ fontSize: 9, color: '#6b7280', flexShrink: 0 }}>
                {r.visualization}
              </span>
            </div>
            {selectedId === r.id && (
              <div style={{ marginTop: 5, fontSize: 10, color: '#9ca3af', lineHeight: 1.5 }}>
                {r.interpretation.slice(0, 200)}{r.interpretation.length > 200 ? '…' : ''}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* ── Live event stream ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}>
        {events.map((e, i) => (
          <div key={i} style={{ display: 'flex', gap: 7, padding: '3px 14px', alignItems: 'flex-start' }}>
            <span style={{ fontSize: 11, flexShrink: 0, marginTop: 1 }}>{PHASE_ICON[e.phase] ?? '·'}</span>
            <span style={{ fontSize: 10, color: PHASE_COLOR[e.phase] ?? '#9ca3af', lineHeight: 1.5 }}>
              {e.text}
            </span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* ── Manual trigger ── */}
      <ManualTrigger onRun={onRunExperiment} running={running} />
    </div>
  );
}

function ManualTrigger({ onRun, running }: { onRun: (h: string) => void; running: boolean }) {
  const ref = useRef<HTMLInputElement>(null);

  const submit = () => {
    const val = ref.current?.value.trim();
    if (!val || running) return;
    onRun(val);
    if (ref.current) ref.current.value = '';
  };

  return (
    <div style={{ borderTop: '1px solid rgba(167,139,250,0.2)', padding: '8px 10px', flexShrink: 0 }}>
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          ref={ref}
          placeholder="Enter hypothesis to test…"
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          style={{
            flex:       1,
            background: 'rgba(255,255,255,0.05)',
            border:     '1px solid rgba(167,139,250,0.25)',
            borderRadius: 6,
            padding:    '5px 8px',
            color:      '#f3f4f6',
            fontSize:   11,
            outline:    'none',
          }}
        />
        <button
          onClick={submit}
          disabled={running}
          style={{
            background:   running ? 'rgba(167,139,250,0.1)' : 'rgba(167,139,250,0.2)',
            border:       '1px solid rgba(167,139,250,0.35)',
            borderRadius: 6,
            padding:      '5px 12px',
            color:        '#c084fc',
            fontSize:     11,
            cursor:       running ? 'default' : 'pointer',
            flexShrink:   0,
          }}
        >
          {running ? '…' : 'Run'}
        </button>
      </div>
    </div>
  );
}

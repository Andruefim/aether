import { useEffect, useRef } from 'react';
import { useAetherStore, type GoalSummary } from '../../../core';

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min — matches server cache

/**
 * Fetches goal summaries into the global store.
 * Multiple components can call this hook safely — only one fetch runs at a time.
 * State survives tab switches because it lives in Zustand.
 */
export function useGoalSummaries(opts: { autoRefreshOnWake?: boolean } = {}) {
  const summaries        = useAetherStore((s) => s.goalSummaries);
  const summariesTs      = useAetherStore((s) => s.goalSummariesTs);
  const loading          = useAetherStore((s) => s.goalSummariesLoading);
  const wakeSignal       = useAetherStore((s) => s.wakeSignal);
  const setGoalSummaries = useAetherStore((s) => s.setGoalSummaries);
  const setLoading       = useAetherStore((s) => s.setGoalSummariesLoading);

  const fetchingRef = useRef(false);

  const load = async (forceRefresh = false) => {
    if (fetchingRef.current) return;
    const stale = Date.now() - summariesTs > CACHE_TTL_MS;
    if (!forceRefresh && !stale && summaries.length > 0) return;

    fetchingRef.current = true;
    setLoading(true);
    try {
      const url = `/api/nova/summary/goals${forceRefresh ? '?refresh=1' : ''}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json() as GoalSummary[];
      if (Array.isArray(data)) setGoalSummaries(data);
    } catch {
      setLoading(false);
    } finally {
      fetchingRef.current = false;
    }
  };

  // Initial load
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Refresh on wake signal
  useEffect(() => {
    if (opts.autoRefreshOnWake && wakeSignal > 0) void load(true);
  }, [wakeSignal]); // eslint-disable-line react-hooks/exhaustive-deps

  return { summaries, loading, refresh: () => load(true) };
}

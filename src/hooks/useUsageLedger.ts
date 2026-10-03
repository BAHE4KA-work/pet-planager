import { useCallback, useEffect, useRef, useState } from 'react';
import { loadUsageEvents, resetUsageTotal, simulateUsage, type UsageEvent } from '../services/settings';
import { calculateUsageCounts, type UsageCounts } from '../utils/usage';

const REFRESH_INTERVAL_MS = 30_000;

export function useUsageLedger(onError: (error: unknown) => void) {
  const [events, setEvents] = useState<UsageEvent[]>([]);
  const [counts, setCounts] = useState<UsageCounts>({ rpm: 0, rpd: 0, tpm: 0, tt: 0 });
  const onErrorRef = useRef(onError);
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  onErrorRef.current = onError;

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const nextEvents = await loadUsageEvents();
        if (!active) return;
        setEvents(nextEvents);
        setCounts(calculateUsageCounts(nextEvents));
      } catch (error) {
        if (active) onErrorRef.current(error);
      }
    };
    refreshRef.current = load;
    void load();
    const timer = window.setInterval(() => void load(), REFRESH_INTERVAL_MS);
    window.addEventListener('focus', load);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', load);
    };
  }, []);

  const refresh = useCallback(() => refreshRef.current(), []);
  const resetTotal = useCallback(async () => {
    await resetUsageTotal();
    await refresh();
  }, [refresh]);
  const simulate = useCallback(async () => {
    await simulateUsage(1);
    await refresh();
  }, [refresh]);

  return { events, counts, refresh, resetTotal, simulate };
}

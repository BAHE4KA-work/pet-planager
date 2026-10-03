export interface TokenUsageBudget {
  promptTokens: number;
  completionTokens: number;
  reservedPromptTokens?: number;
  reservedCompletionTokens?: number;
  usageKnown: boolean;
}

export interface UsageCounts {
  rpm: number;
  rpd: number;
  tpm: number;
  tt: number;
}

export interface UsageRecord extends TokenUsageBudget {
  timestamp: string;
  status: string;
  action: string;
  simulation: boolean;
}

export interface HourlyUsageBucket {
  startMs: number;
  label: string;
  requests: number;
  tokens: number;
}

/** Conservative budget charged for quota checks when provider usage is unknown. */
export function getUsageBudgetTokens(event: TokenUsageBudget): number {
  const actual = event.promptTokens + event.completionTokens;
  if (event.usageKnown) return actual;
  const reserved = (event.reservedPromptTokens ?? 0) + (event.reservedCompletionTokens ?? 0);
  return Math.max(actual, reserved);
}

export function calculateHourlyUsageBuckets(
  events: UsageRecord[],
  locale: 'ru' | 'en',
  nowMs = Date.now(),
  bucketCount = 6
): HourlyUsageBucket[] {
  const count = Math.max(1, Math.min(48, Math.floor(bucketCount)));
  const currentHour = new Date(nowMs);
  currentHour.setMinutes(0, 0, 0);
  currentHour.setHours(currentHour.getHours() - count + 1);
  return Array.from({ length: count }, (_, index) => {
    const hour = new Date(currentHour);
    hour.setHours(currentHour.getHours() + index);
    const startMs = hour.getTime();
    const endMs = new Date(hour.getFullYear(), hour.getMonth(), hour.getDate(), hour.getHours() + 1).getTime();
    const requests = events.filter((event) => {
      if (event.simulation || event.status === 'limited' || event.status === 'counter-reset' || event.action === 'total_reset') return false;
      const at = Date.parse(event.timestamp);
      return Number.isFinite(at) && at >= startMs && at < endMs;
    });
    return {
      startMs,
      label: hour.toLocaleTimeString(locale === 'ru' ? 'ru-RU' : 'en-US', { hour: '2-digit' }),
      requests: requests.length,
      tokens: requests.reduce((total, event) => total + getUsageBudgetTokens(event), 0),
    };
  });
}

export function calculateUsageCounts(events: UsageRecord[], nowMs = Date.now()): UsageCounts {
  const realRequests = events.filter((event) =>
    !event.simulation &&
    event.status !== 'counter-reset' &&
    event.status !== 'limited' &&
    event.action !== 'total_reset'
  );
  const timestamp = (event: UsageRecord) => Date.parse(event.timestamp);
  const within = (event: UsageRecord, windowMs: number) => {
    const at = timestamp(event);
    return Number.isFinite(at) && at >= nowMs - windowMs && at <= nowMs;
  };
  const resetAt = events
    .filter((event) => !event.simulation && (event.status === 'counter-reset' || event.action === 'total_reset'))
    .map(timestamp)
    .filter((at) => Number.isFinite(at) && at <= nowMs)
    .reduce((latest, at) => Math.max(latest, at), Number.NEGATIVE_INFINITY);
  const afterReset = realRequests.filter((event) => {
    const at = timestamp(event);
    return Number.isFinite(at) && at > resetAt && at <= nowMs;
  });
  const recentMinute = realRequests.filter((event) => within(event, 60_000));
  const recentDay = realRequests.filter((event) => within(event, 86_400_000));
  const tokens = (list: UsageRecord[]) => list.reduce((sum, event) => sum + getUsageBudgetTokens(event), 0);
  return {
    rpm: recentMinute.length,
    rpd: recentDay.length,
    tpm: tokens(recentMinute),
    tt: tokens(afterReset),
  };
}

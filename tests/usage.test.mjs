import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateHourlyUsageBuckets, calculateUsageCounts, getUsageBudgetTokens } from '../src/utils/usage.ts';

test('known usage reports actual tokens and unknown usage charges the larger reserved budget', () => {
  assert.equal(getUsageBudgetTokens({ promptTokens: 12, completionTokens: 5, usageKnown: true }), 17);
  assert.equal(getUsageBudgetTokens({
    promptTokens: 3,
    completionTokens: 0,
    reservedPromptTokens: 20,
    reservedCompletionTokens: 80,
    usageKnown: false,
  }), 100);
  assert.equal(getUsageBudgetTokens({
    promptTokens: 20,
    completionTokens: 90,
    reservedPromptTokens: 20,
    reservedCompletionTokens: 80,
    usageKnown: false,
  }), 110);
});

test('quota counts exclude limited, simulated, future, and pre-reset activity', () => {
  const now = Date.UTC(2026, 9, 1, 10, 0, 0);
  const at = (offset) => new Date(now + offset).toISOString();
  const events = [
    { timestamp: at(-30_000), action: 'analyze', status: 'completed', simulation: false, promptTokens: 12, completionTokens: 5, usageKnown: true },
    { timestamp: at(-2 * 60 * 60_000), action: 'analyze', status: 'failed', simulation: false, promptTokens: 2, completionTokens: 0, reservedPromptTokens: 8, reservedCompletionTokens: 25, usageKnown: false },
    { timestamp: at(-10_000), action: 'analyze', status: 'limited', simulation: false, promptTokens: 0, completionTokens: 0, usageKnown: true },
    { timestamp: at(-20_000), action: 'simulation_1', status: 'simulation-admitted', simulation: true, promptTokens: 100, completionTokens: 100, usageKnown: true },
    { timestamp: at(-5 * 60 * 60_000), action: 'analyze', status: 'completed', simulation: false, promptTokens: 50, completionTokens: 20, usageKnown: true },
    { timestamp: at(-4 * 60 * 60_000), action: 'total_reset', status: 'counter-reset', simulation: false, promptTokens: 0, completionTokens: 0, usageKnown: true },
    { timestamp: at(30_000), action: 'analyze', status: 'completed', simulation: false, promptTokens: 90, completionTokens: 90, usageKnown: true },
  ];

  assert.deepEqual(calculateUsageCounts(events, now), { rpm: 1, rpd: 3, tpm: 17, tt: 50 });
});

test('hourly chart buckets count real requests and tokens, excluding simulations and limited attempts', () => {
  const now = new Date(2026, 9, 2, 12, 25).getTime();
  const at = (hours, minutes = 0) => new Date(2026, 9, 2, 12 + hours, minutes).toISOString();
  const events = [
    { timestamp: at(-1, 5), action: 'analyze', status: 'completed', simulation: false, promptTokens: 9, completionTokens: 4, usageKnown: true },
    { timestamp: at(-1, 50), action: 'interview', status: 'failed', simulation: false, promptTokens: 0, completionTokens: 0, reservedPromptTokens: 8, reservedCompletionTokens: 22, usageKnown: false },
    { timestamp: at(-1, 55), action: 'analyze', status: 'limited', simulation: false, promptTokens: 0, completionTokens: 0, usageKnown: true },
    { timestamp: at(-1, 59), action: 'simulation_1', status: 'simulation-admitted', simulation: true, promptTokens: 100, completionTokens: 100, usageKnown: true },
    { timestamp: at(1), action: 'analyze', status: 'completed', simulation: false, promptTokens: 5, completionTokens: 5, usageKnown: true },
  ];
  const buckets = calculateHourlyUsageBuckets(events, 'en', now, 3);
  assert.equal(buckets.length, 3);
  assert.deepEqual(buckets.map(({ requests, tokens }) => ({ requests, tokens })), [
    { requests: 0, tokens: 0 },
    { requests: 2, tokens: 43 },
    { requests: 0, tokens: 0 },
  ]);
});

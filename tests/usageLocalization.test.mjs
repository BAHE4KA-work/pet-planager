import test from 'node:test';
import assert from 'node:assert/strict';
import { formatUsageAction, formatUsageStatus } from '../src/utils/usageLocalization.ts';

test('usage history localizes known actions and statuses and preserves unknown future values', () => {
  assert.equal(formatUsageAction('analyze', 'ru'), 'Анализ');
  assert.equal(formatUsageAction('test_provider', 'en'), 'Provider connection test');
  assert.equal(formatUsageAction('simulation_12', 'ru'), 'Симуляция №12');
  assert.equal(formatUsageAction('future_action', 'en'), 'future_action');
  assert.equal(formatUsageStatus('limited', 'ru'), 'Отклонён лимитом');
  assert.equal(formatUsageStatus('completed', 'en'), 'Completed');
  assert.equal(formatUsageStatus('future-status', 'ru'), 'future-status');
});

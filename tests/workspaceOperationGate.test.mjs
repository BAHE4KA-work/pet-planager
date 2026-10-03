import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkspaceOperationGate, WorkspaceRevisionFence } from '../src/hooks/workspaceOperationGate.ts';

test('workspace operation gate blocks edits and overlapping native operations until reload completes', async () => {
  const gate = new WorkspaceOperationGate();
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const run = gate.run(async () => {
    assert.equal(gate.locked, true);
    await pending;
    return 'disk reloaded';
  });
  assert.equal(gate.locked, true, 'the lock is acquired synchronously before yielding');
  let value = 0;
  if (!gate.locked) value += 1;
  assert.equal(value, 0, 'hook setters that check locked reject edits during the native operation');
  await assert.rejects(gate.run(async () => 'overlap'), /already in progress/);
  release();
  assert.equal(await run, 'disk reloaded');
  assert.equal(gate.locked, false, 'the gate releases after completion');
});

test('workspace revision fence makes queued autosave tokens stale before a reload waits', () => {
  const fence = new WorkspaceRevisionFence();
  const queuedBeforeReload = fence.current();
  assert.equal(fence.isCurrent(queuedBeforeReload), true);
  fence.advance(); // reload invalidates queued writes before awaiting the save chain
  assert.equal(fence.isCurrent(queuedBeforeReload), false);
  const nextEdit = fence.advance();
  assert.equal(fence.isCurrent(nextEdit), true);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { HistoryController } from '../src/hooks/historyStack.ts';
import { parsePgrFileContent } from '../src/utils/pgrCodec.ts';

const keyed = (value) => [value, JSON.stringify(value)];

test('pending malformed source undo/redo restores exact raw draft and last valid graph', () => {
  const initial = { snapshot: { root: 'A', files: [{ path: 'plan.pgr', content: '## Класс: Valid\nid: cls_valid' }] }, elements: [{ id: 'cls_valid' }] };
  const invalidDraft = { snapshot: { root: 'A', files: [{ path: 'plan.pgr', content: '## Unsupported: malformed' }] }, elements: initial.elements };
  const history = new HistoryController();
  history.reset(initial, JSON.stringify(initial));
  assert.throws(
    () => parsePgrFileContent('## Unsupported: malformed', 'plan.pgr', initial.elements),
    /unsupported|unknown|неизвест/i,
    'the malformed draft is actually rejected by the project parser',
  );
  history.observe(invalidDraft, JSON.stringify(invalidDraft), true);
  assert.equal(history.canUndo, true, 'pending edits enable undo before the coalescing timeout');
  const undone = history.undo(...keyed(invalidDraft));
  assert.deepEqual(undone, initial);
  const redone = history.redo(...keyed(initial));
  assert.deepEqual(redone, invalidDraft);
  assert.equal(redone.snapshot.files[0].content, '## Unsupported: malformed');
  assert.deepEqual(redone.elements, [{ id: 'cls_valid' }]);
});

test('many pointer frames between begin and end form one undoable transaction', () => {
  const initial = { x: 0, y: 0 };
  const frame1 = { x: 8, y: 12 };
  const frame2 = { x: 22, y: 31 };
  const final = { x: 40, y: 60 };
  const history = new HistoryController();
  history.reset(initial, JSON.stringify(initial));
  history.begin(...keyed(initial));
  assert.equal(history.canUndo, false, 'undo is unavailable during an active pointer transaction');
  history.observe(frame1, JSON.stringify(frame1), true);
  history.observe(frame2, JSON.stringify(frame2), true);
  history.end(...keyed(final));
  assert.equal(history.length, 2);
  assert.deepEqual(history.undo(...keyed(final)), initial);
  assert.deepEqual(history.redo(...keyed(initial)), final);
});

test('starting a transaction commits pending typed edits before grouping later changes', () => {
  const initial = { title: 'Before', x: 0 };
  const typed = { title: 'Edited', x: 0 };
  const moved = { title: 'Edited', x: 10 };
  const history = new HistoryController();
  history.reset(initial, JSON.stringify(initial));
  history.observe(typed, JSON.stringify(typed), true);
  history.begin(...keyed(typed));
  history.observe({ ...typed, x: 5 }, JSON.stringify({ ...typed, x: 5 }), true);
  history.end(...keyed(moved));
  assert.equal(history.length, 3);
  assert.deepEqual(history.undo(...keyed(moved)), typed);
  assert.deepEqual(history.undo(...keyed(typed)), initial);
});

test('undo flushes a pending coalesced edit immediately and redo branches/reset are isolated', () => {
  const initial = { title: 'A' };
  const pending = { title: 'AB' };
  const branch = { title: 'AC' };
  const history = new HistoryController();
  history.reset(initial, JSON.stringify(initial));
  history.observe(pending, JSON.stringify(pending), true);
  assert.deepEqual(history.undo(...keyed(pending)), initial);
  history.observe(branch, JSON.stringify(branch), false);
  assert.equal(history.redo(...keyed(branch)), null, 'new edit discards the abandoned redo branch');
  const newRoot = { snapshot: { root: 'B' }, elements: [] };
  history.reset(newRoot, JSON.stringify(newRoot));
  assert.equal(history.canUndo, false);
  assert.equal(history.undo(...keyed(newRoot)), null, 'workspace reset prevents undo crossing roots');
});

test('redo is blocked while a pointer transaction is active', () => {
  const before = { x: 0 };
  const after = { x: 1 };
  const history = new HistoryController();
  history.reset(before, JSON.stringify(before));
  history.observe(after, JSON.stringify(after), false);
  assert.deepEqual(history.undo(...keyed(after)), before);
  const length = history.length;
  history.begin(...keyed(before));
  assert.equal(history.canRedo, false);
  assert.equal(history.redo(...keyed(before)), null);
  assert.equal(history.length, length);
  assert.equal(history.inTransaction, true);
  history.end(...keyed(before));
  assert.equal(history.canRedo, true);
});

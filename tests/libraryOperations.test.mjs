import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareLibraryInsert } from '../src/hooks/libraryOperations.ts';

const element = (overrides = {}) => ({
  id: 'cls_example', type: 'class', title: 'Example', fileName: 'saved.pgr',
  parent: '-', description: 'Reusable class', status: 'черновик', mvp: true,
  position: { x: 12, y: 34 }, extendsId: '-', fields: [], methods: [],
  ...overrides,
});
const unit = (overrides = {}) => ({
  unitId: 'unit-example', category: 'class', savedAt: 'now', element: element(overrides),
});
const system = (id = 'sys_root') => ({
  id, type: 'system', title: 'Root', fileName: 'project.pgr', parent: '-',
  description: '', status: 'черновик', mvp: true, position: { x: 0, y: 0 },
});

test('allocates a collision-free ID even when the first suffix is occupied', () => {
  const current = [element(), element({ id: 'cls_example_2', title: 'Existing suffix' })];
  const result = prepareLibraryInsert(unit(), current, 'project.pgr');
  assert.equal(result.element.id, 'cls_example_3');
  assert.equal(result.element.fileName, 'project.pgr');
});

test('remaps legal self references in notes to the inserted ID', () => {
  const idea = unit({
    id: 'idea_example', type: 'idea', notes: ['idea_example'], altTo: '-',
    originIdeaId: undefined, extendsId: undefined, fields: undefined, methods: undefined,
  });
  const current = [{ ...idea.element, id: 'idea_example', notes: [] }];
  const result = prepareLibraryInsert(idea, current, 'project.pgr');
  assert.equal(result.element.id, 'idea_example_2');
  assert.deepEqual(result.element.notes, ['idea_example_2']);
});

test('preserves valid references to existing project elements', () => {
  const current = [system()];
  const result = prepareLibraryInsert(unit({ parent: 'sys_root', uses: ['sys_root'] }), current, 'project.pgr');
  assert.equal(result.element.parent, 'sys_root');
  assert.deepEqual(result.element.uses, ['sys_root']);
  assert.deepEqual(result.warnings, []);
});

test('clears missing optional references and reports each loss', () => {
  const result = prepareLibraryInsert(unit({ extendsId: 'cls_missing', uses: ['sys_missing'] }), [], 'project.pgr');
  assert.equal(result.element.extendsId, '-');
  assert.deepEqual(result.element.uses, []);
  assert.equal(result.warnings.length, 2);
  assert.match(result.warnings.join(' '), /cls_missing/);
  assert.match(result.warnings.join(' '), /sys_missing/);
});

test('does not mutate the saved unit or current project elements', () => {
  const saved = unit({ fields: [{ name: 'label', dataType: 'string', description: '' }], uses: ['sys_root'] });
  const current = [system()];
  const savedBefore = structuredClone(saved);
  const currentBefore = structuredClone(current);
  const result = prepareLibraryInsert(saved, current, 'project.pgr');
  result.element.fields[0].name = 'changed';
  result.element.uses.push('another');
  assert.deepEqual(saved, savedBefore);
  assert.deepEqual(current, currentBefore);
});

test('clears a wrong-type parent and reports it instead of inserting a broken graph', () => {
  const result = prepareLibraryInsert(unit({ parent: 'cls_other' }), [element({ id: 'cls_other' })], 'project.pgr');
  assert.equal(result.element.parent, '-');
  assert.match(result.warnings.join(' '), /parent reference/);
});

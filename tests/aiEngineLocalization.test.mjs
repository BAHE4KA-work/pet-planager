import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectGraphSchemaIssues } from '../src/utils/aiEngine.ts';

const elements = [
  { id: 'cls_base', type: 'class', title: 'Base', fileName: 'model.pgr', parent: '-', description: '', status: 'черновик', mvp: true, position: { x: 0, y: 0 }, fields: [{ name: 'count', dataType: 'int', description: '' }] },
  { id: 'cls_child', type: 'class', title: 'Child', fileName: 'model.pgr', parent: '-', description: '', status: 'черновик', mvp: true, position: { x: 0, y: 0 }, extendsId: 'cls_base', fields: [{ name: 'count', dataType: 'string', description: '' }], uses: ['proc_missing'] },
];

test('deterministic graph diagnostics follow the selected locale', () => {
  const english = inspectGraphSchemaIssues(elements, ['model.pgr'], 'en');
  const fieldIssue = english.find((issue) => issue.id.startsWith('schema_type_'));
  const missingReference = english.find((issue) => issue.id.startsWith('schema_warn_'));
  assert.match(fieldIssue.title, /^Field type mismatch/);
  assert.match(fieldIssue.description, /declared as int/);
  assert.match(fieldIssue.resolutionHint, /Change count/);
  assert.match(fieldIssue.suggestedFix.fixLabel, /^Remove conflicting/);
  assert.match(missingReference.description, /^uses references unknown element/);

  const russian = inspectGraphSchemaIssues(elements, ['model.pgr'], 'ru');
  assert.match(russian.find((issue) => issue.id.startsWith('schema_type_')).title, /^Несовпадение/);
});

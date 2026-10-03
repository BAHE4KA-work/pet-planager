import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareSourceImport } from '../src/hooks/workspaceImport.ts';

const pgr = (id = 'cls_imported') => `## Класс: Imported\nid: ${id}\nparent: -\nextends: -\nstatus: черновик\n\nImported class.\n`;
const current = [{
  id: 'cls_existing', type: 'class', title: 'Existing', fileName: 'project.pgr',
  parent: '-', description: '', status: 'черновик', mvp: true,
  position: { x: 1, y: 2 }, extendsId: '-', fields: [], methods: [],
}];

test('rejects duplicate element IDs before returning an import plan and leaves input untouched', () => {
  const before = structuredClone(current);
  assert.throws(
    () => prepareSourceImport('incoming.pgr', pgr('cls_existing'), ['project.pgr'], current),
    /element ID "cls_existing" already exists/,
  );
  assert.deepEqual(current, before);
});

test('chooses the next case-insensitive collision-safe import filename', () => {
  const result = prepareSourceImport(
    'model.pgr', pgr(), ['MODEL.PGR', 'model_import1.pgr'], [],
  );
  assert.equal(result.path, 'model_import2.pgr');
});

test('keeps malformed source text byte-for-byte available with a diagnostic and no AST', () => {
  const malformed = 'not a PGR block\r\nsecond line\t\r\n';
  const result = prepareSourceImport('broken.pgr', malformed, [], []);
  assert.equal(result.content, malformed);
  assert.deepEqual(result.elements, []);
  assert.match(result.diagnostic, /PGR block/);
});

test('parses valid source into the selected project path', () => {
  const result = prepareSourceImport('incoming.pgr', pgr(), [], current);
  assert.equal(result.path, 'incoming.pgr');
  assert.equal(result.diagnostic, null);
  assert.equal(result.elements.length, 1);
  assert.equal(result.elements[0].fileName, 'incoming.pgr');
});

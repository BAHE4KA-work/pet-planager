import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAiJson, validateAiProposals, validateAiQuestions,
  validateElementPatch, validateTransformedElements,
} from '../src/utils/aiValidation.ts';

const element = (id, type = 'class', extras = {}) => ({
  id, type, title: id, fileName: 'plan.pgr', parent: 'sys_root', description: 'description',
  status: 'черновик', mvp: false, position: { x: 0, y: 0 }, ...extras,
});
const classElement = element('cls_a');
const systemElement = element('sys_root', 'system', { parent: '-' });
const citations = ['plan.pgr:1-10'];

test('parses provider JSON and rejects malformed or non-object data', () => {
  assert.deepEqual(parseAiJson('{"ok":true}'), { ok: true });
  assert.throws(() => parseAiJson('not JSON'), /некорректный JSON/);
  assert.throws(() => parseAiJson([]), /неверной структуры/);
});

test('requires proposals to cite a real generated range and existing targets', () => {
  const proposal = { id: 'p1', category: 'polish', title: 'Improve', rationale: 'Reason', targetElementId: 'cls_a', fileCitation: citations[0] };
  assert.equal(validateAiProposals([proposal], [classElement], citations).length, 1);
  assert.throws(() => validateAiProposals([{ ...proposal, fileCitation: 'plan.pgr:1-20' }], [classElement], citations), /подтвержденная цитата/);
  assert.throws(() => validateAiProposals([{ ...proposal, targetElementId: 'cls_missing' }], [classElement], citations), /неизвестный targetElementId/);
});

test('requires target-specific citations when citation ownership is available', () => {
  const proposal = { id: 'p1', category: 'polish', title: 'Improve', rationale: 'Reason', targetElementId: 'cls_a', fileCitation: citations[0] };
  const owners = new Map([[citations[0], 'sys_root']]);
  assert.throws(() => validateAiProposals([proposal], [classElement], citations, owners), /не относится к целевому/);
});

test('validates interview questions and type-safe patches', () => {
  const question = { id: 'q1', question: 'Why?', weakSpotContext: 'plan.pgr:1-10', quickOptions: ['A'], targetElementId: 'cls_a' };
  assert.equal(validateAiQuestions([question], [classElement]).length, 1);
  assert.throws(() => validateAiQuestions([{ ...question, targetElementId: 'missing' }], [classElement]), /некорректный вопрос/);
  const graph = [systemElement, classElement];
  assert.deepEqual(validateElementPatch({ title: 'Updated', fields: [] }, classElement, graph), { title: 'Updated', fields: [] });
  assert.throws(() => validateElementPatch({ id: 'replaced' }, classElement, graph), /изменение поля id запрещено/);
  assert.throws(() => validateElementPatch({ steps: ['step'] }, classElement, graph), /не разрешен для class/);
});

test('rejects broken references and properties owned by another element type in patches', () => {
  const component = element('cmp_a', 'component');
  const object = element('obj_a', 'object');
  const elements = [classElement, systemElement, component, object];
  assert.throws(() => validateElementPatch({ extendsId: 'obj_a' }, classElement, elements), /неверная ссылка/);
  assert.throws(() => validateElementPatch({ components: ['missing'] }, classElement, elements), /неверная ссылка/);
  assert.throws(() => validateElementPatch({ uses: ['class'] }, object, elements), /не разрешен/);
  assert.throws(() => validateElementPatch({ extendsId: 'cls_a' }, classElement, [
    classElement, { ...element('cls_b'), extendsId: 'cls_a' },
  ]), /структурно некорректный граф/);
});

test('rejects duplicate IDs and typed bad references in transformation output', () => {
  const source = element('idea_origin', 'idea', { parent: '-' });
  const duplicate = [
    { id: 'cls_new', type: 'class', title: 'One', description: 'x', parent: '-' },
    { id: 'cls_new', type: 'class', title: 'Two', description: 'x', parent: '-' },
  ];
  assert.throws(() => validateTransformedElements(duplicate, source, []), /ID|suggestedElement/);
  assert.throws(() => validateTransformedElements([
    { id: 'cmp_new', type: 'component', title: 'New', description: 'x', parent: '-', uses: ['sys_root'] },
  ], source, [systemElement]), /uses не разрешен/);
});

test('rejects invalid references in suggested proposal elements', () => {
  const proposal = { id: 'p1', category: 'new_element', title: 'Add', rationale: 'Reason', fileCitation: citations[0],
    suggestedElement: { id: 'cls_new', type: 'class', title: 'New', description: 'x', parent: 'missing' } };
  assert.throws(() => validateAiProposals([proposal], [classElement], citations), /parent/);
});

test('reserves suggested element IDs across all proposals', () => {
  const make = (id) => ({ id, category: 'new_element', title: 'Add', rationale: 'Reason', fileCitation: citations[0],
    suggestedElement: { id: 'cls_new', type: 'class', title: 'New', description: 'x', parent: 'sys_root' } });
  assert.throws(() => validateAiProposals([make('p1'), make('p2')], [systemElement], citations), /suggestedElement|ID/);
});

test('accepts transformation with unique IDs and valid links, rejects invalid IDs and references', () => {
  const source = element('idea_origin', 'idea', { parent: '-' });
  const result = validateTransformedElements([
    { id: 'cls_new', type: 'class', title: 'New', description: 'New class', parent: 'sys_root', fields: [] },
  ], source, [classElement, systemElement]);
  assert.equal(result[0].originIdeaId, source.id);
  assert.equal(result[0].fileName, source.fileName);
  assert.throws(() => validateTransformedElements([
    { id: 'cls_a', type: 'class', title: 'duplicate', description: 'x', parent: '-' },
  ], source, [classElement]), /некорректный suggestedElement/);
  assert.throws(() => validateTransformedElements([
    { id: 'cls_new', type: 'class', title: 'New', description: 'x', parent: '-', uses: ['missing'] },
  ], source, []), /ссылка missing/);
});

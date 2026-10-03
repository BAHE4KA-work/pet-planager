import test from 'node:test';
import assert from 'node:assert/strict';
import { toggleCanvasRelation } from '../src/utils/canvasRelations.ts';

const makeElement = (id, type, patch = {}) => ({
  id,
  type,
  title: id,
  fileName: 'project.pgr',
  parent: '-',
  description: '',
  status: 'черновик',
  mvp: false,
  position: { x: 0, y: 0 },
  ...patch,
});

test('scalar canvas relations toggle off when the same directed link exists', () => {
  const cases = [
    {
      relation: 'contains',
      elements: [makeElement('sys_root', 'system'), makeElement('obj_item', 'object', { parent: 'sys_root' })],
      source: 'sys_root', target: 'obj_item', updated: 'obj_item', property: 'parent', value: '-',
    },
    {
      relation: 'extends',
      elements: [makeElement('cls_child', 'class', { extendsId: 'cls_base' }), makeElement('cls_base', 'class')],
      source: 'cls_child', target: 'cls_base', updated: 'cls_child', property: 'extendsId', value: '-',
    },
    {
      relation: 'instance_of',
      elements: [makeElement('obj_item', 'object', { instanceOf: 'cls_item' }), makeElement('cls_item', 'class')],
      source: 'obj_item', target: 'cls_item', updated: 'obj_item', property: 'instanceOf', value: '-',
    },
  ];

  for (const item of cases) {
    const result = toggleCanvasRelation(item.elements, item.source, item.target);
    assert.equal(result.relation, item.relation);
    assert.equal(result.removed, true);
    assert.equal(result.updatedElement.id, item.updated);
    assert.equal(result.updatedElement[item.property], item.value);
  }
});

test('multi-valued canvas relations toggle only the selected target and preserve other links', () => {
  const cases = [
    { relation: 'has', source: makeElement('cls_owner', 'class', { components: ['cmp_selected', 'cmp_other'] }), target: makeElement('cmp_selected', 'component'), property: 'components' },
    { relation: 'uses', source: makeElement('proc_owner', 'process', { uses: ['obj_selected', 'obj_other'] }), target: makeElement('obj_selected', 'object'), property: 'uses' },
    { relation: 'notes', source: makeElement('idea_owner', 'idea', { notes: ['cls_selected', 'cls_other'] }), target: makeElement('cls_selected', 'class'), property: 'notes' },
  ];

  for (const item of cases) {
    const result = toggleCanvasRelation([item.source, item.target], item.source.id, item.target.id);
    assert.equal(result.relation, item.relation);
    assert.equal(result.removed, true);
    assert.deepEqual(result.updatedElement[item.property], [`${item.relation === 'has' ? 'cmp' : item.relation === 'uses' ? 'obj' : 'cls'}_other`]);
  }
});

test('canvas relation toggle adds a missing link and rejects unsupported directions', () => {
  const source = makeElement('cls_owner', 'class', { components: ['cmp_other'] });
  const target = makeElement('cmp_selected', 'component');
  const added = toggleCanvasRelation([source, target], source.id, target.id);
  assert.equal(added.relation, 'has');
  assert.equal(added.removed, false);
  assert.deepEqual(added.updatedElement.components, ['cmp_other', 'cmp_selected']);

  assert.equal(toggleCanvasRelation([source, target], target.id, source.id), null);
  assert.equal(toggleCanvasRelation([source], source.id, source.id), null);
  assert.equal(toggleCanvasRelation([source], source.id, 'missing'), null);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { renameElementId, deleteElements, cloneElements, moveElementsToFile } from '../src/hooks/projectOperations.ts';

const elements = [
  { id: 'sys_root', type: 'system', title: 'Root', fileName: 'root.pgr', parent: '-', description: '', status: 'черновик', mvp: true, position: { x: 0, y: 0 } },
  { id: 'cls_child', type: 'class', title: 'Child', fileName: 'root.pgr', parent: 'sys_root', description: '', status: 'черновик', mvp: true, position: { x: 1, y: 1 }, extendsId: 'cls_base', fields: [], methods: [], uses: ['sys_root'], notes: ['sys_root'], altTo: 'sys_root', originIdeaId: 'idea_origin' },
  { id: 'cls_base', type: 'class', title: 'Base', fileName: 'root.pgr', parent: 'sys_root', description: '', status: 'черновик', mvp: true, position: { x: 2, y: 2 }, fields: [], methods: [] },
];

test('rename rewrites scalar and list references and rejects collisions', () => {
  const result = renameElementId(elements, 'sys_root', 'sys_main');
  assert.equal(result[1].parent, 'sys_main');
  assert.deepEqual(result[1].uses, ['sys_main']);
  assert.deepEqual(result[1].notes, ['sys_main']);
  assert.equal(result[1].altTo, 'sys_main');
  assert.throws(() => renameElementId(elements, 'sys_root', 'cls_base'), /already exists/);
});

test('rename and delete keep class and procedure field references synchronized', () => {
  const typedElements = [
    { id: 'cls_owner', type: 'class', title: 'Owner', fileName: 'root.pgr', parent: '-', description: '', status: 'черновик', mvp: true, position: { x: 0, y: 0 }, fields: [
      { name: 'child', dataType: 'cls_target', description: '' },
      { name: 'handler', dataType: 'procedure', description: '' },
      { name: 'label', dataType: 'string', description: '' },
    ] },
    { id: 'cls_target', type: 'class', title: 'Target', fileName: 'root.pgr', parent: '-', description: '', status: 'черновик', mvp: true, position: { x: 0, y: 0 } },
    { id: 'obj_owner', type: 'object', title: 'Owner instance', fileName: 'root.pgr', parent: '-', description: '', status: 'черновик', mvp: true, position: { x: 0, y: 0 }, instanceOf: 'cls_owner', values: [
      { fieldName: 'child', value: 'obj_target' },
      { fieldName: 'handler', value: 'proc_handler' },
      { fieldName: 'label', value: 'obj_target' },
    ] },
    { id: 'obj_target', type: 'object', title: 'Target instance', fileName: 'root.pgr', parent: '-', description: '', status: 'черновик', mvp: true, position: { x: 0, y: 0 }, instanceOf: 'cls_target' },
    { id: 'proc_handler', type: 'process', title: 'Handler', fileName: 'root.pgr', parent: '-', description: '', status: 'черновик', mvp: true, position: { x: 0, y: 0 } },
  ];

  const classRenamed = renameElementId(typedElements, 'cls_target', 'cls_renamed');
  assert.equal(classRenamed[0].fields[0].dataType, 'cls_renamed');
  const objectRenamed = renameElementId(typedElements, 'obj_target', 'obj_renamed');
  assert.equal(objectRenamed[2].values[0].value, 'obj_renamed');
  assert.equal(objectRenamed[2].values[2].value, 'obj_target');
  const procedureRenamed = renameElementId(typedElements, 'proc_handler', 'proc_updated');
  assert.equal(procedureRenamed[2].values[1].value, 'proc_updated');

  const deleted = deleteElements(typedElements, ['obj_target', 'proc_handler']);
  assert.deepEqual(deleted.find((element) => element.id === 'obj_owner').values, [
    { fieldName: 'label', value: 'obj_target' },
  ]);
});

test('delete cleans every direct relationship reference', () => {
  const result = deleteElements(elements, ['sys_root']);
  assert.equal(result.length, 2);
  assert.equal(result[0].parent, '-');
  assert.deepEqual(result[0].uses, []);
  assert.deepEqual(result[0].notes, []);
  assert.equal(result[0].altTo, '-');
});

test('clone remaps links internal to copied selection and keeps external links', () => {
  const result = cloneElements(elements, ['sys_root', 'cls_child'], 'copy.pgr');
  const [root, child] = result;
  assert.equal(root.fileName, 'copy.pgr');
  assert.equal(child.parent, root.id);
  assert.deepEqual(child.uses, [root.id]);
  assert.equal(child.extendsId, 'cls_base');
  assert.ok(!elements.some((element) => element.id === child.id));
});

test('file move changes file ownership only for selected elements', () => {
  const result = moveElementsToFile(elements, ['cls_child'], 'other.pgr');
  assert.equal(result[1].fileName, 'other.pgr');
  assert.equal(result[0].fileName, 'root.pgr');
});

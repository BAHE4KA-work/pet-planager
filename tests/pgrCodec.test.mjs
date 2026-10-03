import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAndValidateGraph,
  computeLineDiff,
  parsePgrFileContent,
  serializeElementToPgr,
  serializeFileWithRanges,
} from '../src/utils/pgrCodec.ts';

const base = (type, id, extras = {}) => ({
  id, type, title: id, fileName: 'test.pgr', parent: 'sys_root',
  description: `Description of ${id}`, status: 'черновик', mvp: false,
  position: { x: 10, y: 20 }, ...extras,
});

test('serializes and parses every supported type and its declared data', () => {
  const elements = [
    base('system', 'sys_root', { parent: '-', description: 'Root system' }),
    base('class', 'cls_item', {
      extendsId: '-', fields: [{ name: 'count', dataType: 'int', description: 'number' }],
      methods: [{ visibility: '+', signature: 'use()', description: 'Uses item' }],
      components: ['cmp_store'], uses: ['proc_run'],
    }),
    base('process', 'proc_run', { steps: ['Start', 'Finish'], components: ['cmp_store'], uses: ['cls_item'] }),
    base('component', 'cmp_store', { components: ['cmp_nested'], interfaceItems: ['read(): int'], internalLogic: ['cache result'] }),
    base('component', 'cmp_nested'),
    base('object', 'obj_one', { instanceOf: 'cls_item', components: ['cmp_store'], values: [{ fieldName: 'count', value: '4' }] }),
    base('idea', 'idea_shape', { notes: ['obj_one'], altTo: 'cls_item', altReason: 'alternative', originIdeaId: 'idea_origin', customColor: '#7788aa' }),
  ];
  const { content } = serializeFileWithRanges(elements, 'test.pgr');
  const parsed = parsePgrFileContent(content, 'test.pgr', elements);
  assert.equal(parsed.length, elements.length);
  const serializedProperties = [
    'id', 'type', 'title', 'fileName', 'parent', 'description', 'status', 'mvp',
    'customColor', 'extendsId', 'fields', 'methods', 'components', 'uses',
    'steps', 'interfaceItems', 'internalLogic', 'instanceOf', 'values',
    'notes', 'altTo', 'altReason', 'originIdeaId',
  ];
  for (const source of elements) {
    const actual = parsed.find((item) => item.id === source.id);
    assert.ok(actual, `missing ${source.id}`);
    assert.equal(actual.type, source.type);
    assert.equal(actual.title, source.title);
    assert.equal(actual.description, source.description);
    for (const key of serializedProperties) {
      if (source[key] !== undefined) {
        assert.deepEqual(actual[key], source[key], source.id + '.' + key);
      }
    }
  }
  assert.deepEqual(parsed.find((item) => item.id === 'cls_item').fields, elements[1].fields);
  assert.deepEqual(parsed.find((item) => item.id === 'cls_item').methods, elements[1].methods);
  assert.deepEqual(parsed.find((item) => item.id === 'cmp_store').components, ['cmp_nested']);
  assert.deepEqual(parsed.find((item) => item.id === 'proc_run').steps, ['Start', 'Finish']);
  assert.deepEqual(parsed.find((item) => item.id === 'obj_one').values, [{ fieldName: 'count', value: '4' }]);
  assert.deepEqual(parsed.find((item) => item.id === 'idea_shape').notes, ['obj_one']);
  assert.equal(parsed.find((item) => item.id === 'idea_shape').originIdeaId, 'idea_origin');
});

test('preserves hyphens and dash characters in class declarations and empty object values', () => {
  const cls = base('class', 'cls_dash', {
    fields: [{ name: 'kind', dataType: 'string-list', description: 'uses - separators — and em dashes' }],
    methods: [{ visibility: '+', signature: 'find-by-id()', description: 'handles - and — in its result' }],
  });
  const obj = base('object', 'obj_empty', { instanceOf: 'cls_dash', values: [{ fieldName: 'empty', value: '' }] });
  const serialized = [cls, obj].map(serializeElementToPgr).join('\n\n---\n\n');
  const parsed = parsePgrFileContent(serialized, 'test.pgr', []);
  assert.deepEqual(parsed[0].fields, cls.fields);
  assert.deepEqual(parsed[0].methods, cls.methods);
  assert.deepEqual(parsed[1].values, obj.values);
});

test('round-trips description lines that look like PGR section markers or block separators', () => {
  const element = base('class', 'cls_markers', {
    description: 'before\nПоля:\n---\nnotes:\n\\Поля:\nafter',
  });
  const serialized = serializeElementToPgr(element);
  assert.match(serialized, /\\Поля:/);
  assert.match(serialized, /\\---/);
  const [parsed] = parsePgrFileContent(serialized, 'test.pgr', []);
  assert.equal(parsed.description, element.description);
  assert.deepEqual(parsed.fields, []);
});

test('removing optional serialized metadata clears it instead of restoring stale values', () => {
  const element = base('idea', 'idea_metadata', {
    customColor: '#abc123', originIdeaId: 'idea_origin', altTo: 'cls_target',
  });
  const source = serializeElementToPgr(element)
    .replace('color: #abc123\n', '')
    .replace('origin: idea_origin\n', '');
  const [parsed] = parsePgrFileContent(source, 'test.pgr', [element]);
  assert.equal(parsed.customColor, undefined);
  assert.equal(parsed.originIdeaId, undefined);
  assert.equal(parsed.altTo, 'cls_target');
});

test('parses CRLF separated blocks and keeps existing positions', () => {
  const a = base('system', 'sys_a', { parent: '-' });
  const b = base('class', 'cls_b', { position: { x: 88, y: 99 } });
  const text = `${serializeElementToPgr(a)}\r\n\r\n---\r\n\r\n${serializeElementToPgr(b).replaceAll('\n', '\r\n')}`;
  const parsed = parsePgrFileContent(text, 'test.pgr', [b]);
  assert.deepEqual(parsed.map((item) => item.id), ['sys_a', 'cls_b']);
  assert.deepEqual(parsed[1].position, b.position);
});

test('rejects unsupported, malformed, and duplicate PGR element headers instead of coercing them', () => {
  assert.throws(() => parsePgrFileContent('## Unknown: New\nid: cls_new\n\ntext', 'test.pgr', []), /неподдерживаемый тип/);
  assert.throws(() => parsePgrFileContent('## Класс: New\n\ntext', 'test.pgr', []), /ID/);
  const block = serializeElementToPgr(base('class', 'cls_dup'));
  assert.throws(() => parsePgrFileContent(`${block}\n\n---\n\n${block}`, 'test.pgr', []), /дублирующийся ID/);
  assert.throws(() => parsePgrFileContent('## Класс: New\nid: cls_new\nmvp: maybe\n\ntext', 'test.pgr', []), /неверное значение mvp/);
  assert.throws(() => parsePgrFileContent('## Класс: New\nid: cls_new\ninstance_of: cls_base\n\ntext', 'test.pgr', []), /не поддерживается для типа class/);
  assert.throws(() => parsePgrFileContent('## Класс: New\nid: cls_new\nparent: sys_a\nparent: sys_b\n\ntext', 'test.pgr', []), /повторяющееся поле заголовка/);
});

test('reports duplicate IDs and invalid has, uses, and notes references', () => {
  const elements = [
    base('class', 'cls_dup', { components: ['cmp_missing'], uses: ['obj_missing'] }),
    base('class', 'cls_dup'),
    base('idea', 'idea_ref', { notes: ['sys_missing'] }),
  ];
  const graph = buildAndValidateGraph(elements);
  assert.ok(graph.warnings.some((warning) => warning.message.includes('Дублирующийся ID')));
  for (const relation of ['has', 'uses', 'notes']) {
    assert.ok(graph.edges.some((edge) => edge.relation === relation && !edge.valid));
    assert.ok(graph.warnings.some((warning) => warning.message.startsWith(relation)));
  }
});

test('validates alt_to and origin idea references', () => {
  const elements = [
    base('idea', 'idea_refs', { altTo: 'cls_missing', originIdeaId: 'cls_wrong' }),
    base('class', 'cls_origin_source', { originIdeaId: 'idea_missing' }),
  ];
  const warnings = buildAndValidateGraph(elements).warnings;
  assert.ok(warnings.some((warning) => warning.message.includes('alt_to')));
  assert.ok(warnings.filter((warning) => warning.message.includes('origin')).length === 2);
});

test('flags inheritance cycles and produces CRLF-independent diffs', () => {
  const graph = buildAndValidateGraph([
    base('class', 'cls_a', { extendsId: 'cls_b' }),
    base('class', 'cls_b', { extendsId: 'cls_a' }),
  ]);
  assert.equal(graph.edges.filter((edge) => edge.relation === 'extends' && !edge.valid).length, 2);
  assert.ok(graph.warnings.some((warning) => warning.message.includes('Цикл наследования')));
  assert.deepEqual(computeLineDiff('one\r\ntwo', 'one\ntwo').map((line) => line.type), ['unchanged', 'unchanged']);
});

test('returns stable block ranges and a minimal line diff', () => {
  const elements = [base('system', 'sys_a', { parent: '-'}), base('idea', 'idea_b')];
  const file = serializeFileWithRanges(elements, 'test.pgr');
  assert.equal(file.ranges.length, 2);
  assert.ok(file.ranges[0].startLine < file.ranges[0].endLine);
  const diff = computeLineDiff('alpha\nbeta', 'alpha\ngamma');
  assert.deepEqual(diff.map(({ type, content }) => [type, content]), [
    ['unchanged', 'alpha'], ['removed', 'beta'], ['added', 'gamma'],
  ]);
});

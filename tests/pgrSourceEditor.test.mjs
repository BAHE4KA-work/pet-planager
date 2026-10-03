import test from 'node:test';
import assert from 'node:assert/strict';
import { highlightPgrLine, highlightPgrSource } from '../src/utils/pgrHighlight.ts';
import { localizePgrParseError } from '../src/utils/pgrErrorLocalization.ts';
import { parseLineRange } from '../src/utils/lineRange.ts';

test('PGR syntax highlighting preserves exact source text', () => {
  const samples = [
    '## Класс: Item',
    'id: cls_item',
    '  description: value with punctuation: and spacing  ',
    'Поля:',
    '- count: int — total',
    '---',
    'malformed <raw> & input',
    '',
  ];
  for (const sample of samples) {
    assert.equal(highlightPgrLine(sample).map((token) => token.text).join(''), sample);
  }
});

test('PGR syntax highlighting marks parser-recognized structure', () => {
  assert.deepEqual(highlightPgrLine('## Класс: Item').map((token) => token.kind), [
    'heading-marker', 'heading-type', 'heading-marker', undefined,
  ]);
  assert.deepEqual(highlightPgrLine('id: cls_item').map((token) => token.kind), [
    'field-name', 'heading-marker', undefined,
  ]);
  assert.equal(highlightPgrLine('Поля:')[0].kind, 'section');
  assert.equal(highlightPgrLine('---')[0].kind, 'separator');
  assert.deepEqual(highlightPgrLine('description: value', false), [{ text: 'description: value' }]);
});

test('multiline PGR keeps header fields highlighted after each element heading', () => {
  const source = [
    '## Класс: Item',
    'id: cls_item',
    'parent: sys_root',
    '',
    'A description: this is plain text',
    '',
    '---',
    '',
    '## Объект: Instance',
    'id: obj_instance',
    'parent: sys_root',
    '',
    'Description',
  ].join('\n');
  const lines = highlightPgrSource(source);
  assert.equal(lines.map((tokens) => tokens.map((token) => token.text).join('')).join('\n'), source);
  assert.deepEqual(lines.slice(0, 3).map((tokens) => tokens.map((token) => token.kind)), [
    ['heading-marker', 'heading-type', 'heading-marker', undefined],
    ['field-name', 'heading-marker', undefined],
    ['field-name', 'heading-marker', undefined],
  ]);
  assert.deepEqual(lines.slice(8, 11).map((tokens) => tokens.map((token) => token.kind)), [
    ['heading-marker', 'heading-type', 'heading-marker', undefined],
    ['field-name', 'heading-marker', undefined],
    ['field-name', 'heading-marker', undefined],
  ]);
  assert.deepEqual(lines[4].map((token) => token.kind), [undefined]);
});

test('PGR parser errors are fully localized in English while Russian messages stay intact', () => {
  assert.equal(
    localizePgrParseError('PGR block 2: дублирующийся ID cls_item', 'en'),
    'PGR block 2: duplicate ID cls_item',
  );
  assert.equal(
    localizePgrParseError('PGR block 1: неподдерживаемый тип "Module"', 'en'),
    'PGR block 1: unsupported element type "Module"',
  );
  assert.equal(
    localizePgrParseError('PGR block 1: неверный заголовок элемента', 'ru'),
    'PGR block 1: неверный заголовок элемента',
  );
  assert.equal(localizePgrParseError('PGR block 1: неизвестная ошибка', 'en'), 'PGR block 1: invalid PGR syntax');
  assert.equal(localizePgrParseError('main.pgr: PGR block 2: дублирующийся ID cls_item', 'en'), 'main.pgr: PGR block 2: duplicate ID cls_item');
});

test('PGR range selection accepts inclusive in-file ranges and rejects invalid bounds', () => {
  assert.deepEqual(parseLineRange('3', '8', 10), { start: 3, end: 8 });
  assert.deepEqual(parseLineRange('1', '1', 1), { start: 1, end: 1 });
  assert.equal(parseLineRange('0', '2', 10), null);
  assert.equal(parseLineRange('7', '6', 10), null);
  assert.equal(parseLineRange('1', '11', 10), null);
  assert.equal(parseLineRange('2.5', '4', 10), null);
});

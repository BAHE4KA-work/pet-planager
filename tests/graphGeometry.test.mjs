import test from 'node:test';
import assert from 'node:assert/strict';
import { getParallelEdgeOffsets, offsetGraphLine } from '../src/utils/graphGeometry.ts';

test('parallel relationships get distinct paths and preserve reverse direction', () => {
  const edges = [
    { source: 'cls_child', target: 'cmp_part' },
    { source: 'cls_child', target: 'cmp_part' },
    { source: 'cmp_part', target: 'cls_child' },
  ];
  const offsets = getParallelEdgeOffsets(edges);

  assert.deepEqual(offsets, [-28, 0, 28]);

  const positions = {
    cls_child: { x: 100, y: 200 },
    cmp_part: { x: 300, y: 200 },
  };
  const lines = edges.map((edge, index) =>
    offsetGraphLine(
      edge.source,
      edge.target,
      positions[edge.source],
      positions[edge.target],
      offsets[index]
    )
  );

  assert.notEqual(lines[0].y1, lines[1].y1);
  assert.notEqual(lines[1].y1, lines[2].y1);
  assert.equal(lines[2].x1, lines[0].x2);
  assert.equal(lines[2].x2, lines[0].x1);
});

test('single edges keep their direct geometry and self-links avoid invalid offsets', () => {
  const edges = [
    { source: 'a', target: 'b' },
    { source: 'idea_self', target: 'idea_self' },
  ];
  const offsets = getParallelEdgeOffsets(edges);

  assert.deepEqual(offsets, [0, 0]);
  assert.deepEqual(
    offsetGraphLine('a', 'b', { x: 1, y: 2 }, { x: 10, y: 20 }, offsets[0]),
    { x1: 1, y1: 2, x2: 10, y2: 20 }
  );
});

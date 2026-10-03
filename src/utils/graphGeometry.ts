import type { GraphEdge } from '../types/planager';

export interface GraphPoint {
  x: number;
  y: number;
}

export interface GraphLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

type EdgePair = Pick<GraphEdge, 'source' | 'target'>;

export function getParallelEdgeOffsets(
  edges: readonly EdgePair[],
  spacing = 28
): number[] {
  const offsets = edges.map(() => 0);
  const groups = new Map<string, number[]>();

  edges.forEach((edge, index) => {
    if (edge.source === edge.target) return;

    const pair = [edge.source, edge.target].sort();
    const key = JSON.stringify(pair);
    const group = groups.get(key);
    if (group) group.push(index);
    else groups.set(key, [index]);
  });

  for (const group of groups.values()) {
    group.forEach((edgeIndex, parallelIndex) => {
      offsets[edgeIndex] =
        (parallelIndex - (group.length - 1) / 2) * spacing;
    });
  }

  return offsets;
}

export function offsetGraphLine(
  source: string,
  target: string,
  start: GraphPoint,
  end: GraphPoint,
  offset: number
): GraphLine {
  if (!offset) {
    return { x1: start.x, y1: start.y, x2: end.x, y2: end.y };
  }

  // Use a canonical endpoint order so reverse-direction edges stay on distinct sides.
  const direction = source.localeCompare(target) < 0 ? 1 : -1;
  const dx = (end.x - start.x) * direction;
  const dy = (end.y - start.y) * direction;
  const length = Math.hypot(dx, dy);
  if (!length) {
    return { x1: start.x, y1: start.y, x2: end.x, y2: end.y };
  }

  const offsetX = (-dy / length) * offset;
  const offsetY = (dx / length) * offset;
  return {
    x1: start.x + offsetX,
    y1: start.y + offsetY,
    x2: end.x + offsetX,
    y2: end.y + offsetY,
  };
}

import type { PlanElement, RelationType } from '../types/planager';

export interface CanvasRelationToggle {
  relation: RelationType;
  updatedElement: PlanElement;
  removed: boolean;
}

/** Applies the canvas relation rules and toggles the selected directed link. */
export function toggleCanvasRelation(
  elements: PlanElement[],
  sourceId: string,
  targetId: string,
): CanvasRelationToggle | null {
  if (sourceId === targetId) return null;
  const source = elements.find((element) => element.id === sourceId);
  const target = elements.find((element) => element.id === targetId);
  if (!source || !target) return null;

  if (source.type === 'system' && target.type !== 'system') {
    const removed = target.parent === source.id;
    return {
      relation: 'contains',
      updatedElement: { ...target, parent: removed ? '-' : source.id },
      removed,
    };
  }
  if (source.type === 'class' && target.type === 'class') {
    const removed = source.extendsId === target.id;
    return {
      relation: 'extends',
      updatedElement: { ...source, extendsId: removed ? '-' : target.id },
      removed,
    };
  }
  if (source.type === 'object' && target.type === 'class') {
    const removed = source.instanceOf === target.id;
    return {
      relation: 'instance_of',
      updatedElement: { ...source, instanceOf: removed ? '-' : target.id },
      removed,
    };
  }
  if (['class', 'process', 'component', 'object'].includes(source.type) && target.type === 'component') {
    const current = source.components || [];
    const removed = current.includes(target.id);
    return {
      relation: 'has',
      updatedElement: { ...source, components: toggleId(current, target.id, removed) },
      removed,
    };
  }
  if (source.type === 'idea') {
    const current = source.notes || [];
    const removed = current.includes(target.id);
    return {
      relation: 'notes',
      updatedElement: { ...source, notes: toggleId(current, target.id, removed) },
      removed,
    };
  }
  if (source.type === 'process' || source.type === 'class') {
    const current = source.uses || [];
    const removed = current.includes(target.id);
    return {
      relation: 'uses',
      updatedElement: { ...source, uses: toggleId(current, target.id, removed) },
      removed,
    };
  }
  return null;
}

function toggleId(values: string[], targetId: string, removing: boolean): string[] {
  return removing ? values.filter((id) => id !== targetId) : [...values, targetId];
}

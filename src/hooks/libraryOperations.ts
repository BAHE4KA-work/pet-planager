import type { PlanElement, UnitLibraryItem } from '../types/planager.ts';
import { buildAndValidateGraph, TYPE_PREFIXES } from '../utils/pgrCodec.ts';

export interface PreparedLibraryInsert {
  element: PlanElement;
  warnings: string[];
}

function cloneLibraryElement(source: UnitLibraryItem['element']): PlanElement {
  return {
    ...source,
    fileName: '',
    position: { x: 0, y: 0 },
    fields: source.fields?.map((field) => ({ ...field })),
    methods: source.methods?.map((method) => ({ ...method })),
    components: source.components ? [...source.components] : undefined,
    uses: source.uses ? [...source.uses] : undefined,
    steps: source.steps ? [...source.steps] : undefined,
    interfaceItems: source.interfaceItems ? [...source.interfaceItems] : undefined,
    internalLogic: source.internalLogic ? [...source.internalLogic] : undefined,
    values: source.values?.map((value) => ({ ...value })),
    notes: source.notes ? [...source.notes] : undefined,
  };
}

/** Prepare a single saved unit for insertion without mutating the unit or project. */
export function prepareLibraryInsert(
  unit: UnitLibraryItem,
  current: PlanElement[],
  fileName: string,
): PreparedLibraryInsert {
  const source = unit.element;
  const prefix = TYPE_PREFIXES[source.type];
  if (!source.id.startsWith(prefix)) {
    throw new Error(`Cannot insert unit ${source.id}: its ID must start with ${prefix}`);
  }

  const occupied = new Set(current.map((element) => element.id));
  let id = source.id;
  let suffix = 2;
  while (occupied.has(id)) id = `${source.id}_${suffix++}`;

  const warnings: string[] = [];
  const remap = (reference: string | undefined) =>
    reference === source.id ? id : reference;
  const target = new Map(current.map((element) => [element.id, element]));
  const inserted = cloneLibraryElement(source);
  inserted.id = id;
  inserted.fileName = fileName;
  inserted.position = { x: 0, y: 0 };
  target.set(id, inserted);

  const resolveScalar = (
    label: string,
    value: string | undefined,
    allowed: (element: PlanElement) => boolean,
    absent: string | undefined,
  ): string | undefined => {
    if (!value || value === '-') return value;
    const candidate = remap(value)!;
    const found = target.get(candidate);
    if (found && allowed(found)) return candidate;
    warnings.push(`${label} reference "${value}" was cleared because its target is unavailable or has the wrong type.`);
    return absent;
  };

  inserted.parent = resolveScalar('parent', source.parent, (element) => element.type === 'system', '-') || '-';
  if (inserted.type === 'class') {
    inserted.extendsId = resolveScalar('extends', source.extendsId, (element) => element.type === 'class', '-');
    if (inserted.extendsId === id) {
      inserted.extendsId = '-';
      warnings.push('extends self-reference was cleared because it would create an inheritance cycle.');
    }
  }
  if (inserted.type === 'object') {
    inserted.instanceOf = resolveScalar('instance_of', source.instanceOf, (element) => element.type === 'class', '-');
  }
  if (inserted.components) {
    inserted.components = inserted.components.flatMap((reference) => {
      const candidate = remap(reference)!;
      const found = target.get(candidate);
      if (found && found.type === 'component') return [candidate];
      warnings.push(`has reference "${reference}" was removed because its component is unavailable.`);
      return [];
    });
  }
  if (inserted.uses) {
    inserted.uses = inserted.uses.flatMap((reference) => {
      const candidate = remap(reference)!;
      if (target.has(candidate)) return [candidate];
      warnings.push(`uses reference "${reference}" was removed because its target is unavailable.`);
      return [];
    });
  }
  if (inserted.notes) {
    inserted.notes = inserted.notes.flatMap((reference) => {
      if (reference === '-') return [reference];
      const candidate = remap(reference)!;
      if (target.has(candidate)) return [candidate];
      warnings.push(`notes reference "${reference}" was removed because its target is unavailable.`);
      return [];
    });
  }
  if (inserted.type === 'idea') {
    inserted.altTo = resolveScalar('alt_to', source.altTo, () => true, '-');
    inserted.originIdeaId = resolveScalar('origin', source.originIdeaId, (element) => element.type === 'idea', undefined);
  }

  const graph = buildAndValidateGraph([...current, inserted]);
  const insertedWarnings = graph.warnings.filter((warning) => warning.elementId === id);
  if (insertedWarnings.length) {
    throw new Error(`Cannot insert unit ${source.id}: ${insertedWarnings.map((warning) => warning.message).join('; ')}`);
  }
  return { element: inserted, warnings };
}

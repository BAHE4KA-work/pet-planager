import type { PlanElement } from '../types/planager.ts';
import { resolveInheritedFieldsForObject, TYPE_PREFIXES } from '../utils/pgrCodec.ts';

function rewriteReferences(element: PlanElement, map: Map<string, string>, allElements: PlanElement[] = []): PlanElement {
  const ref = (value: string | undefined) => value ? map.get(value) || value : value;
  const refs = (values: string[] | undefined) => values?.map((value) => ref(value) || value);
  const referenceValueFields = element.type === 'object'
    ? new Set(resolveInheritedFieldsForObject(element, allElements)
      .filter((field) => field.dataType === 'procedure' || allElements.some((candidate) => candidate.type === 'class' && candidate.id === field.dataType))
      .map((field) => field.fieldName))
    : new Set<string>();
  return {
    ...element,
    id: ref(element.id)!,
    parent: ref(element.parent) || '-',
    extendsId: ref(element.extendsId),
    instanceOf: ref(element.instanceOf),
    components: refs(element.components),
    uses: refs(element.uses),
    notes: refs(element.notes),
    altTo: ref(element.altTo),
    originIdeaId: ref(element.originIdeaId),
    fields: element.fields?.map((field) => ({ ...field, dataType: ref(field.dataType) || field.dataType })),
    values: element.values?.map((value) => referenceValueFields.has(value.fieldName)
      ? { ...value, value: ref(value.value) || value.value }
      : value),
  };
}

export function renameElementId(elements: PlanElement[], oldId: string, newId: string): PlanElement[] {
  if (!newId.trim()) throw new Error('Element ID cannot be empty');
  if (!elements.some((element) => element.id === oldId)) throw new Error(`Element does not exist: ${oldId}`);
  if (oldId !== newId && elements.some((element) => element.id === newId)) throw new Error(`Element ID already exists: ${newId}`);
  const source = elements.find((element) => element.id === oldId)!;
  if (!newId.startsWith(TYPE_PREFIXES[source.type])) throw new Error(`ID must start with ${TYPE_PREFIXES[source.type]}`);
  const map = new Map([[oldId, newId]]);
  return elements.map((element) => rewriteReferences(element, map, elements));
}

export function deleteElements(elements: PlanElement[], ids: string[]): PlanElement[] {
  const removed = new Set(ids);
  const referenceValueFields = new Map(elements
    .filter((element) => element.type === 'object')
    .map((element) => [element.id, new Set(resolveInheritedFieldsForObject(element, elements)
      .filter((field) => field.dataType === 'procedure' || elements.some((candidate) => candidate.type === 'class' && candidate.id === field.dataType))
      .map((field) => field.fieldName))]));
  return elements.filter((element) => !removed.has(element.id)).map((element) => ({
    ...element,
    parent: removed.has(element.parent) ? '-' : element.parent,
    extendsId: element.extendsId && removed.has(element.extendsId) ? '-' : element.extendsId,
    instanceOf: element.instanceOf && removed.has(element.instanceOf) ? '-' : element.instanceOf,
    components: element.components?.filter((id) => !removed.has(id)),
    uses: element.uses?.filter((id) => !removed.has(id)),
    notes: element.notes?.filter((id) => !removed.has(id)),
    altTo: element.altTo && removed.has(element.altTo) ? '-' : element.altTo,
    originIdeaId: element.originIdeaId && removed.has(element.originIdeaId) ? undefined : element.originIdeaId,
    values: element.values?.filter((value) => !referenceValueFields.get(element.id)?.has(value.fieldName) || !removed.has(value.value)),
  }));
}

export function moveElementsToFile(elements: PlanElement[], ids: string[], fileName: string): PlanElement[] {
  const moving = new Set(ids);
  return elements.map((element) => moving.has(element.id) ? { ...element, fileName } : element);
}

export function cloneElements(elements: PlanElement[], ids: string[], fileName?: string): PlanElement[] {
  const selected = elements.filter((element) => ids.includes(element.id));
  if (selected.length !== new Set(ids).size) throw new Error('One or more selected elements do not exist');
  const occupied = new Set(elements.map((element) => element.id));
  const mapping = new Map<string, string>();
  for (const element of selected) {
    let suffix = 1;
    let candidate = `${element.id}_copy`;
    while (occupied.has(candidate)) candidate = `${element.id}_copy${++suffix}`;
    occupied.add(candidate);
    mapping.set(element.id, candidate);
  }
  return selected.map((element) => {
    const clone = rewriteReferences(element, mapping, elements);
    return {
      ...clone,
      fileName: fileName || element.fileName,
      position: { x: element.position.x + 36, y: element.position.y + 36 },
      fields: element.fields?.map((field) => ({ ...field })),
      methods: element.methods?.map((method) => ({ ...method })),
      values: element.values?.map((value) => ({ ...value })),
      components: clone.components ? [...clone.components] : undefined,
      uses: clone.uses ? [...clone.uses] : undefined,
      steps: element.steps ? [...element.steps] : undefined,
      interfaceItems: element.interfaceItems ? [...element.interfaceItems] : undefined,
      internalLogic: element.internalLogic ? [...element.internalLogic] : undefined,
      notes: clone.notes ? [...clone.notes] : undefined,
    };
  });
}

export function renameFileElements(elements: PlanElement[], oldPath: string, newPath: string): PlanElement[] {
  if (oldPath === newPath) return elements;
  return elements.map((element) => element.fileName === oldPath ? { ...element, fileName: newPath } : element);
}

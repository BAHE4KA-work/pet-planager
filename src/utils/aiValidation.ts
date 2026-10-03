import type {
  AiContradiction,
  AiInterviewQuestion,
  AiProposalCard,
  ElementType,
  PlanElement,
} from '../types/planager';
import { buildAndValidateGraph } from './pgrCodec.ts';

const elementTypes: ElementType[] = ['system', 'class', 'process', 'component', 'object', 'idea'];
const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

export function parseAiJson(data: unknown): Record<string, unknown> {
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch { throw new Error('AI вернул некорректный JSON'); }
  }
  if (!isRecord(data)) throw new Error('AI вернул ответ неверной структуры');
  return data;
}

export function validateAiProposals(
  value: unknown,
  elements: PlanElement[],
  citations: string[],
  citationOwners?: ReadonlyMap<string, string>,
): AiProposalCard[] {
  if (!Array.isArray(value)) throw new Error('AI ответ: proposals должен быть массивом');
  const ids = new Set(elements.map((el) => el.id));
  return value.map((raw, index) => {
    if (!isRecord(raw) || !isText(raw.id) || !isText(raw.title) || !isText(raw.rationale) ||
      !['balance', 'new_element', 'rethink', 'polish'].includes(String(raw.category))) {
      throw new Error(`AI ответ: некорректное предложение #${index + 1}`);
    }
    if (raw.targetElementId !== undefined && (!isText(raw.targetElementId) || !ids.has(raw.targetElementId))) {
      throw new Error(`AI ответ: неизвестный targetElementId у предложения ${raw.id}`);
    }
    if (!isText(raw.fileCitation) || !citations.includes(raw.fileCitation)) {
      throw new Error(`AI ответ: отсутствует подтвержденная цитата у предложения ${raw.id}`);
    }
    if (raw.targetElementId && citationOwners && citationOwners.get(raw.fileCitation) !== raw.targetElementId) {
      throw new Error(`AI ответ: цитата предложения ${raw.id} не относится к целевому элементу`);
    }
    if (raw.suggestedElement !== undefined) {
      validateSuggestedElement(raw.suggestedElement, ids, elements);
      const suggested = raw.suggestedElement as Record<string, unknown>;
      const proposal = { ...suggested, fileName: '', status: 'черновик', mvp: false, position: { x: 0, y: 0 } } as unknown as PlanElement;
      const { id: _id, type: _type, title: _title, description: _description, parent: _parent, ...patch } = suggested;
      validateElementPatch(patch, proposal, elements);
      const graph = buildAndValidateGraph([...elements, proposal]);
      if (graph.edges.some((edge) => !edge.valid && edge.source === proposal.id) || graph.warnings.some((warning) => warning.elementId === proposal.id)) throw new Error(`AI ответ: suggestedElement ${proposal.id} содержит некорректные связи`);
      ids.add(String(suggested.id));
    }
    return raw as unknown as AiProposalCard;
  });
}

export function validateAiContradictions(
  value: unknown,
  elements: PlanElement[],
  citations: string[],
  citationOwners?: ReadonlyMap<string, string>,
): AiContradiction[] {
  if (!Array.isArray(value)) throw new Error('AI ответ: contradictions должен быть массивом');
  const ids = new Set(elements.map((el) => el.id));
  return value.map((raw, index) => {
    if (!isRecord(raw) || !isText(raw.id) || !isText(raw.title) || !isText(raw.description) ||
      !isText(raw.resolutionHint) || !['high', 'medium'].includes(String(raw.severity)) ||
      !Array.isArray(raw.elementIds) || raw.elementIds.some((id) => !isText(id) || !ids.has(id))) {
      throw new Error(`AI ответ: некорректное противоречие #${index + 1}`);
    }
    if (!isText(raw.fileCitation) || !citations.includes(raw.fileCitation)) {
      throw new Error(`AI ответ: отсутствует подтвержденная цитата у противоречия ${raw.id}`);
    }
    if (citationOwners && !raw.elementIds.some((id) => citationOwners.get(raw.fileCitation as string) === id)) {
      throw new Error(`AI ответ: цитата противоречия ${raw.id} не относится к затронутым элементам`);
    }
    if (raw.suggestedFix !== undefined) {
      const fix = raw.suggestedFix;
      if (!isRecord(fix) || !isText(fix.targetElementId) || !ids.has(fix.targetElementId) || !isText(fix.fixLabel)) {
        throw new Error(`AI ответ: некорректный suggestedFix у ${raw.id}`);
      }
      validateElementPatch(fix.patch, elements.find((el) => el.id === fix.targetElementId)!, elements);
    }
    return raw as unknown as AiContradiction;
  });
}

export function validateAiQuestions(value: unknown, elements: PlanElement[]): AiInterviewQuestion[] {
  if (!Array.isArray(value)) throw new Error('AI ответ: questions должен быть массивом');
  const ids = new Set(elements.map((el) => el.id));
  return value.map((raw, index) => {
    if (!isRecord(raw) || !isText(raw.id) || !isText(raw.question) || !isText(raw.weakSpotContext) ||
      !Array.isArray(raw.quickOptions) || raw.quickOptions.some((option) => !isText(option)) ||
      (raw.targetElementId !== undefined && (!isText(raw.targetElementId) || !ids.has(raw.targetElementId)))) {
      throw new Error(`AI ответ: некорректный вопрос #${index + 1}`);
    }
    return raw as unknown as AiInterviewQuestion;
  });
}

export function validateElementPatch(value: unknown, target: PlanElement, existing: PlanElement[]): Partial<PlanElement> {
  if (!isRecord(value)) throw new Error('AI ответ: patch должен быть объектом');
  const allowed = new Set(['title', 'description', 'parent', 'mvp', 'fields', 'methods', 'extendsId', 'components', 'uses', 'steps', 'interfaceItems', 'internalLogic', 'instanceOf', 'values', 'notes', 'altTo', 'altReason']);
  for (const [key, field] of Object.entries(value)) {
    if (!allowed.has(key)) throw new Error(`AI ответ: изменение поля ${key} запрещено`);
    if (['title', 'description', 'parent', 'extendsId', 'instanceOf', 'altTo', 'altReason'].includes(key) && typeof field !== 'string') throw new Error(`AI ответ: поле ${key} должно быть строкой`);
    if (key === 'mvp' && typeof field !== 'boolean') throw new Error('AI ответ: mvp должно быть boolean');
    if (['components', 'uses', 'steps', 'interfaceItems', 'internalLogic', 'notes'].includes(key) && (!Array.isArray(field) || field.some((item) => !isText(item)))) throw new Error(`AI ответ: ${key} должен быть массивом строк`);
    if (key === 'fields' && (!Array.isArray(field) || field.some((item) => !isRecord(item) || !isText(item.name) || !isText(item.dataType) || typeof item.description !== 'string'))) throw new Error('AI ответ: некорректные fields');
    if (key === 'methods' && (!Array.isArray(field) || field.some((item) => !isRecord(item) || !['+', '-'].includes(String(item.visibility)) || !isText(item.signature) || typeof item.description !== 'string'))) throw new Error('AI ответ: некорректные methods');
    if (key === 'values' && (!Array.isArray(field) || field.some((item) => !isRecord(item) || !isText(item.fieldName) || typeof item.value !== 'string'))) throw new Error('AI ответ: некорректные values');
  }
  const typeFields: Record<string, ElementType[]> = {
    fields: ['class'], methods: ['class'], extendsId: ['class'], steps: ['process'],
    interfaceItems: ['component'], internalLogic: ['component'], instanceOf: ['object'], values: ['object'], notes: ['idea'], altTo: ['idea'], altReason: ['idea'],
  };
  for (const key of Object.keys(value)) if (typeFields[key] && !typeFields[key].includes(target.type)) throw new Error(`AI ответ: ${key} не разрешен для ${target.type}`);
  const relationOwners: Record<string, ElementType[]> = { components: ['class', 'process', 'component', 'object'], uses: ['class', 'process'], notes: ['idea'] };
  for (const key of ['components', 'uses', 'notes']) {
    if (key in value && !relationOwners[key].includes(target.type)) {
      throw new Error(`AI ответ: ${key} не разрешен для ${target.type}`);
    }
  }
  for (const key of ['extendsId', 'instanceOf', 'altTo']) {
    if (!(key in value)) continue;
    const ref = String(value[key]);
    if (ref === '-') continue;
    const found = existing.find((el) => el.id === ref);
    const expectsClass = key === 'extendsId' || key === 'instanceOf';
    if (existing.length && (!found || (expectsClass && found.type !== 'class'))) throw new Error(`AI ответ: неверная ссылка ${ref} в ${key}`);
  }
  for (const key of ['components', 'uses', 'notes']) {
    if (!(key in value)) continue;
    for (const ref of value[key] as string[]) {
      const found = existing.find((el) => el.id === ref);
      if (existing.length && (!found || (key === 'components' && found.type !== 'component'))) throw new Error(`AI ответ: неверная ссылка ${ref} в ${key}`);
    }
  }
  const targetExists = existing.some((el) => el.id === target.id);
  const candidateGraph = targetExists
    ? existing.map((el) => el.id === target.id ? { ...el, ...value } as PlanElement : el)
    : [...existing, { ...target, ...value } as PlanElement];
  const graph = buildAndValidateGraph(candidateGraph);
  if (graph.edges.some((edge) => !edge.valid) || graph.warnings.length) throw new Error('AI ответ: patch создаёт структурно некорректный граф');
  return value as Partial<PlanElement>;
}

export function validateSuggestedElement(value: unknown, existingIds: Set<string>, elements: PlanElement[] = []): void {
  if (!isRecord(value) || !isText(value.id) || existingIds.has(value.id) || !elementTypes.includes(value.type as ElementType) ||
    !isText(value.title) || !isText(value.description) || typeof value.parent !== 'string') throw new Error('AI ответ: некорректный suggestedElement');
  if (value.components !== undefined && (!Array.isArray(value.components) || value.components.some((id) => !isText(id)))) throw new Error(`AI ответ: некорректные components у ${value.id}`);
  if (value.uses !== undefined && (!Array.isArray(value.uses) || value.uses.some((id) => !isText(id)))) throw new Error(`AI ответ: некорректные uses у ${value.id}`);
  if (value.parent !== '-' && elements.length && elements.find((el) => el.id === value.parent)?.type !== 'system') throw new Error(`AI ответ: неверный parent ${value.parent} в ${value.id}`);
  for (const [key, expected] of [['components', 'component']] as const) {
    for (const id of (value[key] as string[] | undefined) || []) if (elements.length && elements.find((el) => el.id === id)?.type !== expected) throw new Error(`AI ответ: ссылка ${id} в ${value.id} должна указывать на ${expected}`);
  }
  for (const id of (value.uses as string[] | undefined) || []) if (elements.length && !existingIds.has(id)) throw new Error(`AI ответ: ссылка ${id} в ${value.id} неизвестна`);
}

export function validateTransformedElements(value: unknown, source: PlanElement, existing: PlanElement[]): PlanElement[] {
  if (!Array.isArray(value)) throw new Error('AI ответ: createdElements должен быть массивом');
  const graphElements = existing.some((element) => element.id === source.id) ? existing : [...existing, source];
  const ids = new Set(graphElements.map((el) => el.id));
  const list = value.map((raw) => {
    validateSuggestedElement(raw, ids);
    const item = raw as Record<string, unknown>;
    if (ids.has(String(item.id))) throw new Error(`AI ответ: дублирующийся ID ${item.id}`);
    ids.add(String(item.id));
    const type = item.type as ElementType;
    const position = item.position;
    if (position !== undefined && (!isRecord(position) || typeof position.x !== 'number' || typeof position.y !== 'number')) throw new Error(`AI ответ: некорректная position у ${item.id}`);
    const element = { ...item, fileName: source.fileName, status: 'черновик', mvp: typeof item.mvp === 'boolean' ? item.mvp : source.mvp,
      originIdeaId: source.type === 'idea' ? source.id : source.originIdeaId || source.id,
      position: position || { x: source.position.x + 260, y: source.position.y },
    } as unknown as PlanElement;
    return element;
  });
  const byId = new Map(graphElements.map((el) => [el.id, el]));
  list.forEach((el) => byId.set(el.id, el));
  for (const el of list) {
    const item = value.find((raw) => isRecord(raw) && raw.id === el.id) as Record<string, unknown>;
    const { id: _id, type: _type, title: _title, description: _description, parent: _parent, ...patch } = item;
    validateElementPatch(patch, el, [...graphElements, ...list]);
    if (el.type === 'system' ? el.parent !== '-' : el.parent !== '-' && byId.get(el.parent)?.type !== 'system') {
      throw new Error(`AI ответ: неверный parent ${el.parent} в ${el.id}`);
    }
    if (el.extendsId && el.extendsId !== '-' && byId.get(el.extendsId)?.type !== 'class') throw new Error(`AI ответ: extends ${el.extendsId} в ${el.id} не указывает на класс`);
    if (el.instanceOf && el.instanceOf !== '-' && byId.get(el.instanceOf)?.type !== 'class') throw new Error(`AI ответ: instanceOf ${el.instanceOf} в ${el.id} не указывает на класс`);
    for (const componentId of el.components || []) if (byId.get(componentId)?.type !== 'component') throw new Error(`AI ответ: component ${componentId} в ${el.id} неизвестен или неверного типа`);
    const references = [...(el.components || []), ...(el.uses || []), ...(el.notes || []), ...(el.extendsId && el.extendsId !== '-' ? [el.extendsId] : []), ...(el.instanceOf && el.instanceOf !== '-' ? [el.instanceOf] : [])];
    for (const reference of references) if (!ids.has(reference)) throw new Error(`AI ответ: ссылка ${reference} в ${el.id} неизвестна`);
  }
  const graph = buildAndValidateGraph([...graphElements, ...list]);
  const invalid = graph.edges.find((edge) => !edge.valid && list.some((el) => el.id === edge.source));
  if (invalid) throw new Error(`AI ответ: некорректная связь ${invalid.relation} ${invalid.source} -> ${invalid.target}`);
  if (graph.warnings.some((warning) => list.some((el) => el.id === warning.elementId))) throw new Error('AI ответ: преобразование содержит структурно некорректный граф');
  return list;
}

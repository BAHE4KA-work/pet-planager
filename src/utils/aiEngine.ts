import {
  AiContradiction,
  AiInterviewQuestion,
  AiProposalCard,
  AiProviderConfig,
  GitCommit,
  PlanElement,
  UnitLibraryItem,
} from '../types/planager';
import { buildAndValidateGraph, serializeFileWithRanges } from './pgrCodec';

export function buildRagIndex(elements: PlanElement[], files: string[]) {
  const index: {
    elementId: string;
    title: string;
    type: string;
    fileName: string;
    startLine: number;
    endLine: number;
    citation: string;
    snippet: string;
  }[] = [];

  for (const fileName of files) {
    const { ranges } = serializeFileWithRanges(elements, fileName);
    for (const r of ranges) {
      const el = elements.find((e) => e.id === r.elementId);
      if (!el) continue;
      index.push({
        elementId: el.id,
        title: el.title,
        type: el.type,
        fileName,
        startLine: r.startLine,
        endLine: r.endLine,
        citation: `${fileName}:${r.startLine}-${r.endLine}`,
        snippet: r.rawText,
      });
    }
  }
  return index;
}

/**
 * Dynamic, non-mocked static AST/schema verifier that inspects any .pgr graph
 * for inheritance type mismatches, broken references, and structural conflicts.
 */
export function inspectGraphSchemaIssues(
  elements: PlanElement[],
  files: string[]
): AiContradiction[] {
  const rag = buildRagIndex(elements, files);
  const findCitation = (id: string) =>
    rag.find((r) => r.elementId === id)?.citation || `${files[0] || 'plan.pgr'}:1-10`;

  const byId = new Map<string, PlanElement>();
  elements.forEach((e) => byId.set(e.id, e));
  const issues: AiContradiction[] = [];

  // 1. Check all class inheritance chains for incompatible field dataType overrides
  for (const el of elements) {
    if (el.type === 'class' && el.extendsId && el.extendsId !== '-') {
      const parentCls = byId.get(el.extendsId);
      if (parentCls && parentCls.type === 'class') {
        for (const childField of el.fields || []) {
          const baseField = (parentCls.fields || []).find(
            (f) => f.name === childField.name
          );
          if (baseField && baseField.dataType !== childField.dataType) {
            const affectedInstances = elements
              .filter(
                (o) =>
                  o.type === 'object' &&
                  (o.instanceOf === parentCls.id || o.instanceOf === el.id)
              )
              .map((o) => o.id);
            issues.push({
              id: `schema_type_${parentCls.id}_${el.id}_${childField.name}`,
              severity: 'high',
              title: `Несовпадение типа поля ${childField.name}: ${parentCls.id} (${baseField.dataType}) и ${el.id} (${childField.dataType})`,
              description: `В базовом классе ${parentCls.id} поле «${childField.name}» объявлено с типом ${baseField.dataType}, а в дочернем классе ${el.id} (extends: ${parentCls.id}) переопределено с типом ${childField.dataType}.`,
              elementIds: [parentCls.id, el.id, ...affectedInstances],
              fileCitation: findCitation(el.id),
              resolutionHint: `Привести тип поля ${childField.name} в ${el.id} к ${baseField.dataType} или удалить дублирующее переопределение.`,
              suggestedFix: {
                targetElementId: el.id,
                patch: {
                  fields: (el.fields || []).filter(
                    (f) => f.name !== childField.name
                  ),
                },
                fixLabel: `Убрать конфликтующее переопределение ${childField.name} в ${el.id}`,
              },
            });
          }
        }
      }
    }
  }

  // 2. Check graph validation warnings (broken links, cycles)
  const { warnings } = buildAndValidateGraph(elements);
  warnings.forEach((w, idx) => {
    const targetEl = byId.get(w.elementId);
    if (!targetEl) return;
    issues.push({
      id: `schema_warn_${w.elementId}_${idx}`,
      severity: 'medium',
      title: `Нарушение ссылочной целостности в ${w.elementId}`,
      description: w.message,
      elementIds: [w.elementId],
      fileCitation: findCitation(w.elementId),
      resolutionHint: `Исправить некорректную ссылку в свойствах элемента ${w.elementId}.`,
    });
  });

  return issues;
}

export async function fetchAiAnalysis(params: {
  elements: PlanElement[];
  selectedIds: string[];
  files: string[];
  aiConfig: AiProviderConfig;
  customGoal?: string;
}): Promise<{
  proposals: AiProposalCard[];
  contradictions: AiContradiction[];
  providerUsed: string;
  modelUsed: string;
  error?: string;
}> {
  const { elements, selectedIds, files, aiConfig, customGoal } = params;
  const rag = buildRagIndex(elements, files);
  const selectedElements =
    selectedIds.length > 0
      ? elements.filter((e) => selectedIds.includes(e.id))
      : elements;

  const response = await fetch('/api/ai/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      selectedElements,
      allElements: elements,
      fileSnippets: rag,
      customGoal,
      aiConfig,
    }),
  });

  const payload = await response.json();
  if (!response.ok || payload.error) {
    throw new Error(payload.error || `Ошибка HTTP ${response.status}`);
  }

  const schemaIssues = inspectGraphSchemaIssues(elements, files);
  const aiContradictions: AiContradiction[] = Array.isArray(
    payload.data?.contradictions
  )
    ? payload.data.contradictions
    : [];

  // Merge deterministic schema issues with AI-discovered contradictions without duplicates
  const mergedContradictions: AiContradiction[] = [...aiContradictions];
  for (const issue of schemaIssues) {
    const alreadyCovered = mergedContradictions.some(
      (c) =>
        c.id === issue.id ||
        (issue.elementIds.length >= 2 &&
          issue.elementIds
            .slice(0, 2)
            .every((eid) => c.elementIds?.includes(eid)))
    );
    if (!alreadyCovered) {
      mergedContradictions.push(issue);
    }
  }

  return {
    proposals: Array.isArray(payload.data?.proposals)
      ? payload.data.proposals
      : [],
    contradictions: mergedContradictions,
    providerUsed: payload.providerUsed || aiConfig.provider,
    modelUsed:
      payload.modelUsed ||
      (aiConfig.provider === 'gemini'
        ? aiConfig.geminiModel
        : aiConfig.customModel),
  };
}

export async function fetchAiInterview(params: {
  elements: PlanElement[];
  selectedIds: string[];
  files: string[];
  userAnswers?: { question: string; answer: string; targetElementId?: string }[];
  aiConfig: AiProviderConfig;
}): Promise<{
  questions: AiInterviewQuestion[];
}> {
  const { elements, selectedIds, files, userAnswers, aiConfig } = params;
  const rag = buildRagIndex(elements, files);
  const selectedElements =
    selectedIds.length > 0
      ? elements.filter((e) => selectedIds.includes(e.id))
      : elements;

  const response = await fetch('/api/ai/interview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      selectedElements,
      allElements: elements,
      fileSnippets: rag,
      userAnswers: userAnswers || [],
      aiConfig,
    }),
  });

  const payload = await response.json();
  if (!response.ok || payload.error) {
    throw new Error(payload.error || `Ошибка HTTP ${response.status}`);
  }

  return {
    questions: Array.isArray(payload.data?.questions)
      ? payload.data.questions
      : [],
  };
}

export async function fetchAiApplyInterviewAnswer(params: {
  targetElement: PlanElement;
  question: string;
  answer: string;
  aiConfig: AiProviderConfig;
}): Promise<{
  updatedElement: Partial<PlanElement>;
  summary: string;
}> {
  const response = await fetch('/api/ai/interview-answer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  const payload = await response.json();
  if (!response.ok || payload.error) {
    throw new Error(payload.error || `Ошибка HTTP ${response.status}`);
  }

  return {
    updatedElement: payload.data?.updatedElement || {},
    summary: payload.data?.summary || 'Изменения применены к элементу',
  };
}

export async function fetchAiTransformation(params: {
  sourceElement: PlanElement;
  targetPattern: 'system_pack' | 'class_hierarchy' | 'process_chain';
  existingElements: PlanElement[];
  aiConfig: AiProviderConfig;
}): Promise<{
  summary: string;
  createdElements: PlanElement[];
}> {
  const { sourceElement, targetPattern, existingElements, aiConfig } = params;
  const response = await fetch('/api/ai/transform', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sourceElement,
      targetPattern,
      existingElements,
      aiConfig,
    }),
  });

  const payload = await response.json();
  if (!response.ok || payload.error) {
    throw new Error(payload.error || `Ошибка HTTP ${response.status}`);
  }

  const baseX = sourceElement.position.x + 260;
  const baseY = sourceElement.position.y;
  const rawCreated: any[] = Array.isArray(payload.data?.createdElements)
    ? payload.data.createdElements
    : [];

  const createdElements: PlanElement[] = rawCreated.map((item, idx) => ({
    id: item.id || `cls_gen_${idx + 1}`,
    type: item.type || 'class',
    title: item.title || item.id || 'Новый элемент',
    fileName: item.fileName || sourceElement.fileName,
    parent:
      item.type === 'system'
        ? '-'
        : item.parent ||
          (sourceElement.type === 'system'
            ? sourceElement.id
            : sourceElement.parent || '-'),
    description: item.description || `Создано из ${sourceElement.id}`,
    status: 'черновик',
    mvp: item.mvp ?? sourceElement.mvp,
    originIdeaId: sourceElement.id,
    position: {
      x: baseX + (idx % 2) * 260,
      y: baseY + Math.floor(idx / 2) * 150,
    },
    extendsId: item.type === 'class' ? item.extendsId || '-' : undefined,
    fields: item.type === 'class' ? item.fields || [] : undefined,
    methods: item.type === 'class' ? item.methods || [] : undefined,
    steps: item.type === 'process' ? item.steps || [] : undefined,
    interfaceItems:
      item.type === 'component' ? item.interfaceItems || [] : undefined,
    internalLogic:
      item.type === 'component' ? item.internalLogic || [] : undefined,
    components: Array.isArray(item.components) ? item.components : [],
    uses: Array.isArray(item.uses) ? item.uses : [],
    instanceOf: item.type === 'object' ? item.instanceOf || '-' : undefined,
    values: item.type === 'object' ? item.values || [] : undefined,
  }));

  return {
    summary:
      payload.data?.summary ||
      `Элемент ${sourceElement.id} развёрнут через ИИ (${createdElements.length} новых блок.)`,
    createdElements,
  };
}

export function generateLocalAnalysis(
  elements: PlanElement[],
  selectedIds: string[],
  files: string[]
): {
  proposals: AiProposalCard[];
  contradictions: AiContradiction[];
} {
  const contradictions = inspectGraphSchemaIssues(elements, files);
  const selected = elements.filter((e) => selectedIds.includes(e.id));
  const proposals: AiProposalCard[] = [];

  for (const el of selected) {
    if (el.type === 'idea') {
      proposals.push({
        id: `prop_idea_${el.id}`,
        category: 'rethink',
        title: `Развернуть идею «${el.title}» в класс или компонент`,
        rationale: `Идея ${el.id} может быть детализирована в конкретную реализацию.`,
        targetElementId: el.id,
        fileCitation: `${el.fileName}:1-20`,
        suggestedElement: {
          id: `cls_${el.id.replace('idea_', '')}`,
          type: 'class',
          title: `Класс ${el.title}`,
          parent: el.parent || '-',
          description: `Класс, созданный из идеи ${el.id}`,
        },
      });
    }
  }

  return { proposals, contradictions };
}

export function generateLocalInterviewQuestions(
  elements: PlanElement[],
  selectedIds: string[]
): AiInterviewQuestion[] {
  const selected = elements.filter((e) => selectedIds.includes(e.id));
  const questions: AiInterviewQuestion[] = [];

  for (const el of selected) {
    if (el.type === 'class') {
      questions.push({
        id: `q_class_${el.id}`,
        targetElementId: el.id,
        question: `Каковы основные методы и инварианты для класса ${el.title} (${el.id})?`,
        weakSpotContext: `Класс: ${el.id}, родитель: ${el.parent || '-'}`,
        quickOptions: [
          'Добавить CRUD методы',
          'Сделать неизменяемым объектом (Value Object)',
          'Определить обработчик событий',
        ],
      });
    } else if (el.type === 'system') {
      questions.push({
        id: `q_sys_${el.id}`,
        targetElementId: el.id,
        question: `Какие подсистемы и зависимости входят в периметр системы ${el.title}?`,
        weakSpotContext: `Система: ${el.id}`,
        quickOptions: ['Модульная архитектура', 'Микросервисы', 'Монолитный модуль'],
      });
    }
  }

  if (questions.length === 0 && elements.length > 0) {
    const first = elements[0];
    questions.push({
      id: `q_general_${first.id}`,
      targetElementId: first.id,
      question: `Нужен ли элемент ${first.title} в первой версии (MVP)?`,
      weakSpotContext: `Элемент: ${first.id} [${first.type}]`,
      quickOptions: ['Да, обязательно для MVP', 'Нет, перенести в бэклог'],
    });
  }

  return questions;
}

export function generateLocalTransformation(
  sourceElement: PlanElement,
  targetPattern: 'system_pack' | 'class_hierarchy' | 'process_chain'
): {
  summary: string;
  createdElements: PlanElement[];
} {
  const baseX = sourceElement.position.x + 240;
  const baseY = sourceElement.position.y;
  const baseId = sourceElement.id.replace(/^(idea|sys|cls|obj)_/, '');

  if (targetPattern === 'class_hierarchy') {
    const baseClass: PlanElement = {
      id: `cls_${baseId}_base`,
      type: 'class',
      title: `${sourceElement.title} (Базовый)`,
      fileName: sourceElement.fileName,
      parent: sourceElement.parent || '-',
      description: `Базовый класс из идеи ${sourceElement.id}`,
      status: 'черновик',
      mvp: sourceElement.mvp,
      originIdeaId: sourceElement.id,
      position: { x: baseX, y: baseY },
      fields: [{ name: 'id', dataType: 'string', description: 'UID' }],
      methods: [{ visibility: '+', signature: 'init(): void', description: 'Инициализация' }],
    };
    return {
      summary: `Сформирована иерархия классов для ${sourceElement.id}`,
      createdElements: [baseClass],
    };
  }

  const sysEl: PlanElement = {
    id: `sys_${baseId}`,
    type: 'system',
    title: `Система ${sourceElement.title}`,
    fileName: sourceElement.fileName,
    parent: '-',
    description: `Система, развернутая из идеи ${sourceElement.id}`,
    status: 'черновик',
    mvp: sourceElement.mvp,
    originIdeaId: sourceElement.id,
    position: { x: baseX, y: baseY },
  };

  return {
    summary: `Развернут системный пакет для ${sourceElement.id}`,
    createdElements: [sysEl],
  };
}

export async function testAiConnection(
  aiConfig: AiProviderConfig
): Promise<{
  ok: boolean;
  latencyMs?: number;
  providerUsed?: string;
  modelUsed?: string;
  message?: string;
  error?: string;
}> {
  try {
    const res = await fetch('/api/ai/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ aiConfig }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      return {
        ok: false,
        error: data.error || `Ошибка HTTP ${res.status}`,
      };
    }
    return data;
  } catch (err: any) {
    return {
      ok: false,
      error: err?.message || 'Ошибка соединения с сервером',
    };
  }
}

export interface WorkspaceStatePayload {
  files: string[];
  elements: PlanElement[];
  userPositionedNodeIds: string[];
  unitLibrary: UnitLibraryItem[];
  commits: GitCommit[];
}

export async function loadWorkspaceFromServer(): Promise<WorkspaceStatePayload | null> {
  try {
    const res = await fetch('/api/workspace');
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function syncWorkspaceToServer(
  payload: WorkspaceStatePayload
): Promise<boolean> {
  try {
    const res = await fetch('/api/workspace/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function createServerCommit(params: {
  message: string;
  author?: string;
  files: string[];
  elements: PlanElement[];
}): Promise<GitCommit | null> {
  try {
    const res = await fetch('/api/workspace/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.commit || null;
  } catch {
    return null;
  }
}

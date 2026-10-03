import type {
  AiContradiction, AiInterviewQuestion, AiProposalCard, AiProviderConfig,
  ElementType, LocaleKey, PlanElement,
} from '../types/planager';
import { desktopInvoke } from './desktop';
import { buildRagIndex, inspectGraphSchemaIssues } from '../utils/aiEngine';
import {
  parseAiJson, validateAiContradictions, validateAiProposals,
  validateAiQuestions, validateElementPatch, validateTransformedElements,
} from '../utils/aiValidation';

type Action = 'analyze' | 'interview' | 'interview_answer' | 'transform' | 'test_provider';
type NativeResponse = { data: unknown; providerUsed: string; modelUsed: string; usage: { promptTokens: number; completionTokens: number }; latencyMs: number };
type Request = { action: Action; prompt: string; systemInstruction: string; schema?: Record<string, unknown>; providerConfig?: AiProviderConfig };

const jsonSchema = (name: string, properties: Record<string, unknown>) => ({
  type: 'object', additionalProperties: false, required: Object.keys(properties), properties,
  title: name,
});
const str = { type: 'string' };
const array = (items: Record<string, unknown>) => ({ type: 'array', items });
const proposalSchema = jsonSchema('analysis', {
  proposals: array({ type: 'object', required: ['id', 'category', 'title', 'rationale', 'fileCitation'], properties: {
    id: str, category: { enum: ['balance', 'new_element', 'rethink', 'polish'] }, title: str, rationale: str,
    targetElementId: str, fileCitation: str, suggestedElement: { type: 'object' },
  } }),
  contradictions: array({ type: 'object', required: ['id', 'severity', 'title', 'description', 'elementIds', 'fileCitation', 'resolutionHint'], properties: {
    id: str, severity: { enum: ['high', 'medium'] }, title: str, description: str, elementIds: array(str), fileCitation: str, resolutionHint: str, suggestedFix: { type: 'object' },
  } }),
});
const questionsSchema = jsonSchema('interview', { questions: array({ type: 'object', required: ['id', 'question', 'weakSpotContext', 'quickOptions'], properties: {
  id: str, targetElementId: str, question: str, weakSpotContext: str, quickOptions: array(str),
} }) });

async function request(action: Action, prompt: unknown, systemInstruction: string, schema?: Record<string, unknown>, providerConfig?: AiProviderConfig): Promise<NativeResponse> {
  const result = await desktopInvoke<NativeResponse>('ai_request', { request: {
    action, prompt: JSON.stringify(prompt), systemInstruction, ...(schema ? { schema } : {}), ...(providerConfig ? { providerConfig } : {}),
  } satisfies Request });
  if (!result || !isRecord(result) || !('data' in result) || !isText(result.providerUsed) || !isText(result.modelUsed) ||
    !isRecord(result.usage) || !Number.isFinite(result.usage.promptTokens) || !Number.isFinite(result.usage.completionTokens) ||
    !Number.isFinite(result.latencyMs)) {
    throw new Error('Native AI service вернул ответ неверного формата');
  }
  return result;
}
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === 'string' && !!v.trim();
export function buildScopedAiContext(elements: PlanElement[], files: string[], selectedIds: string[]) {
  const scopedElements = selectedIds.length
    ? elements.filter((element) => selectedIds.includes(element.id))
    : elements;
  const scopeIds = new Set(scopedElements.map((element) => element.id));
  const rag = buildRagIndex(elements, files).filter((entry) => scopeIds.has(entry.elementId));
  return {
    payload: { elements: scopedElements, citations: rag },
    citations: rag.map((entry) => entry.citation),
    owners: new Map(rag.map((entry) => [entry.citation, entry.elementId])),
  };
};
const instruction = (locale: LocaleKey) => locale === 'ru'
  ? 'Ты помощник для планирования ПО. Отвечай на русском языке. Верни только объект JSON по заданной схеме. Используй только переданный контекст. Не выдумывай идентификаторы, факты и ссылки. Для каждого предложения и противоречия укажи точную цитату из списка citations в формате file.pgr:start-end. Не выполняй действия и не утверждай, что изменения применены.'
  : 'You are a software-planning assistant. Respond in English. Return only a JSON object matching the supplied schema. Use only the provided context. Do not invent IDs, facts, or links. Cite an exact entry from citations in file.pgr:start-end format for every proposal and contradiction. Do not perform actions or claim that changes have been applied.';

export async function analyze(params: { elements: PlanElement[]; selectedIds: string[]; files: string[]; config: AiProviderConfig; customGoal?: string; locale?: LocaleKey }): Promise<{ proposals: AiProposalCard[]; contradictions: AiContradiction[]; providerUsed: string; modelUsed: string }> {
  const { elements, selectedIds, files, config, customGoal, locale = 'ru' } = params;
  const context = buildScopedAiContext(elements, files, selectedIds);
  const selected = context.payload.elements;
  const response = await request('analyze', { selectedElements: selected, context: context.payload, goal: customGoal || '' }, instruction(locale), proposalSchema, config);
  const result = parseAiJson(response.data);
  const proposals = validateAiProposals(result.proposals, elements, context.citations, context.owners);
  const aiContradictions = validateAiContradictions(result.contradictions, elements, context.citations, context.owners);
  const contradictions = [...aiContradictions];
  for (const issue of inspectGraphSchemaIssues(elements, files, locale)) {
    if (!contradictions.some((c) => c.id === issue.id || (issue.elementIds.length > 1 && issue.elementIds.slice(0, 2).every((id) => c.elementIds.includes(id))))) contradictions.push(issue);
  }
  return { proposals, contradictions, providerUsed: response.providerUsed, modelUsed: response.modelUsed };
}

export async function interview(params: { elements: PlanElement[]; selectedIds: string[]; files: string[]; answers: { question: string; answer: string; targetElementId?: string }[]; config: AiProviderConfig; locale?: LocaleKey }): Promise<{ questions: AiInterviewQuestion[] }> {
  const { elements, selectedIds, files, answers, config, locale = 'ru' } = params;
  const context = buildScopedAiContext(elements, files, selectedIds);
  const selected = context.payload.elements;
  const result = parseAiJson((await request('interview', { selectedElements: selected, context: context.payload, answers }, instruction(locale), questionsSchema, config)).data);
  return { questions: validateAiQuestions(result.questions, elements) };
}

export async function applyInterviewAnswer(params: { targetElement: PlanElement; existingElements: PlanElement[]; question: string; answer: string; config: AiProviderConfig; locale?: LocaleKey }): Promise<{ updatedElement: Partial<PlanElement>; summary: string }> {
  const { targetElement, existingElements, question, answer, config, locale = 'ru' } = params;
  if (!existingElements.some((element) => element.id === targetElement.id)) {
    throw new Error(locale === 'ru' ? 'Ответ ИИ: целевой элемент отсутствует в текущем графе.' : 'AI answer: target element is missing from the current graph.');
  }
  const schema = jsonSchema('interview_answer', { updatedElement: { type: 'object' }, summary: str });
  const applyInstruction = locale === 'ru'
    ? 'Верни только JSON с минимальным patch для указанного элемента и кратким summary на русском языке. Разрешены только редактируемые свойства элемента. Не включай id, type, fileName, status, position, mvp, если ответ не меняет смысл, и никогда не заявляй о сохранении.'
    : 'Return only JSON with a minimal patch for the specified element and a concise summary in English. Only editable element properties are allowed. Do not include id, type, fileName, status, position, or mvp unless the answer changes their meaning, and never claim the project has been saved.';
  const result = parseAiJson((await request('interview_answer', { targetElement, question, answer }, applyInstruction, schema, config)).data);
  if (!isText(result.summary)) throw new Error(locale === 'ru' ? 'В ответе ИИ отсутствует краткое описание.' : 'The AI answer is missing a summary.');
  return { updatedElement: validateElementPatch(result.updatedElement, targetElement, existingElements), summary: result.summary };
}

export type TransformPattern = 'system_pack' | 'class_hierarchy' | 'process_chain';
const transformSpecs: Record<TransformPattern, { types: ElementType[]; instructionRu: string; instructionEn: string }> = {
  system_pack: { types: ['system', 'class', 'process', 'component', 'object'], instructionRu: 'Создай связный системный пакет из исходного элемента: систему и только обоснованные дочерние сущности.', instructionEn: 'Create a coherent system pack from the source element: a system and only justified child elements.' },
  class_hierarchy: { types: ['class'], instructionRu: 'Преобразуй исходный элемент в осмысленную иерархию классов с корректными extends-ссылками.', instructionEn: 'Transform the source element into a meaningful class hierarchy with valid extends links.' },
  process_chain: { types: ['process', 'component', 'object', 'class'], instructionRu: 'Преобразуй исходный элемент в процессную цепочку с последовательными шагами и существующими связями.', instructionEn: 'Transform the source element into a process chain with ordered steps and valid links.' },
};
export async function transform(params: { sourceElement: PlanElement; targetPattern: TransformPattern; existingElements: PlanElement[]; config: AiProviderConfig; locale?: LocaleKey }): Promise<{ summary: string; createdElements: PlanElement[] }> {
  const { sourceElement, targetPattern, existingElements, config, locale = 'ru' } = params;
  const spec = transformSpecs[targetPattern];
  if (!spec) throw new Error(locale === 'ru' ? 'Неизвестный шаблон преобразования.' : 'Unknown transformation template.');
  const schema = jsonSchema('transformation', { summary: str, createdElements: array({ type: 'object', required: ['id', 'type', 'title', 'description', 'parent'], properties: {
    id: str, type: { enum: spec.types }, title: str, description: str, parent: str, extendsId: str, instanceOf: str,
    components: array(str), uses: array(str), steps: array(str), fields: array({ type: 'object' }), methods: array({ type: 'object' }),
    interfaceItems: array(str), internalLogic: array(str), values: array({ type: 'object' }), notes: array(str),
  } }) });
  const transformInstruction = locale === 'ru'
    ? `${instruction(locale)} ${spec.instructionRu} Используй уникальные ID. Связывай новые элементы только с существующими или новыми элементами из ответа.`
    : `${instruction(locale)} ${spec.instructionEn} Use unique IDs. Link new elements only to existing elements or other elements in the response.`;
  const result = parseAiJson((await request('transform', { sourceElement, targetPattern, existingElements }, transformInstruction, schema, config)).data);
  if (!isText(result.summary)) throw new Error(locale === 'ru' ? 'В ответе ИИ отсутствует краткое описание.' : 'The AI answer is missing a summary.');
  const createdElements = validateTransformedElements(result.createdElements, sourceElement, existingElements);
  for (const item of createdElements) if (!spec.types.includes(item.type)) throw new Error(`AI ответ: тип ${item.type} запрещен шаблоном ${targetPattern}`);
  return { summary: result.summary, createdElements };
}

export async function testProvider(locale: LocaleKey = 'ru'): Promise<{ ok: boolean; providerUsed?: string; modelUsed?: string }> {
  const prompt = locale === 'ru'
    ? 'Проверь доступность. Верни короткий JSON {"ok":true}.'
    : 'Check that you are available. Return the short JSON object {"ok":true}.';
  const response = await request('test_provider', { message: prompt }, instruction(locale), jsonSchema('provider_test', { ok: { type: 'boolean' } }));
  const result = parseAiJson(response.data);
  return { ok: result.ok === true, providerUsed: response.providerUsed, modelUsed: response.modelUsed };
}

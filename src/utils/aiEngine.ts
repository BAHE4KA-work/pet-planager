import type { AiContradiction, LocaleKey, PlanElement } from '../types/planager';
import { buildAndValidateGraph, serializeFileWithRanges } from './pgrCodec.ts';

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
  files: string[],
  locale: LocaleKey = 'ru'
): AiContradiction[] {
  const rag = buildRagIndex(elements, files);
  const findCitation = (id: string) =>
    rag.find((r) => r.elementId === id)?.citation;

  const byId = new Map<string, PlanElement>();
  elements.forEach((e) => byId.set(e.id, e));
  const issues: AiContradiction[] = [];

  const tx = (ru: string, en: string) => locale === 'ru' ? ru : en;

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
              title: tx(
                `Несовпадение типа поля ${childField.name}: ${parentCls.id} (${baseField.dataType}) и ${el.id} (${childField.dataType})`,
                `Field type mismatch for ${childField.name}: ${parentCls.id} (${baseField.dataType}) and ${el.id} (${childField.dataType})`
              ),
              description: tx(
                `В базовом классе ${parentCls.id} поле «${childField.name}» объявлено с типом ${baseField.dataType}, а в дочернем классе ${el.id} (extends: ${parentCls.id}) переопределено с типом ${childField.dataType}.`,
                `Field ${childField.name} is declared as ${baseField.dataType} in base class ${parentCls.id}, but overridden as ${childField.dataType} in child class ${el.id} (extends: ${parentCls.id}).`
              ),
              elementIds: [parentCls.id, el.id, ...affectedInstances],
              fileCitation: findCitation(el.id),
              resolutionHint: tx(
                `Привести тип поля ${childField.name} в ${el.id} к ${baseField.dataType} или удалить дублирующее переопределение.`,
                `Change ${childField.name} in ${el.id} to ${baseField.dataType}, or remove the duplicate override.`
              ),
              suggestedFix: {
                targetElementId: el.id,
                patch: {
                  fields: (el.fields || []).filter(
                    (f) => f.name !== childField.name
                  ),
                },
                fixLabel: tx(
                  `Убрать конфликтующее переопределение ${childField.name} в ${el.id}`,
                  `Remove conflicting ${childField.name} override from ${el.id}`
                ),
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
      title: tx(
        `Нарушение ссылочной целостности в ${w.elementId}`,
        `Broken reference in ${w.elementId}`
      ),
      description: localizeGraphWarning(w.message, locale),
      elementIds: [w.elementId],
      fileCitation: findCitation(w.elementId),
      resolutionHint: tx(
        `Исправить некорректную ссылку в свойствах элемента ${w.elementId}.`,
        `Correct the invalid reference in ${w.elementId}.`
      ),
    });
  });

  return issues;
}

function localizeGraphWarning(message: string, locale: LocaleKey): string {
  if (locale === 'ru') return message;
  const patterns: [RegExp, (match: RegExpMatchArray) => string][] = [
    [/^Дублирующийся ID элемента (.+)$/, (m) => `Duplicate element ID ${m[1]}.`],
    [/^alt_to ссылается на неизвестный элемент (.+)$/, (m) => `alt_to references unknown element ${m[1]}.`],
    [/^origin ссылается на неизвестную идею (.+)$/, (m) => `origin references unknown idea ${m[1]}.`],
    [/^Некорректный parent: (.+) \(ожидается существующая Система sys_\*\)$/, (m) => `Invalid parent ${m[1]}; expected an existing system (sys_*).`],
    [/^Цикл наследования в extends у класса (.+)$/, (m) => `Inheritance cycle in extends for class ${m[1]}.`],
    [/^extends ссылается на несуществующий класс (.+)$/, (m) => `extends references missing class ${m[1]}.`],
    [/^instance_of ссылается на неизвестный класс (.+)$/, (m) => `instance_of references unknown class ${m[1]}.`],
    [/^has ссылается на неизвестный компонент (.+)$/, (m) => `has references unknown component ${m[1]}.`],
    [/^uses ссылается на неизвестный элемент (.+)$/, (m) => `uses references unknown element ${m[1]}.`],
    [/^notes ссылается на неизвестный элемент (.+)$/, (m) => `notes references unknown element ${m[1]}.`],
  ];
  for (const [pattern, translate] of patterns) {
    const match = message.match(pattern);
    if (match) return translate(match);
  }
  return message;
}

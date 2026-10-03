import { useCallback, useRef, type ReactNode } from 'react';
import type { ElementType, PlanElement } from '../types/planager';
import { Button } from './ui/Button';
import { Dialog } from './ui/Dialog';

export interface AiChangeReviewDialogProps {
  locale: 'ru' | 'en';
  summary: string;
  createdElements?: PlanElement[];
  before?: PlanElement;
  patch?: Partial<PlanElement>;
  onApply: () => void;
  onDiscard: () => void;
  busy?: boolean;
}

const typeLabels: Record<ElementType, [string, string]> = {
  system: ['System', 'Система'],
  class: ['Class', 'Класс'],
  process: ['Process', 'Процесс'],
  component: ['Component', 'Компонент'],
  object: ['Object', 'Объект'],
  idea: ['Idea', 'Идея'],
};

const propertyLabels: Record<string, [string, string]> = {
  title: ['Title', 'Название'],
  description: ['Description', 'Описание'],
  parent: ['Parent', 'Родитель'],
  status: ['Status', 'Статус'],
  mvp: ['MVP', 'MVP'],
  extendsId: ['Extends', 'Наследует'],
  fields: ['Fields', 'Поля'],
  methods: ['Methods', 'Методы'],
  components: ['Components (has)', 'Компоненты (has)'],
  uses: ['Uses', 'Использует'],
  steps: ['Steps', 'Шаги'],
  interfaceItems: ['Interface', 'Интерфейс'],
  internalLogic: ['Internal logic', 'Внутренняя логика'],
  instanceOf: ['Instance of', 'Экземпляр класса'],
  values: ['Values', 'Значения'],
  notes: ['Notes', 'Связанные заметки'],
  altTo: ['Alternative to', 'Альтернатива для'],
  altReason: ['Alternative reason', 'Причина альтернативы'],
  originIdeaId: ['Origin idea', 'Исходная идея'],
  customColor: ['Color', 'Цвет'],
};

function display(value: unknown, empty: string): string {
  if (value === undefined || value === null || value === '') return empty;
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  return JSON.stringify(value, null, 2);
}

function relationEntries(element: PlanElement, locale: 'ru' | 'en'): { label: string; value: string }[] {
  const en = locale === 'en';
  const entries: { label: string; value: string }[] = [];
  if (element.parent && element.parent !== '-') entries.push({ label: en ? 'Parent' : 'Родитель', value: element.parent });
  if (element.extendsId && element.extendsId !== '-') entries.push({ label: en ? 'Extends' : 'Наследует', value: element.extendsId });
  if (element.instanceOf && element.instanceOf !== '-') entries.push({ label: en ? 'Instance of' : 'Экземпляр класса', value: element.instanceOf });
  for (const [label, values] of [
    [en ? 'Components (has)' : 'Компоненты (has)', element.components],
    [en ? 'Uses' : 'Использует', element.uses],
    [en ? 'Notes' : 'Заметки', element.notes],
  ] as const) {
    if (values?.length) entries.push({ label, value: values.join(', ') });
  }
  if (element.altTo && element.altTo !== '-') entries.push({ label: en ? 'Alternative to' : 'Альтернатива для', value: element.altTo });
  if (element.originIdeaId) entries.push({ label: en ? 'Origin idea' : 'Исходная идея', value: element.originIdeaId });
  return entries;
}

export function AiChangeReviewDialog({
  locale,
  summary,
  createdElements = [],
  before,
  patch,
  onApply,
  onDiscard,
  busy = false,
}: AiChangeReviewDialogProps) {
  const en = locale === 'en';
  const busyRef = useRef(busy);
  const discardRef = useRef(onDiscard);
  busyRef.current = busy;
  discardRef.current = onDiscard;
  const close = useCallback(() => {
    if (!busyRef.current) discardRef.current();
  }, []);
  const text = (english: string, russian: string) => en ? english : russian;
  const empty = text('Not set', 'Не задано');
  const patchEntries = patch
    ? Object.entries(patch).filter(([key]) => !['id', 'type', 'fileName', 'position'].includes(key))
    : [];
  const hasContent = createdElements.length > 0 || patchEntries.length > 0;

  const sectionHeading = (children: ReactNode) => (
    <h3 className="text-sm font-semibold text-[var(--ink)]">{children}</h3>
  );

  return (
    <Dialog
      open
      title={text('Review AI changes', 'Проверка изменений ИИ')}
      description={text('Review the proposed project changes before applying them.', 'Проверьте предлагаемые изменения проекта перед применением.')}
      onClose={close}
      closeLabel={text('Close', 'Закрыть')}
      actions={(
        <>
          <Button disabled={busy} onClick={close}>{text('Discard', 'Отклонить')}</Button>
          <Button variant="positive" disabled={busy || !hasContent} onClick={onApply}>
            {busy ? text('Applying…', 'Применение…') : text('Apply changes', 'Применить изменения')}
          </Button>
        </>
      )}
    >
      <div className="max-h-[65vh] space-y-5 overflow-y-auto pr-1">
        <section aria-label={text('AI summary', 'Резюме ИИ')}>
          {sectionHeading(text('Summary', 'Резюме'))}
          <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-[var(--ink-muted)]">{summary}</p>
        </section>

        {createdElements.length > 0 ? (
          <section aria-label={text('Elements to add', 'Новые элементы')}>
            {sectionHeading(text(`Elements to add (${createdElements.length})`, `Добавить элементы (${createdElements.length})`))}
            <ul className="mt-2 space-y-2">
              {createdElements.map((element) => {
                const relations = relationEntries(element, locale);
                const details = Object.entries(element).filter(([key, value]) =>
                  !['id', 'type', 'title', 'description', 'fileName', 'position', 'parent', 'extendsId', 'instanceOf', 'components', 'uses', 'notes', 'altTo', 'originIdeaId'].includes(key) &&
                  value !== undefined && value !== null && value !== '' && value !== false && !(Array.isArray(value) && value.length === 0)
                );
                return (
                  <li key={element.id} className="rounded-lg border border-[var(--border)] bg-[var(--surface-hover)] p-3">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <code className="text-xs text-[var(--accent)]">{element.id}</code>
                      <span className="text-xs text-[var(--ink-muted)]">{typeLabels[element.type][en ? 0 : 1]}</span>
                    </div>
                    <p className="mt-1 font-medium text-[var(--ink)]">{element.title}</p>
                    <p className="mt-1 text-[10px] text-[var(--ink-muted)]">{text('File', 'Файл')}: {element.fileName}</p>
                    <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-[var(--ink-muted)]">{element.description || empty}</p>
                    {relations.length ? (
                      <dl className="mt-2 grid gap-x-3 gap-y-1 text-xs sm:grid-cols-[max-content_1fr]">
                        {relations.map((relation) => (
                          <div key={`${element.id}-${relation.label}`} className="contents">
                            <dt className="text-[var(--ink-muted)]">{relation.label}</dt>
                            <dd className="break-words text-[var(--ink)]">{relation.value}</dd>
                          </div>
                        ))}
                      </dl>
                    ) : null}
                    {details.length ? (
                      <dl className="mt-2 space-y-1 text-xs">
                        {details.map(([key, value]) => (
                          <div key={`${element.id}-${key}`} className="grid gap-1 sm:grid-cols-[max-content_1fr] sm:gap-3">
                            <dt className="text-[var(--ink-muted)]">{propertyLabels[key]?.[en ? 0 : 1] ?? key}</dt>
                            <dd className="break-words whitespace-pre-wrap text-[var(--ink)]">{display(value, empty)}</dd>
                          </div>
                        ))}
                      </dl>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {patchEntries.length > 0 ? (
          <section aria-label={text('Field changes', 'Изменения полей')}>
            {sectionHeading(text('Field changes', 'Изменения полей'))}
            <div className="mt-2 space-y-2">
              {patchEntries.map(([key, after]) => {
                const label = propertyLabels[key]?.[en ? 0 : 1] ?? key;
                const previous = before ? (before as unknown as Record<string, unknown>)[key] : undefined;
                return (
                  <div key={key} className="rounded-lg border border-[var(--border)] p-3">
                    <h4 className="mb-2 text-xs font-medium text-[var(--ink)]">{label}</h4>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="min-w-0 rounded-md bg-[var(--surface-hover)] p-2">
                        <p className="mb-1 text-[10px] uppercase tracking-wide text-[var(--ink-muted)]">{text('Before', 'Было')}</p>
                        <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words text-xs text-[var(--ink-muted)]">{display(previous, empty)}</pre>
                      </div>
                      <div className="min-w-0 rounded-md bg-[var(--surface-hover)] p-2">
                        <p className="mb-1 text-[10px] uppercase tracking-wide text-[var(--ink-muted)]">{text('After', 'Стало')}</p>
                        <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words text-xs text-[var(--ink)]">{display(after, empty)}</pre>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}

        {!hasContent ? (
          <p className="rounded-lg border border-[var(--border)] p-3 text-sm text-[var(--ink-muted)]">
            {text('No structured changes were returned for review.', 'Для проверки не получено структурированных изменений.')}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}

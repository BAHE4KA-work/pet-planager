import { useState, type KeyboardEvent } from 'react';
import type { PlanElement } from '../types/planager';
import { AutoGrowTextarea } from './AutoGrowTextarea';
import { ClassFieldsEditor } from './ClassFieldsEditor';
import { ElementIdentityFields } from './ElementIdentityFields';

interface InheritedObjectField {
  fieldName: string;
  dataType: string;
  sourceId: string;
  sourceTitle: string;
  defaultDescription: string;
}

interface StructuredElementFieldsProps {
  element: PlanElement;
  elements: PlanElement[];
  inheritedObjectFields: InheritedObjectField[];
  typeHeader: string;
  onChange: (element: PlanElement) => void;
  onRenameId: (oldId: string, newId: string) => boolean;
  onCursorLine: (line: number) => void;
  tx: (ru: string, en: string) => string;
}

export function StructuredElementFields({
  element,
  elements,
  inheritedObjectFields,
  typeHeader,
  onChange,
  onRenameId,
  onCursorLine,
  tx,
}: StructuredElementFieldsProps) {
  const [isAddingMethod, setIsAddingMethod] = useState(false);
  const [inlineMethodVis, setInlineMethodVis] = useState<'+' | '-'>('+');
  const [inlineMethodSig, setInlineMethodSig] = useState('');
  const [inlineMethodDesc, setInlineMethodDesc] = useState('');
  const [inlineStepText, setInlineStepText] = useState('');
  const [inlineInterfaceText, setInlineInterfaceText] = useState('');
  const [inlineLogicText, setInlineLogicText] = useState('');

  const addMethod = () => {
    if (!inlineMethodSig.trim()) return;
    onChange({
      ...element,
      methods: [
        ...(element.methods || []),
        {
          visibility: inlineMethodVis,
          signature: inlineMethodSig.trim(),
          description: inlineMethodDesc.trim() || 'метод',
        },
      ],
    });
    setInlineMethodSig('');
    setInlineMethodDesc('');
    setIsAddingMethod(false);
  };

  const addMethodOnEnter = (event: KeyboardEvent<HTMLInputElement | HTMLSelectElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      addMethod();
    }
  };

  const setObjectFieldValue = (fieldName: string, value: string) => {
    const nextValues = [...(element.values || [])];
    const currentIndex = nextValues.findIndex((item) => item.fieldName === fieldName);
    if (!value) {
      if (currentIndex !== -1) nextValues.splice(currentIndex, 1);
    } else if (currentIndex !== -1) {
      nextValues[currentIndex] = { fieldName, value };
    } else {
      nextValues.push({ fieldName, value });
    }
    onChange({ ...element, values: nextValues });
  };

  return (
  <div className="field-grid">
    {/* Row 1: Header */}
    <div
      className="field-row"
      onClick={() => onCursorLine(1)}
    >
      <div className="field-label">{tx('Заголовок', 'Header')}</div>
      <div className="field-value">
        <input
          type="text"
          value={`## ${typeHeader}: ${element.title}`}
          onChange={(e) => {
            const cleaned = e.target.value.replace(
              /^##\s*[^:]+:\s*/,
              ''
            );
            onChange({
              ...element,
              title: cleaned,
            });
          }}
        />
      </div>
    </div>
    <ElementIdentityFields
      element={element}
      elements={elements}
      onChange={onChange}
      onRenameId={onRenameId}
      onCursorLine={onCursorLine}
      tx={tx}
    />


    {/* Row 3: Description */}
    <div
      className="field-row"
      onClick={() => onCursorLine(4)}
    >
      <div className="field-label">{tx('Описание', 'Description')}</div>
      <div className="field-value">
        <AutoGrowTextarea
          value={element.description}
          onChange={(description) =>
            onChange({
              ...element,
              description,
            })
          }
        />
      </div>
    </div>

    {/* CLASS: Fields & Methods */}
    {element.type === 'class' && (
      <>
        <ClassFieldsEditor
          element={element}
          elements={elements}
          onChange={onChange}
          onCursorLine={onCursorLine}
          tx={tx}
        />
        <div
          className="field-row"
          onClick={() => onCursorLine(11)}
        >
          <div className="field-label">{tx('Методы', 'Methods')}</div>
          <div className="field-value space-y-2">
            {(element.methods || []).map((m, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between text-xs mono py-1 border-b border-[var(--border)]"
              >
                <span>
                  <strong
                    style={{
                      color:
                        m.visibility === '-'
                          ? 'var(--ctx-neg-text)'
                          : 'var(--ctx-pos-text)',
                    }}
                  >
                    {m.visibility} {m.signature}
                  </strong>{' '}
                  — {m.description}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    onChange({
                      ...element,
                      methods: (
                        element.methods || []
                      ).filter((_, i) => i !== idx),
                    })
                  }
                  className="text-[11px] hover:text-[var(--ctx-neg-text)] cursor-pointer"
                >
                  {tx('удалить', 'delete')}
                </button>
              </div>
            ))}
            {!isAddingMethod ? (
              <button
                type="button"
                onClick={() => setIsAddingMethod(true)}
                className="btn flex items-center justify-center"
                style={{ width: 30, height: 30, padding: 0 }}
                title={tx('Добавить метод-функцию', 'Add method function')}
                aria-label={tx('Добавить метод-функцию', 'Add method function')}
              >
                +
              </button>
            ) : (
              <div className="flex items-center gap-2 pt-1 w-full flex-wrap">
                <select
                  aria-label={tx('Видимость метода', 'Method visibility')}
                  value={inlineMethodVis}
                  onChange={(event) => setInlineMethodVis(event.target.value as '+' | '-')}
                  onKeyDown={addMethodOnEnter}
                  className="sys-input mono min-w-0 shrink-0 cursor-pointer"
                  style={{ width: '92px' }}
                >
                  <option value="+">+ {tx('публ.', 'public')}</option>
                  <option value="-">- {tx('прив.', 'private')}</option>
                </select>
                <input
                  autoFocus
                  placeholder="use()"
                  value={inlineMethodSig}
                  onChange={(event) => setInlineMethodSig(event.target.value)}
                  onKeyDown={addMethodOnEnter}
                  className="sys-input mono min-w-0 flex-1"
                  style={{ minWidth: '108px' }}
                  aria-label={tx('Сигнатура метода', 'Method signature')}
                />
                <input
                  placeholder={tx('описание метода', 'method description')}
                  value={inlineMethodDesc}
                  onChange={(event) => setInlineMethodDesc(event.target.value)}
                  onKeyDown={addMethodOnEnter}
                  className="sys-input flex-1 min-w-0"
                />
                <span className="pill mono text-[10px]" title={tx('Метод всегда является функцией', 'A method is always a function')}>function</span>
                <button type="button" onClick={addMethod} className="btn shrink-0">
                  {tx('Добавить', 'Add')}
                </button>
                <button type="button" onClick={() => { setIsAddingMethod(false); setInlineMethodSig(''); setInlineMethodDesc(''); }} className="btn shrink-0" title={tx('Отмена', 'Cancel')}>
                  ×
                </button>
              </div>
            )}
          </div>
        </div>
      </>
    )}

    {/* OBJECT: Inherited & Overridden Values */}
    {element.type === 'object' && (
      <div
        className="field-row"
        onClick={() => onCursorLine(8)}
      >
        <div className="field-label">{tx('Значения', 'Values')}</div>
        <div className="field-value space-y-2">
          {inheritedObjectFields.map((inh) => {
            const valObj = (
              element.values || []
            ).find((v) => v.fieldName === inh.fieldName);
            const referencedClass = elements.find((candidate) => candidate.type === 'class' && candidate.id === inh.dataType);
            const isProcedure = inh.dataType === 'procedure';
            const referenceOptions = isProcedure
              ? elements.filter((candidate) => candidate.type === 'process')
              : referencedClass
                ? elements.filter((candidate) => candidate.type === 'object' && candidate.instanceOf === referencedClass.id)
                : [];
            const displayType = referencedClass
              ? `${referencedClass.title} (${referencedClass.id})`
              : isProcedure
                ? tx('Процедура', 'Procedure')
                : inh.dataType;
            return (
              <div
                key={inh.fieldName}
                className="flex items-center gap-3 py-1 border-b border-[var(--border)]"
              >
                <span className="mono w-48 truncate">
                  <strong style={{ color: 'var(--ink)' }}>
                    {inh.fieldName}
                  </strong>{' '}
                  ({displayType} · {inh.sourceId})
                </span>
                {referencedClass || isProcedure ? (
                  <select
                    aria-label={`${inh.fieldName}: ${displayType}`}
                    value={valObj?.value || ''}
                    onChange={(event) => setObjectFieldValue(inh.fieldName, event.target.value)}
                    className="sys-input mono flex-1 cursor-pointer"
                    style={{ color: 'var(--accent)' }}
                  >
                    <option value="">{tx('Не назначено', 'Not assigned')}</option>
                    {referenceOptions.map((option) => (
                      <option key={option.id} value={option.id}>{option.title} · {option.id}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    placeholder={tx('Укажите конкретное значение...', 'Enter a specific value...')}
                    value={valObj?.value || ''}
                    onChange={(event) => setObjectFieldValue(inh.fieldName, event.target.value)}
                    className="mono flex-1"
                    style={{ color: 'var(--accent)' }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    )}

    {/* PROCESS: Steps */}
    {element.type === 'process' && (
      <div
        className="field-row"
        onClick={() => onCursorLine(8)}
      >
        <div className="field-label">{tx('Шаги', 'Steps')}</div>
        <div className="field-value space-y-2">
          {(element.steps || []).map((st, idx) => (
            <div
              key={idx}
              className="flex items-center justify-between text-xs py-1 border-b border-[var(--border)]"
            >
              <span>
                <span className="mono mr-2">{idx + 1}.</span>
                {st}
              </span>
              <button
                type="button"
                onClick={() =>
                  onChange({
                    ...element,
                    steps: (
                      element.steps || []
                    ).filter((_, i) => i !== idx),
                  })
                }
                className="mono text-[11px] cursor-pointer"
              >
                  {tx('удалить', 'delete')}
              </button>
            </div>
          ))}
          <div className="flex gap-2 pt-1">
            <input
              placeholder={tx('Добавить шаг последовательности...', 'Add a sequence step...')}
              value={inlineStepText}
              onChange={(e) =>
                setInlineStepText(e.target.value)
              }
              className="sys-input flex-1"
            />
            <button
              type="button"
              onClick={() => {
                if (!inlineStepText.trim()) return;
                onChange({
                  ...element,
                  steps: [
                    ...(element.steps || []),
                    inlineStepText.trim(),
                  ],
                });
                setInlineStepText('');
              }}
              className="btn"
            >
              + {tx('Шаг', 'Step')}
            </button>
          </div>
        </div>
      </div>
    )}

    {/* COMPONENT: Interface & Internal Logic */}
    {element.type === 'component' && (
      <>
        <div
          className="field-row"
          onClick={() => onCursorLine(8)}
        >
          <div className="field-label">{tx('Интерфейс (+)', 'Interface (+)')}</div>
          <div className="field-value space-y-2">
            {(element.interfaceItems || []).map(
              (it, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between mono text-xs py-1 border-b border-[var(--border)]"
                >
                  <span>
                    <strong
                      style={{ color: 'var(--ctx-pos-text)' }}
                    >
                      +
                    </strong>{' '}
                    {it}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      onChange({
                        ...element,
                        interfaceItems: (
                          element.interfaceItems || []
                        ).filter((_, i) => i !== idx),
                      })
                    }
                    className="text-[11px] hover:text-[var(--ctx-neg-text)] cursor-pointer"
                  >
                    {tx('удалить', 'delete')}
                  </button>
                </div>
              )
            )}
            <div className="flex gap-2 pt-1">
              <input
                placeholder={tx('param: int — описание', 'param: int — description')}
                value={inlineInterfaceText}
                onChange={(e) =>
                  setInlineInterfaceText(e.target.value)
                }
                className="sys-input flex-1 mono"
              />
              <button
                type="button"
                onClick={() => {
                  if (!inlineInterfaceText.trim()) return;
                  onChange({
                    ...element,
                    interfaceItems: [
                      ...(element.interfaceItems ||
                        []),
                      inlineInterfaceText.trim(),
                    ],
                  });
                  setInlineInterfaceText('');
                }}
                className="btn"
              >
                + {tx('Интерфейс', 'Interface')}
              </button>
            </div>
          </div>
        </div>

        <div
          className="field-row"
          onClick={() => onCursorLine(12)}
        >
          <div className="field-label">{tx('Внутренняя логика (-)', 'Internal Logic (-)')}</div>
          <div className="field-value space-y-2">
            {(element.internalLogic || []).map(
              (lg, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between text-xs py-1 border-b border-[var(--border)]"
                >
                  <span>
                    <strong
                      style={{ color: 'var(--ctx-neg-text)' }}
                    >
                      -
                    </strong>{' '}
                    {lg}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      onChange({
                        ...element,
                        internalLogic: (
                          element.internalLogic || []
                        ).filter((_, i) => i !== idx),
                      })
                    }
                    className="mono text-[11px] hover:text-[var(--ctx-neg-text)] cursor-pointer"
                  >
                    {tx('удалить', 'delete')}
                  </button>
                </div>
              )
            )}
            <div className="flex gap-2 pt-1">
              <input
                placeholder={tx('Правило внутренней логики...', 'Internal logic rule...')}
                value={inlineLogicText}
                onChange={(e) =>
                  setInlineLogicText(e.target.value)
                }
                className="sys-input flex-1"
              />
              <button
                type="button"
                onClick={() => {
                  if (!inlineLogicText.trim()) return;
                  onChange({
                    ...element,
                    internalLogic: [
                      ...(element.internalLogic ||
                        []),
                      inlineLogicText.trim(),
                    ],
                  });
                  setInlineLogicText('');
                }}
                className="btn"
              >
                + {tx('Правило', 'Rule')}
              </button>
            </div>
          </div>
        </div>
      </>
    )}

    {/* IDEA: Linked To (alt_to & alt_reason) & Keywords/Notes */}
    {element.type === 'idea' && (
      <>
        <div
          className="field-row"
          onClick={() => onCursorLine(10)}
        >
          <div className="field-label">{tx('Альтернативная связь (Alt)', 'Linked To (Alt)')}</div>
          <div className="field-value flex items-center gap-4 flex-wrap">
            <select
              value={element.altTo || '-'}
              onChange={(e) =>
                onChange({
                  ...element,
                  altTo: e.target.value,
                })
              }
              className="identity-control cursor-pointer"
              style={{
                width: '200px',
                color: 'var(--ctx-neg-text)',
              }}
            >
              <option value="-">
                - {tx('(мысль на будущее)', '(future idea)')}
              </option>
              {elements
                .filter((x) => x.id !== element.id)
                .map((oe) => (
                  <option key={oe.id} value={oe.id}>
                    {oe.id}
                  </option>
                ))}
            </select>
            <input
              type="text"
                placeholder={tx('Причина отказа (alt_reason)...', 'Reason for rejection (alt_reason)...')}
              value={element.altReason || ''}
              onChange={(e) =>
                onChange({
                  ...element,
                  altReason: e.target.value,
                })
              }
              className="flex-1 text-xs"
              style={{ color: 'var(--ink-muted)' }}
            />
          </div>
        </div>

        <div
          className="field-row"
          onClick={() => onCursorLine(14)}
        >
          <div className="field-label">{tx('Примечания', 'Notes')}</div>
          <div className="field-value space-y-2">
            <div className="mono">
              {(element.notes || []).join(', ') ||
                tx('отдельно стоящая идея (без привязки)', 'standalone idea (unlinked)')}
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              {elements
                .filter((x) => x.id !== element.id)
                .map((target) => {
                  const active = (
                    element.notes || []
                  ).includes(target.id);
                  return (
                    <button
                      key={target.id}
                      type="button"
                      onClick={() => {
                        const curr =
                          element.notes || [];
                        const next = active
                          ? curr.filter(
                              (id) => id !== target.id
                            )
                          : [...curr, target.id];
                        onChange({
                          ...element,
                          notes: next,
                        });
                      }}
                      className="pill cursor-pointer"
                      style={{
                        borderColor: active
                          ? 'var(--accent)'
                          : undefined,
                        color: active
                          ? 'var(--accent)'
                          : undefined,
                      }}
                    >
                      {target.id}
                    </button>
                  );
                })}
            </div>
          </div>
        </div>
      </>
    )}

    {/* Shared Components (has) */}
    {['class', 'process', 'object'].includes(
      element.type
    ) && (
      <div
        className="field-row"
        onClick={() => onCursorLine(16)}
      >
        <div className="field-label">{tx('Компоненты (has)', 'Components (has)')}</div>
        <div className="field-value flex flex-wrap gap-2">
          {elements
            .filter((e) => e.type === 'component')
            .map((cmp) => {
              const active = (
                element.components || []
              ).includes(cmp.id);
              return (
                <button
                  key={cmp.id}
                  type="button"
                  onClick={() => {
                    const curr =
                      element.components || [];
                    const next = active
                      ? curr.filter((x) => x !== cmp.id)
                      : [...curr, cmp.id];
                    onChange({
                      ...element,
                      components: next,
                    });
                  }}
                  className="pill cursor-pointer"
                  style={{
                    borderColor: active
                      ? 'var(--accent)'
                      : undefined,
                    color: active
                      ? 'var(--accent)'
                      : undefined,
                  }}
                >
                  {active ? '✓ ' : '+ '}
                  {cmp.id}
                </button>
              );
            })}
        </div>
      </div>
    )}

    {/* Shared Uses */}
    {['class', 'process'].includes(element.type) && (
      <div
        className="field-row"
        onClick={() => onCursorLine(18)}
      >
        <div className="field-label">{tx('Использует', 'Uses')}</div>
        <div className="field-value flex flex-wrap gap-2">
          {elements
            .filter((e) => e.id !== element.id)
            .map((target) => {
              const active = (
                element.uses || []
              ).includes(target.id);
              return (
                <button
                  key={target.id}
                  type="button"
                  onClick={() => {
                    const curr = element.uses || [];
                    const next = active
                      ? curr.filter((x) => x !== target.id)
                      : [...curr, target.id];
                    onChange({
                      ...element,
                      uses: next,
                    });
                  }}
                  className="pill cursor-pointer"
                  style={{
                    borderColor: active
                      ? 'var(--accent)'
                      : undefined,
                    color: active
                      ? 'var(--accent)'
                      : undefined,
                  }}
                >
                  {active ? '→ ' : ''}
                  {target.id}
                </button>
              );
            })}
        </div>
      </div>
    )}
  </div>
  );
}

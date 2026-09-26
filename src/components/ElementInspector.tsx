import React, { useState } from 'react';
import {
  BookmarkPlus,
  FileCode2,
  Pin,
  Plus,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { ElementType, PlanElement } from '../types/planager';
import {
  resolveInheritedFieldsForObject,
  TYPE_HEADERS_RU,
} from '../utils/pgrCodec';
import { ELEMENT_TYPE_ACCENTS, ElementTypeIcon } from './CanvasView';

interface ElementInspectorProps {
  element: PlanElement | null;
  allElements: PlanElement[];
  files: string[];
  isAiPinned: boolean;
  onUpdateElement: (updated: PlanElement) => void;
  onDeleteElement: (id: string) => void;
  onSaveToUnitLibrary: (element: PlanElement) => void;
  onOpenInKnowledgeBase: (fileName: string, elementId: string) => void;
  onToggleAiContext: (id: string) => void;
  onTransformElement: (
    element: PlanElement,
    pattern: 'system_pack' | 'class_hierarchy' | 'process_chain'
  ) => void;
  onClose: () => void;
}

const PRESET_MARKER_COLORS = [
  '#0EA5E9',
  '#3B82F6',
  '#8B5CF6',
  '#10B981',
  '#F59E0B',
  '#EC4899',
  '#64748B',
];

export const ElementInspector: React.FC<ElementInspectorProps> = ({
  element,
  allElements,
  files,
  isAiPinned,
  onUpdateElement,
  onDeleteElement,
  onSaveToUnitLibrary,
  onOpenInKnowledgeBase,
  onToggleAiContext,
  onTransformElement,
  onClose,
}) => {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [newFieldName, setNewFieldName] = useState('');
  const [newFieldType, setNewFieldType] = useState('string');
  const [newFieldDesc, setNewFieldDesc] = useState('');

  const [newMethodVis, setNewMethodVis] = useState<'+' | '-'>('+');
  const [newMethodSig, setNewMethodSig] = useState('');
  const [newMethodDesc, setNewMethodDesc] = useState('');

  const [newStepText, setNewStepText] = useState('');
  const [newInterfaceText, setNewInterfaceText] = useState('');
  const [newLogicText, setNewLogicText] = useState('');

  if (!element) {
    return (
      <aside
        className="w-80 border-l p-5 flex flex-col justify-center items-center text-center shrink-0"
        style={{
          backgroundColor: 'var(--bg-surface)',
          borderColor: 'var(--border-hairline)',
          color: 'var(--text-muted)',
        }}
      >
        <p className="text-xs leading-relaxed">
          Выберите элемент на Холсте или в Базе знаний для настройки его структуры, связей и параметров.
        </p>
      </aside>
    );
  }

  const systems = allElements.filter((e) => e.type === 'system' && e.id !== element.id);
  const classes = allElements.filter((e) => e.type === 'class' && e.id !== element.id);
  const components = allElements.filter(
    (e) => e.type === 'component' && e.id !== element.id
  );
  const otherElements = allElements.filter((e) => e.id !== element.id);

  const inheritedFields =
    element.type === 'object'
      ? resolveInheritedFieldsForObject(element, allElements)
      : [];

  const updateField = <K extends keyof PlanElement>(key: K, value: PlanElement[K]) => {
    onUpdateElement({ ...element, [key]: value });
  };

  const toggleArrayItem = (
    key: 'components' | 'uses' | 'notes',
    targetId: string
  ) => {
    const current = element[key] || [];
    const next = current.includes(targetId)
      ? current.filter((x) => x !== targetId)
      : [...current, targetId];
    updateField(key, next);
  };

  const handleSetObjectFieldValue = (fieldName: string, value: string) => {
    const currentValues = [...(element.values || [])];
    const idx = currentValues.findIndex((v) => v.fieldName === fieldName);
    if (value.trim() === '') {
      if (idx !== -1) currentValues.splice(idx, 1);
    } else if (idx !== -1) {
      currentValues[idx] = { fieldName, value };
    } else {
      currentValues.push({ fieldName, value });
    }
    updateField('values', currentValues);
  };

  const accentColor = element.customColor || ELEMENT_TYPE_ACCENTS[element.type];

  return (
    <aside
      className="w-96 border-l flex flex-col h-full shrink-0 overflow-hidden"
      style={{
        backgroundColor: 'var(--bg-surface)',
        borderColor: 'var(--border-hairline)',
      }}
    >
      {/* Inspector Header */}
      <div
        className="px-4 py-3 border-b flex items-center justify-between gap-2"
        style={{ borderColor: 'var(--border-hairline)' }}
      >
        <div className="flex items-center gap-2 text-xs font-mono-tabular truncate">
          <span
            className="inline-flex items-center gap-1 font-semibold"
            style={{ color: accentColor }}
          >
            <ElementTypeIcon type={element.type} className="w-4 h-4" />
            {TYPE_HEADERS_RU[element.type]}
          </span>
          <span aria-hidden="true">·</span>
          <span style={{ color: 'var(--text-muted)' }}>{element.status}</span>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => onToggleAiContext(element.id)}
            className="p-1.5 rounded text-xs cursor-pointer"
            style={{
              backgroundColor: isAiPinned ? 'var(--ctx-pos-soft)' : 'transparent',
              color: isAiPinned ? 'var(--ctx-pos)' : 'var(--text-muted)',
            }}
            title="Закрепить в контексте ИИ"
          >
            <Pin className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onOpenInKnowledgeBase(element.fileName, element.id)}
            className="p-1.5 rounded text-xs cursor-pointer"
            style={{ color: 'var(--text-muted)' }}
            title="Открыть в Базе знаний (.pgr по строкам)"
          >
            <FileCode2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onSaveToUnitLibrary(element)}
            className="p-1.5 rounded text-xs cursor-pointer"
            style={{ color: 'var(--text-muted)' }}
            title="Сохранить в Библиотеку юнитов"
          >
            <BookmarkPlus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded text-xs cursor-pointer"
            style={{ color: 'var(--text-muted)' }}
            title="Скрыть панель"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Scrollable Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
        {/* Title & ID */}
        <div className="space-y-2.5">
          <div>
            <label
              className="block text-[11px] mb-1"
              style={{ color: 'var(--text-muted)' }}
            >
              Название
            </label>
            <input
              type="text"
              value={element.title}
              onChange={(e) => updateField('title', e.target.value)}
              className="w-full px-2.5 py-1.5 rounded border text-xs font-medium focus:outline-none"
              style={{
                backgroundColor: 'var(--bg-subtle)',
                borderColor: 'var(--border-hairline)',
                color: 'var(--text-primary)',
              }}
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label
                className="block text-[11px] mb-1"
                style={{ color: 'var(--text-muted)' }}
              >
                ID (.pgr слаг)
              </label>
              <input
                type="text"
                value={element.id}
                onChange={(e) => updateField('id', e.target.value.trim())}
                className="w-full px-2.5 py-1.5 rounded border text-xs font-mono-tabular focus:outline-none"
                style={{
                  backgroundColor: 'var(--bg-subtle)',
                  borderColor: 'var(--border-hairline)',
                  color: 'var(--text-primary)',
                }}
              />
            </div>

            <div>
              <label
                className="block text-[11px] mb-1"
                style={{ color: 'var(--text-muted)' }}
              >
                Файл проекта
              </label>
              <select
                value={element.fileName}
                onChange={(e) => updateField('fileName', e.target.value)}
                className="w-full px-2 py-1.5 rounded border text-xs font-mono-tabular focus:outline-none"
                style={{
                  backgroundColor: 'var(--bg-subtle)',
                  borderColor: 'var(--border-hairline)',
                  color: 'var(--text-primary)',
                }}
              >
                {files.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Phase MVP Toggle & Custom Color Marker */}
          <div className="flex items-center justify-between pt-1">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={element.mvp}
                onChange={(e) => updateField('mvp', e.target.checked)}
                className="rounded"
              />
              <span style={{ color: 'var(--text-primary)' }}>
                Метка фазы <strong>MVP</strong>
              </span>
            </label>

            <div className="flex items-center gap-1" title="Цвет-маркировка элемента">
              {PRESET_MARKER_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => updateField('customColor', c)}
                  className="w-4 h-4 rounded-full border cursor-pointer"
                  style={{
                    backgroundColor: c,
                    borderColor:
                      element.customColor === c ? 'var(--text-primary)' : 'transparent',
                  }}
                />
              ))}
              {element.customColor && (
                <button
                  type="button"
                  onClick={() => updateField('customColor', undefined)}
                  className="text-[10px] underline ml-1 cursor-pointer"
                  style={{ color: 'var(--text-muted)' }}
                >
                  сброс
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Parent System ('contains') for non-System elements */}
        {element.type !== 'system' && (
          <div>
            <label
              className="block text-[11px] mb-1"
              style={{ color: 'var(--text-muted)' }}
            >
              Родительская Система (parent / contains)
            </label>
            <select
              value={element.parent || '-'}
              onChange={(e) => updateField('parent', e.target.value)}
              className="w-full px-2.5 py-1.5 rounded border text-xs font-mono-tabular"
              style={{
                backgroundColor: 'var(--bg-subtle)',
                borderColor: 'var(--border-hairline)',
                color: 'var(--text-primary)',
              }}
            >
              <option value="-">- (без родителя / вне системы)</option>
              {systems.map((sys) => (
                <option key={sys.id} value={sys.id}>
                  {sys.id} — {sys.title}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Description */}
        <div>
          <label
            className="block text-[11px] mb-1"
            style={{ color: 'var(--text-muted)' }}
          >
            Смысловое описание
          </label>
          <textarea
            rows={3}
            value={element.description}
            onChange={(e) => updateField('description', e.target.value)}
            className="w-full px-2.5 py-1.5 rounded border text-xs leading-relaxed focus:outline-none"
            style={{
              backgroundColor: 'var(--bg-subtle)',
              borderColor: 'var(--border-hairline)',
              color: 'var(--text-primary)',
            }}
          />
        </div>

        {/* ================= CLASS SPECIFIC ================= */}
        {element.type === 'class' && (
          <div
            className="space-y-3 pt-3 border-t"
            style={{ borderColor: 'var(--border-hairline)' }}
          >
            <div>
              <label
                className="block text-[11px] mb-1"
                style={{ color: 'var(--text-muted)' }}
              >
                Наследование (extends — одиночное, без циклов)
              </label>
              <select
                value={element.extendsId || '-'}
                onChange={(e) => updateField('extendsId', e.target.value)}
                className="w-full px-2.5 py-1.5 rounded border text-xs font-mono-tabular"
                style={{
                  backgroundColor: 'var(--bg-subtle)',
                  borderColor: 'var(--border-hairline)',
                  color: 'var(--text-primary)',
                }}
              >
                <option value="-">- (базовый класс)</option>
                {classes.map((cls) => (
                  <option key={cls.id} value={cls.id}>
                    {cls.id} — {cls.title}
                  </option>
                ))}
              </select>
            </div>

            {/* Fields */}
            <div>
              <div className="font-medium mb-1.5">Поля класса</div>
              <div className="space-y-1.5 mb-2">
                {(element.fields || []).map((f, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between gap-2 px-2 py-1 rounded font-mono-tabular text-[11px]"
                    style={{ backgroundColor: 'var(--bg-subtle)' }}
                  >
                    <span className="truncate">
                      <strong>{f.name}</strong>: {f.dataType} — {f.description}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        updateField(
                          'fields',
                          (element.fields || []).filter((_, i) => i !== idx)
                        )
                      }
                      className="opacity-60 hover:opacity-100 cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-3 gap-1">
                <input
                  placeholder="имя"
                  value={newFieldName}
                  onChange={(e) => setNewFieldName(e.target.value)}
                  className="px-2 py-1 rounded border text-[11px] font-mono-tabular"
                  style={{
                    backgroundColor: 'var(--bg-subtle)',
                    borderColor: 'var(--border-hairline)',
                  }}
                />
                <input
                  placeholder="тип (int, float)"
                  value={newFieldType}
                  onChange={(e) => setNewFieldType(e.target.value)}
                  className="px-2 py-1 rounded border text-[11px] font-mono-tabular"
                  style={{
                    backgroundColor: 'var(--bg-subtle)',
                    borderColor: 'var(--border-hairline)',
                  }}
                />
                <div className="flex gap-1">
                  <input
                    placeholder="описание"
                    value={newFieldDesc}
                    onChange={(e) => setNewFieldDesc(e.target.value)}
                    className="w-full px-2 py-1 rounded border text-[11px]"
                    style={{
                      backgroundColor: 'var(--bg-subtle)',
                      borderColor: 'var(--border-hairline)',
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (!newFieldName.trim()) return;
                      updateField('fields', [
                        ...(element.fields || []),
                        {
                          name: newFieldName.trim(),
                          dataType: newFieldType.trim() || 'string',
                          description: newFieldDesc.trim() || 'параметр',
                        },
                      ]);
                      setNewFieldName('');
                      setNewFieldDesc('');
                    }}
                    className="px-2 rounded btn-ctx-pos cursor-pointer"
                    title="Добавить поле"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>

            {/* Methods */}
            <div>
              <div className="font-medium mb-1.5">Методы (+ публ. / - прив.)</div>
              <div className="space-y-1.5 mb-2">
                {(element.methods || []).map((m, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between gap-2 px-2 py-1 rounded font-mono-tabular text-[11px]"
                    style={{ backgroundColor: 'var(--bg-subtle)' }}
                  >
                    <span className="truncate">
                      {m.visibility} {m.signature} — {m.description}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        updateField(
                          'methods',
                          (element.methods || []).filter((_, i) => i !== idx)
                        )
                      }
                      className="opacity-60 hover:opacity-100 cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex gap-1">
                <select
                  value={newMethodVis}
                  onChange={(e) => setNewMethodVis(e.target.value as '+' | '-')}
                  className="px-1.5 py-1 rounded border text-[11px] font-mono-tabular"
                  style={{
                    backgroundColor: 'var(--bg-subtle)',
                    borderColor: 'var(--border-hairline)',
                  }}
                >
                  <option value="+">+</option>
                  <option value="-">-</option>
                </select>
                <input
                  placeholder="use()"
                  value={newMethodSig}
                  onChange={(e) => setNewMethodSig(e.target.value)}
                  className="w-28 px-2 py-1 rounded border text-[11px] font-mono-tabular"
                  style={{
                    backgroundColor: 'var(--bg-subtle)',
                    borderColor: 'var(--border-hairline)',
                  }}
                />
                <input
                  placeholder="описание метода"
                  value={newMethodDesc}
                  onChange={(e) => setNewMethodDesc(e.target.value)}
                  className="flex-1 px-2 py-1 rounded border text-[11px]"
                  style={{
                    backgroundColor: 'var(--bg-subtle)',
                    borderColor: 'var(--border-hairline)',
                  }}
                />
                <button
                  type="button"
                  onClick={() => {
                    if (!newMethodSig.trim()) return;
                    updateField('methods', [
                      ...(element.methods || []),
                      {
                        visibility: newMethodVis,
                        signature: newMethodSig.trim(),
                        description: newMethodDesc.trim() || 'действие',
                      },
                    ]);
                    setNewMethodSig('');
                    setNewMethodDesc('');
                  }}
                  className="px-2 rounded btn-ctx-pos cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ================= OBJECT SPECIFIC (П. 7 ДОП. ТРЕБОВАНИЙ) ================= */}
        {element.type === 'object' && (
          <div
            className="space-y-3 pt-3 border-t"
            style={{ borderColor: 'var(--border-hairline)' }}
          >
            <div>
              <label
                className="block text-[11px] mb-1"
                style={{ color: 'var(--text-muted)' }}
              >
                Базовый Класс (instance_of — 0 или 1)
              </label>
              <select
                value={element.instanceOf || '-'}
                onChange={(e) => updateField('instanceOf', e.target.value)}
                className="w-full px-2.5 py-1.5 rounded border text-xs font-mono-tabular"
                style={{
                  backgroundColor: 'var(--bg-subtle)',
                  borderColor: 'var(--border-hairline)',
                  color: 'var(--text-primary)',
                }}
              >
                <option value="-">- (без Класса, только на Компонентах)</option>
                {classes.map((cls) => (
                  <option key={cls.id} value={cls.id}>
                    {cls.id} — {cls.title}
                  </option>
                ))}
              </select>
            </div>

            {/* Inherited & Overridden Field Values */}
            <div>
              <div className="font-medium mb-1">
                Значения полей (наследуемые от Класса и Компонентов)
              </div>
              <p
                className="text-[11px] mb-2"
                style={{ color: 'var(--text-muted)' }}
              >
                Укажите конкретные значения для проверки работы Класса/Компонентов на примере этого Объекта:
              </p>

              <div className="space-y-1.5">
                {inheritedFields.map((inh) => {
                  const currentVal =
                    (element.values || []).find((v) => v.fieldName === inh.fieldName)
                      ?.value || '';
                  return (
                    <div
                      key={inh.fieldName}
                      className="p-2 rounded border space-y-1"
                      style={{
                        backgroundColor: 'var(--bg-subtle)',
                        borderColor: 'var(--border-hairline)',
                      }}
                    >
                      <div className="flex items-center justify-between text-[11px] font-mono-tabular">
                        <span>
                          <strong>{inh.fieldName}</strong> ({inh.dataType})
                        </span>
                        <span style={{ color: 'var(--text-muted)' }}>
                          из {inh.sourceId}
                        </span>
                      </div>
                      <input
                        type="text"
                        placeholder={`Значение (${inh.defaultDescription})`}
                        value={currentVal}
                        onChange={(e) =>
                          handleSetObjectFieldValue(inh.fieldName, e.target.value)
                        }
                        className="w-full px-2 py-1 rounded border text-xs font-mono-tabular"
                        style={{
                          backgroundColor: 'var(--bg-surface)',
                          borderColor: 'var(--border-hairline)',
                          color: 'var(--text-primary)',
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ================= PROCESS SPECIFIC ================= */}
        {element.type === 'process' && (
          <div
            className="space-y-3 pt-3 border-t"
            style={{ borderColor: 'var(--border-hairline)' }}
          >
            <div>
              <div className="font-medium mb-1.5">Шаги процесса (нумерованный список)</div>
              <div className="space-y-1.5 mb-2">
                {(element.steps || []).map((step, idx) => (
                  <div
                    key={idx}
                    className="flex items-start justify-between gap-2 px-2 py-1.5 rounded text-[11px]"
                    style={{ backgroundColor: 'var(--bg-subtle)' }}
                  >
                    <span>
                      <strong className="font-mono-tabular">{idx + 1}.</strong> {step}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        updateField(
                          'steps',
                          (element.steps || []).filter((_, i) => i !== idx)
                        )
                      }
                      className="opacity-60 hover:opacity-100 shrink-0 cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex gap-1">
                <input
                  placeholder="Новый шаг последовательности..."
                  value={newStepText}
                  onChange={(e) => setNewStepText(e.target.value)}
                  className="flex-1 px-2 py-1 rounded border text-xs"
                  style={{
                    backgroundColor: 'var(--bg-subtle)',
                    borderColor: 'var(--border-hairline)',
                  }}
                />
                <button
                  type="button"
                  onClick={() => {
                    if (!newStepText.trim()) return;
                    updateField('steps', [
                      ...(element.steps || []),
                      newStepText.trim(),
                    ]);
                    setNewStepText('');
                  }}
                  className="px-2.5 rounded btn-ctx-pos cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ================= COMPONENT SPECIFIC ================= */}
        {element.type === 'component' && (
          <div
            className="space-y-3 pt-3 border-t"
            style={{ borderColor: 'var(--border-hairline)' }}
          >
            <div>
              <div className="font-medium mb-1.5">Интерфейс (публичная часть +)</div>
              <div className="space-y-1 mb-2">
                {(element.interfaceItems || []).map((item, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between gap-2 px-2 py-1 rounded font-mono-tabular text-[11px]"
                    style={{ backgroundColor: 'var(--bg-subtle)' }}
                  >
                    <span className="truncate">+ {item}</span>
                    <button
                      type="button"
                      onClick={() =>
                        updateField(
                          'interfaceItems',
                          (element.interfaceItems || []).filter((_, i) => i !== idx)
                        )
                      }
                      className="opacity-60 hover:opacity-100 cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex gap-1">
                <input
                  placeholder="param: type — описание"
                  value={newInterfaceText}
                  onChange={(e) => setNewInterfaceText(e.target.value)}
                  className="flex-1 px-2 py-1 rounded border text-[11px] font-mono-tabular"
                  style={{
                    backgroundColor: 'var(--bg-subtle)',
                    borderColor: 'var(--border-hairline)',
                  }}
                />
                <button
                  type="button"
                  onClick={() => {
                    if (!newInterfaceText.trim()) return;
                    updateField('interfaceItems', [
                      ...(element.interfaceItems || []),
                      newInterfaceText.trim(),
                    ]);
                    setNewInterfaceText('');
                  }}
                  className="px-2 rounded btn-ctx-pos cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div>
              <div className="font-medium mb-1.5">Внутренняя логика (приватная часть -)</div>
              <div className="space-y-1 mb-2">
                {(element.internalLogic || []).map((item, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between gap-2 px-2 py-1 rounded text-[11px]"
                    style={{ backgroundColor: 'var(--bg-subtle)' }}
                  >
                    <span className="truncate">- {item}</span>
                    <button
                      type="button"
                      onClick={() =>
                        updateField(
                          'internalLogic',
                          (element.internalLogic || []).filter((_, i) => i !== idx)
                        )
                      }
                      className="opacity-60 hover:opacity-100 cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex gap-1">
                <input
                  placeholder="Правило внутренней логики..."
                  value={newLogicText}
                  onChange={(e) => setNewLogicText(e.target.value)}
                  className="flex-1 px-2 py-1 rounded border text-[11px]"
                  style={{
                    backgroundColor: 'var(--bg-subtle)',
                    borderColor: 'var(--border-hairline)',
                  }}
                />
                <button
                  type="button"
                  onClick={() => {
                    if (!newLogicText.trim()) return;
                    updateField('internalLogic', [
                      ...(element.internalLogic || []),
                      newLogicText.trim(),
                    ]);
                    setNewLogicText('');
                  }}
                  className="px-2 rounded btn-ctx-pos cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ================= IDEA SPECIFIC ================= */}
        {element.type === 'idea' && (
          <div
            className="space-y-3 pt-3 border-t"
            style={{ borderColor: 'var(--border-hairline)' }}
          >
            <div>
              <label
                className="block text-[11px] mb-1"
                style={{ color: 'var(--text-muted)' }}
              >
                Альтернатива к (alt_to — если идея фиксирует отклонённый вариант)
              </label>
              <select
                value={element.altTo || '-'}
                onChange={(e) => updateField('altTo', e.target.value)}
                className="w-full px-2.5 py-1.5 rounded border text-xs font-mono-tabular"
                style={{
                  backgroundColor: 'var(--bg-subtle)',
                  borderColor: 'var(--border-hairline)',
                }}
              >
                <option value="-">- (мысль на будущее, не отказ)</option>
                {otherElements.map((oe) => (
                  <option key={oe.id} value={oe.id}>
                    {oe.id} — {oe.title}
                  </option>
                ))}
              </select>
            </div>

            {element.altTo && element.altTo !== '-' && (
              <div>
                <label
                  className="block text-[11px] mb-1"
                  style={{ color: 'var(--text-muted)' }}
                >
                  Причина отказа (alt_reason)
                </label>
                <textarea
                  rows={2}
                  value={element.altReason || ''}
                  onChange={(e) => updateField('altReason', e.target.value)}
                  placeholder="Почему отказались от этого варианта..."
                  className="w-full px-2.5 py-1.5 rounded border text-xs"
                  style={{
                    backgroundColor: 'var(--bg-subtle)',
                    borderColor: 'var(--border-hairline)',
                  }}
                />
              </div>
            )}

            <div>
              <div className="font-medium mb-1">
                Аннотирует элементы (notes — можно оставить пустым)
              </div>
              <div
                className="max-h-32 overflow-y-auto p-2 rounded border space-y-1"
                style={{
                  backgroundColor: 'var(--bg-subtle)',
                  borderColor: 'var(--border-hairline)',
                }}
              >
                {otherElements.map((oe) => (
                  <label
                    key={oe.id}
                    className="flex items-center gap-2 text-[11px] cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={(element.notes || []).includes(oe.id)}
                      onChange={() => toggleArrayItem('notes', oe.id)}
                    />
                    <span className="font-mono-tabular">{oe.id}</span>
                    <span className="truncate" style={{ color: 'var(--text-muted)' }}>
                      — {oe.title}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Shared Composition: 'has' -> Components (for Class, Process, Object) */}
        {['class', 'process', 'object'].includes(element.type) && (
          <div
            className="pt-3 border-t"
            style={{ borderColor: 'var(--border-hairline)' }}
          >
            <div className="font-medium mb-1.5">
              Компоненты (отношение has → Компонент)
            </div>
            <div
              className="max-h-28 overflow-y-auto p-2 rounded border space-y-1"
              style={{
                backgroundColor: 'var(--bg-subtle)',
                borderColor: 'var(--border-hairline)',
              }}
            >
              {components.map((cmp) => (
                <label
                  key={cmp.id}
                  className="flex items-center gap-2 text-[11px] cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={(element.components || []).includes(cmp.id)}
                    onChange={() => toggleArrayItem('components', cmp.id)}
                  />
                  <span className="font-mono-tabular">{cmp.id}</span>
                  <span className="truncate" style={{ color: 'var(--text-muted)' }}>
                    — {cmp.title}
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Shared Interaction: 'uses' -> any element (for Process and Class) */}
        {['process', 'class'].includes(element.type) && (
          <div
            className="pt-3 border-t"
            style={{ borderColor: 'var(--border-hairline)' }}
          >
            <div className="font-medium mb-1.5">
              Взаимодействует / Использует (отношение uses)
            </div>
            <div
              className="max-h-32 overflow-y-auto p-2 rounded border space-y-1"
              style={{
                backgroundColor: 'var(--bg-subtle)',
                borderColor: 'var(--border-hairline)',
              }}
            >
              {otherElements.map((oe) => (
                <label
                  key={oe.id}
                  className="flex items-center gap-2 text-[11px] cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={(element.uses || []).includes(oe.id)}
                    onChange={() => toggleArrayItem('uses', oe.id)}
                  />
                  <span className="font-mono-tabular">{oe.id}</span>
                  <span className="truncate" style={{ color: 'var(--text-muted)' }}>
                    — {oe.title}
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* AI / Modeling Transformation Card (e.g. Idea -> System + Classes) */}
        <div
          className="pt-3 border-t space-y-2"
          style={{ borderColor: 'var(--border-hairline)' }}
        >
          <div className="flex items-center gap-1.5 font-medium">
            <Sparkles className="w-3.5 h-3.5" style={{ color: 'var(--ctx-pos)' }} />
            <span>Преобразовать / развернуть элемент</span>
          </div>
          <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            Создать на базе «{element.title}» связанные структурные блоки с сохранением ссылки на источник ({element.id}):
          </p>
          <div className="grid grid-cols-1 gap-1.5">
            <button
              type="button"
              onClick={() => onTransformElement(element, 'system_pack')}
              className="px-2.5 py-1.5 rounded text-left text-[11px] btn-ctx-pos-soft cursor-pointer"
            >
              → Развернуть в Систему + Компонент + Класс + Процесс
            </button>
            <button
              type="button"
              onClick={() => onTransformElement(element, 'class_hierarchy')}
              className="px-2.5 py-1.5 rounded text-left text-[11px] border cursor-pointer"
              style={{
                backgroundColor: 'var(--bg-subtle)',
                borderColor: 'var(--border-hairline)',
              }}
            >
              → Выделить Класс + эталонный Объект-экземпляр
            </button>
          </div>
        </div>

        {/* Delete Element with Contextual Positive/Negative Confirmation */}
        <div
          className="pt-3 border-t"
          style={{ borderColor: 'var(--border-hairline)' }}
        >
          {!confirmingDelete ? (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              className="w-full py-1.5 px-3 rounded text-xs flex items-center justify-center gap-1.5 btn-ctx-neg-soft cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Удалить элемент из плана</span>
            </button>
          ) : (
            <div
              className="p-2.5 rounded border space-y-2"
              style={{
                backgroundColor: 'var(--bg-subtle)',
                borderColor: 'var(--border-strong)',
              }}
            >
              <div className="text-[11px] font-medium">
                Удалить «{element.title}» ({element.id})?
              </div>
              <div className="flex items-center gap-2">
                {/* "Да" colored with positive contextual variable, "Нет" with negative contextual variable per Spec Section 2 */}
                <button
                  type="button"
                  onClick={() => {
                    onDeleteElement(element.id);
                    setConfirmingDelete(false);
                  }}
                  className="flex-1 py-1 px-2 rounded text-xs font-medium btn-ctx-pos cursor-pointer"
                >
                  Да
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
                  className="flex-1 py-1 px-2 rounded text-xs font-medium btn-ctx-neg cursor-pointer"
                >
                  Нет
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
};

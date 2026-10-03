import { useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { PlanElement } from '../types/planager';
import { SearchableCategorySelect, type SearchableSelectCategory } from './ui/SearchableCategorySelect';

interface ClassFieldsEditorProps {
  element: PlanElement;
  elements: PlanElement[];
  onChange: (element: PlanElement) => void;
  onCursorLine: (line: number) => void;
  tx: (ru: string, en: string) => string;
}

const STANDARD_FIELD_TYPES = ['string', 'int', 'float', 'bool'];

export function ClassFieldsEditor({ element, elements, onChange, onCursorLine, tx }: ClassFieldsEditorProps) {
  const [isAddingField, setIsAddingField] = useState(false);
  const [fieldName, setFieldName] = useState('');
  const [fieldType, setFieldType] = useState('string');
  const [fieldDescription, setFieldDescription] = useState('');
  const classes = elements.filter((candidate) => candidate.type === 'class');
  const fieldTypeCategories: SearchableSelectCategory[] = [
    {
      id: 'standard',
      label: tx('Стандартные типы', 'Standard types'),
      tone: 'positive',
      options: STANDARD_FIELD_TYPES.map((dataType) => ({ value: dataType, label: dataType })),
    },
    {
      id: 'references',
      label: tx('Ссылочные типы', 'Reference types'),
      tone: 'negative',
      options: [{
        value: 'procedure',
        label: tx('Процедура', 'Procedure'),
        searchText: 'procedure process процесс-функция',
      }],
    },
    ...(classes.length > 0 ? [{
      id: 'classes',
      label: tx('Классы проекта', 'Project classes'),
      tone: 'positive' as const,
      options: classes.map((classElement) => ({
        value: classElement.id,
        label: `${classElement.title} · ${classElement.id}`,
        searchText: classElement.id,
      })),
    }] : []),
  ];

  const addField = (selectedType = fieldType) => {
    const name = fieldName.trim();
    if (!name) return;
    onChange({
      ...element,
      fields: [
        ...(element.fields || []),
        {
          name,
          dataType: selectedType || 'string',
          description: fieldDescription.trim() || 'поле',
        },
      ],
    });
    setFieldName('');
    setFieldType('string');
    setFieldDescription('');
    setIsAddingField(false);
  };

  const applyOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      addField();
    }
  };

  const formatType = (dataType: string) => {
    const reference = elements.find((candidate) => candidate.id === dataType);
    if (reference) return `${reference.title} (${reference.id})`;
    if (dataType === 'procedure') return tx('Процедура', 'Procedure');
    return dataType;
  };

  return (
    <div className="field-row" onClick={() => onCursorLine(7)}>
      <div className="field-label">{tx('Поля', 'Fields')}</div>
      <div className="field-value space-y-2">
        {(element.fields || []).map((field, index) => (
          <div key={`${field.name}-${index}`} className="flex min-w-0 items-center justify-between gap-3 text-xs mono py-1 border-b border-[var(--border)]">
            <span className="min-w-0 flex-1 truncate" title={`${field.name}: ${formatType(field.dataType)} — ${field.description}`}>
              <strong style={{ color: 'var(--ink)' }}>{field.name}</strong>
              : {formatType(field.dataType)} — {field.description}
            </span>
            <button
              type="button"
              onClick={() => onChange({
                ...element,
                fields: (element.fields || []).filter((_, fieldIndex) => fieldIndex !== index),
              })}
              className="text-[11px] hover:text-[var(--ctx-neg-text)] cursor-pointer"
            >
              {tx('удалить', 'delete')}
            </button>
          </div>
        ))}
        {!isAddingField ? (
          <button
            type="button"
            onClick={() => setIsAddingField(true)}
            className="btn flex items-center justify-center"
            style={{ width: 30, height: 30, padding: 0 }}
            title={tx('Добавить поле', 'Add field')}
            aria-label={tx('Добавить поле', 'Add field')}
          >
            +
          </button>
        ) : (
          <div className="flex items-center gap-2 pt-1 w-full flex-wrap">
            <input
              autoFocus
              placeholder={tx('имя_поля', 'field_name')}
              value={fieldName}
              onChange={(event) => setFieldName(event.target.value)}
              onKeyDown={applyOnEnter}
              className="sys-input mono min-w-0 flex-1"
              style={{ minWidth: '110px' }}
            />
            <SearchableCategorySelect
              value={fieldType}
              categories={fieldTypeCategories}
              placeholder={tx('Выберите тип поля', 'Choose a field type')}
              searchPlaceholder={tx('Поиск типа или класса...', 'Search type or class...')}
              emptyLabel={tx('Совпадений нет', 'No matching types')}
              ariaLabel={tx('Тип данных поля', 'Field data type')}
              onChange={setFieldType}
              onCommit={addField}
              style={{ minWidth: '130px' }}
            />
            <input
              placeholder={tx('описание', 'description')}
              value={fieldDescription}
              onChange={(event) => setFieldDescription(event.target.value)}
              onKeyDown={applyOnEnter}
              className="sys-input flex-1 min-w-0"
            />
            <button type="button" onClick={() => addField()} className="btn shrink-0">
              {tx('Добавить', 'Add')}
            </button>
            <button type="button" onClick={() => { setIsAddingField(false); setFieldName(''); setFieldType('string'); setFieldDescription(''); }} className="btn shrink-0" title={tx('Отмена', 'Cancel')}>
              ×
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

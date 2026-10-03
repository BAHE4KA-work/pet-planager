import type { Dispatch, DragEvent, SetStateAction } from 'react';
import { Blocks, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import type { ElementType, LocaleKey, PlanElement, UnitLibraryItem } from '../types/planager';
import { TYPE_HEADERS_RU } from '../utils/pgrCodec';
import { localizedText } from '../utils/localization';
import { LibraryIcon } from './LibraryIcon';
import { ElementTypeIcon } from './ElementTypeIcon';
import { EmptyState } from './ui/EmptyState';

const UNIT_TYPE_LABELS_EN: Record<ElementType, string> = {
  system: 'System',
  class: 'Class',
  process: 'Process function',
  component: 'Component',
  object: 'Object',
  idea: 'Idea',
};

type LibraryCategory = 'all' | ElementType;

const formatUnitSavedAt = (value: string, locale: LocaleKey): string => {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Intl.DateTimeFormat(locale === 'ru' ? 'ru-RU' : 'en-US', {
    dateStyle: 'short', timeStyle: 'short',
  }).format(timestamp);
};

interface UnitLibraryViewProps {
  leftPanelOpen: boolean;
  setLeftPanelOpen: Dispatch<SetStateAction<boolean>>;
  locale: LocaleKey;
  elements: PlanElement[];
  unitLibrary: UnitLibraryItem[];
  search: string;
  onSearchChange: (value: string) => void;
  category: LibraryCategory;
  onCategoryChange: (value: LibraryCategory) => void;
  onAddUnit: (unit: UnitLibraryItem) => void;
  onSaveElements: (elements: PlanElement[]) => void;
}

export function UnitLibraryView({
  leftPanelOpen, setLeftPanelOpen, locale, elements, unitLibrary, search,
  onSearchChange, category, onCategoryChange, onAddUnit, onSaveElements,
}: UnitLibraryViewProps) {
  const tx = (ru: string, en: string) => localizedText(locale, ru, en);
  const categories: { key: LibraryCategory; label: string }[] = [
    { key: 'all', label: tx('Все юниты', 'All units') },
    { key: 'system', label: tx('Системы', 'Systems') },
    { key: 'class', label: tx('Классы', 'Classes') },
    { key: 'component', label: tx('Компоненты', 'Components') },
    { key: 'process', label: tx('Процессы', 'Processes') },
    { key: 'object', label: tx('Объекты', 'Objects') },
    { key: 'idea', label: tx('Идеи', 'Ideas') },
  ];
  const query = search.trim().toLocaleLowerCase();
  const visibleUnits = unitLibrary.filter(({ element }) => {
    if (category !== 'all' && element.type !== category) return false;
    return !query || element.title.toLocaleLowerCase().includes(query) || element.id.toLocaleLowerCase().includes(query);
  });

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const raw = event.dataTransfer.getData('text/plain');
    if (!raw) return;
    let ids = [raw];
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.every((id): id is string => typeof id === 'string')) ids = parsed;
    } catch {
      // Single-element drag payloads are plain IDs.
    }
    const dragged = new Set(ids);
    onSaveElements(elements.filter((element) => dragged.has(element.id)));
  };

  return (
    <div className="workspace-2col">
      <button
        type="button"
        onClick={() => setLeftPanelOpen(true)}
        className={`btn p-1.5 panel-expand-btn left ${leftPanelOpen ? 'is-hidden' : ''}`}
        title={tx('Развернуть левую панель', 'Expand left panel')}
      >
        <PanelLeftOpen size={15} />
      </button>
      <div className={`panel files-column ${!leftPanelOpen ? 'collapsed' : ''}`}>
        <div className="files-column-inner">
          <div className="p-3 border-b border-[var(--border)] shrink-0 flex items-center gap-1.5">
            <input
              type="text"
              placeholder={tx('Поиск по библиотеке...', 'Search library...')}
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              className="sys-input flex-1 min-w-0 text-xs"
            />
            <button
              type="button"
              onClick={() => setLeftPanelOpen(false)}
              className="btn p-1.5 shrink-0"
              title={tx('Свернуть левую панель', 'Collapse left panel')}
            >
              <PanelLeftClose size={15} />
            </button>
          </div>
          <div className="panel-header"><span className="label">{tx('Категории', 'Categories')}</span></div>
          <div className="p-3 space-y-1">
            {categories.map((item) => (
              <button
                key={item.key}
                type="button"
                aria-pressed={category === item.key}
                onClick={() => onCategoryChange(item.key)}
                className={`tree-node w-full text-left ${category === item.key ? 'active' : ''}`}
              >
                {item.key === 'all' ? <Blocks size={15} aria-hidden="true" /> : <ElementTypeIcon type={item.key} size={15} />}
                <span>{item.label}</span>
              </button>
            ))}
          </div>
          <div className="panel-header mt-2"><span className="label">{tx('Перетащите в библиотеку', 'Drag to the library')}</span></div>
          <div className="p-3 flex-1 overflow-y-auto space-y-1">
            {elements.map((element) => (
              <div
                key={element.id}
                draggable
                onDragStart={(event) => event.dataTransfer.setData('text/plain', element.id)}
                className="tree-node"
              >
                <span className="mono truncate">{element.id}</span>
                <span className="pill">{tx('перетащить', 'drag')}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="panel editor-column">
        <div className="editor-scroll" style={{ paddingLeft: leftPanelOpen ? '24px' : '52px' }}>
          <div className="editor-meta">
            <span className="label">{tx('ПОВТОРНО ИСПОЛЬЗУЕМЫЕ АРХИТЕКТУРНЫЕ БЛОКИ', 'REUSABLE ARCHITECTURE UNITS')}</span>
            <span className="pill">{tx('Юнитов', 'Units')}: {unitLibrary.length}</span>
          </div>
          <h1 className="title-display" style={{ fontSize: '2rem' }}>{tx('Библиотека юнитов', 'Unit Library')}</h1>
          {visibleUnits.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {visibleUnits.map((unit) => (
              <article key={unit.unitId} className="flex min-h-64 flex-col rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 transition-colors hover:border-[var(--ctx-pos-border)] hover:bg-[var(--surface-hover)]">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-[var(--ctx-pos-border)] bg-[var(--ctx-pos-soft)] text-[var(--ctx-pos-text)]">
                    <LibraryIcon name={unit.iconName} size={25} />
                  </div>
                  <span className="pill">{tx(TYPE_HEADERS_RU[unit.element.type], UNIT_TYPE_LABELS_EN[unit.element.type])}</span>
                </div>
                <h2 className="text-base font-semibold leading-snug text-[var(--ink)]">{unit.element.title}</h2>
                <p className="mono mt-1 break-all text-[11px] text-[var(--ink-muted)]">{unit.element.id}</p>
                <p className="mt-3 line-clamp-3 flex-1 whitespace-pre-wrap text-sm leading-6 text-[var(--ink-muted)]">
                  {unit.element.description.trim() || tx('Описание не задано.', 'No description provided.')}
                </p>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] pt-3">
                  <span className="mono text-[10px] text-[var(--ink-muted)]">{formatUnitSavedAt(unit.savedAt, locale)}</span>
                  <button type="button" onClick={() => onAddUnit(unit)} className="btn primary">
                    {tx('Добавить в проект', 'Add to project')}
                  </button>
                </div>
              </article>
            ))}
          </div>
          ) : (
            <EmptyState
              title={tx('В библиотеке пока пусто', 'The library is empty')}
              description={query
                ? tx('По этому запросу ничего не найдено.', 'No units match this search.')
                : tx('Сохранённые юниты появятся здесь плитками. Выберите элемент и сохраните его в библиотеку.', 'Saved units will appear here as cards. Select an element and save it to the library.')}
            />
          )}
          <div
            onDragOver={(event) => event.preventDefault()}
            onDrop={handleDrop}
            className="mt-6 rounded-xl border border-dashed border-[var(--border)] p-6 text-center mono text-xs text-[var(--ink-muted)] transition-colors hover:border-[var(--ctx-pos-border)] hover:bg-[var(--ctx-pos-soft)]"
          >
            {tx('Перетащите элемент сюда, чтобы сохранить его в библиотеку', 'Drop an element here to save it to the library')}
          </div>
        </div>
      </div>
    </div>
  );
}

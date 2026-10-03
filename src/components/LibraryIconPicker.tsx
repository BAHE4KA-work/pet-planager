import { useMemo, useState } from 'react';
import { iconNames } from 'lucide-react/dynamic.mjs';
import { Blocks, Code2, Database, FileText, GitBranch, Lightbulb, Palette, Shapes, Users, Workflow } from 'lucide-react';
import type { ComponentType } from 'react';
import type { ElementType, LocaleKey } from '../types/planager';
import { localizedText } from '../utils/localization';
import { Button } from './ui/Button';
import { Dialog } from './ui/Dialog';
import { LibraryIcon } from './LibraryIcon';

type CategoryKey = 'all' | 'architecture' | 'development' | 'data' | 'files' | 'flow' | 'people' | 'design' | 'ideas' | 'status' | 'other';
type CategoryDefinition = { key: CategoryKey; labelRu: string; labelEn: string; Icon: ComponentType<{ size?: number }> };

const CATEGORIES: CategoryDefinition[] = [
  { key: 'all', labelRu: 'Все иконки', labelEn: 'All icons', Icon: Shapes },
  { key: 'architecture', labelRu: 'Архитектура', labelEn: 'Architecture', Icon: Blocks },
  { key: 'development', labelRu: 'Разработка', labelEn: 'Development', Icon: Code2 },
  { key: 'data', labelRu: 'Данные', labelEn: 'Data', Icon: Database },
  { key: 'files', labelRu: 'Файлы', labelEn: 'Files', Icon: FileText },
  { key: 'flow', labelRu: 'Связи и процессы', labelEn: 'Links and flow', Icon: GitBranch },
  { key: 'people', labelRu: 'Люди', labelEn: 'People', Icon: Users },
  { key: 'design', labelRu: 'Дизайн и медиа', labelEn: 'Design and media', Icon: Palette },
  { key: 'ideas', labelRu: 'Идеи', labelEn: 'Ideas', Icon: Lightbulb },
  { key: 'status', labelRu: 'Статусы', labelEn: 'Status', Icon: Workflow },
  { key: 'other', labelRu: 'Прочее', labelEn: 'Other', Icon: Shapes },
];

const CATEGORY_PATTERNS: Record<Exclude<CategoryKey, 'all' | 'other'>, RegExp> = {
  architecture: /block|box|building|circuit|cpu|database|factory|hard-drive|layers|network|package|server|container|component|diagram|layout|microchip|workflow/,
  development: /code|bug|git|terminal|brace|bracket|command|file-code|variable|function|binary|bot|wrench|settings|tool|commit|pull-request|branch/,
  data: /chart|table|list|database|filter|search|scan|spreadsheet|calculator|file-json|bar-chart|pie-chart|activity|database|rows|columns/,
  files: /file|folder|book|archive|clipboard|notebook|document|receipt|paperclip|sticky-note|newspaper|scroll|files|save|download|upload/,
  flow: /arrow|link|share|network|merge|split|combine|route|waypoint|workflow|git|move|turn|corner|reply|forward|external|redo|undo|repeat|shuffle/,
  people: /user|users|contact|handshake|message|mail|phone|bell|chat|speech|headset|megaphone|person|smile|accessibility/,
  design: /image|camera|video|music|palette|brush|paint|pen|type|shapes|square|circle|triangle|eye|frame|crop|pencil|contrast|swatch/,
  ideas: /lightbulb|brain|spark|rocket|compass|target|map|globe|leaf|telescope|atom|flask|beaker|wand|star|sunrise|idea|bulb/,
  status: /alert|check|circle|badge|shield|star|flag|heart|zap|bolt|info|help|warning|clock|timer|loader|thumbs|bookmark|x$|minus|plus|status|circle-check/,
};

function categoryForIcon(name: string): CategoryKey {
  for (const category of CATEGORIES) {
    if (category.key !== 'all' && category.key !== 'other' && CATEGORY_PATTERNS[category.key].test(name)) return category.key;
  }
  return 'other';
}

type PickerStep = 'category' | 'icon';

export function LibraryIconPicker({
  open, locale, elementType, elementTitle, defaultIcon, selectedIcon, queueTotal,
  onIconChange, onConfirm, onClose,
}: {
  open: boolean;
  locale: LocaleKey;
  elementType: ElementType | null;
  elementTitle: string;
  defaultIcon: string;
  selectedIcon: string;
  queueTotal: number;
  onIconChange: (name: string) => void;
  onConfirm: (iconName: string) => void;
  onClose: () => void;
}) {
  const tx = (ru: string, en: string) => localizedText(locale, ru, en);
  const initialCategory: CategoryKey = elementType === 'system' || elementType === 'component'
    ? 'architecture'
    : elementType === 'class' ? 'development'
    : elementType === 'process' ? 'flow'
    : elementType === 'idea' ? 'ideas'
    : 'all';
  const [step, setStep] = useState<PickerStep>('category');
  const [category, setCategory] = useState<CategoryKey>(initialCategory);
  const [search, setSearch] = useState('');
  const [hasCustomIconSelection, setHasCustomIconSelection] = useState(false);
  const query = search.trim().toLocaleLowerCase();
  const filteredIcons = useMemo(() => {
    const matches = iconNames.filter((name) => {
      if (category !== 'all' && categoryForIcon(name) !== category) return false;
      return !query || name.includes(query);
    });
    return { all: matches.length, visible: !query && category === 'all' ? matches.slice(0, 96) : matches.slice(0, 144) };
  }, [category, query]);
  const description = queueTotal > 1
    ? `${tx(`${queueTotal} элементов в очереди`, `${queueTotal} units queued`)} · ${elementTitle}`
    : elementTitle;

  return (
    <>
      <Dialog
        open={open && step === 'category'}
        title={tx('Выберите категорию иконки', 'Choose an icon category')}
        description={description}
        onClose={onClose}
        closeLabel={tx('Отмена', 'Cancel')}
        className="!max-w-5xl"
        style={{ maxWidth: 'min(72rem, calc(100vw - 2rem))' }}
        actions={(
          <>
            <Button onClick={onClose}>{tx('Отмена', 'Cancel')}</Button>
            <Button variant="primary" onClick={() => onConfirm(defaultIcon)}>
              {tx('Сохранить со значком по умолчанию', 'Save with default icon')}
            </Button>
          </>
        )}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <span className="pill">{tx('ШАГ 1 ИЗ 2', 'STEP 1 OF 2')}</span>
          <p className="text-xs text-[var(--ink-muted)]">{tx('Выберите тему, чтобы сузить список иконок.', 'Choose a category to narrow down the icon list.')}</p>
        </div>
        <div className="grid max-h-[56vh] grid-cols-2 gap-3 overflow-y-auto p-1 sm:grid-cols-3 lg:grid-cols-4" role="list" aria-label={tx('Категории иконок', 'Icon categories')}>
          {CATEGORIES.map(({ key, labelRu, labelEn, Icon }) => (
            <button
              key={key}
              type="button"
              aria-pressed={category === key}
              onClick={() => {
                setCategory(key);
                setSearch('');
                setHasCustomIconSelection(false);
                setStep('icon');
              }}
              className={`flex min-h-28 flex-col items-start justify-between gap-4 rounded-xl border p-4 text-left transition-colors ${category === key ? 'border-[var(--ctx-pos-border)] bg-[var(--ctx-pos-soft)] text-[var(--ctx-pos-text)]' : 'border-[var(--border)] bg-[var(--bg)] text-[var(--ink)] hover:border-[var(--ctx-pos-border)] hover:bg-[var(--surface-hover)]'}`}
            >
              <Icon size={25} />
              <span className="text-sm font-medium">{tx(labelRu, labelEn)}</span>
            </button>
          ))}
        </div>
      </Dialog>

      <Dialog
        open={open && step === 'icon'}
        title={tx('Выберите конкретную иконку', 'Choose an icon')}
        description={`${CATEGORIES.find((item) => item.key === category)?.[locale === 'ru' ? 'labelRu' : 'labelEn'] ?? ''} · ${description}`}
        onClose={onClose}
        closeLabel={tx('Отмена', 'Cancel')}
        className="!max-w-5xl"
        style={{ maxWidth: 'min(72rem, calc(100vw - 2rem))' }}
        actions={(
          <>
            <Button onClick={() => setStep('category')}>{tx('Назад к категориям', 'Back to categories')}</Button>
            <Button onClick={onClose}>{tx('Отмена', 'Cancel')}</Button>
            <Button onClick={() => onConfirm(defaultIcon)}>{tx('Оставить значок по умолчанию', 'Keep default icon')}</Button>
            <Button variant="primary" disabled={!hasCustomIconSelection} onClick={() => onConfirm(selectedIcon)}>
              {tx('Сохранить выбранную иконку', 'Save selected icon')}
            </Button>
          </>
        )}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <span className="pill">{tx('ШАГ 2 ИЗ 2', 'STEP 2 OF 2')}</span>
          <p className="text-xs text-[var(--ink-muted)]">{tx('Выбор иконки необязателен.', 'Choosing a custom icon is optional.')}</p>
        </div>
        <label className="mb-4 flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3">
          <span className="mono text-[10px] text-[var(--ink-muted)]">⌕</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={tx('Найти иконку Lucide…', 'Search Lucide icons…')}
            aria-label={tx('Поиск иконки', 'Search icons')}
            className="min-w-0 flex-1 bg-transparent py-2.5 text-sm outline-none"
          />
        </label>
        <div className="grid max-h-[55vh] min-h-72 grid-cols-3 gap-2 overflow-y-auto pr-1 sm:grid-cols-5 lg:grid-cols-7 xl:grid-cols-8" role="listbox" aria-label={tx('Иконки', 'Icons')}>
          {filteredIcons.visible.map((name) => (
            <button
              key={name}
              type="button"
              role="option"
              aria-selected={hasCustomIconSelection && selectedIcon === name}
              aria-label={name.replaceAll('-', ' ')}
              title={name.replaceAll('-', ' ')}
              onClick={() => {
                onIconChange(name);
                setHasCustomIconSelection(true);
              }}
              className={`flex min-h-[76px] min-w-0 flex-col items-center justify-center gap-2 rounded-lg border p-2 text-[10px] transition-colors ${hasCustomIconSelection && selectedIcon === name ? 'border-[var(--ctx-pos-border)] bg-[var(--ctx-pos-soft)] text-[var(--ctx-pos-text)]' : 'border-[var(--border)] text-[var(--ink-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]'}`}
            >
              <LibraryIcon name={name} size={23} />
              <span className="w-full truncate text-center">{name}</span>
            </button>
          ))}
          {filteredIcons.all === 0 ? <p className="col-span-full py-8 text-center text-sm text-[var(--ink-muted)]">{tx('Иконки не найдены', 'No icons found')}</p> : null}
        </div>
        {filteredIcons.all > filteredIcons.visible.length ? (
          <p className="mt-2 text-center text-[10px] text-[var(--ink-muted)]">
            {tx(`Показаны ${filteredIcons.visible.length} из ${filteredIcons.all}. Уточните поиск.`, `Showing ${filteredIcons.visible.length} of ${filteredIcons.all}. Refine the search.`)}
          </p>
        ) : null}
      </Dialog>
    </>
  );
}

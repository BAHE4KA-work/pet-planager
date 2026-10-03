import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { Check, ChevronDown, ChevronRight, Search } from 'lucide-react';

export interface SearchableSelectOption {
  value: string;
  label: string;
  searchText?: string;
}

export interface SearchableSelectCategory {
  id: string;
  label: string;
  options: SearchableSelectOption[];
  tone?: 'positive' | 'negative';
}

interface SearchableCategorySelectProps {
  value: string;
  categories: SearchableSelectCategory[];
  placeholder: string;
  searchPlaceholder: string;
  emptyLabel: string;
  ariaLabel: string;
  className?: string;
  style?: CSSProperties;
  onChange: (value: string) => void;
  onCommit?: (value: string) => void;
}

export function SearchableCategorySelect({
  value,
  categories,
  placeholder,
  searchPlaceholder,
  emptyLabel,
  ariaLabel,
  className = '',
  style,
  onChange,
  onCommit,
}: SearchableCategorySelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ standard: true });
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const popoverId = useId();

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredCategories = useMemo(() => categories.map((category) => ({
    ...category,
    options: category.options.filter((option) => {
      if (!normalizedQuery) return true;
      return `${option.label} ${option.value} ${option.searchText || ''}`.toLocaleLowerCase().includes(normalizedQuery);
    }),
  })).filter((category) => category.options.length > 0), [categories, normalizedQuery]);

  const visibleOptions = filteredCategories.flatMap((category) => {
    const isExpanded = expanded[category.id] ?? Boolean(normalizedQuery);
    return isExpanded ? category.options : [];
  });
  const selectedOption = categories.flatMap((category) => category.options).find((option) => option.value === value);

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery('');
        setActiveIndex(-1);
      }
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const close = (restoreFocus = true) => {
    setOpen(false);
    setQuery('');
    setActiveIndex(-1);
    if (restoreFocus) window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const choose = (option: SearchableSelectOption) => {
    onChange(option.value);
    close();
  };

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!visibleOptions.length) return;
      setActiveIndex((current) => {
        if (current < 0) return event.key === 'ArrowDown' ? 0 : visibleOptions.length - 1;
        return event.key === 'ArrowDown'
          ? Math.min(current + 1, visibleOptions.length - 1)
          : Math.max(current - 1, 0);
      });
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const current = activeIndex >= 0
        ? visibleOptions[activeIndex]
        : visibleOptions.find((option) => option.value === value) || (visibleOptions.length === 1 ? visibleOptions[0] : undefined);
      if (current) onChange(current.value);
      close();
      onCommit?.(current?.value ?? value);
    }
  };

  return (
    <div ref={rootRef} className={`relative min-w-0 flex-1 ${className}`} style={style}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={popoverId}
        onClick={() => open ? close(false) : setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && open) {
            event.preventDefault();
            close();
          } else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className={`sys-input mono flex w-full min-w-0 items-center justify-between gap-2 text-left cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${open ? 'border-[var(--accent)]' : ''}`}
      >
        <span className="min-w-0 truncate">{selectedOption?.label || value || placeholder}</span>
        <ChevronDown size={15} className={`shrink-0 text-[var(--ink-muted)] transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>

      {open && (
        <div
          id={popoverId}
          role="dialog"
          aria-label={ariaLabel}
          className="absolute left-0 top-full z-[100] mt-1 flex flex-col overflow-hidden rounded-xl border border-[var(--ctx-pos-border)] bg-[var(--surface)] shadow-2xl"
          style={{ width: 'min(24rem, calc(100vw - 32px))', maxHeight: 'min(24rem, calc(100vh - 80px))' }}
        >
          <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] bg-[var(--bg)] px-3 py-2">
            <Search size={14} className="shrink-0 text-[var(--ctx-pos-text)]" aria-hidden="true" />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(event) => { setQuery(event.target.value); setActiveIndex(-1); }}
              onKeyDown={handleSearchKeyDown}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              className="min-w-0 flex-1 bg-transparent text-xs text-[var(--ink)] outline-none placeholder:text-[var(--ink-muted)]"
            />
            <span className="mono text-[10px] text-[var(--ink-muted)]">{filteredCategories.reduce((count, category) => count + category.options.length, 0)}</span>
          </div>

          <div className="min-h-0 overflow-y-auto p-1.5">
            {filteredCategories.length === 0 ? (
              <p className="px-3 py-5 text-center text-xs text-[var(--ink-muted)]">{emptyLabel}</p>
            ) : filteredCategories.map((category) => {
              const isExpanded = expanded[category.id] ?? Boolean(normalizedQuery);
              const toneText = category.tone === 'negative' ? 'var(--ctx-neg-text)' : 'var(--ctx-pos-text)';
              const toneSoft = category.tone === 'negative' ? 'var(--ctx-neg-soft)' : 'var(--ctx-pos-soft)';
              const toneBorder = category.tone === 'negative' ? 'var(--ctx-neg-border)' : 'var(--ctx-pos-border)';
              return (
                <section key={category.id} className="overflow-hidden rounded-lg">
                  <button
                    type="button"
                    aria-expanded={isExpanded}
                    onClick={() => setExpanded((current) => ({ ...current, [category.id]: !isExpanded }))}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-[var(--ink)] transition-colors hover:bg-[var(--surface-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
                  >
                    {isExpanded ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
                    <span className="size-2 shrink-0 rounded-full" style={{ background: toneText }} aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate font-medium">{category.label}</span>
                    <span className="rounded-md border px-1.5 py-0.5 font-mono text-[10px]" style={{ color: toneText, background: toneSoft, borderColor: toneBorder }}>
                      {category.options.length}
                    </span>
                  </button>
                  {isExpanded && (
                    <div role="listbox" aria-label={category.label} className="ml-3 border-l pl-1.5" style={{ borderColor: toneBorder }}>
                      {category.options.map((option) => {
                        const selected = option.value === value;
                        const optionIndex = visibleOptions.findIndex((candidate) => candidate.value === option.value);
                        const active = optionIndex === activeIndex;
                        return (
                          <button
                            key={option.value}
                            type="button"
                            role="option"
                            aria-selected={selected}
                            onMouseEnter={() => setActiveIndex(optionIndex)}
                            onClick={() => choose(option)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault();
                                onChange(option.value);
                                close();
                                onCommit?.(option.value);
                              }
                            }}
                            className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${active || selected ? '' : 'hover:bg-[var(--surface-hover)]'}`}
                            style={active || selected ? { background: toneSoft } : undefined}
                          >
                            <span className="min-w-0 flex-1 truncate text-[var(--ink)]" title={option.label}>{option.label}</span>
                            {selected && <Check size={14} className="shrink-0" style={{ color: toneText }} aria-hidden="true" />}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

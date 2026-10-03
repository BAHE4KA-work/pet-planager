import { Sparkles } from 'lucide-react';
import type { LocaleKey } from '../types/planager';
import { localizedText } from '../utils/localization';

export type PrimaryTab = 'kb' | 'canvas' | 'library' | 'settings';

interface AppHeaderProps {
  activeTab: PrimaryTab;
  locale: LocaleKey;
  labels: { tabKb: string; tabCanvas: string; tabLibrary: string; tabSettings: string; aiBtn: string };
  preview: boolean;
  saving: boolean;
  onTabChange: (tab: PrimaryTab) => void;
  onCreateElement: () => void;
  onOpenAssistant: () => void;
  onSaveCurrentToLibrary: () => void;
}

export function AppHeader({
  activeTab, locale, labels, preview, saving,
  onTabChange, onCreateElement,
  onOpenAssistant, onSaveCurrentToLibrary,
}: AppHeaderProps) {
  const tx = (ru: string, en: string) => localizedText(locale, ru, en);
  const canCreateInContext = activeTab === 'kb' || activeTab === 'canvas';

  return (
    <header className="sys-header">
      <div className="flex items-center gap-8">
        <button type="button" className="brand" onClick={() => onTabChange('kb')}>
          PLANAGER
        </button>
        <nav className="nav-links">
          {([
            ['kb', labels.tabKb],
            ['canvas', labels.tabCanvas],
            ['library', labels.tabLibrary],
            ['settings', labels.tabSettings],
          ] as const).map(([tab, label]) => (
            <button
              key={tab}
              type="button"
              onClick={() => onTabChange(tab)}
              className={`nav-link ${activeTab === tab ? 'active' : ''}`}
            >
              {label}
            </button>
          ))}
        </nav>
      </div>

      <div className="flex items-center gap-3">
        {preview && (
          <span className="pill text-[10px]" title={tx('Данные этого режима хранятся только в браузере', 'Data in this mode is stored only in the browser')}>
            Browser preview
          </span>
        )}
        {saving && <span className="text-[10px] text-[var(--ink-muted)]">{tx('Сохранение…', 'Saving…')}</span>}
        {canCreateInContext && (
          <>
            <button
              type="button"
              onClick={onCreateElement}
              className="btn primary flex items-center justify-center text-sm font-bold"
              style={{ width: '28px', height: '28px', padding: 0 }}
              title={tx('Создать элемент', 'Create element')}
            >
              +
            </button>
            <button
              type="button"
              onClick={onOpenAssistant}
              className="btn btn-ai-shimmer flex items-center justify-center"
              style={{ width: '28px', height: '28px', padding: 0 }}
              title={labels.aiBtn}
            >
              <Sparkles size={14} />
            </button>
          </>
        )}
        {activeTab === 'library' && (
          <button
            type="button"
            onClick={onSaveCurrentToLibrary}
            className="btn primary"
            style={{ padding: '5px 12px', height: '28px' }}
          >
            {tx('Сохранить текущий в библиотеку', 'Save current element to library')}
          </button>
        )}
      </div>
    </header>
  );
}

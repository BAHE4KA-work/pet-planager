import { PanelRightClose } from 'lucide-react';
import type { ElementType, LocaleKey, PlanElement } from '../types/planager';
import { localizedText } from '../utils/localization';

interface ElementAttributesPanelProps {
  element: PlanElement;
  locale: LocaleKey;
  usedByIds: string[];
  confirmingDelete: boolean;
  onCollapse: () => void;
  onChange: (element: PlanElement) => void;
  onExpand: () => void;
  onRequestDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
}

export function ElementAttributesPanel({
  element, locale, usedByIds, confirmingDelete, onCollapse, onChange,
  onExpand, onRequestDelete, onConfirmDelete, onCancelDelete,
}: ElementAttributesPanelProps) {
  const tx = (ru: string, en: string) => localizedText(locale, ru, en);

  return (
    <div className="sidebar-section">
      <div className="section-title">
        <span>{tx('Атрибуты', 'Attributes')}</span>
        <button type="button" onClick={onCollapse} className="btn p-1.5" title={tx('Свернуть правую панель', 'Collapse right panel')}>
          <PanelRightClose size={15} />
        </button>
      </div>

      <div className="stat-line">
        <span className="stat-label">{tx('Тип', 'Type')}</span>
        <select value={element.type} onChange={(event) => onChange({ ...element, type: event.target.value as ElementType })} className="mono bg-transparent border-b border-[var(--border)] cursor-pointer">
          <option value="system">{tx('Система', 'System')}</option>
          <option value="class">{tx('Класс', 'Class')}</option>
          <option value="process">{tx('Процесс-функция', 'Process function')}</option>
          <option value="component">{tx('Компонент', 'Component')}</option>
          <option value="object">{tx('Объект', 'Object')}</option>
          <option value="idea">{tx('Идея-образ', 'Idea')}</option>
        </select>
      </div>

      <div className="stat-line">
        <span className="stat-label">{tx('Родитель', 'Parent')}</span>
        <span className="mono">{element.parent && element.parent !== '-' ? element.parent : 'None (-)'}</span>
      </div>
      <div className="stat-line">
        <span className="stat-label">{tx('Статус', 'Status')}</span>
        <span className="pill" style={{ color: 'var(--ctx-pos-text)', borderColor: 'var(--ctx-pos-border)' }}>{element.status}</span>
      </div>
      <div className="stat-line">
        <span className="stat-label">{tx('Метка', 'Tag')}</span>
        <button
          type="button"
          onClick={() => onChange({ ...element, mvp: !element.mvp })}
          className="pill cursor-pointer"
          style={{
            color: element.mvp ? 'var(--ctx-pos-text)' : 'var(--ctx-neg-text)',
            borderColor: element.mvp ? 'var(--ctx-pos-border)' : 'var(--ctx-neg-border)',
          }}
        >
          {element.mvp ? 'MVP' : tx('Backlog (Потом)', 'Backlog (later)')}
        </button>
      </div>
      <div className="stat-line">
        <span className="stat-label">{tx('Содержит', 'Has')}</span>
        <span className="mono truncate max-w-[170px]">{(element.components || []).join(', ') || '-'}</span>
      </div>
      <div className="stat-line">
        <span className="stat-label">{tx('Используется в', 'Used by')}</span>
        <span className="mono truncate max-w-[170px]">{usedByIds.join(', ') || '-'}</span>
      </div>

      <div className="btn-group">
        <button type="button" onClick={onExpand} className="btn flex-1">{tx('Развернуть', 'Expand')}</button>
        {!confirmingDelete ? (
          <button type="button" onClick={onRequestDelete} className="btn neg-outline flex-1">{tx('Удалить', 'Delete')}</button>
        ) : (
          <>
            <button type="button" onClick={onConfirmDelete} className="btn pos flex-1">{tx('Да', 'Yes')}</button>
            <button type="button" onClick={onCancelDelete} className="btn neg flex-1">{tx('Нет', 'No')}</button>
          </>
        )}
      </div>
    </div>
  );
}

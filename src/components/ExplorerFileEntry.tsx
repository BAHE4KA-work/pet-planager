import type { DragEvent, MouseEvent } from 'react';
import { ChevronDown, ChevronRight, FileText, Star } from 'lucide-react';
import type { LocaleKey, PlanElement } from '../types/planager';
import { ELEMENT_TYPE_ICONS } from './ElementTypeIcon';
import { localizedText } from '../utils/localization';
import { stripElementPrefix } from '../hooks/canvasLayout';

export type KbContextMenuTarget =
  | { type: 'empty' }
  | { type: 'file'; fileName: string }
  | { type: 'element'; elementId: string; fileName: string }
  | { type: 'folder'; folderName: string };

interface ExplorerFileEntryProps {
  fileName: string;
  isNested: boolean;
  fileElements: PlanElement[];
  locale: LocaleKey;
  active: boolean;
  dragTarget: boolean;
  collapsed: boolean;
  selectedId: string | null;
  aiContextIds: string[];
  starredItems: Set<string>;
  onContextMenu: (event: MouseEvent<HTMLElement>, target: KbContextMenuTarget) => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDragLeave: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onFileClick: () => void;
  onToggleCollapse: () => void;
  onElementDragStart: (element: PlanElement, event: DragEvent<HTMLDivElement>) => void;
  onElementDragEnd: () => void;
  onElementClick: (element: PlanElement, event: MouseEvent<HTMLDivElement>) => void;
}

export function ExplorerFileEntry({
  fileName, isNested, fileElements, locale, active, dragTarget, collapsed,
  selectedId, aiContextIds, starredItems, onContextMenu, onDragOver,
  onDragLeave, onDrop, onFileClick, onToggleCollapse, onElementDragStart,
  onElementDragEnd, onElementClick,
}: ExplorerFileEntryProps) {
  const tx = (ru: string, en: string) => localizedText(locale, ru, en);
  const shortName = isNested && fileName.includes('/')
    ? fileName.split('/').slice(1).join('/')
    : fileName;
  const fileIsStarred = starredItems.has(fileName);

  return (
    <div
      onContextMenu={(event) => onContextMenu(event, { type: 'file', fileName })}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      style={dragTarget ? {
        borderColor: 'var(--ctx-pos-text)',
        backgroundColor: 'var(--ctx-pos-soft)',
        boxShadow: 'inset 0 0 0 1px var(--ctx-pos-text)',
      } : undefined}
      className={`file-entry transition-colors ${isNested ? 'rounded mb-1' : ''} ${active ? 'active-file' : ''}`}
    >
      <div className="file-title" onClick={onFileClick}>
        <div className="flex items-center gap-1.5 min-w-0">
          <button
            type="button"
            onClick={(event) => { event.stopPropagation(); onToggleCollapse(); }}
            className="p-0.5 -ml-1 text-[var(--ink-muted)] hover:text-[var(--ink)] cursor-pointer rounded transition-colors flex items-center justify-center"
            title={collapsed ? tx('Развернуть элементы файла', 'Expand file elements') : tx('Свернуть элементы файла', 'Collapse file elements')}
          >
            {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
          </button>
          <FileText size={13} className="shrink-0 text-[var(--ink-muted)]" />
          <span className="truncate">{shortName}</span>
          {fileIsStarred && (
            <span title={tx('Отмечено как важное', 'Marked as important')} className="inline-flex items-center ml-0.5">
              <Star size={11} style={{ color: 'var(--ctx-neg-text)', fill: 'var(--ctx-neg-text)' }} className="shrink-0" />
            </span>
          )}
        </div>
        <span className="mono">{fileElements.length}</span>
      </div>

      {!collapsed && (
        <>
          {fileElements.length === 0 && (
            <div className="mono text-[10px] py-1.5 px-2 rounded border border-dashed border-[var(--border)] text-center text-[var(--ink-muted)]">
              {tx('Перетащите элементы сюда', 'Drop elements here')}
            </div>
          )}
          {fileElements.map((element) => {
            const selected = selectedId === element.id || aiContextIds.includes(element.id);
            const starred = starredItems.has(element.id);
            const TypeIcon = ELEMENT_TYPE_ICONS[element.type];
            return (
              <div
                key={element.id}
                draggable
                onContextMenu={(event) => onContextMenu(event, { type: 'element', elementId: element.id, fileName })}
                onDragStart={(event) => onElementDragStart(element, event)}
                onDragEnd={onElementDragEnd}
                onClick={(event) => onElementClick(element, event)}
                title={tx('ЛКМ — выбрать, Ctrl+ЛКМ — контекст ИИ, ПКМ — меню, перетаскивание — переместить', 'Click to select, Ctrl+click for AI focus, right-click for menu, drag to move')}
                className={`tree-node ${selected ? 'active' : ''}`}
              >
                <span className="mono truncate flex items-center gap-1.5 min-w-0" style={{ color: selected ? 'var(--ctx-pos-text)' : undefined }}>
                  <TypeIcon size={14} className="shrink-0" />
                  <span className="truncate">{stripElementPrefix(element.id)}</span>
                  {starred && (
                    <span title={tx('Отмечено как важное', 'Marked as important')} className="inline-flex items-center">
                      <Star size={10} style={{ color: 'var(--ctx-neg-text)', fill: 'var(--ctx-neg-text)' }} className="shrink-0" />
                    </span>
                  )}
                </span>
                {element.mvp && (
                  <span className="pill" style={{ color: 'var(--ctx-pos-text)', borderColor: 'var(--ctx-pos-border)' }}>MVP</span>
                )}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

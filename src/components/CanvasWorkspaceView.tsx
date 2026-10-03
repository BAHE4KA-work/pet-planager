import React from 'react';
import { ChevronDown, ChevronUp, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import type { AiContradiction, GraphEdge, LocaleKey, PlanElement, RelationType } from '../types/planager';
import { TYPE_HEADERS_RU } from '../utils/pgrCodec';
import { localizedText } from '../utils/localization';
import { getParallelEdgeOffsets, offsetGraphLine } from '../utils/graphGeometry';

export type CanvasRadialOptionId = 'conflicts' | 'proposals' | 'interview' | 'rescan' | 'node_transform' | 'node_open_kb' | 'node_save_lib' | 'node_delete';
type PrimaryTab = 'kb' | 'canvas' | 'library' | 'settings';
type RadialMenu = { mode: 'canvas' | 'node'; targetElementId?: string; centerX: number; centerY: number; cursorX: number; cursorY: number; hoveredId: CanvasRadialOptionId | null };
type RadialOption = { id: CanvasRadialOptionId; label: string; sublabel: string; startDeg: number; endDeg: number; angleDeg: number; isNegative?: boolean };
type Position = { x: number; y: number };
type CanvasMouseDownInfo = { nodeId: string; fileName: string; clientX: number; clientY: number; wasCtrl: boolean; wasAlreadyInMulti: boolean; didMove: boolean };
type Setter<T> = React.Dispatch<React.SetStateAction<T>>;

export interface CanvasWorkspaceContext {
  view: { activeTab: PrimaryTab; leftPanelOpen: boolean; locale: LocaleKey };
  graph: { elements: PlanElement[]; filteredElements: PlanElement[]; selectedElement: PlanElement | null; selectedId: string | null; aiContextIds: string[]; contradictions: AiContradiction[]; canvasVisibleContradictions: AiContradiction[]; edges: GraphEdge[]; expandedNodeIds: Record<string, boolean>; ignoredContradictionIds: string[]; rejectedContradictionIds: string[]; canvasConflictFilter: string; showCanvasConflictOverlay: boolean; alignmentGuides: { verticalX: number | null; horizontalY: number | null }; visibleRelations: Record<RelationType, boolean> };
  interaction: { canvasZoom: number; canvasPan: Position; isPanningCanvas: boolean; panStart: Position; draggingNodeId: string | null; dragOffset: Position; connectingFromId: string | null; mouseCanvasPos: Position; radialMenu: RadialMenu | null };
  refs: { aiContextIdsRef: React.RefObject<string[]>; canvasAreaRef: React.RefObject<HTMLDivElement>; canvasMouseDownInfoRef: React.RefObject<CanvasMouseDownInfo | null>; canvasNodeDownClientRef: React.RefObject<Position | null>; dragStartSnapshotRef: React.RefObject<Record<string, Position> | null>; draggingNodeIdRef: React.RefObject<string | null>; elementsRef: React.RefObject<PlanElement[]>; radialMenuRef: React.RefObject<RadialMenu | null>; selectedIdRef: React.RefObject<string | null> };
  actions: { setLeftPanelOpen: Setter<boolean>; setActiveTab: Setter<PrimaryTab>; setActiveFile: Setter<string>; setElements: (next: React.SetStateAction<PlanElement[]>) => void; setSelectedId: Setter<string | null>; setAiContextIds: Setter<string[]>; setIgnoredContradictionIds: Setter<string[]>; setRejectedContradictionIds: Setter<string[]>; setShowCanvasConflictOverlay: Setter<boolean>; setCanvasConflictFilter: Setter<string>; setAlignmentGuides: Setter<{ verticalX: number | null; horizontalY: number | null }>; setVisibleRelations: Setter<Record<RelationType, boolean>>; setCanvasZoom: Setter<number>; setCanvasPan: Setter<Position>; setIsPanningCanvas: Setter<boolean>; setPanStart: Setter<Position>; setDraggingNodeId: Setter<string | null>; setDragOffset: Setter<Position>; setConnectingFromId: Setter<string | null>; setMouseCanvasPos: Setter<Position>; setRadialMenu: Setter<RadialMenu | null>; setExpandedNodeIds: Setter<Record<string, boolean>>; beginHistoryTransaction(): void; endHistoryTransaction(): void; commitDragSnapshotIfMoved(): void; getRadialOptions(mode: 'canvas' | 'node', targetElementId?: string): RadialOption[]; executeRadialAiAction(optionId: CanvasRadialOptionId, targetElementId?: string): void; handleConnectOnCanvas(sourceId: string, targetId: string): void; openConflictPopupFor(items: AiContradiction[], triggerElementId?: string): void; showNotice(message: string): void };
}

const elementTypeLabels: Record<PlanElement['type'], [string, string]> = {
  system: ['Система', 'System'],
  class: ['Класс', 'Class'],
  process: ['Процесс', 'Process'],
  component: ['Компонент', 'Component'],
  object: ['Объект', 'Object'],
  idea: ['Идея', 'Idea'],
};

const relationLabels: Record<RelationType, [string, string]> = {
  contains: ['содержит', 'contains'],
  extends: ['наследует', 'extends'],
  has: ['имеет', 'has'],
  instance_of: ['экземпляр', 'instance of'],
  uses: ['использует', 'uses'],
  notes: ['заметка', 'note'],
};

function localizeRadialOption(option: RadialOption, locale: LocaleKey): RadialOption {
  const ru = locale === 'ru';
  const count = Number.parseInt(option.sublabel, 10) || 0;
  const labels: Record<CanvasRadialOptionId, [string, string]> = {
    conflicts: ['Конфликты', 'Conflicts'],
    proposals: ['Предложения', 'Proposals'],
    interview: ['Интервью', 'Interview'],
    rescan: ['Обновить ИИ', 'Refresh AI'],
    node_transform: ['Преобразовать', 'Transform'],
    node_open_kb: ['Открыть в БЗ', 'Open in KB'],
    node_save_lib: ['В библиотеку', 'Save to library'],
    node_delete: ['Удалить', 'Delete'],
  };
  let sublabel = option.sublabel;
  switch (option.id) {
    case 'conflicts': sublabel = ru ? `${count} активн.` : `${count} active`; break;
    case 'proposals': sublabel = ru ? `${count} карточ.` : `${count} cards`; break;
    case 'interview': sublabel = ru ? `${count} вопр.` : `${count} questions`; break;
    case 'rescan': sublabel = ru ? 'Скан плана' : 'Scan plan'; break;
    case 'node_transform': sublabel = ru ? 'В систему' : 'To system'; break;
    case 'node_save_lib': sublabel = ru ? 'Сохранить' : 'Save'; break;
    case 'node_delete': sublabel = ru ? 'Из проекта' : 'From project'; break;
  }
  return { ...option, label: labels[option.id][ru ? 0 : 1], sublabel };
}

export function CanvasWorkspaceView({ context }: { context: CanvasWorkspaceContext }) {
  const isRu = context.view.locale === 'ru';
  const t = (ru: string, en: string) => localizedText(context.view.locale, ru, en);
  const visibleEdges = React.useMemo(
    () => context.graph.edges.filter((edge) => context.graph.visibleRelations[edge.relation]),
    [context.graph.edges, context.graph.visibleRelations]
  );
  const visibleEdgeOffsets = React.useMemo(
    () => getParallelEdgeOffsets(visibleEdges),
    [visibleEdges]
  );
  const historyTransactionActive = React.useRef(false);
  const [keyboardRadialOpen, setKeyboardRadialOpen] = React.useState(false);
  const keyboardRadialFocusPending = React.useRef(false);
  const keyboardRadialReturnFocus = React.useRef<HTMLElement | null>(null);
  const keyboardRadialMenuRef = React.useRef<HTMLDivElement | null>(null);
  const endHistoryTransaction = React.useRef(context.actions.endHistoryTransaction);
  endHistoryTransaction.current = context.actions.endHistoryTransaction;
  const finishHistoryTransaction = () => {
    if (!historyTransactionActive.current) return;
    historyTransactionActive.current = false;
    endHistoryTransaction.current();
  };
  React.useEffect(() => {
    window.addEventListener('mouseup', finishHistoryTransaction);
    window.addEventListener('blur', finishHistoryTransaction);
    return () => {
      window.removeEventListener('mouseup', finishHistoryTransaction);
      window.removeEventListener('blur', finishHistoryTransaction);
    };
  }, []);
  React.useEffect(() => {
    if (!keyboardRadialOpen || !context.interaction.radialMenu || !keyboardRadialFocusPending.current) return;
    keyboardRadialFocusPending.current = false;
    keyboardRadialMenuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
  }, [keyboardRadialOpen, context.interaction.radialMenu]);
  const openKeyboardRadial = (event: React.KeyboardEvent<HTMLElement>, mode: 'canvas' | 'node', targetElementId?: string) => {
    event.preventDefault();
    event.stopPropagation();
    const area = context.refs.canvasAreaRef.current;
    const target = event.currentTarget;
    const areaRect = area?.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    if (!area || !areaRect) return;
    keyboardRadialReturnFocus.current = target;
    keyboardRadialFocusPending.current = true;
    setKeyboardRadialOpen(true);
    context.actions.setRadialMenu({
      mode,
      targetElementId,
      centerX: Math.max(185, Math.min(areaRect.width - 185, targetRect.left + targetRect.width / 2 - areaRect.left)),
      centerY: Math.max(160, Math.min(areaRect.height - 160, targetRect.top + targetRect.height / 2 - areaRect.top)),
      cursorX: targetRect.left + targetRect.width / 2 - areaRect.left,
      cursorY: targetRect.top + targetRect.height / 2 - areaRect.top,
      hoveredId: null,
    });
  };
  const closeKeyboardRadial = (restoreFocus: boolean) => {
    setKeyboardRadialOpen(false);
    context.actions.setRadialMenu(null);
    if (restoreFocus) keyboardRadialReturnFocus.current?.focus();
    keyboardRadialReturnFocus.current = null;
  };
  React.useEffect(() => {
    if (!keyboardRadialOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeKeyboardRadial(true);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [keyboardRadialOpen]);
  const handleRadialMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
    const activeIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeKeyboardRadial(true);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      event.preventDefault();
      items[(activeIndex + 1 + items.length) % items.length]?.focus();
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      event.preventDefault();
      items[(activeIndex - 1 + items.length) % items.length]?.focus();
    }
  };
  return (
    <div className="workspace-2col">
              <button
                type="button"
                onClick={() => context.actions.setLeftPanelOpen(true)}
                className={`btn p-1.5 panel-expand-btn left ${
                  context.view.leftPanelOpen ? 'is-hidden' : ''
                }`}
                title={t('Развернуть левую панель', 'Expand left panel')}
                aria-label={t('Развернуть левую панель', 'Expand left panel')}
              >
                <PanelLeftOpen size={15} />
              </button>
    
              {/* Left Controls Column */}
              <div
                className={`panel files-column ${
                  !context.view.leftPanelOpen ? 'collapsed' : ''
                }`}
              >
                <div className="files-column-inner p-4 space-y-3">
                  <div className="section-title">
                    <span>{t('Связи', 'Relations')}</span>
                    <button
                      type="button"
                      onClick={() => context.actions.setLeftPanelOpen(false)}
                      className="btn p-1.5"
                      title={t('Свернуть левую панель', 'Collapse left panel')}
                      aria-label={t('Свернуть левую панель', 'Collapse left panel')}
                    >
                      <PanelLeftClose size={15} />
                    </button>
                  </div>
                  <div className="space-y-1.5 mono text-xs pb-3 border-b border-[var(--border)]">
                    {(
                      [
                        'contains',
                        'extends',
                        'has',
                        'instance_of',
                        'uses',
                        'notes',
                      ] as RelationType[]
                    ).map((rel) => {
                      const isChecked = context.graph.visibleRelations[rel];
                      return (
                        <label
                          key={rel}
                          style={{
                            borderColor: isChecked
                              ? 'var(--ctx-pos-border)'
                              : 'var(--border)',
                            backgroundColor: isChecked
                              ? 'var(--ctx-pos-soft)'
                              : 'var(--surface)',
                            color: isChecked
                              ? 'var(--ctx-pos-text)'
                              : 'var(--ink-muted)',
                          }}
                          className="flex items-center gap-2.5 px-2.5 py-1.5 rounded border transition-colors cursor-pointer select-none hover:border-[var(--ink-muted)]"
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() =>
                              context.actions.setVisibleRelations((prev) => ({
                                ...prev,
                                [rel]: !prev[rel],
                              }))
                            }
                            className="sys-checkbox"
                          />
                          <span className="font-medium tracking-tight">{relationLabels[rel][isRu ? 0 : 1]}</span>
                        </label>
                      );
                    })}
                  </div>
    
                  <button
                    type="button"
                    onClick={() => {
                      const allExpanded =
                        context.graph.filteredElements.length > 0 &&
                        context.graph.filteredElements.every((el) => context.graph.expandedNodeIds[el.id]);
                      if (allExpanded) {
                        context.actions.setExpandedNodeIds({});
                      } else {
                        const next: Record<string, boolean> = {};
                        context.graph.filteredElements.forEach((el) => {
                          next[el.id] = true;
                        });
                        context.actions.setExpandedNodeIds(next);
                      }
                    }}
                    className="btn w-full"
                  >
                    {context.graph.filteredElements.length > 0 &&
                    context.graph.filteredElements.every((el) => context.graph.expandedNodeIds[el.id])
                      ? t('Свернуть все узлы', 'Collapse all nodes')
                      : t('Развернуть все узлы', 'Expand all nodes')}
                  </button>
    
                  <button
                    type="button"
                    onClick={() => {
                      context.actions.setCanvasZoom(100);
                      context.actions.setCanvasPan({ x: 20, y: 20 });
                    }}
                    className="btn w-full"
                  >
                    {t('Сброс камеры (100%)', 'Reset view (100%)')}
                  </button>
    
                  {/* AI Conflict Overlay Controls on Canvas */}
                  <div className="pt-3 border-t border-[var(--border)] space-y-2">
                    <div
                      className="section-title"
                      style={{
                        color:
                          context.graph.contradictions.length > 0
                            ? 'var(--ctx-neg-text)'
                            : 'var(--ink-muted)',
                        marginBottom: '8px',
                      }}
                    >
                      <span>{t('Конфликты ИИ', 'AI conflicts')} ({context.graph.contradictions.length})</span>
                    </div>
    
                    <label
                      style={{
                        borderColor:
                          context.graph.showCanvasConflictOverlay && context.graph.contradictions.length > 0
                            ? 'var(--ctx-neg-border)'
                            : 'var(--border)',
                        backgroundColor:
                          context.graph.showCanvasConflictOverlay && context.graph.contradictions.length > 0
                            ? 'var(--ctx-neg-soft)'
                            : 'var(--surface)',
                        color:
                          context.graph.showCanvasConflictOverlay && context.graph.contradictions.length > 0
                            ? 'var(--ctx-neg-text)'
                            : 'var(--ink-muted)',
                      }}
                      className="flex items-center gap-2.5 px-2.5 py-1.5 rounded border transition-colors cursor-pointer select-none mono text-xs"
                    >
                      <input
                        type="checkbox"
                        checked={context.graph.showCanvasConflictOverlay}
                        onChange={(e) =>
                          context.actions.setShowCanvasConflictOverlay(e.target.checked)
                        }
                        style={
                          context.graph.showCanvasConflictOverlay
                            ? {
                                backgroundColor: 'var(--ctx-neg)',
                                borderColor: 'var(--ctx-neg-border)',
                              }
                            : undefined
                        }
                        className="sys-checkbox"
                      />
                      <span className="font-medium tracking-tight">
                        {t('Оверлей конфликтов', 'Conflict overlay')}
                      </span>
                    </label>
    
                    {context.graph.showCanvasConflictOverlay && context.graph.contradictions.length > 0 && (
                      <div className="space-y-1.5 pt-1">
                        <select
                          value={context.graph.canvasConflictFilter}
                          onChange={(e) => context.actions.setCanvasConflictFilter(e.target.value)}
                          className="sys-input w-full mono text-[11px]"
                        >
                          <option value="all">
                            {t('Все конфликты', 'All conflicts')} ({context.graph.contradictions.length})
                          </option>
                          {context.graph.contradictions.map((c, idx) => (
                            <option key={c.id} value={c.id}>
                              #{idx + 1}: {c.title.slice(0, 26)}...
                            </option>
                          ))}
                        </select>
    
                        <div className="space-y-1">
                          {context.graph.contradictions.map((c) => (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() => context.actions.openConflictPopupFor([c], c.elementIds[0])}
                              className="w-full text-left px-2.5 py-1.5 rounded border border-dashed text-[11px] mono transition-colors cursor-pointer hover:opacity-90"
                              style={{
                                borderColor: 'var(--ctx-neg-border)',
                                backgroundColor: 'var(--ctx-neg-soft)',
                                color: 'var(--ctx-neg-text)',
                              }}
                              title={t('Нажмите, чтобы открыть форму разрешения конфликта', 'Open the conflict resolution form')}
                            >
                              <div className="font-semibold truncate">
                                ⚠ {c.title}
                              </div>
                              <div className="text-[10px] opacity-80 truncate">
                                {c.elementIds.join(' · ')}
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
    
                    {(context.graph.ignoredContradictionIds.length > 0 ||
                      context.graph.rejectedContradictionIds.length > 0) && (
                      <button
                        type="button"
                        onClick={() => {
                          context.actions.setIgnoredContradictionIds([]);
                          context.actions.setRejectedContradictionIds([]);
                          context.actions.setCanvasConflictFilter('all');
                          context.actions.showNotice(t('Скрытые и отклонённые конфликты восстановлены', 'Hidden and rejected conflicts restored'));
                        }}
                        className="btn w-full text-[10px]"
                      >
                        {t('Вернуть скрытые', 'Restore hidden')} (
                        {context.graph.ignoredContradictionIds.length +
                          context.graph.rejectedContradictionIds.length}
                        )
                      </button>
                    )}
                  </div>
                </div>
              </div>
    
              {/* Interactive Canvas Surface */}
              <div className="panel editor-column">
                <div
                  ref={context.refs.canvasAreaRef}
                  aria-label={t('Интерактивный холст проекта', 'Interactive project canvas')}
                  role="region"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
                      openKeyboardRadial(e, 'canvas');
                    }
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                  }}
                  onMouseDown={(e) => {
                    if ((e.target as HTMLElement).closest('.sys-node')) return;
                    if (e.button === 2) {
                      e.preventDefault();
                      e.stopPropagation();
                      setKeyboardRadialOpen(false);
                      const rect = context.refs.canvasAreaRef.current?.getBoundingClientRect();
                      if (!rect) return;
                      const rawX = e.clientX - rect.left;
                      const rawY = e.clientY - rect.top;
                      const centerX = Math.max(
                        185,
                        Math.min(rect.width - 185, rawX)
                      );
                      const centerY = Math.max(
                        160,
                        Math.min(rect.height - 160, rawY)
                      );
                      context.actions.setRadialMenu({
                        mode: 'canvas',
                        centerX,
                        centerY,
                        cursorX: rawX,
                        cursorY: rawY,
                        hoveredId: null,
                      });
                      return;
                    }
                    if (e.button !== 0) return;
                    e.preventDefault();
                    if (
                      document.activeElement instanceof HTMLElement &&
                      (document.activeElement.tagName === 'INPUT' ||
                        document.activeElement.tagName === 'TEXTAREA' ||
                        document.activeElement.tagName === 'SELECT')
                    ) {
                      document.activeElement.blur();
                    }
                    context.actions.setRadialMenu(null);
                    setKeyboardRadialOpen(false);
                    if (!e.ctrlKey && !e.metaKey) {
                      context.refs.selectedIdRef.current = null;
                      context.actions.setSelectedId(null);
                      context.refs.aiContextIdsRef.current = [];
                      context.actions.setAiContextIds([]);
                    }
                    context.actions.setIsPanningCanvas(true);
                    context.actions.setPanStart({
                      x: e.clientX - context.interaction.canvasPan.x,
                      y: e.clientY - context.interaction.canvasPan.y,
                    });
                  }}
                  onWheel={(e) => {
                    e.preventDefault();
                    const rect = context.refs.canvasAreaRef.current?.getBoundingClientRect();
                    const delta = e.deltaY < 0 ? 10 : -10;
                    const nextZoom = Math.min(
                      200,
                      Math.max(40, context.interaction.canvasZoom + delta)
                    );
                    if (nextZoom === context.interaction.canvasZoom) return;
    
                    if (rect) {
                      const cursorX = e.clientX - rect.left;
                      const cursorY = e.clientY - rect.top;
                      const oldScale = context.interaction.canvasZoom / 100;
                      const newScale = nextZoom / 100;
                      const worldX = (cursorX - context.interaction.canvasPan.x) / oldScale;
                      const worldY = (cursorY - context.interaction.canvasPan.y) / oldScale;
                      context.actions.setCanvasPan({
                        x: Math.round(cursorX - worldX * newScale),
                        y: Math.round(cursorY - worldY * newScale),
                      });
                    }
                    context.actions.setCanvasZoom(nextZoom);
                  }}
                  onMouseMove={(e) => {
                    const rect = context.refs.canvasAreaRef.current?.getBoundingClientRect();
                    if (!rect) return;
    
                    if (context.interaction.radialMenu) {
                      const cursorX = e.clientX - rect.left;
                      const cursorY = e.clientY - rect.top;
                      const dx = cursorX - context.interaction.radialMenu.centerX;
                      const dy = cursorY - context.interaction.radialMenu.centerY;
                      const dist = Math.hypot(dx, dy);
    
                      const activeOptions = context.actions.getRadialOptions(
                        context.interaction.radialMenu.mode,
                        context.interaction.radialMenu.targetElementId
                      );
                      let nextHovered: typeof context.interaction.radialMenu.hoveredId = null;
                      if (dist >= 18) {
                        const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
                        let bestDiff = Infinity;
                        for (const opt of activeOptions) {
                          let diff = Math.abs(deg - opt.angleDeg);
                          if (diff > 180) diff = 360 - diff;
                          if (diff < bestDiff) {
                            bestDiff = diff;
                            nextHovered = opt.id;
                          }
                        }
                      }
                      context.actions.setRadialMenu((prev) =>
                        prev
                          ? {
                              ...prev,
                              cursorX,
                              cursorY,
                              hoveredId: nextHovered,
                            }
                          : null
                      );
                      return;
                    }
    
                    if (context.interaction.isPanningCanvas) {
                      context.actions.setCanvasPan({
                        x: e.clientX - context.interaction.panStart.x,
                        y: e.clientY - context.interaction.panStart.y,
                      });
                      return;
                    }
    
                    const scale = context.interaction.canvasZoom / 100;
                    const x = (e.clientX - rect.left - context.interaction.canvasPan.x) / scale;
                    const y = (e.clientY - rect.top - context.interaction.canvasPan.y) / scale;
                    if (context.interaction.connectingFromId) {
                      context.actions.setMouseCanvasPos({ x, y });
                    }
                    const activeDragId = context.refs.draggingNodeIdRef.current || context.interaction.draggingNodeId;
                    if (activeDragId) {
                      const downInfo = context.refs.canvasMouseDownInfoRef.current;
                      if (downInfo && !downInfo.didMove) {
                        const screenDist = Math.hypot(
                          e.clientX - downInfo.clientX,
                          e.clientY - downInfo.clientY
                        );
                        if (screenDist <= 4) {
                          return;
                        }
                        downInfo.didMove = true;
                      }
    
                      const rawX = x - context.interaction.dragOffset.x;
                      const rawY = y - context.interaction.dragOffset.y;
                      let nx = Math.round(rawX / 10) * 10;
                      let ny = Math.round(rawY / 10) * 10;
    
                      const currentGroupIds = context.refs.aiContextIdsRef.current;
                      const moveGroup =
                        currentGroupIds.length > 1 &&
                        currentGroupIds.includes(activeDragId);
                      const movingSet = new Set<string>(
                        moveGroup ? currentGroupIds : [activeDragId]
                      );
    
                      const SNAP_THRESHOLD = 12;
                      let snappedVerticalX: number | null = null;
                      let snappedHorizontalY: number | null = null;
                      let minDx = SNAP_THRESHOLD + 1;
                      let minDy = SNAP_THRESHOLD + 1;
    
                      for (const other of context.graph.filteredElements) {
                        if (movingSet.has(other.id)) continue;
                        const dx = Math.abs(rawX - other.position.x);
                        if (dx <= SNAP_THRESHOLD && dx < minDx) {
                          minDx = dx;
                          nx = other.position.x;
                          snappedVerticalX = other.position.x;
                        }
                        const dy = Math.abs(rawY - other.position.y);
                        if (dy <= SNAP_THRESHOLD && dy < minDy) {
                          minDy = dy;
                          ny = other.position.y;
                          snappedHorizontalY = other.position.y;
                        }
                      }
    
                      context.actions.setAlignmentGuides({
                        verticalX: snappedVerticalX,
                        horizontalY: snappedHorizontalY,
                      });
    
                      const startSnap = context.refs.dragStartSnapshotRef.current;
                      const dragStartOrigin = startSnap?.[activeDragId];
                      const deltaX = dragStartOrigin ? nx - dragStartOrigin.x : 0;
                      const deltaY = dragStartOrigin ? ny - dragStartOrigin.y : 0;
    
                      const nextElements = context.refs.elementsRef.current.map((el) => {
                        if (el.id === activeDragId) {
                          return { ...el, position: { x: nx, y: ny } };
                        }
                        if (
                          moveGroup &&
                          movingSet.has(el.id) &&
                          startSnap?.[el.id]
                        ) {
                          return {
                            ...el,
                            position: {
                              x: Math.round((startSnap[el.id].x + deltaX) / 10) * 10,
                              y: Math.round((startSnap[el.id].y + deltaY) / 10) * 10,
                            },
                          };
                        }
                        return el;
                      });
                      context.refs.elementsRef.current = nextElements;
                      context.actions.setElements(nextElements);
                    }
                  }}
                  onMouseUp={() => {
                    context.actions.commitDragSnapshotIfMoved();
                    finishHistoryTransaction();
                    context.actions.setDraggingNodeId(null);
                    context.actions.setConnectingFromId(null);
                    context.actions.setIsPanningCanvas(false);
                    context.actions.setAlignmentGuides({ verticalX: null, horizontalY: null });
                  }}
                  style={{
                    backgroundPosition: `${context.interaction.canvasPan.x}px ${context.interaction.canvasPan.y}px`,
                    cursor: context.interaction.isPanningCanvas ? 'grabbing' : 'grab',
                  }}
                  className="sys-canvas-area select-none"
                >
                  <div
                    style={{
                      transform: `translate(${context.interaction.canvasPan.x}px, ${context.interaction.canvasPan.y}px) scale(${context.interaction.canvasZoom / 100})`,
                      transformOrigin: '0 0',
                      width: '2400px',
                      height: '1600px',
                    }}
                    className="relative"
                  >
                    <svg className="absolute inset-0 w-full h-full pointer-events-none overflow-visible">
                      <defs>
                        <marker
                          id="sys-arrow"
                          viewBox="0 0 10 10"
                          refX="8"
                          refY="5"
                          markerWidth="6"
                          markerHeight="6"
                          orient="auto-start-reverse"
                        >
                          <path d="M 0 1 L 9 5 L 0 9 z" fill="context-stroke" />
                        </marker>
                        <marker
                          id="sys-arrow-conflict"
                          viewBox="0 0 10 10"
                          refX="8"
                          refY="5"
                          markerWidth="6.5"
                          markerHeight="6.5"
                          orient="auto-start-reverse"
                        >
                          <path
                            d="M 0 1 L 9 5 L 0 9 z"
                            fill="var(--ctx-neg-text)"
                          />
                        </marker>
                      </defs>
    
                      {visibleEdges.map((edge, edgeIndex) => {
                          const src = context.graph.elements.find((e) => e.id === edge.source);
                          const tgt = context.graph.elements.find((e) => e.id === edge.target);
                          if (!src || !tgt) return null;
    
                          const x1 = src.position.x + 85;
                          const y1 = src.position.y + 30;
                          const x2 = tgt.position.x + 85;
                          const y2 = tgt.position.y + 30;
    
                          const line = offsetGraphLine(
                            edge.source,
                            edge.target,
                            { x: x1, y: y1 },
                            { x: x2, y: y2 },
                            visibleEdgeOffsets[edgeIndex] ?? 0
                          );
                          const midX = (line.x1 + line.x2) / 2;
                          const midY = (line.y1 + line.y2) / 2 - 6;
    
                          const dash =
                            edge.relation === 'extends'
                              ? '6 4'
                              : edge.relation === 'notes'
                              ? '2 3'
                              : undefined;
    
                          // Check if this edge connects two nodes participating in an active AI contradiction
                          const edgeContradictions =
                            context.graph.canvasVisibleContradictions.filter((c) => {
                              const involved = new Set([
                                ...c.elementIds,
                                ...(c.suggestedFix?.targetElementId
                                  ? [c.suggestedFix.targetElementId]
                                  : []),
                              ]);
                              return (
                                involved.has(edge.source) &&
                                involved.has(edge.target)
                              );
                            });
                          const isConflictEdge =
                            !edge.valid || edgeContradictions.length > 0;
    
                          const isSelectedEdge =
                            context.graph.selectedId === edge.source ||
                            context.graph.selectedId === edge.target ||
                            context.graph.aiContextIds.includes(edge.source) ||
                            context.graph.aiContextIds.includes(edge.target);
    
                          const selectedMarkerColor = context.graph.selectedElement
                            ? context.graph.selectedElement.customColor ||
                              (context.graph.selectedElement.type === 'idea' &&
                              context.graph.selectedElement.altTo &&
                              context.graph.selectedElement.altTo !== '-'
                                ? 'var(--ctx-neg-text)'
                                : context.graph.selectedElement.mvp
                                ? 'var(--ctx-pos-text)'
                                : 'var(--ink)')
                            : 'var(--ink-muted)';
    
                          const labelWidth = Math.max(
                            44,
                            edge.relation.length * 6.4 + 10
                          );
    
                          return (
                            <g
                              key={edge.id}
                              style={{
                                pointerEvents:
                                  edgeContradictions.length > 0 ? 'auto' : 'none',
                                cursor:
                                  edgeContradictions.length > 0
                                    ? 'pointer'
                                    : 'default',
                              }}
                              onMouseDown={(e) => {
                                if (edgeContradictions.length > 0) {
                                  e.stopPropagation();
                                }
                              }}
                              onClick={(e) => {
                                if (edgeContradictions.length > 0) {
                                  e.stopPropagation();
                                  context.actions.openConflictPopupFor(
                                    edgeContradictions,
                                    edge.source
                                  );
                                }
                              }}
                            >
                              {edgeContradictions.length > 0 && (
                                <line
                                  x1={line.x1}
                                  y1={line.y1}
                                  x2={line.x2}
                                  y2={line.y2}
                                  stroke="transparent"
                                  strokeWidth={16}
                                />
                              )}
                              <line
                                x1={line.x1}
                                y1={line.y1}
                                x2={line.x2}
                                y2={line.y2}
                                stroke={
                                  isConflictEdge
                                    ? 'var(--ctx-neg-text)'
                                    : isSelectedEdge
                                    ? selectedMarkerColor
                                    : 'var(--ink-muted)'
                                }
                                strokeWidth={
                                  isConflictEdge ? 2.2 : isSelectedEdge ? 1.8 : 1.2
                                }
                                strokeDasharray={dash}
                                markerEnd={
                                  isConflictEdge
                                    ? 'url(#sys-arrow-conflict)'
                                    : 'url(#sys-arrow)'
                                }
                              />
                              {isConflictEdge && (
                                <rect
                                  x={midX - labelWidth / 2}
                                  y={midY - 10}
                                  width={labelWidth}
                                  height={14}
                                  rx={2}
                                  fill="var(--ctx-neg)"
                                  fillOpacity={0.75}
                                  stroke="var(--ctx-neg-text)"
                                  strokeWidth={0.8}
                                />
                              )}
                              <text
                                x={midX}
                                y={midY}
                                textAnchor="middle"
                                fill={isConflictEdge ? '#ffffff' : 'var(--ink)'}
                                className="mono text-[10px]"
                                style={
                                  isConflictEdge
                                    ? { fontWeight: 600 }
                                    : {
                                        paintOrder: 'stroke',
                                        stroke: 'var(--surface)',
                                        strokeWidth: '4px',
                                      }
                                }
                              >
                                {edge.relation}
                              </text>
                            </g>
                          );
                        })}
    
                      {context.graph.alignmentGuides.verticalX !== null && (
                        <line
                          x1={context.graph.alignmentGuides.verticalX}
                          y1={-1000}
                          x2={context.graph.alignmentGuides.verticalX}
                          y2={3000}
                          stroke="var(--ctx-pos-text)"
                          strokeWidth={1.2}
                          strokeDasharray="4 4"
                        />
                      )}
                      {context.graph.alignmentGuides.horizontalY !== null && (
                        <line
                          x1={-1000}
                          y1={context.graph.alignmentGuides.horizontalY}
                          x2={4000}
                          y2={context.graph.alignmentGuides.horizontalY}
                          stroke="var(--ctx-pos-text)"
                          strokeWidth={1.2}
                          strokeDasharray="4 4"
                        />
                      )}
    
                      {context.interaction.connectingFromId &&
                        context.graph.elements.find((e) => e.id === context.interaction.connectingFromId) && (
                          <line
                            x1={
                              context.graph.elements.find((e) => e.id === context.interaction.connectingFromId)!
                                .position.x + 150
                            }
                            y1={
                              context.graph.elements.find((e) => e.id === context.interaction.connectingFromId)!
                                .position.y + 24
                            }
                            x2={context.interaction.mouseCanvasPos.x}
                            y2={context.interaction.mouseCanvasPos.y}
                            stroke="var(--accent)"
                            strokeWidth={2}
                            strokeDasharray="4 3"
                          />
                        )}
                    </svg>
    
                    {context.graph.filteredElements.map((el) => {
                      const isSelected =
                        context.graph.selectedId === el.id || context.graph.aiContextIds.includes(el.id);
                      const isNodeExpanded = Boolean(context.graph.expandedNodeIds[el.id]);
                      const typeHeader = isRu
                        ? TYPE_HEADERS_RU[el.type].split('-')[0]
                        : elementTypeLabels[el.type][1];
    
                      const nodeContradictions = context.graph.canvasVisibleContradictions.filter(
                        (c) =>
                          c.elementIds.includes(el.id) ||
                          c.suggestedFix?.targetElementId === el.id
                      );
                      const hasConflictOverlay = nodeContradictions.length > 0;
    
                      const isRejectedIdea =
                        el.type === 'idea' && Boolean(el.altTo && el.altTo !== '-');
                      const markerColor =
                        el.customColor ||
                        (isRejectedIdea
                          ? 'var(--ctx-neg-text)'
                          : el.mvp
                          ? 'var(--ctx-pos-text)'
                          : undefined);
                      const markerSoft = isRejectedIdea
                        ? 'var(--ctx-neg-soft)'
                        : el.mvp
                        ? 'var(--ctx-pos-soft)'
                        : 'var(--ink-faint)';
                      const activeStrokeColor = markerColor || 'var(--ink-muted)';
    
                      return (
                        <div
                          key={el.id}
                          role="group"
                          tabIndex={0}
                          aria-label={t(`${elementTypeLabels[el.type][0]}: ${el.title}, идентификатор ${el.id}`, `${elementTypeLabels[el.type][1]}: ${el.title}, ID ${el.id}`)}
                          onKeyDown={(e) => {
                            if (e.key !== 'ContextMenu' && !(e.shiftKey && e.key === 'F10')) return;
                            context.refs.selectedIdRef.current = el.id;
                            context.actions.setSelectedId(el.id);
                            context.refs.aiContextIdsRef.current = [el.id];
                            context.actions.setAiContextIds([el.id]);
                            openKeyboardRadial(e, 'node', el.id);
                          }}
                          onMouseDown={(e) => {
                            if (e.button === 2) {
                              e.stopPropagation();
                              e.preventDefault();
                              setKeyboardRadialOpen(false);
                              context.actions.setSelectedId(el.id);
                              if (!context.graph.aiContextIds.includes(el.id)) {
                                context.actions.setAiContextIds([el.id]);
                              }
                              const rect =
                                context.refs.canvasAreaRef.current?.getBoundingClientRect();
                              if (!rect) return;
                              const rawX = e.clientX - rect.left;
                              const rawY = e.clientY - rect.top;
                              const centerX = Math.max(
                                185,
                                Math.min(rect.width - 185, rawX)
                              );
                              const centerY = Math.max(
                                160,
                                Math.min(rect.height - 160, rawY)
                              );
                              context.actions.setRadialMenu({
                                mode: 'node',
                                targetElementId: el.id,
                                centerX,
                                centerY,
                                cursorX: rawX,
                                cursorY: rawY,
                                hoveredId: null,
                              });
                              return;
                            }
                            if (e.button !== 0) return;
                            e.stopPropagation();
                            e.preventDefault();
                            if (!historyTransactionActive.current) {
                              historyTransactionActive.current = true;
                              context.actions.beginHistoryTransaction();
                            }
                            if (
                              document.activeElement instanceof HTMLElement &&
                              (document.activeElement.tagName === 'INPUT' ||
                                document.activeElement.tagName === 'TEXTAREA' ||
                                document.activeElement.tagName === 'SELECT')
                            ) {
                              document.activeElement.blur();
                            }
                            context.actions.setRadialMenu(null);
                            context.refs.canvasNodeDownClientRef.current = {
                              x: e.clientX,
                              y: e.clientY,
                            };
                            const wasCtrl = e.ctrlKey || e.metaKey;
                            const currentMulti =
                              context.refs.aiContextIdsRef.current.length > 0
                                ? context.refs.aiContextIdsRef.current
                                : context.refs.selectedIdRef.current
                                ? [context.refs.selectedIdRef.current]
                                : [];
                            const wasAlreadyInMulti = currentMulti.includes(el.id);
    
                            if (wasCtrl) {
                              if (!wasAlreadyInMulti) {
                                const nextMulti = [...currentMulti, el.id];
                                context.refs.aiContextIdsRef.current = nextMulti;
                                context.actions.setAiContextIds(nextMulti);
                                context.refs.selectedIdRef.current = el.id;
                                context.actions.setSelectedId(el.id);
                                context.actions.setActiveFile(el.fileName);
                              }
                            } else {
                              if (!wasAlreadyInMulti) {
                                context.refs.selectedIdRef.current = el.id;
                                context.actions.setSelectedId(el.id);
                                context.refs.aiContextIdsRef.current = [el.id];
                                context.actions.setAiContextIds([el.id]);
                              } else {
                                context.refs.selectedIdRef.current = el.id;
                                context.actions.setSelectedId(el.id);
                              }
                            }
    
                            context.refs.canvasMouseDownInfoRef.current = {
                              nodeId: el.id,
                              fileName: el.fileName,
                              clientX: e.clientX,
                              clientY: e.clientY,
                              wasCtrl,
                              wasAlreadyInMulti,
                              didMove: false,
                            };
    
                            const rect =
                              context.refs.canvasAreaRef.current?.getBoundingClientRect();
                            if (!rect) return;
                            const snap: Record<string, { x: number; y: number }> =
                              {};
                            context.refs.elementsRef.current.forEach((item) => {
                              snap[item.id] = {
                                x: item.position.x,
                                y: item.position.y,
                              };
                            });
                            context.refs.dragStartSnapshotRef.current = snap;
                            const scale = context.interaction.canvasZoom / 100;
                            const cx =
                              (e.clientX - rect.left - context.interaction.canvasPan.x) / scale;
                            const cy =
                              (e.clientY - rect.top - context.interaction.canvasPan.y) / scale;
                            context.refs.draggingNodeIdRef.current = el.id;
                            context.actions.setDraggingNodeId(el.id);
                            context.actions.setDragOffset({
                              x: cx - el.position.x,
                              y: cy - el.position.y,
                            });
                          }}
                          onMouseUp={(e) => {
                            if (e.button !== 0 || context.refs.radialMenuRef.current) return;
                            e.stopPropagation();
                            const downInfo = context.refs.canvasMouseDownInfoRef.current;
                            context.refs.canvasMouseDownInfoRef.current = null;
                            const moveDist = Math.hypot(
                              e.clientX - context.refs.canvasNodeDownClientRef.current.x,
                              e.clientY - context.refs.canvasNodeDownClientRef.current.y
                            );
                            const didDrag = Boolean(downInfo?.didMove) || moveDist > 4;
    
                            if (context.interaction.connectingFromId && context.interaction.connectingFromId !== el.id) {
                              context.actions.handleConnectOnCanvas(context.interaction.connectingFromId, el.id);
                            } else if (!didDrag) {
                              if (downInfo?.wasCtrl) {
                                if (downInfo.wasAlreadyInMulti) {
                                  const nextMulti = context.refs.aiContextIdsRef.current.filter(
                                    (id) => id !== el.id
                                  );
                                  context.refs.aiContextIdsRef.current = nextMulti;
                                  context.actions.setAiContextIds(nextMulti);
                                  if (context.refs.selectedIdRef.current === el.id) {
                                    const nextSel =
                                      nextMulti[nextMulti.length - 1] || null;
                                    context.refs.selectedIdRef.current = nextSel;
                                    context.actions.setSelectedId(nextSel);
                                  }
                                }
                              } else {
                                context.refs.selectedIdRef.current = el.id;
                                context.actions.setSelectedId(el.id);
                                context.refs.aiContextIdsRef.current = [el.id];
                                context.actions.setAiContextIds([el.id]);
                                if (
                                  hasConflictOverlay &&
                                  !(e.target as HTMLElement).closest('button')
                                ) {
                                  context.actions.openConflictPopupFor(nodeContradictions, el.id);
                                }
                              }
                            }
                            context.actions.commitDragSnapshotIfMoved();
                            finishHistoryTransaction();
                            context.actions.setDraggingNodeId(null);
                            context.actions.setConnectingFromId(null);
                            context.actions.setIsPanningCanvas(false);
                            context.actions.setAlignmentGuides({
                              verticalX: null,
                              horizontalY: null,
                            });
                          }}
                          onDoubleClick={() => {
                            context.actions.setSelectedId(el.id);
                            context.actions.setActiveTab('kb');
                          }}
                          style={{
                            left: `${el.position.x}px`,
                            top: `${el.position.y}px`,
                            borderTopColor: isSelected ? activeStrokeColor : undefined,
                            borderRightColor: isSelected ? activeStrokeColor : undefined,
                            borderBottomColor: isSelected ? activeStrokeColor : undefined,
                            borderLeftWidth: markerColor ? '3px' : undefined,
                            borderLeftColor:
                              markerColor ||
                              (isSelected ? activeStrokeColor : undefined),
                            boxShadow: isSelected
                              ? `0 0 0 1px ${activeStrokeColor}`
                              : undefined,
                            backgroundColor: 'var(--bg)',
                            backgroundImage: isSelected
                              ? `linear-gradient(${markerSoft}, ${markerSoft})`
                              : undefined,
                          }}
                          className={`sys-node focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ctx-pos-text)] focus-visible:outline-offset-2 ${isSelected ? 'selected' : ''}`}
                        >
                          {/* Negative Contextual Color Dashed Conflict Overlay Frame around Conflicted Node */}
                          {hasConflictOverlay && (
                            <div
                              onMouseDown={(e) => {
                                if (e.button === 2) return;
                                e.stopPropagation();
                              }}
                              onClick={(e) => {
                                e.stopPropagation();
                                context.actions.openConflictPopupFor(nodeContradictions, el.id);
                              }}
                              title={t(
                                `Конфликт ИИ: ${nodeContradictions[0].title} (нажмите для открытия формы конфликта)`,
                                `AI conflict: ${nodeContradictions[0].title} (open conflict form)`
                              )}
                              aria-label={t(
                                `Открыть разрешение конфликта: ${nodeContradictions[0].title}`,
                                `Resolve conflict: ${nodeContradictions[0].title}`
                              )}
                              style={{
                                position: 'absolute',
                                inset: '-9px',
                                border: '1.5px dashed var(--ctx-neg-text)',
                                borderRadius: '4px',
                                backgroundColor: 'var(--ctx-neg-soft)',
                                pointerEvents: 'auto',
                                cursor: 'pointer',
                                zIndex: -1,
                              }}
                              className="transition-opacity opacity-85 hover:opacity-100"
                            />
                          )}
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <span className="label">
                              {typeHeader}
                              {el.mvp ? ' · MVP' : ''}
                            </span>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onMouseDown={(e) => {
                                  e.stopPropagation();
                                }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  context.actions.setExpandedNodeIds((prev) => ({
                                    ...prev,
                                    [el.id]: !prev[el.id],
                                  }));
                                }}
                                className="pill cursor-pointer hover:border-[var(--ink)] flex items-center justify-center px-1"
                                title={
                                  isNodeExpanded
                                    ? t('Свернуть компонент', 'Collapse node details')
                                    : t('Развернуть компонент', 'Expand node details')
                                }
                                aria-label={isNodeExpanded ? t('Свернуть компонент', 'Collapse node details') : t('Развернуть компонент', 'Expand node details')}
                              >
                                {isNodeExpanded ? (
                                  <ChevronUp size={11} />
                                ) : (
                                  <ChevronDown size={11} />
                                )}
                              </button>
                              <button
                                type="button"
                                onMouseDown={(e) => {
                                  e.stopPropagation();
                                  e.preventDefault();
                                  const rect =
                                    context.refs.canvasAreaRef.current?.getBoundingClientRect();
                                  if (!rect) return;
                                  const scale = context.interaction.canvasZoom / 100;
                                  context.actions.setConnectingFromId(el.id);
                                  context.actions.setMouseCanvasPos({
                                    x:
                                      (e.clientX - rect.left - context.interaction.canvasPan.x) / scale,
                                    y:
                                      (e.clientY - rect.top - context.interaction.canvasPan.y) / scale,
                                  });
                                }}
                                className="pill cursor-crosshair hover:border-[var(--ink)]"
                                title={t('Зажмите и перетащите на другой узел', 'Drag to another node to connect')}
                                aria-label={t('Создать связь с другим узлом', 'Create a link to another node')}
                              >
                                +
                              </button>
                            </div>
                          </div>
    
                          <div
                            className="mono font-semibold text-xs truncate"
                            style={{ color: 'var(--ink)' }}
                          >
                            {el.id}
                          </div>
    
                          {isNodeExpanded && (
                            <div className="mt-2 pt-2 border-t border-[var(--border)] text-[11px] space-y-1">
                              <div className="font-medium truncate">{el.title}</div>
                              {el.parent && el.parent !== '-' && (
                                <div className="mono">{t('Родитель:', 'Parent:')} {el.parent}</div>
                              )}
                              {el.type === 'class' &&
                                (el.fields || []).slice(0, 2).map((f) => (
                                  <div key={f.name} className="mono">
                                    - {f.name}: {f.dataType}
                                  </div>
                                ))}
                              {el.type === 'object' &&
                                (el.values || []).slice(0, 2).map((v) => (
                                  <div key={v.fieldName} className="mono">
                                    {v.fieldName} = {v.value}
                                  </div>
                                ))}
                              {el.type === 'component' &&
                                (el.interfaceItems || []).slice(0, 2).map((it, idx) => (
                                  <div key={idx} className="mono truncate">
                                    + {it}
                                  </div>
                                ))}
                              {el.type === 'process' &&
                                (el.steps || []).slice(0, 2).map((st, idx) => (
                                  <div key={idx} className="mono truncate">
                                    {idx + 1}. {st}
                                  </div>
                                ))}
                              {(el.type === 'system' || el.type === 'idea') &&
                                el.description && (
                                  <div className="mono line-clamp-2">
                                    {el.description}
                                  </div>
                                )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
    
                  {/* Right-Click Hold Radial AI Wheel Overlay (Annular Sector Ring + Dotted Fill + Inner Arrow) */}
                  {context.interaction.radialMenu &&
                    (() => {
                      const cx = context.interaction.radialMenu.centerX;
                      const cy = context.interaction.radialMenu.centerY;
                      const rIn = 64;
                      const rOut = 162;
                      const rMid = (rIn + rOut) / 2;
    
                      const dx = context.interaction.radialMenu.cursorX - cx;
                      const dy = context.interaction.radialMenu.cursorY - cy;
                      const dist = Math.hypot(dx, dy);
    
                      const activeOptions = context.actions.getRadialOptions(
                        context.interaction.radialMenu.mode,
                        context.interaction.radialMenu.targetElementId
                      ).map((option) => localizeRadialOption(option, context.view.locale));
                      const activeOpt = activeOptions.find(
                        (o) => o.id === context.interaction.radialMenu.hoveredId
                      );
                      const wheelStrokeColor = activeOpt?.isNegative
                        ? 'var(--ctx-neg-text)'
                        : 'var(--ctx-pos-text)';
    
                      // Arrow angle & tip inside inner circle
                      const arrowAngle =
                        dist >= 8
                          ? Math.atan2(dy, dx)
                          : activeOpt
                          ? (activeOpt.angleDeg * Math.PI) / 180
                          : -Math.PI / 2;
                      const arrowLen =
                        dist >= 8
                          ? Math.min(rIn - 14, Math.max(24, dist * 0.72))
                          : 0;
                      const tipX = cx + Math.cos(arrowAngle) * arrowLen;
                      const tipY = cy + Math.sin(arrowAngle) * arrowLen;
                      const wingLen = 13;
                      const wingSpread = 0.48;
                      const wing1X =
                        tipX - Math.cos(arrowAngle - wingSpread) * wingLen;
                      const wing1Y =
                        tipY - Math.sin(arrowAngle - wingSpread) * wingLen;
                      const wing2X =
                        tipX - Math.cos(arrowAngle + wingSpread) * wingLen;
                      const wing2Y =
                        tipY - Math.sin(arrowAngle + wingSpread) * wingLen;
    
                      const buildSectorPath = (
                        startDeg: number,
                        endDeg: number
                      ) => {
                        const sRad = (startDeg * Math.PI) / 180;
                        const eRad = (endDeg * Math.PI) / 180;
                        const x1Out = cx + rOut * Math.cos(sRad);
                        const y1Out = cy + rOut * Math.sin(sRad);
                        const x2Out = cx + rOut * Math.cos(eRad);
                        const y2Out = cy + rOut * Math.sin(eRad);
                        const x2In = cx + rIn * Math.cos(eRad);
                        const y2In = cy + rIn * Math.sin(eRad);
                        const x1In = cx + rIn * Math.cos(sRad);
                        const y1In = cy + rIn * Math.sin(sRad);
                        return [
                          `M ${x1Out} ${y1Out}`,
                          `A ${rOut} ${rOut} 0 0 1 ${x2Out} ${y2Out}`,
                          `L ${x2In} ${y2In}`,
                          `A ${rIn} ${rIn} 0 0 0 ${x1In} ${y1In}`,
                          'Z',
                        ].join(' ');
                      };
    
                      return (
                        <div
                          className="absolute inset-0 z-40 pointer-events-none select-none"
                          style={{ overflow: 'hidden' }}
                        >
                          <svg className="absolute inset-0 w-full h-full pointer-events-none">
                            <defs>
                              {/* Dotted Halftone Pattern for Positive Contextual Color */}
                              <pattern
                                id="radial-dots-pos"
                                width="5"
                                height="5"
                                patternUnits="userSpaceOnUse"
                              >
                                <rect
                                  width="5"
                                  height="5"
                                  fill="var(--ctx-pos-soft)"
                                />
                                <circle
                                  cx="2.5"
                                  cy="2.5"
                                  r="1.15"
                                  fill="var(--ctx-pos-text)"
                                  fillOpacity="0.85"
                                />
                              </pattern>
                              {/* Dotted Halftone Pattern for Negative Contextual Color */}
                              <pattern
                                id="radial-dots-neg"
                                width="5"
                                height="5"
                                patternUnits="userSpaceOnUse"
                              >
                                <rect
                                  width="5"
                                  height="5"
                                  fill="var(--ctx-neg-soft)"
                                />
                                <circle
                                  cx="2.5"
                                  cy="2.5"
                                  r="1.15"
                                  fill="var(--ctx-neg-text)"
                                  fillOpacity="0.85"
                                />
                              </pattern>
                            </defs>
    
                            {/* Annular Sector Slices */}
                            {activeOptions.map((opt) => {
                              const d = buildSectorPath(opt.startDeg, opt.endDeg);
                              const isHovered = context.interaction.radialMenu.hoveredId === opt.id;
                              const patternFill = opt.isNegative
                                ? 'url(#radial-dots-neg)'
                                : 'url(#radial-dots-pos)';
    
                              return (
                                <g
                                  key={opt.id}
                                  aria-label={`${opt.label}: ${opt.sublabel}`}
                                  style={{
                                    pointerEvents: 'auto',
                                    cursor: 'pointer',
                                  }}
                                  onMouseEnter={() =>
                                    context.actions.setRadialMenu((prev) =>
                                      prev ? { ...prev, hoveredId: opt.id } : null
                                    )
                                  }
                                >
                                  {/* Base Dark Sector Surface */}
                                  <path
                                    d={d}
                                    fill="var(--bg)"
                                    fillOpacity={0.92}
                                    stroke={wheelStrokeColor}
                                    strokeWidth={1.5}
                                  />
                                  {/* Dotted Halftone Fill when Hovered */}
                                  {isHovered && (
                                    <path
                                      d={d}
                                      fill={patternFill}
                                      stroke={
                                        opt.isNegative
                                          ? 'var(--ctx-neg-text)'
                                          : 'var(--ctx-pos-text)'
                                      }
                                      strokeWidth={2}
                                    />
                                  )}
                                </g>
                              );
                            })}
    
                            {/* Inner Hub Circle */}
                            <circle
                              cx={cx}
                              cy={cy}
                              r={rIn}
                              fill="var(--bg)"
                              fillOpacity={0.95}
                              stroke={wheelStrokeColor}
                              strokeWidth={1.6}
                            />
    
                            {/* Outer Ring Circle */}
                            <circle
                              cx={cx}
                              cy={cy}
                              r={rOut}
                              fill="none"
                              stroke={wheelStrokeColor}
                              strokeWidth={1.6}
                            />
    
                            {/* Center Pivot Dot */}
                            <circle
                              cx={cx}
                              cy={cy}
                              r={3}
                              fill={wheelStrokeColor}
                            />
    
                            {/* Directional Pointer Arrow inside Inner Circle */}
                            {arrowLen > 0 && (
                              <g>
                                <line
                                  x1={cx}
                                  y1={cy}
                                  x2={tipX}
                                  y2={tipY}
                                  stroke={wheelStrokeColor}
                                  strokeWidth={2.8}
                                  strokeLinecap="round"
                                />
                                <path
                                  d={`M ${wing1X} ${wing1Y} L ${tipX} ${tipY} L ${wing2X} ${wing2Y}`}
                                  fill="none"
                                  stroke={wheelStrokeColor}
                                  strokeWidth={2.8}
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                              </g>
                            )}
                          </svg>

                          {keyboardRadialOpen && context.interaction.radialMenu && (
                            <div
                              ref={keyboardRadialMenuRef}
                              role="menu"
                              aria-label={t('Действия контекстного меню', 'Context actions')}
                              onKeyDown={handleRadialMenuKeyDown}
                              className="absolute z-50 flex min-w-48 flex-col gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2 shadow-xl pointer-events-auto"
                              style={{ left: `${cx}px`, top: `${cy}px`, transform: 'translate(-50%, -50%)' }}
                            >
                              {activeOptions.map((option) => (
                                <button
                                  key={option.id}
                                  type="button"
                                  role="menuitem"
                                  tabIndex={0}
                                  aria-label={`${option.label}. ${option.sublabel}`}
                                  className="flex items-center justify-between gap-3 rounded px-2 py-1.5 text-left text-xs text-[var(--ink)] hover:bg-[var(--surface-2)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ctx-pos-text)]"
                                  onMouseDown={(event) => { event.preventDefault(); event.stopPropagation(); }}
                                  onMouseUp={(event) => event.stopPropagation()}
                                  onFocus={() => context.actions.setRadialMenu((previous) => previous ? { ...previous, hoveredId: option.id } : null)}
                                  onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    const targetId = context.interaction.radialMenu?.targetElementId;
                                    closeKeyboardRadial(false);
                                    context.actions.executeRadialAiAction(option.id, targetId);
                                  }}
                                >
                                  <span>{option.label}</span>
                                  <span className="text-[10px] text-[var(--ink-muted)]">{option.sublabel}</span>
                                </button>
                              ))}
                            </div>
                          )}

                          {/* Sector Text Labels inside each Wedge */}
                          {activeOptions.map((opt) => {
                            const rad = (opt.angleDeg * Math.PI) / 180;
                            const lx = cx + Math.cos(rad) * rMid;
                            const ly = cy + Math.sin(rad) * rMid;
                            const isHovered = context.interaction.radialMenu.hoveredId === opt.id;
    
                            return (
                              <div
                                key={opt.id}
                                style={{
                                  left: `${lx}px`,
                                  top: `${ly}px`,
                                  maxWidth: '92px',
                                  transform: 'translate(-50%, -50%)',
                                  backgroundColor: isHovered
                                    ? 'var(--bg)'
                                    : 'transparent',
                                  borderColor: isHovered
                                    ? opt.isNegative
                                      ? 'var(--ctx-neg-text)'
                                      : 'var(--ctx-pos-text)'
                                    : 'transparent',
                                }}
                                className={`absolute px-1 py-0.5 rounded pointer-events-none text-center transition-transform duration-75 ${
                                  isHovered ? 'border scale-105' : ''
                                }`}
                              >
                                <div
                                  style={{
                                    color: isHovered
                                      ? opt.isNegative
                                        ? 'var(--ctx-neg-text)'
                                        : 'var(--ctx-pos-text)'
                                      : 'var(--ink)',
                                    textShadow: '0 1px 3px rgba(0,0,0,0.85)',
                                  }}
                                  className="text-[10.5px] font-semibold leading-tight truncate"
                                >
                                  {opt.label}
                                </div>
                                <div
                                  style={{
                                    color: isHovered
                                      ? 'var(--ink)'
                                      : 'var(--ink-muted)',
                                    textShadow: '0 1px 2px rgba(0,0,0,0.85)',
                                  }}
                                  className="mono text-[9px] leading-tight truncate"
                                >
                                  {opt.sublabel}
                                </div>
                              </div>
                            );
                          })}
    
                          {/* Subtle Center Context Badge & Hint inside Inner Hub */}
                          {context.interaction.radialMenu.mode === 'node' &&
                            context.interaction.radialMenu.targetElementId && (
                              <div
                                style={{
                                  left: `${cx}px`,
                                  top: `${cy - 18}px`,
                                  transform: 'translate(-50%, -50%)',
                                  color: 'var(--ctx-pos-text)',
                                }}
                                className="absolute mono text-[9px] font-semibold tracking-tight pointer-events-none truncate max-w-[94px]"
                              >
                                {context.interaction.radialMenu.targetElementId}
                              </div>
                            )}
                          {arrowLen === 0 && (
                            <div
                              style={{
                                left: `${cx}px`,
                                top: `${cy + 20}px`,
                                transform: 'translate(-50%, -50%)',
                                color: 'var(--ink-muted)',
                              }}
                              className="absolute mono text-[9px] uppercase tracking-wider pointer-events-none"
                            >
                                  {t('НАВЕДИТЕ', 'HOVER')}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                </div>
              </div>
            </div>
  );
}

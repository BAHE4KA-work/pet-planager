import React, { useRef, useState } from 'react';
import {
  Box,
  Cpu,
  FileCode2,
  GitBranch,
  Layers,
  Lightbulb,
  Link2,
  Maximize2,
  Pin,
  Plus,
  Sparkles,
  Workflow,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  ElementType,
  GraphEdge,
  PlanElement,
  RelationType,
} from '../types/planager';
import {
  resolveInheritedFieldsForObject,
  TYPE_HEADERS_RU,
} from '../utils/pgrCodec';

interface CanvasViewProps {
  elements: PlanElement[];
  edges: GraphEdge[];
  selectedId: string | null;
  aiContextIds: string[];
  onSelectElement: (id: string) => void;
  onToggleAiContext: (id: string) => void;
  onUpdateElementPosition: (id: string, pos: { x: number; y: number }) => void;
  onConnectElements: (sourceId: string, targetId: string) => void;
  onAutoLayout: () => void;
  onOpenInKnowledgeBase: (fileName: string, elementId: string) => void;
  onCreateElementAt: (type: ElementType) => void;
}

const RELATION_META: Record<
  RelationType,
  { label: string; stroke: string; dash?: string }
> = {
  contains: { label: 'contains', stroke: '#64748B', dash: '4 4' },
  extends: { label: 'extends', stroke: '#3B82F6' },
  has: { label: 'has', stroke: '#10B981' },
  instance_of: { label: 'instance_of', stroke: '#F59E0B', dash: '6 3' },
  uses: { label: 'uses', stroke: '#8B5CF6' },
  notes: { label: 'notes', stroke: '#94A3B8', dash: '2 3' },
};

export const ELEMENT_TYPE_ACCENTS: Record<ElementType, string> = {
  system: '#0EA5E9',
  class: '#3B82F6',
  process: '#8B5CF6',
  component: '#10B981',
  object: '#F59E0B',
  idea: '#64748B',
};

export function ElementTypeIcon({
  type,
  className = 'w-4 h-4',
}: {
  type: ElementType;
  className?: string;
}) {
  switch (type) {
    case 'system':
      return <Layers className={className} />;
    case 'class':
      return <Box className={className} />;
    case 'process':
      return <Workflow className={className} />;
    case 'component':
      return <Cpu className={className} />;
    case 'object':
      return <GitBranch className={className} />;
    case 'idea':
      return <Lightbulb className={className} />;
  }
}

export const CanvasView: React.FC<CanvasViewProps> = ({
  elements,
  edges,
  selectedId,
  aiContextIds,
  onSelectElement,
  onToggleAiContext,
  onUpdateElementPosition,
  onConnectElements,
  onAutoLayout,
  onOpenInKnowledgeBase,
  onCreateElementAt,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState<number>(0.92);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 20, y: 20 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Interactive connection drag state
  const [connectingFromId, setConnectingFromId] = useState<string | null>(null);
  const [mouseCanvasPos, setMouseCanvasPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Filter visible relation types on canvas
  const [visibleRelations, setVisibleRelations] = useState<Record<RelationType, boolean>>({
    contains: true,
    extends: true,
    has: true,
    instance_of: true,
    uses: true,
    notes: true,
  });

  const screenToCanvas = (clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: (clientX - rect.left - pan.x) / zoom,
      y: (clientY - rect.top - pan.y) / zoom,
    };
  };

  const handleMouseDownCanvas = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-node-card]')) return;
    setIsPanning(true);
    setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handleMouseMoveCanvas = (e: React.MouseEvent) => {
    const canvasCoords = screenToCanvas(e.clientX, e.clientY);
    if (connectingFromId) {
      setMouseCanvasPos(canvasCoords);
    }
    if (draggingNodeId) {
      const nextX = Math.round((canvasCoords.x - dragOffset.x) / 10) * 10;
      const nextY = Math.round((canvasCoords.y - dragOffset.y) / 10) * 10;
      onUpdateElementPosition(draggingNodeId, { x: nextX, y: nextY });
      return;
    }
    if (isPanning) {
      setPan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
    }
  };

  const handleMouseUpCanvas = () => {
    setIsPanning(false);
    setDraggingNodeId(null);
    setConnectingFromId(null);
  };

  const startNodeDrag = (e: React.MouseEvent, el: PlanElement) => {
    e.stopPropagation();
    onSelectElement(el.id);
    const coords = screenToCanvas(e.clientX, e.clientY);
    setDraggingNodeId(el.id);
    setDragOffset({
      x: coords.x - el.position.x,
      y: coords.y - el.position.y,
    });
  };

  const startConnectDrag = (e: React.MouseEvent, sourceId: string) => {
    e.stopPropagation();
    const coords = screenToCanvas(e.clientX, e.clientY);
    setConnectingFromId(sourceId);
    setMouseCanvasPos(coords);
  };

  const finishConnectOnNode = (e: React.MouseEvent, targetId: string) => {
    e.stopPropagation();
    if (connectingFromId && connectingFromId !== targetId) {
      onConnectElements(connectingFromId, targetId);
    }
    setConnectingFromId(null);
  };

  const toggleRelationFilter = (rel: RelationType) => {
    setVisibleRelations((prev) => ({ ...prev, [rel]: !prev[rel] }));
  };

  const CARD_WIDTH = 300;
  const CARD_HEIGHT_APPROX = 175;

  const elementMap = new Map<string, PlanElement>();
  elements.forEach((el) => elementMap.set(el.id, el));

  return (
    <div className="relative w-full h-full flex flex-col overflow-hidden select-none">
      {/* Compact Canvas Toolbar */}
      <div
        className="flex items-center justify-between px-4 py-2 border-b text-xs z-10"
        style={{
          backgroundColor: 'var(--bg-surface)',
          borderColor: 'var(--border-hairline)',
        }}
      >
        {/* Left: Relation Edge Filters */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] mr-1" style={{ color: 'var(--text-muted)' }}>
            Связи:
          </span>
          {(Object.keys(RELATION_META) as RelationType[]).map((rel) => {
            const active = visibleRelations[rel];
            const meta = RELATION_META[rel];
            return (
              <button
                key={rel}
                onClick={() => toggleRelationFilter(rel)}
                className={`px-2 py-1 rounded text-[11px] font-mono-tabular transition-opacity flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                  active ? 'opacity-100 font-medium' : 'opacity-40'
                }`}
                style={{
                  backgroundColor: 'var(--bg-subtle)',
                  color: 'var(--text-primary)',
                  border: `1px solid ${active ? meta.stroke : 'var(--border-hairline)'}`,
                }}
                title={`Показать/скрыть рёбра ${rel}`}
              >
                <span
                  className="w-2 h-2 rounded-full inline-block"
                  style={{ backgroundColor: meta.stroke }}
                />
                {meta.label}
              </button>
            );
          })}
        </div>

        {/* Center: Quick Add Element by Type */}
        <div className="hidden xl:flex items-center gap-1">
          {(
            ['system', 'class', 'process', 'component', 'object', 'idea'] as ElementType[]
          ).map((t) => (
            <button
              key={t}
              onClick={() => onCreateElementAt(t)}
              className="px-2 py-1 rounded text-[11px] flex items-center gap-1 hover:opacity-85 transition-opacity whitespace-nowrap cursor-pointer"
              style={{
                backgroundColor: 'var(--bg-subtle)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-hairline)',
              }}
              title={`Создать: ${TYPE_HEADERS_RU[t]}`}
            >
              <Plus className="w-3 h-3" style={{ color: ELEMENT_TYPE_ACCENTS[t] }} />
              <span>{TYPE_HEADERS_RU[t].split('-')[0]}</span>
            </button>
          ))}
        </div>

        {/* Right: Zoom & Auto-Layout Controls */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={onAutoLayout}
            className="px-2.5 py-1 rounded text-xs flex items-center gap-1.5 cursor-pointer"
            style={{
              backgroundColor: 'var(--bg-subtle)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-hairline)',
            }}
            title="Автоматически разложить элементы по Системам и уровням связей"
          >
            <Maximize2 className="w-3.5 h-3.5" />
            <span>Укладка</span>
          </button>
          <div
            className="flex items-center rounded px-1 py-0.5 font-mono-tabular"
            style={{
              backgroundColor: 'var(--bg-subtle)',
              border: '1px solid var(--border-hairline)',
            }}
          >
            <button
              onClick={() => setZoom((z) => Math.max(0.45, +(z - 0.1).toFixed(2)))}
              className="p-1 hover:opacity-75 cursor-pointer"
              title="Отдалить"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => {
                setZoom(0.92);
                setPan({ x: 20, y: 20 });
              }}
              className="px-2 text-[11px] cursor-pointer"
              title="Сбросить масштаб"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              onClick={() => setZoom((z) => Math.min(1.6, +(z + 0.1).toFixed(2)))}
              className="p-1 hover:opacity-75 cursor-pointer"
              title="Приблизить"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Main Interactive Canvas Surface */}
      <div
        ref={containerRef}
        onMouseDown={handleMouseDownCanvas}
        onMouseMove={handleMouseMoveCanvas}
        onMouseUp={handleMouseUpCanvas}
        className="relative flex-1 overflow-hidden canvas-grid-pattern cursor-grab active:cursor-grabbing"
      >
        <div
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: '0 0',
            width: '3200px',
            height: '2200px',
          }}
          className="relative"
        >
          {/* Directed Graph SVG Edges */}
          <svg
            className="absolute inset-0 w-full h-full pointer-events-none overflow-visible"
            style={{ zIndex: 1 }}
          >
            <defs>
              {(Object.keys(RELATION_META) as RelationType[]).map((rel) => (
                <marker
                  key={rel}
                  id={`arrow-${rel}`}
                  viewBox="0 0 10 10"
                  refX="8"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 1 L 9 5 L 0 9 z" fill={RELATION_META[rel].stroke} />
                </marker>
              ))}
            </defs>

            {edges
              .filter((edge) => visibleRelations[edge.relation])
              .map((edge) => {
                const src = elementMap.get(edge.source);
                const tgt = elementMap.get(edge.target);
                if (!src || !tgt) return null;

                const x1 = src.position.x + CARD_WIDTH / 2;
                const y1 = src.position.y + CARD_HEIGHT_APPROX / 2;
                const x2 = tgt.position.x + CARD_WIDTH / 2;
                const y2 = tgt.position.y + CARD_HEIGHT_APPROX / 2;

                const dx = x2 - x1;
                const dy = y2 - y1;
                const cx1 = x1 + dx * 0.35;
                const cy1 = y1 + dy * 0.1;
                const cx2 = x1 + dx * 0.65;
                const cy2 = y2 - dy * 0.1;

                const midX = (x1 + x2) / 2;
                const midY = (y1 + y2) / 2 - 6;

                const meta = RELATION_META[edge.relation];
                const isHighlighted =
                  selectedId === edge.source || selectedId === edge.target;

                return (
                  <g
                    key={edge.id}
                    style={{ opacity: selectedId && !isHighlighted ? 0.32 : 0.92 }}
                  >
                    <path
                      d={`M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}`}
                      fill="none"
                      stroke={edge.valid ? meta.stroke : 'var(--ctx-neg)'}
                      strokeWidth={isHighlighted ? 2.4 : 1.6}
                      strokeDasharray={meta.dash}
                      markerEnd={`url(#arrow-${edge.relation})`}
                    />
                    <text
                      x={midX}
                      y={midY}
                      textAnchor="middle"
                      fill={edge.valid ? meta.stroke : 'var(--ctx-neg)'}
                      className="text-[10px] font-mono-tabular"
                      style={{
                        paintOrder: 'stroke',
                        stroke: 'var(--bg-canvas)',
                        strokeWidth: '4px',
                      }}
                    >
                      {meta.label}
                    </text>
                  </g>
                );
              })}

            {/* Active drag-to-connect line */}
            {connectingFromId && elementMap.get(connectingFromId) && (
              <line
                x1={elementMap.get(connectingFromId)!.position.x + CARD_WIDTH}
                y1={elementMap.get(connectingFromId)!.position.y + 42}
                x2={mouseCanvasPos.x}
                y2={mouseCanvasPos.y}
                stroke="var(--ctx-pos)"
                strokeWidth={2.5}
                strokeDasharray="5 3"
              />
            )}
          </svg>

          {/* Plan Element Blocks */}
          {elements.map((el) => {
            const isSelected = selectedId === el.id;
            const isAiPinned = aiContextIds.includes(el.id);
            const accentColor = el.customColor || ELEMENT_TYPE_ACCENTS[el.type];
            const inheritedForObj =
              el.type === 'object'
                ? resolveInheritedFieldsForObject(el, elements)
                : [];
            const systemChildrenCount =
              el.type === 'system'
                ? elements.filter((child) => child.parent === el.id).length
                : 0;

            return (
              <div
                key={el.id}
                data-node-card="true"
                onMouseDown={(e) => startNodeDrag(e, el)}
                onMouseUp={(e) => finishConnectOnNode(e, el.id)}
                style={{
                  transform: `translate(${el.position.x}px, ${el.position.y}px)`,
                  width: `${CARD_WIDTH}px`,
                  backgroundColor: 'var(--bg-surface)',
                  borderColor: isSelected
                    ? accentColor
                    : isAiPinned
                    ? 'var(--ctx-pos)'
                    : 'var(--border-hairline)',
                  borderTopWidth: '3px',
                  borderTopColor: accentColor,
                  zIndex: isSelected ? 20 : 10,
                }}
                className="absolute top-0 left-0 rounded-lg border p-3.5 transition-shadow cursor-pointer"
              >
                {/* Clean Unboxed Kicker Metadata Line (Zero-Pill Discipline) */}
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <div
                    className="flex items-center gap-1.5 text-[11px] font-mono-tabular truncate"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    <span
                      className="inline-flex items-center gap-1 font-medium"
                      style={{ color: accentColor }}
                    >
                      <ElementTypeIcon type={el.type} className="w-3.5 h-3.5" />
                      {TYPE_HEADERS_RU[el.type]}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="truncate">{el.id}</span>
                    {el.mvp && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span
                          className="font-semibold"
                          style={{ color: 'var(--ctx-pos)' }}
                        >
                          MVP
                        </span>
                      </>
                    )}
                  </div>

                  {/* Quick Node Actions: Pin to AI Context, Jump to .pgr, Drag Relation */}
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleAiContext(el.id);
                      }}
                      className="p-1 rounded hover:opacity-80 cursor-pointer"
                      style={{
                        color: isAiPinned ? 'var(--ctx-pos)' : 'var(--text-muted)',
                        backgroundColor: isAiPinned ? 'var(--ctx-pos-soft)' : 'transparent',
                      }}
                      title={
                        isAiPinned
                          ? 'В выделенном контексте ИИ (нажмите, чтобы убрать)'
                          : 'Выделить в контекст ИИ-ассистента'
                      }
                    >
                      <Pin className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenInKnowledgeBase(el.fileName, el.id);
                      }}
                      className="p-1 rounded hover:opacity-80 cursor-pointer"
                      style={{ color: 'var(--text-muted)' }}
                      title={`Открыть блок в файле ${el.fileName} (по диапазону строк)`}
                    >
                      <FileCode2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onMouseDown={(e) => startConnectDrag(e, el.id)}
                      className="p-1 rounded hover:opacity-80 cursor-crosshair"
                      style={{
                        color:
                          connectingFromId === el.id
                            ? 'var(--ctx-pos)'
                            : 'var(--text-muted)',
                      }}
                      title="Зажмите и перетащите на другой элемент для создания связи"
                    >
                      <Link2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Primary Title */}
                <h4
                  className="text-sm font-semibold leading-snug mb-1 truncate"
                  style={{ color: 'var(--text-primary)' }}
                >
                  {el.title}
                </h4>

                {/* Concise Description */}
                <p
                  className="text-xs line-clamp-2 leading-relaxed mb-2.5"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  {el.description}
                </p>

                {/* Rigid Relative Structure Anatomy per Element Type */}
                <div
                  className="pt-2 border-t text-[11px] space-y-1 font-mono-tabular"
                  style={{ borderColor: 'var(--border-hairline)' }}
                >
                  {el.type === 'system' && (
                    <div
                      className="flex items-center justify-between"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      <span>Входящих элементов (contains):</span>
                      <span className="font-semibold">{systemChildrenCount}</span>
                    </div>
                  )}

                  {el.type === 'class' && (
                    <>
                      <div
                        className="flex items-center justify-between"
                        style={{ color: 'var(--text-secondary)' }}
                      >
                        <span>
                          Поля: {(el.fields || []).length} · Методы:{' '}
                          {(el.methods || []).length}
                        </span>
                        {el.extendsId && el.extendsId !== '-' && (
                          <span className="truncate max-w-[120px]">
                            ← {el.extendsId}
                          </span>
                        )}
                      </div>
                      {(el.fields || []).slice(0, 2).map((f) => (
                        <div
                          key={f.name}
                          className="truncate"
                          style={{ color: 'var(--text-muted)' }}
                        >
                          - {f.name}: {f.dataType}
                        </div>
                      ))}
                    </>
                  )}

                  {el.type === 'process' && (
                    <>
                      <div
                        className="flex items-center justify-between"
                        style={{ color: 'var(--text-secondary)' }}
                      >
                        <span>Шагов: {(el.steps || []).length}</span>
                        <span>Связей uses: {(el.uses || []).length}</span>
                      </div>
                      {(el.steps || []).slice(0, 2).map((s, idx) => (
                        <div
                          key={idx}
                          className="truncate"
                          style={{ color: 'var(--text-muted)' }}
                        >
                          {idx + 1}. {s}
                        </div>
                      ))}
                    </>
                  )}

                  {el.type === 'component' && (
                    <>
                      <div
                        className="flex items-center justify-between"
                        style={{ color: 'var(--text-secondary)' }}
                      >
                        <span>Интерфейс: {(el.interfaceItems || []).length}</span>
                        <span>Логика: {(el.internalLogic || []).length}</span>
                      </div>
                      {(el.interfaceItems || []).slice(0, 2).map((item, idx) => (
                        <div
                          key={idx}
                          className="truncate"
                          style={{ color: 'var(--text-muted)' }}
                        >
                          + {item}
                        </div>
                      ))}
                    </>
                  )}

                  {el.type === 'object' && (
                    <>
                      <div
                        className="flex items-center justify-between"
                        style={{ color: 'var(--text-secondary)' }}
                      >
                        <span>
                          Экземпляр:{' '}
                          {el.instanceOf && el.instanceOf !== '-'
                            ? el.instanceOf
                            : 'только комп.'}
                        </span>
                        <span>
                          Полей: {(el.values || []).length}/{inheritedForObj.length}
                        </span>
                      </div>
                      {(el.values || []).slice(0, 2).map((v) => (
                        <div
                          key={v.fieldName}
                          className="truncate"
                          style={{ color: 'var(--text-muted)' }}
                        >
                          {v.fieldName} = {v.value}
                        </div>
                      ))}
                    </>
                  )}

                  {el.type === 'idea' && (
                    <>
                      <div
                        className="flex items-center justify-between"
                        style={{ color: 'var(--text-secondary)' }}
                      >
                        <span>
                          Аннотирует:{' '}
                          {(el.notes || []).length > 0
                            ? el.notes!.join(', ')
                            : 'отдельная мысль'}
                        </span>
                      </div>
                      {el.altTo && el.altTo !== '-' && (
                        <div
                          className="truncate"
                          style={{ color: 'var(--ctx-neg)' }}
                        >
                          Отказ в пользу: {el.altTo}
                        </div>
                      )}
                    </>
                  )}

                  {/* Footer Metadata Line: File + Parent + Origin */}
                  <div
                    className="pt-1 flex items-center justify-between text-[10px] truncate"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    <span>
                      {el.fileName} · {el.status}
                    </span>
                    {el.parent && el.parent !== '-' && <span>in {el.parent}</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Bottom-left subtle canvas hint */}
        <div
          className="absolute bottom-3 left-3 px-3 py-1.5 rounded text-[11px] flex items-center gap-3 pointer-events-none"
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-hairline)',
            color: 'var(--text-muted)',
          }}
        >
          <span>Перетаскивайте блоки для раскладки</span>
          <span aria-hidden="true">·</span>
          <span>Зажмите иконку цепочки на карточке для протяжки связи</span>
          {aiContextIds.length > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <span
                className="font-medium inline-flex items-center gap-1"
                style={{ color: 'var(--ctx-pos)' }}
              >
                <Sparkles className="w-3 h-3" />В контексте ИИ: {aiContextIds.length}
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Blocks,
  ChevronDown,
  ChevronUp,
  Diamond,
  Focus,
  Group,
  Lightbulb,
  Maximize2,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  RotateCcw,
  Workflow,
} from 'lucide-react';
import {
  AiContradiction,
  AiInterviewQuestion,
  AiProposalCard,
  ElementType,
  GitCommit,
  LocaleKey,
  NegativePaletteKey,
  PlanElement,
  PositivePaletteKey,
  RelationType,
  ThemeMode,
  UnitLibraryItem,
} from './types/planager';
import {
  I18N_DICTIONARY,
  INITIAL_ELEMENTS,
  INITIAL_FILES,
  INITIAL_UNIT_LIBRARY,
  NEGATIVE_PALETTES,
  POSITIVE_PALETTES,
} from './data/initialProject';
import {
  buildAndValidateGraph,
  computeLineDiff,
  parsePgrFileContent,
  resolveInheritedFieldsForObject,
  serializeFileWithRanges,
  TYPE_HEADERS_RU,
  TYPE_PREFIXES,
} from './utils/pgrCodec';
import {
  buildRagIndex,
  generateLocalAnalysis,
  generateLocalInterviewQuestions,
  generateLocalTransformation,
} from './utils/aiEngine';

type PrimaryTab = 'kb' | 'canvas' | 'library' | 'settings';

const ELEMENT_TYPE_ICONS: Record<
  ElementType,
  React.ComponentType<{ size?: number; className?: string }>
> = {
  system: Blocks,
  class: Group,
  object: Focus,
  component: Diamond,
  process: Workflow,
  idea: Lightbulb,
};

function stripElementPrefix(id: string): string {
  return id.replace(/^(sys|cls|obj|cmp|proc|idea)_/, '');
}

function createSnapshotMap(
  elements: PlanElement[],
  files: string[]
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const f of files) {
    map[f] = serializeFileWithRanges(elements, f).content;
  }
  return map;
}

export function App() {
  const [activeTab, setActiveTab] = useState<PrimaryTab>('kb');
  const [leftPanelOpen, setLeftPanelOpen] = useState<boolean>(true);
  const [rightPanelOpen, setRightPanelOpen] = useState<boolean>(true);

  // Project files & elements
  const [files, setFiles] = useState<string[]>(INITIAL_FILES);
  const [elements, setElements] = useState<PlanElement[]>(INITIAL_ELEMENTS);
  const [activeFile, setActiveFile] = useState<string>('sys_inventory.pgr');
  const [selectedId, setSelectedId] = useState<string | null>('cls_item');

  // Knowledge Base Editor state
  const [kbEditorMode, setKbEditorMode] = useState<'structured' | 'raw_pgr'>(
    'structured'
  );
  const [cursorLine, setCursorLine] = useState<number>(13);
  const [lineRangeFilter, setLineRangeFilter] = useState<{
    start: number;
    end: number;
  } | null>(null);
  const [rangeStartInput, setRangeStartInput] = useState<string>('1');
  const [rangeEndInput, setRangeEndInput] = useState<string>('24');

  // Search & filter state
  const [kbSearch, setKbSearch] = useState<string>('');
  const [kbTypeFilter, setKbTypeFilter] = useState<ElementType | 'all'>('all');
  const [kbMvpFilter, setKbMvpFilter] = useState<'all' | 'mvp' | 'later'>('all');

  // Canvas state (with pan, wheel zoom, and non-sticking node drag)
  const [canvasZoom, setCanvasZoom] = useState<number>(100);
  const [canvasPan, setCanvasPan] = useState<{ x: number; y: number }>({
    x: 20,
    y: 20,
  });
  const [isPanningCanvas, setIsPanningCanvas] = useState<boolean>(false);
  const [panStart, setPanStart] = useState<{ x: number; y: number }>({
    x: 0,
    y: 0,
  });
  const [expandedNodeIds, setExpandedNodeIds] = useState<
    Record<string, boolean>
  >({});
  const [visibleRelations, setVisibleRelations] = useState<
    Record<RelationType, boolean>
  >({
    contains: true,
    extends: true,
    has: true,
    instance_of: true,
    uses: true,
    notes: true,
  });
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({
    x: 0,
    y: 0,
  });
  const [alignmentGuides, setAlignmentGuides] = useState<{
    verticalX: number | null;
    horizontalY: number | null;
  }>({
    verticalX: null,
    horizontalY: null,
  });
  const [moveHistory, setMoveHistory] = useState<
    Record<string, { x: number; y: number }>[]
  >([]);
  const dragStartSnapshotRef = useRef<Record<
    string,
    { x: number; y: number }
  > | null>(null);
  const draggingNodeIdRef = useRef<string | null>(null);
  const elementsRef = useRef<PlanElement[]>(elements);
  elementsRef.current = elements;
  draggingNodeIdRef.current = draggingNodeId;

  const [connectingFromId, setConnectingFromId] = useState<string | null>(null);
  const [mouseCanvasPos, setMouseCanvasPos] = useState<{ x: number; y: number }>({
    x: 0,
    y: 0,
  });
  const canvasAreaRef = useRef<HTMLDivElement>(null);

  // Mini Graph View (Obsidian-style in KB right sidebar) state
  const [miniGraphMode, setMiniGraphMode] = useState<'all' | 'local'>('all');
  const [graphSpread, setGraphSpread] = useState<number>(1.15);
  const [hoveredMiniNodeId, setHoveredMiniNodeId] = useState<string | null>(
    null
  );
  const [miniGraphView, setMiniGraphView] = useState<{
    zoom: number;
    pan: { x: number; y: number };
  }>({
    zoom: 100,
    pan: { x: 0, y: 0 },
  });
  const miniGraphZoom = miniGraphView.zoom;
  const miniGraphPan = miniGraphView.pan;
  const [miniGraphIsPanning, setMiniGraphIsPanning] = useState<boolean>(false);
  const [miniGraphPanStart, setMiniGraphPanStart] = useState<{
    x: number;
    y: number;
  }>({ x: 0, y: 0 });
  const miniGraphDownClientRef = useRef<{ x: number; y: number }>({
    x: 0,
    y: 0,
  });
  const miniGraphDragMovedRef = useRef<boolean>(false);
  const miniGraphRef = useRef<HTMLDivElement>(null);

  // Full Graph View inside KB main area (.editor-column) state
  const [kbMainGraphOpen, setKbMainGraphOpen] = useState<boolean>(false);
  const [mainGraphView, setMainGraphView] = useState<{
    zoom: number;
    pan: { x: number; y: number };
  }>({
    zoom: 100,
    pan: { x: 0, y: 0 },
  });
  const mainGraphZoom = mainGraphView.zoom;
  const mainGraphPan = mainGraphView.pan;
  const [mainGraphIsPanning, setMainGraphIsPanning] = useState<boolean>(false);
  const [mainGraphPanStart, setMainGraphPanStart] = useState<{
    x: number;
    y: number;
  }>({ x: 0, y: 0 });
  const mainGraphDownClientRef = useRef<{ x: number; y: number }>({
    x: 0,
    y: 0,
  });
  const mainGraphDragMovedRef = useRef<boolean>(false);
  const mainGraphRef = useRef<HTMLDivElement>(null);

  const commitDragSnapshotIfMoved = () => {
    const activeDragId = draggingNodeIdRef.current;
    const startSnap = dragStartSnapshotRef.current;
    if (activeDragId && startSnap) {
      const startPos = startSnap[activeDragId];
      const currEl = elementsRef.current.find((e) => e.id === activeDragId);
      if (
        startPos &&
        currEl &&
        (startPos.x !== currEl.position.x || startPos.y !== currEl.position.y)
      ) {
        setMoveHistory((prev) => [...prev.slice(-49), startSnap]);
      }
    }
    dragStartSnapshotRef.current = null;
  };

  // Global mouseup/blur safety so dragged nodes on Canvas never stick to cursor
  useEffect(() => {
    const handleGlobalMouseUp = () => {
      commitDragSnapshotIfMoved();
      setDraggingNodeId(null);
      setConnectingFromId(null);
      setIsPanningCanvas(false);
      setAlignmentGuides({ verticalX: null, horizontalY: null });
      setMiniGraphIsPanning(false);
      setMainGraphIsPanning(false);
    };
    window.addEventListener('mouseup', handleGlobalMouseUp);
    window.addEventListener('blur', handleGlobalMouseUp);
    return () => {
      window.removeEventListener('mouseup', handleGlobalMouseUp);
      window.removeEventListener('blur', handleGlobalMouseUp);
    };
  }, []);

  // Non-passive wheel listener on Mini Graph so sidebar vertical scroll never triggers while cursor is over the graph
  useEffect(() => {
    const el = miniGraphRef.current;
    if (!el) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const rect = el.getBoundingClientRect();
      const delta = e.deltaY < 0 ? 10 : -10;
      const cursorX = e.clientX - rect.left - el.clientLeft;
      const cursorY = e.clientY - rect.top - el.clientTop;
      setMiniGraphView((prev) => {
        const nextZoom = Math.min(180, Math.max(60, prev.zoom + delta));
        if (nextZoom === prev.zoom) return prev;
        const oldScale = prev.zoom / 100;
        const newScale = nextZoom / 100;
        const worldX = (cursorX - prev.pan.x) / oldScale;
        const worldY = (cursorY - prev.pan.y) / oldScale;
        return {
          zoom: nextZoom,
          pan: {
            x: cursorX - worldX * newScale,
            y: cursorY - worldY * newScale,
          },
        };
      });
    };
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', handleWheel);
    };
  }, [activeTab]);

  // Non-passive wheel listener on Main Area Graph View
  useEffect(() => {
    const el = mainGraphRef.current;
    if (!el) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const rect = el.getBoundingClientRect();
      const delta = e.deltaY < 0 ? 10 : -10;
      const cursorX = e.clientX - rect.left - el.clientLeft;
      const cursorY = e.clientY - rect.top - el.clientTop;
      setMainGraphView((prev) => {
        const nextZoom = Math.min(200, Math.max(50, prev.zoom + delta));
        if (nextZoom === prev.zoom) return prev;
        const oldScale = prev.zoom / 100;
        const newScale = nextZoom / 100;
        const worldX = (cursorX - prev.pan.x) / oldScale;
        const worldY = (cursorY - prev.pan.y) / oldScale;
        return {
          zoom: nextZoom,
          pan: {
            x: cursorX - worldX * newScale,
            y: cursorY - worldY * newScale,
          },
        };
      });
    };
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', handleWheel);
    };
  }, [activeTab, kbMainGraphOpen]);

  // Ctrl + Z undo for component movements on Canvas
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      const isZ =
        e.code === 'KeyZ' ||
        e.key.toLowerCase() === 'z' ||
        e.key.toLowerCase() === 'я';
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && isZ) {
        setMoveHistory((prev) => {
          if (prev.length === 0) return prev;
          e.preventDefault();
          const lastSnapshot = prev[prev.length - 1];
          setElements((curr) =>
            curr.map((el) =>
              lastSnapshot[el.id]
                ? { ...el, position: { ...lastSnapshot[el.id] } }
                : el
            )
          );
          showNotice('Отменено перемещение (Ctrl+Z)');
          return prev.slice(0, -1);
        });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Unit Library state
  const [unitLibrary, setUnitLibrary] =
    useState<UnitLibraryItem[]>(INITIAL_UNIT_LIBRARY);
  const [libCategoryFilter, setLibCategoryFilter] = useState<
    'all' | ElementType
  >('all');
  const [libSearch, setLibSearch] = useState<string>('');

  // Settings state (Default 'dark' for Variation 5 System Dark)
  const [themeMode, setThemeMode] = useState<ThemeMode>('dark');
  const [posPalette, setPosPalette] = useState<PositivePaletteKey>('emerald');
  const [negPalette, setNegPalette] = useState<NegativePaletteKey>('crimson');
  const [aiEndpoint, setAiEndpoint] = useState<string>(
    'https://api.openai.com/v1'
  );
  const [aiEnabled, setAiEnabled] = useState<boolean>(true);
  const [gitEnabled, setGitEnabled] = useState<boolean>(true);
  const [gitHistoryOpen, setGitHistoryOpen] = useState<boolean>(false);
  const [locale, setLocale] = useState<LocaleKey>('ru');
  const [activeSettingsSection, setActiveSettingsSection] =
    useState<string>('theme');

  // Git commits & uncommitted count
  const [uncommittedChanges, setUncommittedChanges] = useState<number>(3);
  const [commits, setCommits] = useState<GitCommit[]>(() => [
    {
      id: 'commit_1',
      hash: 'a4f920c',
      message: 'Базовая структура sys_inventory.pgr и sys_factions.pgr',
      timestamp: '2026-09-26 10:15',
      author: 'main',
      filesSnapshot: createSnapshotMap(INITIAL_ELEMENTS, INITIAL_FILES),
      elementsSnapshot: JSON.parse(JSON.stringify(INITIAL_ELEMENTS)),
    },
  ]);
  const [commitMsgInput, setCommitMsgInput] = useState<string>('');
  const [diffFileSelect, setDiffFileSelect] =
    useState<string>('sys_inventory.pgr');

  // AI Assistant state & modal
  const [aiModalOpen, setAiModalOpen] = useState<boolean>(false);
  const [aiContextIds, setAiContextIds] = useState<string[]>(['cls_item']);
  const [proposals, setProposals] = useState<AiProposalCard[]>([]);
  const [contradictions, setContradictions] = useState<AiContradiction[]>([]);
  const [interviewQuestions, setInterviewQuestions] = useState<
    AiInterviewQuestion[]
  >([]);
  const [rejectProposalModal, setRejectProposalModal] =
    useState<AiProposalCard | null>(null);
  const [rejectReasonInput, setRejectReasonInput] = useState<string>('');

  // Creation / deletion modals
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [newElementModalOpen, setNewElementModalOpen] = useState<boolean>(false);
  const [newElType, setNewElType] = useState<ElementType>('class');
  const [newElTitle, setNewElTitle] = useState<string>('');
  const [newElSlug, setNewElSlug] = useState<string>('');
  const [newElFile, setNewElFile] = useState<string>('sys_inventory.pgr');
  const [newElParent, setNewElParent] = useState<string>('sys_inventory');
  const [newElMvp, setNewElMvp] = useState<boolean>(true);

  // Inline field/method/step inputs
  const [inlineFieldName, setInlineFieldName] = useState<string>('');
  const [inlineFieldType, setInlineFieldType] = useState<string>('string');
  const [inlineFieldDesc, setInlineFieldDesc] = useState<string>('');
  const [inlineMethodVis, setInlineMethodVis] = useState<'+' | '-'>('+');
  const [inlineMethodSig, setInlineMethodSig] = useState<string>('');
  const [inlineMethodDesc, setInlineMethodDesc] = useState<string>('');
  const [inlineStepText, setInlineStepText] = useState<string>('');
  const [inlineInterfaceText, setInlineInterfaceText] = useState<string>('');
  const [inlineLogicText, setInlineLogicText] = useState<string>('');

  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  const t = I18N_DICTIONARY[locale];

  const showNotice = (msg: string) => {
    setStatusNotice(msg);
    setTimeout(() => {
      setStatusNotice((prev) => (prev === msg ? null : prev));
    }, 3000);
  };

  // Sync theme and contextual color pairs to CSS variables
  useEffect(() => {
    const root = document.documentElement;
    const prefersDark = window.matchMedia(
      '(prefers-color-scheme: dark)'
    ).matches;
    const isDark =
      themeMode === 'dark' || (themeMode === 'system' && prefersDark);
    const isClassic = themeMode === 'classic';

    if (isDark) {
      root.classList.add('dark');
      root.classList.remove('theme-classic');
      root.style.colorScheme = 'dark';
    } else if (isClassic) {
      root.classList.remove('dark');
      root.classList.add('theme-classic');
      root.style.colorScheme = 'light';
    } else {
      root.classList.remove('dark');
      root.classList.remove('theme-classic');
      root.style.colorScheme = 'light';
    }

    const pos = POSITIVE_PALETTES[posPalette];
    const neg = NEGATIVE_PALETTES[negPalette];
    const posText = isDark ? pos.textDark : pos.text;
    const negText = isDark ? neg.textDark : neg.text;

    root.style.setProperty('--ctx-pos', pos.main);
    root.style.setProperty('--ctx-pos-hover', pos.hover);
    root.style.setProperty('--ctx-pos-soft', pos.soft);
    root.style.setProperty('--ctx-pos-border', pos.border);
    root.style.setProperty('--ctx-pos-text', posText);

    root.style.setProperty('--ctx-neg', neg.main);
    root.style.setProperty('--ctx-neg-hover', neg.hover);
    root.style.setProperty('--ctx-neg-soft', neg.soft);
    root.style.setProperty('--ctx-neg-border', neg.border);
    root.style.setProperty('--ctx-neg-text', negText);

    root.style.setProperty('--accent', isClassic ? '#000000' : posText);
  }, [themeMode, posPalette, negPalette]);

  // Run analysis when elements or selected context change
  useEffect(() => {
    const local = generateLocalAnalysis(elements, aiContextIds, files);
    setProposals(local.proposals);
    setContradictions(local.contradictions);
    setInterviewQuestions(
      generateLocalInterviewQuestions(elements, aiContextIds)
    );
  }, [elements, aiContextIds, files]);

  // Filtered elements
  const filteredElements = useMemo(() => {
    return elements.filter((el) => {
      if (kbTypeFilter !== 'all' && el.type !== kbTypeFilter) return false;
      if (kbMvpFilter === 'mvp' && !el.mvp) return false;
      if (kbMvpFilter === 'later' && el.mvp) return false;
      if (kbSearch.trim()) {
        const q = kbSearch.toLowerCase();
        return (
          el.id.toLowerCase().includes(q) ||
          el.title.toLowerCase().includes(q) ||
          el.description.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [elements, kbTypeFilter, kbMvpFilter, kbSearch]);

  const { edges } = useMemo(
    () => buildAndValidateGraph(filteredElements),
    [filteredElements]
  );

  // Shared topology-aware layout generator that keeps tightly coupled nodes in the core
  // and pushes peripheral radicals / secondary sub-clusters (like join_faction -> factions + reputation_bound) outward
  const buildClusteredLayout = (
    nodes: PlanElement[],
    activeEdges: ReturnType<typeof buildAndValidateGraph>['edges'],
    W: number,
    H: number,
    baseScale: number,
    spread: number
  ) => {
    const cx = W / 2;
    const cy = H / 2;
    const scale = baseScale * spread;
    const posMap: Record<string, { x: number; y: number }> = {};
    if (nodes.length === 0) return posMap;

    const nodeMap = new Map<string, PlanElement>();
    nodes.forEach((n) => nodeMap.set(n.id, n));

    const adj: Record<string, Set<string>> = {};
    nodes.forEach((n) => {
      adj[n.id] = new Set<string>();
    });
    activeEdges.forEach((e) => {
      if (adj[e.source] && adj[e.target] && e.source !== e.target) {
        adj[e.source].add(e.target);
        adj[e.target].add(e.source);
      }
    });

    const getClusterRoot = (el: PlanElement): string => {
      if (el.type === 'system') return el.id;
      if (el.parent && el.parent !== '-') return el.parent;
      if (el.altTo && el.altTo !== '-') return el.altTo;
      return el.fileName;
    };

    // Determine anchor node (selectedId if present, else highest-degree node)
    let anchorId =
      selectedId && nodeMap.has(selectedId) ? selectedId : nodes[0].id;
    if (!selectedId || !nodeMap.has(selectedId)) {
      let bestDeg = -1;
      nodes.forEach((n) => {
        const deg = adj[n.id]?.size || 0;
        if (deg > bestDeg) {
          bestDeg = deg;
          anchorId = n.id;
        }
      });
    }

    const anchorEl = nodeMap.get(anchorId)!;
    const anchorCluster = getClusterRoot(anchorEl);

    // BFS hop distance from anchorId
    const hopDist: Record<string, number> = {};
    nodes.forEach((n) => {
      hopDist[n.id] = Infinity;
    });
    hopDist[anchorId] = 0;
    const queue: string[] = [anchorId];
    while (queue.length > 0) {
      const curr = queue.shift()!;
      const d = hopDist[curr];
      adj[curr].forEach((nb) => {
        if (hopDist[nb] === Infinity) {
          hopDist[nb] = d + 1;
          queue.push(nb);
        }
      });
    }

    // Identify Core Cluster vs Peripheral Radicals
    // A node belongs to the core cluster if it is the anchor, or belongs to the anchor's system/cluster within 2 hops,
    // or has >= 2 links into the anchor's system cluster (and doesn't pull in an external sub-cluster).
    const sameSystemSet = new Set<string>();
    nodes.forEach((n) => {
      if (getClusterRoot(n) === anchorCluster) {
        sameSystemSet.add(n.id);
      }
    });

    const coreSet = new Set<string>([anchorId]);
    nodes.forEach((n) => {
      if (n.id === anchorId) return;
      if (hopDist[n.id] > 2) return;
      const inSameSystem = sameSystemSet.has(n.id);
      let linksToSameSystem = 0;
      let linksToExternal = 0;
      adj[n.id].forEach((nb) => {
        if (sameSystemSet.has(nb)) linksToSameSystem++;
        else linksToExternal++;
      });

      if (inSameSystem) {
        coreSet.add(n.id);
      } else if (linksToSameSystem >= 2 && linksToExternal === 0) {
        coreSet.add(n.id);
      }
    });

    // If anchor is an isolated node or has no same-system peers, include its direct 1-hop neighbors in coreSet
    if (coreSet.size === 1) {
      adj[anchorId].forEach((nb) => coreSet.add(nb));
    }

    // Connected components of non-core reachable nodes ("radicals" / secondary sub-clusters)
    const visitedNonCore = new Set<string>();
    const radicalClusters: {
      members: string[];
      bridges: string[];
      distals: string[];
      coreAttachments: string[];
    }[] = [];
    const isolatedNodes: string[] = [];

    nodes.forEach((n) => {
      if (coreSet.has(n.id) || visitedNonCore.has(n.id)) return;
      if (hopDist[n.id] === Infinity) {
        visitedNonCore.add(n.id);
        isolatedNodes.push(n.id);
        return;
      }
      // BFS within (nodes \ coreSet)
      const comp: string[] = [];
      const q: string[] = [n.id];
      visitedNonCore.add(n.id);
      while (q.length > 0) {
        const cur = q.shift()!;
        comp.push(cur);
        adj[cur].forEach((nb) => {
          if (!coreSet.has(nb) && !visitedNonCore.has(nb)) {
            visitedNonCore.add(nb);
            q.push(nb);
          }
        });
      }

      const bridges: string[] = [];
      const distals: string[] = [];
      const attachSet = new Set<string>();
      comp.forEach((cid) => {
        let touchesCore = false;
        adj[cid].forEach((nb) => {
          if (coreSet.has(nb)) {
            touchesCore = true;
            attachSet.add(nb);
          }
        });
        if (touchesCore) bridges.push(cid);
        else distals.push(cid);
      });

      radicalClusters.push({
        members: comp,
        bridges,
        distals,
        coreAttachments: Array.from(attachSet),
      });
    });

    // Set of core nodes that serve as attachment points for radical clusters
    const coreBridgeAttachSet = new Set<string>();
    radicalClusters.forEach((rc) => {
      rc.coreAttachments.forEach((id) => coreBridgeAttachSet.add(id));
    });

    // 1. Place Core Cluster around (cx, cy)
    posMap[anchorId] = { x: cx, y: cy };
    const coreRing1 = nodes.filter(
      (n) => n.id !== anchorId && coreSet.has(n.id) && hopDist[n.id] === 1
    );
    const coreRing2 = nodes.filter(
      (n) => n.id !== anchorId && coreSet.has(n.id) && hopDist[n.id] > 1
    );

    // Order coreRing1 so nodes that attach to radicals sit on a clean outward angle (bottom-right / bottom-left)
    const orderedRing1 = [
      ...coreRing1.filter((n) => coreBridgeAttachSet.has(n.id)),
      ...coreRing1.filter((n) => !coreBridgeAttachSet.has(n.id)),
    ];

    const r1X = 115 * scale;
    const r1Y = 102 * scale;
    orderedRing1.forEach((n, idx) => {
      const angle =
        Math.PI * 0.65 +
        (2 * Math.PI * idx) / Math.max(1, orderedRing1.length);
      posMap[n.id] = {
        x: cx + Math.cos(angle) * r1X,
        y: cy + Math.sin(angle) * r1Y,
      };
    });

    const r2X = (orderedRing1.length > 0 ? 172 : 120) * scale;
    const r2Y = (orderedRing1.length > 0 ? 148 : 105) * scale;
    coreRing2.forEach((n, idx) => {
      // Place near average angle of its coreRing1 neighbors, biased away from the radical sector
      let sumX = 0;
      let sumY = 0;
      let count = 0;
      adj[n.id].forEach((nb) => {
        if (posMap[nb] && nb !== anchorId) {
          sumX += posMap[nb].x - cx;
          sumY += posMap[nb].y - cy;
          count++;
        }
      });
      const baseAngle =
        count > 0
          ? Math.atan2(sumY / count, sumX / count) +
            ((idx % 2 === 0 ? 1 : -1) * 0.38)
          : -Math.PI / 2 + (2 * Math.PI * idx) / Math.max(1, coreRing2.length);
      posMap[n.id] = {
        x: cx + Math.cos(baseAngle) * r2X,
        y: cy + Math.sin(baseAngle) * r2Y,
      };
    });

    // 2. Place Radical Sub-clusters far outward along the ray from (cx, cy) through their core attachment node
    const nodeRadicalGroup: Record<string, number> = {};
    const isDistalRadical = new Set<string>();
    const isBridgeRadical = new Set<string>();
    const radicalOutwardDir: Record<string, { ux: number; uy: number }> = {};

    radicalClusters.forEach((rc, rcIdx) => {
      let attachX = cx;
      let attachY = cy;
      if (rc.coreAttachments.length > 0) {
        attachX =
          rc.coreAttachments.reduce(
            (acc, id) => acc + (posMap[id]?.x ?? cx),
            0
          ) / rc.coreAttachments.length;
        attachY =
          rc.coreAttachments.reduce(
            (acc, id) => acc + (posMap[id]?.y ?? cy),
            0
          ) / rc.coreAttachments.length;
      }
      let dx = attachX - cx;
      let dy = attachY - cy;
      let len = Math.hypot(dx, dy);
      if (len < 1e-3) {
        const fallbackAngle = Math.PI * 0.28 + rcIdx * 1.1;
        dx = Math.cos(fallbackAngle);
        dy = Math.sin(fallbackAngle);
        len = 1;
      }
      const ux = dx / len;
      const uy = dy / len;
      const px = -uy;
      const py = ux;

      rc.members.forEach((mId) => {
        nodeRadicalGroup[mId] = rcIdx + 1;
        radicalOutwardDir[mId] = { ux, uy };
      });

      // Place bridge nodes (e.g. join_faction) outward beyond the attachment node
      const bridgeDistFromAttach = 155 * scale;
      rc.bridges.forEach((bId, bIdx) => {
        isBridgeRadical.add(bId);
        const lateral =
          (bIdx - (rc.bridges.length - 1) / 2) * 85 * scale;
        posMap[bId] = {
          x: attachX + ux * bridgeDistFromAttach + px * lateral,
          y: attachY + uy * bridgeDistFromAttach + py * lateral,
        };
      });

      // Anchor point for distal nodes is the centroid of bridge nodes
      const bridgeCenter =
        rc.bridges.length > 0
          ? {
              x:
                rc.bridges.reduce((a, id) => a + posMap[id].x, 0) /
                rc.bridges.length,
              y:
                rc.bridges.reduce((a, id) => a + posMap[id].y, 0) /
                rc.bridges.length,
            }
          : {
              x: attachX + ux * bridgeDistFromAttach,
              y: attachY + uy * bridgeDistFromAttach,
            };

      // Place distal nodes (e.g. factions, reputation_bound) EVEN FURTHER outward beyond the bridge node
      const distalStepOut = 135 * scale;
      const distalSpreadLat = 88 * scale;
      rc.distals.forEach((dId, dIdx) => {
        isDistalRadical.add(dId);
        const lateralFactor =
          rc.distals.length === 1
            ? 0
            : dIdx - (rc.distals.length - 1) / 2;
        posMap[dId] = {
          x:
            bridgeCenter.x +
            ux * distalStepOut +
            px * lateralFactor * distalSpreadLat,
          y:
            bridgeCenter.y +
            uy * distalStepOut +
            py * lateralFactor * distalSpreadLat,
        };
      });
    });

    // 3. Place completely disconnected / isolated nodes on the outer periphery
    isolatedNodes.forEach((isoId, idx) => {
      const angle = -Math.PI * 0.78 - idx * 0.55;
      posMap[isoId] = {
        x: cx + Math.cos(angle) * 255 * scale,
        y: cy + Math.sin(angle) * 205 * scale,
      };
    });

    // 4. Force relaxation with strong inter-cluster repulsion and outward centrifugal bias for radicals
    for (let iter = 0; iter < 52; iter++) {
      const disp: Record<string, { dx: number; dy: number }> = {};
      nodes.forEach((n) => {
        disp[n.id] = { dx: 0, dy: 0 };
      });

      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i].id;
          const b = nodes[j].id;
          const vx = posMap[a].x - posMap[b].x;
          const vy = posMap[a].y - posMap[b].y;
          const dist = Math.max(8, Math.hypot(vx, vy));

          const aInCore = coreSet.has(a);
          const bInCore = coreSet.has(b);
          const sameRadical =
            !aInCore &&
            !bInCore &&
            nodeRadicalGroup[a] !== undefined &&
            nodeRadicalGroup[a] === nodeRadicalGroup[b];

          // Larger repulsion radius between main cluster and external radicals so they never crowd together
          const minSep =
            aInCore && bInCore
              ? 122 * scale
              : sameRadical
              ? 116 * scale
              : 205 * scale;

          if (dist < minSep) {
            const strength = aInCore !== bInCore ? 0.52 : 0.42;
            const push = ((minSep - dist) / dist) * strength;
            // If one is in core and one is radical, push the radical outward much more than the core
            const weightA = !aInCore && bInCore ? 1.55 : aInCore && !bInCore ? 0.45 : 1;
            const weightB = !bInCore && aInCore ? 1.55 : bInCore && !aInCore ? 0.45 : 1;
            disp[a].dx += vx * push * weightA;
            disp[a].dy += vy * push * weightA;
            disp[b].dx -= vx * push * weightB;
            disp[b].dy -= vy * push * weightB;
          }
        }
      }

      activeEdges.forEach((e) => {
        const a = e.source;
        const b = e.target;
        if (!posMap[a] || !posMap[b]) return;
        const vx = posMap[b].x - posMap[a].x;
        const vy = posMap[b].y - posMap[a].y;
        const dist = Math.max(8, Math.hypot(vx, vy));

        const aInCore = coreSet.has(a);
        const bInCore = coreSet.has(b);
        const isBridgeEdge = aInCore !== bInCore;
        const isRadicalInternal = !aInCore && !bInCore;

        const targetDist = isBridgeEdge
          ? 170 * scale
          : isRadicalInternal
          ? 118 * scale
          : a === anchorId || b === anchorId
          ? 118 * scale
          : 135 * scale;

        const pull = ((dist - targetDist) / dist) * 0.14;
        disp[a].dx += vx * pull;
        disp[a].dy += vy * pull;
        disp[b].dx -= vx * pull;
        disp[b].dy -= vy * pull;
      });

      // Centrifugal outward bias for radical nodes so distal radical nodes always stay further from the core than their bridge
      nodes.forEach((n) => {
        const id = n.id;
        const dir = radicalOutwardDir[id];
        if (!dir) return;
        const relX = posMap[id].x - cx;
        const relY = posMap[id].y - cy;
        const proj = relX * dir.ux + relY * dir.uy;
        const minOutwardProj = isDistalRadical.has(id)
          ? 295 * scale
          : isBridgeRadical.has(id)
          ? 195 * scale
          : 0;
        if (proj < minOutwardProj) {
          const boost = (minOutwardProj - proj) * 0.22;
          disp[id].dx += dir.ux * boost;
          disp[id].dy += dir.uy * boost;
        }
      });

      nodes.forEach((n) => {
        if (n.id === anchorId) {
          posMap[n.id].x = cx;
          posMap[n.id].y = cy;
          return;
        }
        posMap[n.id].x += disp[n.id].dx;
        posMap[n.id].y += disp[n.id].dy;
      });
    }

    return posMap;
  };

  // Obsidian-like force/radial layout for the right sidebar Graph View
  const miniGraphLayout = useMemo(() => {
    const W = 292;
    const H = 216;

    let nodes = filteredElements;
    if (miniGraphMode === 'local' && selectedId) {
      const neighborSet = new Set<string>([selectedId]);
      edges.forEach((e) => {
        if (e.source === selectedId) neighborSet.add(e.target);
        if (e.target === selectedId) neighborSet.add(e.source);
      });
      // Include 2-hop neighbors if direct neighborhood is very small
      if (neighborSet.size <= 3) {
        const snapshot = Array.from(neighborSet);
        edges.forEach((e) => {
          if (snapshot.includes(e.source)) neighborSet.add(e.target);
          if (snapshot.includes(e.target)) neighborSet.add(e.source);
        });
      }
      nodes = filteredElements.filter((el) => neighborSet.has(el.id));
    }

    const nodeIds = new Set(nodes.map((n) => n.id));
    const activeEdges = edges.filter(
      (e) => nodeIds.has(e.source) && nodeIds.has(e.target)
    );

    const posMap = buildClusteredLayout(
      nodes,
      activeEdges,
      W,
      H,
      0.42,
      graphSpread
    );

    return { nodes, activeEdges, posMap };
  }, [filteredElements, edges, miniGraphMode, selectedId, graphSpread]);

  // Automatic radial/force layout for the full-size Graph View in the KB main editor column
  const mainGraphLayout = useMemo(() => {
    const W = 820;
    const H = 540;
    const { nodes, activeEdges } = miniGraphLayout;

    const posMap = buildClusteredLayout(
      nodes,
      activeEdges,
      W,
      H,
      1.0,
      graphSpread
    );

    return { nodes, activeEdges, posMap, width: W, height: H };
  }, [miniGraphLayout, selectedId, graphSpread]);

  const selectedElement = useMemo(
    () =>
      selectedId ? elements.find((e) => e.id === selectedId) || null : null,
    [elements, selectedId]
  );

  const activeFileData = useMemo(() => {
    const targetFile = selectedElement?.fileName || activeFile || files[0] || '';
    return serializeFileWithRanges(elements, targetFile);
  }, [elements, selectedElement, activeFile, files]);

  const selectedElementRange = useMemo(() => {
    if (!selectedElement) return { startLine: 1, endLine: 24 };
    const found = activeFileData.ranges.find(
      (r) => r.elementId === selectedElement.id
    );
    return found || { startLine: 1, endLine: 24 };
  }, [selectedElement, activeFileData]);

  const [rawPgrDraft, setRawPgrDraft] = useState<string>('');
  useEffect(() => {
    setRawPgrDraft(activeFileData.content);
  }, [activeFileData.content]);

  const updateElement = (updated: PlanElement) => {
    setElements((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
    setUncommittedChanges((c) => c + 1);
  };

  const usedByIds = useMemo(() => {
    if (!selectedElement) return [];
    const id = selectedElement.id;
    return elements
      .filter(
        (e) =>
          e.id !== id &&
          (e.instanceOf === id ||
            e.extendsId === id ||
            (e.uses || []).includes(id) ||
            (e.components || []).includes(id) ||
            (e.notes || []).includes(id))
      )
      .map((e) => e.id);
  }, [elements, selectedElement]);

  const inheritedObjectFields = useMemo(() => {
    if (!selectedElement || selectedElement.type !== 'object') return [];
    return resolveInheritedFieldsForObject(selectedElement, elements);
  }, [selectedElement, elements]);

  const handleConnectOnCanvas = (sourceId: string, targetId: string) => {
    const src = elements.find((e) => e.id === sourceId);
    const tgt = elements.find((e) => e.id === targetId);
    if (!src || !tgt || sourceId === targetId) return;

    if (src.type === 'system' && tgt.type !== 'system') {
      updateElement({ ...tgt, parent: src.id });
      showNotice(`contains: ${tgt.id} → parent: ${src.id}`);
    } else if (src.type === 'class' && tgt.type === 'class') {
      updateElement({ ...src, extendsId: tgt.id });
      showNotice(`extends: ${src.id} → ${tgt.id}`);
    } else if (src.type === 'object' && tgt.type === 'class') {
      updateElement({ ...src, instanceOf: tgt.id });
      showNotice(`instance_of: ${src.id} → ${tgt.id}`);
    } else if (
      ['class', 'process', 'component', 'object'].includes(src.type) &&
      tgt.type === 'component'
    ) {
      const next = Array.from(new Set([...(src.components || []), tgt.id]));
      updateElement({ ...src, components: next });
      showNotice(`has: ${src.id} → ${tgt.id}`);
    } else if (src.type === 'idea') {
      const next = Array.from(new Set([...(src.notes || []), tgt.id]));
      updateElement({ ...src, notes: next });
      showNotice(`notes: ${src.id} → ${tgt.id}`);
    } else if (src.type === 'process' || src.type === 'class') {
      const next = Array.from(new Set([...(src.uses || []), tgt.id]));
      updateElement({ ...src, uses: next });
      showNotice(`uses: ${src.id} → ${tgt.id}`);
    } else {
      showNotice('Для выбранной пары типов связь не предусмотрена');
    }
  };

  const handleApplyProposal = (prop: AiProposalCard) => {
    if (prop.suggestedElement) {
      const se = prop.suggestedElement;
      const targetFile = se.fileName || activeFile || 'sys_inventory.pgr';
      if (!files.includes(targetFile)) {
        setFiles((prev) => [...prev, targetFile]);
      }
      const created: PlanElement = {
        id: se.id,
        type: se.type,
        title: se.title,
        fileName: targetFile,
        parent: se.parent || '-',
        description: se.description,
        status: 'черновик',
        mvp: se.mvp ?? true,
        position: { x: 540, y: 180 + (elements.length % 3) * 140 },
        steps: se.steps,
        components: se.components,
        uses: se.uses,
        interfaceItems: se.interfaceItems,
        internalLogic: se.internalLogic,
        instanceOf: se.instanceOf,
        values: se.values,
      };
      setElements((prev) => {
        const next = [...prev.filter((x) => x.id !== created.id), created];
        if (created.type === 'component' && prop.targetElementId) {
          return next.map((el) =>
            el.id === prop.targetElementId
              ? {
                  ...el,
                  components: Array.from(
                    new Set([...(el.components || []), created.id])
                  ),
                }
              : el
          );
        }
        return next;
      });
      setSelectedId(created.id);
      setUncommittedChanges((c) => c + 1);
      showNotice(`Применено предложение: добавлен ${created.id}`);
    }
    setProposals((prev) => prev.filter((p) => p.id !== prop.id));
  };

  const handleConfirmRejectProposal = () => {
    if (!rejectProposalModal) return;
    const prop = rejectProposalModal;
    const ideaFile = files.includes('idea_backlog.pgr')
      ? 'idea_backlog.pgr'
      : files[0] || 'idea_backlog.pgr';
    if (!files.includes(ideaFile)) {
      setFiles((prev) => [...prev, ideaFile]);
    }
    const rejIdea: PlanElement = {
      id: `idea_alt_${Date.now().toString().slice(-3)}`,
      type: 'idea',
      title: `Отклонено: ${prop.title}`,
      fileName: ideaFile,
      parent: '-',
      description: prop.rationale,
      status: 'черновик',
      mvp: false,
      position: { x: 40, y: 460 },
      notes: prop.targetElementId ? [prop.targetElementId] : [],
      altTo: prop.targetElementId || '-',
      altReason:
        rejectReasonInput.trim() || 'Отклонено пользователем при ревью плана',
    };
    setElements((prev) => [...prev, rejIdea]);
    setProposals((prev) => prev.filter((p) => p.id !== prop.id));
    setRejectProposalModal(null);
    setRejectReasonInput('');
    setUncommittedChanges((c) => c + 1);
    showNotice(`Отклонённый вариант сохранён как Идея-образ (${rejIdea.id})`);
  };

  const handleSaveCurrentToLibrary = (elToSave?: PlanElement | null) => {
    const target = elToSave || selectedElement;
    if (!target) return;
    const { fileName: _f, position: _p, ...rest } = target;
    const newUnit: UnitLibraryItem = {
      unitId: `unit_${target.id}_${Date.now()}`,
      category: `${TYPE_HEADERS_RU[target.type]} · из текущего проекта`,
      savedAt: 'Сохранено только что',
      element: rest,
    };
    setUnitLibrary((prev) => [newUnit, ...prev]);
    showNotice(`Элемент ${target.id} сохранён в Библиотеку юнитов`);
  };

  const handleAddUnitToProject = (unit: UnitLibraryItem) => {
    const targetFile = activeFile || files[0] || 'sys_inventory.pgr';
    if (!files.includes(targetFile)) {
      setFiles([targetFile]);
      setActiveFile(targetFile);
    }
    const exists = elements.some((e) => e.id === unit.element.id);
    const finalId = exists
      ? `${unit.element.id}_${elements.length + 1}`
      : unit.element.id;

    const newEl: PlanElement = {
      ...unit.element,
      id: finalId,
      fileName: targetFile,
      position: {
        x: 280 + (elements.length % 3) * 220,
        y: 40 + Math.floor(elements.length / 3) * 140,
      },
    };
    setElements((prev) => [...prev, newEl]);
    setSelectedId(newEl.id);
    setUncommittedChanges((c) => c + 1);
    showNotice(`Юнит ${newEl.id} добавлен в проект (${targetFile})`);
  };

  const handleCreateElement = () => {
    const prefix = TYPE_PREFIXES[newElType];
    const cleanSlug =
      newElSlug
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '_')
        .replace(/^(sys_|cls_|proc_|cmp_|obj_|idea_)/, '') ||
      `elem_${elements.length + 1}`;
    const finalId = `${prefix}${cleanSlug}`;
    const targetFile = newElFile || activeFile || 'sys_inventory.pgr';

    if (!files.includes(targetFile)) {
      setFiles((prev) => [...prev, targetFile]);
    }

    const created: PlanElement = {
      id: finalId,
      type: newElType,
      title: newElTitle.trim() || `${TYPE_HEADERS_RU[newElType]} ${finalId}`,
      fileName: targetFile,
      parent: newElType === 'system' ? '-' : newElParent || '-',
      description: 'Описание элемента плана.',
      status: 'черновик',
      mvp: newElMvp,
      position: { x: 280, y: 180 },
      extendsId: newElType === 'class' ? '-' : undefined,
      fields:
        newElType === 'class'
          ? [{ name: 'name', dataType: 'string', description: 'имя' }]
          : undefined,
      methods:
        newElType === 'class'
          ? [{ visibility: '+', signature: 'execute()', description: 'вызвать' }]
          : undefined,
      steps: newElType === 'process' ? ['Выполнить действие'] : undefined,
      interfaceItems:
        newElType === 'component'
          ? ['value: int — параметр компонента']
          : undefined,
      internalLogic:
        newElType === 'component' ? ['Правило внутренней логики'] : undefined,
      instanceOf: newElType === 'object' ? 'cls_item' : undefined,
      values: newElType === 'object' ? [] : undefined,
      notes: newElType === 'idea' ? [] : undefined,
    };

    setElements((prev) => [...prev, created]);
    setSelectedId(created.id);
    setActiveFile(targetFile);
    setNewElementModalOpen(false);
    setNewElTitle('');
    setNewElSlug('');
    setUncommittedChanges((c) => c + 1);
    showNotice(`Создан элемент ${created.id}`);
  };

  const isProjectEmpty = files.length === 0 || elements.length === 0;

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden">
      {/* =================================================================
          HEADER (Variation 5 System Dark style)
         ================================================================= */}
      <header className="sys-header">
        <div className="flex items-center gap-8">
          <div className="brand" onClick={() => setActiveTab('kb')}>
            PLANAGER
          </div>

          <nav className="nav-links">
            <button
              type="button"
              onClick={() => setActiveTab('kb')}
              className={`nav-link ${activeTab === 'kb' ? 'active' : ''}`}
            >
              {t.tabKb}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('canvas')}
              className={`nav-link ${activeTab === 'canvas' ? 'active' : ''}`}
            >
              {t.tabCanvas}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('library')}
              className={`nav-link ${activeTab === 'library' ? 'active' : ''}`}
            >
              {t.tabLibrary}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('settings')}
              className={`nav-link ${activeTab === 'settings' ? 'active' : ''}`}
            >
              {t.tabSettings}
            </button>
          </nav>
        </div>

        <div className="flex items-center gap-3">
          {activeTab === 'kb' && (
            <>
              <button
                type="button"
                onClick={() => setNewElementModalOpen(true)}
                className="btn primary"
                style={{ padding: '5px 12px', height: '28px' }}
              >
                +
              </button>

              <button
                type="button"
                onClick={() => setAiModalOpen(true)}
                className="btn"
                style={{ padding: '5px 12px', height: '28px' }}
              >
                {t.aiBtn}
              </button>
            </>
          )}

          {activeTab === 'canvas' && (
            <>
              <button
                type="button"
                onClick={() => setNewElementModalOpen(true)}
                className="btn primary"
                style={{ padding: '5px 12px', height: '28px' }}
              >
                +
              </button>

              <button
                type="button"
                onClick={() => setAiModalOpen(true)}
                className="btn"
                style={{ padding: '5px 12px', height: '28px' }}
              >
                {t.aiBtn}
              </button>
            </>
          )}

          {activeTab === 'library' && (
            <>
              <button
                type="button"
                onClick={() => handleSaveCurrentToLibrary()}
                className="btn primary"
                style={{ padding: '5px 12px', height: '28px' }}
              >
                Сохранить текущий в библиотеку
              </button>
            </>
          )}
        </div>
      </header>

      {/* =================================================================
          TAB 1: БАЗА ЗНАНИЙ (Variation 5 3-Column Workspace)
         ================================================================= */}
      {activeTab === 'kb' && (
        <div className="workspace-3col">
          <button
            type="button"
            onClick={() => setLeftPanelOpen(true)}
            className={`btn p-1.5 panel-expand-btn left ${
              leftPanelOpen ? 'is-hidden' : ''
            }`}
            title="Развернуть левую панель"
          >
            <PanelLeftOpen size={15} />
          </button>

          <button
            type="button"
            onClick={() => setRightPanelOpen(true)}
            className={`btn p-1.5 panel-expand-btn right ${
              rightPanelOpen ? 'is-hidden' : ''
            }`}
            title="Развернуть правую панель"
          >
            <PanelRightOpen size={15} />
          </button>

          {/* Column 1: Explorer (.files-column) */}
          <div
            className={`panel files-column ${
              !leftPanelOpen ? 'collapsed' : ''
            }`}
          >
            <div className="files-column-inner">
              <div className="p-3 border-b border-[var(--border)] space-y-2 shrink-0">
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    placeholder="Поиск (id, имя)..."
                    value={kbSearch}
                    onChange={(e) => setKbSearch(e.target.value)}
                    className="sys-input flex-1 min-w-0 text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => setLeftPanelOpen(false)}
                    className="btn p-1.5 shrink-0"
                    title="Свернуть левую панель"
                  >
                    <PanelLeftClose size={15} />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <select
                    value={kbTypeFilter}
                    onChange={(e) =>
                      setKbTypeFilter(e.target.value as ElementType | 'all')
                    }
                    className="sys-input mono text-[11px] w-full min-w-0 px-1.5 py-1 cursor-pointer bg-[var(--surface)] text-[var(--ink)]"
                  >
                    <option value="all">Все типы</option>
                    <option value="system">Система</option>
                    <option value="class">Класс</option>
                    <option value="process">Процесс</option>
                    <option value="component">Компонент</option>
                    <option value="object">Объект</option>
                    <option value="idea">Идея</option>
                  </select>
                  <select
                    value={kbMvpFilter}
                    onChange={(e) =>
                      setKbMvpFilter(e.target.value as 'all' | 'mvp' | 'later')
                    }
                    className="sys-input mono text-[11px] w-full min-w-0 px-1.5 py-1 cursor-pointer bg-[var(--surface)] text-[var(--ink)]"
                  >
                    <option value="all">MVP: все</option>
                    <option value="mvp">Только MVP</option>
                    <option value="later">Потом</option>
                  </select>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const name = `sys_module_${files.length + 1}.pgr`;
                    setFiles((prev) => [...prev, name]);
                    setActiveFile(name);
                    showNotice(`Создан файл ${name}`);
                  }}
                  className="pill w-full text-center cursor-pointer hover:border-[var(--accent)] py-1 block"
                >
                  + файл
                </button>
              </div>

              <div className="flex-1 overflow-y-auto">
                {files.map((fileName) => {
                  const fileElems = filteredElements.filter(
                    (e) => e.fileName === fileName
                  );
                  const isFileActive =
                    (selectedElement?.fileName || activeFile) === fileName;
                  return (
                    <div
                      key={fileName}
                      className={`file-entry ${
                        isFileActive ? 'active-file' : ''
                      }`}
                    >
                      <div
                        className="file-title"
                        onClick={() => {
                          setActiveFile(fileName);
                          if (fileElems[0]) setSelectedId(fileElems[0].id);
                        }}
                      >
                        <span>{fileName}</span>
                        <span className="mono">{fileElems.length}</span>
                      </div>

                      {fileElems.map((el) => {
                        const isActiveEl = selectedElement?.id === el.id;
                        const TypeIcon = ELEMENT_TYPE_ICONS[el.type];
                        return (
                          <div
                            key={el.id}
                            draggable
                            onDragStart={(e) =>
                              e.dataTransfer.setData('text/plain', el.id)
                            }
                            onClick={() => {
                              setSelectedId(el.id);
                              setActiveFile(fileName);
                              setLineRangeFilter(null);
                            }}
                            className={`tree-node ${
                              isActiveEl ? 'active' : ''
                            }`}
                          >
                            <span
                              className="mono truncate flex items-center gap-2 min-w-0"
                              style={{
                                color: isActiveEl
                                  ? 'var(--accent)'
                                  : undefined,
                              }}
                            >
                              <TypeIcon size={14} className="shrink-0" />
                              <span className="truncate">
                                {stripElementPrefix(el.id)}
                              </span>
                            </span>
                            {el.mvp && (
                              <span
                                className="pill"
                                style={{
                                  color: 'var(--ctx-pos-text)',
                                  borderColor: 'var(--ctx-pos-border)',
                                }}
                              >
                                MVP
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>

              {/* Empty Project Demo Switcher */}
              <div className="p-3 border-t border-[var(--border)]">
                {!isProjectEmpty ? (
                  <button
                    type="button"
                    onClick={() => {
                      setElements([]);
                      setFiles([]);
                      setSelectedId(null);
                      showNotice('Открыт новый пустой проект без файлов .pgr');
                    }}
                    className="btn w-full"
                  >
                    Пустой проект (тест)
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setFiles(INITIAL_FILES);
                      setElements(INITIAL_ELEMENTS);
                      setActiveFile('sys_inventory.pgr');
                      setSelectedId('cls_item');
                      showNotice('Демо-проект восстановлен');
                    }}
                    className="btn primary w-full"
                  >
                    Загрузить демо-проект
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Column 2: Center Editor (.editor-column) */}
          <div className="panel editor-column">
            {kbMainGraphOpen ? (
              <div className="relative flex flex-col w-full h-full overflow-hidden">
                <div
                  ref={mainGraphRef}
                  onMouseDown={(e) => {
                    if (e.button !== 0) return;
                    e.preventDefault();
                    mainGraphDownClientRef.current = {
                      x: e.clientX,
                      y: e.clientY,
                    };
                    mainGraphDragMovedRef.current = false;
                    setMainGraphIsPanning(true);
                    setMainGraphPanStart({
                      x: e.clientX - mainGraphPan.x,
                      y: e.clientY - mainGraphPan.y,
                    });
                  }}
                  onMouseMove={(e) => {
                    if (!mainGraphIsPanning) return;
                    const dist = Math.hypot(
                      e.clientX - mainGraphDownClientRef.current.x,
                      e.clientY - mainGraphDownClientRef.current.y
                    );
                    if (dist > 4) {
                      mainGraphDragMovedRef.current = true;
                    }
                    setMainGraphView((prev) => ({
                      ...prev,
                      pan: {
                        x: e.clientX - mainGraphPanStart.x,
                        y: e.clientY - mainGraphPanStart.y,
                      },
                    }));
                  }}
                  onMouseUp={() => {
                    setMainGraphIsPanning(false);
                  }}
                  onClick={(e) => {
                    if (mainGraphDragMovedRef.current) return;
                    if ((e.target as HTMLElement).closest('.main-graph-node')) {
                      return;
                    }
                    setSelectedId(null);
                  }}
                  style={{
                    backgroundColor: 'var(--surface)',
                    backgroundImage:
                      'radial-gradient(var(--border) 1px, transparent 1px)',
                    backgroundSize: '24px 24px',
                    backgroundPosition: `${mainGraphPan.x}px ${mainGraphPan.y}px`,
                    cursor: mainGraphIsPanning ? 'grabbing' : 'grab',
                    overscrollBehavior: 'contain',
                  }}
                  className="relative flex-1 w-full overflow-hidden select-none"
                >
                  <div
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      transform: `translate(${mainGraphPan.x}px, ${mainGraphPan.y}px) scale(${
                        mainGraphZoom / 100
                      })`,
                      transformOrigin: '0 0',
                      width: `${mainGraphLayout.width}px`,
                      height: `${mainGraphLayout.height}px`,
                    }}
                    className="shrink-0"
                  >
                    <svg className="absolute inset-0 w-full h-full pointer-events-none overflow-visible">
                      <defs>
                        <marker
                          id="main-graph-arrow"
                          markerUnits="userSpaceOnUse"
                          viewBox="0 0 10 10"
                          refX="27"
                          refY="5"
                          markerWidth="6"
                          markerHeight="6"
                          orient="auto-start-reverse"
                        >
                          <path d="M 0 1 L 9 5 L 0 9 z" fill="context-stroke" />
                        </marker>
                      </defs>
                      {mainGraphLayout.activeEdges.map((edge, edgeIdx) => {
                        const p1 = mainGraphLayout.posMap[edge.source];
                        const p2 = mainGraphLayout.posMap[edge.target];
                        if (!p1 || !p2) return null;

                        const focusId = hoveredMiniNodeId || selectedId;
                        const isConnectedToFocus =
                          focusId === edge.source || focusId === edge.target;
                        const isDimmed =
                          Boolean(hoveredMiniNodeId) && !isConnectedToFocus;

                        const dash =
                          edge.relation === 'extends'
                            ? '5 4'
                            : edge.relation === 'notes'
                            ? '2 3'
                            : undefined;

                        // Offset label when opposite/parallel edges exist between the same pair of nodes
                        const pairEdges = mainGraphLayout.activeEdges.filter(
                          (other) =>
                            (other.source === edge.source &&
                              other.target === edge.target) ||
                            (other.source === edge.target &&
                              other.target === edge.source)
                        );
                        const pairIdx = pairEdges.findIndex(
                          (other) => other.id === edge.id
                        );
                        const labelShift =
                          pairEdges.length > 1
                            ? (pairIdx - (pairEdges.length - 1) / 2) * 14
                            : 0;

                        const midX = (p1.x + p2.x) / 2;
                        const midY = (p1.y + p2.y) / 2 - 4 + labelShift;

                        return (
                          <g key={`${edge.id}_${edgeIdx}`}>
                            <line
                              x1={p1.x}
                              y1={p1.y}
                              x2={p2.x}
                              y2={p2.y}
                              stroke={
                                !edge.valid
                                  ? 'var(--ctx-neg)'
                                  : isConnectedToFocus
                                  ? 'var(--accent)'
                                  : 'var(--ink-muted)'
                              }
                              strokeWidth={isConnectedToFocus ? 1.8 : 1.15}
                              strokeDasharray={dash}
                              strokeOpacity={
                                isDimmed ? 0.18 : isConnectedToFocus ? 0.92 : 0.45
                              }
                              markerEnd="url(#main-graph-arrow)"
                            />
                            <text
                              x={midX}
                              y={midY}
                              textAnchor="middle"
                              fill={
                                isConnectedToFocus
                                  ? 'var(--ink)'
                                  : 'var(--ink-muted)'
                              }
                              opacity={isDimmed ? 0.2 : 0.85}
                              className="mono text-[9px]"
                              style={{
                                paintOrder: 'stroke',
                                stroke: 'var(--surface)',
                                strokeWidth: '3px',
                              }}
                            >
                              {edge.relation}
                            </text>
                          </g>
                        );
                      })}
                    </svg>

                    {mainGraphLayout.nodes.map((el) => {
                      const pos = mainGraphLayout.posMap[el.id];
                      if (!pos) return null;
                      const TypeIcon = ELEMENT_TYPE_ICONS[el.type];
                      const isSelectedNode = selectedId === el.id;
                      const isHoveredNode = hoveredMiniNodeId === el.id;
                      const focusId = hoveredMiniNodeId || selectedId;
                      const isNeighborOfFocus =
                        focusId &&
                        mainGraphLayout.activeEdges.some(
                          (e) =>
                            (e.source === focusId && e.target === el.id) ||
                            (e.target === focusId && e.source === el.id)
                        );
                      const isDimmed =
                        Boolean(hoveredMiniNodeId) &&
                        !isHoveredNode &&
                        !isNeighborOfFocus;

                      const isRejectedIdea =
                        el.type === 'idea' &&
                        Boolean(el.altTo && el.altTo !== '-');
                      const nodeBorderColor =
                        isSelectedNode || isHoveredNode
                          ? 'var(--accent)'
                          : isRejectedIdea
                          ? 'var(--ctx-neg-border)'
                          : el.mvp
                          ? 'var(--ctx-pos-border)'
                          : 'var(--border)';
                      const nodeIconColor =
                        isSelectedNode || isHoveredNode
                          ? 'var(--accent)'
                          : isRejectedIdea
                          ? 'var(--ctx-neg-text)'
                          : el.mvp
                          ? 'var(--ctx-pos-text)'
                          : 'var(--ink)';

                      return (
                        <div
                          key={el.id}
                          onMouseEnter={() => setHoveredMiniNodeId(el.id)}
                          onMouseLeave={() => setHoveredMiniNodeId(null)}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (mainGraphDragMovedRef.current) return;
                            setSelectedId(el.id);
                            setActiveFile(el.fileName);
                          }}
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            if (mainGraphDragMovedRef.current) return;
                            setSelectedId(el.id);
                            setActiveFile(el.fileName);
                            setKbMainGraphOpen(false);
                          }}
                          style={{
                            left: `${pos.x}px`,
                            top: `${pos.y}px`,
                            transform: 'translate(-50%, -50%)',
                            opacity: isDimmed ? 0.3 : 1,
                            zIndex:
                              isSelectedNode || isHoveredNode
                                ? 20
                                : isNeighborOfFocus
                                ? 15
                                : 10,
                          }}
                          title={`${el.id} — ${el.title} (двойной клик: открыть в редакторе)`}
                          className="main-graph-node absolute w-9 h-9 cursor-pointer transition-opacity duration-150"
                        >
                          <div
                            style={{
                              backgroundColor: 'var(--bg)',
                              borderColor: nodeBorderColor,
                              color: nodeIconColor,
                              boxShadow:
                                isSelectedNode || isHoveredNode
                                  ? '0 0 0 1px var(--accent)'
                                  : undefined,
                            }}
                            className="w-9 h-9 rounded border flex items-center justify-center transition-transform duration-150 hover:scale-110"
                          >
                            <TypeIcon size={17} />
                          </div>
                          <div className="absolute left-1/2 top-full -translate-x-1/2 mt-1.5 flex flex-col items-center pointer-events-none">
                            <span
                              style={{
                                color:
                                  isSelectedNode || isHoveredNode
                                    ? 'var(--ink)'
                                    : 'var(--ink-muted)',
                                backgroundColor: 'var(--surface)',
                              }}
                              className="mono text-[10px] font-medium leading-none px-1.5 py-0.5 rounded border border-transparent whitespace-nowrap"
                            >
                              {stripElementPrefix(el.id)}
                            </span>
                            <span className="text-[10px] text-[var(--ink-muted)] max-w-[140px] truncate mt-0.5 whitespace-nowrap">
                              {el.title}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Floating bottom-left controls: Minimize icon button + Spread slider */}
                <div className="absolute bottom-3 left-3 z-30 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setKbMainGraphOpen(false)}
                    style={{ backgroundColor: 'var(--bg)', height: '32px', width: '32px' }}
                    className="btn p-0 flex items-center justify-center"
                    title="Вернуться к редактированию элемента"
                  >
                    <Minimize2 size={18} />
                  </button>
                  <div
                    style={{ backgroundColor: 'var(--bg)', height: '32px' }}
                    className="pill flex items-center gap-2 px-2.5 py-0"
                    title="Коэффициент отдаления между элементами графа"
                  >
                    <input
                      type="range"
                      min={0.5}
                      max={2.5}
                      step={0.05}
                      value={graphSpread}
                      onChange={(e) =>
                        setGraphSpread(parseFloat(e.target.value))
                      }
                      className="w-24 accent-[var(--accent)] cursor-pointer"
                    />
                    <button
                      type="button"
                      onClick={() => setGraphSpread(1)}
                      className="flex items-center justify-center p-1 rounded border border-transparent hover:border-[var(--border)] hover:text-[var(--ink)] transition-colors cursor-pointer"
                      title="Сбросить масштаб до 1"
                    >
                      <RotateCcw size={14} />
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div
                className="editor-scroll"
                style={{
                  paddingLeft: leftPanelOpen ? '24px' : '52px',
                  paddingRight: rightPanelOpen ? '24px' : '52px',
                }}
              >
                {isProjectEmpty ? (
                <div className="p-10 border border-dashed border-[var(--border)] rounded-lg text-center space-y-4 my-8">
                  <div className="label">EMPTY WORKSPACE</div>
                  <h2 className="text-xl font-bold">
                    В проекте пока нет файлов плана (.pgr)
                  </h2>
                  <p className="text-xs text-[var(--ink-muted)] max-w-md mx-auto leading-relaxed">
                    Создайте первый файл разметки .pgr, вставьте готовые блоки из Библиотеки юнитов или загрузите демонстрационный проект.
                  </p>
                  <div className="flex items-center justify-center gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setFiles(['sys_core.pgr']);
                        setActiveFile('sys_core.pgr');
                        setNewElFile('sys_core.pgr');
                        setNewElementModalOpen(true);
                      }}
                      className="btn pos"
                    >
                      + Создать первый файл .pgr
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveTab('library')}
                      className="btn"
                    >
                      Библиотека юнитов
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setFiles(INITIAL_FILES);
                        setElements(INITIAL_ELEMENTS);
                        setActiveFile('sys_inventory.pgr');
                        setSelectedId('cls_item');
                      }}
                      className="btn primary"
                    >
                      Загрузить пример проекта
                    </button>
                  </div>
                </div>
              ) : selectedElement ? (
                <>
                  {/* Editor Meta Header */}
                  <div className="editor-meta">
                    <div className="flex items-center gap-2.5">
                      <span className="pill">{selectedElement.fileName}</span>
                      <span className="pill">
                        {TYPE_HEADERS_RU[selectedElement.type]}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setKbMainGraphOpen(true)}
                        className="btn py-1 px-2.5"
                        title="Открыть граф элементов в основной области"
                      >
                        <Maximize2 size={12} />
                        <span>Граф</span>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setKbEditorMode((m) =>
                            m === 'structured' ? 'raw_pgr' : 'structured'
                          )
                        }
                        className="btn py-1 px-2.5"
                      >
                        {kbEditorMode === 'structured'
                          ? 'Текст .pgr'
                          : 'Блочная сетка'}
                      </button>
                    </div>
                  </div>

                  {/* Display Title in Syne 800 */}
                  <input
                    type="text"
                    value={selectedElement.title}
                    onChange={(e) =>
                      updateElement({
                        ...selectedElement,
                        title: e.target.value,
                      })
                    }
                    className="title-display"
                  />
                  <div
                    className="label"
                    style={{ marginTop: '-12px', display: 'block' }}
                  >
                    UID: {selectedElement.id}
                  </div>

                  {kbEditorMode === 'structured' ? (
                    <div className="field-grid">
                      {/* Row 1: Header */}
                      <div
                        className="field-row"
                        onClick={() => setCursorLine(1)}
                      >
                        <div className="field-label">Header</div>
                        <div className="field-value">
                          <input
                            type="text"
                            value={`## ${TYPE_HEADERS_RU[selectedElement.type]}: ${selectedElement.title}`}
                            onChange={(e) => {
                              const cleaned = e.target.value.replace(
                                /^##\s*[^:]+:\s*/,
                                ''
                              );
                              updateElement({
                                ...selectedElement,
                                title: cleaned,
                              });
                            }}
                          />
                        </div>
                      </div>

                      {/* Row 2: Identity & Hierarchy */}
                      <div
                        className="field-row"
                        onClick={() => setCursorLine(2)}
                      >
                        <div className="field-label">Identity</div>
                        <div className="field-value">
                          <div className="identity-grid">
                            <span className="label">id:</span>
                            <input
                              type="text"
                              value={selectedElement.id}
                              onChange={(e) =>
                                updateElement({
                                  ...selectedElement,
                                  id: e.target.value.trim(),
                                })
                              }
                              className="identity-control"
                              style={{ color: 'var(--accent)' }}
                            />

                            {selectedElement.type !== 'system' && (
                              <>
                                <span className="label">parent:</span>
                                <select
                                  value={selectedElement.parent || '-'}
                                  onChange={(e) =>
                                    updateElement({
                                      ...selectedElement,
                                      parent: e.target.value,
                                    })
                                  }
                                  className="identity-control cursor-pointer bg-[var(--surface)] text-[var(--ink)]"
                                >
                                  <option
                                    value="-"
                                    className="bg-[var(--surface)] text-[var(--ink)]"
                                  >
                                    - (без родителя)
                                  </option>
                                  {elements
                                    .filter((x) => x.type === 'system')
                                    .map((sys) => (
                                      <option
                                        key={sys.id}
                                        value={sys.id}
                                        className="bg-[var(--surface)] text-[var(--ink)]"
                                      >
                                        {sys.id}
                                      </option>
                                    ))}
                                </select>
                              </>
                            )}

                            {selectedElement.type === 'class' && (
                              <>
                                <span className="label">extends:</span>
                                <select
                                  value={selectedElement.extendsId || '-'}
                                  onChange={(e) =>
                                    updateElement({
                                      ...selectedElement,
                                      extendsId: e.target.value,
                                    })
                                  }
                                  className="identity-control cursor-pointer bg-[var(--surface)] text-[var(--ink)]"
                                >
                                  <option
                                    value="-"
                                    className="bg-[var(--surface)] text-[var(--ink)]"
                                  >
                                    -
                                  </option>
                                  {elements
                                    .filter(
                                      (x) =>
                                        x.type === 'class' &&
                                        x.id !== selectedElement.id
                                    )
                                    .map((cls) => (
                                      <option
                                        key={cls.id}
                                        value={cls.id}
                                        className="bg-[var(--surface)] text-[var(--ink)]"
                                      >
                                        {cls.id}
                                      </option>
                                    ))}
                                </select>
                              </>
                            )}

                            {selectedElement.type === 'object' && (
                              <>
                                <span className="label">instance_of:</span>
                                <select
                                  value={selectedElement.instanceOf || '-'}
                                  onChange={(e) =>
                                    updateElement({
                                      ...selectedElement,
                                      instanceOf: e.target.value,
                                    })
                                  }
                                  className="identity-control cursor-pointer bg-[var(--surface)] text-[var(--ink)]"
                                >
                                  <option
                                    value="-"
                                    className="bg-[var(--surface)] text-[var(--ink)]"
                                  >
                                    - (только компоненты)
                                  </option>
                                  {elements
                                    .filter((x) => x.type === 'class')
                                    .map((cls) => (
                                      <option
                                        key={cls.id}
                                        value={cls.id}
                                        className="bg-[var(--surface)] text-[var(--ink)]"
                                      >
                                        {cls.id}
                                      </option>
                                    ))}
                                </select>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Row 3: Description */}
                      <div
                        className="field-row"
                        onClick={() => setCursorLine(4)}
                      >
                        <div className="field-label">Description</div>
                        <div className="field-value">
                          <textarea
                            rows={2}
                            value={selectedElement.description}
                            onChange={(e) =>
                              updateElement({
                                ...selectedElement,
                                description: e.target.value,
                              })
                            }
                          />
                        </div>
                      </div>

                      {/* CLASS: Fields & Methods */}
                      {selectedElement.type === 'class' && (
                        <>
                          <div
                            className="field-row"
                            onClick={() => setCursorLine(7)}
                          >
                            <div className="field-label">Fields</div>
                            <div className="field-value space-y-2">
                              {(selectedElement.fields || []).map((f, idx) => (
                                <div
                                  key={idx}
                                  className="flex items-center justify-between text-xs mono py-1 border-b border-[var(--border)]"
                                >
                                  <span>
                                    <strong style={{ color: 'var(--ink)' }}>
                                      {f.name}
                                    </strong>
                                    : {f.dataType} — {f.description}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      updateElement({
                                        ...selectedElement,
                                        fields: (
                                          selectedElement.fields || []
                                        ).filter((_, i) => i !== idx),
                                      })
                                    }
                                    className="text-[11px] hover:text-[var(--ctx-neg-text)] cursor-pointer"
                                  >
                                    удалить
                                  </button>
                                </div>
                              ))}
                              <div className="flex items-center gap-2 pt-1 w-full">
                                <input
                                  placeholder="имя_поля"
                                  value={inlineFieldName}
                                  onChange={(e) =>
                                    setInlineFieldName(e.target.value)
                                  }
                                  className="sys-input mono min-w-0 shrink-0"
                                  style={{ width: '108px' }}
                                />
                                <input
                                  placeholder="тип (float)"
                                  value={inlineFieldType}
                                  onChange={(e) =>
                                    setInlineFieldType(e.target.value)
                                  }
                                  className="sys-input mono min-w-0 shrink-0"
                                  style={{ width: '92px' }}
                                />
                                <input
                                  placeholder="описание"
                                  value={inlineFieldDesc}
                                  onChange={(e) =>
                                    setInlineFieldDesc(e.target.value)
                                  }
                                  className="sys-input flex-1 min-w-0"
                                />
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (!inlineFieldName.trim()) return;
                                    updateElement({
                                      ...selectedElement,
                                      fields: [
                                        ...(selectedElement.fields || []),
                                        {
                                          name: inlineFieldName.trim(),
                                          dataType:
                                            inlineFieldType.trim() || 'string',
                                          description:
                                            inlineFieldDesc.trim() || 'поле',
                                        },
                                      ],
                                    });
                                    setInlineFieldName('');
                                    setInlineFieldDesc('');
                                  }}
                                  className="btn shrink-0"
                                >
                                  + Поле
                                </button>
                              </div>
                            </div>
                          </div>

                          <div
                            className="field-row"
                            onClick={() => setCursorLine(11)}
                          >
                            <div className="field-label">Methods</div>
                            <div className="field-value space-y-2">
                              {(selectedElement.methods || []).map((m, idx) => (
                                <div
                                  key={idx}
                                  className="flex items-center justify-between text-xs mono py-1 border-b border-[var(--border)]"
                                >
                                  <span>
                                    <strong
                                      style={{
                                        color:
                                          m.visibility === '-'
                                            ? 'var(--ctx-neg-text)'
                                            : 'var(--ctx-pos-text)',
                                      }}
                                    >
                                      {m.visibility} {m.signature}
                                    </strong>{' '}
                                    — {m.description}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      updateElement({
                                        ...selectedElement,
                                        methods: (
                                          selectedElement.methods || []
                                        ).filter((_, i) => i !== idx),
                                      })
                                    }
                                    className="text-[11px] hover:text-[var(--ctx-neg-text)] cursor-pointer"
                                  >
                                    удалить
                                  </button>
                                </div>
                              ))}
                              <div className="flex items-center gap-2 pt-1 w-full">
                                <select
                                  value={inlineMethodVis}
                                  onChange={(e) =>
                                    setInlineMethodVis(
                                      e.target.value as '+' | '-'
                                    )
                                  }
                                  className="sys-input mono min-w-0 shrink-0 cursor-pointer"
                                  style={{ width: '92px' }}
                                >
                                  <option value="+">+ публ.</option>
                                  <option value="-">- прив.</option>
                                </select>
                                <input
                                  placeholder="use()"
                                  value={inlineMethodSig}
                                  onChange={(e) =>
                                    setInlineMethodSig(e.target.value)
                                  }
                                  className="sys-input mono min-w-0 shrink-0"
                                  style={{ width: '108px' }}
                                />
                                <input
                                  placeholder="описание метода"
                                  value={inlineMethodDesc}
                                  onChange={(e) =>
                                    setInlineMethodDesc(e.target.value)
                                  }
                                  className="sys-input flex-1 min-w-0"
                                />
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (!inlineMethodSig.trim()) return;
                                    updateElement({
                                      ...selectedElement,
                                      methods: [
                                        ...(selectedElement.methods || []),
                                        {
                                          visibility: inlineMethodVis,
                                          signature: inlineMethodSig.trim(),
                                          description:
                                            inlineMethodDesc.trim() || 'метод',
                                        },
                                      ],
                                    });
                                    setInlineMethodSig('');
                                    setInlineMethodDesc('');
                                  }}
                                  className="btn shrink-0"
                                >
                                  + Метод
                                </button>
                              </div>
                            </div>
                          </div>
                        </>
                      )}

                      {/* OBJECT: Inherited & Overridden Values */}
                      {selectedElement.type === 'object' && (
                        <div
                          className="field-row"
                          onClick={() => setCursorLine(8)}
                        >
                          <div className="field-label">Values</div>
                          <div className="field-value space-y-2">
                            {inheritedObjectFields.map((inh) => {
                              const valObj = (
                                selectedElement.values || []
                              ).find((v) => v.fieldName === inh.fieldName);
                              return (
                                <div
                                  key={inh.fieldName}
                                  className="flex items-center gap-3 py-1 border-b border-[var(--border)]"
                                >
                                  <span className="mono w-48 truncate">
                                    <strong style={{ color: 'var(--ink)' }}>
                                      {inh.fieldName}
                                    </strong>{' '}
                                    ({inh.dataType} · {inh.sourceId})
                                  </span>
                                  <input
                                    type="text"
                                    placeholder="Укажите конкретное значение..."
                                    value={valObj?.value || ''}
                                    onChange={(e) => {
                                      const nextVals = [
                                        ...(selectedElement.values || []),
                                      ];
                                      const idx = nextVals.findIndex(
                                        (x) => x.fieldName === inh.fieldName
                                      );
                                      if (!e.target.value.trim()) {
                                        if (idx !== -1) nextVals.splice(idx, 1);
                                      } else if (idx !== -1) {
                                        nextVals[idx] = {
                                          fieldName: inh.fieldName,
                                          value: e.target.value,
                                        };
                                      } else {
                                        nextVals.push({
                                          fieldName: inh.fieldName,
                                          value: e.target.value,
                                        });
                                      }
                                      updateElement({
                                        ...selectedElement,
                                        values: nextVals,
                                      });
                                    }}
                                    className="mono flex-1"
                                    style={{ color: 'var(--accent)' }}
                                  />
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* PROCESS: Steps */}
                      {selectedElement.type === 'process' && (
                        <div
                          className="field-row"
                          onClick={() => setCursorLine(8)}
                        >
                          <div className="field-label">Steps</div>
                          <div className="field-value space-y-2">
                            {(selectedElement.steps || []).map((st, idx) => (
                              <div
                                key={idx}
                                className="flex items-center justify-between text-xs py-1 border-b border-[var(--border)]"
                              >
                                <span>
                                  <span className="mono mr-2">{idx + 1}.</span>
                                  {st}
                                </span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    updateElement({
                                      ...selectedElement,
                                      steps: (
                                        selectedElement.steps || []
                                      ).filter((_, i) => i !== idx),
                                    })
                                  }
                                  className="mono text-[11px] cursor-pointer"
                                >
                                  удалить
                                </button>
                              </div>
                            ))}
                            <div className="flex gap-2 pt-1">
                              <input
                                placeholder="Добавить шаг последовательности..."
                                value={inlineStepText}
                                onChange={(e) =>
                                  setInlineStepText(e.target.value)
                                }
                                className="sys-input flex-1"
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  if (!inlineStepText.trim()) return;
                                  updateElement({
                                    ...selectedElement,
                                    steps: [
                                      ...(selectedElement.steps || []),
                                      inlineStepText.trim(),
                                    ],
                                  });
                                  setInlineStepText('');
                                }}
                                className="btn"
                              >
                                + Шаг
                              </button>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* COMPONENT: Interface & Internal Logic */}
                      {selectedElement.type === 'component' && (
                        <>
                          <div
                            className="field-row"
                            onClick={() => setCursorLine(8)}
                          >
                            <div className="field-label">Interface (+)</div>
                            <div className="field-value space-y-2">
                              {(selectedElement.interfaceItems || []).map(
                                (it, idx) => (
                                  <div
                                    key={idx}
                                    className="flex items-center justify-between mono text-xs py-1 border-b border-[var(--border)]"
                                  >
                                    <span>
                                      <strong
                                        style={{ color: 'var(--ctx-pos-text)' }}
                                      >
                                        +
                                      </strong>{' '}
                                      {it}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        updateElement({
                                          ...selectedElement,
                                          interfaceItems: (
                                            selectedElement.interfaceItems || []
                                          ).filter((_, i) => i !== idx),
                                        })
                                      }
                                      className="text-[11px] hover:text-[var(--ctx-neg-text)] cursor-pointer"
                                    >
                                      удалить
                                    </button>
                                  </div>
                                )
                              )}
                              <div className="flex gap-2 pt-1">
                                <input
                                  placeholder="param: int — описание"
                                  value={inlineInterfaceText}
                                  onChange={(e) =>
                                    setInlineInterfaceText(e.target.value)
                                  }
                                  className="sys-input flex-1 mono"
                                />
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (!inlineInterfaceText.trim()) return;
                                    updateElement({
                                      ...selectedElement,
                                      interfaceItems: [
                                        ...(selectedElement.interfaceItems ||
                                          []),
                                        inlineInterfaceText.trim(),
                                      ],
                                    });
                                    setInlineInterfaceText('');
                                  }}
                                  className="btn"
                                >
                                  + Интерфейс
                                </button>
                              </div>
                            </div>
                          </div>

                          <div
                            className="field-row"
                            onClick={() => setCursorLine(12)}
                          >
                            <div className="field-label">Internal Logic (-)</div>
                            <div className="field-value space-y-2">
                              {(selectedElement.internalLogic || []).map(
                                (lg, idx) => (
                                  <div
                                    key={idx}
                                    className="flex items-center justify-between text-xs py-1 border-b border-[var(--border)]"
                                  >
                                    <span>
                                      <strong
                                        style={{ color: 'var(--ctx-neg-text)' }}
                                      >
                                        -
                                      </strong>{' '}
                                      {lg}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        updateElement({
                                          ...selectedElement,
                                          internalLogic: (
                                            selectedElement.internalLogic || []
                                          ).filter((_, i) => i !== idx),
                                        })
                                      }
                                      className="mono text-[11px] hover:text-[var(--ctx-neg-text)] cursor-pointer"
                                    >
                                      удалить
                                    </button>
                                  </div>
                                )
                              )}
                              <div className="flex gap-2 pt-1">
                                <input
                                  placeholder="Правило внутренней логики..."
                                  value={inlineLogicText}
                                  onChange={(e) =>
                                    setInlineLogicText(e.target.value)
                                  }
                                  className="sys-input flex-1"
                                />
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (!inlineLogicText.trim()) return;
                                    updateElement({
                                      ...selectedElement,
                                      internalLogic: [
                                        ...(selectedElement.internalLogic ||
                                          []),
                                        inlineLogicText.trim(),
                                      ],
                                    });
                                    setInlineLogicText('');
                                  }}
                                  className="btn"
                                >
                                  + Правило
                                </button>
                              </div>
                            </div>
                          </div>
                        </>
                      )}

                      {/* IDEA: Linked To (alt_to & alt_reason) & Keywords/Notes */}
                      {selectedElement.type === 'idea' && (
                        <>
                          <div
                            className="field-row"
                            onClick={() => setCursorLine(10)}
                          >
                            <div className="field-label">Linked To (Alt)</div>
                            <div className="field-value flex items-center gap-4 flex-wrap">
                              <select
                                value={selectedElement.altTo || '-'}
                                onChange={(e) =>
                                  updateElement({
                                    ...selectedElement,
                                    altTo: e.target.value,
                                  })
                                }
                                className="identity-control cursor-pointer"
                                style={{
                                  width: '200px',
                                  color: 'var(--ctx-neg-text)',
                                }}
                              >
                                <option value="-">
                                  - (мысль на будущее)
                                </option>
                                {elements
                                  .filter((x) => x.id !== selectedElement.id)
                                  .map((oe) => (
                                    <option key={oe.id} value={oe.id}>
                                      {oe.id}
                                    </option>
                                  ))}
                              </select>
                              <input
                                type="text"
                                placeholder="Причина отказа (alt_reason)..."
                                value={selectedElement.altReason || ''}
                                onChange={(e) =>
                                  updateElement({
                                    ...selectedElement,
                                    altReason: e.target.value,
                                  })
                                }
                                className="flex-1 text-xs"
                                style={{ color: 'var(--ink-muted)' }}
                              />
                            </div>
                          </div>

                          <div
                            className="field-row"
                            onClick={() => setCursorLine(14)}
                          >
                            <div className="field-label">Notes</div>
                            <div className="field-value space-y-2">
                              <div className="mono">
                                {(selectedElement.notes || []).join(', ') ||
                                  'отдельно стоящая идея (без привязки)'}
                              </div>
                              <div className="flex flex-wrap gap-2 pt-1">
                                {elements
                                  .filter((x) => x.id !== selectedElement.id)
                                  .map((target) => {
                                    const active = (
                                      selectedElement.notes || []
                                    ).includes(target.id);
                                    return (
                                      <button
                                        key={target.id}
                                        type="button"
                                        onClick={() => {
                                          const curr =
                                            selectedElement.notes || [];
                                          const next = active
                                            ? curr.filter(
                                                (id) => id !== target.id
                                              )
                                            : [...curr, target.id];
                                          updateElement({
                                            ...selectedElement,
                                            notes: next,
                                          });
                                        }}
                                        className="pill cursor-pointer"
                                        style={{
                                          borderColor: active
                                            ? 'var(--accent)'
                                            : undefined,
                                          color: active
                                            ? 'var(--accent)'
                                            : undefined,
                                        }}
                                      >
                                        {target.id}
                                      </button>
                                    );
                                  })}
                              </div>
                            </div>
                          </div>
                        </>
                      )}

                      {/* Shared Components (has) */}
                      {['class', 'process', 'object'].includes(
                        selectedElement.type
                      ) && (
                        <div
                          className="field-row"
                          onClick={() => setCursorLine(16)}
                        >
                          <div className="field-label">Components (has)</div>
                          <div className="field-value flex flex-wrap gap-2">
                            {elements
                              .filter((e) => e.type === 'component')
                              .map((cmp) => {
                                const active = (
                                  selectedElement.components || []
                                ).includes(cmp.id);
                                return (
                                  <button
                                    key={cmp.id}
                                    type="button"
                                    onClick={() => {
                                      const curr =
                                        selectedElement.components || [];
                                      const next = active
                                        ? curr.filter((x) => x !== cmp.id)
                                        : [...curr, cmp.id];
                                      updateElement({
                                        ...selectedElement,
                                        components: next,
                                      });
                                    }}
                                    className="pill cursor-pointer"
                                    style={{
                                      borderColor: active
                                        ? 'var(--accent)'
                                        : undefined,
                                      color: active
                                        ? 'var(--accent)'
                                        : undefined,
                                    }}
                                  >
                                    {active ? '✓ ' : '+ '}
                                    {cmp.id}
                                  </button>
                                );
                              })}
                          </div>
                        </div>
                      )}

                      {/* Shared Uses */}
                      {['class', 'process'].includes(selectedElement.type) && (
                        <div
                          className="field-row"
                          onClick={() => setCursorLine(18)}
                        >
                          <div className="field-label">Uses</div>
                          <div className="field-value flex flex-wrap gap-2">
                            {elements
                              .filter((e) => e.id !== selectedElement.id)
                              .map((target) => {
                                const active = (
                                  selectedElement.uses || []
                                ).includes(target.id);
                                return (
                                  <button
                                    key={target.id}
                                    type="button"
                                    onClick={() => {
                                      const curr = selectedElement.uses || [];
                                      const next = active
                                        ? curr.filter((x) => x !== target.id)
                                        : [...curr, target.id];
                                      updateElement({
                                        ...selectedElement,
                                        uses: next,
                                      });
                                    }}
                                    className="pill cursor-pointer"
                                    style={{
                                      borderColor: active
                                        ? 'var(--accent)'
                                        : undefined,
                                      color: active
                                        ? 'var(--accent)'
                                        : undefined,
                                    }}
                                  >
                                    {active ? '→ ' : ''}
                                    {target.id}
                                  </button>
                                );
                              })}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    /* Raw .pgr line-range mode */
                    <div className="field-grid">
                      <div className="field-row">
                        <div className="field-label">
                          .pgr Range
                          {lineRangeFilter && (
                            <button
                              type="button"
                              onClick={() => setLineRangeFilter(null)}
                              className="block mt-2 underline cursor-pointer"
                            >
                              Показать все
                            </button>
                          )}
                        </div>
                        <div className="field-value space-y-3">
                          <div className="p-3 border border-[var(--border)] rounded bg-[var(--bg)] max-h-64 overflow-y-auto mono">
                            {rawPgrDraft.split('\n').map((line, idx) => {
                              const num = idx + 1;
                              if (
                                lineRangeFilter &&
                                (num < lineRangeFilter.start ||
                                  num > lineRangeFilter.end)
                              ) {
                                return null;
                              }
                              const inCurrent =
                                num >= selectedElementRange.startLine &&
                                num <= selectedElementRange.endLine;
                              return (
                                <div
                                  key={num}
                                  onClick={() => setCursorLine(num)}
                                  className="flex gap-3 px-1.5 py-0.5 cursor-pointer"
                                  style={{
                                    backgroundColor: inCurrent
                                      ? 'var(--ctx-pos-soft)'
                                      : 'transparent',
                                    color: inCurrent
                                      ? 'var(--ctx-pos-text)'
                                      : 'var(--ink-muted)',
                                  }}
                                >
                                  <span className="w-7 text-right opacity-50 select-none">
                                    {num}
                                  </span>
                                  <span className="whitespace-pre-wrap">
                                    {line || ' '}
                                  </span>
                                </div>
                              );
                            })}
                          </div>

                          <textarea
                            rows={7}
                            value={rawPgrDraft}
                            onChange={(e) => setRawPgrDraft(e.target.value)}
                            className="sys-input w-full mono"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const parsed = parsePgrFileContent(
                                rawPgrDraft,
                                selectedElement.fileName,
                                elements
                              );
                              setElements((prev) => [
                                ...prev.filter(
                                  (x) =>
                                    x.fileName !== selectedElement.fileName
                                ),
                                ...parsed,
                              ]);
                              setUncommittedChanges((c) => c + 1);
                              showNotice(
                                `Разметка ${selectedElement.fileName} синхронизирована`
                              );
                            }}
                            className="btn pos"
                          >
                            Применить правки .pgr
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="p-10 border border-dashed border-[var(--border)] rounded-lg text-center space-y-2 my-8">
                  <div className="label">NO SELECTION</div>
                  <div className="text-sm text-[var(--ink-muted)]">
                    Выберите элемент в списке слева для просмотра и редактирования
                  </div>
                </div>
              )}
              </div>
            )}
          </div>

          {/* Column 3: Right Attributes & Conflicts/AI (.props-column) */}
          <div
            className={`panel props-column ${
              !rightPanelOpen ? 'collapsed' : ''
            }`}
          >
            <div className="props-column-inner">
              {selectedElement && (
                <div className="sidebar-section">
                  <div className="section-title">
                    <span>Attributes</span>
                    <button
                      type="button"
                      onClick={() => setRightPanelOpen(false)}
                      className="btn p-1.5"
                      title="Свернуть правую панель"
                    >
                      <PanelRightClose size={15} />
                    </button>
                  </div>

                  <div className="stat-line">
                    <span className="stat-label">Type</span>
                    <select
                      value={selectedElement.type}
                      onChange={(e) =>
                        updateElement({
                          ...selectedElement,
                          type: e.target.value as ElementType,
                        })
                      }
                      className="mono bg-transparent border-b border-[var(--border)] cursor-pointer"
                    >
                      <option value="system">Система</option>
                      <option value="class">Класс</option>
                      <option value="process">Процесс-функция</option>
                      <option value="component">Компонент</option>
                      <option value="object">Объект</option>
                      <option value="idea">Идея-образ</option>
                    </select>
                  </div>

                  <div className="stat-line">
                    <span className="stat-label">Parent</span>
                    <span className="mono">
                      {selectedElement.parent && selectedElement.parent !== '-'
                        ? selectedElement.parent
                        : 'None (-)'}
                    </span>
                  </div>

                  <div className="stat-line">
                    <span className="stat-label">Status</span>
                    <span
                      className="pill"
                      style={{
                        color: 'var(--ctx-pos-text)',
                        borderColor: 'var(--ctx-pos-border)',
                      }}
                    >
                      {selectedElement.status}
                    </span>
                  </div>

                  <div className="stat-line">
                    <span className="stat-label">Tag</span>
                    <button
                      type="button"
                      onClick={() =>
                        updateElement({
                          ...selectedElement,
                          mvp: !selectedElement.mvp,
                        })
                      }
                      className="pill cursor-pointer"
                      style={{
                        color: selectedElement.mvp
                          ? 'var(--ctx-pos-text)'
                          : 'var(--ctx-neg-text)',
                        borderColor: selectedElement.mvp
                          ? 'var(--ctx-pos-border)'
                          : 'var(--ctx-neg-border)',
                      }}
                    >
                      {selectedElement.mvp ? 'MVP' : 'Backlog (Потом)'}
                    </button>
                  </div>

                  <div className="stat-line">
                    <span className="stat-label">Has</span>
                    <span className="mono truncate max-w-[170px]">
                      {(selectedElement.components || []).join(', ') || '-'}
                    </span>
                  </div>

                  <div className="stat-line">
                    <span className="stat-label">Used by</span>
                    <span className="mono truncate max-w-[170px]">
                      {usedByIds.join(', ') || '-'}
                    </span>
                  </div>

                  <div className="btn-group">
                    <button
                      type="button"
                      onClick={() => {
                        const res = generateLocalTransformation(
                          selectedElement,
                          'system_pack'
                        );
                        setElements((prev) => [
                          ...prev,
                          ...res.createdElements.filter(
                            (c) => !prev.some((p) => p.id === c.id)
                          ),
                        ]);
                        showNotice(res.summary);
                      }}
                      className="btn flex-1"
                    >
                      Expand
                    </button>

                    {deleteConfirmId !== selectedElement.id ? (
                      <button
                        type="button"
                        onClick={() => setDeleteConfirmId(selectedElement.id)}
                        className="btn neg-outline flex-1"
                      >
                        Delete
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            const delId = selectedElement.id;
                            setElements((prev) =>
                              prev.filter((x) => x.id !== delId)
                            );
                            setDeleteConfirmId(null);
                            showNotice(`Элемент ${delId} удалён`);
                          }}
                          className="btn pos flex-1"
                        >
                          {t.confirmYes}
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteConfirmId(null)}
                          className="btn neg flex-1"
                        >
                          {t.confirmNo}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Obsidian-style Element Graph Section with Type Icons */}
              <div className="sidebar-section">
                <div className="section-title" style={{ marginBottom: '10px' }}>
                  <span>Graph View</span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() =>
                        setMiniGraphMode((m) => (m === 'all' ? 'local' : 'all'))
                      }
                      className="pill cursor-pointer"
                      style={{
                        borderColor:
                          miniGraphMode === 'local'
                            ? 'var(--accent)'
                            : undefined,
                        color:
                          miniGraphMode === 'local'
                            ? 'var(--accent)'
                            : undefined,
                      }}
                      title="Переключить между всеми узлами и локальным окружением выбранного элемента"
                    >
                      {miniGraphMode === 'local' ? 'Локальный' : 'Все'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMiniGraphView({
                          zoom: 100,
                          pan: { x: 0, y: 0 },
                        });
                        setMainGraphView({
                          zoom: 100,
                          pan: { x: 0, y: 0 },
                        });
                      }}
                      className="pill cursor-pointer"
                      title="Сбросить вид графа"
                    >
                      Сброс
                    </button>
                    <button
                      type="button"
                      onClick={() => setKbMainGraphOpen((v) => !v)}
                      className="pill cursor-pointer flex items-center justify-center px-1.5 py-1"
                      style={{
                        borderColor: kbMainGraphOpen
                          ? 'var(--accent)'
                          : undefined,
                        color: kbMainGraphOpen ? 'var(--accent)' : undefined,
                      }}
                      title={
                        kbMainGraphOpen
                          ? 'Вернуть редактор в основную область'
                          : 'Открыть граф в основной области'
                      }
                    >
                      {kbMainGraphOpen ? (
                        <Minimize2 size={11} />
                      ) : (
                        <Maximize2 size={11} />
                      )}
                    </button>
                    {!selectedElement && (
                      <button
                        type="button"
                        onClick={() => setRightPanelOpen(false)}
                        className="btn p-1.5"
                        title="Свернуть правую панель"
                      >
                        <PanelRightClose size={15} />
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 mb-2.5">
                  <span className="mono text-[10px] text-[var(--ink-muted)]">
                    Коэф. отдаления
                  </span>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min={0.5}
                      max={2.5}
                      step={0.05}
                      value={graphSpread}
                      onChange={(e) =>
                        setGraphSpread(parseFloat(e.target.value))
                      }
                      className="w-24 accent-[var(--accent)] cursor-pointer"
                    />
                    <span className="mono text-[10px] w-8 text-right">
                      {graphSpread.toFixed(2)}x
                    </span>
                  </div>
                </div>

                <div
                  ref={miniGraphRef}
                  onMouseDown={(e) => {
                    if (e.button !== 0) return;
                    e.preventDefault();
                    miniGraphDownClientRef.current = {
                      x: e.clientX,
                      y: e.clientY,
                    };
                    miniGraphDragMovedRef.current = false;
                    setMiniGraphIsPanning(true);
                    setMiniGraphPanStart({
                      x: e.clientX - miniGraphPan.x,
                      y: e.clientY - miniGraphPan.y,
                    });
                  }}
                  onMouseMove={(e) => {
                    if (!miniGraphIsPanning) return;
                    const dist = Math.hypot(
                      e.clientX - miniGraphDownClientRef.current.x,
                      e.clientY - miniGraphDownClientRef.current.y
                    );
                    if (dist > 4) {
                      miniGraphDragMovedRef.current = true;
                    }
                    setMiniGraphView((prev) => ({
                      ...prev,
                      pan: {
                        x: e.clientX - miniGraphPanStart.x,
                        y: e.clientY - miniGraphPanStart.y,
                      },
                    }));
                  }}
                  onMouseUp={() => {
                    setMiniGraphIsPanning(false);
                  }}
                  style={{
                    height: '216px',
                    backgroundColor: 'var(--surface)',
                    backgroundImage:
                      'radial-gradient(var(--border) 1px, transparent 1px)',
                    backgroundSize: '18px 18px',
                    backgroundPosition: `${miniGraphPan.x}px ${miniGraphPan.y}px`,
                    cursor: miniGraphIsPanning ? 'grabbing' : 'grab',
                    overscrollBehavior: 'contain',
                  }}
                  className="relative w-full border border-[var(--border)] rounded overflow-hidden select-none"
                >
                  <div
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      transform: `translate(${miniGraphPan.x}px, ${miniGraphPan.y}px) scale(${
                        miniGraphZoom / 100
                      })`,
                      transformOrigin: '0 0',
                      width: '292px',
                      height: '216px',
                    }}
                  >
                    <svg className="absolute inset-0 w-full h-full pointer-events-none overflow-visible">
                      {miniGraphLayout.activeEdges.map((edge) => {
                        const p1 = miniGraphLayout.posMap[edge.source];
                        const p2 = miniGraphLayout.posMap[edge.target];
                        if (!p1 || !p2) return null;

                        const focusId = hoveredMiniNodeId || selectedId;
                        const isConnectedToFocus =
                          focusId === edge.source || focusId === edge.target;
                        const isDimmed =
                          Boolean(hoveredMiniNodeId) && !isConnectedToFocus;

                        const dash =
                          edge.relation === 'extends'
                            ? '4 3'
                            : edge.relation === 'notes'
                            ? '2 2'
                            : undefined;

                        return (
                          <line
                            key={edge.id}
                            x1={p1.x}
                            y1={p1.y}
                            x2={p2.x}
                            y2={p2.y}
                            stroke={
                              !edge.valid
                                ? 'var(--ctx-neg)'
                                : isConnectedToFocus
                                ? 'var(--accent)'
                                : 'var(--ink-muted)'
                            }
                            strokeWidth={isConnectedToFocus ? 1.5 : 1}
                            strokeDasharray={dash}
                            strokeOpacity={
                              isDimmed ? 0.2 : isConnectedToFocus ? 0.9 : 0.42
                            }
                          />
                        );
                      })}
                    </svg>

                    {miniGraphLayout.nodes.map((el) => {
                      const pos = miniGraphLayout.posMap[el.id];
                      if (!pos) return null;
                      const TypeIcon = ELEMENT_TYPE_ICONS[el.type];
                      const isSelectedNode = selectedId === el.id;
                      const isHoveredNode = hoveredMiniNodeId === el.id;
                      const focusId = hoveredMiniNodeId || selectedId;
                      const isNeighborOfFocus =
                        focusId &&
                        miniGraphLayout.activeEdges.some(
                          (e) =>
                            (e.source === focusId && e.target === el.id) ||
                            (e.target === focusId && e.source === el.id)
                        );
                      const isDimmed =
                        Boolean(hoveredMiniNodeId) &&
                        !isHoveredNode &&
                        !isNeighborOfFocus;

                      const isRejectedIdea =
                        el.type === 'idea' &&
                        Boolean(el.altTo && el.altTo !== '-');
                      const nodeBorderColor = isSelectedNode || isHoveredNode
                        ? 'var(--accent)'
                        : isRejectedIdea
                        ? 'var(--ctx-neg-border)'
                        : el.mvp
                        ? 'var(--ctx-pos-border)'
                        : 'var(--border)';
                      const nodeIconColor = isSelectedNode || isHoveredNode
                        ? 'var(--accent)'
                        : isRejectedIdea
                        ? 'var(--ctx-neg-text)'
                        : el.mvp
                        ? 'var(--ctx-pos-text)'
                        : 'var(--ink)';

                      return (
                        <div
                          key={el.id}
                          onMouseEnter={() => setHoveredMiniNodeId(el.id)}
                          onMouseLeave={() => setHoveredMiniNodeId(null)}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (miniGraphDragMovedRef.current) return;
                            setSelectedId(el.id);
                            setActiveFile(el.fileName);
                          }}
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            if (miniGraphDragMovedRef.current) return;
                            setSelectedId(el.id);
                            setActiveTab('canvas');
                          }}
                          style={{
                            left: `${pos.x}px`,
                            top: `${pos.y}px`,
                            transform: 'translate(-50%, -50%)',
                            opacity: isDimmed ? 0.32 : 1,
                            zIndex:
                              isSelectedNode || isHoveredNode
                                ? 20
                                : isNeighborOfFocus
                                ? 15
                                : 10,
                          }}
                          title={`${el.id} — ${el.title} (двойной клик: открыть на Холсте)`}
                          className="mini-graph-node absolute w-6 h-6 cursor-pointer transition-opacity duration-150"
                        >
                          <div
                            style={{
                              backgroundColor: 'var(--bg)',
                              borderColor: nodeBorderColor,
                              color: nodeIconColor,
                              boxShadow:
                                isSelectedNode || isHoveredNode
                                  ? '0 0 0 1px var(--accent)'
                                  : undefined,
                            }}
                            className="w-6 h-6 rounded border flex items-center justify-center transition-transform duration-150 hover:scale-110"
                          >
                            <TypeIcon size={13} />
                          </div>
                          <div className="absolute left-1/2 top-full -translate-x-1/2 mt-1 flex flex-col items-center pointer-events-none">
                            <span
                              style={{
                                color:
                                  isSelectedNode || isHoveredNode
                                    ? 'var(--ink)'
                                    : 'var(--ink-muted)',
                                backgroundColor: 'var(--surface)',
                              }}
                              className="mono text-[9px] leading-none px-1 py-0.5 rounded max-w-[78px] truncate whitespace-nowrap"
                            >
                              {stripElementPrefix(el.id)}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Conflicts & AI Suggestion Section */}
              <div
                className="sidebar-section"
                style={{ background: 'rgba(239, 68, 68, 0.02)' }}
              >
                <div
                  className="section-title"
                  style={{ color: 'var(--ctx-neg-text)' }}
                >
                  <span>Conflicts & AI</span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setAiModalOpen(true)}
                      className="mono underline cursor-pointer text-[10px]"
                    >
                      Все ({proposals.length + contradictions.length})
                    </button>
                  </div>
                </div>

                {!aiEnabled ? (
                  <div className="mono text-xs">
                    Ручной режим активен (ИИ отключён в Настройках).
                  </div>
                ) : (
                  <>
                    {contradictions.slice(0, 1).map((c) => (
                      <div
                        key={c.id}
                        className="text-xs font-medium"
                        style={{
                          color: 'var(--ctx-neg-text)',
                          marginBottom: '18px',
                        }}
                      >
                        <div style={{ marginBottom: '8px' }}>⚠ {c.title}</div>
                        {c.suggestedFix && (
                          <button
                            type="button"
                            onClick={() => {
                              const { targetElementId, patch } =
                                c.suggestedFix!;
                              setElements((prev) =>
                                prev.map((el) =>
                                  el.id === targetElementId
                                    ? { ...el, ...patch }
                                    : el
                                )
                              );
                              setContradictions((prev) =>
                                prev.filter((x) => x.id !== c.id)
                              );
                              showNotice(
                                `Противоречие в ${targetElementId} исправлено`
                              );
                            }}
                            className="btn py-1 px-2.5 text-[10px]"
                          >
                            Исправить конфликт
                          </button>
                        )}
                      </div>
                    ))}

                    {proposals.slice(0, 1).map((prop) => (
                      <div
                        key={prop.id}
                        className="ai-suggestion"
                        style={{ marginTop: '14px' }}
                      >
                        <div
                          className="label"
                          style={{
                            marginBottom: '8px',
                            color: 'var(--ctx-pos-text)',
                          }}
                        >
                          AI Suggestion
                        </div>
                        <div
                          style={{
                            fontSize: '0.8rem',
                            marginBottom: '14px',
                            lineHeight: 1.5,
                          }}
                        >
                          {prop.title}.{' '}
                          <span className="mono">{prop.rationale}</span>
                        </div>
                        <div className="btn-group">
                          <button
                            type="button"
                            onClick={() => handleApplyProposal(prop)}
                            className="btn pos flex-1"
                          >
                            Apply
                          </button>
                          <button
                            type="button"
                            onClick={() => setRejectProposalModal(prop)}
                            className="btn neg flex-1"
                          >
                            Dismiss
                          </button>
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =================================================================
          TAB 2: ХОЛСТ (Pan by LMB on empty area, Zoom by wheel, Non-sticking drag)
         ================================================================= */}
      {activeTab === 'canvas' && (
        <div className="workspace-2col">
          <button
            type="button"
            onClick={() => setLeftPanelOpen(true)}
            className={`btn p-1.5 panel-expand-btn left ${
              leftPanelOpen ? 'is-hidden' : ''
            }`}
            title="Развернуть левую панель"
          >
            <PanelLeftOpen size={15} />
          </button>

          {/* Left Controls Column */}
          <div
            className={`panel files-column ${
              !leftPanelOpen ? 'collapsed' : ''
            }`}
          >
            <div className="files-column-inner p-4 space-y-3">
              <div className="section-title">
                <span>Связи</span>
                <button
                  type="button"
                  onClick={() => setLeftPanelOpen(false)}
                  className="btn p-1.5"
                  title="Свернуть левую панель"
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
                  const isChecked = visibleRelations[rel];
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
                          setVisibleRelations((prev) => ({
                            ...prev,
                            [rel]: !prev[rel],
                          }))
                        }
                        className="sys-checkbox"
                      />
                      <span className="font-medium tracking-tight">{rel}</span>
                    </label>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={() => {
                  const allExpanded =
                    filteredElements.length > 0 &&
                    filteredElements.every((el) => expandedNodeIds[el.id]);
                  if (allExpanded) {
                    setExpandedNodeIds({});
                  } else {
                    const next: Record<string, boolean> = {};
                    filteredElements.forEach((el) => {
                      next[el.id] = true;
                    });
                    setExpandedNodeIds(next);
                  }
                }}
                className="btn w-full"
              >
                {filteredElements.length > 0 &&
                filteredElements.every((el) => expandedNodeIds[el.id])
                  ? 'Свернуть все узлы'
                  : 'Развернуть все узлы'}
              </button>

              <button
                type="button"
                onClick={() => {
                  const snap: Record<string, { x: number; y: number }> = {};
                  elements.forEach((item) => {
                    snap[item.id] = {
                      x: item.position.x,
                      y: item.position.y,
                    };
                  });
                  setMoveHistory((prev) => [...prev.slice(-49), snap]);

                  const order: ElementType[] = [
                    'system',
                    'class',
                    'object',
                    'component',
                    'process',
                    'idea',
                  ];
                  const next = elements.map((el) => ({
                    ...el,
                    position: { ...el.position },
                  }));
                  order.forEach((tp, colIdx) => {
                    next
                      .filter((x) => x.type === tp)
                      .forEach((el, rowIdx) => {
                        el.position = {
                          x: 40 + colIdx * 240,
                          y: 40 + rowIdx * 140,
                        };
                      });
                  });
                  setElements(next);
                  showNotice('Выполнена авто-укладка узлов на холсте');
                }}
                className="btn w-full"
              >
                Авто-укладка
              </button>

              <button
                type="button"
                onClick={() => {
                  setCanvasZoom(100);
                  setCanvasPan({ x: 20, y: 20 });
                }}
                className="btn w-full"
              >
                Сброс камеры (100%)
              </button>
            </div>
          </div>

          {/* Interactive Canvas Surface */}
          <div className="panel editor-column">
            <div
              ref={canvasAreaRef}
              onMouseDown={(e) => {
                if (e.button !== 0) return;
                if ((e.target as HTMLElement).closest('.sys-node')) return;
                e.preventDefault();
                setSelectedId(null);
                setIsPanningCanvas(true);
                setPanStart({
                  x: e.clientX - canvasPan.x,
                  y: e.clientY - canvasPan.y,
                });
              }}
              onWheel={(e) => {
                e.preventDefault();
                const rect = canvasAreaRef.current?.getBoundingClientRect();
                const delta = e.deltaY < 0 ? 10 : -10;
                const nextZoom = Math.min(
                  200,
                  Math.max(40, canvasZoom + delta)
                );
                if (nextZoom === canvasZoom) return;

                if (rect) {
                  const cursorX = e.clientX - rect.left;
                  const cursorY = e.clientY - rect.top;
                  const oldScale = canvasZoom / 100;
                  const newScale = nextZoom / 100;
                  const worldX = (cursorX - canvasPan.x) / oldScale;
                  const worldY = (cursorY - canvasPan.y) / oldScale;
                  setCanvasPan({
                    x: Math.round(cursorX - worldX * newScale),
                    y: Math.round(cursorY - worldY * newScale),
                  });
                }
                setCanvasZoom(nextZoom);
              }}
              onMouseMove={(e) => {
                const rect = canvasAreaRef.current?.getBoundingClientRect();
                if (!rect) return;

                if (isPanningCanvas) {
                  setCanvasPan({
                    x: e.clientX - panStart.x,
                    y: e.clientY - panStart.y,
                  });
                  return;
                }

                const scale = canvasZoom / 100;
                const x = (e.clientX - rect.left - canvasPan.x) / scale;
                const y = (e.clientY - rect.top - canvasPan.y) / scale;
                if (connectingFromId) {
                  setMouseCanvasPos({ x, y });
                }
                if (draggingNodeId) {
                  const rawX = x - dragOffset.x;
                  const rawY = y - dragOffset.y;
                  let nx = Math.round(rawX / 10) * 10;
                  let ny = Math.round(rawY / 10) * 10;

                  const SNAP_THRESHOLD = 12;
                  let snappedVerticalX: number | null = null;
                  let snappedHorizontalY: number | null = null;
                  let minDx = SNAP_THRESHOLD + 1;
                  let minDy = SNAP_THRESHOLD + 1;

                  for (const other of filteredElements) {
                    if (other.id === draggingNodeId) continue;
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

                  setAlignmentGuides({
                    verticalX: snappedVerticalX,
                    horizontalY: snappedHorizontalY,
                  });

                  setElements((prev) =>
                    prev.map((el) =>
                      el.id === draggingNodeId
                        ? { ...el, position: { x: nx, y: ny } }
                        : el
                    )
                  );
                }
              }}
              onMouseUp={() => {
                commitDragSnapshotIfMoved();
                setDraggingNodeId(null);
                setConnectingFromId(null);
                setIsPanningCanvas(false);
                setAlignmentGuides({ verticalX: null, horizontalY: null });
              }}
              style={{
                backgroundPosition: `${canvasPan.x}px ${canvasPan.y}px`,
                cursor: isPanningCanvas ? 'grabbing' : 'grab',
              }}
              className="sys-canvas-area select-none"
            >
              <div
                style={{
                  transform: `translate(${canvasPan.x}px, ${canvasPan.y}px) scale(${canvasZoom / 100})`,
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
                  </defs>

                  {edges
                    .filter((edge) => visibleRelations[edge.relation])
                    .map((edge) => {
                      const src = elements.find((e) => e.id === edge.source);
                      const tgt = elements.find((e) => e.id === edge.target);
                      if (!src || !tgt) return null;

                      const x1 = src.position.x + 85;
                      const y1 = src.position.y + 30;
                      const x2 = tgt.position.x + 85;
                      const y2 = tgt.position.y + 30;

                      const midX = (x1 + x2) / 2;
                      const midY = (y1 + y2) / 2 - 6;

                      const dash =
                        edge.relation === 'extends'
                          ? '6 4'
                          : edge.relation === 'notes'
                          ? '2 3'
                          : undefined;

                      const isSelectedEdge =
                        selectedId === edge.source ||
                        selectedId === edge.target;

                      const selectedMarkerColor = selectedElement
                        ? selectedElement.customColor ||
                          (selectedElement.type === 'idea' &&
                          selectedElement.altTo &&
                          selectedElement.altTo !== '-'
                            ? 'var(--ctx-neg-text)'
                            : selectedElement.mvp
                            ? 'var(--ctx-pos-text)'
                            : 'var(--ink)')
                        : 'var(--ink-muted)';

                      return (
                        <g key={edge.id}>
                          <line
                            x1={x1}
                            y1={y1}
                            x2={x2}
                            y2={y2}
                            stroke={
                              !edge.valid
                                ? 'var(--ctx-neg)'
                                : isSelectedEdge
                                ? selectedMarkerColor
                                : 'var(--ink-muted)'
                            }
                            strokeWidth={isSelectedEdge ? 1.8 : 1.2}
                            strokeDasharray={dash}
                            markerEnd="url(#sys-arrow)"
                          />
                          <text
                            x={midX}
                            y={midY}
                            textAnchor="middle"
                            fill="var(--ink)"
                            className="mono text-[10px]"
                            style={{
                              paintOrder: 'stroke',
                              stroke: 'var(--surface)',
                              strokeWidth: '4px',
                            }}
                          >
                            {edge.relation}
                          </text>
                        </g>
                      );
                    })}

                  {alignmentGuides.verticalX !== null && (
                    <line
                      x1={alignmentGuides.verticalX}
                      y1={-1000}
                      x2={alignmentGuides.verticalX}
                      y2={3000}
                      stroke="var(--ctx-pos-text)"
                      strokeWidth={1.2}
                      strokeDasharray="4 4"
                    />
                  )}
                  {alignmentGuides.horizontalY !== null && (
                    <line
                      x1={-1000}
                      y1={alignmentGuides.horizontalY}
                      x2={4000}
                      y2={alignmentGuides.horizontalY}
                      stroke="var(--ctx-pos-text)"
                      strokeWidth={1.2}
                      strokeDasharray="4 4"
                    />
                  )}

                  {connectingFromId &&
                    elements.find((e) => e.id === connectingFromId) && (
                      <line
                        x1={
                          elements.find((e) => e.id === connectingFromId)!
                            .position.x + 150
                        }
                        y1={
                          elements.find((e) => e.id === connectingFromId)!
                            .position.y + 24
                        }
                        x2={mouseCanvasPos.x}
                        y2={mouseCanvasPos.y}
                        stroke="var(--accent)"
                        strokeWidth={2}
                        strokeDasharray="4 3"
                      />
                    )}
                </svg>

                {filteredElements.map((el) => {
                  const isSelected = selectedId === el.id;
                  const isNodeExpanded = Boolean(expandedNodeIds[el.id]);
                  const typeHeader = TYPE_HEADERS_RU[el.type].split('-')[0];

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
                      onMouseDown={(e) => {
                        if (e.button !== 0) return;
                        e.stopPropagation();
                        e.preventDefault();
                        setSelectedId(el.id);
                        const rect =
                          canvasAreaRef.current?.getBoundingClientRect();
                        if (!rect) return;
                        const snap: Record<string, { x: number; y: number }> =
                          {};
                        elements.forEach((item) => {
                          snap[item.id] = {
                            x: item.position.x,
                            y: item.position.y,
                          };
                        });
                        dragStartSnapshotRef.current = snap;
                        const scale = canvasZoom / 100;
                        const cx =
                          (e.clientX - rect.left - canvasPan.x) / scale;
                        const cy =
                          (e.clientY - rect.top - canvasPan.y) / scale;
                        setDraggingNodeId(el.id);
                        setDragOffset({
                          x: cx - el.position.x,
                          y: cy - el.position.y,
                        });
                      }}
                      onMouseUp={(e) => {
                        e.stopPropagation();
                        if (connectingFromId && connectingFromId !== el.id) {
                          handleConnectOnCanvas(connectingFromId, el.id);
                        }
                        commitDragSnapshotIfMoved();
                        setDraggingNodeId(null);
                        setConnectingFromId(null);
                        setIsPanningCanvas(false);
                        setAlignmentGuides({
                          verticalX: null,
                          horizontalY: null,
                        });
                      }}
                      onDoubleClick={() => {
                        setSelectedId(el.id);
                        setActiveTab('kb');
                      }}
                      style={{
                        left: `${el.position.x}px`,
                        top: `${el.position.y}px`,
                        borderColor: isSelected ? activeStrokeColor : undefined,
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
                      className={`sys-node ${isSelected ? 'selected' : ''}`}
                    >
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
                              setExpandedNodeIds((prev) => ({
                                ...prev,
                                [el.id]: !prev[el.id],
                              }));
                            }}
                            className="pill cursor-pointer hover:border-[var(--ink)] flex items-center justify-center px-1"
                            title={
                              isNodeExpanded
                                ? 'Свернуть компонент'
                                : 'Развернуть компонент'
                            }
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
                                canvasAreaRef.current?.getBoundingClientRect();
                              if (!rect) return;
                              const scale = canvasZoom / 100;
                              setConnectingFromId(el.id);
                              setMouseCanvasPos({
                                x:
                                  (e.clientX - rect.left - canvasPan.x) / scale,
                                y:
                                  (e.clientY - rect.top - canvasPan.y) / scale,
                              });
                            }}
                            className="pill cursor-crosshair hover:border-[var(--ink)]"
                            title="Зажмите и перетащите на другой узел"
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
                            <div className="mono">parent: {el.parent}</div>
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
            </div>
          </div>
        </div>
      )}

      {/* =================================================================
          TAB 3: БИБЛИОТЕКА ЮНИТОВ
         ================================================================= */}
      {activeTab === 'library' && (
        <div className="workspace-2col">
          <button
            type="button"
            onClick={() => setLeftPanelOpen(true)}
            className={`btn p-1.5 panel-expand-btn left ${
              leftPanelOpen ? 'is-hidden' : ''
            }`}
            title="Развернуть левую панель"
          >
            <PanelLeftOpen size={15} />
          </button>

          <div
            className={`panel files-column ${
              !leftPanelOpen ? 'collapsed' : ''
            }`}
          >
            <div className="files-column-inner">
              <div className="p-3 border-b border-[var(--border)] shrink-0 flex items-center gap-1.5">
                <input
                  type="text"
                  placeholder="Поиск по библиотеке..."
                  value={libSearch}
                  onChange={(e) => setLibSearch(e.target.value)}
                  className="sys-input flex-1 min-w-0 text-xs"
                />
                <button
                  type="button"
                  onClick={() => setLeftPanelOpen(false)}
                  className="btn p-1.5 shrink-0"
                  title="Свернуть левую панель"
                >
                  <PanelLeftClose size={15} />
                </button>
              </div>
              <div className="panel-header">
                <span className="label">{t.categoriesHeader}</span>
              </div>
              <div className="p-3 space-y-1">
                {(
                  [
                    { key: 'all', label: 'Все юниты' },
                    { key: 'system', label: 'Системы' },
                    { key: 'class', label: 'Классы' },
                    { key: 'component', label: 'Компоненты' },
                    { key: 'process', label: 'Процессы' },
                    { key: 'object', label: 'Объекты' },
                    { key: 'idea', label: 'Идеи' },
                  ] as { key: 'all' | ElementType; label: string }[]
                ).map((cat) => (
                  <div
                    key={cat.key}
                    onClick={() => setLibCategoryFilter(cat.key)}
                    className={`tree-node ${
                      libCategoryFilter === cat.key ? 'active' : ''
                    }`}
                  >
                    <span>{cat.label}</span>
                  </div>
                ))}
              </div>

              <div className="panel-header mt-2">
                <span className="label">Перетащите в библиотеку</span>
              </div>
              <div className="p-3 flex-1 overflow-y-auto space-y-1">
                {elements.map((el) => (
                  <div
                    key={el.id}
                    draggable
                    onDragStart={(e) =>
                      e.dataTransfer.setData('text/plain', el.id)
                    }
                    className="tree-node"
                  >
                    <span className="mono truncate">{el.id}</span>
                    <span className="pill">drag</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="panel editor-column">
            <div
              className="editor-scroll"
              style={{ paddingLeft: leftPanelOpen ? '24px' : '52px' }}
            >
              <div className="editor-meta">
                <span className="label">REUSABLE ARCHITECTURE UNITS</span>
                <span className="pill">Юнитов: {unitLibrary.length}</span>
              </div>
              <div className="title-display" style={{ fontSize: '2rem' }}>
                Библиотека юнитов
              </div>

              <div className="field-grid">
                {unitLibrary
                  .filter((u) => {
                    if (
                      libCategoryFilter !== 'all' &&
                      u.element.type !== libCategoryFilter
                    ) {
                      return false;
                    }
                    if (libSearch.trim()) {
                      const q = libSearch.toLowerCase();
                      return (
                        u.element.title.toLowerCase().includes(q) ||
                        u.element.id.toLowerCase().includes(q)
                      );
                    }
                    return true;
                  })
                  .map((unit) => (
                    <div
                      key={unit.unitId}
                      className="field-row items-center"
                      style={{ gridTemplateColumns: '1fr 1fr auto' }}
                    >
                      <div>
                        <div className="font-semibold text-sm">
                          {unit.element.title}
                        </div>
                        <div className="mono text-xs">{unit.element.id}</div>
                      </div>
                      <div className="mono">{unit.category}</div>
                      <button
                        type="button"
                        onClick={() => handleAddUnitToProject(unit)}
                        className="btn primary"
                      >
                        Добавить в проект
                      </button>
                    </div>
                  ))}
              </div>

              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const droppedId = e.dataTransfer.getData('text/plain');
                  const found = elements.find((x) => x.id === droppedId);
                  if (found) {
                    handleSaveCurrentToLibrary(found);
                  }
                }}
                className="mt-6 p-8 border border-dashed border-[var(--border)] rounded text-center mono"
              >
                Перетащите элемент сюда, чтобы сохранить его в библиотеку
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =================================================================
          TAB 4: НАСТРОЙКИ (With visual buttons for contextual color pairs)
         ================================================================= */}
      {activeTab === 'settings' && (
        <div className="workspace-2col">
          <button
            type="button"
            onClick={() => setLeftPanelOpen(true)}
            className={`btn p-1.5 panel-expand-btn left ${
              leftPanelOpen ? 'is-hidden' : ''
            }`}
            title="Развернуть левую панель"
          >
            <PanelLeftOpen size={15} />
          </button>

          <div
            className={`panel files-column ${
              !leftPanelOpen ? 'collapsed' : ''
            }`}
          >
            <div className="files-column-inner">
              <div className="panel-header">
                <span className="label">{t.sectionsHeader}</span>
                <button
                  type="button"
                  onClick={() => setLeftPanelOpen(false)}
                  className="btn p-1.5"
                  title="Свернуть левую панель"
                >
                  <PanelLeftClose size={15} />
                </button>
              </div>
              <div className="p-3 space-y-1">
                {[
                  { id: 'theme', label: 'Тема оформления' },
                  { id: 'colors', label: 'Контекстные цвета' },
                  { id: 'ai', label: 'ИИ-ассистент (API)' },
                  { id: 'git', label: 'Git-версионирование' },
                  { id: 'lang', label: 'Язык интерфейса' },
                ].map((sec) => (
                  <div
                    key={sec.id}
                    onClick={() => setActiveSettingsSection(sec.id)}
                    className={`tree-node ${
                      activeSettingsSection === sec.id ? 'active' : ''
                    }`}
                  >
                    <span>{sec.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="panel editor-column">
            <div
              className="editor-scroll"
              style={{ paddingLeft: leftPanelOpen ? '24px' : '52px' }}
            >
              <div className="editor-meta">
                <span className="label">SYSTEM CONFIGURATION</span>
              </div>
              <div className="title-display" style={{ fontSize: '2rem' }}>
                Настройки
              </div>

              <div className="field-grid">
                {/* 1. Theme */}
                <div className="field-row">
                  <div className="field-label">Тема оформления</div>
                  <div className="field-value space-y-2">
                    <div className="flex flex-wrap items-center gap-2.5">
                      {(
                        [
                          {
                            key: 'dark',
                            label: 'Тёмная (по умолчанию)',
                          },
                          {
                            key: 'classic',
                            label: 'Классическая',
                          },
                          { key: 'light', label: 'Светлая' },
                          { key: 'system', label: 'Системная' },
                        ] as { key: ThemeMode; label: string }[]
                      ).map((opt) => (
                        <button
                          key={opt.key}
                          type="button"
                          onClick={() => setThemeMode(opt.key)}
                          className={`btn ${
                            themeMode === opt.key ? 'primary' : ''
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    <div className="mono text-[11px]">
                      {themeMode === 'classic'
                        ? 'Классическая: строгая чёрно-белая палитра (#000 / #FFF) с контекстными цветами для положительных и отрицательных элементов.'
                        : themeMode === 'dark'
                        ? 'Тёмная (System Dark): тема по умолчанию с глубоким фоном #0C0C0E и акцентной подсветкой.'
                        : themeMode === 'light'
                        ? 'Светлая: мягкая светлая палитра с акцентной подсветкой.'
                        : 'Системная: автоматически следует настройкам ОС.'}
                    </div>
                  </div>
                </div>

                {/* 2. Visual Contextual Color Buttons */}
                <div className="field-row">
                  <div className="field-label">
                    Положительный контекст («Да», Применить)
                  </div>
                  <div className="field-value flex flex-wrap gap-2">
                    {(
                      Object.keys(POSITIVE_PALETTES) as PositivePaletteKey[]
                    ).map((key) => {
                      const pal = POSITIVE_PALETTES[key];
                      const isActive = posPalette === key;
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setPosPalette(key)}
                          className="btn"
                          style={{
                            borderColor: isActive ? pal.main : 'var(--border)',
                            backgroundColor: isActive
                              ? pal.soft
                              : 'transparent',
                          }}
                        >
                          <span
                            className="w-3 h-3 rounded-sm inline-block"
                            style={{ backgroundColor: pal.main }}
                          />
                          <span>{pal.labelRu}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="field-row">
                  <div className="field-label">
                    Отрицательный контекст («Нет», Отклонить)
                  </div>
                  <div className="field-value flex flex-wrap gap-2">
                    {(
                      Object.keys(NEGATIVE_PALETTES) as NegativePaletteKey[]
                    ).map((key) => {
                      const pal = NEGATIVE_PALETTES[key];
                      const isActive = negPalette === key;
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setNegPalette(key)}
                          className="btn"
                          style={{
                            borderColor: isActive ? pal.main : 'var(--border)',
                            backgroundColor: isActive
                              ? pal.soft
                              : 'transparent',
                          }}
                        >
                          <span
                            className="w-3 h-3 rounded-sm inline-block"
                            style={{ backgroundColor: pal.main }}
                          />
                          <span>{pal.labelRu}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="field-row">
                  <div className="field-label">Предпросмотр пары</div>
                  <div className="field-value flex items-center gap-3">
                    <span className="btn pos">Да · Применить</span>
                    <span className="btn neg">Нет · Отклонить</span>
                  </div>
                </div>

                {/* 3. AI Assistant */}
                <div className="field-row">
                  <div className="field-label">ИИ-ассистент</div>
                  <div className="field-value space-y-3">
                    <div className="flex items-center gap-3">
                      <span className="mono">Endpoint:</span>
                      <input
                        type="text"
                        value={aiEndpoint}
                        onChange={(e) => setAiEndpoint(e.target.value)}
                        className="sys-input flex-1 mono"
                      />
                    </div>
                    <label className="inline-flex items-center gap-2 cursor-pointer text-xs">
                      <input
                        type="checkbox"
                        checked={aiEnabled}
                        onChange={(e) => setAiEnabled(e.target.checked)}
                      />
                      <span>
                        Включить ИИ-функции (опционально, приложение работает и в ручном режиме)
                      </span>
                    </label>
                  </div>
                </div>

                {/* 4. Git Versioning */}
                <div className="field-row">
                  <div className="field-label">Git-версионирование</div>
                  <div className="field-value space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="inline-flex items-center gap-2 cursor-pointer text-xs">
                        <input
                          type="checkbox"
                          checked={gitEnabled}
                          onChange={(e) => setGitEnabled(e.target.checked)}
                        />
                        <span>
                          Подключить git к проекту (ветка: main, изменений:{' '}
                          {uncommittedChanges})
                        </span>
                      </label>
                      <button
                        type="button"
                        onClick={() => setGitHistoryOpen((v) => !v)}
                        className="btn"
                      >
                        {gitHistoryOpen
                          ? 'Скрыть историю изменений'
                          : 'Открыть историю изменений'}
                      </button>
                    </div>

                    {gitHistoryOpen && (
                      <div className="space-y-3 pt-2 border-t border-[var(--border)]">
                        <div className="flex gap-2">
                          <input
                            type="text"
                            placeholder="Сообщение коммита (.pgr diff)..."
                            value={commitMsgInput}
                            onChange={(e) => setCommitMsgInput(e.target.value)}
                            className="sys-input flex-1"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const hash = Math.random()
                                .toString(16)
                                .slice(2, 9);
                              const newCommit: GitCommit = {
                                id: `commit_${Date.now()}`,
                                hash,
                                message:
                                  commitMsgInput.trim() ||
                                  'Обновление структуры плана (.pgr)',
                                timestamp: new Date()
                                  .toISOString()
                                  .slice(0, 16)
                                  .replace('T', ' '),
                                author: 'main',
                                filesSnapshot: createSnapshotMap(
                                  elements,
                                  files
                                ),
                                elementsSnapshot: JSON.parse(
                                  JSON.stringify(elements)
                                ),
                              };
                              setCommits((prev) => [newCommit, ...prev]);
                              setCommitMsgInput('');
                              setUncommittedChanges(0);
                              showNotice(`Зафиксирован коммит #${hash}`);
                            }}
                            className="btn pos"
                          >
                            Закоммитить .pgr
                          </button>
                        </div>

                        <div className="flex items-center gap-2">
                          <span className="label">Дифф файла:</span>
                          {files.map((f) => (
                            <button
                              key={f}
                              type="button"
                              onClick={() => setDiffFileSelect(f)}
                              className="pill cursor-pointer"
                              style={{
                                borderColor:
                                  diffFileSelect === f
                                    ? 'var(--accent)'
                                    : undefined,
                                color:
                                  diffFileSelect === f
                                    ? 'var(--accent)'
                                    : undefined,
                              }}
                            >
                              {f}
                            </button>
                          ))}
                        </div>

                        <div className="p-3 border border-[var(--border)] rounded bg-[var(--bg)] max-h-48 overflow-y-auto mono text-xs">
                          {computeLineDiff(
                            commits[0]?.filesSnapshot[diffFileSelect] || '',
                            serializeFileWithRanges(elements, diffFileSelect)
                              .content
                          ).map((dl, idx) => (
                            <div
                              key={idx}
                              className="px-1"
                              style={{
                                backgroundColor:
                                  dl.type === 'added'
                                    ? 'var(--ctx-pos-soft)'
                                    : dl.type === 'removed'
                                    ? 'var(--ctx-neg-soft)'
                                    : 'transparent',
                                color:
                                  dl.type === 'added'
                                    ? 'var(--ctx-pos-text)'
                                    : dl.type === 'removed'
                                    ? 'var(--ctx-neg-text)'
                                    : 'var(--ink-muted)',
                              }}
                            >
                              {dl.type === 'added'
                                ? '+ '
                                : dl.type === 'removed'
                                ? '- '
                                : '  '}
                              {dl.content}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* 5. Language */}
                <div className="field-row">
                  <div className="field-label">Язык интерфейса</div>
                  <div className="field-value flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setLocale('ru')}
                      className={`btn ${locale === 'ru' ? 'primary' : ''}`}
                    >
                      Русский (по умолчанию)
                    </button>
                    <button
                      type="button"
                      onClick={() => setLocale('en')}
                      className={`btn ${locale === 'en' ? 'primary' : ''}`}
                    >
                      English
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =================================================================
          FOOTER STATUSBAR (Variation 5 System Dark)
         ================================================================= */}
      <footer className="sys-footer">
        <div className="flex items-center gap-5">
          <span
            onClick={() => {
              setActiveTab('settings');
              setActiveSettingsSection('git');
              setGitHistoryOpen(true);
            }}
            className="cursor-pointer hover:text-[var(--ink)]"
          >
            BRANCH: MAIN
          </span>
          <span>MODIFIED: {uncommittedChanges} CHANGES</span>
          {statusNotice && (
            <span style={{ color: 'var(--ctx-pos-text)' }}>
              ● {statusNotice}
            </span>
          )}
        </div>

        <div className="flex items-center gap-5">
          {activeTab === 'canvas' && (
            <div className="flex items-center gap-2">
              <span>ZOOM: {canvasZoom}%</span>
              <button
                type="button"
                onClick={() => setCanvasZoom((z) => Math.max(40, z - 10))}
                className="pill cursor-pointer"
              >
                -
              </button>
              <button
                type="button"
                onClick={() => setCanvasZoom((z) => Math.min(200, z + 10))}
                className="pill cursor-pointer"
              >
                +
              </button>
            </div>
          )}
          <span>
            INDEX: {filteredElements.length}/{elements.length}
          </span>
        </div>
      </footer>

      {/* =================================================================
          MODAL: ИИ-ассистент (Полное окно предложений, противоречий, интервью и RAG)
         ================================================================= */}
      {aiModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
          <div className="w-full max-w-4xl max-h-[86vh] flex flex-col border border-[var(--border)] rounded-lg bg-[var(--surface)] overflow-hidden">
            <div className="panel-header">
              <span className="label" style={{ color: 'var(--accent)' }}>
                AI ASSISTANT · ПРОАКТИВНЫЙ АНАЛИЗ И ИНТЕРВЬЮ
              </span>
              <button
                type="button"
                onClick={() => setAiModalOpen(false)}
                className="btn py-1 px-2.5"
              >
                Закрыть
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              <div>
                <div className="section-title">
                  <span>Противоречия ({contradictions.length})</span>
                </div>
                <div className="space-y-2">
                  {contradictions.map((c) => (
                    <div
                      key={c.id}
                      className="p-3 border border-[var(--border)] rounded bg-[var(--bg)] flex items-center justify-between gap-4"
                    >
                      <div className="space-y-1">
                        <div
                          className="text-xs font-semibold"
                          style={{ color: 'var(--ctx-neg-text)' }}
                        >
                          ⚠ {c.title}
                        </div>
                        <div className="mono">{c.description}</div>
                      </div>
                      {c.suggestedFix && (
                        <button
                          type="button"
                          onClick={() => {
                            const { targetElementId, patch } = c.suggestedFix!;
                            setElements((prev) =>
                              prev.map((el) =>
                                el.id === targetElementId
                                  ? { ...el, ...patch }
                                  : el
                              )
                            );
                            setContradictions((prev) =>
                              prev.filter((x) => x.id !== c.id)
                            );
                            showNotice(c.suggestedFix!.fixLabel);
                          }}
                          className="btn pos shrink-0"
                        >
                          Исправить
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="section-title">
                  <span>Карточки-предложения ({proposals.length})</span>
                </div>
                <div className="space-y-2">
                  {proposals.map((prop) => (
                    <div
                      key={prop.id}
                      className="p-3 border border-[var(--border)] rounded bg-[var(--bg)] flex items-center justify-between gap-4"
                    >
                      <div className="space-y-1">
                        <div className="text-xs font-semibold">{prop.title}</div>
                        <div className="mono">{prop.rationale}</div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleApplyProposal(prop)}
                          className="btn pos"
                        >
                          Применить
                        </button>
                        <button
                          type="button"
                          onClick={() => setRejectProposalModal(prop)}
                          className="btn neg"
                        >
                          Отклонить
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="section-title">
                  <span>Проблемное интервью</span>
                </div>
                <div className="space-y-2">
                  {interviewQuestions.map((q) => (
                    <div
                      key={q.id}
                      className="p-3 border border-[var(--border)] rounded bg-[var(--bg)] space-y-2"
                    >
                      <div className="text-xs font-semibold">{q.question}</div>
                      <div className="mono">{q.weakSpotContext}</div>
                      <div className="flex flex-wrap gap-2 pt-1">
                        {q.quickOptions.map((opt, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => {
                              if (q.targetElementId) {
                                setElements((prev) =>
                                  prev.map((el) =>
                                    el.id === q.targetElementId
                                      ? {
                                          ...el,
                                          description: `${el.description} [Правило: ${opt}]`,
                                        }
                                      : el
                                  )
                                );
                              }
                              showNotice(
                                `Ответ записан в ${q.targetElementId}`
                              );
                            }}
                            className="btn"
                          >
                            → {opt}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="section-title">
                  <span>RAG-индекс .pgr по диапазонам строк</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {buildRagIndex(elements, files).map((chunk) => (
                    <div
                      key={chunk.elementId}
                      className="p-2.5 border border-[var(--border)] rounded bg-[var(--bg)] flex items-center justify-between mono"
                    >
                      <span>{chunk.elementId}</span>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveFile(chunk.fileName);
                          setSelectedId(chunk.elementId);
                          setLineRangeFilter({
                            start: chunk.startLine,
                            end: chunk.endLine,
                          });
                          setKbEditorMode('raw_pgr');
                          setActiveTab('kb');
                          setAiModalOpen(false);
                        }}
                        className="underline cursor-pointer"
                        style={{ color: 'var(--accent)' }}
                      >
                        {chunk.citation}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =================================================================
          MODAL: Reject Proposal as Idea (with alt_to & alt_reason)
         ================================================================= */}
      {rejectProposalModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md border border-[var(--border)] rounded-lg bg-[var(--surface)] p-5 space-y-4">
            <div className="section-title">
              <span>Отклонить предложение в Идею-образ</span>
            </div>
            <div className="mono">
              Будет создана Идея-образ с полями{' '}
              <code>alt_to: {rejectProposalModal.targetElementId || '-'}</code>{' '}
              и <code>alt_reason</code>.
            </div>
            <input
              type="text"
              placeholder="Причина отказа (alt_reason)..."
              value={rejectReasonInput}
              onChange={(e) => setRejectReasonInput(e.target.value)}
              className="sys-input w-full"
            />
            <div className="btn-group">
              <button
                type="button"
                onClick={handleConfirmRejectProposal}
                className="btn pos flex-1"
              >
                {t.confirmYes}
              </button>
              <button
                type="button"
                onClick={() => setRejectProposalModal(null)}
                className="btn neg flex-1"
              >
                {t.confirmNo}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =================================================================
          MODAL: Create New Plan Element
         ================================================================= */}
      {newElementModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md border border-[var(--border)] rounded-lg bg-[var(--surface)] p-5 space-y-4">
            <div className="section-title">
              <span>Создать новый элемент плана</span>
            </div>

            <div className="space-y-3">
              <div>
                <div className="label mb-1">Тип элемента</div>
                <select
                  value={newElType}
                  onChange={(e) => setNewElType(e.target.value as ElementType)}
                  className="sys-input w-full"
                >
                  <option value="system">Система (sys_)</option>
                  <option value="class">Класс (cls_)</option>
                  <option value="process">Процесс-функция (proc_)</option>
                  <option value="component">Компонент (cmp_)</option>
                  <option value="object">Объект (obj_)</option>
                  <option value="idea">Идея-образ (idea_)</option>
                </select>
              </div>

              <div>
                <div className="label mb-1">Название</div>
                <input
                  type="text"
                  placeholder="Например: Зелье лечения"
                  value={newElTitle}
                  onChange={(e) => setNewElTitle(e.target.value)}
                  className="sys-input w-full"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="label mb-1">
                    ID ({TYPE_PREFIXES[newElType]}...)
                  </div>
                  <input
                    type="text"
                    placeholder="healing_potion"
                    value={newElSlug}
                    onChange={(e) => setNewElSlug(e.target.value)}
                    className="sys-input w-full mono"
                  />
                </div>
                <div>
                  <div className="label mb-1">Файл .pgr</div>
                  <select
                    value={newElFile}
                    onChange={(e) => setNewElFile(e.target.value)}
                    className="sys-input w-full mono"
                  >
                    {(files.length > 0 ? files : ['sys_inventory.pgr']).map(
                      (f) => (
                        <option key={f} value={f}>
                          {f}
                        </option>
                      )
                    )}
                  </select>
                </div>
              </div>

              {newElType !== 'system' && (
                <div>
                  <div className="label mb-1">Родитель (parent)</div>
                  <select
                    value={newElParent}
                    onChange={(e) => setNewElParent(e.target.value)}
                    className="sys-input w-full mono"
                  >
                    <option value="-">- (без родителя)</option>
                    {elements
                      .filter((x) => x.type === 'system')
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.id}
                        </option>
                      ))}
                  </select>
                </div>
              )}

              <label className="inline-flex items-center gap-2 cursor-pointer text-xs">
                <input
                  type="checkbox"
                  checked={newElMvp}
                  onChange={(e) => setNewElMvp(e.target.checked)}
                />
                <span>Метка фазы MVP</span>
              </label>
            </div>

            <div className="btn-group">
              <button
                type="button"
                onClick={handleCreateElement}
                className="btn pos flex-1"
              >
                {t.confirmYes}
              </button>
              <button
                type="button"
                onClick={() => setNewElementModalOpen(false)}
                className="btn neg flex-1"
              >
                {t.confirmNo}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;

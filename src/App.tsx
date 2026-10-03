import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  AlertTriangle,
  Activity,
  BarChart2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clipboard,
  Clock,
  Copy,
  CopyPlus,
  Edit2,
  FilePlus,
  FileText,
  Folder,
  FolderPlus,
  Funnel,
  Gauge,
  Link,
  Maximize2,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  RotateCcw,
  Scissors,
  Sparkles,
  Star,
  StarOff,
  Trash2,
  Zap,
} from 'lucide-react';
import {
  AiContradiction,
  AiInterviewQuestion,
  AiProposalCard,
  AiProviderConfig,
  AiProviderType,
  ElementType,
  LocaleKey,
  NegativePaletteKey,
  PlanElement,
  PositivePaletteKey,
  RelationType,
  ThemeMode,
  UnitLibraryItem,
} from './types/planager';
import { NEGATIVE_PALETTES, POSITIVE_PALETTES } from './data/palettes';
import { DEFAULT_GEMINI_MODEL } from './data/aiModels';
import { I18N_DICTIONARY } from './data/translations';
import { useWorkspace } from './hooks/useWorkspace';
import { applyCanvasAutoLayout, computeClusteredGraphPositions, stripElementPrefix } from './hooks/canvasLayout';
import { AiChangeReviewDialog } from './components/AiChangeReviewDialog';
import { KnowledgeAiSidebar } from './components/KnowledgeAiSidebar';
import { ElementAttributesPanel } from './components/ElementAttributesPanel';
import { StructuredElementFields } from './components/StructuredElementFields';
import { AutoGrowTextarea } from './components/AutoGrowTextarea';
import { AppHeader, type PrimaryTab } from './components/AppHeader';
import { ExplorerFileEntry, type KbContextMenuTarget } from './components/ExplorerFileEntry';
import { ELEMENT_TYPE_ICONS } from './components/ElementTypeIcon';
import { NativeGitView } from './components/NativeGitView';
import { Dialog } from './components/ui/Dialog';
import type { AiTransformPattern, AiWorkflowModal } from './components/AiWorkflowDialogs';
import { analyze, applyInterviewAnswer, interview, testProvider, transform } from './services/ai';
import { loadSettings, loadUnitLibrary, saveSettings, saveUnitLibrary, type AppSettings } from './services/settings';
import { useUsageLedger } from './hooks/useUsageLedger';
import { useGitWorkspace } from './hooks/useGitWorkspace';
import { isDesktop, desktopInvoke } from './services/desktop';
import { revealWorkspacePath } from './services/workspace';
import { connectChatGpt, disconnectChatGpt, forgetChatGpt, getChatGptStatus, loadChatGptModels, type ChatGptModel } from './services/chatgptOAuth';
import { cloneElements, deleteElements, moveElementsToFile, renameElementId, renameFileElements } from './hooks/projectOperations';
import { prepareLibraryInsert } from './hooks/libraryOperations';
import {
  buildAndValidateGraph,
  parsePgrFileContent,
  resolveInheritedFieldsForObject,
  serializeFileWithRanges,
  TYPE_HEADERS_RU,
  TYPE_PREFIXES,
} from './utils/pgrCodec';
import {
  inspectGraphSchemaIssues,
} from './utils/aiEngine';
import { localizedText } from './utils/localization';
import { localizePgrParseError } from './utils/pgrErrorLocalization';
import { parseLineRange } from './utils/lineRange';
import { defaultLibraryIcon } from './utils/libraryIcons';
import { getParallelEdgeOffsets, offsetGraphLine } from './utils/graphGeometry';
import { toggleCanvasRelation } from './utils/canvasRelations';
import { interviewAnswersForContext, readSavedInterviewAnswers, saveInterviewAnswer } from './utils/interviewAnswers';

const SettingsView = React.lazy(() => import('./components/SettingsView').then(({ SettingsView: component }) => ({ default: component })));
const CanvasWorkspaceView = React.lazy(() => import('./components/CanvasWorkspaceView').then(({ CanvasWorkspaceView: component }) => ({ default: component })));
const PgrSourceEditor = React.lazy(() => import('./components/PgrSourceEditor').then(({ PgrSourceEditor: component }) => ({ default: component })));
const UnitLibraryView = React.lazy(() => import('./components/UnitLibraryView').then(({ UnitLibraryView: component }) => ({ default: component })));
const LibraryIconPicker = React.lazy(() => import('./components/LibraryIconPicker').then(({ LibraryIconPicker: component }) => ({ default: component })));
const AiWorkflowDialogs = React.lazy(() => import('./components/AiWorkflowDialogs').then(({ AiWorkflowDialogs: component }) => ({ default: component })));

const EMPTY_METADATA_IDS: string[] = [];
const readMetadataIds = (value: unknown): string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? value as string[]
    : EMPTY_METADATA_IDS;
interface KbClipboardItem {
  mode: 'cut' | 'copy';
  type: 'file' | 'folder' | 'element';
  id: string;
  sourceFileName?: string;
}

interface KbContextMenuState {
  x: number;
  y: number;
  target: KbContextMenuTarget;
}

interface RenameModalState {
  isOpen: boolean;
  type: 'file' | 'folder' | 'element';
  id: string;
  sourceFileName?: string;
  currentName: string;
  newName: string;
}

interface NewResourceModalState {
  isOpen: boolean;
  type: 'file' | 'folder';
  parentFolder?: string;
  name: string;
}

export function App() {
  const workspace = useWorkspace();
  const workspaceFlushRef = useRef(workspace.flush);
  const closeGuardRef = useRef(false);

  useEffect(() => { workspaceFlushRef.current = workspace.flush; }, [workspace.flush]);

  useEffect(() => {
    if (!isDesktop()) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void getCurrentWindow().onCloseRequested(async (event) => {
      if (closeGuardRef.current) return;
      event.preventDefault();
      try {
        await workspaceFlushRef.current();
        closeGuardRef.current = true;
        await getCurrentWindow().close();
      } catch (cause) {
        showNotice(`${tx('Не удалось сохранить проект перед закрытием', 'Could not save the project before closing')}: ${cause instanceof Error ? cause.message : String(cause)}`);
      }
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    }).catch((cause) => showNotice(`${tx('Не удалось подключить защиту сохранения', 'Could not enable save protection')}: ${String(cause)}`));
    return () => { disposed = true; unlisten?.(); };
  }, []);
  const {
    files, setFiles, elements, setElements,
    directories: customFolders, setDirectories: setCustomFolders,
    root: projectRoot, setRoot: setProjectRoot,
    metadata: workspaceMetadata, setMetadata: setWorkspaceMetadata,
    renameSourcePath, renameFolderPath, copySourcePath, removeSourcePath,
  } = workspace;
  const updateMetadataIds = (key: string, action: React.SetStateAction<string[]>) => {
    setWorkspaceMetadata((previous) => {
      const current = readMetadataIds(previous[key]);
      const next = typeof action === 'function' ? action(current) : action;
      return { ...previous, [key]: [...next] };
    });
  };
  const starredItems = useMemo(() => new Set(readMetadataIds(workspaceMetadata.favorites)), [workspaceMetadata.favorites]);
  const savedInterviewAnswers = useMemo(
    () => readSavedInterviewAnswers(workspaceMetadata.interviewAnswers),
    [workspaceMetadata.interviewAnswers]
  );
  const setStarredItems: React.Dispatch<React.SetStateAction<Set<string>>> = (action) => {
    updateMetadataIds('favorites', (current) => [...(typeof action === 'function' ? action(new Set(current)) : action)]);
  };
  const projectRootFolder = projectRoot || 'Project';
  const [activeTab, setActiveTab] = useState<PrimaryTab>('kb');
  const [leftPanelOpen, setLeftPanelOpen] = useState<boolean>(true);
  const [rightPanelOpen, setRightPanelOpen] = useState<boolean>(true);

  // Context Menu & Explorer Clipboard & Starred state
  const [kbContextMenu, setKbContextMenu] =
    useState<KbContextMenuState | null>(null);
  const [kbSubmenuOpen, setKbSubmenuOpen] = useState<boolean>(false);
  const [kbClipboard, setKbClipboard] = useState<KbClipboardItem | null>(null);
  const [renameModal, setRenameModal] = useState<RenameModalState | null>(null);
  const [newResourceModal, setNewResourceModal] =
    useState<NewResourceModalState | null>(null);
  const [deleteFileConfirm, setDeleteFileConfirm] = useState<string | null>(
    null
  );
  const [deleteFolderConfirm, setDeleteFolderConfirm] = useState<string | null>(null);

  // Project files & elements (immediately initialized in graph-clustered auto-layout)
  const [collapsedFolders, setCollapsedFolders] = useState<
    Record<string, boolean>
  >({});
  const [collapsedFiles, setCollapsedFiles] = useState<Record<string, boolean>>(
    {}
  );
  const [isCreatingFolder, setIsCreatingFolder] = useState<boolean>(false);
  const [newFolderName, setNewFolderName] = useState<string>('');

  const userPositionedNodeIds = useMemo(() => new Set(readMetadataIds(workspaceMetadata.canvasLockedNodeIds)), [workspaceMetadata.canvasLockedNodeIds]);
  const setUserPositionedNodeIds: React.Dispatch<React.SetStateAction<Set<string>>> = (action) => {
    updateMetadataIds('canvasLockedNodeIds', (current) => [...(typeof action === 'function' ? action(new Set(current)) : action)]);
  };
  const userPositionedNodeIdsRef = useRef<Set<string>>(userPositionedNodeIds);
  userPositionedNodeIdsRef.current = userPositionedNodeIds;
  const [activeFile, setActiveFile] = useState<string>('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(selectedId);
  selectedIdRef.current = selectedId;

  // Knowledge Base Editor state
  const [kbEditorMode, setKbEditorMode] = useState<'structured' | 'raw_pgr'>(
    'structured'
  );
  const [cursorLine, setCursorLine] = useState<number>(13);
  const [lineRangeFilter, setLineRangeFilter] = useState<{
    fileName: string;
    start: number;
    end: number;
  } | null>(null);
  const [rangeStartInput, setRangeStartInput] = useState<string>('1');
  const [rangeEndInput, setRangeEndInput] = useState<string>('24');

  // Search & filter state
  const [kbSearch, setKbSearch] = useState<string>('');
  const [kbTypeFilter, setKbTypeFilter] = useState<ElementType | 'all'>('all');
  const [kbMvpFilter, setKbMvpFilter] = useState<'all' | 'mvp' | 'later'>('all');
  const [isKbFilterOpen, setIsKbFilterOpen] = useState<boolean>(false);
  const filterPopoverRef = useRef<HTMLDivElement>(null);

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
  const dragStartSnapshotRef = useRef<Record<
    string,
    { x: number; y: number }
  > | null>(null);
  const draggingNodeIdRef = useRef<string | null>(null);
  const canvasMouseDownInfoRef = useRef<{
    nodeId: string;
    fileName: string;
    clientX: number;
    clientY: number;
    wasCtrl: boolean;
    wasAlreadyInMulti: boolean;
    didMove: boolean;
  } | null>(null);
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
    const startSnap = dragStartSnapshotRef.current;
    if (startSnap) {
      const movedIds: string[] = [];
      elementsRef.current.forEach((el) => {
        const sp = startSnap[el.id];
        if (sp && (sp.x !== el.position.x || sp.y !== el.position.y)) {
          movedIds.push(el.id);
        }
      });
      if (movedIds.length > 0) {
        const prevLocked = Array.from(userPositionedNodeIdsRef.current);
        // Preserve all current element positions once the user manually adjusts layout on the Canvas
        const nextLocked = new Set<string>(
          elementsRef.current.map((el) => el.id)
        );
        userPositionedNodeIdsRef.current = nextLocked;
        setUserPositionedNodeIds(nextLocked);
      }
    }
    dragStartSnapshotRef.current = null;
    draggingNodeIdRef.current = null;
  };

  // Global mouseup/blur safety so dragged nodes on Canvas never stick to cursor
  useEffect(() => {
    const handleGlobalMouseUp = () => {
      if (radialMenuRef.current) {
        const chosen = radialMenuRef.current.hoveredId;
        const targetId = radialMenuRef.current.targetElementId;
        setRadialMenu(null);
        if (chosen) {
          executeRadialAiActionRef.current(chosen, targetId);
        }
      }
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

  // Close KB filter popup on outside click or Escape
  useEffect(() => {
    if (!isKbFilterOpen) return;
    const handleDown = (e: MouseEvent) => {
      if (
        filterPopoverRef.current &&
        !filterPopoverRef.current.contains(e.target as Node)
      ) {
        setIsKbFilterOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsKbFilterOpen(false);
      }
    };
    document.addEventListener('mousedown', handleDown);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleDown);
      document.removeEventListener('keydown', handleKey);
    };
  }, [isKbFilterOpen]);

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

  // Project-wide undo/redo uses the same snapshots for edits from every view.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isZ =
        e.code === 'KeyZ' ||
        e.key.toLowerCase() === 'z' ||
        e.key.toLowerCase() === 'я';
      const isY = e.code === 'KeyY' || e.key.toLowerCase() === 'y' || e.key.toLowerCase() === 'н';
      const projectEditor = !!target?.closest('[data-project-editor="true"]');
      if (target && !projectEditor && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
      const redoRequested = (isZ && e.shiftKey) || isY;
      if ((e.ctrlKey || e.metaKey) && ((isZ && (!e.shiftKey || projectEditor)) || (isY && !projectEditor))) {
        if (redoRequested ? !workspace.canRedo : !workspace.canUndo) return;
        e.preventDefault();
        if (isZ && e.shiftKey) workspace.redo();
        else if (isY) workspace.redo();
        else workspace.undo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [workspace.canUndo, workspace.canRedo, workspace.undo, workspace.redo]);

  // Unit Library state
  const [unitLibrary, setUnitLibrary] = useState<UnitLibraryItem[]>([]);
  const [libCategoryFilter, setLibCategoryFilter] = useState<
    'all' | ElementType
  >('all');
  const [libSearch, setLibSearch] = useState<string>('');
  const [librarySaveQueue, setLibrarySaveQueue] = useState<PlanElement[]>([]);
  const [libraryIconDraft, setLibraryIconDraft] = useState('blocks');

  // Settings state (Default 'dark' for Variation 5 System Dark)
  const [themeMode, setThemeMode] = useState<ThemeMode>('dark');
  const [posPalette, setPosPalette] = useState<PositivePaletteKey>('emerald');
  const [negPalette, setNegPalette] = useState<NegativePaletteKey>('crimson');
  const [aiEndpoint, setAiEndpoint] = useState<string>('');
  const [aiProvider, setAiProvider] = useState<AiProviderType>('gemini');
  const [aiModel, setAiModel] = useState<string>(DEFAULT_GEMINI_MODEL);
  const [providerApiKeys, setProviderApiKeys] = useState({ gemini: false, custom: false });
  const hasAiApiKey = aiProvider === 'gemini' ? providerApiKeys.gemini : aiProvider === 'custom' ? providerApiKeys.custom : false;
  const [chatgptConnected, setChatgptConnected] = useState(false);
  const [chatgptEmail, setChatgptEmail] = useState<string | undefined>();
  const [chatgptModels, setChatgptModels] = useState<ChatGptModel[]>([]);
  const providerCredentialAvailable = aiProvider === 'chatgpt' ? chatgptConnected : hasAiApiKey;
  const [aiEnabled, setAiEnabled] = useState<boolean>(false);
  const [aiApiKey, setAiApiKey] = useState<string>('');
  const [aiLimits, setAiLimits] = useState<{
    rpm: number;
    rpd: number;
    tpm: number;
    tt: number;
  }>({ rpm: 0, rpd: 0, tpm: 0, tt: 0 });

  const handleResetTotalTokens = async () => {
    await usage.resetTotal();
  };

  const handleSimulateAiRequest = async () => {
    await usage.simulate();
  };
  const [gitEnabled, setGitEnabled] = useState<boolean>(true);
  const [locale, setLocale] = useState<LocaleKey>('ru');
  const [activeSettingsSection, setActiveSettingsSection] =
    useState<string>('theme');
  const [libraryReady, setLibraryReady] = useState(false);

  // AI Assistant state & separate modals
  const [aiActiveModal, setAiActiveModal] = useState<AiWorkflowModal>(null);
  const [transformSourceId, setTransformSourceId] =
    useState<string>('idea_backlog');
  const [transformPattern, setTransformPattern] = useState<AiTransformPattern>('system_pack');
  const [transformSummary, setTransformSummary] = useState<string | null>(null);
  const [pendingAiReview, setPendingAiReview] = useState<
    | { kind: 'transform'; summary: string; createdElements: PlanElement[] }
    | { kind: 'patch'; summary: string; targetId: string; patch: Partial<PlanElement>; before: PlanElement }
    | null
  >(null);
  type RadialOptionId =
    | 'conflicts'
    | 'proposals'
    | 'interview'
    | 'rescan'
    | 'node_transform'
    | 'node_open_kb'
    | 'node_save_lib'
    | 'node_delete';

  const [radialMenu, setRadialMenu] = useState<{
    mode: 'canvas' | 'node';
    targetElementId?: string;
    centerX: number;
    centerY: number;
    cursorX: number;
    cursorY: number;
    hoveredId: RadialOptionId | null;
  } | null>(null);
  const radialMenuRef = useRef<typeof radialMenu>(null);
  radialMenuRef.current = radialMenu;
  const [aiContextIds, setAiContextIds] = useState<string[]>([]);
  const aiContextIdsRef = useRef<string[]>(aiContextIds);
  aiContextIdsRef.current = aiContextIds;
  const [kbDraggedIds, setKbDraggedIds] = useState<string[]>([]);
  const kbDraggedIdsRef = useRef<string[]>([]);
  const [dragOverFileName, setDragOverFileName] = useState<string | null>(null);

  // Unified selection helper: normal LMB selects single element, Ctrl/Cmd + LMB toggles multi-selection (which serves as AI context)
  const handleSelectWithModifiers = (
    id: string,
    isMultiToggle: boolean,
    fileName?: string
  ) => {
    if (
      document.activeElement instanceof HTMLElement &&
      (document.activeElement.tagName === 'INPUT' ||
        document.activeElement.tagName === 'TEXTAREA' ||
        document.activeElement.tagName === 'SELECT')
    ) {
      document.activeElement.blur();
    }
    if (isMultiToggle) {
      const base =
        aiContextIdsRef.current.length > 0
          ? aiContextIdsRef.current
          : selectedIdRef.current
          ? [selectedIdRef.current]
          : [];
      const exists = base.includes(id);
      const next = exists ? base.filter((x) => x !== id) : [...base, id];
      aiContextIdsRef.current = next;
      setAiContextIds(next);
      if (exists) {
        if (selectedIdRef.current === id) {
          const nextSel = next[next.length - 1] || null;
          selectedIdRef.current = nextSel;
          setSelectedId(nextSel);
        }
      } else {
        selectedIdRef.current = id;
        setSelectedId(id);
        if (fileName) setActiveFile(fileName);
      }
    } else {
      selectedIdRef.current = id;
      setSelectedId(id);
      aiContextIdsRef.current = [id];
      setAiContextIds([id]);
      if (fileName) setActiveFile(fileName);
    }
  };
  const [proposals, setProposals] = useState<AiProposalCard[]>([]);
  const [contradictions, setContradictions] = useState<AiContradiction[]>([]);
  const ignoredContradictionIds = useMemo(() => readMetadataIds(workspaceMetadata.ignoredContradictionIds), [workspaceMetadata.ignoredContradictionIds]);
  const setIgnoredContradictionIds: React.Dispatch<React.SetStateAction<string[]>> = (action) => updateMetadataIds('ignoredContradictionIds', action);
  const rejectedContradictionIds = useMemo(() => readMetadataIds(workspaceMetadata.rejectedContradictionIds), [workspaceMetadata.rejectedContradictionIds]);
  const setRejectedContradictionIds: React.Dispatch<React.SetStateAction<string[]>> = (action) => updateMetadataIds('rejectedContradictionIds', action);
  const [showCanvasConflictOverlay, setShowCanvasConflictOverlay] =
    useState<boolean>(true);
  const [canvasConflictFilter, setCanvasConflictFilter] =
    useState<string>('all');
  const [activeConflictPopup, setActiveConflictPopup] = useState<{
    contradictions: AiContradiction[];
    activeIndex: number;
    triggerElementId?: string;
  } | null>(null);
  const [conflictFormTitle, setConflictFormTitle] = useState<string>('');
  const [conflictFormDesc, setConflictFormDesc] = useState<string>('');
  const [conflictFormFix, setConflictFormFix] = useState<string>('');
  const [conflictFormComment, setConflictFormComment] = useState<string>('');
  const canvasNodeDownClientRef = useRef<{ x: number; y: number }>({
    x: 0,
    y: 0,
  });
  const [interviewQuestions, setInterviewQuestions] = useState<
    AiInterviewQuestion[]
  >([]);
  const [interviewAnswerDrafts, setInterviewAnswerDrafts] = useState<Record<string, string>>({});
  const [rejectProposalModal, setRejectProposalModal] =
    useState<AiProposalCard | null>(null);
  const [rejectReasonInput, setRejectReasonInput] = useState<string>('');

  // Creation / deletion modals
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [newElementModalOpen, setNewElementModalOpen] = useState<boolean>(false);
  const [newElType, setNewElType] = useState<ElementType>('class');
  const [newElTitle, setNewElTitle] = useState<string>('');
  const [newElSlug, setNewElSlug] = useState<string>('');
  const [newElFile, setNewElFile] = useState<string>('');
  const [newElParent, setNewElParent] = useState<string>('-');
  const [newElMvp, setNewElMvp] = useState<boolean>(true);

  const openNewElementModal = (targetFile?: string) => {
    setNewElParent('-');
    setNewElTitle('');
    setNewElSlug('');
    setNewElFile(targetFile || activeFile || files[0] || 'sys_core.pgr');
    setNewElementModalOpen(true);
  };


  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  const t = I18N_DICTIONARY[locale];
  const tx = (ru: string, en: string) => localizedText(locale, ru, en);
  const git = useGitWorkspace({
    enabled: gitEnabled,
    locale,
    workspaceReady: workspace.workspaceReady,
    workspacePreview: workspace.preview,
    workspaceSaving: workspace.saving,
    workspaceRevision: workspace.revision,
    activeTab,
    activeSettingsSection,
  });
  const usage = useUsageLedger((cause) =>
    setStatusNotice(`${tx('История использования недоступна', 'Usage history is unavailable')}: ${cause instanceof Error ? cause.message : String(cause)}`)
  );

  useEffect(() => {
    let active = true;
    loadSettings().then((settings: AppSettings) => {
      if (!active) return;
      setThemeMode(settings.themeMode);
      setPosPalette(settings.positivePalette);
      setNegPalette(settings.negativePalette);
      setLocale(settings.locale);
      setGitEnabled(settings.gitEnabled);
      setAiProvider(settings.aiProvider.provider);
      setAiModel(settings.aiProvider.provider === 'gemini' ? settings.aiProvider.geminiModel : settings.aiProvider.customModel);
      if (settings.aiProvider.provider === 'chatgpt' && settings.aiProvider.chatgptModel) setAiModel(settings.aiProvider.chatgptModel);
      setAiEndpoint(settings.aiProvider.customEndpoint);
      setProviderApiKeys(settings.apiKeyStatus);
      setAiEnabled(settings.hasKey);
      setAiLimits({ rpm: settings.rateLimits.rpm, rpd: settings.rateLimits.rpd, tpm: settings.rateLimits.tpm, tt: settings.rateLimits.totalTokens });
    }).catch((cause: unknown) => {
      if (active) setStatusNotice(`${tx('Настройки не загружены', 'Settings failed to load')}: ${cause instanceof Error ? cause.message : String(cause)}`);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (aiProvider !== 'chatgpt' || !chatgptConnected || chatgptModels.length === 0) return;
    if (!chatgptModels.some((model) => model.slug === aiModel)) setAiModel(chatgptModels[0].slug);
  }, [aiProvider, chatgptConnected, chatgptModels, aiModel]);

  useEffect(() => {
    if (!isDesktop()) return;
    let active = true;
    getChatGptStatus().then(async (account) => {
      if (!active) return;
      setChatgptConnected(account.connected);
      setChatgptEmail(account.email);
      if (!account.connected) return;
      const result = await loadChatGptModels();
      if (!active) return;
      setChatgptModels(result.models);
      const saved = await loadSettings();
      if (active && saved.aiProvider.provider === 'chatgpt') {
        if (!result.models.some((model) => model.slug === saved.aiProvider.chatgptModel)) setAiModel(result.models[0]?.slug || '');
        setAiEnabled(true);
      }
    }).catch((cause: unknown) => {
      if (active) setStatusNotice(`${tx('Список моделей ChatGPT недоступен', 'ChatGPT models are unavailable')}: ${cause instanceof Error ? cause.message : String(cause)}`);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    loadUnitLibrary().then((items) => {
      if (active) {
        setUnitLibrary(items);
        setLibraryReady(true);
      }
    }).catch((cause: unknown) => {
      if (active) setStatusNotice(`${tx('Библиотека не загружена', 'Library failed to load')}: ${cause instanceof Error ? cause.message : String(cause)}`);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!libraryReady) return;
    const timer = window.setTimeout(() => {
      saveUnitLibrary(unitLibrary).catch((cause: unknown) =>
        setStatusNotice(`${tx('Библиотека не сохранена', 'Library failed to save')}: ${cause instanceof Error ? cause.message : String(cause)}`)
      );
    }, 400);
    return () => window.clearTimeout(timer);
  }, [libraryReady, unitLibrary]);

  const aiConfig = useMemo(() => ({
    provider: aiProvider,
    geminiModel: (aiProvider === 'gemini' ? aiModel : DEFAULT_GEMINI_MODEL) as AiProviderConfig['geminiModel'],
    customEndpoint: aiEndpoint,
    customModel: aiProvider === 'custom' ? aiModel : '',
    chatgptModel: aiProvider === 'chatgpt' ? aiModel : '',
  }), [aiProvider, aiEndpoint, aiModel]);

  const handleChatgptConnect = async () => {
    const account = await connectChatGpt();
    setChatgptConnected(account.connected);
    setChatgptEmail(account.email);
    const result = await loadChatGptModels();
    setChatgptModels(result.models);
    const selected = result.models.some((model) => model.slug === aiModel) ? aiModel : result.models[0]?.slug || '';
    setAiProvider('chatgpt');
    setAiModel(selected);
    setAiEnabled(true);
    showNotice(tx('ChatGPT подключён', 'ChatGPT connected'));
  };

  const handleChatgptDisconnect = async () => {
    const result = await disconnectChatGpt();
    setChatgptConnected(false);
    setChatgptEmail(undefined);
    setChatgptModels([]);
    if (aiProvider === 'chatgpt') setAiEnabled(false);
    showNotice(result.warning || tx('ChatGPT отключён', 'ChatGPT disconnected'));
  };

  const handleChatgptSwitchAccount = async () => {
    const result = await forgetChatGpt();
    setChatgptConnected(false);
    setChatgptEmail(undefined);
    setChatgptModels([]);
    if (aiProvider === 'chatgpt' && !hasAiApiKey) setAiEnabled(false);
    showNotice(result.warning || tx('Локальная связь удалена. Теперь войдите в другой аккаунт.', 'Local account link removed. Sign in with another account now.'));
  };

  const handleChatgptRefreshModels = async () => {
    const result = await loadChatGptModels();
    setChatgptModels(result.models);
    if (!result.models.some((model) => model.slug === aiModel)) setAiModel(result.models[0]?.slug || '');
  };

  const handleSaveSettings = async (secret?: string) => {
    try {
      const result = await saveSettings({
        themeMode, positivePalette: posPalette, negativePalette: negPalette, locale,
        gitEnabled, aiProvider: aiConfig,
        rateLimits: { rpm: aiLimits.rpm, rpd: aiLimits.rpd, tpm: aiLimits.tpm, totalTokens: aiLimits.tt },
      }, secret);
      setProviderApiKeys(result.apiKeyStatus);
      setAiEnabled(aiProvider === 'chatgpt' ? chatgptConnected : result.hasKey);
      showNotice(tx('Настройки сохранены', 'Settings saved'));
    } catch (cause) {
      throw cause;
    }
  };

  const handleProviderChange = (provider: AiProviderType) => {
    setAiProvider(provider);
    setAiEnabled(provider === 'chatgpt'
      ? chatgptConnected
      : provider === 'gemini'
        ? providerApiKeys.gemini
        : providerApiKeys.custom);
  };

  const testSavedProvider = async () => {
    const response = await testProvider(locale);
    await usage.refresh();
    if (!response.ok) throw new Error(`${tx('Подключение не подтверждено', 'Connection was not confirmed')}: ${response.providerUsed || aiProvider} / ${response.modelUsed || aiModel}`);
  };

  useEffect(() => {
    if (!workspace.loaded || files.length === 0 || files.includes(activeFile)) return;
    setActiveFile(files[0]);
    setSelectedId(null);
  }, [workspace.loaded, files, activeFile]);

  const showNotice = (msg: string) => {
    setStatusNotice(msg);
    setTimeout(() => {
      setStatusNotice((prev) => (prev === msg ? null : prev));
    }, 3000);
  };

  const checkoutGitBranch = async (branch: string) => {
    try {
      await workspace.runWorkspaceOperation(async ({ reload }) => {
        await desktopInvoke('git_checkout', { branch });
        await reload();
        await git.refreshStatus();
      });
      showNotice(`${tx('Переключено на', 'Switched to')} ${branch}`);
    } catch (cause) { git.setError(cause instanceof Error ? cause.message : String(cause)); }
  };

  const runAiAnalysis = async () => {
    if (!aiEnabled || !providerCredentialAvailable) {
      showNotice(tx('Настройте провайдера для AI-предложений. Локальные проверки схемы остаются доступны на холсте.', 'Configure a provider for AI suggestions. Local schema checks remain available on the canvas.'));
      setActiveTab('settings');
      setActiveSettingsSection('ai');
      return;
    }
    try {
      const result = await analyze({ elements, selectedIds: aiContextIds, files, config: aiConfig, locale });
      setProposals(result.proposals);
      setContradictions(result.contradictions.filter((item) => !ignoredContradictionIds.includes(item.id) && !rejectedContradictionIds.includes(item.id)));
      await usage.refresh();
      showNotice(`${tx('Проверка завершена', 'Review complete')}: ${result.contradictions.length} ${tx('противоречий', 'contradictions')}, ${result.proposals.length} ${tx('предложений', 'proposals')} · ${result.providerUsed}/${result.modelUsed}`);
    } catch (cause) {
      showNotice(`${tx('Анализ не выполнен', 'Analysis failed')}: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  };

  const runProblemInterview = async () => {
    if (!aiEnabled || !providerCredentialAvailable) {
      showNotice(tx('Сначала настройте провайдера и сохраните API key.', 'Configure a provider and save the API key first.'));
      setActiveTab('settings');
      setActiveSettingsSection('ai');
      return;
    }
    try {
      const answers = interviewAnswersForContext(workspaceMetadata.interviewAnswers, aiContextIds);
      const result = await interview({ elements, selectedIds: aiContextIds, files, answers, config: aiConfig, locale });
      setInterviewQuestions(result.questions);
      await usage.refresh();
      showNotice(`${tx('Получено вопросов', 'Questions received')}: ${result.questions.length}`);
    } catch (cause) {
      showNotice(`${tx('Интервью не выполнено', 'Interview failed')}: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  };

  const runTransformation = async (source: PlanElement, pattern: 'system_pack' | 'class_hierarchy' | 'process_chain') => {
    if (!aiEnabled || !providerCredentialAvailable) {
      showNotice(tx('Сначала настройте провайдера и сохраните API key.', 'Configure a provider and save the API key first.'));
      setActiveTab('settings');
      setActiveSettingsSection('ai');
      return;
    }
    try {
      const result = await transform({ sourceElement: source, targetPattern: pattern, existingElements: elements, config: aiConfig, locale });
      const ids = new Set(elements.map((element) => element.id));
      if (result.createdElements.some((element) => ids.has(element.id))) throw new Error('Transform result contains an existing element ID');
      setTransformSummary(result.summary);
      setPendingAiReview({ kind: 'transform', summary: result.summary, createdElements: result.createdElements });
      await usage.refresh();
      showNotice(result.summary);
    } catch (cause) {
      showNotice(`${tx('Преобразование не выполнено', 'Transformation failed')}: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  };

  const submitInterviewAnswer = async (question: AiInterviewQuestion, answer: string) => {
    setWorkspaceMetadata((previous) => ({
      ...previous,
      interviewAnswers: saveInterviewAnswer(previous.interviewAnswers, question, answer),
    }));
    const target = elements.find((element) => element.id === question.targetElementId);
    if (!target) {
      showNotice(tx('Ответ сохранён; вопрос не связан с конкретным элементом.', 'Answer saved; the question is not linked to a specific element.'));
      return;
    }
    try {
      const result = await applyInterviewAnswer({ targetElement: target, question: question.question, answer, config: aiConfig, existingElements: elements, locale });
      const { id: _id, type: _type, fileName: _fileName, position: _position, ...patch } = result.updatedElement;
      setPendingAiReview({ kind: 'patch', summary: result.summary, targetId: target.id, patch, before: target });
    } catch (cause) {
      showNotice(`${tx('Ответ сохранён, но AI patch не применён', 'Answer saved, but the AI patch was not applied')}: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  };

  const applyPendingAiReview = () => {
    if (!pendingAiReview) return;
    if (pendingAiReview.kind === 'transform') {
      const ids = new Set(elements.map((element) => element.id));
      if (pendingAiReview.createdElements.some((element) => ids.has(element.id))) {
        showNotice(tx('Проект изменился: ID элемента уже существует. Изменения ИИ не применены.', 'The project changed: an element ID now exists. AI changes were not applied.'));
        setPendingAiReview(null);
        return;
      }
      const graph = buildAndValidateGraph([...elements, ...pendingAiReview.createdElements]);
      const newIds = new Set(pendingAiReview.createdElements.map((element) => element.id));
      const invalidNewElement = graph.warnings.some((warning) => newIds.has(warning.elementId)) ||
        graph.edges.some((edge) => newIds.has(edge.source) && !edge.valid);
      if (invalidNewElement) {
        showNotice(tx('Предложенные связи больше невалидны. Изменения ИИ не применены.', 'The proposed references are no longer valid. AI changes were not applied.'));
        setPendingAiReview(null);
        return;
      }
      setElements((current) => [...current, ...pendingAiReview.createdElements]);
    } else {
      const current = elements.find((element) => element.id === pendingAiReview.targetId);
      if (!current) {
        showNotice(tx('Целевой элемент удалён. Изменения ИИ не применены.', 'The target element was deleted. AI changes were not applied.'));
        setPendingAiReview(null);
        return;
      }
      const changedFields = (Object.keys(pendingAiReview.patch) as (keyof PlanElement)[])
        .filter((field) => JSON.stringify(current[field]) !== JSON.stringify(pendingAiReview.before[field]));
      if (changedFields.length > 0) {
        showNotice(tx('Элемент изменился после ответа ИИ. Обновите анализ и проверьте новое предложение.', 'The element changed after the AI response. Refresh the analysis and review the updated proposal.'));
        setPendingAiReview(null);
        return;
      }
      const updated = { ...current, ...pendingAiReview.patch };
      const graph = buildAndValidateGraph(elements.map((element) => element.id === current.id ? updated : element));
      const invalidPatch = graph.warnings.some((warning) => warning.elementId === updated.id) ||
        graph.edges.some((edge) => edge.source === updated.id && !edge.valid);
      if (invalidPatch) {
        showNotice(tx('Связи изменились и patch больше невалиден. Изменения ИИ не применены.', 'References changed and the patch is no longer valid. AI changes were not applied.'));
        setPendingAiReview(null);
        return;
      }
      setElements((currentElements) => currentElements.map((element) => element.id === updated.id ? updated : element));
    }
    showNotice(pendingAiReview.summary);
    setPendingAiReview(null);
  };

  // Context Menu Handlers
  const handleOpenContextMenu = (
    e: React.MouseEvent,
    target: KbContextMenuTarget
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setKbSubmenuOpen(false);
    const menuWidth = 240;
    const menuHeight = target.type === 'empty' ? 180 : 420;
    const x = Math.min(e.clientX, window.innerWidth - menuWidth - 10);
    const y = Math.min(e.clientY, window.innerHeight - menuHeight - 10);
    setKbContextMenu({
      x: Math.max(10, x),
      y: Math.max(10, y),
      target,
    });
  };

  const isItemStarred = (target: KbContextMenuTarget) => {
    if (target.type === 'file') return starredItems.has(target.fileName);
    if (target.type === 'element') return starredItems.has(target.elementId);
    if (target.type === 'folder') return starredItems.has(target.folderName);
    return false;
  };

  const handleToggleImportant = (target: KbContextMenuTarget) => {
    const id =
      target.type === 'file'
        ? target.fileName
        : target.type === 'element'
        ? target.elementId
        : target.type === 'folder'
        ? target.folderName
        : null;
    if (!id) return;
    setStarredItems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        showNotice(`${tx('Снята отметка', 'Bookmark removed')}: ${id}`);
      } else {
        next.add(id);
        showNotice(`${tx('Отмечено как важное', 'Marked as important')}: ${id}`);
      }
      return next;
    });
  };

  const handleCollapseAll = () => {
    const nextFiles: Record<string, boolean> = {};
    files.forEach((f) => {
      nextFiles[f] = true;
    });
    const nextFolders: Record<string, boolean> = {};
    customFolders.forEach((f) => {
      nextFolders[f] = true;
    });
    setCollapsedFolders(nextFolders);
    setCollapsedFiles(nextFiles);
    showNotice(tx('Все подпапки и файлы свернуты', 'All subfolders and files collapsed'));
  };

  const handleExpandAll = () => {
    setCollapsedFolders({});
    setCollapsedFiles({});
    showNotice(tx('Все папки и файлы развернуты', 'All folders and files expanded'));
  };

  const handleOpenNewResource = (
    type: 'file' | 'folder',
    parentFolder?: string
  ) => {
    setNewResourceModal({
      isOpen: true,
      type,
      parentFolder,
      name: '',
    });
  };

  const handleCreateResourceConfirm = () => {
    if (!newResourceModal) return;
    const raw = newResourceModal.name.trim();
    if (!raw) {
      setNewResourceModal(null);
      return;
    }
    if (newResourceModal.type === 'folder') {
      const folderSlug = raw.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
      if (!customFolders.includes(folderSlug)) {
        setCustomFolders((prev) => [...prev, folderSlug]);
      }
      const initialFile = `${folderSlug}/sys_${folderSlug}_1.pgr`;
      if (!files.includes(initialFile)) {
        setFiles((prev) => [...prev, initialFile]);
        setActiveFile(initialFile);
      }
      showNotice(`${tx('Создана папка', 'Folder created')} ${folderSlug}/`);
    } else {
      let fileName = raw;
      if (!fileName.endsWith('.pgr')) fileName += '.pgr';
      if (newResourceModal.parentFolder && !fileName.includes('/')) {
        fileName = `${newResourceModal.parentFolder}/${fileName}`;
      }
      if (!files.includes(fileName)) {
        setFiles((prev) => [...prev, fileName]);
        setActiveFile(fileName);
        showNotice(`${tx('Создан файл', 'File created')} ${fileName}`);
      } else {
        showNotice(`${tx('Файл', 'File')} ${fileName} ${tx('уже существует', 'already exists')}`);
      }
    }
    setNewResourceModal(null);
  };

  const handleStartRename = (target: KbContextMenuTarget) => {
    if (target.type === 'file') {
      const cur = target.fileName.includes('/')
        ? target.fileName.split('/').slice(1).join('/')
        : target.fileName;
      setRenameModal({
        isOpen: true,
        type: 'file',
        id: target.fileName,
        currentName: target.fileName,
        newName: cur,
      });
    } else if (target.type === 'folder') {
      setRenameModal({ isOpen: true, type: 'folder', id: target.folderName, currentName: target.folderName, newName: target.folderName });
    } else if (target.type === 'element') {
      setRenameModal({
        isOpen: true,
        type: 'element',
        id: target.elementId,
        sourceFileName: target.fileName,
        currentName: target.elementId,
        newName: target.elementId,
      });
    }
  };

  const applyElementIdRename = (oldId: string, newId: string): boolean => {
    if (oldId === newId) return true;
    let renamed: PlanElement[];
    try {
      renamed = renameElementId(elements, oldId, newId);
    } catch (cause) {
      showNotice(cause instanceof Error ? cause.message : String(cause));
      return false;
    }

    setElements(renamed);
    if (selectedId === oldId) setSelectedId(newId);
    setAiContextIds((previous) => previous.map((id) => (id === oldId ? newId : id)));
    setStarredItems((previous) => {
      if (!previous.has(oldId)) return previous;
      const next = new Set(previous);
      next.delete(oldId);
      next.add(newId);
      return next;
    });
    showNotice(`${tx('Элемент переименован', 'Element renamed')}: ${oldId} -> ${newId}`);
    return true;
  };

  const handleConfirmRename = () => {
    if (!renameModal) return;
    const raw = renameModal.newName.trim();
    if (!raw) {
      setRenameModal(null);
      return;
    }
    if (renameModal.type === 'file') {
      let finalName = raw;
      if (!finalName.endsWith('.pgr')) finalName += '.pgr';
      if (renameModal.id.includes('/') && !finalName.includes('/')) {
        const folder = renameModal.id.split('/')[0];
        finalName = `${folder}/${finalName}`;
      }
      const oldName = renameModal.id;
      if (oldName === finalName) {
        setRenameModal(null);
        return;
      }
      if (files.includes(finalName)) { showNotice(`${tx('Файл', 'File')} ${finalName} ${tx('уже существует', 'already exists')}`); return; }
      renameSourcePath(oldName, finalName);
      setElements((prev) => renameFileElements(prev, oldName, finalName));
      if (activeFile === oldName) setActiveFile(finalName);
      setStarredItems((prev) => {
        if (!prev.has(oldName)) return prev;
        const next = new Set(prev);
        next.delete(oldName);
        next.add(finalName);
        return next;
      });
      showNotice(`${tx('Файл переименован', 'File renamed')}: ${oldName} -> ${finalName}`);
    } else if (renameModal.type === 'folder') {
      const oldName = renameModal.id;
      const finalName = raw.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
      if (oldName === finalName) { setRenameModal(null); return; }
      if (customFolders.includes(finalName)) { showNotice(`${tx('Папка', 'Folder')} ${finalName} ${tx('уже существует', 'already exists')}`); return; }
      renameFolderPath(oldName, finalName);
      setElements((previous) => previous.map((element) => element.fileName.startsWith(`${oldName}/`) ? { ...element, fileName: `${finalName}${element.fileName.slice(oldName.length)}` } : element));
      if (activeFile.startsWith(`${oldName}/`)) setActiveFile(`${finalName}${activeFile.slice(oldName.length)}`);
      setStarredItems((previous) => new Set([...previous].map((item) => item === oldName || item.startsWith(`${oldName}/`) ? `${finalName}${item.slice(oldName.length)}` : item)));
      showNotice(`${tx('Папка переименована', 'Folder renamed')}: ${oldName} -> ${finalName}`);
    } else if (renameModal.type === 'element') {
      const oldId = renameModal.id;
      const newId = raw.replace(/[^a-zA-Z0-9_-]/g, '_');
      if (!applyElementIdRename(oldId, newId)) return;
    }
    setRenameModal(null);
  };

  const handleDeleteFile = (fileName: string) => {
    if (files.length <= 1) {
    showNotice(tx('Нельзя удалить единственный файл проекта', 'The only project file cannot be deleted'));
      return;
    }
    setDeleteFileConfirm(fileName);
  };

  const handleConfirmDeleteFile = () => {
    if (!deleteFileConfirm) return;
    const targetFile = deleteFileConfirm;
    removeSourcePath(targetFile);
    setElements((prev) => deleteElements(prev, prev.filter((el) => el.fileName === targetFile).map((el) => el.id)));
    if (activeFile === targetFile) {
      const remaining = files.filter((f) => f !== targetFile);
      setActiveFile(remaining[0] || '');
      setSelectedId(null);
    }
    showNotice(`${tx('Файл', 'File')} ${targetFile} ${tx('удалён', 'deleted')}`);
    setDeleteFileConfirm(null);
  };

  const handleCut = (target: KbContextMenuTarget) => {
    if (target.type === 'file') {
      setKbClipboard({ mode: 'cut', type: 'file', id: target.fileName });
      showNotice(`${tx('Вырезан файл', 'File cut')}: ${target.fileName}`);
    } else if (target.type === 'element') {
      setKbClipboard({
        mode: 'cut',
        type: 'element',
        id: target.elementId,
        sourceFileName: target.fileName,
      });
      showNotice(`${tx('Вырезан элемент', 'Element cut')}: ${target.elementId}`);
    } else if (target.type === 'folder') {
      setKbClipboard({ mode: 'cut', type: 'folder', id: target.folderName });
      showNotice(`${tx('Вырезана папка', 'Folder cut')}: ${target.folderName}`);
    }
  };

  const handleCopy = (target: KbContextMenuTarget) => {
    if (target.type === 'file') {
      setKbClipboard({ mode: 'copy', type: 'file', id: target.fileName });
      showNotice(`${tx('Скопирован файл', 'File copied')}: ${target.fileName}`);
    } else if (target.type === 'element') {
      setKbClipboard({
        mode: 'copy',
        type: 'element',
        id: target.elementId,
        sourceFileName: target.fileName,
      });
      showNotice(`${tx('Скопирован элемент', 'Element copied')}: ${target.elementId}`);
    } else if (target.type === 'folder') {
      setKbClipboard({ mode: 'copy', type: 'folder', id: target.folderName });
      showNotice(`${tx('Скопирована папка', 'Folder copied')}: ${target.folderName}`);
    }
  };

  const handlePaste = (target: KbContextMenuTarget) => {
    if (!kbClipboard) return;
    const targetFile =
      target.type === 'file'
        ? target.fileName
        : target.type === 'element'
        ? target.fileName
        : activeFile;

    if (kbClipboard.type === 'element') {
      const sourceEl = elements.find((e) => e.id === kbClipboard.id);
      if (!sourceEl) {
        showNotice(tx('Исходный элемент не найден', 'Source element was not found'));
        return;
      }
      if (kbClipboard.mode === 'cut') {
        if (sourceEl.fileName === targetFile) {
          showNotice(`${tx('Элемент уже находится в файле', 'Element is already in file')} ${targetFile}`);
          return;
        }
        setElements((prev) => moveElementsToFile(prev, [sourceEl.id], targetFile));
        setActiveFile(targetFile);
        setSelectedId(sourceEl.id);
        setAiContextIds([sourceEl.id]);
        setKbClipboard(null);
        showNotice(`${tx('Элемент', 'Element')} ${sourceEl.id} ${tx('перемещён в', 'moved to')} ${targetFile}`);
      } else {
        const cloned = cloneElements(elements, [sourceEl.id], targetFile)[0];
        const newId = cloned.id;
        cloned.title = `${sourceEl.title} (Копия)`;
        setElements((prev) => [...prev, cloned]);
        setActiveFile(targetFile);
        setSelectedId(newId);
        setAiContextIds([newId]);
        showNotice(`${tx('Скопирован элемент', 'Copied element')} ${newId} ${tx('в', 'to')} ${targetFile}`);
      }
    } else if (kbClipboard.type === 'file') {
      const sourceFile = kbClipboard.id;
      const fileElems = elements.filter((e) => e.fileName === sourceFile);
      if (kbClipboard.mode === 'cut') {
        const baseName = sourceFile.split('/').pop() || sourceFile;
        const destinationFolder = target.type === 'folder'
          ? target.folderName
          : target.type === 'file' && target.fileName.includes('/')
            ? target.fileName.slice(0, target.fileName.lastIndexOf('/'))
            : '';
        const newFileName = destinationFolder ? `${destinationFolder}/${baseName}` : baseName;
        if (files.includes(newFileName)) { showNotice(`${tx('Файл', 'File')} ${newFileName} ${tx('уже существует', 'already exists')}`); return; }
        workspace.renameSourcePath(sourceFile, newFileName);
        setElements((previous) => renameFileElements(previous, sourceFile, newFileName));
        if (target.type === 'folder' && !customFolders.includes(target.folderName)) setCustomFolders((previous) => [...previous, target.folderName]);
        setActiveFile(newFileName);
        setKbClipboard(null);
        showNotice(`${tx('Файл перемещён', 'File moved')}: ${sourceFile} → ${newFileName}`);
      } else {
        const sourceBase = sourceFile.split('/').pop() || sourceFile;
        const extensionless = sourceBase.replace(/\.pgr$/i, '');
        let suffix = 1;
        let newFileName = `${extensionless}_copy.pgr`;
        while (files.includes(newFileName)) newFileName = `${extensionless}_copy${suffix++}.pgr`;
        const clonedElements = cloneElements(elements, fileElems.map((el) => el.id), newFileName);
        workspace.copySourcePath(sourceFile, newFileName);
        setElements((prev) => [...prev, ...clonedElements]);
        setActiveFile(newFileName);
        showNotice(`${tx('Создана копия файла', 'File copy created')} ${newFileName}`);
      }
    } else if (kbClipboard.type === 'folder') {
      const sourceFolder = kbClipboard.id;
      const base = sourceFolder.split('/').pop() || sourceFolder;
      const targetFolder = target.type === 'folder'
        ? target.folderName
        : target.type === 'file' && target.fileName.includes('/')
          ? target.fileName.slice(0, target.fileName.lastIndexOf('/'))
          : '';
      if (targetFolder === sourceFolder || targetFolder.startsWith(`${sourceFolder}/`)) {
        showNotice(tx('Папку нельзя переместить или скопировать внутрь самой себя.', 'A folder cannot be moved or copied inside itself.'));
        return;
      }
      const destinationBase = targetFolder ? `${targetFolder}/${base}` : base;
      if (kbClipboard.mode === 'cut') {
        const destination = targetFolder ? destinationBase : base;
        if (files.some((path) => path.startsWith(`${destination}/`)) || customFolders.includes(destination)) {
          showNotice(`${tx('Папка', 'Folder')} ${destination} ${tx('уже существует', 'already exists')}`);
          return;
        }
        renameFolderPath(sourceFolder, destination);
        setElements((previous) => previous.map((element) => element.fileName.startsWith(`${sourceFolder}/`) ? { ...element, fileName: `${destination}${element.fileName.slice(sourceFolder.length)}` } : element));
        setStarredItems((previous) => new Set([...previous].map((item) => item === sourceFolder || item.startsWith(`${sourceFolder}/`) ? `${destination}${item.slice(sourceFolder.length)}` : item)));
        setKbClipboard(null);
        showNotice(`${tx('Папка перемещена', 'Folder moved')}: ${sourceFolder} → ${destination}`);
      } else {
        let destination = `${destinationBase}_copy`;
        let suffix = 1;
        while (customFolders.includes(destination) || files.some((path) => path.startsWith(`${destination}/`))) destination = `${destinationBase}_copy${suffix++}`;
        const sourcePaths = files.filter((path) => path.startsWith(`${sourceFolder}/`));
        for (const path of sourcePaths) copySourcePath(path, `${destination}${path.slice(sourceFolder.length)}`);
        const sourceIds = elements.filter((element) => element.fileName.startsWith(`${sourceFolder}/`)).map((element) => element.id);
        const cloned = cloneElements(elements, sourceIds).map((element) => ({ ...element, fileName: `${destination}${element.fileName.slice(sourceFolder.length)}` }));
        setElements((previous) => [...previous, ...cloned]);
        setCustomFolders((previous) => [...previous, ...customFolders.filter((folder) => folder.startsWith(`${sourceFolder}/`)).map((folder) => `${destination}${folder.slice(sourceFolder.length)}`), destination]);
        showNotice(`${tx('Создана копия папки', 'Folder copy created')} ${destination}`);
      }
    }
  };

  const handleDeleteFolder = (folderName: string) => setDeleteFolderConfirm(folderName);

  const handleConfirmDeleteFolder = () => {
    if (!deleteFolderConfirm) return;
    const folder = deleteFolderConfirm;
    const paths = files.filter((path) => path.startsWith(`${folder}/`));
    const ids = elements.filter((element) => paths.includes(element.fileName)).map((element) => element.id);
    for (const path of paths) removeSourcePath(path);
    setElements((previous) => deleteElements(previous, ids));
    setCustomFolders((previous) => previous.filter((path) => path !== folder && !path.startsWith(`${folder}/`)));
    setStarredItems((previous) => new Set([...previous].filter((item) => item !== folder && !item.startsWith(`${folder}/`))));
    if (activeFile.startsWith(`${folder}/`)) { setActiveFile(files.find((path) => !path.startsWith(`${folder}/`)) || ''); setSelectedId(null); }
    showNotice(`${tx('Папка', 'Folder')} ${folder} ${tx('и её файлы удалены', 'and its files were deleted')}`);
    setDeleteFolderConfirm(null);
  };

  const handleDuplicate = (target: KbContextMenuTarget) => {
    if (target.type === 'element') {
      const sourceEl = elements.find((e) => e.id === target.elementId);
      if (!sourceEl) return;
      const cloned = cloneElements(elements, [sourceEl.id])[0];
      const newId = cloned.id;
      cloned.title = `${sourceEl.title} (Копия)`;
      setElements((prev) => [...prev, cloned]);
      setSelectedId(newId);
      setAiContextIds([newId]);
      showNotice(`${tx('Дублирован элемент', 'Element duplicated')} ${newId}`);
    } else if (target.type === 'file') {
      const sourceFile = target.fileName;
      const fileElems = elements.filter((e) => e.fileName === sourceFile);
      const baseName = sourceFile.split('/').pop()?.replace(/\.pgr$/i, '') || 'plan';
      let suffix = 1;
      let newFileName = `${baseName}_copy.pgr`;
      while (files.includes(newFileName)) newFileName = `${baseName}_copy${suffix++}.pgr`;
      const clonedElements = cloneElements(elements, fileElems.map((el) => el.id), newFileName);
      workspace.copySourcePath(sourceFile, newFileName);
      setElements((prev) => [...prev, ...clonedElements]);
      setActiveFile(newFileName);
      showNotice(`${tx('Дублирован файл', 'File duplicated')} ${newFileName}`);
    } else if (target.type === 'folder') {
      const sourceFolder = target.folderName;
      const base = sourceFolder.split('/').pop() || sourceFolder;
      let destination = `${base}_copy`;
      let suffix = 1;
      while (customFolders.includes(destination) || files.some((path) => path.startsWith(`${destination}/`))) destination = `${base}_copy${suffix++}`;
      const sourcePaths = files.filter((path) => path.startsWith(`${sourceFolder}/`));
      for (const path of sourcePaths) copySourcePath(path, `${destination}${path.slice(sourceFolder.length)}`);
      const sourceIds = elements.filter((element) => element.fileName.startsWith(`${sourceFolder}/`)).map((element) => element.id);
      const cloned = cloneElements(elements, sourceIds).map((element) => ({ ...element, fileName: `${destination}${element.fileName.slice(sourceFolder.length)}` }));
      setElements((previous) => [...previous, ...cloned]);
      setCustomFolders((previous) => [...previous, ...customFolders.filter((folder) => folder.startsWith(`${sourceFolder}/`)).map((folder) => `${destination}${folder.slice(sourceFolder.length)}`), destination]);
      showNotice(`${tx('Дублирована папка', 'Folder duplicated')} ${destination}`);
    }
  };

  const handleShowInExplorer = async (target: KbContextMenuTarget) => {
    if (!isDesktop()) {
      showNotice(tx('Показать путь в Проводнике можно в настольном приложении.', 'Reveal in File Explorer is available in the desktop app.'));
      return;
    }
    const path = target.type === 'element' || target.type === 'file'
      ? target.fileName
      : target.type === 'folder'
        ? target.folderName
        : '';
    if (target.type === 'element') {
      setActiveFile(target.fileName);
      setSelectedId(target.elementId);
      setAiContextIds([target.elementId]);
      setCollapsedFiles((prev) => ({ ...prev, [target.fileName]: false }));
      if (target.fileName.includes('/')) {
        const folder = target.fileName.split('/')[0];
        setCollapsedFolders((prev) => ({ ...prev, [folder]: false }));
      }
    } else if (target.type === 'file') {
      setActiveFile(target.fileName);
      setCollapsedFiles((prev) => ({ ...prev, [target.fileName]: false }));
      if (target.fileName.includes('/')) {
        const folder = target.fileName.split('/')[0];
        setCollapsedFolders((prev) => ({ ...prev, [folder]: false }));
      }
    } else if (target.type === 'folder') {
      setCollapsedFolders((prev) => ({ ...prev, [target.folderName]: false }));
    } else {
      setCollapsedFolders((prev) => ({ ...prev, __root__: false }));
    }
    try {
      await revealWorkspacePath(path);
      const label = target.type === 'element'
        ? target.elementId
        : path || projectRootFolder;
      showNotice(`${tx('Открыто в Проводнике', 'Opened in File Explorer')}: ${label}`);
    } catch (cause) {
      showNotice(`${tx('Не удалось открыть в Проводнике', 'Could not open in File Explorer')}: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  };

  const handleCopyPath = (
    target: KbContextMenuTarget,
    mode: 'relative' | 'full'
  ) => {
    let path = '';
    if (target.type === 'file') {
      path =
        mode === 'full'
          ? `${projectRootFolder}/${target.fileName}`
          : target.fileName;
    } else if (target.type === 'element') {
      path =
        mode === 'full'
          ? `${projectRootFolder}/${target.fileName} -> ${target.elementId}`
          : `${target.fileName}#${target.elementId}`;
    } else if (target.type === 'folder') {
      path =
        mode === 'full'
          ? `${projectRootFolder}/${target.folderName}/`
          : `${target.folderName}/`;
    } else {
      path = mode === 'full' ? `${projectRootFolder}/` : './';
    }
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(path);
    }
    showNotice(
      `${mode === 'full' ? tx('Полный', 'Full') : tx('Относительный', 'Relative')} ${tx('путь скопирован', 'path copied')}: ${path}`
    );
  };

  useEffect(() => {
    const handleGlobalClick = () => {
      setKbContextMenu(null);
      setKbSubmenuOpen(false);
    };
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setKbContextMenu(null);
        setKbSubmenuOpen(false);
      }
    };
    window.addEventListener('click', handleGlobalClick);
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => {
      window.removeEventListener('click', handleGlobalClick);
      window.removeEventListener('keydown', handleGlobalKeyDown);
    };
  }, []);

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
    const schemaIssues = inspectGraphSchemaIssues(elements, files, locale);
    setContradictions(
      schemaIssues.filter(
        (c) =>
          !ignoredContradictionIds.includes(c.id) &&
          !rejectedContradictionIds.includes(c.id)
      )
    );
    setProposals([]);
    setInterviewQuestions([]);
  }, [
    elements,
    aiContextIds,
    files,
    ignoredContradictionIds,
    rejectedContradictionIds,
  ]);

  const openConflictPopupFor = (
    matchedContradictions: AiContradiction[],
    triggerElementId?: string
  ) => {
    if (matchedContradictions.length === 0) return;
    const first = matchedContradictions[0];
    setActiveConflictPopup({
      contradictions: matchedContradictions,
      activeIndex: 0,
      triggerElementId,
    });
    setConflictFormTitle(first.title);
    setConflictFormDesc(first.description);
    setConflictFormFix(first.resolutionHint);
    setConflictFormComment('');
  };

  const selectConflictPopupIndex = (idx: number) => {
    if (!activeConflictPopup) return;
    const item = activeConflictPopup.contradictions[idx];
    if (!item) return;
    setActiveConflictPopup({
      ...activeConflictPopup,
      activeIndex: idx,
    });
    setConflictFormTitle(item.title);
    setConflictFormDesc(item.description);
    setConflictFormFix(item.resolutionHint);
    setConflictFormComment('');
  };

  const handleAcceptConflictFix = () => {
    if (!activeConflictPopup) return;
    const current =
      activeConflictPopup.contradictions[activeConflictPopup.activeIndex];
    if (!current) return;
    if (!current.suggestedFix) {
      showNotice(tx('Для этого конфликта нет проверенного патча. Исправьте ссылку вручную или отклоните конфликт.', 'There is no verified patch for this conflict. Edit the reference manually or reject the finding.'));
      return;
    }

    const targetId = current.suggestedFix.targetElementId;
    if (!elements.some((element) => element.id === targetId)) {
      showNotice(tx('Целевой элемент исправления больше не существует.', 'The fix target no longer exists.'));
      return;
    }
    setElements((prev) =>
      prev.map((el) => {
        if (el.id !== targetId) return el;
        return {
          ...el,
          ...current.suggestedFix!.patch,
        };
      })
    );
    setContradictions((prev) => prev.filter((c) => c.id !== current.id));
    setActiveConflictPopup(null);
    showNotice(
      `${tx('Применён проверенный патч', 'Verified patch applied')}: ${current.suggestedFix.fixLabel || current.title}`
    );
  };

  const handleRejectConflict = () => {
    if (!activeConflictPopup) return;
    const current =
      activeConflictPopup.contradictions[activeConflictPopup.activeIndex];
    if (!current) return;

    if (conflictFormComment.trim()) {
      const ideaFile = files.includes('idea_backlog.pgr')
        ? 'idea_backlog.pgr'
        : files[0] || 'idea_backlog.pgr';
      const rejIdea: PlanElement = {
        id: `idea_conflict_rej_${Date.now().toString().slice(-3)}`,
        type: 'idea',
        title: `${tx('Отклонён конфликт', 'Rejected conflict')}: ${conflictFormTitle || current.title}`,
        fileName: ideaFile,
        parent: '-',
        description: conflictFormDesc || current.description,
        status: 'черновик',
        mvp: false,
        position: { x: 40, y: 460 },
        notes: current.elementIds,
        altTo:
          current.suggestedFix?.targetElementId ||
          current.elementIds[0] ||
          '-',
        altReason: conflictFormComment.trim(),
      };
      setElements((prev) => [...prev, rejIdea]);
    }

    setRejectedContradictionIds((prev) =>
      Array.from(new Set([...prev, current.id]))
    );
    setContradictions((prev) => prev.filter((c) => c.id !== current.id));
    setActiveConflictPopup(null);
    showNotice(`${tx('Конфликт отклонён', 'Conflict rejected')}: ${conflictFormTitle || current.title}`);
  };

  const handleIgnoreConflict = () => {
    if (!activeConflictPopup) return;
    const current =
      activeConflictPopup.contradictions[activeConflictPopup.activeIndex];
    if (!current) return;

    setIgnoredContradictionIds((prev) =>
      Array.from(new Set([...prev, current.id]))
    );
    setContradictions((prev) => prev.filter((c) => c.id !== current.id));
    setActiveConflictPopup(null);
    showNotice(
      `${tx('Конфликт скрыт (игнорируется)', 'Conflict hidden (ignored)')}: ${conflictFormTitle || current.title}`
    );
  };

  const canvasVisibleContradictions = useMemo(() => {
    if (!showCanvasConflictOverlay) return [];
    if (canvasConflictFilter === 'all') return contradictions;
    return contradictions.filter((c) => c.id === canvasConflictFilter);
  }, [showCanvasConflictOverlay, canvasConflictFilter, contradictions]);

  const getRadialOptions = (
    mode: 'canvas' | 'node',
    targetElementId?: string
  ): {
    id: RadialOptionId;
    label: string;
    sublabel: string;
    startDeg: number;
    endDeg: number;
    angleDeg: number;
    isNegative?: boolean;
  }[] => {
    if (mode === 'node' && targetElementId) {
      const targetEl = elements.find((e) => e.id === targetElementId);
      return [
        {
          id: 'node_transform',
          label: tx('Преобразовать', 'Transform'),
          sublabel: tx('В систему', 'Into system'),
          startDeg: -90,
          endDeg: 0,
          angleDeg: -45,
        },
        {
          id: 'node_open_kb',
          label: tx('Открыть в БЗ', 'Open in Knowledge Base'),
          sublabel: targetEl?.fileName || '.pgr',
          startDeg: 0,
          endDeg: 90,
          angleDeg: 45,
        },
        {
          id: 'node_save_lib',
          label: tx('В библиотеку', 'To library'),
          sublabel: tx('Сохранить', 'Save'),
          startDeg: 90,
          endDeg: 180,
          angleDeg: 135,
        },
        {
          id: 'node_delete',
          label: tx('Удалить', 'Delete'),
          sublabel: tx('Из проекта', 'From project'),
          startDeg: -180,
          endDeg: -90,
          angleDeg: -135,
          isNegative: true,
        },
      ];
    }

    return [
      {
        id: 'conflicts',
        label: tx('Конфликты', 'Conflicts'),
        sublabel: `${contradictions.length} ${tx('активн.', 'active')}`,
        startDeg: -90,
        endDeg: 0,
        angleDeg: -45,
        isNegative: true,
      },
      {
        id: 'proposals',
        label: tx('Предложения', 'Proposals'),
        sublabel: `${proposals.length} ${tx('карточ.', 'cards')}`,
        startDeg: 0,
        endDeg: 90,
        angleDeg: 45,
      },
      {
        id: 'interview',
        label: tx('Интервью', 'Interview'),
        sublabel: `${interviewQuestions.length} ${tx('вопр.', 'questions')}`,
        startDeg: 90,
        endDeg: 180,
        angleDeg: 135,
      },
      {
        id: 'rescan',
        label: tx('Обновить ИИ', 'Refresh AI'),
        sublabel: tx('Скан плана', 'Scan plan'),
        startDeg: -180,
        endDeg: -90,
        angleDeg: -135,
      },
    ];
  };

  const executeRadialAiAction = (
    optionId: RadialOptionId,
    targetElementId?: string
  ) => {
    if (optionId.startsWith('node_') && targetElementId) {
      const targetEl = elements.find((e) => e.id === targetElementId);
      if (!targetEl) return;

      if (optionId === 'node_transform') {
        if (!aiEnabled) setAiEnabled(true);
        setSelectedId(targetEl.id);
        if (!aiContextIds.includes(targetEl.id)) {
          setAiContextIds([targetEl.id]);
        }
        setTransformSourceId(targetEl.id);
        setTransformSummary(null);
        setAiActiveModal('transform');
        showNotice(`${tx('Преобразование элемента', 'Transform element')}: ${targetEl.id}`);
      } else if (optionId === 'node_open_kb') {
        setSelectedId(targetEl.id);
        setActiveFile(targetEl.fileName);
        setActiveTab('kb');
        showNotice(`${tx('Открыт элемент', 'Opened element')} ${targetEl.id} ${tx('в Базе знаний', 'in Knowledge Base')}`);
      } else if (optionId === 'node_save_lib') {
        handleSaveCurrentToLibrary(targetEl);
      } else if (optionId === 'node_delete') {
        setElements((prev) =>
          prev
            .filter((e) => e.id !== targetEl.id)
            .map((e) => ({
              ...e,
              parent: e.parent === targetEl.id ? '-' : e.parent,
              extendsId: e.extendsId === targetEl.id ? '-' : e.extendsId,
              instanceOf: e.instanceOf === targetEl.id ? '-' : e.instanceOf,
              uses: e.uses?.filter((u) => u !== targetEl.id),
              components: e.components?.filter((c) => c !== targetEl.id),
              notes: e.notes?.filter((n) => n !== targetEl.id),
            }))
        );
        if (selectedId === targetEl.id) {
          setSelectedId(null);
        }
        showNotice(`${tx('Элемент', 'Element')} ${targetEl.id} ${tx('удалён с Холста', 'deleted from Canvas')}`);
      }
      return;
    }

    if (!aiEnabled) {
      setAiEnabled(true);
    }
    if (optionId === 'conflicts') {
      setShowCanvasConflictOverlay(true);
      setCanvasConflictFilter('all');
      if (contradictions.length > 0) {
        openConflictPopupFor(contradictions, contradictions[0].elementIds[0]);
      } else {
        setAiActiveModal('contradictions');
        showNotice(tx('Активных конфликтов на холсте не обнаружено', 'No active conflicts found on the canvas'));
      }
    } else if (optionId === 'proposals') {
      setAiActiveModal('proposals');
      void runAiAnalysis();
    } else if (optionId === 'interview') {
      setAiActiveModal('interview');
      void runProblemInterview();
    } else if (optionId === 'rescan') {
      setIgnoredContradictionIds([]);
      setRejectedContradictionIds([]);
      setShowCanvasConflictOverlay(true);
      setCanvasConflictFilter('all');
      void runAiAnalysis();
    }
  };
  const executeRadialAiActionRef = useRef(executeRadialAiAction);
  executeRadialAiActionRef.current = executeRadialAiAction;

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

  // Automatically apply graph-clustered layout on Canvas when graph topology (nodes or edges) changes,
  // preserving any positions already modified by the user untouched.
  const topologySignature = useMemo(() => {
    const { edges: allEdges } = buildAndValidateGraph(elements);
    const nodePart = elements
      .map((e) => `${e.id}:${e.type}:${e.parent || '-'}`)
      .sort()
      .join(',');
    const edgePart = allEdges
      .map((e) => `${e.source}->${e.target}:${e.relation}`)
      .sort()
      .join(';');
    return `${nodePart}||${edgePart}`;
  }, [elements]);

  const prevTopologySignatureRef = useRef<string>(topologySignature);
  useEffect(() => {
    if (prevTopologySignatureRef.current !== topologySignature) {
      prevTopologySignatureRef.current = topologySignature;
      setElements((prev) =>
        applyCanvasAutoLayout(prev, userPositionedNodeIdsRef.current)
      );
    }
  }, [topologySignature]);

  // Shared topology-aware layout generator that keeps tightly coupled nodes in the core
  // and pushes peripheral radicals / secondary sub-clusters (like join_faction -> factions + reputation_bound) outward
  const buildClusteredLayout = (
    nodes: PlanElement[],
    activeEdges: ReturnType<typeof buildAndValidateGraph>['edges'],
    W: number,
    H: number,
    baseScale: number,
    spread: number
  ) =>
    computeClusteredGraphPositions(
      nodes,
      activeEdges,
      W,
      H,
      baseScale,
      spread,
      selectedId
    );

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

  const miniGraphEdgeOffsets = useMemo(
    () => getParallelEdgeOffsets(miniGraphLayout.activeEdges),
    [miniGraphLayout.activeEdges]
  );
  const mainGraphEdgeOffsets = useMemo(
    () => getParallelEdgeOffsets(mainGraphLayout.activeEdges),
    [mainGraphLayout.activeEdges]
  );

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
  const rangeFilterFileName = selectedElement?.fileName || activeFile;
  const activeLineRangeFilter = lineRangeFilter?.fileName === rangeFilterFileName ? lineRangeFilter : null;

  const [rawPgrDraft, setRawPgrDraft] = useState<string>('');
  useEffect(() => {
    const rawSource = workspace.sourceContents[activeFile || files[0] || ''];
    setRawPgrDraft(rawSource ?? activeFileData.content);
  }, [activeFileData.content, activeFile, files, workspace.sourceContents]);
  const rawPgrLines = useMemo(() => rawPgrDraft.split(/\r\n|\n|\r/), [rawPgrDraft]);
  useEffect(() => {
    const citedRange = lineRangeFilter?.fileName === rangeFilterFileName ? lineRangeFilter : null;
    if (citedRange) {
      setRangeStartInput(String(citedRange.start));
      setRangeEndInput(String(citedRange.end));
      return;
    }

    const source = workspace.sourceContents[rangeFilterFileName]
      ?? serializeFileWithRanges(elements, rangeFilterFileName).content;
    const lineCount = source.split(/\r\n|\n|\r/).length;
    setRangeStartInput('1');
    setRangeEndInput(String(Math.min(24, lineCount)));
  }, [rangeFilterFileName, lineRangeFilter?.fileName, lineRangeFilter?.start, lineRangeFilter?.end]);
  const requestedLineRange = useMemo(
    () => parseLineRange(rangeStartInput, rangeEndInput, rawPgrLines.length),
    [rangeStartInput, rangeEndInput, rawPgrLines.length],
  );

  const updateRawPgrDraft = (fileName: string, content: string) => {
    setRawPgrDraft(content);
    let diagnostic: string | null = null;
    try {
      parsePgrFileContent(content, fileName, elements);
    } catch (cause) {
      diagnostic = cause instanceof Error ? cause.message : String(cause);
    }
    workspace.stageSource(fileName, content, diagnostic);
  };

  const updateElement = (updated: PlanElement) => {
    setElements((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
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
    const result = toggleCanvasRelation(elements, sourceId, targetId);
    if (!result) {
      showNotice(tx('Для выбранной пары типов связь не предусмотрена', 'A relation is not defined for this pair of element types'));
      return;
    }
    updateElement(result.updatedElement);
    const relationLabel: Record<RelationType, string> = {
      contains: tx('содержит', 'contains'),
      extends: tx('наследует', 'extends'),
      has: tx('имеет', 'has'),
      instance_of: tx('экземпляр', 'instance of'),
      uses: tx('использует', 'uses'),
      notes: tx('заметка', 'notes'),
    };
    const action = result.removed ? tx('Удалена связь', 'Removed relation') : tx('Добавлена связь', 'Added relation');
    showNotice(`${action} ${relationLabel[result.relation]}: ${sourceId} → ${targetId}`);
  };

  const handleApplySuggestedFix = (contradiction: AiContradiction) => {
    const suggestedFix = contradiction.suggestedFix;
    if (!suggestedFix) return;
    const { targetElementId, patch } = suggestedFix;
    setElements((previous) => previous.map((element) => (
      element.id === targetElementId ? { ...element, ...patch } : element
    )));
    setContradictions((previous) => previous.filter((item) => item.id !== contradiction.id));
    showNotice(`${tx('Противоречие в', 'Contradiction in')} ${targetElementId} ${tx('исправлено', 'fixed')}`);
  };

  const handleApplyProposal = (prop: AiProposalCard) => {
    if (!prop.suggestedElement) {
      showNotice(tx('Для этого предложения нет проверенного элемента для добавления. Создайте новый анализ после получения структурированных данных.', 'This proposal has no validated element to add. Run the analysis again after receiving structured data.'));
      return;
    }
    {
      const se = prop.suggestedElement;
      const targetFile = se.fileName || activeFile || files[0] || 'sys_core.pgr';
      if (elements.some((element) => element.id === se.id)) {
        showNotice(tx('ID предложенного элемента уже существует. Обновите анализ и проверьте предложение снова.', 'The proposed element ID already exists. Refresh the analysis and review the proposal again.'));
        return;
      }
      if (prop.targetElementId && !elements.some((element) => element.id === prop.targetElementId)) {
        showNotice(tx('Целевой элемент больше не существует. Обновите анализ и проверьте предложение снова.', 'The target element no longer exists. Refresh the analysis and review the proposal again.'));
        return;
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
      const previewGraph = buildAndValidateGraph([...elements, created]);
      const invalidCandidate = previewGraph.warnings.some((warning) => warning.elementId === created.id) ||
        previewGraph.edges.some((edge) => edge.source === created.id && !edge.valid);
      if (invalidCandidate) {
        showNotice(tx('Связи предложенного элемента больше невалидны. Обновите анализ и проверьте предложение снова.', 'The proposed element references are no longer valid. Refresh the analysis and review the proposal again.'));
        return;
      }
      if (!files.includes(targetFile)) {
        setFiles((prev) => [...prev, targetFile]);
      }
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
      showNotice(`${tx('Применено предложение: добавлен', 'Proposal applied: added')} ${created.id}`);
    }
    setProposals((prev) => prev.filter((p) => p.id !== prop.id));
  };

  const handleConfirmRejectProposal = () => {
    if (!rejectProposalModal) return;
    if (!rejectReasonInput.trim()) {
      showNotice(tx('Укажите причину отклонения, чтобы сохранить её в плане.', 'Enter a rejection reason to save it to the plan.'));
      return;
    }
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
      altReason: rejectReasonInput.trim(),
    };
    setElements((prev) => [...prev, rejIdea]);
    setProposals((prev) => prev.filter((p) => p.id !== prop.id));
    setRejectProposalModal(null);
    setRejectReasonInput('');
      showNotice(`${tx('Отклонённый вариант сохранён как Идея-образ', 'Rejected option saved as an Idea')} (${rejIdea.id})`);
  };

  const handleSaveCurrentToLibrary = (elToSave?: PlanElement | null) => {
    const target = elToSave || selectedElement;
    if (!target) return;
    setLibraryIconDraft(defaultLibraryIcon(target.type));
    setLibrarySaveQueue((previous) => [...previous, target]);
  };

  const handleQueueLibrarySave = (targets: PlanElement[]) => {
    if (targets.length === 0) return;
    const knownIds = new Set([
      ...unitLibrary.map((item) => item.element.id),
      ...librarySaveQueue.map((element) => element.id),
    ]);
    const uniqueTargets = targets.filter((target) => {
      if (knownIds.has(target.id)) return false;
      knownIds.add(target.id);
      return true;
    });
    if (uniqueTargets.length === 0) {
      showNotice(tx('Эти элементы уже есть в библиотеке или ожидают сохранения', 'These elements are already in the library or queued for saving'));
      return;
    }
    setLibraryIconDraft(defaultLibraryIcon(uniqueTargets[0].type));
    setLibrarySaveQueue((previous) => [...previous, ...uniqueTargets]);
  };

  const handleToggleFileLibrary = (fileName: string) => {
    const fileElements = elements.filter((element) => element.fileName === fileName);
    if (fileElements.length === 0) {
      showNotice(tx('В файле нет элементов для сохранения', 'This file has no elements to save'));
      return;
    }

    const elementIds = new Set(fileElements.map((element) => element.id));
    const savedIds = new Set(unitLibrary.filter((item) => elementIds.has(item.element.id)).map((item) => item.element.id));
    const missingElements = fileElements.filter((element) => !savedIds.has(element.id));

    if (missingElements.length === 0) {
      const removedCount = unitLibrary.filter((item) => elementIds.has(item.element.id)).length;
      setUnitLibrary((previous) => previous.filter((item) => !elementIds.has(item.element.id)));
      showNotice(`${tx('Удалено из Библиотеки юнитов', 'Removed from the Unit Library')}: ${removedCount} · ${fileName}`);
      return;
    }

    handleQueueLibrarySave(missingElements);
  };

  const handleToggleElementLibrary = (elementId: string) => {
    const target = elements.find((element) => element.id === elementId);
    if (!target) {
      showNotice(tx('Элемент больше не существует', 'This element no longer exists'));
      return;
    }

    const savedUnits = unitLibrary.filter((item) => item.element.id === elementId);
    if (savedUnits.length > 0) {
      setUnitLibrary((previous) => previous.filter((item) => item.element.id !== elementId));
      showNotice(`${tx('Элемент удалён из Библиотеки юнитов', 'Element removed from the Unit Library')}: ${elementId}`);
      return;
    }

    handleQueueLibrarySave([target]);
  };

  const handleConfirmLibrarySave = (iconName = libraryIconDraft) => {
    const target = librarySaveQueue[0];
    if (!target) return;
    const { fileName: _f, position: _p, ...rest } = target;
    const newUnit: UnitLibraryItem = {
      unitId: `unit_${target.id}_${Date.now()}`,
      category: `${TYPE_HEADERS_RU[target.type]} · из текущего проекта`,
      savedAt: new Date().toISOString(),
      iconName,
      element: rest,
    };
    setUnitLibrary((prev) => [newUnit, ...prev]);
    showNotice(`${tx('Элемент', 'Element')} ${target.id} ${tx('сохранён в Библиотеку юнитов', 'saved to the Unit Library')}`);
    const next = librarySaveQueue[1];
    if (next) setLibraryIconDraft(defaultLibraryIcon(next.type));
    setLibrarySaveQueue((previous) => previous.slice(1));
  };

  const handleAddUnitToProject = (unit: UnitLibraryItem) => {
    const targetFile = activeFile || files[0] || 'sys_core.pgr';
    try {
      const prepared = prepareLibraryInsert(unit, elements, targetFile);
      const newEl: PlanElement = {
        ...prepared.element,
        position: {
          x: 280 + (elements.length % 3) * 220,
          y: 40 + Math.floor(elements.length / 3) * 140,
        },
      };
      setFiles((previous) => previous.includes(targetFile) ? previous : [...previous, targetFile]);
      setActiveFile(targetFile);
      setElements((previous) => [...previous, newEl]);
      setSelectedId(newEl.id);
      showNotice(prepared.warnings.length > 0
        ? `${tx('Юнит добавлен с предупреждениями', 'Unit added with warnings')}: ${newEl.id}; ${prepared.warnings.length} ${tx('связей не перенесено', 'references could not be kept')}`
        : `${tx('Юнит', 'Unit')} ${newEl.id} ${tx('добавлен в проект', 'added to the project')} (${targetFile})`);
    } catch (cause) {
      showNotice(`${tx('Юнит не добавлен', 'Unit was not added')}: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
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
    const targetFile = newElFile || activeFile || files[0] || 'sys_core.pgr';

    if (elements.some((element) => element.id === finalId)) {
      showNotice(`${tx('ID', 'ID')} ${finalId} ${tx('уже существует', 'already exists')}`);
      return;
    }
    if (newElType !== 'system' && newElParent !== '-' && !elements.some((element) => element.id === newElParent && element.type === 'system')) {
      showNotice(tx('Выбранная родительская система больше не существует', 'The selected parent system no longer exists'));
      return;
    }

    if (!files.includes(targetFile)) {
      setFiles((prev) => [...prev, targetFile]);
    }

    const created: PlanElement = {
      id: finalId,
      type: newElType,
      title: newElTitle.trim() || finalId,
      fileName: targetFile,
      parent: newElType === 'system' ? '-' : newElParent || '-',
      description: '',
      status: 'черновик',
      mvp: newElMvp,
      position: { x: 280, y: 180 },
      extendsId: newElType === 'class' ? '-' : undefined,
      fields: newElType === 'class' ? [] : undefined,
      methods: newElType === 'class' ? [] : undefined,
      steps: newElType === 'process' ? [] : undefined,
      interfaceItems: newElType === 'component' ? [] : undefined,
      internalLogic: newElType === 'component' ? [] : undefined,
      instanceOf: newElType === 'object' ? '-' : undefined,
      values: newElType === 'object' ? [] : undefined,
      notes: newElType === 'idea' ? [] : undefined,
    };

    setElements((prev) => [...prev, created]);
    setSelectedId(created.id);
    setActiveFile(targetFile);
    setNewElementModalOpen(false);
    setNewElTitle('');
    setNewElSlug('');
    showNotice(`${tx('Создан элемент', 'Element created')} ${created.id}`);
  };

  const renderExplorerFileItem = (fileName: string, isNested = false) => {
    const fileElements = filteredElements.filter((element) => element.fileName === fileName);
    return (
      <ExplorerFileEntry
        key={fileName}
        fileName={fileName}
        isNested={isNested}
        fileElements={fileElements}
        locale={locale}
        active={(selectedElement?.fileName || activeFile) === fileName}
        dragTarget={dragOverFileName === fileName}
        collapsed={Boolean(collapsedFiles[fileName])}
        selectedId={selectedId}
        aiContextIds={aiContextIds}
        starredItems={starredItems}
        onContextMenu={handleOpenContextMenu}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          if (dragOverFileName !== fileName) setDragOverFileName(fileName);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setDragOverFileName((previous) => previous === fileName ? null : previous);
          }
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragOverFileName(null);
          let idsToMove: string[] = kbDraggedIdsRef.current.length > 0
            ? kbDraggedIdsRef.current
            : kbDraggedIds;
          if (idsToMove.length === 0) {
            const raw = event.dataTransfer.getData('text/plain');
            if (raw) {
              try {
                const parsed: unknown = JSON.parse(raw);
                idsToMove = Array.isArray(parsed) && parsed.every((id): id is string => typeof id === 'string') ? parsed : [raw];
              } catch {
                idsToMove = [raw];
              }
            }
          }
          kbDraggedIdsRef.current = [];
          setKbDraggedIds([]);
          const movable = elementsRef.current.filter((element) => idsToMove.includes(element.id) && element.fileName !== fileName);
          if (movable.length === 0) return;
          const movedIds = new Set(movable.map((element) => element.id));
          const nextElements = elementsRef.current.map((element) => movedIds.has(element.id) ? { ...element, fileName } : element);
          elementsRef.current = nextElements;
          setElements(nextElements);
          setActiveFile(fileName);
          if (document.activeElement instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
            document.activeElement.blur();
          }
          if (movable.length === 1) {
            showNotice(`${tx('Элемент', 'Element')} ${movable[0].id} ${tx('перемещён в', 'moved to')} ${fileName}`);
          } else {
            showNotice(`${tx('Перемещено элементов', 'Elements moved')} (${movable.length}) ${tx('в', 'to')} ${fileName}`);
          }
        }}
        onFileClick={() => {
          setActiveFile(fileName);
          if (fileElements[0]) {
            setSelectedId(fileElements[0].id);
            setAiContextIds([fileElements[0].id]);
          }
        }}
        onToggleCollapse={() => setCollapsedFiles((previous) => ({ ...previous, [fileName]: !previous[fileName] }))}
        onElementDragStart={(element, event) => {
          const currentMulti = aiContextIdsRef.current;
          const ids = currentMulti.includes(element.id) && currentMulti.length > 0
            ? currentMulti
            : event.ctrlKey || event.metaKey
              ? Array.from(new Set([...currentMulti, element.id]))
              : [element.id];
          if (!currentMulti.includes(element.id)) {
            selectedIdRef.current = element.id;
            setSelectedId(element.id);
            aiContextIdsRef.current = ids;
            setAiContextIds(ids);
          }
          kbDraggedIdsRef.current = ids;
          setKbDraggedIds(ids);
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', ids.length === 1 ? ids[0] : JSON.stringify(ids));
        }}
        onElementDragEnd={() => {
          kbDraggedIdsRef.current = [];
          setKbDraggedIds([]);
          setDragOverFileName(null);
        }}
        onElementClick={(element, event) => {
          handleSelectWithModifiers(element.id, event.ctrlKey || event.metaKey, fileName);
          setLineRangeFilter(null);
        }}
      />
    );
  };
  const isProjectEmpty = files.length === 0;

  const canvasContext = {
    view: { activeTab, leftPanelOpen, locale },
    graph: { elements, filteredElements, selectedElement, selectedId, aiContextIds, contradictions, canvasVisibleContradictions, edges, expandedNodeIds, ignoredContradictionIds, rejectedContradictionIds, canvasConflictFilter, showCanvasConflictOverlay, alignmentGuides, visibleRelations },
    interaction: { canvasZoom, canvasPan, isPanningCanvas, panStart, draggingNodeId, dragOffset, connectingFromId, mouseCanvasPos, radialMenu },
    refs: { aiContextIdsRef, canvasAreaRef, canvasMouseDownInfoRef, canvasNodeDownClientRef, dragStartSnapshotRef, draggingNodeIdRef, elementsRef, radialMenuRef, selectedIdRef },
    actions: { setLeftPanelOpen, setActiveTab, setActiveFile, setElements, setSelectedId, setAiContextIds, setIgnoredContradictionIds, setRejectedContradictionIds, setShowCanvasConflictOverlay, setCanvasConflictFilter, setAlignmentGuides, setVisibleRelations, setCanvasZoom, setCanvasPan, setIsPanningCanvas, setPanStart, setDraggingNodeId, setDragOffset, setConnectingFromId, setMouseCanvasPos, setRadialMenu, setExpandedNodeIds, beginHistoryTransaction: workspace.beginHistoryTransaction, endHistoryTransaction: workspace.endHistoryTransaction, commitDragSnapshotIfMoved, getRadialOptions, executeRadialAiAction, handleConnectOnCanvas, openConflictPopupFor, showNotice },
  };

  const contextFileTarget = kbContextMenu?.target;
  const contextElementLibrary = contextFileTarget?.type === 'element'
    ? {
      elementId: contextFileTarget.elementId,
      exists: elements.some((element) => element.id === contextFileTarget.elementId),
      saved: unitLibrary.some((item) => item.element.id === contextFileTarget.elementId),
    }
    : null;
  const contextFileLibrary = contextFileTarget?.type === 'file'
    ? (() => {
      const fileElements = elements.filter((element) => element.fileName === contextFileTarget.fileName);
      const fileElementIds = new Set(fileElements.map((element) => element.id));
      const savedIds = new Set(unitLibrary.filter((item) => fileElementIds.has(item.element.id)).map((item) => item.element.id));
      return {
        fileName: contextFileTarget.fileName,
        elementCount: fileElements.length,
        missingCount: fileElements.filter((element) => !savedIds.has(element.id)).length,
      };
    })()
    : null;

return (
    <div className="flex flex-col h-screen w-screen overflow-hidden">
      {(!workspace.workspaceReady || workspace.operationBusy) && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[var(--bg)]/95 p-6">
          <div className="w-full max-w-lg rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 space-y-4 shadow-2xl">
            <div className="text-lg font-bold">{workspace.operationBusy ? tx('Обновление рабочего пространства…', 'Updating workspace…') : workspace.loading ? tx('Открываем локальный проект…', 'Opening local project…') : tx('Проект не загружен', 'Project is not loaded')}</div>
            {workspace.error && <p role="alert" className="text-sm text-[var(--ctx-neg-text)]">{localizePgrParseError(workspace.error, locale)}</p>}
            {!workspace.workspaceReady && <p className="text-xs text-[var(--ink-muted)]">{tx('Проект нельзя редактировать, пока локальные данные не загружены. Повторите открытие папки или перезапустите приложение после устранения ошибки.', 'The project cannot be edited until its local data has loaded. Reopen the folder or restart the app after resolving the error.')}</p>}
            {!workspace.operationBusy && <button type="button" className="btn pos" disabled={workspace.preview || workspace.loading} onClick={() => workspace.choose().catch((cause: unknown) => workspace.setError(cause instanceof Error ? cause.message : String(cause)))}>{tx('Открыть папку проекта', 'Open project folder')}</button>}
            {workspace.preview && <p className="text-[10px] text-[var(--ink-muted)]">{tx('Browser preview использует отдельное локальное хранилище.', 'Browser preview uses separate local storage.')}</p>}
          </div>
        </div>
      )}
      <AppHeader
        activeTab={activeTab}
        locale={locale}
        labels={t}
        preview={workspace.preview}
        saving={workspace.saving}
        onTabChange={setActiveTab}
        onCreateElement={openNewElementModal}
        onOpenAssistant={() => setAiActiveModal('hub')}
        onSaveCurrentToLibrary={() => handleSaveCurrentToLibrary()}
      />

          {workspace.error && (
            <div role="alert" className="px-4 py-2 text-xs border-b border-[var(--ctx-neg-border)] bg-[var(--ctx-neg-soft)] text-[var(--ctx-neg-text)]">
              {tx('Ошибка проекта', 'Project error')}: {localizePgrParseError(workspace.error, locale)}
        </div>
      )}

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
            title={tx('Развернуть левую панель', 'Expand left panel')}
          >
            <PanelLeftOpen size={15} />
          </button>

          <button
            type="button"
            onClick={() => setRightPanelOpen(true)}
            className={`btn p-1.5 panel-expand-btn right ${
              rightPanelOpen ? 'is-hidden' : ''
            }`}
            title={tx('Развернуть правую панель', 'Expand right panel')}
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
              {!workspace.root && files.length === 0 && elements.length === 0 && (
                <div className="p-3 border-b border-[var(--border)] shrink-0">
                  <button
                    type="button"
                    className="btn flex w-full items-center justify-start gap-2"
                    disabled={workspace.preview || workspace.operationBusy}
                    title={workspace.preview ? tx('Выбор папки доступен в приложении Tauri', 'Folder selection is available in the Tauri app') : tx('Открыть локальный проект', 'Open local project')}
                    onClick={() => workspace.choose().catch((cause: unknown) => workspace.setError(cause instanceof Error ? cause.message : String(cause)))}
                  >
                    <Folder size={14} />
                    {tx('Открыть проект', 'Open project')}
                  </button>
                </div>
              )}
              <div
                className="p-3 border-b border-[var(--border)] space-y-2 shrink-0 relative"
                ref={filterPopoverRef}
              >
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    placeholder={tx('Поиск (id, имя)...', 'Search (id, name)...')}
                    value={kbSearch}
                    onChange={(e) => setKbSearch(e.target.value)}
                    className="sys-input flex-1 min-w-0 text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => setIsKbFilterOpen((prev) => !prev)}
                    className={`btn p-1.5 shrink-0 relative ${
                      kbTypeFilter !== 'all' || kbMvpFilter !== 'all'
                        ? 'border-[var(--accent)] text-[var(--accent)] font-bold'
                        : ''
                    }`}
                    title={tx('Фильтры по типу и MVP', 'Filter by type and MVP')}
                  >
                    <Funnel size={14} />
                    {(kbTypeFilter !== 'all' || kbMvpFilter !== 'all') && (
                      <span
                        style={{ backgroundColor: 'var(--ctx-pos-border)' }}
                        className="absolute -top-1 -right-1 w-2 h-2 rounded-full"
                      />
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => setLeftPanelOpen(false)}
                    className="btn p-1.5 shrink-0"
                    title={tx('Свернуть левую панель', 'Collapse left panel')}
                  >
                    <PanelLeftClose size={14} />
                  </button>
                </div>

                {isKbFilterOpen && (
                  <div className="absolute left-2.5 right-2.5 top-[calc(100%+4px)] bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-2xl p-3 z-50 space-y-3">
                    <div className="flex items-center justify-between pb-1.5 border-b border-[var(--border)]">
                      <div className="flex items-center gap-1.5 font-medium text-xs text-[var(--ink)]">
                        <Funnel
                          size={13}
                          style={{ color: 'var(--ctx-pos-border)' }}
                        />
                        <span>{tx('Фильтры проводника', 'Explorer filters')}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        {(kbTypeFilter !== 'all' ||
                          kbMvpFilter !== 'all') && (
                          <button
                            type="button"
                            onClick={() => {
                              setKbTypeFilter('all');
                              setKbMvpFilter('all');
                              setIsKbFilterOpen(false);
                            }}
                            className="text-[10px] text-[var(--muted)] hover:text-[var(--ink)] px-1.5 py-0.5 rounded hover:bg-[var(--surface-hover)] cursor-pointer"
                          >
                            {tx('Сброс', 'Reset')}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setIsKbFilterOpen(false)}
                          className="text-xs text-[var(--muted)] hover:text-[var(--ink)] p-0.5 cursor-pointer leading-none"
                        >
                          ✕
                        </button>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[11px] font-medium text-[var(--muted)] block">
                        {tx('Тип элемента', 'Element type')}
                      </label>
                      <select
                        value={kbTypeFilter}
                        onChange={(e) => {
                          setKbTypeFilter(
                            e.target.value as ElementType | 'all'
                          );
                          setIsKbFilterOpen(false);
                        }}
                        className="sys-input mono text-[11px] w-full min-w-0 px-2 py-1.5 cursor-pointer bg-[var(--surface)] text-[var(--ink)]"
                      >
                        <option value="all">{tx('Все типы', 'All types')}</option>
                        <option value="system">{tx('Система (sys_)', 'System (sys_)')}</option>
                        <option value="class">{tx('Класс (cls_)', 'Class (cls_)')}</option>
                        <option value="process">{tx('Процесс (proc_)', 'Process (proc_)')}</option>
                        <option value="component">{tx('Компонент (cmp_)', 'Component (cmp_)')}</option>
                        <option value="object">{tx('Объект (obj_)', 'Object (obj_)')}</option>
                        <option value="idea">{tx('Идея (idea_)', 'Idea (idea_)')}</option>
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[11px] font-medium text-[var(--muted)] block">
                        {tx('Статус MVP', 'MVP status')}
                      </label>
                      <select
                        value={kbMvpFilter}
                        onChange={(e) => {
                          setKbMvpFilter(
                            e.target.value as 'all' | 'mvp' | 'later'
                          );
                          setIsKbFilterOpen(false);
                        }}
                        className="sys-input mono text-[11px] w-full min-w-0 px-2 py-1.5 cursor-pointer bg-[var(--surface)] text-[var(--ink)]"
                      >
                        <option value="all">{tx('MVP: все', 'MVP: all')}</option>
                        <option value="mvp">{tx('Только MVP', 'MVP only')}</option>
                        <option value="later">{tx('Потом', 'Later')}</option>
                      </select>
                    </div>
                  </div>
                )}

                {(kbTypeFilter !== 'all' || kbMvpFilter !== 'all') && (
                  <div className="flex items-center gap-1.5 text-[10px] text-[var(--muted)] flex-wrap pt-1 border-t border-[var(--border)] mt-1">
                    <span className="text-[var(--muted)]">{tx('Фильтр:', 'Filter:')}</span>
                    {kbTypeFilter !== 'all' && (
                      <span
                        style={{
                          borderColor: 'var(--ctx-pos-border)',
                          backgroundColor: 'var(--ctx-pos-soft)',
                          color: 'var(--ctx-pos-text)',
                        }}
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] mono"
                      >
                        <span>
                          {kbTypeFilter === 'system'
                            ? tx('Система', 'System')
                            : kbTypeFilter === 'class'
                            ? tx('Класс', 'Class')
                            : kbTypeFilter === 'process'
                            ? tx('Процесс', 'Process')
                            : kbTypeFilter === 'component'
                            ? tx('Компонент', 'Component')
                            : kbTypeFilter === 'object'
                            ? tx('Объект', 'Object')
                            : kbTypeFilter === 'idea'
                            ? tx('Идея', 'Idea')
                            : kbTypeFilter}
                        </span>
                        <button
                          type="button"
                          onClick={() => setKbTypeFilter('all')}
                          className="hover:opacity-75 cursor-pointer font-bold ml-0.5"
                          title={tx('Убрать фильтр по типу', 'Remove type filter')}
                        >
                          ×
                        </button>
                      </span>
                    )}
                    {kbMvpFilter !== 'all' && (
                      <span
                        style={{
                          borderColor: 'var(--ctx-pos-border)',
                          backgroundColor: 'var(--ctx-pos-soft)',
                          color: 'var(--ctx-pos-text)',
                        }}
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] mono"
                      >
                        <span>
                          {kbMvpFilter === 'mvp' ? tx('Только MVP', 'MVP only') : tx('Потом', 'Later')}
                        </span>
                        <button
                          type="button"
                          onClick={() => setKbMvpFilter('all')}
                          className="hover:opacity-75 cursor-pointer font-bold ml-0.5"
                          title={tx('Убрать фильтр MVP', 'Remove MVP filter')}
                        >
                          ×
                        </button>
                      </span>
                    )}
                  </div>
                )}

                {aiContextIds.length > 1 && (
                  <div
                    style={{
                      borderColor: 'var(--ctx-pos-border)',
                      backgroundColor: 'var(--ctx-pos-soft)',
                      color: 'var(--ctx-pos-text)',
                    }}
                    className="px-2 py-1 rounded border mono text-[10px] flex items-center justify-between gap-1"
                  >
                    <span className="truncate">
                      {tx('Фокус ИИ', 'AI focus')}: {aiContextIds.length} {tx('элем.', 'elements')} · {tx('в запрос включены только выбранные элементы', 'only selected elements are sent')}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setAiContextIds(selectedId ? [selectedId] : [])
                      }
                      className="underline cursor-pointer shrink-0"
                    >
                      {tx('Сброс', 'Reset')}
                    </button>
                  </div>
                )}
              </div>

              <div
                className="flex-1 overflow-y-auto flex flex-col"
                onContextMenu={(e) => {
                  if (
                    e.target === e.currentTarget ||
                    (e.target as HTMLElement).classList.contains('kb-empty-area')
                  ) {
                    handleOpenContextMenu(e, { type: 'empty' });
                  }
                }}
              >
                {/* Render subfolders with nested files */}
                {Array.from(
                  new Set([
                    ...customFolders,
                    ...files
                      .filter((f) => f.includes('/'))
                      .map((f) => f.split('/')[0]),
                  ])
                ).map((folderName) => {
                  const folderFiles = files.filter((f) =>
                    f.startsWith(`${folderName}/`)
                  );
                  const folderElems = filteredElements.filter((e) =>
                    e.fileName.startsWith(`${folderName}/`)
                  );
                  const isFolderCollapsed = Boolean(
                    collapsedFolders[folderName]
                  );
                  const isFolderStarred = starredItems.has(folderName);
                  return (
                    <div
                      key={folderName}
                      onContextMenu={(e) =>
                        handleOpenContextMenu(e, {
                          type: 'folder',
                          folderName,
                        })
                      }
                      className="border-b border-[var(--border)] bg-[var(--surface)]"
                    >
                      <div
                        onClick={() =>
                          setCollapsedFolders((prev) => ({
                            ...prev,
                            [folderName]: !prev[folderName],
                          }))
                        }
                        className="flex items-center justify-between px-3 py-2 cursor-pointer select-none font-semibold text-xs text-[var(--ink)] hover:bg-[var(--surface-hover)] transition-colors"
                      >
                        <div className="flex items-center gap-1.5 min-w-0">
                          {isFolderCollapsed ? (
                            <ChevronRight
                              size={13}
                              className="shrink-0 text-[var(--ink-muted)]"
                            />
                          ) : (
                            <ChevronDown
                              size={13}
                              className="shrink-0 text-[var(--ink-muted)]"
                            />
                          )}
                          <Folder
                            size={14}
                            className="shrink-0 text-[var(--accent)]"
                          />
                          <span className="mono truncate">
                            {folderName}/
                          </span>
                          {isFolderStarred && (
                            <span title={tx('Отмечено как важное', 'Marked as important')} className="inline-flex items-center ml-0.5">
                              <Star
                                size={11}
                                style={{
                                  color: 'var(--ctx-neg-text)',
                                  fill: 'var(--ctx-neg-text)',
                                }}
                                className="shrink-0"
                              />
                            </span>
                          )}
                        </div>
                        <span className="pill text-[9px] py-0 px-1.5 mono">
                              {folderFiles.length} {tx('files', 'files')} · {folderElems.length} {tx('elements', 'elements')}
                        </span>
                      </div>

                      {!isFolderCollapsed && (
                        <div className="pl-2 border-l-2 border-[var(--border)] ml-3 my-1 space-y-1">
                          {folderFiles.length === 0 && (
                            <div
                              className="p-2 text-[10px] mono text-[var(--ink-muted)] cursor-default"
                              onContextMenu={(e) =>
                                handleOpenContextMenu(e, {
                                  type: 'folder',
                                  folderName,
                                })
                              }
                            >
                              {tx('Папка пуста (ПКМ — создать файл)', 'Folder is empty (right-click to create a file)')}
                            </div>
                          )}
                          {folderFiles.map((fileName) =>
                            renderExplorerFileItem(fileName, true)
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Root Files (files with no folder prefix) */}
                {files
                  .filter((fileName) => !fileName.includes('/'))
                  .map((fileName) => renderExplorerFileItem(fileName, false))}

                {/* Empty Filler Area (supports Right-Click anywhere on blank space) */}
                <div
                  className="flex-1 min-h-[80px] cursor-default kb-empty-area"
                  title={tx('ПКМ — контекстное меню проводника', 'Right-click for explorer context menu')}
                  onContextMenu={(e) =>
                    handleOpenContextMenu(e, { type: 'empty' })
                  }
                />
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
                    if (!e.ctrlKey && !e.metaKey) {
                      setSelectedId(null);
                      setAiContextIds([]);
                    }
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
                        const line = offsetGraphLine(
                          edge.source,
                          edge.target,
                          p1,
                          p2,
                          mainGraphEdgeOffsets[edgeIdx] ?? 0
                        );

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

                        const midX = (line.x1 + line.x2) / 2;
                        const midY = (line.y1 + line.y2) / 2 - 4;

                        return (
                          <g key={`${edge.id}_${edgeIdx}`}>
                            <line
                              x1={line.x1}
                              y1={line.y1}
                              x2={line.x2}
                              y2={line.y2}
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
                      const isSelectedNode =
                        selectedId === el.id || aiContextIds.includes(el.id);
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
                            handleSelectWithModifiers(
                              el.id,
                              e.ctrlKey || e.metaKey,
                              el.fileName
                            );
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
                          title={`${el.id} — ${el.title} (${tx('двойной клик: открыть в редакторе', 'double-click to open in editor')})`}
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
                    title={tx('Вернуться к редактированию элемента', 'Return to element editor')}
                  >
                    <Minimize2 size={18} />
                  </button>
                  <div
                    style={{ backgroundColor: 'var(--bg)', height: '32px' }}
                    className="pill flex items-center gap-2 px-2.5 py-0"
                      title={tx('Коэффициент отдаления между элементами графа', 'Graph spacing between elements')}
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
                    title={tx('Сбросить масштаб до 1', 'Reset zoom to 1')}
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
                  <div className="label">{tx('ПУСТОЕ РАБОЧЕЕ ПРОСТРАНСТВО', 'EMPTY WORKSPACE')}</div>
                  <h2 className="text-xl font-bold">{tx('В проекте пока нет файлов плана (.pgr)', 'There are no plan files (.pgr) in the project yet')}</h2>
                  <p className="text-xs text-[var(--ink-muted)] max-w-md mx-auto leading-relaxed">
                    {tx('Создайте первый файл разметки .pgr или вставьте готовые блоки из Библиотеки юнитов.', 'Create your first .pgr file or insert ready-made blocks from the Unit Library.')}
                  </p>
                  <div className="flex items-center justify-center gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setFiles(['sys_core.pgr']);
                        setActiveFile('sys_core.pgr');
                        setNewElFile('sys_core.pgr');
                        openNewElementModal();
                      }}
                      className="btn pos"
                    >
                      + {tx('Создать первый файл .pgr', 'Create first .pgr file')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveTab('library')}
                      className="btn"
                    >
                      {tx('Библиотека юнитов', 'Unit Library')}
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
                        title={tx('Открыть граф элементов в основной области', 'Open the element graph in the main area')}
                      >
                        <Maximize2 size={12} />
                        <span>{tx('Граф', 'Graph')}</span>
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
                          ? tx('Текст .pgr', '.pgr text')
                          : tx('Блочная сетка', 'Structured editor')}
                      </button>
                    </div>
                  </div>

                  {/* Display Title in Syne 800 */}
                  <AutoGrowTextarea
                    aria-label={tx('Название элемента', 'Element title')}
                    value={selectedElement.title}
                    onChange={(title) =>
                      updateElement({
                        ...selectedElement,
                        title,
                      })
                    }
                    onKeyDown={(event) => { if (event.key === 'Enter') event.preventDefault(); }}
                    className="title-display element-title-display"
                  />
                  <div
                    className="label"
                    style={{ marginTop: '-12px', display: 'block' }}
                  >
                    UID: {selectedElement.id}
                  </div>

                  {kbEditorMode === 'structured' ? (
                    <StructuredElementFields
                      element={selectedElement}
                      elements={elements}
                      inheritedObjectFields={inheritedObjectFields}
                      typeHeader={TYPE_HEADERS_RU[selectedElement.type]}
                      onChange={updateElement}
                      onRenameId={applyElementIdRename}
                      onCursorLine={setCursorLine}
                      tx={tx}
                    />
                  ) : (
                    /* Raw .pgr line-range mode */
                    <div className="field-grid">
                      <div className="field-row">
                        <div className="field-label">
                          {tx('.pgr Range', '.pgr range')}
                          <span className="ml-2 text-[var(--ink-muted)]">{tx(`(${rawPgrLines.length} строк)`, `(${rawPgrLines.length} lines)`)}</span>
                        </div>
                        <div className="field-value space-y-3">
                          <div className="flex flex-wrap items-end gap-2 rounded border border-[var(--border)] bg-[var(--bg)] p-2.5">
                            <label htmlFor="pgr-range-start" className="space-y-1 text-[11px] text-[var(--ink-muted)]">
                              <span className="block">{tx('С строки', 'From line')}</span>
                              <input id="pgr-range-start" type="number" inputMode="numeric" min={1} max={rawPgrLines.length} value={rangeStartInput} onChange={(event) => setRangeStartInput(event.target.value)} className="sys-input w-24" />
                            </label>
                            <label htmlFor="pgr-range-end" className="space-y-1 text-[11px] text-[var(--ink-muted)]">
                              <span className="block">{tx('По строку', 'To line')}</span>
                              <input id="pgr-range-end" type="number" inputMode="numeric" min={1} max={rawPgrLines.length} value={rangeEndInput} onChange={(event) => setRangeEndInput(event.target.value)} className="sys-input w-24" />
                            </label>
                            <button
                              type="button"
                              disabled={!requestedLineRange}
                              onClick={() => requestedLineRange && setLineRangeFilter({ fileName: selectedElement.fileName, ...requestedLineRange })}
                              className="btn pos"
                            >
                              {tx('Показать диапазон', 'Show range')}
                            </button>
                            {activeLineRangeFilter ? (
                              <button type="button" onClick={() => setLineRangeFilter(null)} className="btn">
                                {tx('Показать все', 'Show all')}
                              </button>
                            ) : null}
                          </div>
                          <p role="status" className="text-[11px] text-[var(--ink-muted)]">
                            {activeLineRangeFilter
                              ? tx(`Показаны строки ${activeLineRangeFilter.start}–${activeLineRangeFilter.end}`, `Showing lines ${activeLineRangeFilter.start}–${activeLineRangeFilter.end}`)
                              : tx('Показан весь файл', 'Showing the full file')}
                            {!requestedLineRange ? tx(' · Проверьте границы диапазона.', ' · Check the range bounds.') : ''}
                          </p>
                          <div className="p-3 border border-[var(--border)] rounded bg-[var(--bg)] max-h-64 overflow-y-auto mono">
                            {rawPgrLines.map((line, idx) => {
                              const num = idx + 1;
                              if (
                                activeLineRangeFilter &&
                                (num < activeLineRangeFilter.start ||
                                  num > activeLineRangeFilter.end)
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

                          <div data-project-editor="true">
                            <Suspense fallback={<div className="text-xs text-[var(--ink-muted)]" aria-busy="true">{tx('Загрузка редактора…', 'Loading editor…')}</div>}>
                              <PgrSourceEditor value={rawPgrDraft} onChange={(value) => updateRawPgrDraft(selectedElement.fileName, value)} fileName={selectedElement.fileName} existingElements={elements} locale={locale} className="w-full" />
                            </Suspense>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              const file = selectedElement.fileName;
                              try {
                                const parsed = parsePgrFileContent(rawPgrDraft, file, elements);
                                setElements((prev) => [
                                  ...prev.filter((x) => x.fileName !== file),
                                  ...parsed,
                                ]);
                                workspace.acceptSource(file, rawPgrDraft);
                            showNotice(`${tx('Разметка', 'Source')} ${file} ${tx('синхронизирована', 'synchronized')}`);
                              } catch (cause) {
                                const message = localizePgrParseError(cause instanceof Error ? cause.message : String(cause), locale);
                                workspace.setError(`${file}: ${message}`);
                                showNotice(`${tx('Ошибки в .pgr', '.pgr errors')}: ${message}`);
                              }
                            }}
                            className="btn pos"
                          >
                            {tx('Применить правки .pgr', 'Apply .pgr edits')}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="p-10 border border-dashed border-[var(--border)] rounded-lg text-center space-y-2 my-8">
                  {kbEditorMode === 'raw_pgr' || Boolean(workspace.sourceErrors[activeFile]) ? (
                    <div className="max-w-3xl mx-auto text-left space-y-3">
                      <div className="label text-[var(--ctx-neg-text)]">{tx('ИСХОДНИК НУЖДАЕТСЯ В ИСПРАВЛЕНИИ', 'SOURCE NEEDS REPAIR')}</div>
                      <p className="text-xs text-[var(--ctx-neg-text)]">{localizePgrParseError(workspace.sourceErrors[activeFile], locale)}</p>
                      <div data-project-editor="true">
                        <Suspense fallback={<div className="text-xs text-[var(--ink-muted)]" aria-busy="true">{tx('Загрузка редактора…', 'Loading editor…')}</div>}>
                          <PgrSourceEditor value={rawPgrDraft} onChange={(value) => updateRawPgrDraft(activeFile, value)} fileName={activeFile} existingElements={elements} locale={locale} className="w-full" />
                        </Suspense>
                      </div>
                      <button type="button" className="btn pos" onClick={() => {
                        try {
                          const parsed = parsePgrFileContent(rawPgrDraft, activeFile, elements);
                          setElements((current) => [...current.filter((element) => element.fileName !== activeFile), ...parsed]);
                          workspace.acceptSource(activeFile, rawPgrDraft);
                          setSelectedId(parsed[0]?.id || null);
                                showNotice(`${tx('Разметка', 'Source')} ${activeFile} ${tx('синхронизирована', 'synchronized')}`);
                        } catch (cause) {
                          const message = localizePgrParseError(cause instanceof Error ? cause.message : String(cause), locale);
                          workspace.stageSource(activeFile, rawPgrDraft, message);
                        }
                      }}>{tx('Проверить и применить исправленный PGR', 'Validate and apply repaired PGR')}</button>
                    </div>
                  ) : (
                    <>
                      <div className="label">{tx('НЕТ ВЫБРАННОГО ЭЛЕМЕНТА', 'NO SELECTION')}</div>
                      <div className="text-sm text-[var(--ink-muted)]">
                      {tx('Выберите элемент в списке слева для просмотра и редактирования', 'Select an element from the list on the left to view and edit it')}
                      </div>
                    </>
                  )}
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
                <ElementAttributesPanel
                  element={selectedElement}
                  locale={locale}
                  usedByIds={usedByIds}
                  confirmingDelete={deleteConfirmId === selectedElement.id}
                  onCollapse={() => setRightPanelOpen(false)}
                  onChange={updateElement}
                  onExpand={() => void runTransformation(selectedElement, 'system_pack')}
                  onRequestDelete={() => setDeleteConfirmId(selectedElement.id)}
                  onConfirmDelete={() => {
                    const id = selectedElement.id;
                    setElements((previous) => deleteElements(previous, [id]));
                    setDeleteConfirmId(null);
                    showNotice(`${tx('Элемент', 'Element')} ${id} ${tx('удалён', 'deleted')}`);
                  }}
                  onCancelDelete={() => setDeleteConfirmId(null)}
                />
              )}
              {/* Obsidian-style Element Graph Section with Type Icons */}
              <div className="sidebar-section">
                <div className="section-title" style={{ marginBottom: '10px' }}>
                  <span>{tx('Вид графа', 'Graph View')}</span>
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
                      title={tx('Переключить между всеми узлами и локальным окружением выбранного элемента', 'Switch between all nodes and the selected element’s local context')}
                    >
                      {miniGraphMode === 'local' ? tx('Локальный', 'Local') : tx('Все', 'All')}
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
                      title={tx('Сбросить вид графа', 'Reset graph view')}
                    >
                      {tx('Сброс', 'Reset')}
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
                          ? tx('Вернуть редактор в основную область', 'Return the editor to the main area')
                          : tx('Открыть граф в основной области', 'Open the graph in the main area')
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
                        title={tx('Свернуть правую панель', 'Collapse right panel')}
                      >
                        <PanelRightClose size={15} />
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 mb-2.5">
                  <span className="mono text-[10px] text-[var(--ink-muted)]">
                    {tx('Коэф. отдаления', 'Zoom ratio')}
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
                      {miniGraphLayout.activeEdges.map((edge, edgeIdx) => {
                        const p1 = miniGraphLayout.posMap[edge.source];
                        const p2 = miniGraphLayout.posMap[edge.target];
                        if (!p1 || !p2) return null;
                        const line = offsetGraphLine(
                          edge.source,
                          edge.target,
                          p1,
                          p2,
                          miniGraphEdgeOffsets[edgeIdx] ?? 0
                        );

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
                            x1={line.x1}
                            y1={line.y1}
                            x2={line.x2}
                            y2={line.y2}
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
                      const isSelectedNode =
                        selectedId === el.id || aiContextIds.includes(el.id);
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
                            handleSelectWithModifiers(
                              el.id,
                              e.ctrlKey || e.metaKey,
                              el.fileName
                            );
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
                          title={`${el.id} — ${el.title} (${tx('двойной клик: открыть на Холсте', 'double-click to open on Canvas')})`}
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

              {aiEnabled && (
                <KnowledgeAiSidebar
                  locale={locale}
                  enabled={aiEnabled}
                  proposals={proposals}
                  contradictions={contradictions}
                  onOpenAssistant={() => setAiActiveModal('hub')}
                  onFixContradiction={handleApplySuggestedFix}
                  onApplyProposal={handleApplyProposal}
                  onRejectProposal={setRejectProposalModal}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* =================================================================
          TAB 2: ХОЛСТ (Pan by LMB on empty area, Zoom by wheel, Non-sticking drag)
         ================================================================= */}
      {activeTab === 'canvas' && <Suspense fallback={<div className="h-full w-full" aria-busy="true" aria-label={tx('Загрузка холста…', 'Loading canvas…')} />}><CanvasWorkspaceView context={canvasContext} /></Suspense>}

      {/* =================================================================
          TAB 3: БИБЛИОТЕКА ЮНИТОВ
         ================================================================= */}
      {activeTab === 'library' && (
        <Suspense fallback={<div className="editor-scroll min-h-0 flex-1 text-sm text-[var(--ink-muted)]" aria-busy="true">{tx('Загрузка библиотеки…', 'Loading library…')}</div>}>
        <UnitLibraryView
          leftPanelOpen={leftPanelOpen}
          setLeftPanelOpen={setLeftPanelOpen}
          locale={locale}
          elements={elements}
          unitLibrary={unitLibrary}
          search={libSearch}
          onSearchChange={setLibSearch}
          category={libCategoryFilter}
          onCategoryChange={setLibCategoryFilter}
          onAddUnit={handleAddUnitToProject}
          onSaveElements={handleQueueLibrarySave}
        />
        </Suspense>
      )}
      {librarySaveQueue.length > 0 ? (
        <Suspense fallback={<div role="status" className="fixed inset-0 z-[100] grid place-items-center bg-black/60 p-4 text-sm text-white">{tx('Загрузка каталога иконок…', 'Loading icon catalog…')}</div>}>
          <LibraryIconPicker
            key={`${librarySaveQueue[0]?.id || 'closed'}-${librarySaveQueue.length}`}
            open
            locale={locale}
            elementType={librarySaveQueue[0]?.type ?? null}
            elementTitle={librarySaveQueue[0]?.title ?? ''}
            defaultIcon={defaultLibraryIcon(librarySaveQueue[0]?.type ?? 'object')}
            selectedIcon={libraryIconDraft}
            queueTotal={librarySaveQueue.length}
            onIconChange={setLibraryIconDraft}
            onConfirm={handleConfirmLibrarySave}
            onClose={() => setLibrarySaveQueue([])}
          />
        </Suspense>
      ) : null}
      {/* =================================================================
          TAB 4: НАСТРОЙКИ (With visual buttons for contextual color pairs)
         ================================================================= */}
      {activeTab === 'settings' && (<div className="editor-scroll min-h-0 flex-1">
        <nav className="flex flex-wrap gap-2 border-b border-[var(--border)] px-4 py-3" aria-label={locale === 'ru' ? 'Разделы настроек' : 'Settings sections'}>
          <button type="button" className={`btn ${activeSettingsSection !== 'git' ? 'primary' : ''}`} aria-pressed={activeSettingsSection !== 'git'} onClick={() => setActiveSettingsSection('theme')}>{locale === 'ru' ? 'Настройки' : 'Preferences'}</button>
          <button type="button" className={`btn ${activeSettingsSection === 'git' ? 'primary' : ''}`} aria-pressed={activeSettingsSection === 'git'} onClick={() => { setActiveSettingsSection('git'); void git.refreshStatus(); }}>{locale === 'ru' ? 'Git' : 'Git'}</button>
        </nav>
        {activeSettingsSection === 'git' ? (
        <NativeGitView available={git.available && gitEnabled} branch={git.branch} locale={locale} branches={git.branches} dirtyFiles={git.dirtyFiles} commits={git.commits.map(({ hash, message, timestamp }) => ({ hash, message, timestamp }))} diff={git.diffText} files={workspace.files} selectedFile={git.selectedFile} error={git.error}
          onRefresh={async () => { await git.refreshStatus(); await git.refreshDiff(); }}
          onCommit={async (message) => { await workspace.runWorkspaceOperation(async () => { await desktopInvoke('git_commit', { message }); await git.refreshStatus(); await git.refreshDiff(); }); }}
          onCheckout={checkoutGitBranch}
          onCreateBranch={async (name) => { await workspace.runWorkspaceOperation(async () => { await desktopInvoke('git_create_branch', { name }); await git.refreshStatus(); }); }}
          onSelectFile={(path) => { git.setSelectedFile(path); void git.refreshDiff(git.baseCommit || git.commits[0]?.hash || 'HEAD', path); }}
          onSelectCommit={(hash) => { git.setBaseCommit(hash); void git.refreshDiff(hash, git.selectedFile); }}
          onRestore={async (hash) => { await workspace.runWorkspaceOperation(async ({ reload }) => { await desktopInvoke('git_restore', { hash }); await reload(); await git.refreshStatus(); }); }} />
      ) : (
        <Suspense fallback={<div className="p-4 text-sm text-[var(--ink-muted)]" aria-busy="true">{tx('Загрузка настроек…', 'Loading settings…')}</div>}><SettingsView desktopAvailable={!workspace.preview} themeMode={themeMode} positivePalette={posPalette} negativePalette={negPalette} locale={locale} gitEnabled={gitEnabled} aiProvider={aiProvider} aiModel={aiModel} customEndpoint={aiEndpoint} hasKey={hasAiApiKey} apiKeyDraft={aiApiKey} chatgptConnected={chatgptConnected} chatgptEmail={chatgptEmail} chatgptModels={chatgptModels}
          rateLimits={{ rpm: aiLimits.rpm, rpd: aiLimits.rpd, tpm: aiLimits.tpm, totalTokens: aiLimits.tt }} usageEvents={usage.events} usageCounts={{ rpm: usage.counts.rpm, rpd: usage.counts.rpd, tpm: usage.counts.tpm, totalTokens: usage.counts.tt }}
          onThemeChange={setThemeMode} onPositivePaletteChange={setPosPalette} onNegativePaletteChange={setNegPalette} onLocaleChange={setLocale} onGitEnabledChange={setGitEnabled} onProviderChange={handleProviderChange} onModelChange={setAiModel} onEndpointChange={setAiEndpoint} onApiKeyDraftChange={setAiApiKey}
          onRateLimitsChange={(limits) => setAiLimits({ rpm: limits.rpm, rpd: limits.rpd, tpm: limits.tpm, tt: limits.totalTokens })} onSaveSettings={handleSaveSettings} onTestProvider={testSavedProvider}
          onChatgptConnect={handleChatgptConnect} onChatgptDisconnect={handleChatgptDisconnect} onChatgptSwitchAccount={handleChatgptSwitchAccount} onChatgptRefreshModels={handleChatgptRefreshModels}
          onResetTotal={handleResetTotalTokens} onSimulate={handleSimulateAiRequest} onRefreshUsage={usage.refresh} /></Suspense>
      )}</div>)}

      {/* =================================================================
          FOOTER STATUSBAR (Variation 5 System Dark)
         ================================================================= */}
      <footer className="sys-footer">
        <div className="flex items-center gap-5">
          <span
            onClick={() => {
              setActiveTab('settings');
              setActiveSettingsSection('git');
            }}
            className="cursor-pointer hover:text-[var(--ink)]"
          >
            {tx('ВЕТКА', 'BRANCH')}: {git.branch || (git.available ? tx('HEAD вне ветки', 'DETACHED HEAD') : '—')}
          </span>
          <span>{git.available ? `${tx('Изменено файлов', 'Modified files')}: ${git.uncommittedChanges}` : workspace.preview ? tx('Изменения предпросмотра сохраняются в браузере', 'Preview changes are saved in the browser') : tx('Статус Git недоступен', 'Git status is unavailable')}</span>
          {statusNotice && (
            <span style={{ color: 'var(--ctx-pos-text)' }}>
              ● {statusNotice}
            </span>
          )}
        </div>

        <div className="flex items-center gap-5">
          {activeTab === 'canvas' && (
            <div className="flex items-center gap-2">
              <span>{tx('МАСШТАБ', 'ZOOM')}: {canvasZoom}%</span>
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
            {tx('Фокус ИИ (Ctrl+ЛКМ)', 'AI focus (Ctrl+click)')}: {' '}
            {aiContextIds.length > 0 ? `${aiContextIds.length} ${tx('ID', 'IDs')}` : tx('Весь проект', 'Entire project')}
          </span>
          <span>
            {tx('ЭЛЕМЕНТЫ', 'ITEMS')}: {filteredElements.length}/{elements.length}
          </span>
        </div>
      </footer>

      {aiActiveModal !== null && (
        <Suspense fallback={<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 text-sm text-white" aria-busy="true">{tx('Загрузка ассистента…', 'Loading assistant…')}</div>}>
          <AiWorkflowDialogs
            activeModal={aiActiveModal}
            locale={locale}
            aiContextIds={aiContextIds}
            contradictionCount={contradictions.length}
            contradictions={contradictions}
            proposals={proposals}
            interviewQuestions={interviewQuestions}
            savedInterviewAnswers={savedInterviewAnswers}
            interviewAnswerDrafts={interviewAnswerDrafts}
            elements={elements}
            transformSourceId={transformSourceId}
            transformPattern={transformPattern}
            transformSummary={transformSummary}
            onSetActiveModal={setAiActiveModal}
            onRunAnalysis={() => { void runAiAnalysis(); }}
            onOpenContradiction={(contradiction) => {
              const target = elements.find((element) => element.id === contradiction.elementIds[0]);
              if (target) {
                setSelectedId(target.id);
                setActiveFile(target.fileName);
                setActiveTab('kb');
              }
              setAiActiveModal(null);
              openConflictPopupFor([contradiction], target?.id);
            }}
            onRunInterview={() => { void runProblemInterview(); }}
            onApplyProposal={handleApplyProposal}
            onRejectProposal={setRejectProposalModal}
            onAnswerDraftsChange={setInterviewAnswerDrafts}
            onSubmitInterviewAnswer={(question, answer) => { void submitInterviewAnswer(question, answer); }}
            onTransformSourceChange={setTransformSourceId}
            onTransformPatternChange={setTransformPattern}
            onRunTransformation={(source, pattern) => { void runTransformation(source, pattern); }}
          />
        </Suspense>
      )}
      {/* =================================================================
          MODAL: Canvas AI Conflict Resolution Popup (Принять / Отклонить / Игнорировать)
         ================================================================= */}
      {activeConflictPopup &&
        activeConflictPopup.contradictions[activeConflictPopup.activeIndex] && (
          <div
            onClick={() => setActiveConflictPopup(null)}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4"
          >
            {(() => {
              const currentConflict =
                activeConflictPopup.contradictions[
                  activeConflictPopup.activeIndex
                ];
              return (
                <div
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    borderColor: 'var(--ctx-neg-border)',
                    boxShadow: '0 16px 48px rgba(0, 0, 0, 0.55)',
                  }}
                  className="w-full max-w-xl border rounded-lg bg-[var(--surface)] overflow-hidden flex flex-col"
                >
                  {/* Popup Header */}
                  <div
                    style={{
                      backgroundColor: 'var(--ctx-neg-soft)',
                      borderColor: 'var(--ctx-neg-border)',
                    }}
                    className="px-5 py-3.5 border-b flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span
                        style={{
                          backgroundColor: 'var(--ctx-neg)',
                          color: '#ffffff',
                        }}
                        className="mono text-[10px] font-semibold px-2 py-0.5 rounded uppercase tracking-wider shrink-0"
                      >
                        {tx('КОНФЛИКТ ИИ', 'AI CONFLICT')} ·{' '}
                        {currentConflict.severity === 'high'
                          ? tx('ВЫСОКИЙ', 'HIGH')
                          : tx('СРЕДНИЙ', 'MEDIUM')}
                      </span>
                      {activeConflictPopup.triggerElementId && (
                        <span className="mono text-xs truncate">
                          {tx('Узел', 'Node')}: {activeConflictPopup.triggerElementId}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {activeConflictPopup.contradictions.length > 1 &&
                        activeConflictPopup.contradictions.map((cItem, idx) => (
                          <button
                            key={cItem.id}
                            type="button"
                            onClick={() => selectConflictPopupIndex(idx)}
                            style={{
                              borderColor:
                                activeConflictPopup.activeIndex === idx
                                  ? 'var(--ctx-neg-text)'
                                  : 'var(--border)',
                              backgroundColor:
                                activeConflictPopup.activeIndex === idx
                                  ? 'var(--ctx-neg-soft)'
                                  : 'var(--bg)',
                              color:
                                activeConflictPopup.activeIndex === idx
                                  ? 'var(--ctx-neg-text)'
                                  : 'var(--ink-muted)',
                            }}
                            className="pill cursor-pointer px-2 py-0.5"
                          >
                            #{idx + 1}
                          </button>
                        ))}
                      <button
                        type="button"
                        onClick={() => setActiveConflictPopup(null)}
                        className="btn py-1 px-2.5 text-[11px]"
                      >
                        {tx('Закрыть', 'Close')}
                      </button>
                    </div>
                  </div>

                  {/* Conflict Form Body */}
                  <div className="p-5 space-y-4 max-h-[76vh] overflow-y-auto">
                    {/* Affected Elements & Citation */}
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="label">{tx('Затронуты:', 'Affected:')}</span>
                        {currentConflict.elementIds.map((eid) => (
                          <button
                            key={eid}
                            type="button"
                            onClick={() => {
                              setSelectedId(eid);
                            }}
                            style={{
                              borderColor: 'var(--ctx-neg-border)',
                              color: 'var(--ctx-neg-text)',
                              backgroundColor: 'var(--ctx-neg-soft)',
                            }}
                            className="pill cursor-pointer hover:opacity-80"
                          >
                            {eid}
                          </button>
                        ))}
                      </div>
                      {currentConflict.fileCitation && (
                        <button
                          type="button"
                          onClick={() => {
                            const match =
                              currentConflict.fileCitation?.match(
                                /^([^:]+):(\d+)-(\d+)$/
                              );
                            if (match) {
                              setActiveFile(match[1]);
                              const start = parseInt(match[2], 10);
                              const end = parseInt(match[3], 10);
                              const citedFileElement = elements.find((element) =>
                                element.fileName === match[1] && currentConflict.elementIds.includes(element.id)
                              ) || elements.find((element) => element.fileName === match[1]);
                              if (citedFileElement) setSelectedId(citedFileElement.id);
                              setLineRangeFilter({ fileName: match[1], start, end });
                              setRangeStartInput(String(start));
                              setRangeEndInput(String(end));
                              setKbEditorMode('raw_pgr');
                              setActiveTab('kb');
                              setActiveConflictPopup(null);
                            }
                          }}
                          className="mono text-[11px] underline cursor-pointer"
                          style={{ color: 'var(--ctx-pos-text)' }}
                        >
                          {tx('Открыть', 'Open')} {currentConflict.fileCitation}
                        </button>
                      )}
                    </div>

                    {/* Conflict Title Input */}
                    <div>
                      <label className="label block mb-1.5">
                        {tx('Название конфликта', 'Conflict title')}
                      </label>
                      <input
                        type="text"
                        value={conflictFormTitle}
                        onChange={(e) => setConflictFormTitle(e.target.value)}
                        className="sys-input w-full font-medium"
                      />
                    </div>

                    {/* Conflict Description Textarea */}
                    <div>
                      <label className="label block mb-1.5">
                        {tx('Описание конфликта', 'Conflict description')}
                      </label>
                      <textarea
                        rows={3}
                        value={conflictFormDesc}
                        onChange={(e) => setConflictFormDesc(e.target.value)}
                        className="sys-input w-full leading-relaxed resize-y"
                      />
                    </div>

                    {/* Proposed Fix Form Section */}
                    <div
                      style={{
                        borderColor: 'var(--ctx-pos-border)',
                        backgroundColor: 'var(--ctx-pos-soft)',
                      }}
                      className="p-3.5 rounded border space-y-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className="label"
                          style={{ color: 'var(--ctx-pos-text)' }}
                        >
                          {currentConflict.suggestedFix
                            ? tx('Проверенный патч', 'Verified patch')
                            : tx('Рекомендация для ручного исправления', 'Guidance for a manual fix')}
                        </span>
                        {currentConflict.suggestedFix?.targetElementId && (
                          <span className="mono text-[11px]">
                            {tx('Цель:', 'Target:')}{' '}
                            <strong style={{ color: 'var(--ink)' }}>
                              {currentConflict.suggestedFix.targetElementId}
                            </strong>
                          </span>
                        )}
                      </div>

                      <div>
                        <label className="label block mb-1">
                        {tx('Пояснение', 'Guidance')}
                        </label>
                        <p className="rounded border border-[var(--border)] bg-[var(--bg)] p-2.5 text-xs leading-relaxed">
                          {conflictFormFix}
                        </p>
                      </div>

                      {currentConflict.suggestedFix && (
                        <div>
                          <label className="label block mb-1">
                            {tx('Действие патча', 'Patch action')} ({currentConflict.suggestedFix.fixLabel})
                          </label>
                          <pre className="p-2.5 rounded border border-[var(--border)] bg-[var(--bg)] mono text-[11px] overflow-x-auto">
                            {JSON.stringify(
                              currentConflict.suggestedFix.patch,
                              null,
                              2
                            )}
                          </pre>
                        </div>
                      )}
                    </div>

                    {/* Optional Comment / Rejection Reason */}
                    <div>
                      <label className="label block mb-1.5">
                        {tx('Комментарий / причина (при отклонении сохранит в Идеи-образы)', 'Comment / reason (rejection saves this as an Idea)')}
                      </label>
                      <input
                        type="text"
                        placeholder={tx('Опционально: почему отклонено или примечание к решению...', 'Optional: why it was rejected or a note about the decision...')}
                        value={conflictFormComment}
                        onChange={(e) => setConflictFormComment(e.target.value)}
                        className="sys-input w-full"
                      />
                    </div>

                    {/* Action Choice: Принять / Отклонить / Игнорировать */}
                    <div className="pt-2 border-t border-[var(--border)] flex items-center gap-2.5">
                      <button
                        type="button"
                        onClick={handleAcceptConflictFix}
                        disabled={!currentConflict.suggestedFix}
                        title={!currentConflict.suggestedFix
                          ? tx('Проверенный патч для этого конфликта недоступен.', 'No verified patch is available for this finding.')
                          : undefined}
                        className="btn pos flex-1 py-2.5"
                      >
                        {currentConflict.suggestedFix
                          ? tx('Применить патч', 'Apply patch')
                          : tx('Патч недоступен', 'No verified patch')}
                      </button>
                      <button
                        type="button"
                        onClick={handleRejectConflict}
                        className="btn neg flex-1 py-2.5"
                      >
                        {tx('Отклонить', 'Reject')}
                      </button>
                      <button
                        type="button"
                        onClick={handleIgnoreConflict}
                        className="btn flex-1 py-2.5"
                      >
                        {tx('Игнорировать', 'Ignore')}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        )}

      {/* =================================================================
          MODAL: Reject Proposal as Idea (with alt_to & alt_reason)
         ================================================================= */}
      {rejectProposalModal && (
        <Dialog
          open={Boolean(rejectProposalModal)}
          title={tx('Отклонить предложение в Идею-образ', 'Reject proposal as an Idea')}
          onClose={() => setRejectProposalModal(null)}
          closeLabel={tx('Закрыть', 'Close')}
          actions={<div className="btn-group">
            <button
              type="button"
              disabled={!rejectReasonInput.trim()}
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
          </div>}
        >
            <div className="space-y-4">
            <div className="mono">
              {tx('Будет создана Идея-образ с полями', 'An Idea will be created with fields')}{' '}
              <code>alt_to: {rejectProposalModal.targetElementId || '-'}</code>{' '}
              {tx('и', 'and')} <code>alt_reason</code>.
            </div>
            <input
              type="text"
              placeholder={tx('Причина отказа (alt_reason)...', 'Reason for rejection (alt_reason)...')}
              aria-label={tx('Причина отклонения', 'Rejection reason')}
              value={rejectReasonInput}
              onChange={(e) => setRejectReasonInput(e.target.value)}
              className="sys-input w-full"
            />
            </div>
        </Dialog>
      )}

      {/* =================================================================
          MODAL: Create New Plan Element
         ================================================================= */}
      {newElementModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div role="dialog" aria-modal="true" aria-labelledby="create-element-title" className="w-full max-w-md border border-[var(--border)] rounded-lg bg-[var(--surface)] p-5 space-y-4">
            <div className="section-title" id="create-element-title">
              <span>{tx('Создать новый элемент плана', 'Create plan element')}</span>
            </div>

            <div className="space-y-3">
              <div>
                <label className="label mb-1 block" htmlFor="new-element-type">{tx('Тип элемента', 'Element type')}</label>
                <select
                  id="new-element-type"
                  value={newElType}
                  onChange={(e) => setNewElType(e.target.value as ElementType)}
                  className="sys-input w-full"
                >
                  <option value="system">{tx('Система (sys_)', 'System (sys_)')}</option>
                  <option value="class">{tx('Класс (cls_)', 'Class (cls_)')}</option>
                  <option value="process">{tx('Процесс-функция (proc_)', 'Process function (proc_)')}</option>
                  <option value="component">{tx('Компонент (cmp_)', 'Component (cmp_)')}</option>
                  <option value="object">{tx('Объект (obj_)', 'Object (obj_)')}</option>
                  <option value="idea">{tx('Идея-образ (idea_)', 'Idea (idea_)')}</option>
                </select>
              </div>

              <div>
                <label className="label mb-1 block" htmlFor="new-element-title">{tx('Название', 'Title')}</label>
                <input
                  id="new-element-title"
                  type="text"
                  placeholder={tx('Например: Зелье лечения', 'For example: Healing potion')}
                  value={newElTitle}
                  onChange={(e) => setNewElTitle(e.target.value)}
                  className="sys-input w-full"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="label mb-1">
                    <label htmlFor="new-element-id">ID ({TYPE_PREFIXES[newElType]}...)</label>
                  </div>
                  <input
                    id="new-element-id"
                    type="text"
                    placeholder="healing_potion"
                    value={newElSlug}
                    onChange={(e) => setNewElSlug(e.target.value)}
                    className="sys-input w-full mono"
                  />
                </div>
                <div>
                  <label className="label mb-1 block" htmlFor="new-element-file">{tx('Файл .pgr', '.pgr file')}</label>
                  <select
                    id="new-element-file"
                    value={newElFile}
                    onChange={(e) => setNewElFile(e.target.value)}
                    className="sys-input w-full mono"
                  >
                    {(files.length > 0 ? files : [newElFile || 'sys_core.pgr']).map(
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
                  <label className="label mb-1 block" htmlFor="new-element-parent">{tx('Родитель (parent)', 'Parent')}</label>
                  <select
                    id="new-element-parent"
                    value={newElParent}
                    onChange={(e) => setNewElParent(e.target.value)}
                    className="sys-input w-full mono"
                  >
                    <option value="-">{tx('- (без родителя)', '- (no parent)')}</option>
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
                <span>{tx('Метка фазы MVP', 'MVP phase')}</span>
              </label>
            </div>

            <div className="btn-group">
              <button
                type="button"
                onClick={handleCreateElement}
                className="btn pos flex-1"
              >
                {locale === 'ru' ? 'Создать' : 'Create'}
              </button>
              <button
                type="button"
                onClick={() => setNewElementModalOpen(false)}
                className="btn neg flex-1"
              >
                {locale === 'ru' ? 'Отмена' : 'Cancel'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =================================================================
          CONTEXT MENU: Knowledge Base File Explorer
         ================================================================= */}
      {kbContextMenu && (
        <div
          style={{
            top: `${kbContextMenu.y}px`,
            left: `${kbContextMenu.x}px`,
          }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
          className="fixed z-50 min-w-[220px] max-w-[270px] py-1 bg-[var(--surface)] text-[var(--ink)] border border-[var(--border)] rounded-lg shadow-2xl text-xs select-none backdrop-blur-md animate-in fade-in zoom-in-95 duration-75"
        >
          {/* Target header tag */}
          <div className="px-3 py-1.5 border-b border-[var(--border)] text-[10px] mono text-[var(--ink-muted)] flex items-center justify-between gap-1.5 bg-[var(--surface-hover)]">
            <span className="truncate">
              {kbContextMenu.target.type === 'file'
                ? `${tx('Файл', 'File')}: ${kbContextMenu.target.fileName}`
                : kbContextMenu.target.type === 'element'
                ? `${tx('Узел', 'Node')}: ${kbContextMenu.target.elementId}`
                : kbContextMenu.target.type === 'folder'
                ? `${tx('Папка', 'Folder')}: ${kbContextMenu.target.folderName}/`
                : `${tx('Проект', 'Project')}: ${projectRootFolder}/`}
            </span>
            {isItemStarred(kbContextMenu.target) && (
              <Star
                size={11}
                style={{
                  color: 'var(--ctx-neg-text)',
                  fill: 'var(--ctx-neg-text)',
                }}
                className="shrink-0"
              />
            )}
          </div>

          {kbContextMenu.target.type === 'empty' ? (
            /* Context menu on empty area */
            <div className="p-1 space-y-0.5">
              {/* Создать новый... -> Submenu */}
              <div
                className="relative group px-2.5 py-1.5 rounded hover:bg-[var(--surface-hover)] cursor-pointer flex items-center justify-between text-xs transition-colors"
                onMouseEnter={() => setKbSubmenuOpen(true)}
                onMouseLeave={() => setKbSubmenuOpen(false)}
              >
                <div className="flex items-center gap-2">
                  <Plus size={14} className="text-[var(--accent)]" />
                  <span>{tx('Создать новый...', 'Create new...')}</span>
                </div>
                <ChevronRight size={12} className="text-[var(--ink-muted)]" />

                {kbSubmenuOpen && (
                  <div className="absolute left-[96%] top-0 min-w-[160px] py-1 bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-2xl z-50 text-xs">
                    <button
                      type="button"
                      onClick={() => {
                        setKbContextMenu(null);
                        handleOpenNewResource('file');
                      }}
                      className="w-full text-left px-3 py-1.5 hover:bg-[var(--surface-hover)] flex items-center gap-2 text-[var(--ink)] cursor-pointer"
                    >
                      <FilePlus size={13} className="text-[var(--accent)]" />
                      <span>{tx('Файл (.pgr)', 'File (.pgr)')}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setKbContextMenu(null);
                        handleOpenNewResource('folder');
                      }}
                      className="w-full text-left px-3 py-1.5 hover:bg-[var(--surface-hover)] flex items-center gap-2 text-[var(--ink)] cursor-pointer"
                    >
                      <FolderPlus size={13} className="text-[var(--accent)]" />
                      <span>{tx('Каталог (папка)', 'Directory (folder)')}</span>
                    </button>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => {
                  setKbContextMenu(null);
                  handleCollapseAll();
                }}
                className="w-full text-left px-2.5 py-1.5 rounded hover:bg-[var(--surface-hover)] flex items-center gap-2 text-xs text-[var(--ink)] cursor-pointer transition-colors"
              >
                <ChevronRight size={14} className="text-[var(--ink-muted)]" />
                <span>{tx('Свернуть все', 'Collapse all')}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setKbContextMenu(null);
                  handleExpandAll();
                }}
                className="w-full text-left px-2.5 py-1.5 rounded hover:bg-[var(--surface-hover)] flex items-center gap-2 text-xs text-[var(--ink)] cursor-pointer transition-colors"
              >
                <ChevronDown size={14} className="text-[var(--ink-muted)]" />
                <span>{tx('Развернуть все', 'Expand all')}</span>
              </button>

              <div className="border-t border-[var(--border)] my-1" />

              <button
                type="button"
                onClick={() => {
                  setKbContextMenu(null);
                  handleShowInExplorer({ type: 'empty' });
                }}
                className="w-full text-left px-2.5 py-1.5 rounded hover:bg-[var(--surface-hover)] flex items-center gap-2 text-xs text-[var(--ink)] cursor-pointer transition-colors"
              >
                <Folder size={14} className="text-[var(--accent)]" />
                <span>{tx('Показать в Проводнике', 'Show in Explorer')}</span>
              </button>
            </div>
          ) : (
            /* Context menu on file / element / folder */
            <div className="p-1 space-y-0.5">
              {/* Создать новый... -> Submenu */}
              <div
                className="relative group px-2.5 py-1.5 rounded hover:bg-[var(--surface-hover)] cursor-pointer flex items-center justify-between text-xs transition-colors"
                onMouseEnter={() => setKbSubmenuOpen(true)}
                onMouseLeave={() => setKbSubmenuOpen(false)}
              >
                <div className="flex items-center gap-2">
                  <Plus size={14} className="text-[var(--accent)]" />
                  <span>{tx('Создать новый...', 'Create new...')}</span>
                </div>
                <ChevronRight size={12} className="text-[var(--ink-muted)]" />

                {kbSubmenuOpen && (
                  <div className="absolute left-[96%] top-0 min-w-[160px] py-1 bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-2xl z-50 text-xs">
                    <button
                      type="button"
                      onClick={() => {
                        setKbContextMenu(null);
                        const parentFolder =
                          kbContextMenu.target.type === 'folder'
                            ? kbContextMenu.target.folderName
                            : kbContextMenu.target.type === 'file' &&
                              kbContextMenu.target.fileName.includes('/')
                            ? kbContextMenu.target.fileName.split('/')[0]
                            : undefined;
                        handleOpenNewResource('file', parentFolder);
                      }}
                      className="w-full text-left px-3 py-1.5 hover:bg-[var(--surface-hover)] flex items-center gap-2 text-[var(--ink)] cursor-pointer"
                    >
                      <FilePlus size={13} className="text-[var(--accent)]" />
                      <span>{tx('Файл (.pgr)', 'File (.pgr)')}</span>
                    </button>
                    {kbContextMenu.target.type === 'file' ? (
                      <button
                        type="button"
                        onClick={() => {
                          const target = kbContextMenu.target;
                          if (target.type !== 'file') return;
                          setKbContextMenu(null);
                          openNewElementModal(target.fileName);
                        }}
                        className="w-full text-left px-3 py-1.5 hover:bg-[var(--surface-hover)] flex items-center gap-2 text-[var(--ink)] cursor-pointer"
                      >
                        <Plus size={13} className="text-[var(--accent)]" />
                        <span>{tx('Элемент', 'Element')}</span>
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => {
                        setKbContextMenu(null);
                        handleOpenNewResource('folder');
                      }}
                      className="w-full text-left px-3 py-1.5 hover:bg-[var(--surface-hover)] flex items-center gap-2 text-[var(--ink)] cursor-pointer"
                    >
                      <FolderPlus size={13} className="text-[var(--accent)]" />
                      <span>{tx('Каталог (папка)', 'Directory (folder)')}</span>
                    </button>
                  </div>
                )}
              </div>

              {kbContextMenu.target.type === 'file' && contextFileLibrary && (() => {
                const removeFromLibrary = contextFileLibrary.elementCount > 0 && contextFileLibrary.missingCount === 0;
                const disabled = contextFileLibrary.elementCount === 0;
                return (
                  <button
                    type="button"
                    disabled={disabled}
                    title={disabled ? tx('В файле пока нет элементов', 'This file has no elements yet') : undefined}
                    onClick={() => {
                      const fileName = contextFileLibrary.fileName;
                      setKbContextMenu(null);
                      handleToggleFileLibrary(fileName);
                    }}
                    className={`w-full text-left px-2.5 py-1.5 rounded flex items-center gap-2 text-xs transition-colors ${
                      disabled
                        ? 'opacity-40 cursor-not-allowed text-[var(--ink-muted)]'
                        : removeFromLibrary
                          ? 'hover:bg-[var(--ctx-neg-soft)] text-[var(--ctx-neg-text)] cursor-pointer'
                          : 'hover:bg-[var(--surface-hover)] text-[var(--ink)] cursor-pointer'
                    }`}
                  >
                    {removeFromLibrary
                      ? <Trash2 size={14} className="text-[var(--ctx-neg-text)]" />
                      : <Plus size={14} className="text-[var(--accent)]" />}
                    <span>{removeFromLibrary ? tx('Удалить из библиотеки', 'Remove from library') : tx('Добавить в библиотеку', 'Add to library')}</span>
                    {contextFileLibrary.elementCount > 0 && contextFileLibrary.missingCount > 0 && (
                      <span className="ml-auto text-[10px] mono text-[var(--ink-muted)]">
                        {contextFileLibrary.elementCount - contextFileLibrary.missingCount}/{contextFileLibrary.elementCount}
                      </span>
                    )}
                  </button>
                );
              })()}

              {kbContextMenu.target.type === 'element' && contextElementLibrary && (
                <button
                  type="button"
                  disabled={!contextElementLibrary.exists}
                  onClick={() => {
                    const elementId = contextElementLibrary.elementId;
                    setKbContextMenu(null);
                    handleToggleElementLibrary(elementId);
                  }}
                  className={`w-full text-left px-2.5 py-1.5 rounded flex items-center gap-2 text-xs transition-colors ${
                    !contextElementLibrary.exists
                      ? 'opacity-40 cursor-not-allowed text-[var(--ink-muted)]'
                      : contextElementLibrary.saved
                        ? 'hover:bg-[var(--ctx-neg-soft)] text-[var(--ctx-neg-text)] cursor-pointer'
                        : 'hover:bg-[var(--surface-hover)] text-[var(--ink)] cursor-pointer'
                  }`}
                >
                  {contextElementLibrary.saved
                    ? <Trash2 size={14} className="text-[var(--ctx-neg-text)]" />
                    : <Plus size={14} className="text-[var(--accent)]" />}
                  <span>{contextElementLibrary.saved ? tx('Удалить из библиотеки', 'Remove from library') : tx('Добавить в библиотеку', 'Add to library')}</span>
                </button>
              )}

              {/* Переименовать */}
              <button
                type="button"
                onClick={() => {
                  const target = kbContextMenu.target;
                  setKbContextMenu(null);
                  handleStartRename(target);
                }}
                className="w-full text-left px-2.5 py-1.5 rounded hover:bg-[var(--surface-hover)] flex items-center gap-2 text-xs text-[var(--ink)] cursor-pointer transition-colors"
              >
                <Edit2 size={14} className="text-[var(--ink-muted)]" />
                <span>{tx('Переименовать', 'Rename')}</span>
              </button>

              {/* Удалить (только для файла) */}
              {kbContextMenu.target.type === 'file' && (
                <button
                  type="button"
                  onClick={() => {
                    const fileName =
                      kbContextMenu.target.type === 'file'
                        ? kbContextMenu.target.fileName
                        : '';
                    setKbContextMenu(null);
                    handleDeleteFile(fileName);
                  }}
                  className="w-full text-left px-2.5 py-1.5 rounded hover:bg-[var(--ctx-neg-soft)] text-[var(--ctx-neg-text)] flex items-center gap-2 text-xs cursor-pointer transition-colors"
                >
                  <Trash2 size={14} className="text-[var(--ctx-neg-text)]" />
                  <span>{tx('Удалить', 'Delete')}</span>
                </button>
              )}
              {kbContextMenu.target.type === 'folder' && (
                <button type="button" onClick={() => { const folder = kbContextMenu.target.type === 'folder' ? kbContextMenu.target.folderName : ''; setKbContextMenu(null); handleDeleteFolder(folder); }} className="w-full text-left px-2.5 py-1.5 rounded hover:bg-[var(--ctx-neg-soft)] text-[var(--ctx-neg-text)] flex items-center gap-2 text-xs cursor-pointer">
                  <Trash2 size={14} />
                  <span>{tx('Удалить папку и содержимое', 'Delete folder and contents')}</span>
                </button>
              )}

              {/* Вырезать */}
              <button
                type="button"
                onClick={() => {
                  const target = kbContextMenu.target;
                  setKbContextMenu(null);
                  handleCut(target);
                }}
                className="w-full text-left px-2.5 py-1.5 rounded hover:bg-[var(--surface-hover)] flex items-center justify-between text-xs text-[var(--ink)] cursor-pointer transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Scissors size={14} className="text-[var(--ink-muted)]" />
                <span>{tx('Вырезать', 'Cut')}</span>
                </div>
                <span className="text-[10px] mono text-[var(--ink-muted)]">Ctrl+X</span>
              </button>

              {/* Скопировать */}
              <button
                type="button"
                onClick={() => {
                  const target = kbContextMenu.target;
                  setKbContextMenu(null);
                  handleCopy(target);
                }}
                className="w-full text-left px-2.5 py-1.5 rounded hover:bg-[var(--surface-hover)] flex items-center justify-between text-xs text-[var(--ink)] cursor-pointer transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Copy size={14} className="text-[var(--ink-muted)]" />
                <span>{tx('Скопировать', 'Copy')}</span>
                </div>
                <span className="text-[10px] mono text-[var(--ink-muted)]">Ctrl+C</span>
              </button>

              {/* Вставить (если что-то уже скопировано или вырезано) */}
              <button
                type="button"
                disabled={!kbClipboard}
                onClick={() => {
                  const target = kbContextMenu.target;
                  setKbContextMenu(null);
                  handlePaste(target);
                }}
                className={`w-full text-left px-2.5 py-1.5 rounded flex items-center justify-between text-xs transition-colors ${
                  kbClipboard
                    ? 'hover:bg-[var(--surface-hover)] text-[var(--ink)] cursor-pointer'
                    : 'opacity-40 cursor-not-allowed text-[var(--ink-muted)]'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Clipboard size={14} className="text-[var(--ink-muted)]" />
                  <span>
                    {tx('Вставить', 'Paste')}
                    {kbClipboard ? ` (${kbClipboard.mode === 'cut' ? tx('вырез.', 'cut') : tx('копия', 'copy')})` : ''}
                  </span>
                </div>
                <span className="text-[10px] mono text-[var(--ink-muted)]">Ctrl+V</span>
              </button>

              {/* Дублировать */}
              <button
                type="button"
                onClick={() => {
                  const target = kbContextMenu.target;
                  setKbContextMenu(null);
                  handleDuplicate(target);
                }}
                className="w-full text-left px-2.5 py-1.5 rounded hover:bg-[var(--surface-hover)] flex items-center gap-2 text-xs text-[var(--ink)] cursor-pointer transition-colors"
              >
                <CopyPlus size={14} className="text-[var(--ink-muted)]" />
                <span>{tx('Дублировать', 'Duplicate')}</span>
              </button>

              <div className="border-t border-[var(--border)] my-1" />

              {/* Показать в Проводнике */}
              <button
                type="button"
                onClick={() => {
                  const target = kbContextMenu.target;
                  setKbContextMenu(null);
                  handleShowInExplorer(target);
                }}
                className="w-full text-left px-2.5 py-1.5 rounded hover:bg-[var(--surface-hover)] flex items-center gap-2 text-xs text-[var(--ink)] cursor-pointer transition-colors"
              >
                <Folder size={14} className="text-[var(--accent)]" />
                <span>{tx('Показать в Проводнике', 'Show in Explorer')}</span>
              </button>

              {/* Отметить как важное / Снять отметку */}
              <button
                type="button"
                onClick={() => {
                  const target = kbContextMenu.target;
                  setKbContextMenu(null);
                  handleToggleImportant(target);
                }}
                className="w-full text-left px-2.5 py-1.5 rounded hover:bg-[var(--surface-hover)] flex items-center gap-2 text-xs text-[var(--ink)] cursor-pointer transition-colors"
              >
                {isItemStarred(kbContextMenu.target) ? (
                  <>
                    <StarOff
                      size={14}
                      style={{ color: 'var(--ctx-neg-text)' }}
                      className="shrink-0"
                    />
                    <span>{tx('Снять отметку', 'Remove bookmark')}</span>
                  </>
                ) : (
                  <>
                    <Star
                      size={14}
                      style={{
                        color: 'var(--ctx-neg-text)',
                        fill: 'var(--ctx-neg-text)',
                      }}
                      className="shrink-0"
                    />
                    <span>{tx('Отметить как важное', 'Mark as important')}</span>
                  </>
                )}
              </button>

              <div className="border-t border-[var(--border)] my-1" />

              {/* Скопировать относительный путь */}
              <button
                type="button"
                onClick={() => {
                  const target = kbContextMenu.target;
                  setKbContextMenu(null);
                  handleCopyPath(target, 'relative');
                }}
                className="w-full text-left px-2.5 py-1.5 rounded hover:bg-[var(--surface-hover)] flex items-center gap-2 text-xs text-[var(--ink)] cursor-pointer transition-colors"
              >
                <Link size={14} className="text-[var(--ink-muted)]" />
                <span>{tx('Скопировать относительный путь', 'Copy relative path')}</span>
              </button>

              {/* Скопировать путь */}
              <button
                type="button"
                onClick={() => {
                  const target = kbContextMenu.target;
                  setKbContextMenu(null);
                  handleCopyPath(target, 'full');
                }}
                className="w-full text-left px-2.5 py-1.5 rounded hover:bg-[var(--surface-hover)] flex items-center gap-2 text-xs text-[var(--ink)] cursor-pointer transition-colors"
              >
                <Link size={14} className="text-[var(--accent)]" />
                <span>{tx('Скопировать путь', 'Copy path')}</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* =================================================================
          MODAL: Rename File or Element
         ================================================================= */}
      {renameModal && (
        <Dialog
          open={Boolean(renameModal)}
          title={renameModal.type === 'file'
            ? tx('Переименовать файл', 'Rename file')
            : renameModal.type === 'folder' ? tx('Переименовать папку', 'Rename folder') : tx('Переименовать элемент', 'Rename element')}
          onClose={() => setRenameModal(null)}
          closeLabel={tx('Закрыть', 'Close')}
          actions={<div className="btn-group">
            <button type="button" onClick={handleConfirmRename} className="btn pos flex-1">{tx('Сохранить', 'Save')}</button>
            <button type="button" onClick={() => setRenameModal(null)} className="btn neg flex-1">{tx('Отмена', 'Cancel')}</button>
          </div>}
        >
          <div className="space-y-4">
            <div className="mono text-xs text-[var(--ink-muted)]">
              {tx('Текущее имя', 'Current name')}: <code>{renameModal.currentName}</code>
            </div>
            <input
              type="text"
              aria-label={renameModal.type === 'file'
                ? tx('Новое имя файла', 'New file name')
                : renameModal.type === 'folder' ? tx('Новое имя папки', 'New folder name') : tx('Новый ID элемента', 'New element ID')}
              placeholder={renameModal.type === 'file'
                ? tx('Новое имя файла (e.g. sys_new.pgr)...', 'New file name (e.g. sys_new.pgr)...')
                : renameModal.type === 'folder' ? tx('Новое имя папки...', 'New folder name...') : tx('Новый ID элемента...', 'New element ID...')}
              value={renameModal.newName}
              onChange={(e) => setRenameModal((prev) => prev ? { ...prev, newName: e.target.value } : null)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleConfirmRename();
                if (e.key === 'Escape') setRenameModal(null);
              }}
              autoFocus
              className="sys-input w-full mono"
            />
          </div>
        </Dialog>
      )}

      {/* =================================================================
          MODAL: Create New File / Folder Resource
         ================================================================= */}
      {newResourceModal && (
        <Dialog
          open={Boolean(newResourceModal)}
          title={newResourceModal.type === 'file'
            ? tx('Создать новый файл .pgr', 'Create new .pgr file')
            : tx('Создать новый каталог (папку)', 'Create new directory (folder)')}
          onClose={() => setNewResourceModal(null)}
          closeLabel={tx('Закрыть', 'Close')}
          actions={<div className="btn-group">
            <button type="button" onClick={handleCreateResourceConfirm} className="btn pos flex-1">{tx('Создать', 'Create')}</button>
            <button type="button" onClick={() => setNewResourceModal(null)} className="btn neg flex-1">{tx('Отмена', 'Cancel')}</button>
          </div>}
        >
          <div className="space-y-4">
            {newResourceModal.parentFolder && (
              <div className="mono text-xs text-[var(--ink-muted)]">
                {tx('В каталоге', 'In directory')}: <code>{newResourceModal.parentFolder}/</code>
              </div>
            )}
            <input
              type="text"
              aria-label={newResourceModal.type === 'file' ? tx('Имя файла', 'File name') : tx('Имя папки', 'Folder name')}
              placeholder={newResourceModal.type === 'file'
                ? tx('Имя файла (e.g. sys_module_2.pgr)...', 'File name (e.g. sys_module_2.pgr)...')
                : tx('Имя папки (e.g. systems, core, entities)...', 'Folder name (e.g. systems, core, entities)...')}
              value={newResourceModal.name}
              onChange={(e) => setNewResourceModal((prev) => prev ? { ...prev, name: e.target.value } : null)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateResourceConfirm();
                if (e.key === 'Escape') setNewResourceModal(null);
              }}
              autoFocus
              className="sys-input w-full mono"
            />
          </div>
        </Dialog>
      )}

      {/* =================================================================
          MODAL: Delete File Confirmation
         ================================================================= */}
      {deleteFileConfirm && (
        <Dialog
          open={Boolean(deleteFileConfirm)}
          title={tx('Удаление файла', 'Delete file')}
          description={tx('Все элементы, привязанные к этому файлу, также будут удалены.', 'All elements assigned to this file will also be deleted.')}
          onClose={() => setDeleteFileConfirm(null)}
          closeLabel={tx('Закрыть', 'Close')}
          actions={<div className="btn-group">
            <button type="button" onClick={handleConfirmDeleteFile} className="btn neg flex-1">{tx('Удалить файл', 'Delete file')}</button>
            <button type="button" onClick={() => setDeleteFileConfirm(null)} className="btn flex-1">{tx('Отмена', 'Cancel')}</button>
          </div>}
        >
          <p className="text-xs">{tx('Вы действительно хотите удалить файл', 'Are you sure you want to delete file')} <code>{deleteFileConfirm}</code>?</p>
        </Dialog>
      )}
      {deleteFolderConfirm && (
        <Dialog
          open={Boolean(deleteFolderConfirm)}
          title={tx('Удаление папки', 'Delete folder')}
          onClose={() => setDeleteFolderConfirm(null)}
          closeLabel={tx('Закрыть', 'Close')}
          actions={<div className="btn-group">
            <button type="button" className="btn neg flex-1" onClick={handleConfirmDeleteFolder}>{tx('Удалить папку', 'Delete folder')}</button>
            <button type="button" className="btn flex-1" onClick={() => setDeleteFolderConfirm(null)}>{tx('Отмена', 'Cancel')}</button>
          </div>}
        >
          <p className="text-xs">{tx('Удалить папку', 'Delete folder')} <code>{deleteFolderConfirm}</code> {tx('и все её файлы и элементы?', 'and all its files and elements?')}</p>
        </Dialog>
      )}
      {pendingAiReview && (
        <AiChangeReviewDialog
          locale={locale}
          summary={pendingAiReview.summary}
          createdElements={pendingAiReview.kind === 'transform' ? pendingAiReview.createdElements : undefined}
          before={pendingAiReview.kind === 'patch' ? pendingAiReview.before : undefined}
          patch={pendingAiReview.kind === 'patch' ? pendingAiReview.patch : undefined}
          onApply={applyPendingAiReview}
          onDiscard={() => setPendingAiReview(null)}
        />
      )}
    </div>
  );
}

export default App;

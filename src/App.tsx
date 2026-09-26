import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Bookmark,
  FolderPlus,
  Layers,
  Palette,
  Plus,
  Search,
  Settings,
  Sparkles,
  X,
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
  ThemeMode,
  UnitLibraryItem,
} from './types/planager';
import {
  I18N_DICTIONARY,
  INITIAL_ELEMENTS,
  INITIAL_UNIT_LIBRARY,
  NEGATIVE_PALETTES,
  POSITIVE_PALETTES,
} from './data/initialProject';
import {
  buildAndValidateGraph,
  serializeFileWithRanges,
  TYPE_HEADERS_RU,
  TYPE_PREFIXES,
} from './utils/pgrCodec';
import { generateLocalTransformation } from './utils/aiEngine';
import { CanvasView } from './components/CanvasView';
import { ElementInspector } from './components/ElementInspector';
import { KnowledgeBaseView } from './components/KnowledgeBaseView';
import { AiAssistantPanel } from './components/AiAssistantPanel';
import {
  GitVersionView,
  UnitLibraryView,
} from './components/UnitLibraryAndGitView';

type ActiveWorkspaceTab = 'canvas' | 'kb' | 'library' | 'git' | 'ai';

function createSnapshotMap(elements: PlanElement[], files: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const f of files) {
    map[f] = serializeFileWithRanges(elements, f).content;
  }
  return map;
}

export function App() {
  // Core Plan State
  const [elements, setElements] = useState<PlanElement[]>(INITIAL_ELEMENTS);
  const [files, setFiles] = useState<string[]>([
    'inventory.pgr',
    'combat_alchemy.pgr',
    'factions_npc.pgr',
    'ideas_backlog.pgr',
  ]);
  const [activeFile, setActiveFile] = useState<string>('inventory.pgr');
  const [selectedId, setSelectedId] = useState<string | null>('cls_item');
  const [aiContextIds, setAiContextIds] = useState<string[]>([
    'cls_item',
    'obj_rust_sword',
  ]);
  const [highlightedLineRange, setHighlightedLineRange] = useState<{
    start: number;
    end: number;
  } | null>(null);

  // Navigation & Filtering
  const [activeTab, setActiveTab] = useState<ActiveWorkspaceTab>('canvas');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [mvpFilter, setMvpFilter] = useState<'all' | 'mvp' | 'later'>('all');
  const [typeFilter, setTypeFilter] = useState<ElementType | 'all'>('all');

  // Unit Library & Git History
  const [unitLibrary, setUnitLibrary] =
    useState<UnitLibraryItem[]>(INITIAL_UNIT_LIBRARY);
  const [commits, setCommits] = useState<GitCommit[]>(() => [
    {
      id: 'commit_init',
      hash: 'a1b4f90',
      message: 'Инициализация ядра плана (.pgr): Инвентарь, Алхимия, Фракции',
      timestamp: '2026-09-26 09:30',
      author: 'Архитектор проекта',
      filesSnapshot: createSnapshotMap(INITIAL_ELEMENTS, [
        'inventory.pgr',
        'combat_alchemy.pgr',
        'factions_npc.pgr',
        'ideas_backlog.pgr',
      ]),
      elementsSnapshot: INITIAL_ELEMENTS,
    },
  ]);

  // Visual Theme, Contextual Color Pairs, Localization, Optional AI Toggle
  const [themeMode, setThemeMode] = useState<ThemeMode>('dark');
  const [posPalette, setPosPalette] = useState<PositivePaletteKey>('emerald');
  const [negPalette, setNegPalette] = useState<NegativePaletteKey>('crimson');
  const [locale, setLocale] = useState<LocaleKey>('ru');
  const [aiEnabled, setAiEnabled] = useState<boolean>(true);
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);
  const [newElementModalOpen, setNewElementModalOpen] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // New Element Modal fields
  const [createType, setCreateType] = useState<ElementType>('class');
  const [createTitle, setCreateTitle] = useState<string>('');
  const [createSlug, setCreateSlug] = useState<string>('');
  const [createFile, setCreateFile] = useState<string>('inventory.pgr');
  const [createParent, setCreateParent] = useState<string>('sys_inventory');
  const [createMvp, setCreateMvp] = useState<boolean>(true);

  const t = I18N_DICTIONARY[locale];

  const notify = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 3200);
  };

  // Apply Theme & Contextual Color Pair CSS Variables to :root
  useEffect(() => {
    const root = document.documentElement;
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const isDark =
      themeMode === 'dark' || (themeMode === 'system' && prefersDark);

    if (isDark) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }

    const pos = POSITIVE_PALETTES[posPalette];
    const neg = NEGATIVE_PALETTES[negPalette];

    root.style.setProperty('--ctx-pos', pos.main);
    root.style.setProperty('--ctx-pos-hover', pos.hover);
    root.style.setProperty('--ctx-pos-soft', pos.soft);
    root.style.setProperty('--ctx-pos-border', pos.border);
    root.style.setProperty('--ctx-pos-text', pos.text);

    root.style.setProperty('--ctx-neg', neg.main);
    root.style.setProperty('--ctx-neg-hover', neg.hover);
    root.style.setProperty('--ctx-neg-soft', neg.soft);
    root.style.setProperty('--ctx-neg-border', neg.border);
    root.style.setProperty('--ctx-neg-text', neg.text);
  }, [themeMode, posPalette, negPalette]);

  // Filtered elements for Search, MVP tag, and Type filter
  const filteredElements = useMemo(() => {
    return elements.filter((el) => {
      if (mvpFilter === 'mvp' && !el.mvp) return false;
      if (mvpFilter === 'later' && el.mvp) return false;
      if (typeFilter !== 'all' && el.type !== typeFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const inTitle = el.title.toLowerCase().includes(q);
        const inId = el.id.toLowerCase().includes(q);
        const inDesc = el.description.toLowerCase().includes(q);
        const inFields = (el.fields || []).some((f) =>
          f.name.toLowerCase().includes(q)
        );
        return inTitle || inId || inDesc || inFields;
      }
      return true;
    });
  }, [elements, mvpFilter, typeFilter, searchQuery]);

  const { edges, warnings } = useMemo(
    () => buildAndValidateGraph(filteredElements),
    [filteredElements]
  );

  const selectedElement = useMemo(
    () => elements.find((e) => e.id === selectedId) || null,
    [elements, selectedId]
  );

  // Handlers
  const handleUpdateElement = (updated: PlanElement) => {
    setElements((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
  };

  const handleUpdatePosition = (id: string, pos: { x: number; y: number }) => {
    setElements((prev) =>
      prev.map((e) => (e.id === id ? { ...e, position: pos } : e))
    );
  };

  const handleDeleteElement = (id: string) => {
    setElements((prev) => prev.filter((e) => e.id !== id));
    if (selectedId === id) setSelectedId(null);
    setAiContextIds((prev) => prev.filter((x) => x !== id));
    notify(`Элемент ${id} удалён из плана`);
  };

  const handleToggleAiContext = (id: string) => {
    setAiContextIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  // Drag-and-drop connection creation on Canvas following the 6 relation rules in Section 1
  const handleConnectElements = (sourceId: string, targetId: string) => {
    const src = elements.find((e) => e.id === sourceId);
    const tgt = elements.find((e) => e.id === targetId);
    if (!src || !tgt) return;

    // 1. Система -> любой элемент ('contains')
    if (src.type === 'system' && tgt.type !== 'system') {
      handleUpdateElement({ ...tgt, parent: src.id });
      notify(`Связь contains: ${tgt.id} помещён в Систему ${src.id}`);
      return;
    }

    // 2. Класс -> Класс ('extends')
    if (src.type === 'class' && tgt.type === 'class') {
      handleUpdateElement({ ...src, extendsId: tgt.id });
      notify(`Связь extends: ${src.id} наследует ${tgt.id}`);
      return;
    }

    // 3. Объект -> Класс ('instance_of')
    if (src.type === 'object' && tgt.type === 'class') {
      handleUpdateElement({ ...src, instanceOf: tgt.id });
      notify(`Связь instance_of: ${src.id} экземпляр класса ${tgt.id}`);
      return;
    }

    // 4. Класс/Процесс/Компонент/Объект -> Компонент ('has')
    if (
      ['class', 'process', 'component', 'object'].includes(src.type) &&
      tgt.type === 'component'
    ) {
      const nextCmp = Array.from(new Set([...(src.components || []), tgt.id]));
      handleUpdateElement({ ...src, components: nextCmp });
      notify(`Связь has: компонент ${tgt.id} добавлен к ${src.id}`);
      return;
    }

    // 5. Идея-образ -> любой элемент ('notes')
    if (src.type === 'idea') {
      const nextNotes = Array.from(new Set([...(src.notes || []), tgt.id]));
      handleUpdateElement({ ...src, notes: nextNotes });
      notify(`Связь notes: идея ${src.id} аннотирует ${tgt.id}`);
      return;
    }

    // 6. Процесс-функция (или Класс) -> любой элемент ('uses')
    if (src.type === 'process' || src.type === 'class') {
      const nextUses = Array.from(new Set([...(src.uses || []), tgt.id]));
      handleUpdateElement({ ...src, uses: nextUses });
      notify(`Связь uses: ${src.id} взаимодействует с ${tgt.id}`);
      return;
    }

    notify('Для этой пары типов прямое ребро не предусмотрено таблицей отношений');
  };

  // Auto-layout elements cleanly by type/hierarchy
  const handleAutoLayout = () => {
    const typeOrder: ElementType[] = [
      'system',
      'component',
      'class',
      'process',
      'object',
      'idea',
    ];
    const nextElements = [...elements];
    typeOrder.forEach((t, colIdx) => {
      const group = nextElements.filter((e) => e.type === t);
      group.forEach((el, rowIdx) => {
        el.position = {
          x: 70 + colIdx * 340,
          y: 70 + rowIdx * 235,
        };
      });
    });
    setElements(nextElements);
    notify('Выполнена автоматическая укладка графа по ролям элементов');
  };

  const handleOpenInKnowledgeBase = (fileName: string, elementId: string) => {
    setActiveFile(fileName);
    setSelectedId(elementId);
    const { ranges } = serializeFileWithRanges(elements, fileName);
    const found = ranges.find((r) => r.elementId === elementId);
    if (found) {
      setHighlightedLineRange({ start: found.startLine, end: found.endLine });
    } else {
      setHighlightedLineRange(null);
    }
    setActiveTab('kb');
  };

  const handleOpenCitationLineRange = (
    fileName: string,
    startLine: number,
    endLine: number,
    elementId?: string
  ) => {
    if (files.includes(fileName)) {
      setActiveFile(fileName);
    }
    if (elementId) {
      setSelectedId(elementId);
    }
    setHighlightedLineRange({ start: startLine, end: endLine });
    setActiveTab('kb');
  };

  const handleCreateQuickElement = (type: ElementType, targetFileName?: string) => {
    const fileToUse = targetFileName || activeFile || files[0] || 'plan.pgr';
    if (!files.includes(fileToUse)) {
      setFiles((prev) => [...prev, fileToUse]);
    }
    const prefix = TYPE_PREFIXES[type];
    const count = elements.filter((e) => e.type === type).length + 1;
    const newId = `${prefix}new_${count}`;
    const newEl: PlanElement = {
      id: newId,
      type,
      title: `Новый элемент (${TYPE_HEADERS_RU[type]})`,
      fileName: fileToUse,
      parent: type === 'system' ? '-' : 'sys_inventory',
      description: 'Опишите назначение и основные правила элемента.',
      status: 'черновик',
      mvp: true,
      position: {
        x: 160 + (elements.length % 4) * 320,
        y: 140 + Math.floor(elements.length / 4) * 230,
      },
      extendsId: type === 'class' ? '-' : undefined,
      fields:
        type === 'class'
          ? [{ name: 'id_tag', dataType: 'string', description: 'ключ объекта' }]
          : undefined,
      methods:
        type === 'class'
          ? [{ visibility: '+', signature: 'execute()', description: 'основное действие' }]
          : undefined,
      steps:
        type === 'process'
          ? ['Проверить входное условие', 'Выполнить действие над целевым объектом']
          : undefined,
      interfaceItems:
        type === 'component'
          ? ['value: float — основной параметр компонента']
          : undefined,
      internalLogic:
        type === 'component'
          ? ['Обновляет состояние при каждом вызове']
          : undefined,
      instanceOf: type === 'object' ? 'cls_item' : undefined,
      values:
        type === 'object'
          ? [{ fieldName: 'name', value: '"Экземпляр предмета"' }]
          : undefined,
      notes: type === 'idea' ? [] : undefined,
    };

    setElements((prev) => [...prev, newEl]);
    setSelectedId(newEl.id);
    notify(`Создан элемент ${newEl.id} в файле ${fileToUse}`);
  };

  const handleSaveModalNewElement = () => {
    const prefix = TYPE_PREFIXES[createType];
    const cleanSlug =
      createSlug
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '_')
        .replace(/^(sys_|cls_|proc_|cmp_|obj_|idea_)/, '') ||
      `item_${elements.length + 1}`;
    const finalId = `${prefix}${cleanSlug}`;
    const targetFile = createFile || files[0] || 'main.pgr';

    if (!files.includes(targetFile)) {
      setFiles((prev) => [...prev, targetFile]);
    }

    const newEl: PlanElement = {
      id: finalId,
      type: createType,
      title: createTitle.trim() || `${TYPE_HEADERS_RU[createType]} ${finalId}`,
      fileName: targetFile,
      parent: createType === 'system' ? '-' : createParent || '-',
      description: 'Описание созданного элемента плана.',
      status: 'черновик',
      mvp: createMvp,
      position: { x: 240, y: 220 },
      extendsId: createType === 'class' ? '-' : undefined,
      instanceOf: createType === 'object' ? 'cls_item' : undefined,
      fields: createType === 'class' ? [] : undefined,
      methods: createType === 'class' ? [] : undefined,
      steps: createType === 'process' ? ['Шаг 1'] : undefined,
      interfaceItems: createType === 'component' ? ['param: float — параметр'] : undefined,
      internalLogic: createType === 'component' ? ['Внутреннее правило'] : undefined,
      values: createType === 'object' ? [] : undefined,
      notes: createType === 'idea' ? [] : undefined,
    };

    setElements((prev) => [...prev, newEl]);
    setSelectedId(newEl.id);
    setNewElementModalOpen(false);
    setCreateTitle('');
    setCreateSlug('');
    notify(`Добавлен элемент ${newEl.id}`);
  };

  const handleSaveToUnitLibrary = (el: PlanElement) => {
    const { fileName: _f, position: _p, ...rest } = el;
    const item: UnitLibraryItem = {
      unitId: `unit_${el.id}_${Date.now()}`,
      category: TYPE_HEADERS_RU[el.type],
      savedAt: new Date().toISOString().slice(0, 10),
      element: rest,
    };
    setUnitLibrary((prev) => [item, ...prev]);
    notify(`«${el.title}» сохранён в Библиотеку юнитов`);
  };

  const handleInsertUnitIntoProject = (unit: UnitLibraryItem, targetFile: string) => {
    const finalFile = files.includes(targetFile)
      ? targetFile
      : files[0] || 'inventory.pgr';
    if (!files.includes(finalFile)) {
      setFiles([finalFile]);
      setActiveFile(finalFile);
    }

    const exists = elements.some((e) => e.id === unit.element.id);
    const newId = exists
      ? `${unit.element.id}_${elements.length + 1}`
      : unit.element.id;

    const newEl: PlanElement = {
      ...unit.element,
      id: newId,
      fileName: finalFile,
      position: {
        x: 200 + (elements.length % 3) * 320,
        y: 180 + Math.floor(elements.length / 3) * 220,
      },
    };
    setElements((prev) => [...prev, newEl]);
    setSelectedId(newEl.id);
    setActiveTab('canvas');
    notify(`Юнит ${newEl.id} вставлен в файл ${finalFile}`);
  };

  const handleCreateGitCommit = (message: string) => {
    const hash = Math.random().toString(16).slice(2, 9);
    const now = new Date();
    const ts = `${now.toISOString().slice(0, 10)} ${now
      .toTimeString()
      .slice(0, 5)}`;
    const newCommit: GitCommit = {
      id: `commit_${Date.now()}`,
      hash,
      message,
      timestamp: ts,
      author: 'Архитектор проекта',
      filesSnapshot: createSnapshotMap(elements, files),
      elementsSnapshot: JSON.parse(JSON.stringify(elements)),
    };
    setCommits((prev) => [newCommit, ...prev]);
    notify(`Создан коммит #${hash}: ${message}`);
  };

  const handleRestoreGitCommit = (commit: GitCommit) => {
    setElements(JSON.parse(JSON.stringify(commit.elementsSnapshot)));
    setFiles(Object.keys(commit.filesSnapshot));
    notify(`Рабочая копия восстановлена к коммиту #${commit.hash}`);
  };

  // AI Proposal & Transformation Handlers
  const handleApplyProposal = (proposal: AiProposalCard) => {
    if (!proposal.suggestedElement) return;
    const se = proposal.suggestedElement;
    const targetFile = se.fileName || activeFile || files[0] || 'inventory.pgr';
    if (!files.includes(targetFile)) {
      setFiles((prev) => [...prev, targetFile]);
    }

    const newEl: PlanElement = {
      id: se.id,
      type: se.type,
      title: se.title,
      fileName: targetFile,
      parent: se.parent || '-',
      description: se.description,
      status: 'черновик',
      mvp: se.mvp ?? true,
      position: { x: 820, y: 260 + (elements.length % 3) * 200 },
      steps: se.steps,
      components: se.components,
      uses: se.uses,
      interfaceItems: se.interfaceItems,
      internalLogic: se.internalLogic,
      instanceOf: se.instanceOf,
      values: se.values,
    };

    setElements((prev) => [...prev, newEl]);
    setSelectedId(newEl.id);
    notify(`Предложение ИИ применено: добавлен ${newEl.id}`);
  };

  const handleRejectProposalAsIdea = (proposal: AiProposalCard, reason: string) => {
    const ideaFile = files.includes('ideas_backlog.pgr')
      ? 'ideas_backlog.pgr'
      : files[0] || 'ideas.pgr';
    const rejectedIdea: PlanElement = {
      id: `idea_rej_${Date.now().toString().slice(-4)}`,
      type: 'idea',
      title: `Отклонённый вариант: ${proposal.title}`,
      fileName: ideaFile,
      parent: '-',
      description: proposal.rationale,
      status: 'черновик',
      mvp: false,
      position: { x: 1150, y: 920 },
      notes: proposal.targetElementId ? [proposal.targetElementId] : [],
      altTo: proposal.targetElementId || '-',
      altReason: reason,
    };
    setElements((prev) => [...prev, rejectedIdea]);
    notify(`Записана отклонённая Идея-образ (${rejectedIdea.id}) с причиной отказа`);
  };

  const handleApplyContradictionFix = (c: AiContradiction) => {
    if (!c.suggestedFix) return;
    const { targetElementId, patch } = c.suggestedFix;
    setElements((prev) =>
      prev.map((el) => (el.id === targetElementId ? { ...el, ...patch } : el))
    );
    notify(`Противоречие устранено в элементе ${targetElementId}`);
  };

  const handleAnswerInterviewQuestion = (
    question: AiInterviewQuestion,
    answer: string
  ) => {
    const targetId = question.targetElementId;
    if (targetId) {
      setElements((prev) =>
        prev.map((el) =>
          el.id === targetId
            ? {
                ...el,
                description: `${el.description}\n\n[Уточнение правил]: ${answer}`,
              }
            : el
        )
      );
      notify(`Правило добавлено в ${targetId}`);
    }
  };

  const handleApplyTransformation = (
    createdElements: PlanElement[],
    sourceId: string
  ) => {
    setElements((prev) => {
      const updatedSource = prev.map((el) => {
        if (el.id === sourceId && el.type === 'idea') {
          const addedNotes = createdElements.map((c) => c.id);
          return {
            ...el,
            notes: Array.from(new Set([...(el.notes || []), ...addedNotes])),
          };
        }
        return el;
      });
      const existingIds = new Set(updatedSource.map((e) => e.id));
      const uniqueNew = createdElements.filter((c) => !existingIds.has(c.id));
      return [...updatedSource, ...uniqueNew];
    });
    if (createdElements[0]) {
      setSelectedId(createdElements[0].id);
    }
    notify(
      `Развёрнуто элементов: ${createdElements.length} (связь с ${sourceId} сохранена)`
    );
  };

  const isProjectEmpty = files.length === 0 || elements.length === 0;

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden">
      {/* =====================================================================
          TOP BAR CONTRACT (Strictly 3 Zones: Brand | 4-5 Nav Links | 1-2 Actions)
         ===================================================================== */}
      <header
        className="flex items-center justify-between px-6 py-3 border-b shrink-0"
        style={{
          backgroundColor: 'var(--bg-surface)',
          borderColor: 'var(--border-hairline)',
        }}
      >
        {/* Zone 1: Brand Title (Single text element wordmark) */}
        <a
          href="#canvas"
          onClick={(e) => {
            e.preventDefault();
            setActiveTab('canvas');
          }}
          className="text-lg font-bold tracking-tight"
          style={{ color: 'var(--text-primary)' }}
        >
          Planager
        </a>

        {/* Zone 2: Clean Text Navigation Links */}
        <nav className="flex items-center gap-6 text-sm font-medium">
          <button
            type="button"
            onClick={() => setActiveTab('canvas')}
            className="pb-0.5 border-b-2 transition-colors whitespace-nowrap cursor-pointer"
            style={{
              borderColor:
                activeTab === 'canvas' ? 'var(--ctx-pos)' : 'transparent',
              color:
                activeTab === 'canvas'
                  ? 'var(--text-primary)'
                  : 'var(--text-secondary)',
            }}
          >
            {t.navCanvas}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('kb')}
            className="pb-0.5 border-b-2 transition-colors whitespace-nowrap cursor-pointer"
            style={{
              borderColor:
                activeTab === 'kb' ? 'var(--ctx-pos)' : 'transparent',
              color:
                activeTab === 'kb'
                  ? 'var(--text-primary)'
                  : 'var(--text-secondary)',
            }}
          >
            {t.navKnowledgeBase}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('library')}
            className="pb-0.5 border-b-2 transition-colors whitespace-nowrap cursor-pointer"
            style={{
              borderColor:
                activeTab === 'library' ? 'var(--ctx-pos)' : 'transparent',
              color:
                activeTab === 'library'
                  ? 'var(--text-primary)'
                  : 'var(--text-secondary)',
            }}
          >
            {t.navUnitLibrary}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('git')}
            className="pb-0.5 border-b-2 transition-colors whitespace-nowrap cursor-pointer"
            style={{
              borderColor:
                activeTab === 'git' ? 'var(--ctx-pos)' : 'transparent',
              color:
                activeTab === 'git'
                  ? 'var(--text-primary)'
                  : 'var(--text-secondary)',
            }}
          >
            {t.navGit}
          </button>

          {aiEnabled && (
            <button
              type="button"
              onClick={() => setActiveTab('ai')}
              className="pb-0.5 border-b-2 transition-colors whitespace-nowrap cursor-pointer"
              style={{
                borderColor:
                  activeTab === 'ai' ? 'var(--ctx-pos)' : 'transparent',
                color:
                  activeTab === 'ai'
                    ? 'var(--text-primary)'
                    : 'var(--text-secondary)',
              }}
            >
              {t.navAi}
            </button>
          )}
        </nav>

        {/* Zone 3: 2 Primary Actions (+ Element, Settings) */}
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => setNewElementModalOpen(true)}
            className="px-3.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 whitespace-nowrap btn-ctx-pos cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{t.newElement}</span>
          </button>

          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="p-2 rounded-lg border cursor-pointer"
            style={{
              backgroundColor: 'var(--bg-subtle)',
              borderColor: 'var(--border-hairline)',
              color: 'var(--text-primary)',
            }}
            title="Настройки темы, контекстных пар цветов, локализации и проекта"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* =====================================================================
          SUB-BAR: Search, MVP Phase Filter, Type Filter, Validation & Project Switcher
         ===================================================================== */}
      <div
        className="px-6 py-2 border-b flex items-center justify-between gap-4 flex-wrap text-xs shrink-0"
        style={{
          backgroundColor: 'var(--bg-subtle)',
          borderColor: 'var(--border-hairline)',
        }}
      >
        {/* Left: Search & Interactive Filter Controls */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative">
            <Search
              className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2"
              style={{ color: 'var(--text-muted)' }}
            />
            <input
              type="text"
              placeholder={t.searchPlaceholder}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 pr-3 py-1 rounded border text-xs w-60 focus:outline-none"
              style={{
                backgroundColor: 'var(--bg-surface)',
                borderColor: 'var(--border-hairline)',
                color: 'var(--text-primary)',
              }}
            />
          </div>

          {/* Interactive MVP Segmented Control */}
          <div
            className="flex items-center p-0.5 rounded border"
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'var(--border-hairline)',
            }}
          >
            <button
              type="button"
              onClick={() => setMvpFilter('all')}
              className="px-2.5 py-1 rounded text-[11px] whitespace-nowrap cursor-pointer"
              style={{
                backgroundColor:
                  mvpFilter === 'all' ? 'var(--bg-subtle)' : 'transparent',
                fontWeight: mvpFilter === 'all' ? 600 : 400,
              }}
            >
              {t.filterAll}
            </button>
            <button
              type="button"
              onClick={() => setMvpFilter('mvp')}
              className="px-2.5 py-1 rounded text-[11px] whitespace-nowrap cursor-pointer"
              style={{
                backgroundColor:
                  mvpFilter === 'mvp' ? 'var(--ctx-pos-soft)' : 'transparent',
                color:
                  mvpFilter === 'mvp' ? 'var(--ctx-pos)' : 'var(--text-primary)',
                fontWeight: mvpFilter === 'mvp' ? 600 : 400,
              }}
            >
              {t.filterMvpOnly}
            </button>
            <button
              type="button"
              onClick={() => setMvpFilter('later')}
              className="px-2.5 py-1 rounded text-[11px] whitespace-nowrap cursor-pointer"
              style={{
                backgroundColor:
                  mvpFilter === 'later' ? 'var(--bg-subtle)' : 'transparent',
                fontWeight: mvpFilter === 'later' ? 600 : 400,
              }}
            >
              {t.filterPostMvp}
            </button>
          </div>

          {/* Element Type Filter */}
          <select
            value={typeFilter}
            onChange={(e) =>
              setTypeFilter(e.target.value as ElementType | 'all')
            }
            className="px-2.5 py-1 rounded border text-xs"
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'var(--border-hairline)',
              color: 'var(--text-primary)',
            }}
          >
            <option value="all">Все типы элементов ({elements.length})</option>
            {(
              ['system', 'class', 'process', 'component', 'object', 'idea'] as ElementType[]
            ).map((et) => (
              <option key={et} value={et}>
                {TYPE_HEADERS_RU[et]}
              </option>
            ))}
          </select>
        </div>

        {/* Right: Graph Integrity Status & Empty Project Demo Switcher */}
        <div className="flex items-center gap-3 font-mono-tabular text-[11px]">
          {warnings.length > 0 && (
            <span
              className="inline-flex items-center gap-1"
              style={{ color: 'var(--ctx-neg)' }}
              title={warnings.map((w) => w.message).join('\n')}
            >
              <AlertCircle className="w-3.5 h-3.5" />
              Нарушений связей: {warnings.length}
            </span>
          )}

          <span style={{ color: 'var(--text-muted)' }}>
            Файлов .pgr: {files.length} · Узлов: {filteredElements.length} · Рёбер:{' '}
            {edges.length}
          </span>

          <span aria-hidden="true" style={{ color: 'var(--text-muted)' }}>
            ·
          </span>

          {!isProjectEmpty ? (
            <button
              type="button"
              onClick={() => {
                setElements([]);
                setFiles([]);
                setSelectedId(null);
                notify('Открыт новый пустой проект без файлов .pgr');
              }}
              className="underline hover:opacity-80 cursor-pointer"
              style={{ color: 'var(--text-secondary)' }}
              title="Проверить пустое состояние нового проекта без файлов"
            >
              Новый пустой проект
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setElements(INITIAL_ELEMENTS);
                setFiles([
                  'inventory.pgr',
                  'combat_alchemy.pgr',
                  'factions_npc.pgr',
                  'ideas_backlog.pgr',
                ]);
                setActiveFile('inventory.pgr');
                setSelectedId('cls_item');
                notify('Загружен демонстрационный проект «Хроники Эфира»');
              }}
              className="underline font-medium cursor-pointer"
              style={{ color: 'var(--ctx-pos)' }}
            >
              Вернуть демо-проект
            </button>
          )}
        </div>
      </div>

      {/* =====================================================================
          MAIN WORKSPACE VIEWPORT (Handles Explicit Empty State per Section 2)
         ===================================================================== */}
      {isProjectEmpty && activeTab !== 'library' ? (
        <main className="flex-1 flex items-center justify-center p-8">
          <div
            className="max-w-lg w-full p-8 rounded-xl border text-center space-y-5"
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'var(--border-hairline)',
            }}
          >
            <div
              className="w-12 h-12 rounded-xl mx-auto flex items-center justify-center"
              style={{
                backgroundColor: 'var(--ctx-pos-soft)',
                color: 'var(--ctx-pos)',
              }}
            >
              <FolderPlus className="w-6 h-6" />
            </div>

            <div className="space-y-2">
              <h2 className="text-lg font-semibold">{t.emptyProjectTitle}</h2>
              <p
                className="text-xs leading-relaxed"
                style={{ color: 'var(--text-secondary)' }}
              >
                {t.emptyProjectSubtitle}
              </p>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => {
                  const firstFile = 'architecture.pgr';
                  setFiles([firstFile]);
                  setActiveFile(firstFile);
                  handleCreateQuickElement('system', firstFile);
                }}
                className="w-full sm:w-auto px-4 py-2 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 btn-ctx-pos cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>{t.createFirstFile}</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('library')}
                className="w-full sm:w-auto px-4 py-2 rounded-lg text-xs font-medium border flex items-center justify-center gap-1.5 cursor-pointer"
                style={{
                  backgroundColor: 'var(--bg-subtle)',
                  borderColor: 'var(--border-hairline)',
                }}
              >
                <Bookmark className="w-4 h-4" />
                <span>{t.openUnitLibrary}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setElements(INITIAL_ELEMENTS);
                  setFiles([
                    'inventory.pgr',
                    'combat_alchemy.pgr',
                    'factions_npc.pgr',
                    'ideas_backlog.pgr',
                  ]);
                  setActiveFile('inventory.pgr');
                  setSelectedId('cls_item');
                }}
                className="w-full sm:w-auto px-4 py-2 rounded-lg text-xs font-medium border flex items-center justify-center gap-1.5 cursor-pointer"
                style={{
                  backgroundColor: 'var(--bg-subtle)',
                  borderColor: 'var(--border-hairline)',
                }}
              >
                <Layers className="w-4 h-4" />
                <span>{t.loadDemoProject}</span>
              </button>
            </div>
          </div>
        </main>
      ) : (
        <main className="flex-1 flex overflow-hidden">
          {activeTab === 'canvas' && (
            <>
              <div className="flex-1 h-full overflow-hidden">
                <CanvasView
                  elements={filteredElements}
                  edges={edges}
                  selectedId={selectedId}
                  aiContextIds={aiContextIds}
                  onSelectElement={(id) => setSelectedId(id)}
                  onToggleAiContext={handleToggleAiContext}
                  onUpdateElementPosition={handleUpdatePosition}
                  onConnectElements={handleConnectElements}
                  onAutoLayout={handleAutoLayout}
                  onOpenInKnowledgeBase={handleOpenInKnowledgeBase}
                  onCreateElementAt={(type) => handleCreateQuickElement(type)}
                />
              </div>

              {selectedElement && (
                <ElementInspector
                  element={selectedElement}
                  allElements={elements}
                  files={files}
                  isAiPinned={aiContextIds.includes(selectedElement.id)}
                  onUpdateElement={handleUpdateElement}
                  onDeleteElement={handleDeleteElement}
                  onSaveToUnitLibrary={handleSaveToUnitLibrary}
                  onOpenInKnowledgeBase={handleOpenInKnowledgeBase}
                  onToggleAiContext={handleToggleAiContext}
                  onTransformElement={(el, pattern) => {
                    const res = generateLocalTransformation(el, pattern);
                    handleApplyTransformation(res.createdElements, el.id);
                  }}
                  onClose={() => setSelectedId(null)}
                />
              )}
            </>
          )}

          {activeTab === 'kb' && (
            <>
              <KnowledgeBaseView
                elements={elements}
                files={files}
                activeFile={activeFile}
                selectedElementId={selectedId}
                aiContextIds={aiContextIds}
                highlightedLineRange={highlightedLineRange}
                onSelectFile={(f) => {
                  setActiveFile(f);
                  setHighlightedLineRange(null);
                }}
                onCreateFile={(newF) => {
                  if (!files.includes(newF)) {
                    setFiles((prev) => [...prev, newF]);
                  }
                  setActiveFile(newF);
                  handleCreateQuickElement('system', newF);
                }}
                onSelectElement={(id) => setSelectedId(id)}
                onToggleAiContext={handleToggleAiContext}
                onApplyRawPgrEdit={(fileName, parsedFromFile) => {
                  setElements((prev) => [
                    ...prev.filter((e) => e.fileName !== fileName),
                    ...parsedFromFile,
                  ]);
                  notify(`Файл ${fileName} синхронизирован с графом элементов`);
                }}
                onCreateElementInFile={(fileName, type) =>
                  handleCreateQuickElement(type, fileName)
                }
                onSetLineRange={setHighlightedLineRange}
              />

              {selectedElement && (
                <ElementInspector
                  element={selectedElement}
                  allElements={elements}
                  files={files}
                  isAiPinned={aiContextIds.includes(selectedElement.id)}
                  onUpdateElement={handleUpdateElement}
                  onDeleteElement={handleDeleteElement}
                  onSaveToUnitLibrary={handleSaveToUnitLibrary}
                  onOpenInKnowledgeBase={handleOpenInKnowledgeBase}
                  onToggleAiContext={handleToggleAiContext}
                  onTransformElement={(el, pattern) => {
                    const res = generateLocalTransformation(el, pattern);
                    handleApplyTransformation(res.createdElements, el.id);
                  }}
                  onClose={() => setSelectedId(null)}
                />
              )}
            </>
          )}

          {activeTab === 'library' && (
            <UnitLibraryView
              units={unitLibrary}
              files={files.length > 0 ? files : ['inventory.pgr']}
              activeFile={activeFile}
              onInsertUnitIntoProject={handleInsertUnitIntoProject}
              onDeleteUnit={(unitId) =>
                setUnitLibrary((prev) =>
                  prev.filter((u) => u.unitId !== unitId)
                )
              }
            />
          )}

          {activeTab === 'git' && (
            <GitVersionView
              elements={elements}
              files={files}
              commits={commits}
              onCreateCommit={handleCreateGitCommit}
              onRestoreCommit={handleRestoreGitCommit}
            />
          )}

          {activeTab === 'ai' && aiEnabled && (
            <AiAssistantPanel
              elements={elements}
              files={files}
              aiContextIds={aiContextIds}
              onToggleAiContext={handleToggleAiContext}
              onClearAiContext={() => setAiContextIds([])}
              onApplyProposal={handleApplyProposal}
              onRejectProposalAsIdea={handleRejectProposalAsIdea}
              onApplyContradictionFix={handleApplyContradictionFix}
              onAnswerInterviewQuestion={handleAnswerInterviewQuestion}
              onApplyTransformation={handleApplyTransformation}
              onOpenCitationLineRange={handleOpenCitationLineRange}
            />
          )}
        </main>
      )}

      {/* =====================================================================
          MODAL: Create New Plan Element
         ===================================================================== */}
      {newElementModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div
            className="w-full max-w-md rounded-xl border p-5 space-y-4"
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'var(--border-strong)',
            }}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Создать новый элемент плана</h3>
              <button
                type="button"
                onClick={() => setNewElementModalOpen(false)}
                className="p-1 rounded cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label
                  className="block text-[11px] mb-1"
                  style={{ color: 'var(--text-muted)' }}
                >
                  Тип элемента (раздел 1 спецификации)
                </label>
                <div className="grid grid-cols-2 gap-1.5">
                  {(
                    [
                      'system',
                      'class',
                      'process',
                      'component',
                      'object',
                      'idea',
                    ] as ElementType[]
                  ).map((et) => (
                    <button
                      key={et}
                      type="button"
                      onClick={() => setCreateType(et)}
                      className="px-2.5 py-1.5 rounded border text-left font-medium cursor-pointer"
                      style={{
                        backgroundColor:
                          createType === et
                            ? 'var(--ctx-pos-soft)'
                            : 'var(--bg-subtle)',
                        borderColor:
                          createType === et
                            ? 'var(--ctx-pos)'
                            : 'var(--border-hairline)',
                      }}
                    >
                      {TYPE_HEADERS_RU[et]} ({TYPE_PREFIXES[et]})
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label
                  className="block text-[11px] mb-1"
                  style={{ color: 'var(--text-muted)' }}
                >
                  Название
                </label>
                <input
                  type="text"
                  placeholder="Например: Торговая лавка или Зелье невидимости"
                  value={createTitle}
                  onChange={(e) => setCreateTitle(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded border"
                  style={{
                    backgroundColor: 'var(--bg-subtle)',
                    borderColor: 'var(--border-hairline)',
                  }}
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label
                    className="block text-[11px] mb-1"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    Слаг ID (после {TYPE_PREFIXES[createType]})
                  </label>
                  <input
                    type="text"
                    placeholder="trade_shop"
                    value={createSlug}
                    onChange={(e) => setCreateSlug(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded border font-mono-tabular"
                    style={{
                      backgroundColor: 'var(--bg-subtle)',
                      borderColor: 'var(--border-hairline)',
                    }}
                  />
                </div>

                <div>
                  <label
                    className="block text-[11px] mb-1"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    Файл .pgr
                  </label>
                  <select
                    value={createFile}
                    onChange={(e) => setCreateFile(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded border font-mono-tabular"
                    style={{
                      backgroundColor: 'var(--bg-subtle)',
                      borderColor: 'var(--border-hairline)',
                    }}
                  >
                    {(files.length > 0 ? files : ['inventory.pgr']).map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {createType !== 'system' && (
                <div>
                  <label
                    className="block text-[11px] mb-1"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    Родительская Система (parent)
                  </label>
                  <select
                    value={createParent}
                    onChange={(e) => setCreateParent(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded border font-mono-tabular"
                    style={{
                      backgroundColor: 'var(--bg-subtle)',
                      borderColor: 'var(--border-hairline)',
                    }}
                  >
                    <option value="-">- (без родителя)</option>
                    {elements
                      .filter((e) => e.type === 'system')
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.id} — {s.title}
                        </option>
                      ))}
                  </select>
                </div>
              )}

              <label className="flex items-center gap-2 pt-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={createMvp}
                  onChange={(e) => setCreateMvp(e.target.checked)}
                />
                <span>Включить в контур фазы MVP</span>
              </label>
            </div>

            {/* Dialog Buttons using Positive & Negative Contextual Color Variables */}
            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={handleSaveModalNewElement}
                className="flex-1 py-2 px-3 rounded-lg text-xs font-medium btn-ctx-pos cursor-pointer"
              >
                Да, создать элемент
              </button>
              <button
                type="button"
                onClick={() => setNewElementModalOpen(false)}
                className="py-2 px-4 rounded-lg text-xs font-medium btn-ctx-neg cursor-pointer"
              >
                Нет, отмена
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL: Theme, Contextual Color Pairs, Localization & Manual Mode
         ===================================================================== */}
      {settingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div
            className="w-full max-w-lg rounded-xl border p-6 space-y-5"
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'var(--border-strong)',
            }}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Palette className="w-4 h-4" style={{ color: 'var(--ctx-pos)' }} />
                <h3 className="text-sm font-semibold">
                  Визуальные темы, пары контекстных цветов и режим работы
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                className="p-1 rounded cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              {/* Theme Mode */}
              <div>
                <label
                  className="block text-[11px] mb-1.5"
                  style={{ color: 'var(--text-muted)' }}
                >
                  Базовая тема оформления
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      { key: 'dark', label: 'Тёмная' },
                      { key: 'light', label: 'Светлая' },
                      { key: 'system', label: 'Системная' },
                    ] as { key: ThemeMode; label: string }[]
                  ).map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => setThemeMode(item.key)}
                      className="py-2 px-3 rounded border font-medium cursor-pointer"
                      style={{
                        backgroundColor:
                          themeMode === item.key
                            ? 'var(--ctx-pos-soft)'
                            : 'var(--bg-subtle)',
                        borderColor:
                          themeMode === item.key
                            ? 'var(--ctx-pos)'
                            : 'var(--border-hairline)',
                      }}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Contextual Color Pairs (Requirement 3.4 & Section 2) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label
                    className="block text-[11px] mb-1.5"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    Положительный контекстный цвет («Да», «Применить», +дифф)
                  </label>
                  <select
                    value={posPalette}
                    onChange={(e) =>
                      setPosPalette(e.target.value as PositivePaletteKey)
                    }
                    className="w-full px-2.5 py-2 rounded border"
                    style={{
                      backgroundColor: 'var(--bg-subtle)',
                      borderColor: 'var(--border-hairline)',
                    }}
                  >
                    {(Object.keys(POSITIVE_PALETTES) as PositivePaletteKey[]).map(
                      (k) => (
                        <option key={k} value={k}>
                          {POSITIVE_PALETTES[k].labelRu}
                        </option>
                      )
                    )}
                  </select>
                </div>

                <div>
                  <label
                    className="block text-[11px] mb-1.5"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    Отрицательный контекстный цвет («Нет», «Отклонить», -дифф)
                  </label>
                  <select
                    value={negPalette}
                    onChange={(e) =>
                      setNegPalette(e.target.value as NegativePaletteKey)
                    }
                    className="w-full px-2.5 py-2 rounded border"
                    style={{
                      backgroundColor: 'var(--bg-subtle)',
                      borderColor: 'var(--border-hairline)',
                    }}
                  >
                    {(Object.keys(NEGATIVE_PALETTES) as NegativePaletteKey[]).map(
                      (k) => (
                        <option key={k} value={k}>
                          {NEGATIVE_PALETTES[k].labelRu}
                        </option>
                      )
                    )}
                  </select>
                </div>
              </div>

              {/* Live Preview of Contextual Color Pair */}
              <div
                className="p-3 rounded-lg border flex items-center justify-between gap-3"
                style={{
                  backgroundColor: 'var(--bg-subtle)',
                  borderColor: 'var(--border-hairline)',
                }}
              >
                <span style={{ color: 'var(--text-secondary)' }}>
                  Предпросмотр диалоговой пары контекстных цветов:
                </span>
                <div className="flex items-center gap-2">
                  <span className="px-3 py-1 rounded text-xs font-medium btn-ctx-pos">
                    {t.confirmYes}
                  </span>
                  <span className="px-3 py-1 rounded text-xs font-medium btn-ctx-neg">
                    {t.confirmNo}
                  </span>
                </div>
              </div>

              {/* Localization & Optional AI Mode */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div>
                  <label
                    className="block text-[11px] mb-1"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    Язык интерфейса (Локализация)
                  </label>
                  <select
                    value={locale}
                    onChange={(e) => setLocale(e.target.value as LocaleKey)}
                    className="w-full px-2.5 py-1.5 rounded border"
                    style={{
                      backgroundColor: 'var(--bg-subtle)',
                      borderColor: 'var(--border-hairline)',
                    }}
                  >
                    <option value="ru">Русский (по умолчанию)</option>
                    <option value="en">English</option>
                  </select>
                </div>

                <div className="flex flex-col justify-end">
                  <label className="flex items-center gap-2 p-2 rounded border cursor-pointer"
                    style={{
                      backgroundColor: 'var(--bg-subtle)',
                      borderColor: 'var(--border-hairline)',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={aiEnabled}
                      onChange={(e) => {
                        setAiEnabled(e.target.checked);
                        if (!e.target.checked && activeTab === 'ai') {
                          setActiveTab('canvas');
                        }
                      }}
                    />
                    <Sparkles className="w-3.5 h-3.5" style={{ color: 'var(--ctx-pos)' }} />
                    <span>Модуль ИИ-ассистента (опционален)</span>
                  </label>
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                className="px-4 py-1.5 rounded-lg text-xs font-medium btn-ctx-pos cursor-pointer"
              >
                Готово
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Subtle Toast Notification */}
      {toastMessage && (
        <div
          className="fixed bottom-4 right-4 z-50 px-4 py-2 rounded-lg border text-xs font-medium shadow-md"
          style={{
            backgroundColor: 'var(--bg-surface)',
            borderColor: 'var(--ctx-pos)',
            color: 'var(--text-primary)',
          }}
        >
          {toastMessage}
        </div>
      )}
    </div>
  );
}
export default App;

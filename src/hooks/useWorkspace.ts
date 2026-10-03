import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from 'react';
import type { PlanElement } from '../types/planager';
import {
  chooseWorkspace,
  loadWorkspace,
  saveWorkspace,
  snapshotFromProject,
  type WorkspaceSnapshot,
} from '../services/workspace';
import { isDesktop } from '../services/desktop';
import { parsePgrFileContent, serializeFileWithRanges } from '../utils/pgrCodec';
import { HistoryController } from './historyStack';
import { WorkspaceOperationGate, WorkspaceRevisionFence } from './workspaceOperationGate';
import { prepareSourceImport } from './workspaceImport';

export function useWorkspace() {
  type HistoryEntry = { snapshot: WorkspaceSnapshot; elements: PlanElement[] };
  const [root, setRoot] = useState<string | null>(null);
  const [files, setFiles] = useState<string[]>([]);
  const [directories, setDirectories] = useState<string[]>([]);
  const [elements, setElements] = useState<PlanElement[]>([]);
  const elementsRef = useRef<PlanElement[]>(elements);
  elementsRef.current = elements;
  const [metadata, setMetadata] = useState<Record<string, unknown>>({});
  const [sourceContents, setSourceContents] = useState<Record<string, string>>({});
  const [sourceErrors, setSourceErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [operationBusy, setOperationBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const revisionFenceRef = useRef(new WorkspaceRevisionFence());
  const rawFilesRef = useRef<Record<string, string>>({});
  const preservedRawPathsRef = useRef<Set<string>>(new Set());
  const baselineRef = useRef<Record<string, string>>({});
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  const operationGateRef = useRef(new WorkspaceOperationGate());
  const saveTimerRef = useRef<number | null>(null);
  const historyControllerRef = useRef(new HistoryController<HistoryEntry>());
  const suppressedHistorySnapshotRef = useRef<string | null>(null);
  const resetHistoryRef = useRef(true);
  const historyTimerRef = useRef<number | null>(null);
  const latestHistoryEntryRef = useRef<HistoryEntry | null>(null);
  const [historyAvailability, setHistoryAvailability] = useState({ canUndo: false, canRedo: false });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const preview = !isDesktop();

  const applySnapshot = useCallback((snapshot: WorkspaceSnapshot, resetHistory = true, preservedElements?: PlanElement[]) => {
    const parsed: PlanElement[] = [];
    const errors: Record<string, string> = {};
    for (const file of snapshot.files) {
      try {
        // Validate each source independently so one malformed file remains editable.
        const parsedFile = parsePgrFileContent(file.content, file.path, []);
        parsed.push(...parsedFile);
        if (!parsedFile.length && file.content.trim()) errors[file.path] = 'Файл не содержит распознаваемых блоков';
      } catch (cause) {
        errors[file.path] = cause instanceof Error ? cause.message : String(cause);
      }
    }
    rawFilesRef.current = Object.fromEntries(snapshot.files.map((file) => [file.path, file.content]));
    preservedRawPathsRef.current = new Set(snapshot.files.map((file) => file.path));
    setSourceContents(rawFilesRef.current);
    setSourceErrors(errors);
    const restoredElements = preservedElements ?? parsed;
    baselineRef.current = Object.fromEntries(snapshot.files.map(({ path }) => [
      path,
      serializeFileWithRanges(restoredElements, path).content,
    ]));
    const positions = snapshot.metadata.positions;
    const positioned = parsed.map((element) => {
      if (!positions || typeof positions !== 'object') return element;
      const position = (positions as Record<string, unknown>)[element.id];
      if (!position || typeof position !== 'object') return element;
      const { x, y } = position as { x?: unknown; y?: unknown };
      return typeof x === 'number' && typeof y === 'number'
        ? { ...element, position: { x, y } }
        : element;
    });
    setRoot(snapshot.root);
    setFiles(snapshot.files.map((file) => file.path));
    setDirectories(snapshot.directories);
    const positionedElements = preservedElements ?? positioned;
    elementsRef.current = positionedElements;
    setElements(positionedElements);
    setMetadata(snapshot.metadata);
    setError(Object.entries(errors).map(([path, message]) => `${path}: ${message}`).join(' | ') || null);
    setWorkspaceReady(true);
    if (resetHistory) resetHistoryRef.current = true;
    setRevision(revisionFenceRef.current.advance());
  }, []);

  const markDirty = useCallback(() => {
    if (operationGateRef.current.locked) return;
    setRevision(revisionFenceRef.current.advance());
  }, []);
  const acceptSource = useCallback((path: string, content: string) => {
    if (operationGateRef.current.locked) return;
    rawFilesRef.current = { ...rawFilesRef.current, [path]: content };
    preservedRawPathsRef.current.add(path);
    setSourceContents((previous) => ({ ...previous, [path]: content }));
    setSourceErrors((previous) => {
      const next = { ...previous };
      delete next[path];
      return next;
    });
    markDirty();
  }, [markDirty]);
  const stageSource = useCallback((path: string, content: string, diagnostic: string | null) => {
    if (operationGateRef.current.locked) return;
    rawFilesRef.current = { ...rawFilesRef.current, [path]: content };
    preservedRawPathsRef.current.add(path);
    setSourceContents((previous) => ({ ...previous, [path]: content }));
    setSourceErrors((previous) => {
      const next = { ...previous };
      if (diagnostic) next[path] = diagnostic;
      else delete next[path];
      return next;
    });
    markDirty();
  }, [markDirty]);
  const updateFiles = useCallback((next: SetStateAction<string[]>) => {
    if (operationGateRef.current.locked) return;
    setFiles((current) => typeof next === 'function' ? next(current) : next);
    markDirty();
  }, [markDirty]);
  const updateDirectories = useCallback((next: SetStateAction<string[]>) => {
    if (operationGateRef.current.locked) return;
    setDirectories((current) => typeof next === 'function' ? next(current) : next);
    markDirty();
  }, [markDirty]);
  const updateElements = useCallback((next: SetStateAction<PlanElement[]>) => {
    if (operationGateRef.current.locked) return;
    const current = elementsRef.current;
    const updated = typeof next === 'function' ? next(current) : next;
    elementsRef.current = updated;
    setElements(updated);
    const paths = new Set([...current.map((element) => element.fileName), ...updated.map((element) => element.fileName)]);
    const changed = new Map<string, string>();
    for (const path of paths) {
      if (serializeFileWithRanges(current, path).content !== serializeFileWithRanges(updated, path).content) {
        preservedRawPathsRef.current.delete(path);
        const content = serializeFileWithRanges(updated, path).content;
        rawFilesRef.current[path] = content;
        changed.set(path, content);
      }
    }
    if (changed.size) {
      setSourceContents((previous) => ({ ...previous, ...Object.fromEntries(changed) }));
      setSourceErrors((previous) => {
        const nextErrors = { ...previous };
        changed.forEach((_, path) => delete nextErrors[path]);
        return nextErrors;
      });
    }
    markDirty();
  }, [markDirty]);
  const updateMetadata = useCallback((next: SetStateAction<Record<string, unknown>>) => {
    if (operationGateRef.current.locked) return;
    setMetadata((current) => typeof next === 'function' ? next(current) : next);
    markDirty();
  }, [markDirty]);
  const updateRoot = useCallback((next: SetStateAction<string | null>) => {
    if (!operationGateRef.current.locked) setRoot(next);
  }, []);

  const renameSourcePath = useCallback((oldPath: string, newPath: string) => {
    if (operationGateRef.current.locked) return;
    if (oldPath === newPath) return;
    const raw = rawFilesRef.current[oldPath];
    const baseline = baselineRef.current[oldPath];
    if (raw !== undefined) {
      rawFilesRef.current = { ...rawFilesRef.current, [newPath]: raw };
      delete rawFilesRef.current[oldPath];
    }
    if (baseline !== undefined) {
      baselineRef.current = { ...baselineRef.current, [newPath]: baseline };
      delete baselineRef.current[oldPath];
    }
    if (preservedRawPathsRef.current.delete(oldPath)) preservedRawPathsRef.current.add(newPath);
    setSourceContents((previous) => {
      const next = { ...previous };
      if (oldPath in next) next[newPath] = next[oldPath];
      delete next[oldPath];
      return next;
    });
    setSourceErrors((previous) => {
      const next = { ...previous };
      if (oldPath in next) next[newPath] = next[oldPath];
      delete next[oldPath];
      return next;
    });
    updateFiles((current) => current.map((path) => path === oldPath ? newPath : path));
  }, [updateFiles]);

  const renameFolderPath = useCallback((oldPrefix: string, newPrefix: string) => {
    if (operationGateRef.current.locked) return;
    const pathPairs = files.filter((path) => path.startsWith(`${oldPrefix}/`)).map((path) => [path, `${newPrefix}${path.slice(oldPrefix.length)}`] as const);
    for (const [oldPath, newPath] of pathPairs) {
      const raw = rawFilesRef.current[oldPath];
      const baseline = baselineRef.current[oldPath];
      if (raw !== undefined) { rawFilesRef.current[newPath] = raw; delete rawFilesRef.current[oldPath]; }
      if (baseline !== undefined) { baselineRef.current[newPath] = baseline; delete baselineRef.current[oldPath]; }
      if (preservedRawPathsRef.current.delete(oldPath)) preservedRawPathsRef.current.add(newPath);
      if (sourceContents[oldPath] !== undefined) setSourceContents((previous) => { const next = { ...previous, [newPath]: previous[oldPath] }; delete next[oldPath]; return next; });
      if (sourceErrors[oldPath] !== undefined) setSourceErrors((previous) => { const next = { ...previous, [newPath]: previous[oldPath] }; delete next[oldPath]; return next; });
    }
    updateFiles((current) => current.map((path) => path.startsWith(`${oldPrefix}/`) ? `${newPrefix}${path.slice(oldPrefix.length)}` : path));
    updateDirectories((current) => current.map((path) => path === oldPrefix || path.startsWith(`${oldPrefix}/`) ? `${newPrefix}${path.slice(oldPrefix.length)}` : path));
  }, [files, sourceContents, sourceErrors, updateFiles, updateDirectories]);

  const copySourcePath = useCallback((oldPath: string, newPath: string) => {
    if (operationGateRef.current.locked) return;
    const raw = rawFilesRef.current[oldPath];
    if (raw !== undefined) {
      rawFilesRef.current = { ...rawFilesRef.current, [newPath]: raw };
      preservedRawPathsRef.current.add(newPath);
    }
    if (baselineRef.current[oldPath] !== undefined) baselineRef.current[newPath] = baselineRef.current[oldPath];
    if (sourceContents[oldPath] !== undefined) setSourceContents((previous) => ({ ...previous, [newPath]: previous[oldPath] }));
    if (sourceErrors[oldPath] !== undefined) setSourceErrors((previous) => ({ ...previous, [newPath]: previous[oldPath] }));
    updateFiles((current) => current.includes(newPath) ? current : [...current, newPath]);
  }, [sourceContents, sourceErrors, updateFiles]);

  const removeSourcePath = useCallback((path: string) => {
    if (operationGateRef.current.locked) return;
    delete rawFilesRef.current[path];
    delete baselineRef.current[path];
    preservedRawPathsRef.current.delete(path);
    setSourceContents((previous) => { const next = { ...previous }; delete next[path]; return next; });
    setSourceErrors((previous) => { const next = { ...previous }; delete next[path]; return next; });
    updateFiles((current) => current.filter((item) => item !== path));
  }, [updateFiles]);

  const importSourceFile = useCallback((name: string, content: string) => {
    if (!operationGateRef.current.locked) {
      throw new Error('Import must run inside a workspace operation');
    }
    if (!workspaceReady) throw new Error('Workspace has not loaded successfully');

    const prepared = prepareSourceImport(
      name,
      content,
      [...files, ...Object.keys(rawFilesRef.current)],
      elementsRef.current,
    );
    const nextElements = [...elementsRef.current, ...prepared.elements];
    const nextErrors = { ...sourceErrors };
    if (prepared.diagnostic) nextErrors[prepared.path] = prepared.diagnostic;
    else delete nextErrors[prepared.path];

    rawFilesRef.current = { ...rawFilesRef.current, [prepared.path]: prepared.content };
    preservedRawPathsRef.current.add(prepared.path);
    baselineRef.current = {
      ...baselineRef.current,
      [prepared.path]: serializeFileWithRanges(nextElements, prepared.path).content,
    };
    elementsRef.current = nextElements;
    setElements(nextElements);
    setFiles((previous) => previous.includes(prepared.path) ? previous : [...previous, prepared.path]);
    setSourceContents((previous) => ({ ...previous, [prepared.path]: prepared.content }));
    setSourceErrors(nextErrors);
    setError(Object.entries(nextErrors).map(([path, message]) => `${path}: ${message}`).join(' | ') || null);
    setRevision(revisionFenceRef.current.advance());
    return { path: prepared.path, diagnostic: prepared.diagnostic };
  }, [files, sourceErrors, workspaceReady]);

  useEffect(() => {
    let active = true;
    loadWorkspace()
      .then((snapshot) => {
        if (active) applySnapshot(snapshot);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (active) {
          setLoading(false);
          setLoaded(true);
        }
      });
    return () => { active = false; };
  }, [applySnapshot]);

  const snapshot = useMemo(() => {
    const generated = snapshotFromProject(
    root,
    files,
    directories,
    elements,
    {
      ...metadata,
      positions: Object.fromEntries(elements.map(({ id, position }) => [id, position])),
    }
    );
    return {
      ...generated,
      files: generated.files.map((file) => {
        const raw = rawFilesRef.current[file.path];
        const baseline = baselineRef.current[file.path];
        return raw !== undefined && preservedRawPathsRef.current.has(file.path)
          ? { ...file, content: raw }
          : raw !== undefined && baseline === file.content
            ? { ...file, content: raw }
            : file;
      }),
    };
  }, [root, files, directories, elements, metadata, revision]);

  const beginHistoryTransaction = useCallback(() => {
    if (historyTimerRef.current !== null) {
      window.clearTimeout(historyTimerRef.current);
      historyTimerRef.current = null;
    }
    const pending = latestHistoryEntryRef.current;
    historyControllerRef.current.begin(pending, pending ? JSON.stringify(pending) : null);
    setHistoryAvailability({ canUndo: historyControllerRef.current.canUndo, canRedo: historyControllerRef.current.canRedo });
  }, []);
  const endHistoryTransaction = useCallback(() => {
    const pending = latestHistoryEntryRef.current;
    historyControllerRef.current.end(pending, pending ? JSON.stringify(pending) : null);
    setHistoryAvailability({ canUndo: historyControllerRef.current.canUndo, canRedo: historyControllerRef.current.canRedo });
  }, []);

  useEffect(() => {
    if (!workspaceReady) return;
    const entry: HistoryEntry = { snapshot, elements };
    latestHistoryEntryRef.current = entry;
    const serialized = JSON.stringify(entry);
    const controller = historyControllerRef.current;
    if (resetHistoryRef.current || controller.length === 0) {
      if (historyTimerRef.current !== null) window.clearTimeout(historyTimerRef.current);
      controller.reset(entry, serialized);
      suppressedHistorySnapshotRef.current = null;
      resetHistoryRef.current = false;
      setHistoryAvailability({ canUndo: false, canRedo: false });
      return;
    }
    if (suppressedHistorySnapshotRef.current === serialized) {
      suppressedHistorySnapshotRef.current = null;
      controller.markRestored(serialized);
      return;
    }
    if (controller.inTransaction) {
      controller.observe(entry, serialized, true);
      return;
    }
    if (historyTimerRef.current !== null) window.clearTimeout(historyTimerRef.current);
    const active = document.activeElement;
    const coalesceTyping = active instanceof HTMLElement &&
      (active.matches('input, textarea, [contenteditable="true"]') || active.closest('[contenteditable="true"]') !== null);
    controller.observe(entry, serialized, coalesceTyping);
    setHistoryAvailability({ canUndo: controller.canUndo, canRedo: controller.canRedo });
    if (!coalesceTyping) return;
    historyTimerRef.current = window.setTimeout(() => {
      historyTimerRef.current = null;
      const latest = latestHistoryEntryRef.current;
      controller.flush(latest, latest ? JSON.stringify(latest) : null);
      setHistoryAvailability({ canUndo: controller.canUndo, canRedo: controller.canRedo });
    }, 450);
    return () => {
      if (historyTimerRef.current !== null) {
        window.clearTimeout(historyTimerRef.current);
        historyTimerRef.current = null;
      }
    };
  }, [workspaceReady, snapshot, elements, revision]);

  const restoreHistory = useCallback((target: HistoryEntry | null) => {
    if (!target) return;
    if (historyTimerRef.current !== null) window.clearTimeout(historyTimerRef.current);
    suppressedHistorySnapshotRef.current = JSON.stringify(target);
    setHistoryAvailability({ canUndo: historyControllerRef.current.canUndo, canRedo: historyControllerRef.current.canRedo });
    applySnapshot(target.snapshot, false, target.elements);
  }, [applySnapshot]);
  const undo = useCallback(() => {
    if (operationGateRef.current.locked) return;
    if (historyTimerRef.current !== null) {
      window.clearTimeout(historyTimerRef.current);
      historyTimerRef.current = null;
    }
    const pending = latestHistoryEntryRef.current;
    restoreHistory(historyControllerRef.current.undo(pending, pending ? JSON.stringify(pending) : null));
  }, [restoreHistory]);
  const redo = useCallback(() => {
    if (operationGateRef.current.locked) return;
    if (historyTimerRef.current !== null) {
      window.clearTimeout(historyTimerRef.current);
      historyTimerRef.current = null;
    }
    const pending = latestHistoryEntryRef.current;
    restoreHistory(historyControllerRef.current.redo(pending, pending ? JSON.stringify(pending) : null));
  }, [restoreHistory]);

  const flush = useCallback(async () => {
    if (!workspaceReady) throw new Error('Workspace has not loaded successfully');
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    await saveChainRef.current;
    await saveWorkspace(snapshot);
    rawFilesRef.current = Object.fromEntries(snapshot.files.map((file) => [file.path, file.content]));
    baselineRef.current = Object.fromEntries(snapshot.files.map(({ path }) => [
      path,
      serializeFileWithRanges(elements, path).content,
    ]));
  }, [workspaceReady, snapshot, elements]);

  const reloadFromDisk = useCallback(async () => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    // Invalidate debounced and already-queued writes before waiting for the
    // in-flight writer. Once it drains, the disk read observes its final state.
    setRevision(revisionFenceRef.current.advance());
    await saveChainRef.current;
    const current = await loadWorkspace();
    applySnapshot(current);
    return current;
  }, [applySnapshot]);

  const runWorkspaceOperation = useCallback(async <T,>(
    operation: (context: { reload: () => Promise<WorkspaceSnapshot> }) => Promise<T>,
    options: { flushBefore?: boolean } = {},
  ): Promise<T> => {
    return operationGateRef.current.run(async () => {
      setOperationBusy(true);
      try {
        if (options.flushBefore ?? true) {
          if (workspaceReady) await flush();
          else await saveChainRef.current;
        }
        return await operation({ reload: reloadFromDisk });
      } finally {
        setOperationBusy(false);
      }
    });
  }, [flush, reloadFromDisk, workspaceReady]);

  const reload = useCallback(async () => {
    return runWorkspaceOperation(({ reload: reloadNow }) => reloadNow(), { flushBefore: false });
  }, [runWorkspaceOperation]);

  const choose = useCallback(async () => {
    return runWorkspaceOperation(async () => {
      const chosen = await chooseWorkspace();
      if (chosen) applySnapshot(chosen);
      return chosen;
    });
  }, [applySnapshot, runWorkspaceOperation]);

  useEffect(() => {
    if (!workspaceReady || revision === 0 || operationGateRef.current.locked) return;
    const saveRevision = revision;
    const timer = window.setTimeout(() => {
      setSaving(true);
      saveChainRef.current = saveChainRef.current.then(async () => {
        try {
          if (!revisionFenceRef.current.isCurrent(saveRevision)) return;
          await saveWorkspace(snapshot);
          rawFilesRef.current = Object.fromEntries(snapshot.files.map((file) => [file.path, file.content]));
          setSourceContents(rawFilesRef.current);
          baselineRef.current = Object.fromEntries(snapshot.files.map(({ path }) => [
            path,
            serializeFileWithRanges(elements, path).content,
          ]));
          setError(null);
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
          setSaving(false);
        }
      });
    }, 500);
    saveTimerRef.current = timer;
    return () => { window.clearTimeout(timer); if (saveTimerRef.current === timer) saveTimerRef.current = null; };
  }, [workspaceReady, revision, snapshot, elements]);

  return {
    root, setRoot: updateRoot, files, setFiles: updateFiles, directories, setDirectories: updateDirectories,
    elements, setElements: updateElements, metadata, setMetadata: updateMetadata, loading, loaded, workspaceReady, error,
    saving, operationBusy, preview, revision, choose, runWorkspaceOperation, setError, sourceContents, sourceErrors, acceptSource, stageSource,
    renameSourcePath, renameFolderPath, copySourcePath, removeSourcePath, flush, reload,
    importSourceFile,
    undo, redo, canUndo: historyAvailability.canUndo, canRedo: historyAvailability.canRedo,
    beginHistoryTransaction, endHistoryTransaction,
  };
}

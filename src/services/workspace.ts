import type { PlanElement } from '../types/planager';
import { desktopInvoke, isDesktop } from './desktop';
import { serializeFileWithRanges } from '../utils/pgrCodec';

export interface WorkspaceFile { path: string; content: string }
export interface WorkspaceSnapshot {
  root: string | null;
  files: WorkspaceFile[];
  directories: string[];
  metadata: Record<string, unknown>;
}

const PREVIEW_KEY = 'planager.browser-preview.workspace.v1';

export async function loadWorkspace(): Promise<WorkspaceSnapshot> {
  if (isDesktop()) return desktopInvoke<WorkspaceSnapshot>('workspace_load');
  const raw = window.localStorage.getItem(PREVIEW_KEY);
  if (!raw) return { root: null, files: [], directories: [], metadata: {} };
  const snapshot: unknown = JSON.parse(raw);
  if (!isSnapshot(snapshot)) throw new Error('Browser preview workspace is invalid');
  return snapshot;
}

export async function chooseWorkspace(): Promise<WorkspaceSnapshot | null> {
  if (!isDesktop()) throw new Error('Choose workspace is available in the Tauri desktop app');
  const selected = await desktopInvoke<string | null>('workspace_choose');
  if (!selected) return null;
  return desktopInvoke<WorkspaceSnapshot>('workspace_open_selected', { selected });
}

export async function saveWorkspace(snapshot: WorkspaceSnapshot): Promise<void> {
  if (isDesktop()) {
    await desktopInvoke<{ saved: true }>('workspace_save', {
      files: snapshot.files,
      directories: snapshot.directories,
      metadata: snapshot.metadata,
      ...(snapshot.root ? { expectedRoot: snapshot.root } : {}),
    });
    return;
  }
  window.localStorage.setItem(PREVIEW_KEY, JSON.stringify(snapshot));
}

export async function revealWorkspacePath(path: string): Promise<void> {
  if (!isDesktop()) throw new Error('Reveal in file manager is available in the Tauri desktop app');
  await desktopInvoke<{ revealed: true }>('workspace_reveal', { path });
}

export function snapshotFromProject(
  root: string | null,
  files: string[],
  directories: string[],
  elements: PlanElement[],
  metadata: Record<string, unknown>
): WorkspaceSnapshot {
  return {
    root,
    directories,
    metadata,
    files: files.map((path) => ({ path, content: serializeFileWithRanges(elements, path).content })),
  };
}

function isSnapshot(value: unknown): value is WorkspaceSnapshot {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<WorkspaceSnapshot>;
  return (candidate.root === null || typeof candidate.root === 'string') &&
    Array.isArray(candidate.files) && candidate.files.every((file) =>
      !!file && typeof file.path === 'string' && typeof file.content === 'string'
    ) && Array.isArray(candidate.directories) &&
    candidate.directories.every((directory) => typeof directory === 'string') &&
    !!candidate.metadata && typeof candidate.metadata === 'object';
}

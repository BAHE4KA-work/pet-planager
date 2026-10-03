import { useCallback, useEffect, useState } from 'react';
import type { GitCommit, LocaleKey } from '../types/planager';
import { desktopInvoke, isDesktop } from '../services/desktop';
import { localizedText } from '../utils/localization';

interface UseGitWorkspaceOptions {
  enabled: boolean;
  locale: LocaleKey;
  workspaceReady: boolean;
  workspacePreview: boolean;
  workspaceSaving: boolean;
  workspaceRevision: number;
  activeTab: string;
  activeSettingsSection: string;
}

export function useGitWorkspace(options: UseGitWorkspaceOptions) {
  const [uncommittedChanges, setUncommittedChanges] = useState(0);
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [available, setAvailable] = useState(false);
  const [branch, setBranch] = useState<string | null>(null);
  const [branches, setBranches] = useState<string[]>([]);
  const [dirtyFiles, setDirtyFiles] = useState<string[]>([]);
  const [diffText, setDiffText] = useState('');
  const [baseCommit, setBaseCommit] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState('');

  const refreshStatus = useCallback(async () => {
    if (!isDesktop()) {
      setAvailable(false);
      setError('Git integration is available in the Tauri desktop app.');
      setCommits([]);
      setDirtyFiles([]);
      setUncommittedChanges(0);
      setBranches([]);
      setBranch(null);
      setDiffText('');
      return;
    }
    try {
      const status = await desktopInvoke<{
        available: boolean;
        branch: string | null;
        dirtyFiles: string[];
        commits: Array<{ hash: string; message: string; timestamp: string }>;
      }>('git_status');
      const branchData = await desktopInvoke<{ branches: string[]; current: string | null }>('git_branches');
      setAvailable(status.available);
      setDirtyFiles(status.dirtyFiles);
      setUncommittedChanges(status.dirtyFiles.length);
      setCommits(status.commits.map((commit) => ({
        id: commit.hash,
        hash: commit.hash,
        message: commit.message,
        timestamp: commit.timestamp,
        author: status.branch || '',
      })));
      setError(status.available ? null : localizedText(options.locale, 'Текущая папка не является Git-репозиторием.', 'The current folder is not a Git repository.'));
      setBranches(branchData.branches);
      setBranch(branchData.current);
    } catch (cause) {
      setAvailable(false);
      setCommits([]);
      setDirtyFiles([]);
      setUncommittedChanges(0);
      setBranches([]);
      setBranch(null);
      setDiffText('');
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [options.locale]);

  const refreshDiff = useCallback(async (
    base = baseCommit || commits[0]?.hash || 'HEAD',
    path = selectedFile,
  ) => {
    if (!isDesktop() || !available) {
      setDiffText('');
      return;
    }
    try {
      const response = await desktopInvoke<{ diff: string }>('git_diff', { base, ...(path ? { path } : {}) });
      setDiffText(response.diff);
    } catch (cause) {
      setDiffText('');
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [available, baseCommit, commits, selectedFile]);

  useEffect(() => {
    if (!options.enabled) {
      setAvailable(false);
      setBranch(null);
      setBranches([]);
      setCommits([]);
      setDirtyFiles([]);
      setUncommittedChanges(0);
      setDiffText('');
      setError(null);
    } else if (options.workspaceReady && !options.workspacePreview && !options.workspaceSaving) {
      // Auto-save can run after every edit. Wait for a quiet period so Git
      // doesn't launch a burst of subprocesses while the user is typing.
      const timer = window.setTimeout(() => { void refreshStatus(); }, 1200);
      return () => window.clearTimeout(timer);
    }
  }, [options.workspaceReady, options.workspacePreview, options.workspaceSaving, options.workspaceRevision, options.enabled, refreshStatus]);

  useEffect(() => {
    if (options.activeTab === 'settings' && options.activeSettingsSection === 'git' && available && options.enabled) {
      void refreshDiff();
    }
  }, [options.activeTab, options.activeSettingsSection, available, options.enabled, commits, selectedFile, baseCommit, refreshDiff]);

  return {
    uncommittedChanges,
    commits,
    available,
    branch,
    branches,
    dirtyFiles,
    diffText,
    baseCommit,
    error,
    selectedFile,
    setBaseCommit,
    setError,
    setSelectedFile,
    refreshStatus,
    refreshDiff,
  };
}

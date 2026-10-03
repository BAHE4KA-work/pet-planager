import { useEffect, useRef, useState } from 'react';
import { GitBranch, GitCommit as GitCommitIcon, GitCompareArrows, RefreshCw, RotateCcw, ShieldAlert } from 'lucide-react';
import type { LocaleKey } from '../types/planager';
import { Button } from './ui/Button';
import { Dialog } from './ui/Dialog';
import { EmptyState } from './ui/EmptyState';
import { FormField, SelectInput, TextInput } from './ui/FormField';
import { localizedText } from '../utils/localization';

export interface NativeGitCommit { hash: string; message: string; timestamp: string }
export interface NativeGitViewProps {
  available: boolean;
  branch: string | null;
  locale?: LocaleKey;
  branches: string[];
  dirtyFiles: string[];
  commits: NativeGitCommit[];
  diff: string;
  files: string[];
  selectedFile: string;
  error: string | null;
  onRefresh(): Promise<void>;
  onCommit(message: string): Promise<void>;
  onCheckout(branch: string): Promise<void>;
  onCreateBranch(name: string): Promise<void>;
  onSelectFile(file: string): void;
  onRestore(hash: string): Promise<void>;
  onSelectCommit?(hash: string): void;
}

const copy = {
  title: ['Native Git', 'Git в проекте'], pretitle: ['LOCAL VERSION CONTROL', 'ЛОКАЛЬНЫЙ КОНТРОЛЬ ВЕРСИЙ'],
  refreshing: ['Refreshing…', 'Обновление…'], refresh: ['Refresh status', 'Обновить статус'],
  unavailable: ['Git is unavailable for this workspace', 'Git недоступен для этой папки'], unavailableHelp: ['Choose or initialize a Git repository to view branches, commits and source diffs.', 'Выберите папку с Git-репозиторием или инициализируйте его, чтобы просматривать ветки, коммиты и различия файлов.'],
  branchTitle: ['Branches', 'Ветки'], currentBranch: ['Current branch', 'Текущая ветка'], newBranch: ['New branch name', 'Название новой ветки'], createBranch: ['Create branch', 'Создать ветку'],
  commitTitle: ['Commit workspace changes', 'Сохранить изменения проекта в Git'], commitMessage: ['Commit message', 'Сообщение коммита'], commitHint: ['A short note describing the saved project state.', 'Кратко опишите сохранённое состояние проекта.'], commitPlaceholder: ['Describe this change', 'Опишите изменения'], committing: ['Committing…', 'Создание коммита…'], commit: ['Commit changes', 'Создать коммит'],
  changedFiles: ['Changed files', 'Изменённые файлы'], dirtyAria: ['Uncommitted files', 'Файлы с незакоммиченными изменениями'], clean: ['Working tree clean', 'Нет незакоммиченных изменений'], cleanHelp: ['No uncommitted changes are reported by Git.', 'Git не обнаружил незакоммиченных изменений.'],
  workspaceFile: ['Workspace file', 'Файл проекта'], allFiles: ['All workspace files', 'Все файлы проекта'], compare: ['Compare with commit', 'Сравнить с коммитом'], latest: ['Latest commit', 'Последний коммит'], diff: ['Workspace diff', 'Различия файлов проекта'], noDiff: ['No diff to show for this selection.', 'Для выбранных данных нет различий.'],
  history: ['Commit history', 'История коммитов'], noCommits: ['No commits yet', 'Коммитов пока нет'], noCommitsHelp: ['Create the first commit after reviewing the current workspace changes.', 'Проверьте изменения проекта и создайте первый коммит.'],
  restore: ['Restore…', 'Восстановить…'], restoreTitle: ['Restore this workspace snapshot?', 'Восстановить это состояние проекта?'], restoreDescription: ['Restoring replaces tracked .pgr files and .planager.json with the selected commit. Uncommitted edits in those files may be lost. Review the changed-file list before continuing; unrelated files are outside this restore operation.', 'Восстановление заменит отслеживаемые файлы .pgr и .planager.json содержимым выбранного коммита. Незакоммиченные изменения в этих файлах могут быть потеряны. Перед продолжением проверьте список изменённых файлов; остальные файлы эта операция не затрагивает.'], cancel: ['Cancel', 'Отмена'], restoring: ['Restoring…', 'Восстановление…'], restoreSnapshot: ['Restore snapshot', 'Восстановить состояние'], restoreWarning: ['This action changes workspace files immediately after you confirm.', 'После подтверждения файлы проекта будут изменены.'],
  refreshingNotice: ['Status refreshed.', 'Статус обновлён.'], switched: ['Switched to', 'Переключено на'], createdBranch: ['Created branch', 'Создана ветка'], committed: ['Commit created.', 'Коммит создан.'], restored: ['Restored', 'Восстановлено'], close: ['Close', 'Закрыть'], fileCountOne: ['uncommitted file', 'незакоммиченный файл'], fileCountMany: ['uncommitted files', 'незакоммиченных файлов'], detached: ['Detached HEAD', 'Нет активной ветки'],
} as const;

function pluralFiles(count: number, locale: LocaleKey) {
  if (locale === 'en') return count === 1 ? copy.fileCountOne[0] : copy.fileCountMany[0];
  const lastTwo = count % 100;
  const last = count % 10;
  if (last === 1 && lastTwo !== 11) return 'незакоммиченный файл';
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return 'незакоммиченных файла';
  return copy.fileCountMany[1];
}

export function NativeGitView(props: NativeGitViewProps) {
  const locale = props.locale ?? 'ru';
  const t = (key: keyof typeof copy) => localizedText(locale, copy[key][1], copy[key][0]);
  const [message, setMessage] = useState('');
  const [newBranch, setNewBranch] = useState('');
  const [baseCommit, setBaseCommit] = useState('');
  const [restoreTarget, setRestoreTarget] = useState<NativeGitCommit | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [localError, setLocalError] = useState('');
  const [localNotice, setLocalNotice] = useState('');
  const userChoseBase = useRef(false);
  useEffect(() => {
    if (baseCommit && props.commits.some((commit) => commit.hash === baseCommit)) return;
    if (!baseCommit && userChoseBase.current) return;
    if (baseCommit) userChoseBase.current = false;
    const newest = props.commits[0]?.hash ?? '';
    if (newest !== baseCommit) {
      setBaseCommit(newest);
      props.onSelectCommit?.(newest);
    }
  }, [baseCommit, props.branch, props.commits, props.onSelectCommit]);
  const run = async (task: string, action: () => Promise<void>, notice?: string) => {
    setBusy(task); setLocalError(''); setLocalNotice('');
    try { await action(); if (notice) setLocalNotice(notice); }
    catch (cause) { setLocalError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(null); }
  };
  const reset = async () => {
    if (!restoreTarget) return;
    const target = restoreTarget;
    await run('restore', async () => { await props.onRestore(target.hash); setRestoreTarget(null); }, `${t('restored')} ${target.hash.slice(0, 8)}.`);
  };

  return (
    <section className="editor-scroll mx-auto w-full max-w-6xl space-y-5 p-4 md:p-7" aria-labelledby="native-git-title">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div><p className="label">{t('pretitle')}</p><h1 id="native-git-title" className="title-display text-3xl">Git</h1><p className="mt-1 text-sm text-[var(--ink-muted)]">{props.available ? <>{props.branch || t('detached')} · {props.dirtyFiles.length} {pluralFiles(props.dirtyFiles.length, locale)}</> : t('unavailable')}</p></div>
        <Button icon={<RefreshCw size={14} aria-hidden="true"/>} disabled={busy !== null} onClick={() => void run('refresh', props.onRefresh, t('refreshingNotice'))}>{busy === 'refresh' ? t('refreshing') : t('refresh')}</Button>
      </header>

      {props.error || localError ? <div className="rounded-xl border border-[var(--ctx-neg-border)] bg-[var(--ctx-neg-soft)] p-3 text-sm text-[var(--ctx-neg-text)]" role="alert">{localError || props.error}</div> : null}
      {localNotice ? <p className="text-sm text-[var(--ctx-pos-text)]" role="status">{localNotice}</p> : null}

      {!props.available ? <EmptyState icon={<GitBranch size={22}/>} title={t('unavailable')} description={t('unavailableHelp')} /> : <>
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4" aria-labelledby="branch-title">
            <h2 id="branch-title" className="section-title mb-4 flex items-center gap-2"><GitBranch size={16} aria-hidden="true"/>{t('branchTitle')}</h2>
            <FormField id="branch-select" label={t('currentBranch')}>
              <SelectInput id="branch-select" value={props.branch ?? ''} disabled={busy !== null || !props.branches.length} onChange={(event) => {
                const next = event.target.value;
                if (next && next !== props.branch) void run('checkout', () => props.onCheckout(next), `${t('switched')} ${next}.`);
              }}>
                {!props.branch ? <option value="">{t('detached')}</option> : null}
                {props.branch && !props.branches.includes(props.branch) ? <option value={props.branch}>{props.branch}</option> : null}
                {props.branches.map((branch) => <option key={branch} value={branch}>{branch}</option>)}
              </SelectInput>
            </FormField>
            <form className="mt-4 flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); const name = newBranch.trim(); if (name) void run('branch', async () => { await props.onCreateBranch(name); setNewBranch(''); }, `${t('createdBranch')} ${name}.`); }}>
              <label className="sr-only" htmlFor="new-branch">{t('newBranch')}</label>
              <TextInput id="new-branch" value={newBranch} maxLength={200} onChange={(event) => setNewBranch(event.target.value)} placeholder="feature/name" className="flex-1" />
              <Button type="submit" disabled={busy !== null || !newBranch.trim()} icon={<GitBranch size={14} aria-hidden="true"/>}>{t('createBranch')}</Button>
            </form>
          </section>

          <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4" aria-labelledby="commit-title">
            <h2 id="commit-title" className="section-title mb-4 flex items-center gap-2"><GitCommitIcon size={16} aria-hidden="true"/>{t('commitTitle')}</h2>
            <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); const value = message.trim(); if (value) void run('commit', async () => { await props.onCommit(value); setMessage(''); }, t('committed')); }}>
              <FormField id="commit-message" label={t('commitMessage')} hint={t('commitHint')}>
                <TextInput id="commit-message" value={message} maxLength={500} onChange={(event) => setMessage(event.target.value)} placeholder={t('commitPlaceholder')} />
              </FormField>
              <Button type="submit" variant="primary" disabled={busy !== null || !message.trim()}>{busy === 'commit' ? t('committing') : t('commit')}</Button>
            </form>
          </section>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(250px,0.8fr)_minmax(0,1.6fr)]">
          <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4" aria-labelledby="dirty-title">
            <div className="mb-3 flex items-center justify-between gap-2"><h2 id="dirty-title" className="section-title">{t('changedFiles')}</h2><span className="pill">{props.dirtyFiles.length}</span></div>
            {props.dirtyFiles.length ? <ul className="max-h-72 space-y-1 overflow-auto" aria-label={t('dirtyAria')}>{props.dirtyFiles.map((file) => <li key={file}>{file.toLowerCase().endsWith('.pgr') || file === '.planager.json' ? <button type="button" className={`w-full truncate rounded-lg border px-2.5 py-2 text-left font-mono text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${props.selectedFile === file ? 'border-[var(--accent)] bg-[var(--surface-hover)]' : 'border-transparent hover:bg-[var(--surface-hover)]'}`} title={file} onClick={() => props.onSelectFile(file)}>{file}</button> : <span className="block truncate rounded-lg px-2.5 py-2 font-mono text-xs text-[var(--ink-muted)]" title={file}>{file}</span>}</li>)}</ul> : <EmptyState title={t('clean')} description={t('cleanHelp')} />}
          </section>

          <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4" aria-labelledby="diff-title">
            <div className="mb-4 flex flex-wrap items-end gap-3"><div className="min-w-[180px] flex-1"><FormField id="diff-file" label={t('workspaceFile')}>
              <SelectInput id="diff-file" value={props.selectedFile} onChange={(event) => props.onSelectFile(event.target.value)}><option value="">{t('allFiles')}</option>{props.files.map((file) => <option key={file} value={file}>{file}</option>)}{props.selectedFile === '.planager.json' && !props.files.includes('.planager.json') ? <option value=".planager.json">.planager.json</option> : null}</SelectInput>
            </FormField></div><div className="min-w-[180px] flex-1"><FormField id="diff-base" label={t('compare')}>
              <SelectInput id="diff-base" value={baseCommit} onChange={(event) => { userChoseBase.current = true; setBaseCommit(event.target.value); props.onSelectCommit?.(event.target.value); }} aria-label={t('compare')}><option value="">{t('latest')}</option>{props.commits.map((commit) => <option key={commit.hash} value={commit.hash}>{commit.hash.slice(0, 8)} · {commit.message}</option>)}</SelectInput>
            </FormField></div></div>
            <h2 id="diff-title" className="sr-only">{t('diff')}</h2>
            <pre className="max-h-[28rem] min-h-48 overflow-auto rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3 font-mono text-xs leading-5 text-[var(--ink)]" aria-live="polite">{props.diff || t('noDiff')}</pre>
          </section>
        </div>

        <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4" aria-labelledby="history-title">
          <div className="mb-3 flex items-center gap-2"><GitCompareArrows size={16} aria-hidden="true" className="text-[var(--accent)]"/><h2 id="history-title" className="section-title">{t('history')}</h2><span className="pill">{props.commits.length}</span></div>
          {props.commits.length === 0 ? <EmptyState title={t('noCommits')} description={t('noCommitsHelp')}/> : <ol className="divide-y divide-[var(--border)]">{props.commits.map((commit) => <li key={commit.hash} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
            <button type="button" onClick={() => { userChoseBase.current = true; setBaseCommit(commit.hash); props.onSelectCommit?.(commit.hash); }} className="min-w-0 flex-1 rounded-lg p-1 text-left hover:bg-[var(--surface-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"><span className="block truncate text-sm font-medium">{commit.message}</span><span className="mt-1 block font-mono text-[11px] text-[var(--ink-muted)]">{commit.hash.slice(0, 12)} · {Number.isFinite(new Date(commit.timestamp).getTime()) ? new Date(commit.timestamp).toLocaleString(locale === 'ru' ? 'ru-RU' : 'en-US') : commit.timestamp}</span></button>
            <Button size="sm" variant="danger" icon={<RotateCcw size={13} aria-hidden="true"/>} disabled={busy !== null} onClick={() => setRestoreTarget(commit)}>{t('restore')}</Button>
          </li>)}</ol>}
        </section>
      </>}

      <Dialog open={restoreTarget !== null} title={t('restoreTitle')} description={t('restoreDescription')} onClose={() => { if (busy !== 'restore') setRestoreTarget(null); }} closeLabel={t('close')} actions={<><Button disabled={busy === 'restore'} onClick={() => setRestoreTarget(null)}>{t('cancel')}</Button><Button variant="danger" disabled={busy === 'restore'} onClick={() => void reset()}>{busy === 'restore' ? t('restoring') : t('restoreSnapshot')}</Button></>}>
        {restoreTarget ? <div className="rounded-lg border border-[var(--ctx-neg-border)] bg-[var(--ctx-neg-soft)] p-3 text-sm"><p className="font-medium">{restoreTarget.message}</p><p className="mt-1 font-mono text-xs">{restoreTarget.hash}</p><p className="mt-2 flex items-start gap-2 text-xs"><ShieldAlert size={14} className="mt-0.5 shrink-0" aria-hidden="true"/>{t('restoreWarning')}</p></div> : null}
      </Dialog>
    </section>
  );
}
